import React, { useEffect, useState } from 'react';
import { useMemoryStore } from '../store/memoryStore.js';
import '../styles/memory.css';

/**
 * Distill card (ADR-0028): after a review correction (request-fix / plan
 * changes) the captured candidate surfaces inline above the composer — approve
 * it into a project rule right where the correction happened, or dismiss.
 * Backed by the candidate queue, so an unhandled card is never lost: it stays
 * in Memory → Project rules → Candidates.
 */
export function DistillCards(props: { taskId: string }): React.JSX.Element | null {
  const store = useMemoryStore();
  const [text, setText] = useState<string | null>(null);
  const [resolved, setResolved] = useState<'approved' | null>(null);

  useEffect(() => {
    store.init();
    void store.refreshTask(props.taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.taskId]);

  const candidates = store.taskCandidates[props.taskId] ?? [];
  const projectPath = store.taskProjects[props.taskId] ?? null;
  const candidate = candidates[0] ?? null;

  useEffect(() => {
    setText(candidate?.text ?? null);
    if (candidate) setResolved(null);
  }, [candidate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (resolved === 'approved') {
    return (
      <div className="distill-cards" data-testid="distill-done">
        <div className="mv-hint" style={{ padding: '4px 2px' }}>
          ✓ Added to project memory — future tasks carry it automatically. Manage it under Memory.
        </div>
      </div>
    );
  }
  if (!candidate) return null;
  const isHit = candidate.matchedRuleId !== null;

  return (
    <div className="distill-cards" data-testid="distill-card">
      <div className={`mv-candidate ${isHit ? 'hit' : ''}`}>
        <div className="mv-candidate-origin">
          <b style={{ color: 'var(--fg)' }}>
            {isHit
              ? 'This correction matches an existing rule — it slipped again.'
              : 'This correction looks reusable — distill it into a project rule?'}
          </b>
          {candidate.similarCount > 1 ? (
            <span className="sim">your {candidate.similarCount}ᵗʰ similar correction</span>
          ) : null}
          {candidates.length > 1 ? <span>+{candidates.length - 1} more in Memory</span> : null}
        </div>
        {!isHit ? (
          <textarea
            value={text ?? ''}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            data-testid="distill-text"
          />
        ) : null}
        <div className="mv-row-actions">
          {!isHit ? (
            <button
              className="mv-btn primary"
              data-testid="distill-approve"
              onClick={() =>
                void store
                  .resolveCandidate({
                    candidateId: candidate.id,
                    action: 'approve',
                    ...(text !== null ? { editedText: text } : {}),
                    ...(projectPath ? { projectPath } : {}),
                  })
                  .then((ok) => {
                    if (ok) setResolved('approved');
                    void store.refreshTask(props.taskId);
                  })
              }
            >
              Distill into a rule
            </button>
          ) : null}
          <button
            className="mv-btn quiet"
            data-testid="distill-dismiss"
            onClick={() =>
              void store
                .resolveCandidate({
                  candidateId: candidate.id,
                  action: 'dismiss',
                  ...(projectPath ? { projectPath } : {}),
                })
                .then(() => void store.refreshTask(props.taskId))
            }
          >
            {isHit ? 'Got it' : 'Just this once'}
          </button>
        </div>
      </div>
    </div>
  );
}
