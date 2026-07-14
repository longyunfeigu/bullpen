import { monaco } from '../monaco-setup.js';

/**
 * Editor gutter change bars (ADR-0013): added/modified/deleted markers vs the
 * git index, VS Code-style. Pure parsing here; the caller owns fetch/apply.
 */

export interface GutterRanges {
  added: Array<[number, number]>;
  modified: Array<[number, number]>;
  /** Line AFTER which content was deleted (marker sits on that line's top). */
  deleted: number[];
}

/** Parse a unified diff into modified-side line ranges. */
export function parseGutterRanges(diff: string): GutterRanges {
  const out: GutterRanges = { added: [], modified: [], deleted: [] };
  if (!diff.trim()) return out;
  const lines = diff.split('\n');
  let newLine = 0;
  let inHunk = false;
  let minus = 0;
  let plusStart = 0;
  let plus = 0;

  const flush = (): void => {
    if (minus === 0 && plus === 0) return;
    const overlap = Math.min(minus, plus);
    if (overlap > 0) out.modified.push([plusStart, plusStart + overlap - 1]);
    if (plus > overlap) out.added.push([plusStart + overlap, plusStart + plus - 1]);
    if (minus > overlap) out.deleted.push(Math.max(1, plus > 0 ? plusStart + plus : plusStart));
    minus = 0;
    plus = 0;
  };

  for (const line of lines) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flush();
      inHunk = true;
      newLine = parseInt(hunk[1]!, 10);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (plus === 0) plusStart = newLine;
      plus += 1;
      newLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      if (plus === 0 && minus === 0) plusStart = newLine;
      minus += 1;
    } else if (line.startsWith(' ') || line === '') {
      flush();
      newLine += 1;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
    } else {
      flush();
      inHunk = false;
    }
  }
  flush();
  return out;
}

export function toDecorations(ranges: GutterRanges): monaco.editor.IModelDeltaDecoration[] {
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];
  for (const [start, end] of ranges.added) {
    decorations.push({
      range: new monaco.Range(start, 1, end, 1),
      options: { isWholeLine: true, linesDecorationsClassName: 'gutter-added' },
    });
  }
  for (const [start, end] of ranges.modified) {
    decorations.push({
      range: new monaco.Range(start, 1, end, 1),
      options: { isWholeLine: true, linesDecorationsClassName: 'gutter-modified' },
    });
  }
  for (const line of ranges.deleted) {
    decorations.push({
      range: new monaco.Range(line, 1, line, 1),
      options: { linesDecorationsClassName: 'gutter-deleted' },
    });
  }
  return decorations;
}
