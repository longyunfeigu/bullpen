// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// The module under test only needs monaco.Range for decoration assembly; the
// parser itself is pure. Stub the monaco setup so node tests never load the
// editor bundle.
vi.mock('../monaco-setup.js', () => ({
  monaco: { Range: class {} },
}));

const { parseGutterRanges } = await import('./gutter-diff.js');

function diffOf(hunks: string): string {
  return `--- a/x.ts\n+++ b/x.ts\n${hunks}`;
}

describe('parseGutterRanges (ADR-0013 gutter bars)', () => {
  it('pure addition', () => {
    const r = parseGutterRanges(diffOf('@@ -2,0 +3,2 @@\n+new line a\n+new line b\n'));
    expect(r.added).toEqual([[3, 4]]);
    expect(r.modified).toEqual([]);
    expect(r.deleted).toEqual([]);
  });

  it('pure deletion marks the boundary line', () => {
    const r = parseGutterRanges(diffOf('@@ -3,2 +2,0 @@\n-gone a\n-gone b\n'));
    expect(r.added).toEqual([]);
    expect(r.deleted).toEqual([2]);
  });

  it('replacement is modified (plus overflow added)', () => {
    const r = parseGutterRanges(
      diffOf('@@ -5,2 +5,3 @@\n-old 1\n-old 2\n+new 1\n+new 2\n+new 3\n'),
    );
    expect(r.modified).toEqual([[5, 6]]);
    expect(r.added).toEqual([[7, 7]]);
  });

  it('multiple hunks with context lines', () => {
    const r = parseGutterRanges(
      diffOf('@@ -1,3 +1,3 @@\n ctx\n-a\n+A\n ctx\n@@ -10,2 +10,3 @@\n ctx\n+tail\n ctx\n'),
    );
    expect(r.modified).toEqual([[2, 2]]);
    expect(r.added).toEqual([[11, 11]]);
  });

  it('empty diff yields nothing', () => {
    expect(parseGutterRanges('')).toEqual({ added: [], modified: [], deleted: [] });
  });
});
