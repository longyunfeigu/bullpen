import { mkdtempSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotCaptureDto } from '@pi-ide/ipc-contracts';

/* Electron is unavailable under vitest — the default thumbnailer is bypassed
 * via the thumbnail option, but the module import still touches electron. */
vi.mock('electron', () => ({
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  ipcMain: { handle: vi.fn() },
}));

import { looksLikeScreenshotName, ScreenshotWatcher } from './screenshot-watcher.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logger,
} as never;

let dir = '';
let watcher: ScreenshotWatcher | null = null;
let captures: ScreenshotCaptureDto[] = [];

function makeWatcher(overrides: Partial<ConstructorParameters<typeof ScreenshotWatcher>[0]> = {}) {
  watcher = new ScreenshotWatcher({
    logger,
    dir,
    broadcast: (capture) => captures.push(capture),
    isScreenshot: async () => true,
    thumbnail: () => 'data:image/jpeg;base64,dGh1bWI=',
    settleMs: 20,
    ...overrides,
  });
  return watcher;
}

/** macOS fs.watch may drop events fired before its FSEvents stream spins up —
 * re-touch the file until the watcher reacts, then wait for the condition. */
async function waitForCapture(path: string, predicate: () => boolean): Promise<void> {
  const start = Date.now();
  let lastNudge = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 15_000) throw new Error('capture never announced');
    if (Date.now() - lastNudge > 400) {
      lastNudge = Date.now();
      await fsp.utimes(path, new Date(), new Date()).catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'charter-shots-'));
  captures = [];
});

afterEach(() => {
  watcher?.dispose();
  watcher = null;
});

describe('looksLikeScreenshotName', () => {
  it('recognizes locale-typical screenshot prefixes', () => {
    expect(looksLikeScreenshotName('Screenshot 2026-07-20 at 15.42.31.png')).toBe(true);
    expect(looksLikeScreenshotName('Screen Shot 2021-01-01 at 9.00.00 AM.png')).toBe(true);
    expect(looksLikeScreenshotName('截屏2026-07-20 15.42.31.png')).toBe(true);
    expect(looksLikeScreenshotName('截图 2026-07-20.png')).toBe(true);
    expect(looksLikeScreenshotName('holiday-photo.png')).toBe(false);
  });
});

describe('ScreenshotWatcher', () => {
  it('announces a fresh image once its size settles', async () => {
    await makeWatcher().start();
    const path = join(dir, 'Screenshot Test.png');
    writeFileSync(path, Buffer.from('png-bytes-here'));
    await waitForCapture(path, () => captures.length === 1);
    expect(captures[0]!.name).toBe('Screenshot Test.png');
    expect(captures[0]!.sizeBytes).toBe(14);
    expect(captures[0]!.thumbDataUrl).toContain('data:image/jpeg');
    expect(watcher!.seen(captures[0]!.path)).toBe(true);
    expect(watcher!.recent()).toHaveLength(1);
  });

  it('announces each file once even when watch events repeat', async () => {
    await makeWatcher().start();
    const path = join(dir, 'Screenshot Twice.png');
    writeFileSync(path, Buffer.from('bytes'));
    await waitForCapture(path, () => captures.length === 1);
    // Re-touch the already-announced file: no second card.
    await fsp.utimes(path, new Date(), new Date());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(captures).toHaveLength(1);
  });

  it('ignores dotfiles and non-image extensions', async () => {
    await makeWatcher().start();
    writeFileSync(join(dir, '.Screenshot Hidden.png'), Buffer.from('bytes'));
    writeFileSync(join(dir, 'notes.txt'), Buffer.from('bytes'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(captures).toHaveLength(0);
  });

  it('drops files the screenshot probe rejects', async () => {
    await makeWatcher({ isScreenshot: async () => false }).start();
    writeFileSync(join(dir, 'holiday-photo.png'), Buffer.from('bytes'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(captures).toHaveLength(0);
    expect(watcher!.seen(join(dir, 'holiday-photo.png'))).toBe(false);
  });

  it('stops announcing after dispose', async () => {
    await makeWatcher().start();
    watcher!.dispose();
    writeFileSync(join(dir, 'Screenshot Late.png'), Buffer.from('bytes'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(captures).toHaveLength(0);
  });

  it('keeps waiting while the file is still growing, then announces the final size', async () => {
    await makeWatcher({ settleMs: 60 }).start();
    const path = join(dir, 'Screenshot Growing.png');
    writeFileSync(path, Buffer.from('12345'));
    // Grow it once while the settle probe is polling.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fsp.appendFile(path, Buffer.from('6789'));
    await waitForCapture(path, () => captures.length === 1);
    expect(captures[0]!.sizeBytes).toBe(9);
  });
});
