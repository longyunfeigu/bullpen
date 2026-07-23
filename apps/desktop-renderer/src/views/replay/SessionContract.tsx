import React from 'react';
import type { ReplaySessionDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import { formatDurationShort } from './replay-model.js';

const VERIFICATION_LABEL = {
  verified: 'Verified',
  partial: 'Partially verified',
  unverified: 'Unverified',
} as const;

function displayGoal(goal: string): string {
  return goal.replace(/^\[scenario:[^\]]+\]\s*/i, '').trim() || 'Original goal not recorded';
}

/**
 * The session contract (persistent at every depth): original goal, outcome,
 * verification state, elapsed time, the recorded input ledger (V3.1) and the
 * measured coverage band. Memory/rule injections are not ledgered yet — the
 * inputs cell says so instead of guessing.
 */
export function SessionContract({ session }: { session: ReplaySessionDto }): React.JSX.Element {
  const total = session.coverage.reduce((sum, c) => sum + (c.actualEndMs - c.actualStartMs), 0);
  const inputFiles = session.inputs.files;
  return (
    <section className="rp-contract" data-testid="replay-contract" aria-label="Session contract">
      <div className="rp-contract-goal">
        <span>Original goal</span>
        <strong className={session.goalRecorded ? '' : 'rp-goal-missing'}>
          {displayGoal(session.goal)}
        </strong>
      </div>
      <div className="rp-contract-fact">
        <span>Outcome</span>
        <strong className={`rp-outcome-${session.outcome}`} data-testid="replay-outcome">
          <Ic
            name={
              session.outcome === 'completed'
                ? 'checkCircle'
                : session.outcome === 'running'
                  ? 'clock'
                  : session.outcome === 'attention'
                    ? 'alert'
                    : 'square'
            }
            size={13}
          />
          {session.outcomeLabel}
        </strong>
      </div>
      <div className="rp-contract-fact">
        <span>Verification</span>
        <strong className={`rp-verification-${session.verification}`}>
          {VERIFICATION_LABEL[session.verification]}
        </strong>
      </div>
      <div className="rp-contract-fact">
        <span>Duration</span>
        <strong className="rp-contract-time">
          {formatDurationShort(session.actualDurationMs)} <small>actual</small>
          <em>·</em>
          {formatDurationShort(session.storyDurationMs)} <small>story</small>
        </strong>
      </div>
      <div className="rp-contract-fact rp-contract-inputs">
        <span>Inputs sent to the agent</span>
        <details data-testid="replay-inputs">
          <summary>
            <strong>
              {inputFiles.length > 0
                ? `${inputFiles.length} file reference${inputFiles.length === 1 ? '' : 's'}`
                : 'No injection manifest recorded'}
            </strong>
            <em>Expand ▾</em>
          </summary>
          <div className="rp-inputs-pop">
            <h4>File references attached to the request</h4>
            {inputFiles.length > 0 ? (
              <ul>
                {inputFiles.map((file) => (
                  <li key={file} className="mono">
                    {file}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No file references were attached to this request.</p>
            )}
            <h4>Memory and rules</h4>
            <p className="rp-inputs-note">
              The injection manifest is not in the ledger — Replay makes no claim about it.
            </p>
          </div>
        </details>
      </div>
      <div className="rp-contract-fact rp-contract-coverage">
        <span>Evidence coverage</span>
        <div className="rp-mini-coverage" aria-label="Evidence coverage by interval">
          {session.coverage.map((segment, index) => (
            <i
              key={`${segment.level}-${index}`}
              className={`rp-cov-${segment.level}`}
              style={{
                width: `${total > 0 ? ((segment.actualEndMs - segment.actualStartMs) / total) * 100 : 0}%`,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
