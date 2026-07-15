import { describe, expect, it } from 'vitest';
import type { ActivityItem, TaskDto } from '@pi-ide/ipc-contracts';
import type { SqlDatabase } from '@pi-ide/persistence';
import { ReplayService } from './replay-service.js';
import type { TaskService } from './task-service.js';

/**
 * ReplayService is a thin, trust-boundary layer over the shared projection:
 * these tests cover pagination cursors, cache behavior, and the
 * belongs-to-task evidence boundary (foreign ids resolve to null).
 */

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
} as never;

function item(
  taskId: string,
  sequence: number,
  overrides: Partial<ActivityItem> = {},
): ActivityItem {
  return {
    key: `evt-${taskId}-${sequence}`,
    taskId,
    sequence,
    at: new Date(Date.parse('2026-07-15T00:00:00.000Z') + sequence * 1000).toISOString(),
    kind: 'command',
    label: `event ${sequence}`,
    status: 'ok',
    paths: [],
    author: 'agent',
    source: 'pi',
    captureGrade: 'full',
    ...overrides,
  };
}

interface FakeWorld {
  tasks: Record<string, TaskDto>;
  itemsByTask: Record<string, ActivityItem[]>;
  events: Record<string, { id: string; taskId: string; type: string; payload: string; at: string }>;
  changes: Record<
    string,
    { id: string; taskId: string; path: string; afterHash: string | null; createdAt: string }
  >;
  activityCalls: number;
}

function fakeTaskDto(id: string, state = 'REVIEW_READY'): TaskDto {
  return {
    id,
    workspaceId: 'ws',
    title: id,
    goalMd: 'goal',
    acceptance: [],
    mode: 'edit',
    state,
    model: { providerId: 'mock', modelId: 'mock' },
    verification: [],
    archived: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    gitBaseline: null,
    projectName: 'p',
    projectPath: '/tmp/p',
    changedFiles: null,
    worktree: null,
    external: null,
  } as TaskDto;
}

function buildService(world: FakeWorld): ReplayService {
  const tasks = {
    getTask(taskId: string) {
      const task = world.tasks[taskId];
      if (!task) throw new Error('TASK_NOT_FOUND');
      return task;
    },
    activity(taskId: string) {
      world.activityCalls += 1;
      const items = world.itemsByTask[taskId] ?? [];
      return { items, total: items.length };
    },
    changeRecord(taskId: string, changeId: string) {
      const change = world.changes[changeId];
      if (!change || change.taskId !== taskId) return null;
      return {
        id: change.id,
        taskId,
        path: change.path,
        kind: 'modified' as const,
        beforeHash: 'before-hash',
        afterHash: change.afterHash,
        patch: '--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n',
        renameTo: null,
        author: 'agent' as const,
        toolCallId: null,
        createdAt: change.createdAt,
      };
    },
    async changeEvidence() {
      return { beforeText: 'x', afterText: 'y', binary: false };
    },
  } as unknown as TaskService;

  const db = {
    prepare(sql: string) {
      return {
        get(...args: unknown[]) {
          if (sql.includes('MAX(sequence)')) {
            const items = world.itemsByTask[args[0] as string] ?? [];
            return { latest: items.at(-1)?.sequence ?? null };
          }
          if (sql.includes('FROM task_events WHERE id = ?')) {
            const event = world.events[args[0] as string];
            if (!event || event.taskId !== (args[1] as string)) return undefined;
            return {
              id: event.id,
              type: event.type,
              payload_json: event.payload,
              created_at: event.at,
            };
          }
          return undefined;
        },
        all() {
          return [];
        },
      };
    },
  } as unknown as SqlDatabase;

  return new ReplayService(db, tasks, noopLogger);
}

function world(): FakeWorld {
  return { tasks: {}, itemsByTask: {}, events: {}, changes: {}, activityCalls: 0 };
}

describe('ReplayService pagination', () => {
  it('pages facts by sequence cursor with a hard limit and a terminal null cursor', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = Array.from({ length: 450 }, (_, i) => item('t1', i + 1));
    const service = buildService(w);

    const page1 = service.events('t1', { limit: 200 });
    expect(page1.facts.length).toBe(200);
    expect(page1.total).toBe(450);
    expect(page1.nextAfterSequence).toBe(page1.facts.at(-1)!.sequence);

    const page2 = service.events('t1', { afterSequence: page1.nextAfterSequence!, limit: 200 });
    expect(page2.facts[0]!.sequence).toBe(201);
    const page3 = service.events('t1', { afterSequence: page2.nextAfterSequence!, limit: 200 });
    expect(page3.facts.length).toBe(50);
    expect(page3.nextAfterSequence).toBeNull();
  });

  it('clamps the page size to 500', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = Array.from({ length: 900 }, (_, i) => item('t1', i + 1));
    const service = buildService(w);
    expect(service.events('t1', { limit: 9_999 }).facts.length).toBe(500);
  });

  it('caches finished sessions and reprojects only when the ledger grows', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = [item('t1', 1), item('t1', 2)];
    const service = buildService(w);
    service.session('t1');
    service.session('t1');
    expect(w.activityCalls).toBe(1);
    w.itemsByTask['t1'] = [...w.itemsByTask['t1']!, item('t1', 3)];
    service.session('t1');
    expect(w.activityCalls).toBe(2);
  });

  it('always reprojects running sessions (live duration moves with the clock)', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1', 'IN_PROGRESS');
    w.itemsByTask['t1'] = [item('t1', 1)];
    const service = buildService(w);
    service.session('t1');
    service.session('t1');
    expect(w.activityCalls).toBe(2);
    expect(service.session('t1').session.outcome).toBe('running');
  });
});

describe('ReplayService evidence-bounded ask (§7)', () => {
  it('answers only from the ledger with validated citations', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = [
      item('t1', 1, { kind: 'command', label: 'Ran npm test', callId: 'call-1', key: 'call-1' }),
      item('t1', 2, {
        kind: 'permission',
        status: 'pending',
        label: 'Waiting for approval: run npm test',
        callId: 'call-1',
        parentKey: 'req-1',
      }),
    ];
    const service = buildService(w);
    const answer = service.ask('t1', 'evt-t1-2', 'why did this happen?');
    expect(answer.citations).toContain('fact:evt-t1-2');
    // The recorded relation resolves to a real fact citation.
    expect(answer.citations).toContain('fact:call-1');
    expect(answer.text).toContain('Waiting for approval');
    // The ledger cannot answer "why" — the boundary says so explicitly.
    expect(answer.boundary).toContain('无法确认');
  });

  it('fails closed for facts outside this task', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = [item('t1', 1)];
    const service = buildService(w);
    const answer = service.ask('t1', 'evt-other-99', 'what happened?');
    expect(answer.citations).toEqual([]);
    expect(answer.text).toContain('记录无法确认');
  });

  it('marks observed facts as observation-only in the answer', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = [
      item('t1', 1, { captureGrade: 'observed', source: 'claude', label: 'terminal output' }),
    ];
    const service = buildService(w);
    const answer = service.ask('t1', 'evt-t1-1', 'why?');
    expect(answer.text).toContain('只能确认');
    expect(answer.boundary).toContain('无法确认应用内部语义');
  });
});

describe('ReplayService receipt (§8)', () => {
  it('produces a reproducible manifest hash and never claims tamper-proofing', () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = [item('t1', 1), item('t1', 2)];
    const service = buildService(w);
    const first = service.receipt('t1');
    expect(first.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.json).toContain(first.manifestSha256);
    expect(first.html).toContain(first.manifestSha256);
    expect(first.html).toContain('未经密码学签名');
    expect(first.html).not.toMatch(/tamper-proof(?!ing)|不可篡改/);
    // Same ledger, same manifest content → same hash (except exportedAt).
    const a = JSON.parse(first.json) as { manifest: { exportedAt: string } };
    const b = JSON.parse(service.receipt('t1').json) as { manifest: { exportedAt: string } };
    a.manifest.exportedAt = b.manifest.exportedAt;
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });
});

describe('ReplayService evidence boundary', () => {
  it('resolves event and change refs that belong to the task', async () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.itemsByTask['t1'] = [item('t1', 1)];
    w.events['evt-t1-1'] = {
      id: 'evt-t1-1',
      taskId: 't1',
      type: 'tool.call',
      payload: JSON.stringify({ name: 'run_command' }),
      at: '2026-07-15T00:00:01.000Z',
    };
    w.changes['chg-1'] = {
      id: 'chg-1',
      taskId: 't1',
      path: 'src/a.ts',
      afterHash: 'sha256-after',
      createdAt: '2026-07-15T00:00:02.000Z',
    };
    const service = buildService(w);

    const event = await service.evidence('t1', 'event:evt-t1-1');
    expect(event?.type).toBe('event');
    expect(event?.source).toBe('tool.call');
    expect(event?.integrityHash).toBeNull();
    expect(event?.payloadExcerpt).toContain('run_command');

    const change = await service.evidence('t1', 'change:chg-1');
    expect(change?.type).toBe('file-version');
    expect(change?.integrityHash).toBe('sha256-after');
    expect(change?.afterText).toBe('y');
  });

  it('never resolves another task’s evidence or malformed refs', async () => {
    const w = world();
    w.tasks['t1'] = fakeTaskDto('t1');
    w.tasks['t2'] = fakeTaskDto('t2');
    w.itemsByTask['t1'] = [item('t1', 1)];
    w.itemsByTask['t2'] = [item('t2', 1)];
    w.events['evt-t2-1'] = {
      id: 'evt-t2-1',
      taskId: 't2',
      type: 'tool.call',
      payload: '{}',
      at: '2026-07-15T00:00:01.000Z',
    };
    w.changes['chg-2'] = {
      id: 'chg-2',
      taskId: 't2',
      path: 'src/b.ts',
      afterHash: null,
      createdAt: '2026-07-15T00:00:02.000Z',
    };
    const service = buildService(w);
    expect(await service.evidence('t1', 'event:evt-t2-1')).toBeNull();
    expect(await service.evidence('t1', 'change:chg-2')).toBeNull();
    expect(await service.evidence('t1', 'blob:whatever')).toBeNull();
    await expect(service.evidence('missing-task', 'event:evt-t2-1')).rejects.toThrow();
  });
});
