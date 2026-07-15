import React from 'react';
import type { ReplayFactDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../../home-icons.js';
import { KIND_ICON, LEVEL_LABEL, appLabel, labelSource } from '../replay-model.js';

/**
 * Phase-1 artifact renderers besides files. Each renders only recorded
 * material; unknown domains fall back to the generic observable-action card
 * instead of a fabricated preview (§6.4).
 */

export function TerminalRenderer({ fact }: { fact: ReplayFactDto }): React.JSX.Element {
  return (
    <article className="rp-terminal-artifact">
      <header>
        <Ic name="terminal" size={14} />
        <span>{fact.action}</span>
        {fact.capture === 'observed' ? <b className="rp-observed-tag">OBSERVED</b> : null}
      </header>
      <pre className="mono">{fact.detail ?? '(no recorded output for this moment)'}</pre>
      {fact.capture === 'observed' ? (
        <footer>终端像素不能证明应用内部状态；仅记录可见输出。</footer>
      ) : null}
    </article>
  );
}

export function ApprovalRenderer({ fact }: { fact: ReplayFactDto }): React.JSX.Element {
  const disposition =
    fact.status === 'ok' ? '已批准' : fact.status === 'denied' ? '已拒绝' : '等待决定';
  return (
    <article className={`rp-approval-artifact status-${fact.status}`}>
      <header>
        <Ic name="shield" size={18} />
        <span>审批检查点</span>
        {fact.risk !== 'none' ? (
          <em className={`rp-risk-${fact.risk}`}>risk: {fact.risk}</em>
        ) : null}
      </header>
      <h2>{fact.action}</h2>
      <div className="rp-approval-disposition">
        <Ic
          name={fact.status === 'ok' ? 'checkCircle' : fact.status === 'denied' ? 'ban' : 'clock'}
          size={18}
        />
        <strong>{disposition}</strong>
        <small>{fact.actor.label}</small>
      </div>
      {fact.detail ? <pre className="mono">{fact.detail}</pre> : null}
    </article>
  );
}

export function VerificationRenderer({ fact }: { fact: ReplayFactDto }): React.JSX.Element {
  return (
    <article className={`rp-verification-artifact status-${fact.status}`}>
      <header>
        <Ic name={fact.status === 'ok' ? 'checkCircle' : 'xCircle'} size={18} />
        <span>
          {fact.status === 'ok'
            ? '验证通过'
            : fact.status === 'running'
              ? '验证进行中'
              : '验证未通过'}
        </span>
      </header>
      <h2>{fact.action}</h2>
      {fact.detail ? <pre className="mono">{fact.detail}</pre> : null}
      <footer>
        {fact.status === 'ok'
          ? '这是可核验的系统证据：命令、退出码与输出均已记录。'
          : '失败输出已保留为证据；该验证不支持任何 Verified 主张。'}
      </footer>
    </article>
  );
}

export function MessageRenderer({ fact }: { fact: ReplayFactDto }): React.JSX.Element {
  return (
    <article className={`rp-message-artifact author-${fact.actor.kind}`}>
      <header>
        <Ic name={KIND_ICON[fact.kind] ?? 'bot'} size={16} />
        <span>{fact.actor.label}</span>
        <small>{labelSource(fact.source)}</small>
      </header>
      <p>{fact.action}</p>
      {fact.detail ? <pre className="rp-message-detail">{fact.detail}</pre> : null}
    </article>
  );
}

export function WebSourceRenderer({ fact }: { fact: ReplayFactDto }): React.JSX.Element {
  return (
    <article className="rp-web-artifact">
      <header>
        <Ic name="search" size={15} />
        <span>Recorded source</span>
      </header>
      <div className="rp-web-address mono">{fact.resource}</div>
      <h2>{fact.action}</h2>
      {fact.detail ? <blockquote>{fact.detail}</blockquote> : null}
      <footer>只展示事件记录的地址与摘录；不重建页面内容。</footer>
    </article>
  );
}

/** Honest fallback: the observable action, its result and evidence level. */
export function GenericActionRenderer({ fact }: { fact: ReplayFactDto }): React.JSX.Element {
  return (
    <div className="rp-generic-artifact">
      <span className={`rp-generic-icon status-${fact.status}`}>
        <Ic name={KIND_ICON[fact.kind] ?? 'info'} size={26} />
      </span>
      <small>{appLabel(fact)}</small>
      <h2>{fact.action}</h2>
      {fact.detail ? <pre className="mono">{fact.detail}</pre> : null}
      <div className="rp-generic-level">{LEVEL_LABEL[fact.level]}</div>
    </div>
  );
}
