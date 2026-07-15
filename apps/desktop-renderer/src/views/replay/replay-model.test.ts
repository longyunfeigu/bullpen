import { describe, expect, it } from 'vitest';
import type { ReplayFactDto } from '@pi-ide/ipc-contracts';
import { matchesQuestionFilter, matchesSearch, rendererFor } from './replay-model.js';

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
