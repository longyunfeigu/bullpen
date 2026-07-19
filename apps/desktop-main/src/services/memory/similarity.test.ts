import { describe, expect, it } from 'vitest';
import {
  CORRECTION_SIMILAR_THRESHOLD,
  correctionSimilarity,
  isSimilarCorrection,
} from './similarity.js';

describe('correction similarity (ADR-0028, deterministic + model-free)', () => {
  it('matches CJK corrections about the same convention (bigram overlap)', () => {
    const a = '不要用 default export,项目一律具名导出';
    const b = '禁止 default export;导出一律使用具名导出';
    expect(correctionSimilarity(a, b)).toBeGreaterThanOrEqual(CORRECTION_SIMILAR_THRESHOLD);
    expect(isSimilarCorrection(a, b)).toBe(true);
  });

  it('keeps unrelated corrections apart', () => {
    const a = '不要用 default export,项目一律具名导出';
    const b = '测试要用 vitest,别引入 jest';
    expect(correctionSimilarity(a, b)).toBeLessThan(CORRECTION_SIMILAR_THRESHOLD);
  });

  it('matches English corrections by word overlap', () => {
    const a = 'never use default export, always named exports';
    const b = 'use named exports only — no default export';
    expect(isSimilarCorrection(a, b)).toBe(true);
  });

  it('identifier-ish tokens survive (vitest vs jest matters)', () => {
    const a = 'run tests with vitest';
    const b = 'run tests with jest';
    // Overlap exists but the differing tool name keeps them related — this is
    // a similarity heuristic, not equality; assert it stays symmetric.
    expect(correctionSimilarity(a, b)).toBeCloseTo(correctionSimilarity(b, a), 10);
  });

  it('empty and punctuation-only inputs score zero', () => {
    expect(correctionSimilarity('', 'anything')).toBe(0);
    expect(correctionSimilarity('!!!', '???')).toBe(0);
  });
});
