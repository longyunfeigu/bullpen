import type {
  PermissionStore,
  StoredPermissionRequest,
  StoredPermissionDecision,
  StandingRule,
} from '@pi-ide/tool-gateway';
import type { SqlDatabase } from '@pi-ide/persistence';

interface DecisionRuleRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  decision: string;
  rule_json: string;
  created_at: string;
}

/**
 * SQLite-backed permission persistence (PERM-010): requests and decisions are
 * audit rows; standing grants are decision rows with request_id NULL whose
 * rule_json carries the matching rule. Grants therefore survive restarts.
 */
export class SqlPermissionStore implements PermissionStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly workspaceId: string,
  ) {}

  saveRequest(request: StoredPermissionRequest): void {
    this.db
      .prepare(
        'INSERT INTO permission_requests (id, tool_call_id, task_id, state, risk, preview_json, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        request.id,
        request.toolCallId,
        request.taskId,
        request.state,
        request.risk,
        request.previewJson,
        request.createdAt,
        request.resolvedAt,
      );
  }

  resolveRequest(requestId: string, state: string, resolvedAt: string): void {
    this.db
      .prepare('UPDATE permission_requests SET state = ?, resolved_at = ? WHERE id = ?')
      .run(state, resolvedAt, requestId);
  }

  saveDecision(decision: StoredPermissionDecision): void {
    this.db
      .prepare(
        'INSERT INTO permission_decisions (id, request_id, workspace_id, task_id, decision, scope, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        decision.id,
        decision.requestId,
        decision.workspaceId,
        decision.taskId,
        decision.decision,
        decision.scope,
        decision.actor,
        decision.reason,
        decision.createdAt,
      );
  }

  saveRule(rule: StandingRule): void {
    this.db
      .prepare(
        'INSERT INTO permission_decisions (id, request_id, workspace_id, task_id, decision, scope, rule_json, actor, reason, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?)',
      )
      .run(
        rule.id,
        rule.workspaceId,
        rule.taskId,
        rule.kind,
        rule.taskId === null ? 'workspace' : 'task',
        JSON.stringify({ ruleKey: rule.ruleKey, risk: rule.risk }),
        'user',
        rule.createdAt,
      );
  }

  listRules(workspaceId: string): StandingRule[] {
    const rows = this.db
      .prepare(
        'SELECT id, workspace_id, task_id, decision, rule_json, created_at FROM permission_decisions WHERE workspace_id = ? AND rule_json IS NOT NULL ORDER BY created_at',
      )
      .all(workspaceId) as unknown as DecisionRuleRow[];
    return rows.map((row) => {
      const rule = JSON.parse(row.rule_json) as { ruleKey: string; risk: StandingRule['risk'] };
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        taskId: row.task_id,
        kind: row.decision === 'deny' ? 'deny' : 'allow',
        ruleKey: rule.ruleKey,
        risk: rule.risk,
        createdAt: row.created_at,
      };
    });
  }
}
