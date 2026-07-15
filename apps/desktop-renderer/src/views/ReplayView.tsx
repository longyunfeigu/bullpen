import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityItem } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useTaskStore, activeTask } from '../store/taskStore.js';
import { Ic } from './home-icons.js';
import {
  appForActivity,
  buildReplayTimeline,
  chapterItems,
  confidenceForActivity,
  evidenceKinds,
  formatReplayTime,
  indexAtTime,
  isDecision,
  replayGrade,
  replaySource,
  type ReplayMode,
} from './replay-model.js';
import '../styles/replay.css';

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

const MODES: Array<{ id: ReplayMode; name: string; hint: string }> = [
  { id: 'A', name: '回放', hint: '视频式总览' },
  { id: 'D', name: '详情', hint: '长任务纪录片' },
  { id: 'E', name: '审计', hint: '审批与证据' },
  { id: 'B', name: '因果', hint: '可观察决策链' },
  { id: 'C', name: '应用', hint: '跨应用工作流' },
];

interface ChangeFrame {
  path: string;
  patch: string | null;
  beforeText: string | null;
  afterText: string | null;
  binary: boolean;
}

function labelSource(source: string): string {
  if (source === 'pi') return 'Pi Home';
  if (source === 'claude') return 'Claude Terminal';
  if (source === 'codex') return 'Codex Terminal';
  return 'External Terminal';
}

function labelGrade(grade: string): string {
  if (grade === 'full') return '完整记录';
  if (grade === 'structured') return '结构化记录';
  return '观察记录';
}

function shortLabel(item: ActivityItem): string {
  return item.label.length > 52 ? `${item.label.slice(0, 51)}…` : item.label;
}

function EventIcon({ item, size = 14 }: { item: ActivityItem; size?: number }): React.JSX.Element {
  return <Ic name={KIND_ICON[item.kind] ?? 'info'} size={size} />;
}

function DiffPane({ patch }: { patch: string | null }): React.JSX.Element {
  if (!patch) {
    return <div className="rp-empty-note">No textual patch stored for this change.</div>;
  }
  return (
    <pre className="rp-patch mono" data-testid="replay-diff">
      {patch.split('\n').map((line, index) => (
        <span
          key={`${index}-${line.slice(0, 12)}`}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'del'
                : line.startsWith('@@')
                  ? 'hunk'
                  : ''
          }
        >
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function ActionCard({ item, frame }: { item: ActivityItem; frame: ChangeFrame | null }) {
  return (
    <section className="rp-action-card" data-testid="replay-step" data-kind={item.kind}>
      <header>
        <span className={`rp-kind-icon status-${item.status}`}>
          <EventIcon item={item} size={16} />
        </span>
        <div>
          <strong>{item.label}</strong>
          <div className="rp-meta-line">
            {new Date(item.at).toLocaleTimeString()} · {item.author}
            {typeof item.durationMs === 'number'
              ? ` · ${(item.durationMs / 1000).toFixed(item.durationMs < 10_000 ? 1 : 0)}s`
              : ''}
            {item.diffstat ? ` · +${item.diffstat.additions} −${item.diffstat.deletions}` : ''}
          </div>
        </div>
        <span className={`rp-status status-${item.status}`}>{item.status}</span>
      </header>
      {item.detail ? <pre className="rp-action-detail mono">{item.detail}</pre> : null}
      {frame ? <DiffPane patch={frame.patch} /> : null}
    </section>
  );
}

function EvidenceRail({
  items,
  currentIndex,
  offsets,
  onSeek,
}: {
  items: ActivityItem[];
  currentIndex: number;
  offsets: number[];
  onSeek: (ms: number) => void;
}) {
  const evidence = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => index <= currentIndex && evidenceKinds(item).length > 0)
    .slice(-12)
    .reverse();
  return (
    <aside className="rp-evidence" aria-label="Evidence at this point">
      <div className="rp-panel-title">
        <span>证据</span>
        <span>{evidence.length}</span>
      </div>
      <div className="rp-evidence-list">
        {evidence.map(({ item, index }) => (
          <button key={`${item.key}-${index}`} onClick={() => onSeek(offsets[index] ?? 0)}>
            <span className={`rp-evidence-icon evidence-${evidenceKinds(item)[0] ?? 'message'}`}>
              <EventIcon item={item} size={13} />
            </span>
            <span>
              <small>{formatReplayTime(offsets[index] ?? 0)}</small>
              <strong>{shortLabel(item)}</strong>
              <em>{evidenceKinds(item).join(' · ')}</em>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CinematicView({
  items,
  current,
  currentIndex,
  frame,
  offsets,
  grade,
  onSeek,
}: {
  items: ActivityItem[];
  current: ActivityItem;
  currentIndex: number;
  frame: ChangeFrame | null;
  offsets: number[];
  grade: string;
  onSeek: (ms: number) => void;
}) {
  const chapters = chapterItems(items);
  const touched = [...new Set(items.slice(0, currentIndex + 1).flatMap((item) => item.paths))];
  return (
    <div className="rp-cinematic">
      <main className="rp-cinema-main">
        <div className="rp-stage" data-testid="replay-step">
          <div className="rp-stage-caption">
            <EventIcon item={current} size={12} />
            <strong>{current.label}</strong>
          </div>
          {frame && !frame.binary ? (
            <div className="rp-version-stage">
              <section>
                <span>之前</span>
                <pre className="mono">{frame.beforeText ?? '∅  File did not exist'}</pre>
              </section>
              <div className="rp-stage-arrow" aria-hidden>
                <Ic name="chevron" size={22} />
              </div>
              <section className="after">
                <span>之后 · {frame.path}</span>
                <pre className="mono">{frame.afterText ?? '∅  File deleted'}</pre>
              </section>
              <pre className="rp-compat-patch" data-testid="replay-diff">
                {frame.patch ?? ''}
              </pre>
            </div>
          ) : (
            <div className="rp-action-stage">
              <div className="rp-stage-orbit" aria-hidden />
              <span className={`rp-stage-icon status-${current.status}`}>
                <EventIcon item={current} size={30} />
              </span>
              <small>{appForActivity(current)}</small>
              <h2>{current.label}</h2>
              {current.detail ? <pre className="mono">{current.detail}</pre> : null}
              <div className="rp-stage-proof">
                {evidenceKinds(current).map((kind) => (
                  <span key={kind}>{kind}</span>
                ))}
              </div>
            </div>
          )}
          {grade === 'observed' && current.kind !== 'write' ? (
            <div className="rp-observed-stamp">OBSERVED · not provider-verified</div>
          ) : null}
          <div className="rp-file-trail" data-testid="replay-files">
            {touched.slice(-4).map((path) => (
              <span key={path}>{path}</span>
            ))}
          </div>
        </div>
        <div className="rp-chapters">
          <div className="rp-panel-title">
            <span>章节</span>
            <span>{chapters.length}</span>
          </div>
          <div className="rp-chapter-strip">
            {chapters.map((item) => {
              const index = items.indexOf(item);
              const selected = index === currentIndex;
              return (
                <button
                  className={selected ? 'active' : ''}
                  key={`${item.key}-${index}`}
                  onClick={() => onSeek(offsets[index] ?? 0)}
                >
                  <span className="rp-chapter-preview">
                    <EventIcon item={item} size={20} />
                  </span>
                  <small>{formatReplayTime(offsets[index] ?? 0)}</small>
                  <strong>{shortLabel(item)}</strong>
                </button>
              );
            })}
          </div>
        </div>
      </main>
      <EvidenceRail items={items} currentIndex={currentIndex} offsets={offsets} onSeek={onSeek} />
    </div>
  );
}

function CausalView({
  items,
  currentIndex,
  offsets,
  grade,
  onSeek,
}: {
  items: ActivityItem[];
  currentIndex: number;
  offsets: number[];
  grade: string;
  onSeek: (ms: number) => void;
}) {
  const nodes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== 'state' || item.status !== 'info')
    .slice(0, 80);
  return (
    <div className="rp-causal" data-grade={grade}>
      <div className="rp-map-axis">
        <span>00:00</span>
        <i />
        <span>{formatReplayTime(offsets.at(-1) ?? 0)}</span>
      </div>
      <div className="rp-node-flow">
        {nodes.map(({ item, index }) => (
          <button
            key={`${item.key}-${index}`}
            className={`${index === currentIndex ? 'active' : ''} ${isDecision(item) ? 'decision' : ''}`}
            data-testid={`replay-causal-${index}`}
            onClick={() => onSeek(offsets[index] ?? 0)}
          >
            <small>
              {formatReplayTime(offsets[index] ?? 0)} ·{' '}
              {isDecision(item) ? 'Decision' : appForActivity(item)}
            </small>
            <span className={`rp-node-icon status-${item.status}`}>
              <EventIcon item={item} size={14} />
            </span>
            <strong>{shortLabel(item)}</strong>
            <em>{evidenceKinds(item).join(' + ') || 'event'}</em>
          </button>
        ))}
      </div>
      <div className="rp-causal-key">
        <span>蓝色：输入/消息</span>
        <span>绿色：动作/输出</span>
        <span>橙色：有证据的决策点</span>
        {grade === 'observed' ? <b>虚线：终端观察无法证明“为什么”</b> : null}
      </div>
    </div>
  );
}

function SpatialView({
  items,
  currentIndex,
  offsets,
  onSeek,
}: {
  items: ActivityItem[];
  currentIndex: number;
  offsets: number[];
  onSeek: (ms: number) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Array<{ item: ActivityItem; index: number }>>();
    items.forEach((item, index) => {
      const app = appForActivity(item);
      const list = map.get(app) ?? [];
      list.push({ item, index });
      map.set(app, list);
    });
    return [...map.entries()].slice(0, 9);
  }, [items]);
  return (
    <div className="rp-spatial">
      <div className="rp-spatial-grid" aria-hidden />
      <div className="rp-spatial-core">
        <Ic name="bot" size={24} />
        <strong>Agent</strong>
        <small>{items.length} events</small>
      </div>
      {groups.map(([app, appItems], appIndex) => {
        const latest =
          [...appItems].reverse().find(({ index }) => index <= currentIndex) ?? appItems[0]!;
        return (
          <button
            key={app}
            className={`rp-app-node node-${appIndex + 1} ${latest.index === currentIndex ? 'active' : ''}`}
            onClick={() => onSeek(offsets[latest.index] ?? 0)}
          >
            <span>
              <EventIcon item={latest.item} size={20} />
            </span>
            <strong>{app}</strong>
            <small>
              {appItems.length} verified event{appItems.length === 1 ? '' : 's'}
            </small>
            <em>{latest.item.resource ?? shortLabel(latest.item)}</em>
          </button>
        );
      })}
    </div>
  );
}

function DetailView({
  items,
  current,
  currentIndex,
  offsets,
  frame,
  onSeek,
}: {
  items: ActivityItem[];
  current: ActivityItem;
  currentIndex: number;
  offsets: number[];
  frame: ChangeFrame | null;
  onSeek: (ms: number) => void;
}) {
  const [filter, setFilter] = useState('all');
  const filtered = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => filter === 'all' || item.kind === filter)
    .slice(-600);
  const kinds = [...new Set(items.map((item) => item.kind))];
  return (
    <div className="rp-detail">
      <aside className="rp-event-list">
        <div className="rp-detail-filter">
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">全部事件 · {items.length}</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
        {filtered.map(({ item, index }) => (
          <button
            key={`${item.key}-${index}`}
            className={index === currentIndex ? 'active' : ''}
            onClick={() => onSeek(offsets[index] ?? 0)}
          >
            <time>{formatReplayTime(offsets[index] ?? 0)}</time>
            <span className={`status-${item.status}`}>
              <EventIcon item={item} size={14} />
            </span>
            <span>
              <strong>{shortLabel(item)}</strong>
              <small>
                {item.toolName === 'terminal' && item.detail
                  ? item.detail.replace(/\s+/g, ' ').slice(0, 90)
                  : appForActivity(item)}
              </small>
            </span>
          </button>
        ))}
      </aside>
      <div className="rp-detail-inspector">
        <ActionCard item={current} frame={frame} />
        <section className="rp-detail-facts">
          <div>
            <span>Source</span>
            <strong>{labelSource(current.source ?? 'pi')}</strong>
          </div>
          <div>
            <span>Capture</span>
            <strong>{labelGrade(current.captureGrade ?? 'full')}</strong>
          </div>
          <div>
            <span>Evidence</span>
            <strong>{evidenceKinds(current).join(', ') || 'event log'}</strong>
          </div>
          <div>
            <span>Sequence</span>
            <strong>#{current.sequence}</strong>
          </div>
        </section>
      </div>
    </div>
  );
}

function AuditView({
  items,
  currentIndex,
  offsets,
  onSeek,
}: {
  items: ActivityItem[];
  currentIndex: number;
  offsets: number[];
  onSeek: (ms: number) => void;
}) {
  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => evidenceKinds(item).length > 0)
    .slice(-400);
  const averageConfidence = rows.length
    ? Math.round(rows.reduce((sum, { item }) => sum + confidenceForActivity(item), 0) / rows.length)
    : 0;
  const artifacts = new Set(rows.flatMap(({ item }) => item.paths)).size;
  return (
    <div className="rp-audit">
      <div className="rp-audit-summary">
        <div>
          <span>Outcome</span>
          <strong>
            {items.at(-1)?.status === 'error' ? 'Needs attention' : 'Replay recorded'}
          </strong>
        </div>
        <div>
          <span>Evidence confidence</span>
          <strong>{averageConfidence}%</strong>
        </div>
        <div>
          <span>Artifacts</span>
          <strong>{artifacts} resources</strong>
        </div>
        <div>
          <span>Checkpoints</span>
          <strong>{rows.filter(({ item }) => isDecision(item)).length}</strong>
        </div>
      </div>
      <div className="rp-audit-table-wrap">
        <table className="rp-audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Claim / Step</th>
              <th>Evidence</th>
              <th>Confidence</th>
              <th>Checkpoint</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, index }) => {
              const confidence = confidenceForActivity(item);
              return (
                <tr
                  key={`${item.key}-${index}`}
                  className={index === currentIndex ? 'active' : ''}
                  onClick={() => onSeek(offsets[index] ?? 0)}
                >
                  <td>{formatReplayTime(offsets[index] ?? 0)}</td>
                  <td>
                    <strong>{item.label}</strong>
                    <small>{appForActivity(item)}</small>
                  </td>
                  <td>
                    {evidenceKinds(item).map((kind) => (
                      <span key={kind}>{kind}</span>
                    ))}
                  </td>
                  <td>
                    <b className={confidence >= 85 ? 'high' : confidence >= 70 ? 'medium' : 'low'}>
                      {confidence}%
                    </b>
                  </td>
                  <td>{isDecision(item) ? <i>{index + 1}</i> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LimitBanner({ mode, grade }: { mode: ReplayMode; grade: string }) {
  if (grade === 'full') return null;
  const structured: Record<ReplayMode, string> = {
    A: 'Provider events and file versions are available; raw private reasoning is intentionally excluded.',
    B: 'This map shows observable plans, tool calls and results—not private chain-of-thought.',
    C: 'Only applications and resources explicitly named by provider/MCP events are shown.',
    D: 'Structured filters are available alongside the bounded, redacted terminal recording.',
    E: 'Confidence reflects emitted approvals and evidence; it is not inferred from prose.',
  };
  const observed: Record<ReplayMode, string> = {
    A: 'Terminal observation: visual output and each observed file version are replayable; unrecorded internal steps are omitted.',
    B: 'A plain TUI cannot prove why a decision was made. Decision nodes remain visibly unverified.',
    C: 'Terminal pixels cannot establish cross-app identity. Only Files, Terminal and explicitly named resources appear.',
    D: 'Raw terminal and file history are available. Semantic filters improve when provider JSON events are detected.',
    E: 'Entry snapshot, file versions and rollback are auditable; internal approvals are unavailable unless emitted.',
  };
  return (
    <div className={`rp-limit grade-${grade}`}>
      <Ic name={grade === 'structured' ? 'checkCircle' : 'alert'} size={14} />
      <span>{grade === 'structured' ? structured[mode] : observed[mode]}</span>
    </div>
  );
}

export function ReplayView(): React.JSX.Element | null {
  const store = useTaskStore();
  const task = activeTask(store);
  const open = store.replayOpen;
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [mode, setMode] = useState<ReplayMode>('A');
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frame, setFrame] = useState<ChangeFrame | null>(null);
  const initializedTask = useRef<string | null>(null);

  const taskId = task?.id ?? null;
  useEffect(() => {
    if (!open || !taskId) return;
    let disposed = false;
    const load = async () => {
      const result = await rpcResult('task.activity', { taskId });
      if (!disposed && result.ok) {
        setItems(result.data.items);
        if (initializedTask.current !== taskId) {
          initializedTask.current = taskId;
          setPlayhead(0);
          setPlaying(false);
          setMode('A');
        }
      }
    };
    setItems(null);
    void load();
    const timer = setInterval(() => void load(), 2_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [open, taskId]);

  const timeline = useMemo(() => buildReplayTimeline(items ?? []), [items]);
  const currentIndex = useMemo(
    () => indexAtTime(timeline.offsets, playhead),
    [timeline.offsets, playhead],
  );
  const current = items?.[currentIndex] ?? null;
  const source = replaySource(items ?? []);
  const grade = replayGrade(items ?? []);

  useEffect(() => {
    if (!playing || timeline.durationMs <= 0) return;
    let frameId = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.max(0, now - previous);
      previous = now;
      setPlayhead((value) => {
        const next = Math.min(timeline.durationMs, value + delta * speed);
        if (next >= timeline.durationMs) setPlaying(false);
        return next;
      });
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, speed, timeline.durationMs]);

  const changeId = current?.changeIds?.[0] ?? null;
  useEffect(() => {
    let disposed = false;
    setFrame(null);
    if (!changeId || !taskId) return;
    void Promise.all([
      rpcResult('task.changeRecord', { taskId, changeId }),
      rpcResult('task.changeEvidence', { taskId, changeId }),
    ]).then(([recordResult, evidenceResult]) => {
      if (disposed || !recordResult.ok || !recordResult.data.record) return;
      const evidence = evidenceResult.ok ? evidenceResult.data.evidence : null;
      setFrame({
        path: recordResult.data.record.path,
        patch: recordResult.data.record.patch,
        beforeText: evidence?.beforeText ?? null,
        afterText: evidence?.afterText ?? null,
        binary: evidence?.binary ?? false,
      });
    });
    return () => {
      disposed = true;
    };
  }, [changeId, taskId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        store.closeReplay();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = Math.min((items?.length ?? 1) - 1, currentIndex + 1);
        setPlayhead(timeline.offsets[next] ?? timeline.durationMs);
        setPlaying(false);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const previous = Math.max(0, currentIndex - 1);
        setPlayhead(timeline.offsets[previous] ?? 0);
        setPlaying(false);
      } else if (event.key === ' ') {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, items, currentIndex, timeline, store]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('replay-active');
    return () => document.documentElement.classList.remove('replay-active');
  }, [open]);

  if (!open || !task) return null;

  const seek = (next: number) => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(timeline.durationMs, next)));
  };

  return (
    <div className="rp-root" data-testid="replay-view" data-mode={mode} data-grade={grade}>
      <header className="rp-head">
        <div className="rp-title-mark">{mode}</div>
        <div className="rp-title">
          <strong>{task.title}</strong>
          <span>
            {new Date(task.createdAt).toLocaleString()} · {formatReplayTime(timeline.durationMs)}
          </span>
        </div>
        <div className="rp-source" data-testid="replay-source">
          <i className={`grade-${grade}`} />
          <span>
            <strong>{labelSource(source)}</strong>
            <small>{labelGrade(grade)}</small>
          </span>
        </div>
        <button className="btn rp-close" data-testid="replay-close" onClick={store.closeReplay}>
          <Ic name="x" size={14} />
          Close
        </button>
      </header>

      <nav className="rp-mode-nav" aria-label="Replay projection">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            className={mode === entry.id ? 'active' : ''}
            onClick={() => setMode(entry.id)}
            data-testid={`replay-mode-${entry.id.toLowerCase()}`}
          >
            <b>{entry.id}</b>
            <span>
              <strong>{entry.name}</strong>
              <small>{entry.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <LimitBanner mode={mode} grade={grade} />

      <div className="rp-body">
        {items === null ? (
          <div className="rp-loading">Loading the recorded session…</div>
        ) : items.length === 0 || !current ? (
          <div className="rp-loading">Nothing has been recorded for this task yet.</div>
        ) : mode === 'A' ? (
          <CinematicView
            items={items}
            current={current}
            currentIndex={currentIndex}
            frame={frame}
            offsets={timeline.offsets}
            grade={grade}
            onSeek={seek}
          />
        ) : mode === 'B' ? (
          <CausalView
            items={items}
            currentIndex={currentIndex}
            offsets={timeline.offsets}
            grade={grade}
            onSeek={seek}
          />
        ) : mode === 'C' ? (
          <SpatialView
            items={items}
            currentIndex={currentIndex}
            offsets={timeline.offsets}
            onSeek={seek}
          />
        ) : mode === 'D' ? (
          <DetailView
            items={items}
            current={current}
            currentIndex={currentIndex}
            offsets={timeline.offsets}
            frame={frame}
            onSeek={seek}
          />
        ) : (
          <AuditView
            items={items}
            currentIndex={currentIndex}
            offsets={timeline.offsets}
            onSeek={seek}
          />
        )}
      </div>

      {items && items.length > 0 ? (
        <footer className="rp-player">
          <button
            className="rp-skip"
            data-testid="replay-prev"
            disabled={currentIndex === 0}
            onClick={() => seek(timeline.offsets[Math.max(0, currentIndex - 1)] ?? 0)}
            aria-label="Previous event"
          >
            <span>←</span>
          </button>
          <button
            className="rp-play"
            data-testid="replay-play"
            onClick={() => {
              if (playhead >= timeline.durationMs) setPlayhead(0);
              setPlaying((value) => !value);
            }}
          >
            <Ic name={playing ? 'pause' : 'play'} size={14} />
            {playing ? 'Pause' : 'Replay'}
          </button>
          <button
            className="rp-skip"
            data-testid="replay-next"
            disabled={currentIndex >= items.length - 1}
            onClick={() =>
              seek(timeline.offsets[Math.min(items.length - 1, currentIndex + 1)] ?? 0)
            }
            aria-label="Next event"
          >
            <span>→</span>
          </button>
          <time>
            {formatReplayTime(playhead)} / {formatReplayTime(timeline.durationMs)}
          </time>
          <div className="rp-track-wrap">
            <input
              type="range"
              data-testid="replay-scrubber"
              min={0}
              max={timeline.durationMs}
              step={Math.max(1, Math.floor(timeline.durationMs / 5000))}
              value={Math.min(playhead, timeline.durationMs)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="Replay timeline"
            />
            <div className="rp-track-marks" aria-hidden>
              {items.slice(0, 160).map((item, index) => (
                <i
                  key={`${item.key}-${index}`}
                  className={`kind-${item.kind} status-${item.status}`}
                  style={{
                    left: `${((timeline.offsets[index] ?? 0) / timeline.durationMs) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
          <span className="rp-count" data-testid="replay-count">
            step {currentIndex + 1} / {items.length}
          </span>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            {[1, 2, 4, 8, 16].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </footer>
      ) : null}
    </div>
  );
}
