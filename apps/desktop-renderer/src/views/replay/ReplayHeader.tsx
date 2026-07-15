import React from 'react';
import type { ReplayDepth, ReplaySessionDto, TaskDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import { LEVEL_LABEL, formatDurationShort, labelSource } from './replay-model.js';

const DEPTHS: Array<{ id: ReplayDepth; name: string; hint: string }> = [
  { id: 'recap', name: '回顾', hint: '先看结果' },
  { id: 'explore', name: '探索', hint: '沿时间追问' },
  { id: 'verify', name: '核验', hint: '查看证据' },
];

/** Header + coverage summary. Never a single synthetic confidence number. */
export function ReplayHeader({
  task,
  session,
  source,
  depth,
  onDepth,
  onClose,
}: {
  task: TaskDto;
  session: ReplaySessionDto | null;
  source: string;
  depth: ReplayDepth;
  onDepth(depth: ReplayDepth): void;
  onClose(): void;
}): React.JSX.Element {
  const coverageSummary = session ? coverageText(session) : '';
  return (
    <header className="rp-head">
      <div className="rp-title-mark" aria-hidden>
        R
      </div>
      <div className="rp-title">
        <strong>{task.title}</strong>
        <span>
          {new Date(task.createdAt).toLocaleString()}
          {session
            ? ` · ${formatDurationShort(session.actualDurationMs)} actual · ${formatDurationShort(session.storyDurationMs)} recap`
            : ''}
        </span>
      </div>
      <nav className="rp-depth-nav" aria-label="Replay depth">
        {DEPTHS.map((entry, index) => (
          <button
            key={entry.id}
            className={depth === entry.id ? 'active' : ''}
            onClick={() => onDepth(entry.id)}
            data-testid={`replay-depth-${entry.id}`}
            aria-current={depth === entry.id ? 'page' : undefined}
          >
            <b>{index + 1}</b>
            <span>
              <strong>{entry.name}</strong>
              <small>{entry.hint}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="rp-source" data-testid="replay-source">
        <span>
          <strong>{labelSource(source)}</strong>
          <small>{coverageSummary}</small>
        </span>
      </div>
      <button className="btn rp-close" data-testid="replay-close" onClick={onClose}>
        <Ic name="x" size={14} />
        Close
      </button>
    </header>
  );
}

/** Measured coverage, labeled as coverage — never as confidence. */
export function coverageText(session: ReplaySessionDto): string {
  const total = session.coverage.reduce((sum, c) => sum + (c.actualEndMs - c.actualStartMs), 0);
  if (total <= 0) return '';
  const byLevel = new Map<string, number>();
  for (const segment of session.coverage) {
    byLevel.set(
      segment.level,
      (byLevel.get(segment.level) ?? 0) + (segment.actualEndMs - segment.actualStartMs),
    );
  }
  return ['verified', 'recorded', 'observed', 'missing']
    .map((level) => {
      const ms = byLevel.get(level) ?? 0;
      if (ms <= 0) return null;
      return `${LEVEL_LABEL[level as keyof typeof LEVEL_LABEL]} ${Math.round((ms / total) * 100)}%`;
    })
    .filter(Boolean)
    .join(' · ');
}
