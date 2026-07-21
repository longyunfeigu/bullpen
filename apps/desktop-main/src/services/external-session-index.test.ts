import { describe, expect, it } from 'vitest';
import { buildExternalSessionIndex, type ExternalSessionRow } from './external-session-index.js';

/**
 * The conversation-id → task fold behind archaeology's "Tracked" badge and
 * Open target. Duplicate session ids (a conversation resumed across several
 * tasks) must resolve to the task the user can still act on.
 */

function row(
  id: string,
  sessionId: string | null,
  archived = 0,
  updatedAt = '2026-07-20T00:00:00.000Z',
): ExternalSessionRow {
  return {
    id,
    external_json: JSON.stringify({ cli: 'claude', status: 'ended', sessionId }),
    archived,
    updated_at: updatedAt,
  };
}

describe('buildExternalSessionIndex', () => {
  it('maps lowercased session ids to their task', () => {
    const index = buildExternalSessionIndex([row('task_a', 'ABC-DEF')]);
    expect(index.get('abc-def')).toBe('task_a');
    expect(index.size).toBe(1);
  });

  it('skips rows without a session id and malformed legacy rows', () => {
    const malformed: ExternalSessionRow = {
      id: 'task_bad',
      external_json: '{not json',
      archived: 0,
      updated_at: '2026-07-20T00:00:00.000Z',
    };
    const index = buildExternalSessionIndex([row('task_a', null), malformed]);
    expect(index.size).toBe(0);
  });

  it('prefers the live task over archived duplicates, whatever the row order', () => {
    const live = row('task_live', 's-1', 0, '2026-07-17T00:00:00.000Z');
    const archived = row('task_archived', 's-1', 1, '2026-07-20T00:00:00.000Z');
    expect(buildExternalSessionIndex([live, archived]).get('s-1')).toBe('task_live');
    expect(buildExternalSessionIndex([archived, live]).get('s-1')).toBe('task_live');
  });

  it('breaks ties among live duplicates by latest activity', () => {
    const older = row('task_old', 's-1', 0, '2026-07-17T00:00:00.000Z');
    const newer = row('task_new', 's-1', 0, '2026-07-20T00:00:00.000Z');
    expect(buildExternalSessionIndex([newer, older]).get('s-1')).toBe('task_new');
    expect(buildExternalSessionIndex([older, newer]).get('s-1')).toBe('task_new');
  });

  it('falls back to the most recent archived task when no live task owns the id', () => {
    const a = row('task_a', 's-1', 1, '2026-07-17T00:00:00.000Z');
    const b = row('task_b', 's-1', 1, '2026-07-19T00:00:00.000Z');
    expect(buildExternalSessionIndex([b, a]).get('s-1')).toBe('task_b');
  });
});
