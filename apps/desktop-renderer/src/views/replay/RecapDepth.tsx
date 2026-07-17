import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayFactDto, ReplayProjection, TaskDto } from '@pi-ide/ipc-contracts';
import { Ic, ProviderMark, type ProviderMarkKind } from '../home-icons.js';
import type { ReplayController } from './replay-controller.js';
import { ArtifactStage } from './ArtifactStage.js';
import { EvidenceDrawer } from './EvidenceDrawer.js';
import { KIND_ICON, LEVEL_LABEL, formatReplayTime } from './replay-model.js';

const CONTEXT_RADIUS = 28;

/**
 * Depth 1 — semantic session playback. The visual hierarchy follows the
 * approved concept: conversation/actions on the left, the selected artifact
 * on the right, and one shared playhead below. Private model reasoning is not
 * available; the optional expansion exposes recorded surrounding context.
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

  const storyFacts = useMemo(() => {
    const keep = new Set(session.chapters.map((chapter) => chapter.factId));
    session.summary.changed.forEach((line) => keep.add(line.factId));
    session.summary.attention.forEach((line) => keep.add(line.factId));
    const firstUser = facts.find((item) => item.actor.kind === 'user');
    if (firstUser) keep.add(firstUser.id);
    const last = facts.at(-1);
    if (last) keep.add(last.id);
    keep.add(fact.id);

    if (showContext) {
      const current = Math.max(0, facts.indexOf(fact));
      facts
        .slice(Math.max(0, current - CONTEXT_RADIUS), current + CONTEXT_RADIUS + 1)
        .forEach((item) => keep.add(item.id));
    }
    return facts.filter((item) => keep.has(item.id));
  }, [facts, fact, session, showContext]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center' });
  }, [fact.id, showContext]);

  const selectFact = (factId: string, revealDetails = false) => {
    controller.selectFact(factId);
    if (revealDetails) setDetailsOpen(true);
  };

  return (
    <main className="rp-recap rp-playback">
      <aside className="rp-story-panel" aria-label="对话与操作">
        <header className="rp-story-head">
          <strong>对话与操作</strong>
          <button
            data-testid="replay-show-context"
            className={showContext ? 'active' : ''}
            onClick={() => setShowContext((shown) => !shown)}
            aria-pressed={showContext}
            title="仅显示已记录的上下文；不声称展示模型私有推理"
          >
            <Ic name="map" size={15} />
            {showContext ? '收起上下文' : '显示上下文'}
          </button>
        </header>
        <div className="rp-story-list" data-testid="replay-story-list">
          {storyFacts.map((item) => (
            <StoryEvent
              key={item.id}
              fact={item}
              active={item.id === fact.id}
              ref={item.id === fact.id ? activeRef : undefined}
              onSelect={() => selectFact(item.id)}
            />
          ))}
        </div>
        <footer className="rp-story-foot">
          <span>{storyFacts.length} 个语义节点</span>
          <small>
            {showContext
              ? `当前附近最多 ${CONTEXT_RADIUS * 2 + 1} 条记录`
              : '已折叠重复与低影响动作'}
          </small>
        </footer>
      </aside>

      <section className="rp-now-panel">
        <header className="rp-now-head">
          <strong>Agent 当时正在做什么</strong>
          <button data-testid="replay-step-details" onClick={() => setDetailsOpen(true)}>
            查看这一步的详情
            <Ic name="external" size={14} />
          </button>
        </header>

        <section className="rp-summary rp-playback-summary" data-testid="replay-summary">
          <div className="rp-summary-result">
            <span>结果</span>
            <h1>{session.summary.result}</h1>
          </div>
          <div className="rp-summary-changed">
            <span>重要变化</span>
            {session.summary.changed.length === 0 ? (
              <p className="rp-empty-note">未记录文件级变化。</p>
            ) : (
              <ul>
                {session.summary.changed.slice(0, 3).map((line) => (
                  <li key={line.factId + line.label}>
                    <button onClick={() => selectFact(line.factId, true)}>
                      <Ic name="checkCircle" size={13} />
                      {line.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rp-summary-attention">
            <span>需要注意</span>
            {session.summary.attention.length === 0 ? (
              <p className="rp-ok-note">
                <Ic name="check" size={13} /> 没有未解决的关键问题
              </p>
            ) : (
              <ul>
                {session.summary.attention.slice(0, 3).map((line) => (
                  <li key={line.factId + line.label}>
                    <button onClick={() => selectFact(line.factId, true)}>
                      <Ic name="alert" size={13} />
                      {line.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="rp-stage-wrap">
          <ArtifactStage fact={fact} taskId={task.id} />
          {fact.diffstat ? (
            <footer className="rp-write-summary">
              <Ic name="pencil" size={15} />
              已写入 <b>{fact.diffstat.additions}</b> 行，删除 <em>{fact.diffstat.deletions}</em> 行
            </footer>
          ) : null}
        </div>

        {detailsOpen ? (
          <div className="rp-detail-layer" data-testid="replay-detail-layer">
            <button
              className="rp-detail-scrim"
              aria-label="关闭步骤详情"
              onClick={() => setDetailsOpen(false)}
            />
            <div className="rp-detail-sheet">
              <button
                className="rp-detail-close"
                aria-label="关闭步骤详情"
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

const StoryEvent = React.forwardRef<
  HTMLButtonElement,
  { fact: ReplayFactDto; active: boolean; onSelect(): void }
>(function StoryEvent({ fact, active, onSelect }, ref) {
  const conversational = fact.actor.kind === 'user' || fact.actor.kind === 'agent';
  const provider = providerFor(fact);
  return (
    <button
      ref={ref}
      className={`rp-story-event ${active ? 'active' : ''} ${conversational ? 'message' : 'action'} status-${fact.status}`}
      data-fact-id={fact.id}
      data-kind={fact.kind}
      onClick={onSelect}
      aria-current={active ? 'step' : undefined}
    >
      <span className="rp-story-node" aria-hidden>
        {provider ? (
          <ProviderMark provider={provider} size={17} />
        ) : (
          <Ic
            name={fact.actor.kind === 'user' ? 'user' : (KIND_ICON[fact.kind] ?? 'info')}
            size={16}
          />
        )}
      </span>
      <span className="rp-story-copy">
        {conversational ? (
          <span className="rp-story-author">
            <strong>{fact.actor.kind === 'user' ? 'YOU' : 'AGENT'}</strong>
            <time>{clockTime(fact.startedAt)}</time>
          </span>
        ) : null}
        <span className="rp-story-action">
          {conversational ? null : <strong>{fact.action}</strong>}
          {conversational ? (fact.detail ?? fact.action) : fact.detail ? ` · ${fact.detail}` : null}
          {fact.diffstat ? (
            <small>
              · <b>+{fact.diffstat.additions}</b> <em>−{fact.diffstat.deletions}</em>
            </small>
          ) : null}
        </span>
        {!conversational ? (
          <span className="rp-story-meta">
            <span className={`rp-level rp-level-${fact.level}`}>{LEVEL_LABEL[fact.level]}</span>
            <time>{clockTime(fact.startedAt)}</time>
          </span>
        ) : null}
      </span>
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

function clockTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? formatReplayTime(0)
    : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
