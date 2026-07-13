import {
  createSequenceAllocator,
  newId,
  productError,
  ProductFailure,
  redactObject,
  type Logger,
} from '@pi-ide/foundation';
import { assertTransition, isRunningState, type TaskState } from '@pi-ide/app-domain';
import type {
  AgentEvent,
  AgentMode,
  CreateSessionInput,
  ModelRef,
  RuntimeSessionRef,
  ToolCallRequest,
} from '@pi-ide/agent-contract';
import type { TaskDto, TimelineEventDto, VerificationCommandSchema } from '@pi-ide/ipc-contracts';
import type { z } from 'zod';
import type { SqlDatabase } from '@pi-ide/persistence';
import { ToolGateway, registerReadOnlyTools, type ToolAuditRecord } from '@pi-ide/tool-gateway';
import { SearchService } from '@pi-ide/search-service';
import { GitService } from '@pi-ide/git-service';
import type { AgentHost, RuntimeKind } from './agent-host.js';
import type { WorkspaceHost } from './workspace-host.js';
import type { SettingsService } from './settings-service.js';
import { broadcast } from '../broadcast.js';

type VerificationCommand = z.infer<typeof VerificationCommandSchema>;

export interface CreateTaskInput {
  title: string;
  goalMd: string;
  acceptance: string[];
  mode: AgentMode;
  model: ModelRef;
  verification: VerificationCommand[];
}

interface TaskRow {
  id: string;
  workspace_id: string;
  title: string;
  goal_md: string;
  acceptance_json: string;
  mode: string;
  state: string;
  model_json: string;
  verification_json: string;
  git_baseline_json: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

/**
 * Task engine (spec §6): persistence-backed state machine, immutable event log,
 * run orchestration against the AgentHost, tool audit projection.
 */
export class TaskService {
  private readonly sequences = createSequenceAllocator();
  private readonly sessionRefs = new Map<string, RuntimeSessionRef>();
  private readonly runsByTask = new Map<string, string>();
  private readonly startQueue: Array<{ taskId: string; prompt: string | undefined }> = [];
  private gateway: ToolGateway | null = null;

  constructor(
    private readonly db: SqlDatabase,
    private readonly host: AgentHost,
    private readonly workspace: WorkspaceHost,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {
    host.delegate = {
      onAgentEvent: (taskId, runId, event) => this.onAgentEvent(taskId, runId, event),
      onRunEnded: (taskId, runId) => this.onRunEnded(taskId, runId),
      onWorkerCrashed: (taskIds) => this.onWorkerCrashed(taskIds),
      gatewayForTask: () => this.gateway,
      onToolLifecycle: (taskId, call, result) => this.onToolLifecycle(taskId, call, result),
    };
    workspace.onDidChangeWorkspace((ws) => {
      this.gateway = null;
      if (ws) this.buildGateway();
    });
  }

  private buildGateway(): void {
    const ws = this.workspace.current;
    if (!ws) return;
    const gateway = new ToolGateway({
      root: ws.canonicalPath,
      mode: 'ask',
      audit: (record) => this.persistToolAudit(record),
    });
    registerReadOnlyTools(gateway, {
      root: ws.canonicalPath,
      documents: ws.documents,
      search: () =>
        new SearchService(ws.canonicalPath, this.settings.effective.workspace.ignoreGlobs),
      git: () => (ws.isGitRepo ? new GitService(ws.canonicalPath) : null),
    });
    this.gateway = gateway;
  }

  get toolGateway(): ToolGateway | null {
    return this.gateway;
  }

  // ---------- persistence helpers ----------

  private rowToDto(row: TaskRow): TaskDto {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      goalMd: row.goal_md,
      acceptance: JSON.parse(row.acceptance_json) as string[],
      mode: row.mode as AgentMode,
      state: row.state as TaskDto['state'],
      model: JSON.parse(row.model_json) as ModelRef,
      verification: JSON.parse(row.verification_json) as VerificationCommand[],
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      gitBaseline: row.git_baseline_json
        ? (JSON.parse(row.git_baseline_json) as { head: string | null; branch: string | null })
        : null,
    };
  }

  private getRow(taskId: string): TaskRow {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
      TaskRow | undefined;
    if (!row) {
      throw new ProductFailure(
        productError('TASK_NOT_FOUND', { userMessage: 'The task no longer exists.' }),
      );
    }
    return row;
  }

  getTask(taskId: string): TaskDto {
    return this.rowToDto(this.getRow(taskId));
  }

  listTasks(
    filter: 'all' | 'active' | 'review' | 'done' | 'failed',
    includeArchived: boolean,
  ): TaskDto[] {
    const ws = this.workspace.current;
    if (!ws) return [];
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 300')
      .all(ws.id) as unknown as TaskRow[];
    return rows
      .map((r) => this.rowToDto(r))
      .filter((t) => includeArchived || !t.archived)
      .filter((t) => {
        switch (filter) {
          case 'active':
            return (
              isRunningState(t.state as TaskState) ||
              t.state === 'READY' ||
              t.state === 'AWAITING_PLAN_APPROVAL'
            );
          case 'review':
            return t.state === 'REVIEW_READY';
          case 'done':
            return t.state === 'ACCEPTED' || t.state === 'ROLLED_BACK' || t.state === 'ARCHIVED';
          case 'failed':
            return t.state === 'FAILED' || t.state === 'INTERRUPTED' || t.state === 'CANCELLED';
          default:
            return true;
        }
      });
  }

  timeline(taskId: string, afterSequence: number): TimelineEventDto[] {
    const rows = this.db
      .prepare(
        'SELECT id, sequence, type, schema_version, payload_json, created_at FROM task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence LIMIT 1000',
      )
      .all(taskId, afterSequence) as Array<{
      id: string;
      sequence: number;
      type: string;
      schema_version: number;
      payload_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId,
      sequence: row.sequence,
      type: row.type,
      schemaVersion: row.schema_version,
      at: row.created_at,
      payload: JSON.parse(row.payload_json) as unknown,
    }));
  }

  /** Append an immutable task event and broadcast it (HIST-001/REL-004). */
  recordEvent(taskId: string, type: string, payload: unknown): TimelineEventDto {
    this.seedSequence(taskId);
    const sequence = this.sequences.next(`task:${taskId}`);
    const event: TimelineEventDto = {
      id: newId('evt'),
      taskId,
      sequence,
      type,
      schemaVersion: 1,
      at: new Date().toISOString(),
      payload,
    };
    this.db
      .prepare(
        'INSERT INTO task_events (id, task_id, sequence, type, schema_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(event.id, taskId, sequence, type, 1, JSON.stringify(payload ?? null), event.at);
    broadcast('task.event', { taskId, event });
    return event;
  }

  private seedSequence(taskId: string): void {
    const key = `task:${taskId}`;
    if (this.sequences.current(key) === 0) {
      const row = this.db
        .prepare('SELECT MAX(sequence) as maxSeq FROM task_events WHERE task_id = ?')
        .get(taskId) as { maxSeq: number | null };
      if (row.maxSeq) this.sequences.seed(key, row.maxSeq);
    }
  }

  private setState(taskId: string, to: TaskState, context?: Record<string, unknown>): TaskDto {
    const row = this.getRow(taskId);
    const from = row.state as TaskState;
    if (from === to) return this.rowToDto(row);
    assertTransition(from, to);
    this.db
      .prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?')
      .run(to, new Date().toISOString(), taskId);
    this.recordEvent(taskId, 'task.stateChanged', { from, to, ...context });
    broadcast('task.stateChanged', { taskId, state: to });
    return this.getTask(taskId);
  }

  // ---------- lifecycle ----------

  async createTask(input: CreateTaskInput): Promise<TaskDto> {
    const ws = this.workspace.mustActive();
    const now = new Date().toISOString();
    const id = newId('task');
    let gitBaseline: { head: string | null; branch: string | null } | null = null;
    if (ws.isGitRepo) {
      try {
        gitBaseline = await new GitService(ws.canonicalPath).headInfo();
      } catch {
        gitBaseline = null;
      }
    }
    this.db
      .prepare(
        `INSERT INTO tasks (id, workspace_id, title, goal_md, acceptance_json, mode, state, model_json, verification_json, git_baseline_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        ws.id,
        input.title,
        input.goalMd,
        JSON.stringify(input.acceptance),
        input.mode,
        JSON.stringify(input.model),
        JSON.stringify(input.verification),
        gitBaseline ? JSON.stringify(gitBaseline) : null,
        now,
        now,
      );
    this.recordEvent(id, 'task.created', {
      title: input.title,
      mode: input.mode,
      model: input.model,
      acceptance: input.acceptance,
      gitBaseline,
    });
    this.logger.info('task created', { id, mode: input.mode });
    return this.getTask(id);
  }

  private runtimeKind(): RuntimeKind {
    if (process.env.PI_IDE_FORCE_MOCK === '1') return 'mock';
    const settings = this.settings.effective;
    if (settings.models.useMockRuntime) return 'mock';
    return 'pi';
  }

  /** TASK-004: at most one active run; additional starts queue FIFO. */
  async startTask(taskId: string, prompt?: string): Promise<{ task: TaskDto; queued: boolean }> {
    const task = this.getTask(taskId);
    if (!['READY', 'INTERRUPTED', 'REVIEW_READY', 'FAILED'].includes(task.state)) {
      throw new ProductFailure(
        productError('TASK_NOT_STARTABLE', {
          userMessage: `The task cannot start from state ${task.state}.`,
        }),
      );
    }
    if (this.host.hasActiveRuns()) {
      this.startQueue.push({ taskId, prompt });
      this.recordEvent(taskId, 'task.queued', { reason: 'another agent run is active' });
      return { task, queued: true };
    }
    await this.launch(taskId, prompt);
    return { task: this.getTask(taskId), queued: false };
  }

  private async launch(taskId: string, prompt?: string): Promise<void> {
    const task = this.getTask(taskId);
    const ws = this.workspace.mustActive();
    const kind = this.runtimeKind();
    const model: ModelRef =
      kind === 'mock' ? { providerId: 'mock', modelId: 'mock-1' } : task.model;

    await this.host.ensure(kind);
    if (!this.gateway) this.buildGateway();
    this.gateway!.mode = task.mode;

    // Session: reuse existing ref when possible.
    let ref = this.sessionRefs.get(taskId);
    if (!ref) {
      const sessionInput: CreateSessionInput = {
        taskId,
        workspaceRoot: ws.canonicalPath,
        mode: task.mode,
        model,
        tools: this.gateway!.catalog(task.mode),
        systemPreamble: this.buildPreamble(task),
      };
      ref = await this.host.createSession(sessionInput);
      this.sessionRefs.set(taskId, ref);
      this.db
        .prepare(
          'INSERT INTO agent_sessions (id, task_id, runtime, runtime_version, external_session_id, external_session_file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          ref.sessionId,
          taskId,
          ref.runtimeId,
          'locked',
          ref.externalSessionId ?? null,
          ref.externalSessionFile ?? null,
          new Date().toISOString(),
        );
    }

    const runId = newId('run');
    this.runsByTask.set(taskId, runId);
    this.db
      .prepare(
        "INSERT INTO agent_runs (id, task_id, session_id, state, provider, model, thinking_level, started_at) VALUES (?, ?, ?, 'STARTING', ?, ?, ?, ?)",
      )
      .run(
        runId,
        taskId,
        ref.sessionId,
        model.providerId,
        model.modelId,
        model.thinkingLevel ?? null,
        new Date().toISOString(),
      );

    const userText = prompt ?? this.initialPrompt(task);
    this.recordEvent(taskId, 'user.message', { text: userText });
    this.setState(taskId, task.state === 'READY' ? 'EXPLORING' : 'IN_PROGRESS');

    this.host.startRun(taskId, {
      sessionRef: ref,
      runId,
      prompt: userText,
    });
  }

  private initialPrompt(task: TaskDto): string {
    const acceptance =
      task.acceptance.length > 0
        ? `\n\nAcceptance criteria:\n${task.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
        : '\n\n(No acceptance criteria were provided.)';
    return `${task.goalMd}${acceptance}`;
  }

  private buildPreamble(task: TaskDto): string {
    const ws = this.workspace.mustActive();
    const modeRules =
      task.mode === 'ask'
        ? 'You are in ASK mode: strictly read-only. You cannot modify files or run commands; if asked to, explain what you WOULD change instead.'
        : task.mode === 'edit'
          ? 'You are in EDIT mode: propose a plan before the first write; workspace writes and commands go through user approval.'
          : 'You are in AUTO mode: low-risk actions may run automatically; high-risk actions pause for the user.';
    return [
      `You are the coding agent inside Pi IDE working on the workspace at ${ws.canonicalPath}.`,
      modeRules,
      'Use only the provided tools. read_file returns a hash — pass it as baseHash when patching.',
      'Never claim work is complete without evidence from tools; verification results are recorded by the IDE.',
      `Task: ${task.title}`,
    ].join('\n');
  }

  async stopTask(taskId: string): Promise<TaskDto> {
    const runId = this.runsByTask.get(taskId) ?? this.host.activeRunForTask(taskId);
    if (runId) {
      this.host.abort(runId, 'user_stop');
      this.recordEvent(taskId, 'system.abortRequested', { runId });
    }
    return this.getTask(taskId);
  }

  steerOrQueue(
    taskId: string,
    text: string,
    during: 'steer' | 'followUp',
  ): 'steered' | 'queued' | 'started' {
    const runId = this.runsByTask.get(taskId);
    const task = this.getTask(taskId);
    if (runId && isRunningState(task.state as TaskState)) {
      this.recordEvent(taskId, 'user.message', { text, kind: during });
      if (during === 'steer') this.host.steer(runId, text);
      else this.host.followUp(runId, text);
      return during === 'steer' ? 'steered' : 'queued';
    }
    // Idle: start a fresh run with this text as the prompt.
    void this.startTask(taskId, text);
    return 'started';
  }

  archive(taskId: string): TaskDto {
    const task = this.getTask(taskId);
    if (['ACCEPTED', 'ROLLED_BACK', 'CANCELLED'].includes(task.state)) {
      this.setState(taskId, 'ARCHIVED');
    }
    this.db
      .prepare('UPDATE tasks SET archived = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), taskId);
    return this.getTask(taskId);
  }

  // ---------- agent event projection ----------

  private onAgentEvent(taskId: string, runId: string, event: AgentEvent): void {
    switch (event.type) {
      case 'run.started':
        this.db.prepare("UPDATE agent_runs SET state = 'STREAMING' WHERE id = ?").run(runId);
        break;
      case 'message.delta':
        broadcast('task.stream', { taskId, runId, messageId: event.messageId, delta: event.text });
        break;
      case 'message.completed':
        this.recordEvent(taskId, 'agent.message', {
          messageId: event.message.messageId,
          text: event.message.text,
        });
        break;
      case 'plan.proposed':
      case 'plan.updated':
        this.recordEvent(
          taskId,
          event.type === 'plan.proposed' ? 'agent.planProposed' : 'agent.planUpdated',
          {
            plan: event.plan,
          },
        );
        break;
      case 'tool.proposed':
        // Gateway audit is authoritative; runtime proposals stream for live UI only.
        broadcast('task.event', {
          taskId,
          event: {
            id: newId('evt'),
            taskId,
            sequence: 0, // ephemeral (not persisted)
            type: 'agent.toolProposed',
            schemaVersion: 1,
            at: event.at,
            payload: { call: { ...event.call, input: redactObject(event.call.input) } },
          },
        });
        break;
      case 'tool.started':
      case 'tool.progress':
        break;
      case 'tool.completed':
        break; // persisted via gateway audit
      case 'usage.updated':
        this.db
          .prepare('UPDATE agent_runs SET usage_json = ? WHERE id = ?')
          .run(JSON.stringify(event.usage), runId);
        this.recordEvent(taskId, 'agent.usage', { usage: event.usage });
        break;
      case 'context.compacted':
        this.recordEvent(taskId, 'system.contextCompacted', { metadata: event.metadata });
        break;
      case 'runtime.diagnostic':
        this.recordEvent(taskId, 'system.diagnostic', { code: event.code, detail: event.detail });
        break;
      case 'run.completed': {
        this.db
          .prepare(
            "UPDATE agent_runs SET state = 'COMPLETED', stop_reason = ?, ended_at = ? WHERE id = ?",
          )
          .run(event.stopReason, new Date().toISOString(), runId);
        this.recordEvent(taskId, 'run.completed', { runId, stopReason: event.stopReason });
        const task = this.getTask(taskId);
        if (task.state === 'EXPLORING') {
          // Ask flow: EXPLORING → IN_PROGRESS → REVIEW_READY (§6.1 exact hops).
          this.setState(taskId, 'IN_PROGRESS');
        }
        this.recordEvent(taskId, 'report.final', this.buildFinalReport(taskId, runId));
        this.setState(taskId, 'REVIEW_READY');
        break;
      }
      case 'run.failed':
        this.db
          .prepare(
            "UPDATE agent_runs SET state = 'ERROR', error_json = ?, ended_at = ? WHERE id = ?",
          )
          .run(JSON.stringify(event.error), new Date().toISOString(), runId);
        this.recordEvent(taskId, 'run.failed', { runId, error: event.error });
        this.safeTransition(taskId, 'FAILED');
        break;
      case 'run.aborted':
        this.db
          .prepare(
            "UPDATE agent_runs SET state = 'ABORTED', stop_reason = ?, ended_at = ? WHERE id = ?",
          )
          .run(event.reason, new Date().toISOString(), runId);
        this.recordEvent(taskId, 'run.aborted', { runId, reason: event.reason });
        this.safeTransition(taskId, 'INTERRUPTED');
        break;
    }
  }

  /** Best-effort transition through legal intermediate hops. */
  private safeTransition(taskId: string, to: TaskState): void {
    try {
      this.setState(taskId, to);
    } catch {
      try {
        this.setState(taskId, 'IN_PROGRESS');
        this.setState(taskId, to);
      } catch (e) {
        this.logger.warn('state transition fallback failed', {
          taskId,
          to,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  private buildFinalReport(taskId: string, runId: string): Record<string, unknown> {
    const task = this.getTask(taskId);
    const usageRow = this.db
      .prepare('SELECT usage_json, provider, model FROM agent_runs WHERE id = ?')
      .get(runId) as { usage_json: string | null; provider: string; model: string } | undefined;
    const toolCounts = this.db
      .prepare('SELECT state, COUNT(*) as n FROM tool_calls WHERE task_id = ? GROUP BY state')
      .all(taskId) as Array<{ state: string; n: number }>;
    return {
      outcome: 'completed',
      mode: task.mode,
      acceptance: task.acceptance,
      verification: { runs: [], note: task.mode === 'ask' ? 'not applicable (ask)' : 'unverified' },
      unverified: task.mode !== 'ask',
      toolCounts,
      model: usageRow ? { provider: usageRow.provider, model: usageRow.model } : null,
      usage: usageRow?.usage_json ? JSON.parse(usageRow.usage_json) : null,
      gitBaseline: task.gitBaseline,
    };
  }

  private onRunEnded(taskId: string, runId: string): void {
    if (this.runsByTask.get(taskId) === runId) {
      this.runsByTask.delete(taskId);
    }
    // Start the next queued task, if any.
    const next = this.startQueue.shift();
    if (next) {
      void this.launch(next.taskId, next.prompt).catch((e) => {
        this.logger.error('queued task launch failed', {
          taskId: next.taskId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
  }

  private onWorkerCrashed(taskIds: string[]): void {
    for (const taskId of taskIds) {
      this.recordEvent(taskId, 'system.workerCrashed', {
        note: 'The agent worker exited unexpectedly. No tools were replayed (REL-002).',
      });
      this.db
        .prepare(
          "UPDATE agent_runs SET state = 'ERROR_WORKER_EXIT', ended_at = ? WHERE task_id = ? AND ended_at IS NULL",
        )
        .run(new Date().toISOString(), taskId);
      this.safeTransition(taskId, 'INTERRUPTED');
      this.runsByTask.delete(taskId);
    }
  }

  private onToolLifecycle(
    taskId: string,
    call: ToolCallRequest,
    result: { ok: boolean; code: string; summary: string } | null,
  ): void {
    if (result === null) return; // start is audited by the gateway
  }

  private persistToolAudit(record: ToolAuditRecord): void {
    try {
      const exists = this.db
        .prepare('SELECT id FROM tool_calls WHERE id = ?')
        .get(record.callId) as { id: string } | undefined;
      if (!exists) {
        this.db
          .prepare(
            'INSERT INTO tool_calls (id, run_id, task_id, name, version, risk, state, input_json, created_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            record.callId,
            record.runId,
            record.taskId,
            record.name,
            record.version,
            record.risk,
            record.state,
            JSON.stringify(record.input ?? null),
            record.at,
            record.at,
          );
      } else {
        this.db
          .prepare(
            'UPDATE tool_calls SET state = ?, risk = COALESCE(?, risk), result_json = ?, ended_at = ? WHERE id = ?',
          )
          .run(
            record.state,
            record.risk,
            JSON.stringify({ ok: record.ok, summary: record.resultSummary }),
            record.at,
            record.callId,
          );
      }
      // Terminal states become timeline events.
      if (['SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED', 'TIMED_OUT'].includes(record.state)) {
        this.recordEvent(record.taskId, 'tool.call', {
          callId: record.callId,
          name: record.name,
          risk: record.risk,
          state: record.state,
          ok: record.ok,
          summary: record.resultSummary,
          input: record.input,
        });
      }
    } catch (e) {
      this.logger.warn('tool audit persist failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Restart-time scan (M10 expands): mark previously-running tasks interrupted. */
  markOrphanedRunsInterrupted(): void {
    const ws = this.workspace.current;
    const rows = this.db
      .prepare(
        "SELECT id, state FROM tasks WHERE state IN ('EXPLORING','PLANNING','IN_PROGRESS','AWAITING_PERMISSION','VERIFYING')" +
          (ws ? ' AND workspace_id = ?' : ''),
      )
      .all(...(ws ? [ws.id] : [])) as Array<{ id: string; state: string }>;
    for (const row of rows) {
      this.recordEvent(row.id, 'system.interruptedByRestart', {
        previousState: row.state,
        note: 'The application restarted while this task was running (INTERRUPTED_BY_RESTART).',
      });
      this.safeTransition(row.id, 'INTERRUPTED');
      this.db
        .prepare(
          "UPDATE agent_runs SET state = 'ERROR_WORKER_EXIT', ended_at = ? WHERE task_id = ? AND ended_at IS NULL",
        )
        .run(new Date().toISOString(), row.id);
    }
  }
}
