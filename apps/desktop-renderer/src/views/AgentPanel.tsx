import React, { useEffect, useRef, useState } from 'react';
import type { AskUserPromptDto, PermissionCardDto, TimelineEventDto } from '@pi-ide/ipc-contracts';
import { useTaskStore, activeTask, RUNNING_TASK_STATES } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { NewTaskDialog } from './NewTaskDialog.js';

const RISK_COLORS: Record<string, string> = {
  R0: 'var(--fg-muted)',
  R1: 'var(--info)',
  R2: 'var(--info)',
  R3: 'var(--warning)',
  R4: 'var(--danger)',
};

const RISK_POLICY =
  'R0 read-only · R1 reversible workspace write · R2 local execution · ' +
  'R3 external/hard-to-reverse (always asks, never granted permanently) · R4 forbidden by product policy';

/** Approval card (§13.3, PERM-004): tool, why, exact target, diff/command, scoped decisions. */
function PermissionCard(props: {
  card: PermissionCardDto;
  resolution: { outcome: string; scope?: string | null } | null;
}): React.JSX.Element {
  const store = useTaskStore();
  const { card, resolution } = props;
  const [reason, setReason] = useState('');
  const riskColor = RISK_COLORS[card.risk.level] ?? 'var(--fg)';

  if (resolution) {
    const allowed = resolution.outcome === 'allowed';
    return (
      <Card
        icon={allowed ? '✅' : resolution.outcome === 'denied' ? '🚫' : '⌛'}
        title={`Permission ${resolution.outcome}${resolution.scope ? ` (${resolution.scope})` : ''} — ${card.toolName}`}
        tone={allowed ? 'success' : 'warning'}
        testid="perm-card-resolved"
        collapsible
      >
        <div className="text-muted">{card.preview.summary}</div>
      </Card>
    );
  }

  const decide = (
    kind: 'allow' | 'deny',
    scope: 'once' | 'task' | 'workspace' | 'always',
  ): void => {
    void store.decidePermission({
      requestId: card.requestId,
      kind,
      scope,
      expectedParamsHash: card.paramsHash,
      ...(kind === 'deny' && reason.trim() ? { reason: reason.trim() } : {}),
    });
  };

  return (
    <Card icon="🛡" title={`Permission needed — ${card.toolName}`} tone="warning" testid="perm-card">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <span
          style={{
            border: `1px solid ${riskColor}`,
            color: riskColor,
            borderRadius: 4,
            padding: '0 6px',
            fontSize: 11,
          }}
          data-testid="perm-risk"
        >
          {card.risk.level}
        </span>
        <span className="text-muted" style={{ fontSize: 11 }}>
          {card.risk.reasons.join('; ')}
        </span>
      </div>
      <div style={{ marginBottom: 4 }}>{card.preview.summary}</div>
      {card.preview.command ? (
        <pre className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: '4px 0' }}>
          $ {card.preview.command.executable} {card.preview.command.args.join(' ')}
          {'\n'}cwd: {card.preview.command.cwd}
        </pre>
      ) : null}
      {card.preview.targets && card.preview.targets.length > 0 ? (
        <div className="text-muted" style={{ fontSize: 11 }}>
          targets: {card.preview.targets.join(', ')}
        </div>
      ) : null}
      {card.preview.diff ? (
        <pre
          className="mono"
          style={{ fontSize: 11, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' }}
        >
          {card.preview.diff}
        </pre>
      ) : (
        <div className="text-muted" style={{ fontSize: 11 }}>
          No diff — this action does not modify files directly.
        </div>
      )}
      {card.preview.detail ? (
        <div className="text-muted" style={{ fontSize: 11 }}>
          {card.preview.detail}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {card.options.allowScopes.includes('once') ? (
          <button
            className="btn primary"
            data-testid="perm-allow-once"
            onClick={() => decide('allow', 'once')}
          >
            Allow once
          </button>
        ) : null}
        {card.options.allowScopes.includes('task') ? (
          <button
            className="btn"
            data-testid="perm-allow-task"
            onClick={() => decide('allow', 'task')}
          >
            Allow for this task
          </button>
        ) : null}
        {card.options.allowScopes.includes('workspace') ? (
          <button
            className="btn"
            data-testid="perm-allow-workspace"
            onClick={() => decide('allow', 'workspace')}
            title="Allow this kind of action in this workspace from now on"
          >
            Allow in workspace
          </button>
        ) : null}
        <button
          className="btn danger"
          data-testid="perm-deny"
          onClick={() => decide('deny', 'once')}
        >
          Deny
        </button>
        <button
          className="btn danger"
          data-testid="perm-deny-always"
          onClick={() => decide('deny', 'always')}
          title="Always deny this kind of action in this workspace"
        >
          Always deny
        </button>
      </div>
      <input
        data-testid="perm-reason"
        placeholder="Optional reason shown to the agent when denying…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{
          width: '100%',
          marginTop: 6,
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '4px 6px',
          fontSize: 12,
        }}
      />
      <details style={{ marginTop: 6, fontSize: 11 }} className="text-muted">
        <summary style={{ cursor: 'pointer' }}>View risk policy</summary>
        <div style={{ paddingTop: 4 }}>{RISK_POLICY}</div>
      </details>
    </Card>
  );
}

/** ask_user question card — the run is paused until the user answers. */
function QuestionCard(props: { prompt: AskUserPromptDto; answered: boolean }): React.JSX.Element {
  const store = useTaskStore();
  const [text, setText] = useState('');
  const { prompt, answered } = props;
  if (answered) {
    return (
      <Card icon="❓" title="Question (answered)" testid="q-card-answered" collapsible>
        <div className="text-muted">{prompt.question}</div>
      </Card>
    );
  }
  return (
    <Card icon="❓" title="The agent has a question" tone="warning" testid="q-card">
      <div style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>{prompt.question}</div>
      {prompt.options.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {prompt.options.map((option, i) => (
            <button
              key={option}
              className="btn"
              data-testid={`q-option-${i}`}
              onClick={() => void store.answerUser(prompt.callId, option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {prompt.allowFreeForm ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            data-testid="q-input"
            placeholder="Type an answer…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                void store.answerUser(prompt.callId, text.trim());
              }
            }}
            style={{
              flex: 1,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 6px',
              fontSize: 12,
            }}
          />
          <button
            className="btn primary"
            data-testid="q-submit"
            disabled={!text.trim()}
            onClick={() => void store.answerUser(prompt.callId, text.trim())}
          >
            Answer
          </button>
        </div>
      ) : null}
    </Card>
  );
}

function StateBadge({ state }: { state: string }): React.JSX.Element {
  const color =
    state === 'AWAITING_PERMISSION' || state === 'REVIEW_READY'
      ? 'var(--warning)'
      : RUNNING_TASK_STATES.has(state)
        ? 'var(--info)'
        : state === 'ACCEPTED'
          ? 'var(--success)'
          : state === 'FAILED'
            ? 'var(--danger)'
            : 'var(--fg-muted)';
  return (
    <span
      data-testid="task-state"
      style={{
        border: `1px solid ${color}`,
        color,
        borderRadius: 4,
        padding: '1px 8px',
        fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      {state}
    </span>
  );
}

function Card(props: {
  icon: string;
  title: string;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  testid?: string;
  children?: React.ReactNode;
  collapsible?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(!props.collapsible);
  const border =
    props.tone === 'danger'
      ? 'var(--danger)'
      : props.tone === 'warning'
        ? 'var(--warning)'
        : props.tone === 'success'
          ? 'var(--success)'
          : 'var(--border)';
  return (
    <div
      data-testid={props.testid}
      style={{
        border: `1px solid ${border}`,
        borderRadius: 8,
        margin: '6px 10px',
        background: 'var(--bg-card)',
        fontSize: 12.5,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => props.collapsible && setOpen(!open)}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          color: 'var(--fg)',
          cursor: props.collapsible ? 'pointer' : 'default',
          textAlign: 'left',
        }}
      >
        <span aria-hidden>{props.icon}</span>
        <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {props.title}
        </span>
        {props.collapsible ? <span className="text-muted">{open ? '▾' : '▸'}</span> : null}
      </button>
      {open && props.children ? (
        <div style={{ padding: '0 10px 8px 10px', overflowWrap: 'anywhere' }}>{props.children}</div>
      ) : null}
    </div>
  );
}

interface TimelineContext {
  permissionResolutions: Map<string, { outcome: string; scope?: string | null }>;
  answeredCallIds: Set<string>;
}

function TimelineCard({
  event,
  context,
}: {
  event: TimelineEventDto;
  context: TimelineContext;
}): React.JSX.Element | null {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'permission.requested': {
      const card = payload.card as PermissionCardDto;
      return (
        <PermissionCard
          card={card}
          resolution={context.permissionResolutions.get(card.requestId) ?? null}
        />
      );
    }
    case 'permission.decided':
      return null; // shown as the resolved state of its request card
    case 'agent.question': {
      const prompt = payload.prompt as AskUserPromptDto;
      return <QuestionCard prompt={prompt} answered={context.answeredCallIds.has(prompt.callId)} />;
    }
    case 'user.message':
      return (
        <Card icon="🧑" title="You" testid="tl-user">
          <div style={{ whiteSpace: 'pre-wrap' }}>{String(payload.text ?? '')}</div>
        </Card>
      );
    case 'agent.message':
      return (
        <Card icon="🤖" title="Agent" testid="tl-agent">
          <div style={{ whiteSpace: 'pre-wrap' }}>{String(payload.text ?? '')}</div>
        </Card>
      );
    case 'tool.call': {
      const ok = payload.ok === true;
      const state = String(payload.state ?? '');
      const denied = state === 'DENIED';
      return (
        <Card
          icon={denied ? '⛔' : ok ? '🔧' : '⚠️'}
          title={`${String(payload.name)} — ${state}`}
          tone={denied ? 'warning' : ok ? 'default' : 'danger'}
          testid={`tl-tool-${String(payload.name)}`}
          collapsible
        >
          <div className="text-muted">{String(payload.summary ?? '')}</div>
          <pre
            className="mono"
            style={{ fontSize: 11, overflow: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap' }}
          >
            {JSON.stringify(payload.input ?? {}, null, 1)?.slice(0, 1500)}
          </pre>
        </Card>
      );
    }
    case 'agent.toolProposed':
      return null; // live-only hint; the terminal tool.call card follows
    case 'agent.usage': {
      const usage = payload.usage as
        { inputTokens?: number; outputTokens?: number; costUsd?: number | null } | undefined;
      return (
        <div
          className="text-muted"
          style={{ padding: '0 14px', fontSize: 11 }}
          data-testid="tl-usage"
        >
          tokens: {usage?.inputTokens ?? '?'} in / {usage?.outputTokens ?? '?'} out
          {usage?.costUsd != null ? ` · $${usage.costUsd.toFixed(4)}` : ''}
        </div>
      );
    }
    case 'task.stateChanged':
      return (
        <div className="text-muted" style={{ padding: '0 14px', fontSize: 11 }}>
          → {String(payload.to)}
        </div>
      );
    case 'run.failed': {
      const error = payload.error as { userMessage?: string; code?: string } | undefined;
      return (
        <Card
          icon="✖"
          title={`Run failed (${error?.code ?? 'unknown'})`}
          tone="danger"
          testid="tl-failed"
        >
          {error?.userMessage}
        </Card>
      );
    }
    case 'run.aborted':
      return (
        <Card icon="⏹" title="Stopped" tone="warning" testid="tl-aborted">
          The run was stopped ({String(payload.reason)}). Nothing was rolled back automatically.
        </Card>
      );
    case 'report.final': {
      const unverified = payload.unverified === true;
      return (
        <Card
          icon="📋"
          title="Final report"
          tone={unverified ? 'warning' : 'success'}
          testid="tl-report"
        >
          <div>Outcome: {String(payload.outcome)}</div>
          {unverified ? (
            <div className="text-warning">Unverified — no verification commands were run.</div>
          ) : null}
        </Card>
      );
    }
    case 'system.workerCrashed':
      return (
        <Card icon="💥" title="Agent worker crashed" tone="danger" testid="tl-crash">
          {String(payload.note ?? '')}
        </Card>
      );
    case 'system.interruptedByRestart':
      return (
        <Card icon="🔁" title="Interrupted by restart" tone="warning" testid="tl-restart">
          {String(payload.note ?? '')}
        </Card>
      );
    case 'system.diagnostic':
      return (
        <div className="text-muted" style={{ padding: '0 14px', fontSize: 11 }}>
          ⓘ {String(payload.detail ?? payload.code)}
        </div>
      );
    case 'task.created':
    case 'task.queued':
    case 'run.completed':
    case 'system.abortRequested':
      return null;
    default:
      return (
        <div className="text-muted" style={{ padding: '0 14px', fontSize: 11 }}>
          {event.type}
        </div>
      );
  }
}

export function AgentPanel(): React.JSX.Element {
  const store = useTaskStore();
  const workspace = useWorkspaceStore((s) => s.workspace);
  const task = activeTask(store);
  const [input, setInput] = useState('');
  const [sendMode, setSendMode] = useState<'steer' | 'followUp'>('steer');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    store.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [store.timeline.length, store.streaming?.text.length]);

  // Cross-event context: which permission requests are decided, which questions answered.
  // Computed before any early return so hook order stays stable (rules of hooks).
  const timelineContext: TimelineContext = React.useMemo(() => {
    const permissionResolutions = new Map<string, { outcome: string; scope?: string | null }>();
    const answeredCallIds = new Set<string>();
    for (const event of store.timeline) {
      const payload = event.payload as Record<string, unknown>;
      if (event.type === 'permission.decided' && typeof payload.requestId === 'string') {
        permissionResolutions.set(payload.requestId, {
          outcome: String(payload.outcome ?? ''),
          scope: (payload.scope as string | null) ?? null,
        });
      }
      if (event.type === 'user.message' && typeof payload.callId === 'string') {
        answeredCallIds.add(payload.callId);
      }
    }
    return { permissionResolutions, answeredCallIds };
  }, [store.timeline]);

  if (!workspace) {
    return (
      <div className="empty-state">
        <div className="es-title">Agent</div>
        <div>Open a workspace to create your first task.</div>
      </div>
    );
  }

  const running = task ? RUNNING_TASK_STATES.has(task.state) : false;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      data-testid="agent-panel-main"
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        {task ? (
          <>
            <span
              style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={task.title}
            >
              {task.title}
            </span>
            <StateBadge state={task.state} />
            {running ? (
              <button
                className="btn danger"
                data-testid="agent-stop"
                onClick={() => void store.stop()}
              >
                ⏹ Stop
              </button>
            ) : null}
          </>
        ) : (
          <span style={{ flex: 1 }} className="text-muted">
            No task selected
          </span>
        )}
        <button
          className="btn primary"
          data-testid="new-task-btn"
          onClick={() => store.setNewTaskOpen(true)}
        >
          ＋ Task
        </button>
      </div>

      {task ? (
        <div
          className="text-muted"
          style={{ padding: '4px 10px', fontSize: 11, borderBottom: '1px solid var(--border)' }}
        >
          {task.mode.toUpperCase()} · {task.model.providerId}/{task.model.modelId}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        data-testid="timeline"
      >
        {!task ? (
          <div className="empty-state">
            <div>Create a task to start working with the agent.</div>
          </div>
        ) : store.loadingTimeline ? (
          <div className="text-muted" style={{ padding: 12 }}>
            Loading timeline…
          </div>
        ) : (
          <>
            {store.timeline.map((event) => (
              <TimelineCard
                key={`${event.id}-${event.sequence}`}
                event={event}
                context={timelineContext}
              />
            ))}
            {store.streaming ? (
              <Card icon="🤖" title="Agent (streaming…)" testid="tl-streaming">
                <div style={{ whiteSpace: 'pre-wrap' }}>{store.streaming.text}</div>
              </Card>
            ) : null}
          </>
        )}
      </div>

      {task ? (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {running ? (
            <div style={{ display: 'flex', gap: 8, fontSize: 11 }} className="text-muted">
              <label>
                <input
                  type="radio"
                  checked={sendMode === 'steer'}
                  onChange={() => setSendMode('steer')}
                />{' '}
                steer now
              </label>
              <label>
                <input
                  type="radio"
                  checked={sendMode === 'followUp'}
                  onChange={() => setSendMode('followUp')}
                />{' '}
                queue for next turn
              </label>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 6 }}>
            <textarea
              data-testid="agent-input"
              placeholder={
                running
                  ? 'Send guidance to the running agent…'
                  : 'Send a message (starts a new run)…'
              }
              value={input}
              rows={2}
              style={{
                flex: 1,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 8px',
                resize: 'none',
                fontFamily: 'inherit',
              }}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim()) {
                    void store.send(input.trim(), sendMode);
                    setInput('');
                  }
                }
              }}
            />
            <button
              className="btn primary"
              data-testid="agent-send"
              disabled={input.trim().length === 0}
              onClick={() => {
                void store.send(input.trim(), sendMode);
                setInput('');
              }}
            >
              ↑
            </button>
          </div>
        </div>
      ) : null}

      {store.newTaskOpen ? <NewTaskDialog /> : null}
    </div>
  );
}
