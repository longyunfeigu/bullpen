import { describe, expect, it } from 'vitest';
import type { DiscoveredSessionDto } from '@pi-ide/ipc-contracts';
import {
  bucketSessionsByDay,
  filterSessions,
  isDiscoveryStale,
  sessionsInScope,
  unknownDirectories,
} from './archaeologyStore.js';

function session(partial: Partial<DiscoveredSessionDto>): DiscoveredSessionDto {
  return {
    cli: 'claude',
    sessionId: '6f3a92c1-0000-4000-8000-000000000001',
    cwd: '/Users/dev/git/blog',
    projectPath: '/Users/dev/git/blog',
    attribution: 'cwd',
    title: 't',
    startedAt: null,
    endedAt: null,
    filesTouched: [],
    skills: [],
    turnCount: 1,
    trackedTaskId: null,
    ...partial,
  };
}

describe('sessionsInScope (ADR-0038)', () => {
  const sessions = [
    session({ sessionId: '6f3a92c1-0000-4000-8000-000000000001' }),
    // Attributed by files, launched from home — still belongs to the project.
    session({
      sessionId: '6f3a92c1-0000-4000-8000-000000000002',
      cwd: '/Users/dev',
      attribution: 'files',
    }),
    // Subdirectory launch inside the scope path.
    session({
      sessionId: '6f3a92c1-0000-4000-8000-000000000003',
      cwd: '/Users/dev/git/blog/apps/web',
    }),
    session({
      sessionId: '6f3a92c1-0000-4000-8000-000000000004',
      cwd: '/opt/elsewhere',
      projectPath: null,
      attribution: 'none',
    }),
  ];

  it('matches by attributed project, exact cwd and cwd prefix', () => {
    const scoped = sessionsInScope(sessions, '/Users/dev/git/blog');
    expect(scoped.map((s) => s.sessionId.slice(-1))).toEqual(['1', '2', '3']);
  });

  it('null scope means everything', () => {
    expect(sessionsInScope(sessions, null)).toHaveLength(4);
  });

  it('never matches sibling directories that merely share a prefix', () => {
    const sibling = [session({ cwd: '/Users/dev/git/blog-gen', projectPath: null })];
    expect(sessionsInScope(sibling, '/Users/dev/git/blog')).toHaveLength(0);
  });
});

describe('unknownDirectories (Agent activity list)', () => {
  it('groups unattributed sessions by cwd, newest first, merging CLIs', () => {
    const dirs = unknownDirectories([
      session({ projectPath: null, cwd: '/a', endedAt: '2026-07-01T00:00:00Z' }),
      session({
        projectPath: null,
        cwd: '/a',
        cli: 'codex',
        sessionId: '6f3a92c1-0000-4000-8000-00000000000a',
        endedAt: '2026-07-10T00:00:00Z',
      }),
      session({ projectPath: null, cwd: '/b', endedAt: '2026-07-20T00:00:00Z' }),
      session({ cwd: '/tracked-project' }), // attributed → never an unknown dir
    ]);
    expect(dirs).toEqual([
      { cwd: '/b', count: 1, lastAt: '2026-07-20T00:00:00Z', clis: ['claude'] },
      { cwd: '/a', count: 2, lastAt: '2026-07-10T00:00:00Z', clis: ['claude', 'codex'] },
    ]);
  });
});

describe('bucketSessionsByDay (ADR-0041 time-first timeline)', () => {
  // Local-time constructors keep the test timezone-agnostic: both `now` and
  // the session timestamps shift together with the host tz.
  const now = new Date(2026, 6, 21, 9, 30).getTime(); // July 21, 09:30 local
  const at = (...d: [number, number, number, number, number]) => new Date(...d).toISOString();
  const s = (tail: string, endedAt: string | null) =>
    session({ sessionId: `6f3a92c1-0000-4000-8000-00000000000${tail}`, endedAt });

  it('buckets by local calendar day, keeps input order, omits empty buckets', () => {
    const buckets = bucketSessionsByDay(
      [
        s('1', at(2026, 6, 21, 8, 0)), // today
        s('2', at(2026, 6, 21, 0, 5)), // today, just past midnight
        s('3', at(2026, 6, 20, 23, 55)), // yesterday, just before midnight
        s('4', at(2026, 6, 15, 12, 0)), // 6 days ago → still past-7-days
        s('5', at(2026, 6, 14, 12, 0)), // 7 days ago → earlier
        s('6', null), // undated tail
      ],
      now,
    );
    expect(buckets.map((b) => [b.key, b.sessions.map((x) => x.sessionId.slice(-1))])).toEqual([
      ['today', ['1', '2']],
      ['yesterday', ['3']],
      ['week', ['4']],
      ['earlier', ['5']],
      ['undated', ['6']],
    ]);
  });

  it('drops empty buckets entirely instead of rendering hollow headers', () => {
    const buckets = bucketSessionsByDay([s('1', at(2026, 6, 20, 10, 0))], now);
    expect(buckets.map((b) => b.key)).toEqual(['yesterday']);
  });

  it('future and unparsable timestamps degrade to today / undated', () => {
    const buckets = bucketSessionsByDay([s('1', at(2026, 6, 22, 1, 0)), s('2', 'not-a-date')], now);
    expect(buckets.map((b) => b.key)).toEqual(['today', 'undated']);
  });
});

describe('filterSessions (status is a filter, not a grouping)', () => {
  const list = [
    session({ sessionId: '6f3a92c1-0000-4000-8000-000000000001' }),
    session({ sessionId: '6f3a92c1-0000-4000-8000-000000000002', trackedTaskId: 'task-1' }),
  ];

  it('splits on trackedTaskId and passes everything through for all', () => {
    expect(filterSessions(list, 'all')).toHaveLength(2);
    expect(filterSessions(list, 'external').map((x) => x.sessionId.slice(-1))).toEqual(['1']);
    expect(filterSessions(list, 'tracked').map((x) => x.sessionId.slice(-1))).toEqual(['2']);
  });
});

describe('isDiscoveryStale', () => {
  it('treats missing, unparsable and old scans as stale; fresh ones not', () => {
    const now = Date.parse('2026-07-20T12:00:00Z');
    expect(isDiscoveryStale(null, now)).toBe(true);
    expect(isDiscoveryStale('garbage', now)).toBe(true);
    expect(isDiscoveryStale('2026-07-20T11:00:00Z', now)).toBe(true);
    expect(isDiscoveryStale('2026-07-20T11:59:30Z', now)).toBe(false);
  });
});
