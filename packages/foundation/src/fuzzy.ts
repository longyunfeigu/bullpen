export interface FuzzyMatch {
  score: number;
  positions: number[];
}

/** Subsequence fuzzy matcher with bonuses for word starts, consecutive runs and basename hits. */
export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length > t.length) return null;

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  const lastSlash = t.lastIndexOf('/');

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;

    let charScore = 1;
    const prev = found > 0 ? t[found - 1]! : '';
    const isWordStart =
      found === 0 || prev === ' ' || prev === '/' || prev === '_' || prev === '-' || prev === '.';
    const isCamelStart =
      target[found]! >= 'A' && target[found]! <= 'Z' && prev >= 'a' && prev <= 'z';
    if (isWordStart) charScore += 8;
    if (isCamelStart) charScore += 6;
    if (found === lastMatch + 1) charScore += 5;
    if (found > lastSlash) charScore += 2; // basename bonus for paths

    score += charScore;
    positions.push(found);
    lastMatch = found;
    ti = found + 1;
  }

  // Shorter targets rank higher for equal matches.
  score += Math.max(0, 20 - Math.floor(t.length / 8));
  return { score, positions };
}

export interface RankedItem<T> {
  item: T;
  score: number;
  positions: number[];
}

export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  text: (item: T) => string,
  limit = 200,
): RankedItem<T>[] {
  const out: RankedItem<T>[] = [];
  for (const item of items) {
    const match = fuzzyScore(query, text(item));
    if (match) out.push({ item, score: match.score, positions: match.positions });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
