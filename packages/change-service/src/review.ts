import { createHash } from 'node:crypto';
import { formatPatch, parsePatch, reversePatch, type StructuredPatch } from 'diff';

/**
 * Hunk-level review model (CHG-007/008). Hunks are keyed by their content so a
 * key remains valid across re-renders even when earlier rejections shift line
 * numbers; a decision made against a stale key simply fails closed.
 */
export interface ReviewHunk {
  key: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Raw unified-diff lines including their ' ', '+', '-' prefixes. */
  lines: string[];
}

export function parseHunks(diffText: string | null | undefined): ReviewHunk[] {
  if (!diffText || diffText.trim().length === 0) return [];
  let files;
  try {
    files = parsePatch(diffText);
  } catch {
    return [];
  }
  const hunks: ReviewHunk[] = [];
  const seen = new Map<string, number>();
  for (const file of files) {
    for (const hunk of file.hunks) {
      let key = createHash('sha256').update(hunk.lines.join('\n')).digest('hex').slice(0, 16);
      // Identical hunks at different positions get a stable ordinal suffix.
      const dup = seen.get(key) ?? 0;
      seen.set(key, dup + 1);
      if (dup > 0) key = `${key}#${dup}`;
      hunks.push({
        key,
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: [...hunk.lines],
      });
    }
  }
  return hunks;
}

/** A standalone unified patch that undoes exactly this hunk against the current content. */
export function reverseHunkPatchText(path: string, hunk: ReviewHunk): string {
  const patch: StructuredPatch = {
    oldFileName: path,
    newFileName: path,
    oldHeader: '',
    newHeader: '',
    hunks: [
      {
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: [...hunk.lines],
      },
    ],
  };
  return formatPatch(reversePatch(patch));
}
