import { z } from 'zod';

/**
 * ADR-0036: screenshot quick card. The main-process watcher announces fresh
 * OS screenshots; the renderer card feeds them to the active session (managed
 * composer chip or external CLI @-reference), the annotator, or the project's
 * assets folder. The renderer never gains arbitrary filesystem reach: every
 * path-based request below is only honored for paths the watcher itself saw.
 */

/** Card thumbnails ride the event payload — JPEG data URL, hard-capped. */
export const MAX_SCREENSHOT_THUMB_CHARS = 160_000;
/** Full-size reads (annotator base image) share the preview limit ethos. */
export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
/** The watcher remembers this many recent captures for `screenshot.recent`. */
export const SCREENSHOT_RECENT_LIMIT = 5;
/** Project-relative folder `screenshot.saveToAssets` writes into. */
export const SCREENSHOT_ASSETS_DIR = 'assets/screenshots';

export const ScreenshotCaptureSchema = z
  .object({
    /** Absolute path of the screenshot file (never modified by Charter). */
    path: z.string().min(1).max(2000),
    /** Display basename ("Screenshot 2026-07-20 at 15.42.31.png"). */
    name: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
    capturedAtMs: z.number().int().nonnegative(),
    /** Small JPEG data URL for the card; empty when thumbnailing failed. */
    thumbDataUrl: z.string().max(MAX_SCREENSHOT_THUMB_CHARS),
    /** ADR-0039: where the capture came from. Absent = 'file' (v1 payloads). */
    origin: z.enum(['file', 'clipboard']).optional(),
  })
  .strict();

export type ScreenshotCaptureDto = z.infer<typeof ScreenshotCaptureSchema>;

/** Source for `screenshot.saveToAssets`: a watcher-seen file, or annotated
 * PNG bytes exported by the canvas (magic-checked in Main). */
export const ScreenshotAssetSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      kind: z.literal('bytes'),
      dataBase64: z
        .string()
        .min(8)
        .max(Math.ceil((MAX_SCREENSHOT_BYTES / 3) * 4) + 8),
      name: z.string().min(1).max(255),
    })
    .strict(),
]);

export type ScreenshotAssetSourceDto = z.infer<typeof ScreenshotAssetSourceSchema>;
