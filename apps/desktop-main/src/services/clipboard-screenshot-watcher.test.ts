import { mkdtempSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotCaptureDto } from '@pi-ide/ipc-contracts';
import { MAX_SCREENSHOT_BYTES } from '@pi-ide/ipc-contracts';

/* Electron is unavailable under vitest — the default clipboard reader and
 * thumbnailer are bypassed via options, but the module imports still touch
 * electron (directly and via screenshot-watcher). */
vi.mock('electron', () => ({
  clipboard: { availableFormats: () => [], readImage: () => ({ isEmpty: () => true }) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  ipcMain: { handle: vi.fn() },
}));

import {
  ClipboardScreenshotWatcher,
  isBareImageClipboard,
  type ClipboardRead,
} from './clipboard-screenshot-watcher.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logger,
} as never;

let dir = '';
let watcher: ClipboardScreenshotWatcher | null = null;
let captures: ScreenshotCaptureDto[] = [];
let clipboardNow: ClipboardRead = { kind: 'no-image' };

function imageRead(fingerprint: string, bytes = Buffer.from(`png:${fingerprint}`)): ClipboardRead {
  return { kind: 'image', fingerprint, pngBytes: () => bytes };
}

function makeWatcher(
  overrides: Partial<ConstructorParameters<typeof ClipboardScreenshotWatcher>[0]> = {},
) {
  watcher = new ClipboardScreenshotWatcher({
    logger,
    captureDir: dir,
    announce: (capture) => captures.push(capture),
    read: () => clipboardNow,
    thumbnail: () => 'data:image/jpeg;base64,dGh1bWI=',
    pollMs: 10,
    ...overrides,
  });
  return watcher;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5_000) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Enough real time for several 10ms polls to have fired. */
async function settlePolls(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'charter-clip-'));
  captures = [];
  clipboardNow = { kind: 'no-image' };
});

afterEach(() => {
  watcher?.dispose();
  watcher = null;
});

describe('isBareImageClipboard', () => {
  it('accepts image-only pasteboards and rejects text-bearing ones', () => {
    expect(isBareImageClipboard(['image/png'])).toBe(true);
    expect(isBareImageClipboard(['image/png', 'image/tiff'])).toBe(true);
    expect(isBareImageClipboard([])).toBe(false);
    expect(isBareImageClipboard(['text/plain'])).toBe(false);
    // Browser image copy carries the <img> markup alongside the bitmap.
    expect(isBareImageClipboard(['image/png', 'text/html'])).toBe(false);
    // Finder file copy carries file URLs.
    expect(isBareImageClipboard(['image/png', 'text/uri-list'])).toBe(false);
  });
});

describe('ClipboardScreenshotWatcher', () => {
  it('announces a fresh clipboard image as an origin-tagged PNG on disk', async () => {
    await makeWatcher().start();
    await settlePolls();
    clipboardNow = imageRead('fp-1', Buffer.from('png-bytes'));
    await waitFor(() => captures.length === 1, 'first announce');
    const capture = captures[0]!;
    expect(capture.origin).toBe('clipboard');
    expect(capture.name).toMatch(/^Clipboard .*\.png$/u);
    expect(capture.sizeBytes).toBe(9);
    expect(capture.thumbDataUrl).toContain('data:image/jpeg');
    await expect(fsp.readFile(capture.path, 'utf8')).resolves.toBe('png-bytes');
  });

  it('never announces the image that predates the watcher', async () => {
    clipboardNow = imageRead('pre-existing');
    await makeWatcher().start();
    await settlePolls();
    expect(captures).toHaveLength(0);
    // …but a NEW image after the baseline is announced.
    clipboardNow = imageRead('fresh');
    await waitFor(() => captures.length === 1, 'post-baseline announce');
  });

  it('announces an unchanged image once, even across many polls', async () => {
    await makeWatcher().start();
    await settlePolls(); // baseline poll sees the empty clipboard first
    clipboardNow = imageRead('steady');
    await waitFor(() => captures.length === 1, 'single announce');
    await settlePolls();
    expect(captures).toHaveLength(1);
  });

  it('suffixes -2 when two captures land in the same second', async () => {
    await makeWatcher({ now: () => 1_700_000_000_000 }).start();
    await settlePolls();
    clipboardNow = imageRead('a');
    await waitFor(() => captures.length === 1, 'first of pair');
    clipboardNow = imageRead('b');
    await waitFor(() => captures.length === 2, 'second of pair');
    expect(captures[1]!.name).toBe(captures[0]!.name.replace(/\.png$/u, '-2.png'));
  });

  it('keeps only the newest 16 capture files', async () => {
    await makeWatcher().start();
    await settlePolls();
    for (let i = 0; i < 18; i += 1) {
      clipboardNow = imageRead(`fp-${i}`);
      await waitFor(() => captures.length === i + 1, `announce ${i}`);
    }
    const files = (await fsp.readdir(dir)).filter((name) => name.endsWith('.png'));
    expect(files).toHaveLength(16);
    await expect(fsp.access(captures[0]!.path)).rejects.toThrow();
    await expect(fsp.access(captures[17]!.path)).resolves.toBeUndefined();
  });

  it('purges previous sessions’ captures on start, leaving other files alone', async () => {
    writeFileSync(join(dir, 'Clipboard 2026-01-01 at 09.00.00.png'), Buffer.from('old'));
    writeFileSync(join(dir, 'unrelated.txt'), Buffer.from('keep'));
    await makeWatcher().start();
    const names = await fsp.readdir(dir);
    expect(names).toContain('unrelated.txt');
    expect(names.some((name) => name.startsWith('Clipboard '))).toBe(false);
  });

  it('skips images beyond the shared size limit', async () => {
    await makeWatcher().start();
    await settlePolls();
    clipboardNow = imageRead('huge', Buffer.alloc(MAX_SCREENSHOT_BYTES + 1));
    await settlePolls();
    expect(captures).toHaveLength(0);
    expect((await fsp.readdir(dir)).filter((name) => name.endsWith('.png'))).toHaveLength(0);
  });

  it('stops announcing after dispose', async () => {
    await makeWatcher().start();
    await settlePolls();
    watcher!.dispose();
    clipboardNow = imageRead('late');
    await settlePolls();
    expect(captures).toHaveLength(0);
  });
});
