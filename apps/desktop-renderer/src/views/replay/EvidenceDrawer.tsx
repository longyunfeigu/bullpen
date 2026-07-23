import React, { useEffect, useState } from 'react';
import type { ReplayEvidenceDetail, ReplayFactDto, ReplayProjection } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../../bridge.js';
import { Ic } from '../home-icons.js';
import { LEVEL_LABEL, labelCapture, labelReversibility, labelSource } from './replay-model.js';

/**
 * Contextual evidence drawer (§Evidence drawer): follows the selected moment
 * at every depth. Collapsed content is identical to Verify's expanded state —
 * one claim, its direct evidence, provenance and explicit relations.
 */
export function EvidenceDrawer({
  fact,
  projection,
  expanded = false,
  onSelectFact,
  onVerify,
}: {
  fact: ReplayFactDto;
  projection: ReplayProjection;
  expanded?: boolean;
  onSelectFact(factId: string): void;
  onVerify?: () => void;
}): React.JSX.Element {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{
    text: string;
    citations: string[];
    boundary: string | null;
  } | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReplayEvidenceDetail | null>(null);

  useEffect(() => {
    setOpenRef(null);
    setDetail(null);
    setAnswer(null);
  }, [fact.id]);

  useEffect(() => {
    if (!openRef) return;
    let disposed = false;
    setDetail(null);
    void rpcResult('task.replayEvidence', {
      taskId: projection.session.taskId,
      evidenceId: openRef,
    }).then((result) => {
      if (!disposed && result.ok) setDetail(result.data.evidence);
    });
    return () => {
      disposed = true;
    };
  }, [openRef, projection.session.taskId]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    // Evidence-bounded ask (§7): the main process derives the answer from the
    // ledger and validates every citation; no citations means no answer.
    void rpcResult('task.replayAsk', {
      taskId: projection.session.taskId,
      factId: fact.id,
      question: trimmed,
    }).then((result) => {
      if (result.ok) setAnswer(result.data);
    });
  };

  return (
    <aside
      className={`rp-drawer ${expanded ? 'expanded' : ''}`}
      data-testid="replay-evidence-drawer"
      aria-label="Evidence for the selected moment"
    >
      <header className="rp-drawer-head">
        <span>Current claim</span>
        <span className={`rp-level rp-level-${fact.level}`} data-testid="replay-fact-level">
          {LEVEL_LABEL[fact.level]}
        </span>
      </header>
      <div className="rp-claim">
        <strong>{fact.action}</strong>
        {fact.detail ? <p>{fact.detail}</p> : null}
      </div>

      <section className="rp-drawer-section">
        <div className="rp-section-label">
          <span>Direct evidence</span>
          <small>{fact.evidenceRefs.length}</small>
        </div>
        <div className="rp-evidence-items" data-testid="replay-evidence-list">
          {fact.evidenceRefs.map((ref, index) => (
            <button
              key={ref}
              className="rp-evidence-item"
              onClick={() => setOpenRef(openRef === ref ? null : ref)}
              aria-expanded={openRef === ref}
            >
              <Ic name={ref.startsWith('change:') ? 'pencil' : 'clipboard'} size={13} />
              <span>
                <strong>
                  {ref.startsWith('change:') ? 'File change record' : 'Event ledger record'}
                </strong>
                <small className="mono">{ref}</small>
              </span>
              <em>#{String(index + 1).padStart(2, '0')}</em>
            </button>
          ))}
        </div>
        {openRef ? (
          <div className="rp-evidence-detail" data-testid="replay-evidence-detail">
            {detail === null ? (
              <small className="rp-empty-note">Loading recorded evidence…</small>
            ) : (
              <>
                <dl>
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {detail.type === 'file-version' ? 'File versions (blob)' : 'Ledger event'}
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd className="mono">{detail.source}</dd>
                  </div>
                  <div>
                    <dt>Captured</dt>
                    <dd>{new Date(detail.capturedAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Integrity</dt>
                    <dd className="mono">
                      {detail.integrityHash
                        ? `sha256 ${detail.integrityHash.slice(0, 16)}…`
                        : 'Ledger row (no independent hash)'}
                    </dd>
                  </div>
                </dl>
                {detail.payloadExcerpt ? <pre>{detail.payloadExcerpt}</pre> : null}
                {detail.patch ? <pre>{detail.patch}</pre> : null}
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="rp-drawer-section">
        <div className="rp-section-label">
          <span>Source and integrity</span>
        </div>
        <dl className="rp-provenance">
          <div>
            <dt>Source</dt>
            <dd>{labelSource(fact.source)}</dd>
          </div>
          <div>
            <dt>Capture</dt>
            <dd>{labelCapture(fact.capture)}</dd>
          </div>
          <div>
            <dt>Sequence</dt>
            <dd className="mono">#{fact.sequence}</dd>
          </div>
          <div>
            <dt>Reversibility</dt>
            <dd>{labelReversibility(fact.reversibility)}</dd>
          </div>
          {fact.risk !== 'none' ? (
            <div>
              <dt>Recorded risk</dt>
              <dd className={`rp-risk-${fact.risk}`}>{fact.risk}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {fact.relations.length > 0 ? (
        <section className="rp-drawer-section">
          <div className="rp-section-label">
            <span>Explicit relationships</span>
            <small>id-backed only</small>
          </div>
          {fact.relations.map((relation) => {
            const target = projection.facts.find((f) => f.id === relation.factId);
            return (
              <button
                key={`${relation.type}-${relation.factId}`}
                className="rp-relation"
                onClick={() => onSelectFact(relation.factId)}
              >
                <small>{relation.type}</small>
                <strong>{target?.action ?? relation.factId}</strong>
                <Ic name="chevron" size={12} />
              </button>
            );
          })}
        </section>
      ) : null}

      {fact.level === 'observed' ? (
        <div className="rp-boundary-note" data-testid="replay-boundary">
          <Ic name="alert" size={14} />
          <p>
            This step was observed through the terminal or file system. The record cannot confirm
            the app's internal meaning or cause.
          </p>
        </div>
      ) : null}

      <form className="rp-ask" onSubmit={submit}>
        <label htmlFor="rp-ask-input">
          <Ic name="help" size={14} /> Ask about this replay
        </label>
        <div>
          <input
            id="rp-ask-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What evidence supports this step?"
            autoComplete="off"
          />
          <button type="submit" aria-label="Ask replay">
            <Ic name="chevron" size={14} />
          </button>
        </div>
      </form>
      {answer ? (
        <div className="rp-answer" data-testid="replay-answer">
          <strong>Record-based answer (inferred narrative, not primary evidence)</strong>
          <p>{answer.text}</p>
          {answer.boundary ? <p className="rp-answer-boundary">{answer.boundary}</p> : null}
          {answer.citations.length > 0 ? (
            <small className="mono">Citations {answer.citations.slice(0, 3).join(' · ')}</small>
          ) : null}
        </div>
      ) : null}

      {onVerify ? (
        <footer className="rp-drawer-actions">
          <button className="rp-primary-btn" data-testid="replay-to-verify" onClick={onVerify}>
            <Ic name="shield" size={13} />
            Open Verify
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
