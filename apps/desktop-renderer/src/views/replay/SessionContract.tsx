import React from 'react';
import type { ReplaySessionDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';

const VERIFICATION_LABEL = {
  verified: '已验证',
  partial: '部分验证',
  unverified: '未验证',
} as const;

/**
 * The session contract (persistent at every depth): original goal, outcome,
 * verification state and the measured coverage band.
 */
export function SessionContract({ session }: { session: ReplaySessionDto }): React.JSX.Element {
  const total = session.coverage.reduce((sum, c) => sum + (c.actualEndMs - c.actualStartMs), 0);
  return (
    <section className="rp-contract" data-testid="replay-contract" aria-label="Session contract">
      <div className="rp-contract-goal">
        <span>原始目标</span>
        <strong className={session.goalRecorded ? '' : 'rp-goal-missing'}>{session.goal}</strong>
      </div>
      <div className="rp-contract-fact">
        <span>结果</span>
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
        <span>验证</span>
        <strong className={`rp-verification-${session.verification}`}>
          {VERIFICATION_LABEL[session.verification]}
        </strong>
      </div>
      <div className="rp-contract-fact rp-contract-coverage">
        <span>证据覆盖</span>
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
