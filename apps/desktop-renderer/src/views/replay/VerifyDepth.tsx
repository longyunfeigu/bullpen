import React, { useMemo, useState } from 'react';
import type { ReplayProjection, TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../../bridge.js';
import { Ic } from '../home-icons.js';
import type { ReplayController } from './replay-controller.js';
import { KIND_ICON, LEVEL_LABEL, formatReplayTime, labelSource } from './replay-model.js';
import { coverageText } from './ReplayHeader.js';
import { ArtifactStage } from './ArtifactStage.js';
import { EvidenceDrawer } from './EvidenceDrawer.js';

/**
 * Depth 3 — Verify: claim → evidence chain → disposition, plus the honest
 * evidence receipt. The selected moment does not change when entering.
 */
export function VerifyDepth({
  controller,
  projection,
  task,
}: {
  controller: ReplayController;
  projection: ReplayProjection;
  task: TaskDto;
}): React.JSX.Element {
  const { facts, session } = projection;
  const fact = controller.currentFact ?? facts.at(-1)!;
  const claims = useMemo(
    () => facts.filter((f) => f.mandatory || f.evidenceRefs.length > 1 || f.kind === 'report'),
    [facts],
  );
  const verifiedCount = claims.filter((f) => f.level === 'verified').length;
  const [exported, setExported] = useState<string | null>(null);

  const exportReceipt = () => {
    void rpcResult('task.replayReceipt', { taskId: task.id }).then((result) => {
      if (result.ok && result.data.htmlPath) {
        setExported(`已导出 HTML + JSON：${result.data.htmlPath}`);
      } else if (result.ok) {
        setExported(null); // user cancelled the save dialog
      }
    });
  };

  return (
    <main className="rp-verify">
      <aside className="rp-claim-list" aria-label="Claims with evidence">
        <header className="rp-panel-title">
          <span>主张与证据</span>
          <span>{claims.length}</span>
        </header>
        <div>
          {claims.map((item) => (
            <button
              key={item.id}
              className={item.id === fact.id ? 'active' : ''}
              onClick={() => controller.selectFact(item.id)}
            >
              <time>{formatReplayTime(item.actualStartMs)}</time>
              <span className={`rp-row-icon status-${item.status}`} aria-hidden>
                <Ic name={KIND_ICON[item.kind] ?? 'info'} size={13} />
              </span>
              <span className="rp-row-copy">
                <strong>{item.action}</strong>
                <span className={`rp-level rp-level-${item.level} compact`}>
                  {LEVEL_LABEL[item.level]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="rp-verify-workspace">
        <div className="rp-verify-title">
          <span>核验当前主张</span>
          <h1>{fact.action}</h1>
        </div>
        <ArtifactStage fact={fact} taskId={task.id} compact />
        <div className="rp-verify-chain" data-testid="replay-evidence-chain">
          <header>
            <span>证据链</span>
            <small>只显示明确记录的关系</small>
          </header>
          <div className="rp-chain-flow">
            <div>
              <span aria-hidden>
                <Ic name="clipboard" size={15} />
              </span>
              <small>Claim</small>
              <strong>{fact.action}</strong>
            </div>
            <i aria-hidden />
            <div>
              <span aria-hidden>
                <Ic name="archive" size={15} />
              </span>
              <small>Evidence</small>
              <strong>{fact.evidenceRefs.length} 条直接记录</strong>
            </div>
            <i aria-hidden />
            <div className={fact.level === 'verified' ? 'verified' : 'boundary'}>
              <span aria-hidden>
                <Ic name={fact.level === 'verified' ? 'checkCircle' : 'alert'} size={15} />
              </span>
              <small>Disposition</small>
              <strong>{fact.level === 'verified' ? '已验证' : '边界已声明'}</strong>
            </div>
          </div>
        </div>
      </section>
      <div className="rp-verify-side">
        <section className="rp-receipt" data-testid="replay-receipt">
          <header>
            <Ic name="shield" size={17} />
            <span>Replay evidence record</span>
          </header>
          <div className="rp-receipt-score">
            <strong>
              {verifiedCount}/{claims.length}
            </strong>
            <span>claims directly verified</span>
          </div>
          <dl>
            <div>
              <dt>Task</dt>
              <dd>{task.title}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{labelSource(facts[0]?.source ?? 'pi')}</dd>
            </div>
            <div>
              <dt>Coverage</dt>
              <dd>{coverageText(session)}</dd>
            </div>
            <div>
              <dt>Integrity</dt>
              <dd>账本顺序记录（未签名）</dd>
            </div>
          </dl>
          <button
            className="rp-primary-btn"
            data-testid="replay-export-receipt"
            onClick={exportReceipt}
          >
            <Ic name="archive" size={13} />
            导出凭证（HTML + JSON）
          </button>
          {exported ? (
            <small className="rp-receipt-exported" data-testid="replay-receipt-exported">
              {exported}
            </small>
          ) : null}
          <small className="rp-receipt-note">
            <Ic name="info" size={11} /> 叙事与证据分离；本导出未签名，不声称防篡改。
          </small>
        </section>
        <EvidenceDrawer
          fact={fact}
          projection={projection}
          expanded
          onSelectFact={controller.selectFact}
        />
      </div>
    </main>
  );
}
