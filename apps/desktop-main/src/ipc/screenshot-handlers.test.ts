import { mkdtempSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductFailure } from '@pi-ide/foundation';

/* Electron is unavailable under vitest — stub what the imported modules touch. */
vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromBuffer: () => ({ isEmpty: () => true }),
  },
  ipcMain: { handle: vi.fn() },
}));

import { readSeenScreenshot, saveScreenshotToAssets } from './screenshot-handlers.js';
import type { ScreenshotWatcher } from '../services/screenshot-watcher.js';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
]);

let shotsDir = '';
let projectDir = '';

function watcherStub(seenPaths: string[]): ScreenshotWatcher {
  const seen = new Set(seenPaths);
  return {
    seen: (path: string) => seen.has(path),
    recent: () => [],
  } as unknown as ScreenshotWatcher;
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof ProductFailure ? e.error.code : 'NOT_PRODUCT_FAILURE';
  }
}

beforeEach(() => {
  shotsDir = mkdtempSync(join(tmpdir(), 'charter-shots-'));
  projectDir = mkdtempSync(join(tmpdir(), 'charter-project-'));
});

describe('readSeenScreenshot', () => {
  it('returns bytes + mime for a watcher-seen screenshot', async () => {
    const path = join(shotsDir, 'Screenshot One.png');
    writeFileSync(path, PNG_BYTES);
    const result = await readSeenScreenshot(watcherStub([path]), path);
    expect(result.mime).toBe('image/png');
    expect(result.sizeBytes).toBe(PNG_BYTES.length);
    expect(Buffer.from(result.dataBase64, 'base64').equals(PNG_BYTES)).toBe(true);
  });

  it('rejects paths the watcher never announced — no general read channel', async () => {
    const path = join(shotsDir, 'sneaky.png');
    writeFileSync(path, PNG_BYTES);
    expect(await failureCode(readSeenScreenshot(watcherStub([]), path))).toBe('SCREENSHOT_UNKNOWN');
    // /etc/passwd style probing is identical: not seen → rejected before any fs.
    expect(await failureCode(readSeenScreenshot(watcherStub([]), '/etc/hosts'))).toBe(
      'SCREENSHOT_UNKNOWN',
    );
  });

  it('reports a moved/deleted screenshot as missing', async () => {
    const path = join(shotsDir, 'Screenshot Gone.png');
    expect(await failureCode(readSeenScreenshot(watcherStub([path]), path))).toBe(
      'SCREENSHOT_MISSING',
    );
  });
});

describe('saveScreenshotToAssets', () => {
  it('copies a seen screenshot into assets/screenshots with its original name', async () => {
    const path = join(shotsDir, 'Screenshot 2026-07-20 at 15.42.31.png');
    writeFileSync(path, PNG_BYTES);
    const saved = await saveScreenshotToAssets(watcherStub([path]), projectDir, {
      kind: 'path',
      path,
    });
    expect(saved.relPath).toBe('assets/screenshots/Screenshot 2026-07-20 at 15.42.31.png');
    const stored = await fsp.readFile(join(projectDir, saved.relPath));
    expect(stored.equals(PNG_BYTES)).toBe(true);
    // The original file is untouched.
    expect((await fsp.stat(path)).size).toBe(PNG_BYTES.length);
  });

  it('never overwrites: same name lands with -2 / -3 suffixes', async () => {
    const path = join(shotsDir, 'Screenshot Dup.png');
    writeFileSync(path, PNG_BYTES);
    const watcher = watcherStub([path]);
    const first = await saveScreenshotToAssets(watcher, projectDir, { kind: 'path', path });
    const second = await saveScreenshotToAssets(watcher, projectDir, { kind: 'path', path });
    const third = await saveScreenshotToAssets(watcher, projectDir, { kind: 'path', path });
    expect(first.name).toBe('Screenshot Dup.png');
    expect(second.name).toBe('Screenshot Dup-2.png');
    expect(third.name).toBe('Screenshot Dup-3.png');
  });

  it('rejects unseen path sources', async () => {
    const path = join(shotsDir, 'unseen.png');
    writeFileSync(path, PNG_BYTES);
    expect(
      await failureCode(
        saveScreenshotToAssets(watcherStub([]), projectDir, { kind: 'path', path }),
      ),
    ).toBe('SCREENSHOT_UNKNOWN');
  });

  it('stores annotated PNG bytes and forces the .png extension', async () => {
    const saved = await saveScreenshotToAssets(watcherStub([]), projectDir, {
      kind: 'bytes',
      dataBase64: PNG_BYTES.toString('base64'),
      name: 'Screenshot Annotated.jpg',
    });
    expect(saved.name).toBe('Screenshot Annotated.png');
    const stored = await fsp.readFile(join(projectDir, saved.relPath));
    expect(stored.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects bytes sources without the PNG magic', async () => {
    expect(
      await failureCode(
        saveScreenshotToAssets(watcherStub([]), projectDir, {
          kind: 'bytes',
          dataBase64: Buffer.from('GIF89a-definitely-not-png').toString('base64'),
          name: 'evil.png',
        }),
      ),
    ).toBe('SCREENSHOT_BAD_PAYLOAD');
  });

  it('sanitizes path separators out of requested names', async () => {
    const saved = await saveScreenshotToAssets(watcherStub([]), projectDir, {
      kind: 'bytes',
      dataBase64: PNG_BYTES.toString('base64'),
      name: '../../escape.png',
    });
    expect(saved.relPath.startsWith('assets/screenshots/')).toBe(true);
    expect(saved.name).toBe('escape.png');
    await expect(fsp.stat(join(projectDir, saved.relPath))).resolves.toBeTruthy();
  });
});
