import React, { useEffect, useRef, useState } from 'react';
import type { TimelineEventDto } from '@pi-ide/ipc-contracts';
import { useTaskStore, activeTask, RUNNING_TASK_STATES } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { NewTaskDialog } from './NewTaskDialog.js';

function StateBadge({ state }: { state: string }): React.JSX.Element {
  const color = RUNNING_TASK_STATES.has(state)
    ? 'var(--info)'
    : state === 'REVIEW_READY'
      ? 'var(--warning)'
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

function TimelineCard({ event }: { event: TimelineEventDto }): React.JSX.Element | null {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
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
              <TimelineCard key={`${event.id}-${event.sequence}`} event={event} />
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
