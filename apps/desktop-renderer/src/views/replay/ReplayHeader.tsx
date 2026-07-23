import React, { useEffect, useState } from 'react';
import type { ReplayDepth, ReplaySessionDto, TaskDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import { LEVEL_LABEL, formatDurationShort, labelSource } from './replay-model.js';

const DEPTHS: Array<{ id: ReplayDepth; name: string; hint: string }> = [
  { id: 'recap', name: 'Recap', hint: 'Start with the result' },
  { id: 'explore', name: 'Explore', hint: 'Follow the timeline' },
  { id: 'verify', name: 'Verify', hint: 'Inspect the evidence' },
];

/** Header + coverage summary. Never a single synthetic confidence number. */
export function ReplayHeader({
  task,
  session,
  source,
  depth,
  onDepth,
  onJumpResult,
  onClose,
}: {
  task: TaskDto;
  session: ReplaySessionDto | null;
  source: string;
  depth: ReplayDepth;
  onDepth(depth: ReplayDepth): void;
  onJumpResult(): void;
  onClose(): void;
}): React.JSX.Element {
  const coverageSummary = session ? coverageText(session) : '';
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [depth]);

  return (
    <header className="rp-head">
      <button className="rp-back" data-testid="replay-back" onClick={onClose}>
        <Ic name="chevron" size={17} className="rp-back-icon" />
        Back to session
      </button>
      <div className="rp-title">
        <strong>Session Replay</strong>
        <span>
          <b>{task.title}</b>
          {session ? (
            <>
              <i className={`rp-outcome-dot outcome-${session.outcome}`} aria-hidden />
              {session.outcomeLabel}
              <em> · </em>
              Elapsed {formatDurationShort(session.actualDurationMs)}
            </>
          ) : null}
        </span>
      </div>
      <span className="rp-source-sr" data-testid="replay-source">
        {labelSource(source)} · {coverageSummary || 'Waiting for records'}
      </span>
      <div className="rp-head-actions">
        <button className="rp-jump-result" data-testid="replay-jump-result" onClick={onJumpResult}>
          Jump to result
        </button>
        <div className="rp-view-menu">
          <button
            className="rp-menu-toggle"
            data-testid="replay-menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Replay view and source"
          >
            <Ic name="sliders" size={17} />
          </button>
          {menuOpen ? (
            <div className="rp-menu-popover" data-testid="replay-menu">
              <div className="rp-source">
                <span>
                  <strong>{labelSource(source)}</strong>
                  <small>{coverageSummary || 'Waiting for records'}</small>
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
            </div>
          ) : null}
        </div>
        <button
          className="rp-close"
          data-testid="replay-close"
          onClick={onClose}
          aria-label="Close replay"
        >
          <Ic name="x" size={19} />
        </button>
      </div>
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
