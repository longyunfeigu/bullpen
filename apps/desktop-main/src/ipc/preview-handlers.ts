import { nativeImage, shell, webContents } from 'electron';
import { productError, ProductFailure, type Logger } from '@pi-ide/foundation';
import type { PreviewAttachmentDto } from '@pi-ide/ipc-contracts';
import { registerHandlers } from './router.js';
import type { PreviewFeedbackMeta, TaskService } from '../services/task-service.js';
import { devCommandForRoot, isWebishRoot, PreviewService } from '../services/preview-service.js';

const THUMB_WIDTH = 320;
const PNG_MAGIC = 0x89504e47;

/**
 * Preview gate (ADR-0022): port detection scoped to the task's own tree, a
 * compositor screenshot channel for marquee feedback, loopback-only "open in
 * browser", and the stored PR draft. Detection is read-only; nothing here ever
 * starts a server or runs a git command.
 */

/** Decode + validate a marquee-feedback attachment, persist the PNG under the
 * task's attachment dir, and build the timeline meta (with an inline thumbnail
 * so the Room renders it without a new read channel). */
export async function processPreviewAttachment(
  tasks: TaskService,
  taskId: string,
  preview: PreviewAttachmentDto,
): Promise<{ meta: PreviewFeedbackMeta; imageData: string }> {
  const bytes = Buffer.from(preview.dataBase64, 'base64');
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== PNG_MAGIC) {
    throw new ProductFailure(
      productError('PREVIEW_BAD_PAYLOAD', {
        userMessage: 'The preview screenshot payload is not a PNG.',
      }),
    );
  }
  const pngPath = await tasks.savePreviewShot(taskId, bytes);
  const image = nativeImage.createFromBuffer(bytes);
  const size = image.getSize();
  const thumb = size.width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH }) : image;
  return {
    meta: {
      pngPath,
      pageUrl: preview.pageUrl,
      rect: preview.rect,
      thumbDataUrl: thumb.toDataURL(),
      ...(preview.note ? { note: preview.note } : {}),
    },
    imageData: preview.dataBase64,
  };
}

export function registerPreviewHandlers(
  tasks: TaskService,
  preview: PreviewService,
  logger: Logger,
): void {
  registerHandlers(
    {
      'task.previewPorts': async ({ taskId }) => {
        const task = tasks.getTask(taskId);
        const root = task.worktree?.path ?? task.projectPath;
        const [ports, webish, devCommand] = await Promise.all([
          preview.detectPorts(root),
          isWebishRoot(root),
          devCommandForRoot(root),
        ]);
        return {
          root,
          webish,
          devCommand,
          ports: ports.map((p) => ({ ...p, url: `http://localhost:${p.port}/` })),
        };
      },
      'task.capturePreview': async ({ taskId, rect }, meta) => {
        tasks.getTask(taskId); // existence check — capture is task-scoped UI
        const contents = webContents.fromId(meta.senderId);
        if (!contents) {
          throw new ProductFailure(
            productError('PREVIEW_NO_SENDER', {
              userMessage: 'The requesting window no longer exists.',
            }),
          );
        }
        const image = await contents.capturePage({
          x: Math.max(0, Math.round(rect.x)),
          y: Math.max(0, Math.round(rect.y)),
          width: Math.min(8000, Math.max(1, Math.round(rect.width))),
          height: Math.min(8000, Math.max(1, Math.round(rect.height))),
        });
        const size = image.getSize();
        if (size.width === 0 || size.height === 0) {
          throw new ProductFailure(
            productError('PREVIEW_CAPTURE_EMPTY', {
              userMessage: 'Could not capture the preview region.',
              retryable: true,
            }),
          );
        }
        return {
          dataBase64: image.toPNG().toString('base64'),
          width: size.width,
          height: size.height,
        };
      },
      'task.previewOpenExternal': async ({ taskId, port, path }) => {
        const task = tasks.getTask(taskId);
        const root = task.worktree?.path ?? task.projectPath;
        // Loopback-only, and only a port currently attributed to this task's
        // tree — the general https allowlist (§12.3) is deliberately untouched.
        const ports = await preview.detectPorts(root);
        if (!ports.some((p) => p.port === port)) {
          throw new ProductFailure(
            productError('PREVIEW_PORT_UNKNOWN', {
              userMessage:
                'That port is not currently served from this task’s tree — refresh the preview and retry.',
              retryable: true,
            }),
          );
        }
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        if (cleanPath.includes('..') || /[\s\\]/.test(cleanPath) || cleanPath.startsWith('//')) {
          throw new ProductFailure(
            productError('PREVIEW_BAD_PATH', { userMessage: 'That preview path is not valid.' }),
          );
        }
        const url = `http://localhost:${port}${cleanPath}`;
        logger.info('preview open external', { taskId, url });
        await shell.openExternal(url);
        return { opened: true };
      },
      'task.prDraft': async ({ taskId }) => ({ draft: tasks.prDraftFor(taskId) }),
    },
    logger,
  );
}
