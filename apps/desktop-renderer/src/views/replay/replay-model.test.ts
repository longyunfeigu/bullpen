import { describe, expect, it } from 'vitest';
import type { ReplayFactDto } from '@pi-ide/ipc-contracts';
import {
  FOLD_MIN,
  approvalChipsByTarget,
  buildStorySegments,
  isSoftErrorFact,
  matchesQuestionFilter,
  matchesSearch,
  rendererFor,
} from './replay-model.js';

function fact(overrides: Partial<ReplayFactDto> = {}): ReplayFactDto {
  return {
    id: 'f1',
    sequence: 1,
    startedAt: '2026-07-15T00:00:00.000Z',
    actualStartMs: 0,
    actualEndMs: 0,
    storyStartMs: 0,
    storyEndMs: 900,
    idleBeforeMs: 0,
    lane: 'actions',
    actor: { kind: 'agent', label: 'Pi Agent' },
    action: 'Ran npm test',
    kind: 'command',
    status: 'ok',
    source: 'pi',
    capture: 'full',
    level: 'recorded',
    evidenceRefs: ['event:f1'],
    relations: [],
    risk: 'none',
    reversibility: 'unknown',
    mandatory: false,
    paths: [],
    ...overrides,
  };
}

describe('artifact renderer registry', () => {
  it('routes recorded document and table changes to their evidence renderers', () => {
    expect(rendererFor(fact({ kind: 'write', changeIds: ['c1'], paths: ['notes/brief.md'] }))).toBe(
      'document',
    );
    expect(rendererFor(fact({ kind: 'write', changeIds: ['c1'], paths: ['data/q2.csv'] }))).toBe(
      'spreadsheet',
    );
    // Without a recorded change there is no evidence to render as a document.
    expect(rendererFor(fact({ kind: 'write', paths: ['notes/brief.md'] }))).toBe('generic');
  });

  it('routes by evidence/target type, never by agent name', () => {
    expect(rendererFor(fact({ kind: 'write', changeIds: ['c1'] }))).toBe('file');
    expect(rendererFor(fact({ kind: 'permission' }))).toBe('approval');
    expect(rendererFor(fact({ kind: 'verification' }))).toBe('verification');
    expect(rendererFor(fact({ kind: 'command', toolName: 'terminal' }))).toBe('terminal');
    expect(rendererFor(fact({ kind: 'command', capture: 'observed', source: 'claude' }))).toBe(
      'terminal',
    );
    expect(rendererFor(fact({ kind: 'message' }))).toBe('message');
    expect(rendererFor(fact({ kind: 'search', resource: 'https://example.com/x' }))).toBe('web');
    // Unknown domains degrade to the generic observable-action card.
    expect(rendererFor(fact({ kind: 'state' }))).toBe('generic');
  });
});

describe('question-shaped filters', () => {
  it('matches facts by user questions', () => {
    expect(
      matchesQuestionFilter(
        fact({ kind: 'write', changeIds: ['c1'], lane: 'artifacts' }),
        'changed',
      ),
    ).toBe(true);
    expect(matchesQuestionFilter(fact({ kind: 'permission' }), 'decisions')).toBe(true);
    expect(matchesQuestionFilter(fact({ status: 'error' }), 'attention')).toBe(true);
    expect(matchesQuestionFilter(fact({ level: 'observed' }), 'unverified')).toBe(true);
    expect(matchesQuestionFilter(fact({ level: 'verified' }), 'unverified')).toBe(false);
  });

  it('searches action, detail, paths and app label', () => {
    expect(matchesSearch(fact({ paths: ['src/login.ts'] }), 'login')).toBe(true);
    expect(matchesSearch(fact({ detail: 'exit code 1' }), 'exit')).toBe(true);
    expect(matchesSearch(fact(), 'nonexistent-term')).toBe(false);
  });
});

describe('V3.2 lean recap — story segments', () => {
  const seq = (facts: ReplayFactDto[]) =>
    facts.map((f, i) => ({ ...f, id: f.id === 'f1' ? `f${i + 1}` : f.id, sequence: i + 1 }));

  it('renders no fold bar for an all-heartbeat span: it is quiet-counted instead', () => {
    const facts = seq([
      fact({ kind: 'user', actor: { kind: 'user', label: 'You' } }),
      fact({ kind: 'state', status: 'info' }),
      fact({ kind: 'state', status: 'info' }),
      fact({ kind: 'report' }),
    ]);
    const { segments, quietCount } = buildStorySegments({
      facts,
      keptIds: new Set(['f1', 'f4']),
      chippedIds: new Set(),
    });
    expect(segments.every((s) => s.type === 'fact')).toBe(true);
    expect(segments).toHaveLength(2);
    expect(quietCount).toBe(2);
  });

  it('inlines fewer than FOLD_MIN substantive facts instead of a bar', () => {
    const facts = seq([
      fact({ kind: 'user' }),
      fact({ kind: 'read' }),
      fact({ kind: 'state', status: 'info' }),
      fact({ kind: 'report' }),
    ]);
    const { segments, quietCount } = buildStorySegments({
      facts,
      keptIds: new Set(['f1', 'f4']),
      chippedIds: new Set(),
    });
    const inline = segments.filter((s) => s.type === 'fact' && s.inline);
    expect(inline).toHaveLength(1);
    expect(segments.some((s) => s.type === 'fold')).toBe(false);
    expect(quietCount).toBe(1);
  });

  it('keeps the fold bar (whole span accounted) at FOLD_MIN or more substantive facts', () => {
    const hiddenKinds: Array<ReplayFactDto['kind']> = ['read', 'search', 'read', 'state'];
    const facts = seq([
      fact({ kind: 'user' }),
      ...hiddenKinds.map((kind) => fact({ kind, status: kind === 'state' ? 'info' : 'ok' })),
      fact({ kind: 'report' }),
    ]);
    const { segments, quietCount } = buildStorySegments({
      facts,
      keptIds: new Set(['f1', 'f6']),
      chippedIds: new Set(),
    });
    const fold = segments.find((s) => s.type === 'fold');
    expect(fold).toBeDefined();
    // The bar accounts for the heartbeat inside its span too — no double count.
    expect(fold!.type === 'fold' && fold!.hidden).toHaveLength(4);
    expect(quietCount).toBe(0);
    expect(hiddenKinds.filter((k) => k !== 'state').length).toBeGreaterThanOrEqual(FOLD_MIN);
  });

  it('never renders chip-represented facts as rows, folds or quiet counts', () => {
    const facts = seq([
      fact({ kind: 'plan', status: 'pending' }),
      fact({ kind: 'plan-decision', status: 'ok' }),
      fact({ kind: 'report' }),
    ]);
    const { segments, quietCount } = buildStorySegments({
      facts,
      keptIds: new Set(['f1', 'f3']),
      chippedIds: new Set(['f2']),
    });
    expect(segments).toHaveLength(2);
    expect(quietCount).toBe(0);
  });
});

describe('V3.2 lean recap — approval chips', () => {
  it('collects approvals with id-backed resolves relations, folding in the request', () => {
    const chips = approvalChipsByTarget([
      fact({ id: 'tool-1', kind: 'write', changeIds: ['c1'] }),
      fact({ id: 'req-1', kind: 'permission', status: 'pending' }),
      fact({
        id: 'dec-1',
        kind: 'permission',
        status: 'ok',
        relations: [
          { type: 'requested-by', factId: 'req-1' },
          { type: 'resolves', factId: 'tool-1' },
        ],
      }),
    ]);
    expect(chips.get('tool-1')).toHaveLength(1);
    expect(chips.get('tool-1')![0]!.fact.id).toBe('dec-1');
    expect(chips.get('tool-1')![0]!.requestFactId).toBe('req-1');
  });

  it('ignores denials and approvals without a joined target (they keep rows)', () => {
    const chips = approvalChipsByTarget([
      fact({
        id: 'denied',
        kind: 'permission',
        status: 'denied',
        relations: [{ type: 'resolves', factId: 'tool-1' }],
      }),
      fact({ id: 'orphan', kind: 'plan-decision', status: 'ok', relations: [] }),
    ]);
    expect(chips.size).toBe(0);
  });
});

describe('V3.2 lean recap — soft process errors', () => {
  it('downgrades read/search/state errors only when the session completed', () => {
    expect(isSoftErrorFact(fact({ kind: 'read', status: 'error' }), 'completed')).toBe(true);
    expect(isSoftErrorFact(fact({ kind: 'state', status: 'error' }), 'completed')).toBe(true);
    // The same error in a failed session is a hard story beat.
    expect(isSoftErrorFact(fact({ kind: 'read', status: 'error' }), 'attention')).toBe(false);
  });

  it('never downgrades failures that shaped the result', () => {
    expect(isSoftErrorFact(fact({ kind: 'verification', status: 'error' }), 'completed')).toBe(
      false,
    );
    expect(isSoftErrorFact(fact({ kind: 'command', status: 'error' }), 'completed')).toBe(false);
    expect(isSoftErrorFact(fact({ kind: 'write', status: 'error' }), 'completed')).toBe(false);
    expect(isSoftErrorFact(fact({ kind: 'permission', status: 'denied' }), 'completed')).toBe(
      false,
    );
  });
});
