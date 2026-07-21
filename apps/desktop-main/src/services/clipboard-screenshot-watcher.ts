import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, join } from 'node:path';
import { clipboard } from 'electron';
import { errorMessage, type Logger } from '@pi-ide/foundation';
import { MAX_SCREENSHOT_BYTES, type ScreenshotCaptureDto } from '@pi-ide/ipc-contracts';
import { screenshotThumbnail } from './screenshot-watcher.js';

/**
 * ADR-0039 — clipboard image card. WeChat / Snipaste / ⌘⇧⌃4-style captures
 * never touch the disk, so the directory watcher (ADR-0036) is blind to them.
 * This watcher polls the clipboard metadata-first: `availableFormats()` (a
 * types query — no pasteboard *content* access, so no macOS 26 pasteboard
 * alert) decides whether the clipboard holds a BARE image; only then is the
 * image read and fingerprinted. A fresh fingerprint is written as a PNG into
 * a managed userData dir and announced through the ScreenshotWatcher funnel,
 * so it joins the same allowlist / card / feed pipeline as file captures.
 */

const DEFAULT_POLL_MS = 1_200;
/** Idle backoff cap — an unchanged image parked in the clipboard is re-read
 * at most this often, bounding the standing hash cost (and pasteboard reads). */
const MAX_POLL_MS = 5_000;
/** Managed-dir retention (FIFO, per session; stale files purged on start). */
const KEEP_CAPTURES = 16;
const CAPTURE_NAME_PATTERN = /^Clipboard .*\.png$/u;

/** Text-bearing pasteboards are copied *content* (browser images carry
 * text/html, Finder files carry text/uri-list, office snippets carry rtf) —
 * only a bare image smells like a capture tool's output. */
const TEXTUAL_FORMATS = new Set(['text/plain', 'text/html', 'text/rtf', 'text/uri-list']);

export function isBareImageClipboard(formats: readonly string[]): boolean {
  return (
    formats.some((format) => format.startsWith('image/')) &&
    !formats.some((format) => TEXTUAL_FORMATS.has(format))
  );
}

export type ClipboardRead =
  { kind: 'no-image' } | { kind: 'image'; fingerprint: string; pngBytes: () => Buffer };

function readSystemClipboard(): ClipboardRead {
  if (!isBareImageClipboard(clipboard.availableFormats())) return { kind: 'no-image' };
  const image = clipboard.readImage();
  if (image.isEmpty()) return { kind: 'no-image' };
  const { width, height } = image.getSize();
  // Fingerprint over the raw bitmap — no PNG encode until we actually announce.
  const digest = createHash('sha1').update(image.toBitmap()).digest('hex');
  return {
    kind: 'image',
    fingerprint: `${width}x${height}:${digest}`,
    pngBytes: () => image.toPNG(),
  };
}

function captureBasename(atMs: number): string {
  const at = new Date(atMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  return `Clipboard ${day} at ${time}`;
}

export interface ClipboardScreenshotWatcherOptions {
  logger: Logger;
  /** Managed directory the announced PNGs are written into (userData). */
  captureDir: string;
  /** ScreenshotWatcher.announce — the shared card/allowlist funnel. */
  announce: (capture: ScreenshotCaptureDto) => void;
  /** Injected for tests; defaults to the Electron clipboard. */
  read?: () => ClipboardRead;
  thumbnail?: (path: string) => string;
  pollMs?: number;
  now?: () => number;
}

export class ClipboardScreenshotWatcher {
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** First poll only records what was already there — never announces it. */
  private primed = false;
  private lastFingerprint: string | null = null;
  private currentPollMs: number;
  private readonly basePollMs: number;
  private readonly written: string[] = [];
  /** Names are never recycled within a session — an evicted capture's name
   * would still sit in the announce dedupe set and silently drop the card. */
  private readonly usedNames = new Set<string>();

  constructor(private readonly options: ClipboardScreenshotWatcherOptions) {
    this.basePollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.currentPollMs = this.basePollMs;
  }

  /** Prepares the managed dir (purging previous sessions' captures — their
   * allowlist died with the process) and begins polling. Failure degrades to
   * "feature off" with a log line — never a startup error. */
  async start(): Promise<void> {
    try {
      await fsp.mkdir(this.options.captureDir, { recursive: true });
      const stale = (await fsp.readdir(this.options.captureDir)).filter((name) =>
        CAPTURE_NAME_PATTERN.test(name),
      );
      await Promise.all(
        stale.map((name) => fsp.unlink(join(this.options.captureDir, name)).catch(() => undefined)),
      );
    } catch (error) {
      this.options.logger.warn('clipboard watcher unavailable', {
        dir: this.options.captureDir,
        error: errorMessage(error),
      });
      return;
    }
    if (this.disposed) return;
    this.options.logger.info('clipboard watcher started', { dir: this.options.captureDir });
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      void this.poll();
    }, this.currentPollMs);
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    try {
      const read = (this.options.read ?? readSystemClipboard)();
      if (read.kind !== 'image') {
        // Empty/textual clipboard: trivially-known baseline, reset backoff.
        this.primed = true;
        this.lastFingerprint = null;
        this.currentPollMs = this.basePollMs;
      } else if (!this.primed) {
        this.primed = true;
        this.lastFingerprint = read.fingerprint;
      } else if (read.fingerprint === this.lastFingerprint) {
        this.currentPollMs = Math.min(Math.round(this.currentPollMs * 1.6), MAX_POLL_MS);
      } else {
        this.lastFingerprint = read.fingerprint;
        this.currentPollMs = this.basePollMs;
        await this.announceImage(read.pngBytes);
      }
    } catch (error) {
      this.options.logger.warn('clipboard poll failed', { error: errorMessage(error) });
    }
    this.schedule();
  }

  private async announceImage(pngBytes: () => Buffer): Promise<void> {
    const bytes = pngBytes();
    if (bytes.length === 0) return;
    if (bytes.length > MAX_SCREENSHOT_BYTES) {
      this.options.logger.info('clipboard image skipped (too large)', {
        sizeBytes: bytes.length,
      });
      return;
    }
    const capturedAtMs = (this.options.now ?? Date.now)();
    const path = await this.writeCapture(bytes, capturedAtMs);
    if (!path || this.disposed) return;
    let thumbDataUrl = '';
    try {
      thumbDataUrl = (this.options.thumbnail ?? screenshotThumbnail)(path);
    } catch (error) {
      this.options.logger.warn('clipboard thumbnail failed', { error: errorMessage(error) });
    }
    this.options.announce({
      path,
      name: basename(path),
      sizeBytes: bytes.length,
      capturedAtMs,
      thumbDataUrl,
      origin: 'clipboard',
    });
  }

  private async writeCapture(bytes: Buffer, capturedAtMs: number): Promise<string | null> {
    const stem = captureBasename(capturedAtMs);
    try {
      for (let n = 1; n < 100; n += 1) {
        const name = n === 1 ? `${stem}.png` : `${stem}-${n}.png`;
        if (this.usedNames.has(name)) continue;
        const absPath = join(this.options.captureDir, name);
        const exists = await fsp.access(absPath).then(
          () => true,
          () => false,
        );
        if (exists) continue;
        this.usedNames.add(name);
        const tmp = `${absPath}.tmp-${process.pid}`;
        await fsp.writeFile(tmp, bytes);
        await fsp.rename(tmp, absPath);
        this.written.push(absPath);
        while (this.written.length > KEEP_CAPTURES) {
          const evicted = this.written.shift();
          if (evicted) await fsp.unlink(evicted).catch(() => undefined);
        }
        return absPath;
      }
      return null;
    } catch (error) {
      this.options.logger.warn('clipboard capture write failed', {
        error: errorMessage(error),
      });
      return null;
    }
  }
}
