import React from 'react';
import type { ReplayProjection, TaskDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import type { ReplayController } from './replay-controller.js';
import { CHAPTER_LABEL, KIND_ICON, LEVEL_LABEL, formatReplayTime } from './replay-model.js';
import { ArtifactStage } from './ArtifactStage.js';
import { EvidenceDrawer } from './EvidenceDrawer.js';

/** Depth 1 — Recap: result card first, then chapters + stage + evidence. */
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
  return (
    <main className="rp-recap">
      <section className="rp-summary" data-testid="replay-summary">
        <div className="rp-summary-result">
          <span>结果</span>
          <h1>{session.summary.result}</h1>
          <button
            className="rp-primary-btn rp-play-recap"
            data-testid="replay-play-recap"
            onClick={() => {
              controller.seek(0);
              controller.togglePlay();
            }}
          >
            <Ic name="play" size={13} />
            播放 {Math.round(session.storyDurationMs / 1000)} 秒回顾
          </button>
        </div>
        <div className="rp-summary-changed">
          <span>重要变化</span>
          {session.summary.changed.length === 0 ? (
            <p className="rp-empty-note">未记录文件级变化。</p>
          ) : (
            <ul>
              {session.summary.changed.map((line) => (
                <li key={line.factId + line.label}>
                  <button onClick={() => controller.selectFact(line.factId)}>
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
              <Ic name="check" size={13} /> 没有记录到失败、拒绝或未验证的关键结论。
            </p>
          ) : (
            <ul>
              {session.summary.attention.map((line) => (
                <li key={line.factId + line.label}>
                  <button onClick={() => controller.selectFact(line.factId)}>
                    <Ic name="alert" size={13} />
                    {line.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <div className="rp-recap-workspace">
        <aside className="rp-chapter-rail" aria-label="Semantic chapters">
          <div className="rp-panel-title">
            <span>故事章节</span>
            <span>{session.chapters.length}</span>
          </div>
          <div className="rp-chapter-list">
            {session.chapters.map((chapter) => {
              const chapterFact = facts.find((f) => f.id === chapter.factId);
              const active = fact.id === chapter.factId;
              return (
                <button
                  key={chapter.id}
                  className={active ? 'active' : ''}
                  onClick={() => controller.selectFact(chapter.factId)}
                >
                  <time>{formatReplayTime(chapter.storyStartMs)}</time>
                  <span
                    className={`rp-chapter-icon status-${chapterFact?.status ?? 'info'}`}
                    aria-hidden
                  >
                    <Ic name={KIND_ICON[chapterFact?.kind ?? 'state'] ?? 'info'} size={14} />
                  </span>
                  <span>
                    <strong>{CHAPTER_LABEL[chapter.category]}</strong>
                    <small>{chapter.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="rp-level-legend" aria-label="Evidence language">
            {(['verified', 'recorded', 'observed', 'inferred', 'missing'] as const).map((level) => (
              <span key={level} className={`rp-level rp-level-${level}`}>
                {LEVEL_LABEL[level]}
              </span>
            ))}
          </div>
        </aside>
        <ArtifactStage fact={fact} taskId={task.id} />
        <EvidenceDrawer
          fact={fact}
          projection={projection}
          onSelectFact={controller.selectFact}
          onVerify={() => controller.setDepth('verify')}
        />
      </div>
    </main>
  );
}
