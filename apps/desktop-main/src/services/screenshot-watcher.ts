import { execFile } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { nativeImage } from 'electron';
import { errorMessage, type Logger } from '@pi-ide/foundation';
import {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_THUMB_CHARS,
  SCREENSHOT_RECENT_LIMIT,
  type ScreenshotCaptureDto,
} from '@pi-ide/ipc-contracts';

const execFileAsync = promisify(execFile);

/**
 * ADR-0036 — screenshot quick card, main-process half. Watches the OS
 * screenshot directory (macOS `defaults read com.apple.screencapture
 * location`, fallback ~/Desktop) and announces every fresh screenshot to the
 * renderer. Zero side effects on the watched files: they are never moved,
 * renamed or modified. The set of announced paths doubles as the ONLY
 * filesystem surface `screenshot.read` / `screenshot.saveToAssets` may touch.
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
/** Announced-path allowlist cap (FIFO eviction). */
const SEEN_LIMIT = 64;
/** A file is "settled" once two stats this far apart agree on its size. */
const DEFAULT_SETTLE_MS = 200;
const MAX_SETTLE_ATTEMPTS = 25;
/** Ignore files born before the watcher (minus clock-skew slack). */
const FRESHNESS_SLACK_MS = 5_000;
const THUMB_WIDTHS = [360, 240, 160];

/**
 * Locale-typical OS screenshot basenames. This is the fast path — the mdls
 * metadata probe (locale-independent, Spotlight-derived) covers the rest.
 */
export function looksLikeScreenshotName(name: string): boolean {
  return /^(Screenshot|Screen Shot|CleanShot|截屏|截图|スクリーンショット|스크린샷)/iu.test(name);
}

/** The screenshot directory macOS actually writes into. */
export async function resolveScreenshotDirectory(): Promise<string> {
  const fallback = join(homedir(), 'Desktop');
  if (process.platform !== 'darwin') return fallback;
  try {
    const { stdout } = await execFileAsync(
      'defaults',
      ['read', 'com.apple.screencapture', 'location'],
      { timeout: 3_000 },
    );
    const location = stdout.trim();
    if (!location) return fallback;
    const expanded = location.startsWith('~') ? join(homedir(), location.slice(1)) : location;
    const stat = await fsp.stat(expanded);
    return stat.isDirectory() ? expanded : fallback;
  } catch {
    return fallback;
  }
}

/** Spotlight's own verdict; false on any failure (name pattern is the backstop). */
async function mdlsSaysScreenshot(path: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const { stdout } = await execFileAsync(
      'mdls',
      ['-name', 'kMDItemIsScreenCapture', '-raw', path],
      { timeout: 3_000 },
    );
    return stdout.trim() === '1';
  } catch {
    return false;
  }
}

async function defaultIsScreenshot(path: string): Promise<boolean> {
  if (looksLikeScreenshotName(basename(path))) return true;
  if (await mdlsSaysScreenshot(path)) return true;
  // Spotlight indexes freshly written files with a small lag — one late retry.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  return mdlsSaysScreenshot(path);
}

function defaultThumbnail(path: string): string {
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return '';
  for (const width of THUMB_WIDTHS) {
    const scaled = image.getSize().width > width ? image.resize({ width }) : image;
    const dataUrl = `data:image/jpeg;base64,${scaled.toJPEG(75).toString('base64')}`;
    if (dataUrl.length <= MAX_SCREENSHOT_THUMB_CHARS) return dataUrl;
  }
  return '';
}

export interface ScreenshotWatcherOptions {
  logger: Logger;
  broadcast: (capture: ScreenshotCaptureDto) => void;
  /** Fixed directory (env override / tests); resolved from the OS when null. */
  dir?: string | null;
  /** Screenshot-ness probe override. The env-override wiring passes an
   * always-true probe so tests and non-mac hosts stay deterministic. */
  isScreenshot?: (path: string) => Promise<boolean>;
  thumbnail?: (path: string) => string;
  settleMs?: number;
}

export class ScreenshotWatcher {
  private watcher: FSWatcher | null = null;
  private disposed = false;
  private readonly startedAtMs = Date.now();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly announced: string[] = [];
  private readonly announcedSet = new Set<string>();
  private readonly recentCaptures: ScreenshotCaptureDto[] = [];
  /** In-flight settle state per path. */
  private readonly pending = new Map<string, { lastSize: number; attempts: number }>();
  private readonly settleMs: number;

  constructor(private readonly options: ScreenshotWatcherOptions) {
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  }

  /** Resolves the directory and begins watching. Failure degrades to "feature
   * off" with a log line — never a startup error. */
  async start(): Promise<void> {
    const dir = this.options.dir ?? (await resolveScreenshotDirectory());
    if (this.disposed) return;
    try {
      this.watcher = watch(dir, (_eventType, fileName) => {
        if (typeof fileName === 'string' && fileName) this.consider(join(dir, fileName));
      });
      this.watcher.on('error', (error) => {
        this.options.logger.warn('screenshot watcher errored', { error: errorMessage(error) });
      });
      this.options.logger.info('screenshot watcher started', { dir });
    } catch (error) {
      this.options.logger.warn('screenshot watcher unavailable', {
        dir,
        error: errorMessage(error),
      });
    }
  }

  /** True only for paths this watcher announced — the read/save allowlist. */
  seen(path: string): boolean {
    return this.announcedSet.has(path);
  }

  recent(): ScreenshotCaptureDto[] {
    return [...this.recentCaptures];
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    this.watcher = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  private consider(path: string): void {
    const name = basename(path);
    if (name.startsWith('.')) return;
    if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) return;
    if (this.announcedSet.has(path)) return;
    if (this.pending.has(path)) return; // settle probe already scheduled
    this.pending.set(path, { lastSize: -1, attempts: 0 });
    this.scheduleSettleProbe(path);
  }

  private scheduleSettleProbe(path: string): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(path);
      void this.probe(path);
    }, this.settleMs);
    this.timers.set(path, timer);
  }

  private async probe(path: string): Promise<void> {
    if (this.disposed) return;
    const state = this.pending.get(path);
    if (!state) return;
    const stat = await fsp.stat(path).catch(() => null);
    if (!stat || !stat.isFile()) {
      this.pending.delete(path);
      return;
    }
    const bornMs = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
    if (bornMs < this.startedAtMs - FRESHNESS_SLACK_MS) {
      this.pending.delete(path); // pre-existing file touched again — not a fresh capture
      return;
    }
    if (stat.size === 0 || stat.size !== state.lastSize) {
      state.lastSize = stat.size;
      state.attempts += 1;
      if (state.attempts >= MAX_SETTLE_ATTEMPTS) this.pending.delete(path);
      else this.scheduleSettleProbe(path);
      return;
    }
    this.pending.delete(path);
    if (stat.size > MAX_SCREENSHOT_BYTES) {
      this.options.logger.info('screenshot skipped (too large)', { path, sizeBytes: stat.size });
      return;
    }
    const isScreenshot = this.options.isScreenshot ?? defaultIsScreenshot;
    if (!(await isScreenshot(path))) return;
    if (this.disposed || this.announcedSet.has(path)) return;

    let thumbDataUrl = '';
    try {
      thumbDataUrl = (this.options.thumbnail ?? defaultThumbnail)(path);
    } catch (error) {
      this.options.logger.warn('screenshot thumbnail failed', { error: errorMessage(error) });
    }
    const capture: ScreenshotCaptureDto = {
      path,
      name: basename(path),
      sizeBytes: stat.size,
      capturedAtMs: Math.round(bornMs),
      thumbDataUrl,
    };
    this.remember(capture);
    this.options.logger.info('screenshot captured', { path, sizeBytes: stat.size });
    this.options.broadcast(capture);
  }

  private remember(capture: ScreenshotCaptureDto): void {
    this.announcedSet.add(capture.path);
    this.announced.push(capture.path);
    while (this.announced.length > SEEN_LIMIT) {
      const evicted = this.announced.shift();
      if (evicted) this.announcedSet.delete(evicted);
    }
    this.recentCaptures.push(capture);
    while (this.recentCaptures.length > SCREENSHOT_RECENT_LIMIT) this.recentCaptures.shift();
  }
}
