import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, MIGRATIONS, type SqlDatabase } from '@pi-ide/persistence';
import { SqlPermissionStore } from './permission-store.js';

let dir: string;
let db: SqlDatabase;
let store: SqlPermissionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-ide-permstore-'));
  db = openDatabase({
    file: join(dir, 'app.db'),
    backupDir: join(dir, 'backups'),
    migrations: MIGRATIONS,
  }).db;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO workspaces (id, canonical_path, display_name, last_opened_at, created_at) VALUES ('ws1', ?, 'w', ?, ?)",
  ).run(dir, now, now);
  db.prepare(
    "INSERT INTO tasks (id, workspace_id, title, goal_md, mode, state, model_json, created_at, updated_at) VALUES ('t1', 'ws1', 'x', 'g', 'edit', 'IN_PROGRESS', '{}', ?, ?)",
  ).run(now, now);
  db.prepare(
    "INSERT INTO agent_runs (id, task_id, state, started_at) VALUES ('r1', 't1', 'STREAMING', ?)",
  ).run(now);
  db.prepare(
    "INSERT INTO tool_calls (id, run_id, task_id, name, state, input_json, created_at) VALUES ('c1', 'r1', 't1', 'run_command', 'PROPOSED', '{}', ?)",
  ).run(now);
  store = new SqlPermissionStore(db, 'ws1');
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SqlPermissionStore', () => {
  it('persists and resolves permission requests', () => {
    store.saveRequest({
      id: 'p1',
      toolCallId: 'c1',
      taskId: 't1',
      state: 'PENDING',
      risk: 'R3',
      previewJson: '{"summary":"npm install"}',
      createdAt: 'now',
      resolvedAt: null,
    });
    const row = db.prepare('SELECT * FROM permission_requests WHERE id = ?').get('p1') as {
      state: string;
      risk: string;
    };
    expect(row.state).toBe('PENDING');
    expect(row.risk).toBe('R3');

    store.resolveRequest('p1', 'DENIED', 'later');
    const after = db
      .prepare('SELECT state, resolved_at FROM permission_requests WHERE id = ?')
      .get('p1') as {
      state: string;
      resolved_at: string;
    };
    expect(after.state).toBe('DENIED');
    expect(after.resolved_at).toBe('later');
  });

  it('persists decisions linked to requests (PERM-010)', () => {
    store.saveRequest({
      id: 'p1',
      toolCallId: 'c1',
      taskId: 't1',
      state: 'PENDING',
      risk: 'R2',
      previewJson: '{}',
      createdAt: 'now',
      resolvedAt: null,
    });
    store.saveDecision({
      id: 'd1',
      requestId: 'p1',
      workspaceId: 'ws1',
      taskId: 't1',
      decision: 'allow',
      scope: 'once',
      actor: 'user',
      reason: null,
      createdAt: 'now',
    });
    const row = db.prepare('SELECT * FROM permission_decisions WHERE id = ?').get('d1') as {
      decision: string;
      scope: string;
      actor: string;
    };
    expect(row.decision).toBe('allow');
    expect(row.scope).toBe('once');
    expect(row.actor).toBe('user');
  });

  it('round-trips standing rules and survives a reopen (workspace grants persist)', () => {
    store.saveRule({
      id: 'rule1',
      workspaceId: 'ws1',
      taskId: null,
      kind: 'allow',
      ruleKey: 'run_command:npm:test',
      risk: 'R2',
      createdAt: 'now',
    });
    store.saveRule({
      id: 'rule2',
      workspaceId: 'ws1',
      taskId: 't1',
      kind: 'deny',
      ruleKey: 'run_command:rm',
      risk: 'R3',
      createdAt: 'now',
    });
    const rules = store.listRules('ws1');
    expect(rules).toHaveLength(2);
    const allow = rules.find((r) => r.kind === 'allow')!;
    expect(allow.ruleKey).toBe('run_command:npm:test');
    expect(allow.taskId).toBeNull();
    const deny = rules.find((r) => r.kind === 'deny')!;
    expect(deny.taskId).toBe('t1');

    // A fresh store instance over the same DB sees the same rules.
    const store2 = new SqlPermissionStore(db, 'ws1');
    expect(store2.listRules('ws1')).toHaveLength(2);
    // Rules for other workspaces are invisible.
    expect(store2.listRules('ws-other')).toHaveLength(0);
  });
});
