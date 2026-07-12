import { describe, expect, it } from 'vitest';
import { fuzzyScore, fuzzyFilter } from './fuzzy.js';

describe('fuzzy matching', () => {
  it('matches subsequences and prefers word starts and consecutive runs', () => {
    expect(fuzzyScore('tgl', 'Toggle Bottom Panel')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Toggle Bottom Panel')).toBeNull();
    const wordStart = fuzzyScore('tbp', 'Toggle Bottom Panel')!;
    const scattered = fuzzyScore('obt', 'Toggle Bottom Panel')!;
    expect(wordStart.score).toBeGreaterThan(scattered.score);
  });

  it('is case-insensitive and returns match positions for highlighting', () => {
    const m = fuzzyScore('READ', 'src/read-file.ts')!;
    expect(m).not.toBeNull();
    expect(m.positions.length).toBe(4);
  });

  it('filters and ranks a list with path basename bonus', () => {
    const items = ['src/components/Button.tsx', 'docs/button.md', 'src/button/index.ts'];
    const ranked = fuzzyFilter('button', items, (s) => s);
    expect(ranked.length).toBe(3);
    expect(ranked[0]!.item.endsWith('.md') || ranked[0]!.item.includes('Button.tsx')).toBe(true);
  });

  it('empty query matches everything with zero score', () => {
    const ranked = fuzzyFilter('', ['a', 'b'], (s) => s);
    expect(ranked).toHaveLength(2);
  });
});
