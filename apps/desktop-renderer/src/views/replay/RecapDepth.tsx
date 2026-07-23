import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayFactDto, ReplayProjection, TaskDto } from '@pi-ide/ipc-contracts';
import { Ic, ProviderMark, type ProviderMarkKind } from '../home-icons.js';
import { useTaskStore } from '../../store/taskStore.js';
import type { ReplayController } from './replay-controller.js';
import { ArtifactStage } from './ArtifactStage.js';
import { EvidenceDrawer } from './EvidenceDrawer.js';
import {
  KIND_ICON,
  LEVEL_LABEL,
  REVERSIBILITY_BADGE,
  approvalChipsByTarget,
  buildStorySegments,
  formatDurationShort,
  formatReplayTime,
  isSoftErrorFact,
  type ApprovalChip,
} from './replay-model.js';

const CONTEXT_RADIUS = 28;
const FOLD_SAMPLE = 3;

/**
 * Depth 1 — semantic session playback (V3.1). Conversation-first story on the
 * left (full recorded prose, fold placeholders between kept nodes, pivot
 * cards), result-first summary on the right (quoted conclusion, outward
 * actions, pinned irreversible attention, return-to-room line). Private model
 * reasoning is never shown; every narrative element is quoted and cited.
 */
export function RecapDepth({
  controller,
  projection,
  task,
}: {
  controller: ReplayController;
  projection: ReplayProjection;
  task: TaskDto;
}): React.JSX.Element {
  const { session, facts } = projection;
  const fact = controller.currentFact ?? facts.at(-1)!;
  const [showContext, setShowContext] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const factById = useMemo(() => new Map(facts.map((item) => [item.id, item])), [facts]);

  const chipsByTarget = useMemo(() => approvalChipsByTarget(facts), [facts]);

  const story = useMemo(() => {
    const keep = new Set(session.chapters.map((chapter) => chapter.factId));
    session.summary.changed.forEach((line) => keep.add(line.factId));
    session.summary.attention.forEach((line) => keep.add(line.factId));
    session.summary.outward.slice(0, 3).forEach((line) => keep.add(line.factId));
    facts.forEach((item) => {
      // Conversation and recorded pivots are the story's first-class citizens.
      if (item.actor.kind === 'user' || item.kind === 'message' || item.kind === 'report') {
        keep.add(item.id);
      }
      if (item.pivot) keep.add(item.id);
    });
    const last = facts.at(-1);
    if (last) keep.add(last.id);

    // V3.2: an approval whose target row is visible becomes a chip on that
    // row (with its pending request), not a standalone story row. Approvals
    // without a visible joined target keep their row — fail open.
    const chipped = new Set<string>();
    for (const [target, chips] of chipsByTarget) {
      if (!keep.has(target)) continue;
      for (const chip of chips) {
        chipped.add(chip.fact.id);
        if (chip.requestFactId) chipped.add(chip.requestFactId);
      }
    }
    chipped.forEach((id) => keep.delete(id));

    // The selected fact is always a visible row, chip or not.
    chipped.delete(fact.id);
    keep.add(fact.id);

    if (showContext) {
      const current = Math.max(0, facts.indexOf(fact));
      facts
        .slice(Math.max(0, current - CONTEXT_RADIUS), current + CONTEXT_RADIUS + 1)
        .forEach((item) => {
          keep.add(item.id);
          chipped.delete(item.id);
        });
    }

    const { segments, quietCount } = buildStorySegments({
      facts,
      keptIds: keep,
      chippedIds: chipped,
    });
    // Chips still standing after the exclusions above are the ones rendered.
    const chips = new Map<string, ApprovalChip[]>();
    for (const [target, list] of chipsByTarget) {
      if (!keep.has(target)) continue;
      const visible = list.filter((chip) => chipped.has(chip.fact.id));
      if (visible.length > 0) chips.set(target, visible);
    }
    return { segments, quietCount, chips };
  }, [facts, fact, session, showContext, chipsByTarget]);

  const nodeCount = useMemo(
    () => story.segments.filter((s) => s.type === 'fact' && !s.inline).length,
    [story.segments],
  );
  const barsHidden = useMemo(
    () => story.segments.reduce((sum, s) => (s.type === 'fold' ? sum + s.hidden.length : sum), 0),
    [story.segments],
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center' });
  }, [fact.id, showContext]);

  const selectFact = (factId: string, revealDetails = false) => {
    controller.selectFact(factId);
    if (revealDetails) setDetailsOpen(true);
  };

  const outwardIds = useMemo(
    () => new Set(session.summary.outward.map((line) => line.factId)),
    [session.summary.outward],
  );
  const hasChanged = session.summary.changed.length > 0;
  const hasOutward = session.summary.outward.length > 0;
  const conclusion = session.summary.conclusion;
  const citeChips = useMemo(
    () =>
      session.summary.citations
        .map((id) => factById.get(id))
        .filter((item): item is ReplayFactDto => Boolean(item))
        .slice(0, 3),
    [session.summary.citations, factById],
  );

  return (
    <main className="rp-recap rp-playback rp-v31">
      <aside className="rp-story-panel" aria-label="Conversation and actions">
        <header className="rp-story-head">
          <strong>Conversation and actions</strong>
          <button
            data-testid="replay-show-context"
            className={showContext ? 'active' : ''}
            onClick={() => setShowContext((shown) => !shown)}
            aria-pressed={showContext}
            title="Shows recorded context only; it does not expose private model reasoning"
          >
            <Ic name="map" size={15} />
            {showContext ? 'Hide context' : 'Show all context'}
          </button>
        </header>
        <div className="rp-story-list" data-testid="replay-story-list">
          {story.segments.map((segment) =>
            segment.type === 'fold' ? (
              <FoldGap
                key={`fold-${segment.hidden[0]!.id}`}
                hidden={segment.hidden}
                onSelect={(id) => selectFact(id)}
                onExplore={() => controller.setDepth('explore')}
              />
            ) : (
              <StoryEvent
                key={segment.fact.id}
                fact={segment.fact}
                inline={segment.inline}
                softError={isSoftErrorFact(segment.fact, session.outcome)}
                chips={story.chips.get(segment.fact.id)}
                active={segment.fact.id === fact.id}
                ref={segment.fact.id === fact.id ? activeRef : undefined}
                onSelect={() => selectFact(segment.fact.id)}
                onSelectRef={(id) => selectFact(id, true)}
                factById={factById}
              />
            ),
          )}
        </div>
        <footer className="rp-story-foot">
          <span>
            {nodeCount} semantic node{nodeCount === 1 ? '' : 's'}
          </span>
          <small data-testid="replay-story-foot-note">
            {showContext
              ? `Up to ${CONTEXT_RADIUS * 2 + 1} records near the current step`
              : [
                  barsHidden > 0 ? `${barsHidden} records folded (expand between nodes)` : null,
                  story.quietCount > 0
                    ? `${story.quietCount} status record${story.quietCount === 1 ? '' : 's'} omitted from the list`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'All records are shown'}
            {!showContext && (barsHidden > 0 || story.quietCount > 0)
              ? ' · See every record in Explore'
              : ''}
          </small>
        </footer>
      </aside>

      <section className="rp-now-panel">
        <section className="rp-summary rp-playback-summary" data-testid="replay-summary">
          <div className="rp-result-line">
            <h1>{session.outcomeLabel}</h1>
            <span className="rp-result-facts">{session.summary.result}</span>
          </div>

          {conclusion ? (
            <div className="rp-conclusion" data-testid="replay-conclusion">
              <span className="rp-level rp-level-inferred">Quoted from the final report</span>
              <p>{conclusion.text}</p>
              <span className="rp-conclusion-cites">
                {citeChips.map((cite, index) => (
                  <button
                    key={cite.id}
                    className="rp-cite-chip"
                    onClick={() => selectFact(cite.id, true)}
                    title={cite.action}
                  >
                    {'①②③'[index]} {shortAction(cite)} {clockTime(cite.startedAt)}
                  </button>
                ))}
              </span>
            </div>
          ) : null}

          <div className="rp-to-room" data-testid="replay-to-room">
            <button onClick={() => useTaskStore.getState().closeReplay()}>
              Esc closes Replay ·{' '}
              {task.state === 'REVIEW_READY'
                ? 'Review these changes in the Session review bar'
                : 'Return to the Session'}{' '}
              →
            </button>
            <small>Review, accept, and rollback stay in the Session — Replay is read-only</small>
          </div>

          <div className="rp-summary-duo">
            <div className="rp-summary-changed">
              <span>
                {hasChanged
                  ? 'Key changes'
                  : hasOutward
                    ? 'Outputs and external actions'
                    : 'Key changes'}
              </span>
              {!hasChanged && !hasOutward ? (
                <p className="rp-empty-note">No file-level changes or external actions recorded.</p>
              ) : (
                <ul>
                  {session.summary.changed.slice(0, 3).map((line) => (
                    <li key={line.factId + line.label}>
                      <button onClick={() => selectFact(line.factId, true)}>
                        <Ic name="pencil" size={13} />
                        <span className="mono">{line.label}</span>
                      </button>
                    </li>
                  ))}
                  {session.summary.outward.slice(0, hasChanged ? 2 : 4).map((line) => (
                    <li key={line.factId + line.label}>
                      <button
                        className="rp-outward-row"
                        data-testid="replay-outward"
                        onClick={() => selectFact(line.factId, true)}
                      >
                        <Ic name="external" size={13} />
                        <span>
                          {line.label}
                          {line.app ? <small> · {line.app}</small> : null}
                        </span>
                        <em className={`rp-rev rp-rev-${line.reversibility}`}>
                          {REVERSIBILITY_BADGE[line.reversibility]}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rp-summary-attention">
              <span>Needs attention</span>
              {session.summary.attention.length === 0 ? (
                <p className="rp-ok-note">
                  <Ic name="check" size={13} /> No unresolved critical issues
                </p>
              ) : (
                <ul>
                  {session.summary.attention.slice(0, 3).map((line) => {
                    const target = factById.get(line.factId);
                    const pinned =
                      target?.outward === true &&
                      (target.reversibility === 'irreversible' || target.risk === 'high');
                    return (
                      <li key={line.factId + line.label}>
                        <button
                          className={pinned ? 'rp-attn-pinned' : ''}
                          onClick={() => selectFact(line.factId, true)}
                        >
                          {pinned ? (
                            <em className="rp-attn-badge">
                              {target?.reversibility === 'irreversible'
                                ? 'Irreversible'
                                : 'High risk'}
                            </em>
                          ) : (
                            <Ic name="alert" size={13} />
                          )}
                          {line.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <div className="rp-stage-wrap">
          <ArtifactStage fact={fact} taskId={task.id} />
          {fact.diffstat ? (
            <footer className="rp-write-summary">
              <Ic name="pencil" size={15} />
              Added <b>{fact.diffstat.additions}</b>{' '}
              {fact.diffstat.additions === 1 ? 'line' : 'lines'}, removed{' '}
              <em>{fact.diffstat.deletions}</em> {fact.diffstat.deletions === 1 ? 'line' : 'lines'}
              {outwardIds.has(fact.id) ? <small> · External action</small> : null}
            </footer>
          ) : null}
          <footer className="rp-stage-actions">
            <button data-testid="replay-step-details" onClick={() => setDetailsOpen(true)}>
              View step details
              <Ic name="external" size={14} />
            </button>
            <button className="rp-stage-verify" onClick={() => controller.setDepth('verify')}>
              Trace evidence in Verify →
            </button>
          </footer>
        </div>

        {detailsOpen ? (
          <div className="rp-detail-layer" data-testid="replay-detail-layer">
            <button
              className="rp-detail-scrim"
              aria-label="Close step details"
              onClick={() => setDetailsOpen(false)}
            />
            <div className="rp-detail-sheet">
              <button
                className="rp-detail-close"
                aria-label="Close step details"
                onClick={() => setDetailsOpen(false)}
              >
                <Ic name="x" size={16} />
              </button>
              <EvidenceDrawer
                fact={fact}
                projection={projection}
                expanded
                onSelectFact={controller.selectFact}
                onVerify={() => controller.setDepth('verify')}
              />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

/** Fold placeholder between two kept story nodes (V3.1): the story keeps no
 * silent holes — what was folded is countable, sampled and expandable. */
function FoldGap({
  hidden,
  onSelect,
  onExplore,
}: {
  hidden: ReplayFactDto[];
  onSelect(factId: string): void;
  onExplore(): void;
}): React.JSX.Element {
  const stats = useMemo(() => {
    const byKind = new Map<string, number>();
    for (const item of hidden) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
    const NAMES: Record<string, string> = {
      read: 'read',
      search: 'search',
      command: 'command',
      write: 'write',
      state: 'status',
      system: 'system',
    };
    return [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([kind, count]) => `${count} ${NAMES[kind] ?? kind}`)
      .join(', ');
  }, [hidden]);
  const spanMs = Math.max(0, (hidden.at(-1)?.actualEndMs ?? 0) - (hidden[0]?.actualStartMs ?? 0));

  return (
    <details className="rp-fold" data-testid="replay-fold">
      <summary>
        <i className="rp-fold-line" aria-hidden />
        <span className="rp-fold-label">
          {hidden.length} records folded{stats ? `: ${stats}` : ''}
          {spanMs >= 1000 ? ` · ${formatDurationShort(spanMs)}` : ''}
        </span>
        <em>Show samples</em>
        <i className="rp-fold-line" aria-hidden />
      </summary>
      <div className="rp-fold-sample">
        {hidden.slice(0, FOLD_SAMPLE).map((item) => (
          <button key={item.id} onClick={() => onSelect(item.id)}>
            <Ic name={KIND_ICON[item.kind] ?? 'info'} size={13} />
            <span>{item.action}</span>
            <time>{clockTime(item.startedAt)}</time>
          </button>
        ))}
        {hidden.length > FOLD_SAMPLE ? (
          <button className="rp-fold-more" onClick={onExplore}>
            View all {hidden.length} in Explore →
          </button>
        ) : null}
      </div>
    </details>
  );
}

/** Recorded approval rendered as an annotation on the fact it resolved
 * (V3.2 rule 3). Click opens the approval's own audit detail. */
function ApprovalChipButton({
  chip,
  onSelectRef,
}: {
  chip: ApprovalChip;
  onSelectRef(factId: string): void;
}): React.JSX.Element {
  const byUser = chip.fact.actor.kind === 'user';
  return (
    <button
      className="rp-ok-chip"
      data-testid="replay-approval-chip"
      title={chip.fact.action}
      onClick={(event) => {
        event.stopPropagation();
        onSelectRef(chip.fact.id);
      }}
    >
      <i aria-hidden>✓</i> {byUser ? 'Approved by you' : 'Auto-approved'}{' '}
      {clockTime(chip.fact.startedAt)}
    </button>
  );
}

const StoryEvent = React.forwardRef<
  HTMLButtonElement,
  {
    fact: ReplayFactDto;
    active: boolean;
    inline?: boolean;
    softError?: boolean;
    chips?: ApprovalChip[];
    onSelect(): void;
    onSelectRef(factId: string): void;
    factById: Map<string, ReplayFactDto>;
  }
>(function StoryEvent(
  { fact, active, inline = false, softError = false, chips, onSelect, onSelectRef, factById },
  ref,
) {
  const conversational = fact.actor.kind === 'user' || fact.actor.kind === 'agent';
  const provider = providerFor(fact);
  const chipButtons =
    chips && chips.length > 0
      ? chips.map((chip) => (
          <ApprovalChipButton key={chip.fact.id} chip={chip} onSelectRef={onSelectRef} />
        ))
      : null;

  // Recorded pivot: a plan revision card with its cited grounds. The refs are
  // separate buttons, so the card itself is a div carrying the story classes.
  if (fact.pivot) {
    return (
      <div
        className={`rp-story-event action pivot ${active ? 'active' : ''} status-${fact.status}`}
        data-fact-id={fact.id}
        data-kind={fact.kind}
        data-testid="replay-pivot"
      >
        <button
          ref={ref}
          className="rp-pivot-main"
          onClick={onSelect}
          aria-current={active ? 'step' : undefined}
        >
          <span className="rp-pivot-tag">
            <i aria-hidden>↷</i> Pivot · Plan revised
            <span className="rp-level rp-level-inferred">{LEVEL_LABEL.inferred}</span>
            <time>{clockTime(fact.startedAt)}</time>
          </span>
          <strong>{fact.action}</strong>
          {fact.pivot.reason ? (
            <p>{fact.pivot.reason}</p>
          ) : (
            <p className="rp-pivot-none">The plan was revised; no reason was recorded.</p>
          )}
        </button>
        {chipButtons || fact.pivot.refFactIds.length > 0 ? (
          <span className="rp-pivot-refs">
            {chipButtons}
            {fact.pivot.refFactIds.slice(0, 3).map((refId) => {
              const target = factById.get(refId);
              return target ? (
                <button key={refId} className="rp-cite-chip" onClick={() => onSelectRef(refId)}>
                  Basis · {shortAction(target)}
                </button>
              ) : null;
            })}
          </span>
        ) : null}
      </div>
    );
  }

  // V3.2 rule 4: a process error the session outlived is a soft amber notice —
  // the recorded action stays, the raw code demotes to small print, red is
  // reserved for failures that shaped the result.
  if (softError) {
    return (
      <button
        ref={ref}
        className={`rp-story-event action soft-err ${active ? 'active' : ''}`}
        data-fact-id={fact.id}
        data-kind={fact.kind}
        data-testid="replay-soft-error"
        onClick={onSelect}
        aria-current={active ? 'step' : undefined}
      >
        <span className="rp-story-node" aria-hidden>
          <Ic name="alert" size={14} />
        </span>
        <span className="rp-story-copy">
          <span className="rp-story-action">
            <strong>{fact.action}</strong>
            {fact.detail ? <code className="rp-soft-raw">{fact.detail.slice(0, 80)}</code> : null}
          </span>
          <span className="rp-story-meta">
            <em className="rp-soft-note">Recoverable process error · Session completed</em>
            <time>{clockTime(fact.startedAt)}</time>
          </span>
        </span>
      </button>
    );
  }

  // Conversation bubble: the recorded prose itself, not just the action line.
  if (
    conversational &&
    (fact.kind === 'user' ||
      fact.kind === 'answer' ||
      fact.kind === 'message' ||
      fact.kind === 'question' ||
      fact.kind === 'report')
  ) {
    const isUser = fact.actor.kind === 'user';
    return (
      <button
        ref={ref}
        className={`rp-story-event message ${isUser ? 'from-user' : 'from-agent'} ${active ? 'active' : ''} status-${fact.status}`}
        data-fact-id={fact.id}
        data-kind={fact.kind}
        onClick={onSelect}
        aria-current={active ? 'step' : undefined}
      >
        <span className={`rp-msg-ava ${isUser ? 'user' : 'agent'}`} aria-hidden>
          {isUser ? (
            'Y'
          ) : provider ? (
            <ProviderMark provider={provider} size={15} />
          ) : (
            <Ic name="bot" size={14} />
          )}
        </span>
        <span className="rp-msg-body">
          <span className="rp-msg-who">
            <strong>{isUser ? 'YOU' : 'AGENT'}</strong>
            <time>{clockTime(fact.startedAt)}</time>
            {fact.kind === 'report' ? <em>· Final report</em> : null}
            {fact.kind === 'question' ? <em>· Question</em> : null}
          </span>
          <span className="rp-msg-text">{fact.detail ?? fact.action}</span>
        </span>
      </button>
    );
  }

  const body = (
    <>
      <span className="rp-story-node" aria-hidden>
        <Ic name={KIND_ICON[fact.kind] ?? 'info'} size={16} />
      </span>
      <span className="rp-story-copy">
        <span className="rp-story-action">
          <strong>{fact.action}</strong>
          {fact.detail ? ` · ${fact.detail.slice(0, 120)}` : null}
          {fact.outward ? <small className="rp-outward-mark"> · External</small> : null}
          {fact.diffstat ? (
            <small>
              · <b>+{fact.diffstat.additions}</b> <em>−{fact.diffstat.deletions}</em>
            </small>
          ) : null}
        </span>
        <span className="rp-story-meta">
          {/* V3.2 rule 5: "Recorded" is the default and carries no signal —
              only the exceptions (verified/observed/inferred/missing) badge. */}
          {fact.level !== 'recorded' ? (
            <span className={`rp-level rp-level-${fact.level}`}>{LEVEL_LABEL[fact.level]}</span>
          ) : null}
          <time>{clockTime(fact.startedAt)}</time>
        </span>
      </span>
    </>
  );

  // A row with approval chips is a div (chips are separate buttons), carrying
  // the same story classes — the pivot card pattern.
  if (chipButtons) {
    return (
      <div
        className={`rp-story-event action has-chips ${inline ? 'inline' : ''} ${active ? 'active' : ''} status-${fact.status}`}
        data-fact-id={fact.id}
        data-kind={fact.kind}
      >
        <button
          ref={ref}
          className="rp-story-main"
          onClick={onSelect}
          aria-current={active ? 'step' : undefined}
        >
          {body}
        </button>
        <span className="rp-story-chips">{chipButtons}</span>
      </div>
    );
  }

  return (
    <button
      ref={ref}
      className={`rp-story-event action ${inline ? 'inline' : ''} ${active ? 'active' : ''} status-${fact.status}`}
      data-fact-id={fact.id}
      data-kind={fact.kind}
      onClick={onSelect}
      aria-current={active ? 'step' : undefined}
    >
      {body}
    </button>
  );
});

function providerFor(fact: ReplayFactDto): ProviderMarkKind | null {
  if (fact.actor.kind !== 'agent') return null;
  if (fact.source === 'claude') return 'claude';
  if (fact.source === 'codex') return 'codex';
  if (fact.source === 'pi') return 'pi';
  return 'shell';
}

function shortAction(fact: ReplayFactDto): string {
  const oneLine = fact.action.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 18 ? oneLine : `${oneLine.slice(0, 17)}…`;
}

function clockTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? formatReplayTime(0)
    : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
