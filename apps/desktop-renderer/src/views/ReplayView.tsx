import React, { useEffect, useMemo, useState } from 'react';
import type { ActivityItem } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useTaskStore, activeTask } from '../store/taskStore.js';
import { PathChips } from './PathLinks.js';
import { Ic } from './home-icons.js';

/** Ic icon per activity kind (PIVOT-023: no emoji in chrome). */
const KIND_ICON: Record<string, string> = {
  message: 'bot',
  question: 'help',
  answer: 'user',
  plan: 'map',
  'plan-decision': 'check',
  read: 'file',
  search: 'search',
  command: 'terminal',
  write: 'pencil',
  permission: 'shield',
  verification: 'checkCircle',
  review: 'eye',
  state: 'info',
  report: 'clipboard',
  system: 'sliders',
  user: 'user',
};

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--info)',
  ok: 'var(--success)',
  error: 'var(--danger)',
  denied: 'var(--warning)',
  pending: 'var(--warning)',
  warn: 'var(--warning)',
  info: 'var(--fg-muted)',
};

function DiffPane(props: { path: string; patch: string | null }): React.JSX.Element {
  if (!props.patch) {
    return (
      <div className="text-muted" style={{ fontSize: 11.5, padding: '6px 0' }}>
        No stored patch for this change (binary or direct write) — hashes are recorded.
      </div>
    );
  }
  return (
    <pre
      className="mono"
      data-testid="replay-diff"
      style={{
        fontSize: 11,
        lineHeight: 1.5,
        overflow: 'auto',
        maxHeight: 220,
        margin: '6px 0 0',
        padding: 8,
        background: 'var(--bg-editor)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      {props.patch.split('\n').map((line, i) => (
        <div
          key={i}
          style={{
            background: line.startsWith('+')
              ? 'var(--diff-add-bg)'
              : line.startsWith('-')
                ? 'var(--diff-del-bg)'
                : 'transparent',
            color: line.startsWith('@@') ? 'var(--info)' : undefined,
            whiteSpace: 'pre-wrap',
          }}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

/**
 * Session replay (PIVOT-017, ADR-0006): scrub through what the agent DID —
 * every message, question, command, search, permission and edit, in order,
 * from the recorded log. Strictly read-only; the working tree never changes.
 */
export function ReplayView(): React.JSX.Element | null {
  const store = useTaskStore();
  const task = activeTask(store);
  const open = store.replayOpen;
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [diff, setDiff] = useState<{ path: string; patch: string | null } | null>(null);

  const taskId = task?.id ?? null;
  useEffect(() => {
    if (!open || !taskId) return;
    setItems(null);
    setPlaying(false);
    void rpcResult('task.activity', { taskId }).then((res) => {
      if (res.ok) {
        setItems(res.data.items);
        setIdx(0);
      }
    });
  }, [open, taskId]);

  const current = items?.[idx] ?? null;

  // Fetch the stored per-step patch for write steps.
  const changeId = current?.changeIds?.[0] ?? null;
  useEffect(() => {
    setDiff(null);
    if (!changeId || !taskId) return;
    void rpcResult('task.changeRecord', { taskId, changeId }).then((res) => {
      if (res.ok && res.data.record) {
        setDiff({ path: res.data.record.path, patch: res.data.record.patch });
      }
    });
  }, [changeId, taskId]);

  // Playback: one step ~ every 650ms until the end.
  useEffect(() => {
    if (!playing || !items) return;
    const timer = setInterval(() => {
      setIdx((i) => {
        if (i >= items.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 650);
    return () => clearInterval(timer);
  }, [playing, items]);

  // Keyboard: ←/→ step, space toggles playback, Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        store.closeReplay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, (items?.length ?? 1) - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items]);

  // File lens: everything touched up to the current step; later files dimmed.
  const lens = useMemo(() => {
    if (!items) return { touched: [] as string[], future: [] as string[] };
    const touched: string[] = [];
    const future: string[] = [];
    items.forEach((item, i) => {
      for (const path of item.paths) {
        if (i <= idx) {
          if (!touched.includes(path)) touched.push(path);
        } else if (!touched.includes(path) && !future.includes(path)) {
          future.push(path);
        }
      }
    });
    return { touched, future };
  }, [items, idx]);

  if (!open || !task) return null;

  return (
    <div
      data-testid="replay-view"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 45,
        background: 'var(--bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) store.closeReplay();
      }}
    >
      <div
        style={{
          width: 'min(760px, 94vw)',
          maxHeight: '86vh',
          overflow: 'auto',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '14px 16px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          <span style={{ fontWeight: 650 }}>Session replay</span>
          <span className="text-muted" style={{ fontSize: 12 }}>
            what the agent did, step by step — read-only
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn" data-testid="replay-close" onClick={() => store.closeReplay()}>
            ✕ Close
          </button>
        </div>
        <div
          className="text-muted"
          style={{
            fontSize: 12,
            marginBottom: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.title}
        </div>

        {items === null ? (
          <div className="text-muted" style={{ padding: 16 }}>
            Loading the recorded session…
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted" style={{ padding: 16 }}>
            Nothing recorded yet for this task.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn"
                data-testid="replay-play"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => setPlaying(!playing)}
              >
                <Ic name={playing ? 'pause' : 'play'} size={13} />
              </button>
              <button
                className="btn"
                data-testid="replay-prev"
                aria-label="Previous step"
                disabled={idx === 0}
                onClick={() => setIdx(Math.max(0, idx - 1))}
              >
                ←
              </button>
              <input
                type="range"
                data-testid="replay-scrubber"
                min={0}
                max={items.length - 1}
                value={idx}
                style={{ flex: 1 }}
                onChange={(e) => {
                  setPlaying(false);
                  setIdx(Number(e.target.value));
                }}
              />
              <button
                className="btn"
                data-testid="replay-next"
                aria-label="Next step"
                disabled={idx >= items.length - 1}
                onClick={() => setIdx(Math.min(items.length - 1, idx + 1))}
              >
                →
              </button>
              <span
                className="text-muted"
                style={{ fontSize: 12, flex: 'none' }}
                data-testid="replay-count"
              >
                step {idx + 1} / {items.length}
              </span>
            </div>

            {current ? (
              <div
                data-testid="replay-step"
                style={{
                  marginTop: 12,
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${STATUS_COLOR[current.status] ?? 'var(--border)'}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden style={{ color: 'var(--fg-muted)', display: 'flex' }}>
                    <Ic name={KIND_ICON[current.kind] ?? 'info'} size={13} />
                  </span>
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{current.label}</span>
                  <span
                    className="text-muted"
                    style={{
                      fontSize: 10.5,
                      border: '1px solid var(--border)',
                      borderRadius: 999,
                      padding: '0 7px',
                    }}
                  >
                    {current.author}
                  </span>
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {new Date(current.at).toLocaleTimeString()}
                  {typeof current.durationMs === 'number'
                    ? ` · ${(current.durationMs / 1000).toFixed(current.durationMs < 10000 ? 1 : 0)}s`
                    : ''}
                  {current.diffstat
                    ? ` · +${current.diffstat.additions} −${current.diffstat.deletions}`
                    : ''}
                </div>
                {current.detail ? (
                  <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    {current.detail}
                  </div>
                ) : null}
                {diff ? <DiffPane path={diff.path} patch={diff.patch} /> : null}
              </div>
            ) : null}

            <div data-testid="replay-files" style={{ marginTop: 12 }}>
              <div
                className="text-muted"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Files at this point · {lens.touched.length}
              </div>
              <PathChips paths={lens.touched} testidPrefix="replay-file" />
              {lens.future.length > 0 ? (
                <div style={{ opacity: 0.4, marginTop: 4 }}>
                  <PathChips paths={lens.future} testidPrefix="replay-future" />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
