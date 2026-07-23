import React, { useMemo, useRef, useState } from 'react';
import type { ReplayFactDto, ReplayProjection, TaskDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import type { ReplayController } from './replay-controller.js';
import {
  KIND_ICON,
  LEVEL_LABEL,
  QUESTION_FILTERS,
  appLabel,
  formatReplayTime,
  matchesQuestionFilter,
  matchesSearch,
  type ReplayQuestionFilter,
} from './replay-model.js';
import { ArtifactStage } from './ArtifactStage.js';
import { EvidenceDrawer } from './EvidenceDrawer.js';

const ROW_HEIGHT = 46;
const OVERSCAN = 12;

/**
 * Depth 2 — Explore: the virtualized chronological list with question-shaped
 * filters, the stage, and the surrounding context of the selected moment.
 */
export function ExploreDepth({
  controller,
  projection,
  task,
}: {
  controller: ReplayController;
  projection: ReplayProjection;
  task: TaskDto;
}): React.JSX.Element {
  const { facts } = projection;
  const fact = controller.currentFact ?? facts.at(-1)!;
  const [filter, setFilter] = useState<ReplayQuestionFilter>('all');
  const [search, setSearch] = useState('');
  const [appFilter, setAppFilter] = useState('all');
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const apps = useMemo(() => [...new Set(facts.map((f) => appLabel(f)))].sort(), [facts]);

  const visible = useMemo(
    () =>
      facts
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            matchesQuestionFilter(item, filter) &&
            matchesSearch(item, search) &&
            (appFilter === 'all' || appLabel(item) === appFilter),
        ),
    [facts, filter, search, appFilter],
  );

  // Simple fixed-height windowing keeps 10k events scrollable (§10k gate).
  const viewportHeight = listRef.current?.clientHeight ?? 600;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    visible.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const window_ = visible.slice(first, last);

  const surrounding = useMemo(() => {
    const index = facts.indexOf(fact);
    return facts.slice(Math.max(0, index - 1), index + 2);
  }, [facts, fact]);

  return (
    <main className="rp-explore">
      <aside className="rp-explore-list">
        <div className="rp-explore-tools">
          <label className="rp-search">
            <Ic name="search" size={13} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search events, paths, or apps"
              data-testid="replay-search"
            />
          </label>
          <div className="rp-question-filters" data-testid="replay-filters">
            {QUESTION_FILTERS.map((entry) => (
              <button
                key={entry.id}
                className={filter === entry.id ? 'active' : ''}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
              </button>
            ))}
            <select
              value={appFilter}
              onChange={(event) => setAppFilter(event.target.value)}
              aria-label="Filter by application"
            >
              <option value="all">All apps</option>
              {apps.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className="rp-event-list"
          ref={listRef}
          data-testid="replay-event-list"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          aria-label="All replay events"
        >
          {visible.length === 0 ? (
            <div className="rp-empty-list">
              <Ic name="alert" size={18} />
              <strong>No matching events</strong>
              <span>Try another question or search term.</span>
            </div>
          ) : (
            <div style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}>
              {window_.map(({ item, index }, offset) => (
                <EventRow
                  key={item.id}
                  fact={item}
                  active={item.id === fact.id}
                  top={(first + offset) * ROW_HEIGHT}
                  timeMode={controller.timeMode}
                  onClick={() => controller.selectIndex(index)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="rp-list-count">
          {visible.length} / {facts.length} events
        </div>
      </aside>
      <section className="rp-explore-inspector">
        <ArtifactStage fact={fact} taskId={task.id} compact />
        <div className="rp-surrounding" data-testid="replay-surrounding">
          <span>Nearby context (time-adjacent, not causal)</span>
          <div>
            {surrounding.map((item) => (
              <button
                key={item.id}
                className={item.id === fact.id ? 'active' : ''}
                onClick={() => controller.selectFact(item.id)}
              >
                <Ic name={KIND_ICON[item.kind] ?? 'info'} size={13} />
                <span>
                  <small>{formatReplayTime(item.actualStartMs)}</small>
                  <strong>{item.action}</strong>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <EvidenceDrawer
        fact={fact}
        projection={projection}
        onSelectFact={controller.selectFact}
        onVerify={() => controller.setDepth('verify')}
      />
    </main>
  );
}

function EventRow({
  fact,
  active,
  top,
  timeMode,
  onClick,
}: {
  fact: ReplayFactDto;
  active: boolean;
  top: number;
  timeMode: 'story' | 'actual';
  onClick(): void;
}): React.JSX.Element {
  return (
    <button
      className={`rp-event-row ${active ? 'active' : ''}`}
      style={{ position: 'absolute', top, height: ROW_HEIGHT }}
      onClick={onClick}
    >
      <time>{formatReplayTime(timeMode === 'story' ? fact.storyStartMs : fact.actualStartMs)}</time>
      <span className={`rp-row-icon status-${fact.status}`} aria-hidden>
        <Ic name={KIND_ICON[fact.kind] ?? 'info'} size={13} />
      </span>
      <span className="rp-row-copy">
        <strong>{fact.action}</strong>
        <small>
          {appLabel(fact)}
          {fact.groupSize ? ` · ×${fact.groupSize} grouped` : ''}
        </small>
      </span>
      <span className={`rp-level rp-level-${fact.level} compact`}>{LEVEL_LABEL[fact.level]}</span>
    </button>
  );
}
