import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { nativeImage } from 'electron';
import { productError, ProductFailure, type Logger } from '@pi-ide/foundation';
import {
  ATTACHMENT_IMAGE_MIMES,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_FILE_REF_THUMB_CHARS,
  type FileContextRefDto,
} from '@pi-ide/ipc-contracts';
import type { PromptImage } from '@pi-ide/agent-contract';
import { registerHandlers } from './router.js';
import type { TaskService } from '../services/task-service.js';

/**
 * ADR-0024: context-attachment import + prompt-image resolution.
 *
 * An import copies an OUT-OF-PROJECT image (Finder drop / clipboard paste)
 * into `attachments/<taskId>/` — never into the project tree — and returns
 * chip metadata. At send time, image refs are resolved back to bytes here in
 * Main; the agent process never gains filesystem scope from any of this.
 */

const THUMB_WIDTH = 48;

const MIME_BY_EXT: Record<string, (typeof ATTACHMENT_IMAGE_MIMES)[number]> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

export function imageMimeForPath(path: string): string | null {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? null;
}

function attachmentFileName(attachmentId: string, mimeType: string): string {
  return `ctx-${attachmentId}${EXT_BY_MIME[mimeType] ?? '.png'}`;
}

function thumbnailDataUrl(bytes: Buffer): string {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) {
    throw new ProductFailure(
      productError('ATTACHMENT_BAD_IMAGE', {
        userMessage: 'This image could not be decoded — try a PNG or JPEG export.',
      }),
    );
  }
  for (const width of [THUMB_WIDTH, 32, 20]) {
    const scaled = image.getSize().width > width ? image.resize({ width }) : image;
    const dataUrl = scaled.toDataURL();
    if (dataUrl.length <= MAX_FILE_REF_THUMB_CHARS) return dataUrl;
  }
  return '';
}

export interface ImportedAttachment {
  attachmentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  thumbDataUrl: string;
}

type ImportSource =
  | { kind: 'path'; path: string }
  | { kind: 'bytes'; dataBase64: string; name: string; mimeType: string };

/** Copy one external image into the task's attachment store (atomic write). */
export async function importContextAttachment(
  tasks: TaskService,
  taskId: string,
  source: ImportSource,
): Promise<ImportedAttachment> {
  let bytes: Buffer;
  let name: string;
  let mimeType: string;

  if (source.kind === 'path') {
    const real = await fsp.realpath(source.path).catch(() => {
      throw new ProductFailure(
        productError('ATTACHMENT_MISSING', {
          userMessage: 'The dropped file could not be read from disk.',
        }),
      );
    });
    const stat = await fsp.stat(real);
    if (!stat.isFile()) {
      throw new ProductFailure(
        productError('ATTACHMENT_UNSUPPORTED', {
          userMessage: 'Only files can be attached from outside the project.',
        }),
      );
    }
    const mime = imageMimeForPath(real);
    if (!mime) {
      throw new ProductFailure(
        productError('ATTACHMENT_UNSUPPORTED', {
          userMessage:
            'Files outside the project are supported as images only (PNG, JPEG, GIF, WebP, BMP) — move other files into the project first.',
        }),
      );
    }
    if (stat.size > MAX_ATTACHMENT_IMAGE_BYTES) {
      throw new ProductFailure(
        productError('ATTACHMENT_TOO_LARGE', {
          userMessage: 'Attached images are limited to 10 MB.',
        }),
      );
    }
    bytes = await fsp.readFile(real);
    name = basename(real);
    mimeType = mime;
  } else {
    if (!(ATTACHMENT_IMAGE_MIMES as readonly string[]).includes(source.mimeType)) {
      throw new ProductFailure(
        productError('ATTACHMENT_UNSUPPORTED', {
          userMessage: 'Pasted content must be an image (PNG, JPEG, GIF, WebP, BMP).',
        }),
      );
    }
    bytes = Buffer.from(source.dataBase64, 'base64');
    if (bytes.length === 0) {
      throw new ProductFailure(
        productError('ATTACHMENT_BAD_IMAGE', {
          userMessage: 'The pasted image payload was empty.',
        }),
      );
    }
    if (bytes.length > MAX_ATTACHMENT_IMAGE_BYTES) {
      throw new ProductFailure(
        productError('ATTACHMENT_TOO_LARGE', {
          userMessage: 'Attached images are limited to 10 MB.',
        }),
      );
    }
    name = source.name;
    mimeType = source.mimeType;
  }

  // Decode-validates the pixels AND produces the chip thumbnail in one pass.
  const thumbDataUrl = thumbnailDataUrl(bytes);

  const attachmentId = randomUUID();
  const dir = tasks.attachmentsDir(taskId);
  await fsp.mkdir(dir, { recursive: true });
  const absPath = join(dir, attachmentFileName(attachmentId, mimeType));
  const tmp = `${absPath}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, bytes);
  await fsp.rename(tmp, absPath);

  return { attachmentId, name, mimeType, sizeBytes: bytes.length, thumbDataUrl };
}

/** Resolve image refs to prompt bytes: attachment store or in-project path. */
export async function resolveFileRefImages(
  tasks: TaskService,
  taskId: string,
  refs: readonly FileContextRefDto[],
): Promise<PromptImage[]> {
  const images: PromptImage[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'image') continue;
    if (ref.attachmentId) {
      if (!/^[0-9a-f-]{8,64}$/i.test(ref.attachmentId)) {
        throw new ProductFailure(
          productError('ATTACHMENT_MISSING', { userMessage: 'Malformed attachment reference.' }),
        );
      }
      const dir = tasks.attachmentsDir(taskId);
      const entries = await fsp.readdir(dir).catch(() => [] as string[]);
      const fileName = entries.find((entry) => entry.startsWith(`ctx-${ref.attachmentId}.`));
      if (!fileName) {
        throw new ProductFailure(
          productError('ATTACHMENT_MISSING', {
            userMessage: `The attached image “${ref.name}” is no longer available — remove it and attach again.`,
          }),
        );
      }
      const bytes = await fsp.readFile(join(dir, fileName));
      images.push({
        data: bytes.toString('base64'),
        mimeType: imageMimeForPath(fileName) ?? 'image/png',
      });
      continue;
    }
    if (ref.path) {
      const task = tasks.getTask(taskId);
      const root = task.worktree?.path ?? task.projectPath;
      const rootReal = await fsp.realpath(root);
      const candidate = resolve(rootReal, ref.path);
      const real = await fsp.realpath(candidate).catch(() => {
        throw new ProductFailure(
          productError('ATTACHMENT_MISSING', {
            userMessage: `“${ref.name}” no longer exists in the project.`,
          }),
        );
      });
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        throw new ProductFailure(
          productError('ATTACHMENT_OUTSIDE_PROJECT', {
            userMessage: 'An image reference escaped the project root and was rejected.',
          }),
        );
      }
      const mime = imageMimeForPath(real);
      if (!mime) {
        throw new ProductFailure(
          productError('ATTACHMENT_UNSUPPORTED', {
            userMessage: `“${ref.name}” is not a supported image format.`,
          }),
        );
      }
      const stat = await fsp.stat(real);
      if (stat.size > MAX_ATTACHMENT_IMAGE_BYTES) {
        throw new ProductFailure(
          productError('ATTACHMENT_TOO_LARGE', {
            userMessage: `“${ref.name}” exceeds the 10 MB image limit.`,
          }),
        );
      }
      const bytes = await fsp.readFile(real);
      images.push({ data: bytes.toString('base64'), mimeType: mime });
    }
  }
  return images;
}

export function registerContextAttachmentHandlers(tasks: TaskService, logger: Logger): void {
  registerHandlers(
    {
      'task.attachments.import': async ({ taskId, source }) => {
        const imported = await importContextAttachment(tasks, taskId, source);
        logger.info('context attachment imported', {
          taskId,
          attachmentId: imported.attachmentId,
          sizeBytes: imported.sizeBytes,
          mimeType: imported.mimeType,
        });
        return imported;
      },
    },
    logger,
  );
}
