import { mkdtempSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_IMAGE_BYTES } from '@pi-ide/ipc-contracts';

/* Electron is unavailable under vitest — stub the pieces this module touches.
 * The stub treats a PNG-magic prefix as a decodable image. */
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (bytes: Buffer) => ({
      isEmpty: () => bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47,
      getSize: () => ({ width: 100, height: 100 }),
      resize: () => ({ toDataURL: () => 'data:image/png;base64,dGh1bWI=' }),
      toDataURL: () => 'data:image/png;base64,dGh1bWI=',
    }),
  },
  ipcMain: { handle: vi.fn() },
}));

import { importContextAttachment, resolveFileRefImages } from './context-attachment-handlers.js';
import type { TaskService } from '../services/task-service.js';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
]);

let attachDir = '';
let projectDir = '';

function tasksStub(): TaskService {
  return {
    getTask: () => ({ worktree: null, projectPath: projectDir }),
    attachmentsDir: () => attachDir,
  } as unknown as TaskService;
}

beforeEach(() => {
  attachDir = mkdtempSync(join(tmpdir(), 'charter-attach-'));
  projectDir = mkdtempSync(join(tmpdir(), 'charter-project-'));
});

describe('importContextAttachment', () => {
  it('imports pasted bytes, stores the file and returns chip metadata', async () => {
    const tasks = tasksStub();
    const imported = await importContextAttachment(tasks, 't1', {
      kind: 'bytes',
      dataBase64: PNG_BYTES.toString('base64'),
      name: 'shot.png',
      mimeType: 'image/png',
    });
    expect(imported.name).toBe('shot.png');
    expect(imported.mimeType).toBe('image/png');
    expect(imported.sizeBytes).toBe(PNG_BYTES.length);
    expect(imported.thumbDataUrl.startsWith('data:image/png')).toBe(true);
    const stored = await fsp.readFile(join(attachDir, `ctx-${imported.attachmentId}.png`));
    expect(stored.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects non-image paste payloads', async () => {
    await expect(
      importContextAttachment(tasksStub(), 't1', {
        kind: 'bytes',
        dataBase64: PNG_BYTES.toString('base64'),
        name: 'notes.txt',
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow(/image/i);
  });

  it('rejects oversized images', async () => {
    const huge = Buffer.alloc(MAX_ATTACHMENT_IMAGE_BYTES + 1, 1);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      importContextAttachment(tasksStub(), 't1', {
        kind: 'bytes',
        dataBase64: huge.toString('base64'),
        name: 'big.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/10 MB/);
  });

  it('rejects undecodable pixels', async () => {
    await expect(
      importContextAttachment(tasksStub(), 't1', {
        kind: 'bytes',
        dataBase64: Buffer.from('definitely-not-a-png').toString('base64'),
        name: 'broken.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/decoded/i);
  });

  it('imports a dropped external image path and rejects non-image paths', async () => {
    const external = join(projectDir, 'design.png');
    writeFileSync(external, PNG_BYTES);
    const imported = await importContextAttachment(tasksStub(), 't1', {
      kind: 'path',
      path: external,
    });
    expect(imported.name).toBe('design.png');

    const textFile = join(projectDir, 'notes.txt');
    writeFileSync(textFile, 'hello');
    await expect(
      importContextAttachment(tasksStub(), 't1', { kind: 'path', path: textFile }),
    ).rejects.toThrow(/images only/i);
    await expect(
      importContextAttachment(tasksStub(), 't1', {
        kind: 'path',
        path: join(projectDir, 'missing.png'),
      }),
    ).rejects.toThrow(/could not be read/i);
  });
});

describe('resolveFileRefImages', () => {
  it('resolves an imported attachment back to prompt bytes', async () => {
    const tasks = tasksStub();
    const imported = await importContextAttachment(tasks, 't1', {
      kind: 'bytes',
      dataBase64: PNG_BYTES.toString('base64'),
      name: 'shot.png',
      mimeType: 'image/png',
    });
    const images = await resolveFileRefImages(tasks, 't1', [
      { id: 'r1', kind: 'image', attachmentId: imported.attachmentId, name: 'shot.png' },
    ]);
    expect(images).toHaveLength(1);
    expect(images[0]!.mimeType).toBe('image/png');
    expect(Buffer.from(images[0]!.data, 'base64').equals(PNG_BYTES)).toBe(true);
  });

  it('resolves in-project image paths and skips non-image refs', async () => {
    await fsp.mkdir(join(projectDir, 'assets'), { recursive: true });
    writeFileSync(join(projectDir, 'assets', 'banner.png'), PNG_BYTES);
    const images = await resolveFileRefImages(tasksStub(), 't1', [
      { id: 'r1', kind: 'file', path: 'src/main.ts', name: 'main.ts' },
      { id: 'r2', kind: 'folder', path: 'src', name: 'src' },
      { id: 'r3', kind: 'image', path: 'assets/banner.png', name: 'banner.png' },
    ]);
    expect(images).toHaveLength(1);
    expect(Buffer.from(images[0]!.data, 'base64').equals(PNG_BYTES)).toBe(true);
  });

  it('rejects image paths escaping the project root', async () => {
    const outside = join(projectDir, '..', `escape-${Date.now()}.png`);
    writeFileSync(outside, PNG_BYTES);
    await expect(
      resolveFileRefImages(tasksStub(), 't1', [
        {
          id: 'r1',
          kind: 'image',
          path: `../${outside.split('/').pop()!}`,
          name: 'escape.png',
        },
      ]),
    ).rejects.toThrow(/escaped|rejected/i);
    await fsp.rm(outside, { force: true });
  });

  it('fails loudly when an attachment disappeared', async () => {
    await expect(
      resolveFileRefImages(tasksStub(), 't1', [
        { id: 'r1', kind: 'image', attachmentId: 'a1b2c3d4', name: 'gone.png' },
      ]),
    ).rejects.toThrow(/no longer available/i);
  });
});
