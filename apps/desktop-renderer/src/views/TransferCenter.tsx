import React, { useMemo, useState } from 'react';
import type { SftpTransferState } from '@pi-ide/ipc-contracts';
import { useSftpStore } from '../store/sftpStore.js';
import { useSshStore } from '../store/sshStore.js';
import { formatBytes } from './SftpPanel.js';

function formatRate(bytesPerSec: number): string {
  return bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';
}

function TransferRow(props: { transfer: SftpTransferState }): React.JSX.Element {
  const { transfer } = props;
  const rate = useSftpStore((s) => s.rates[transfer.transferId]);
  const cancel = useSftpStore((s) => s.cancel);
  const retry = useSftpStore((s) => s.retry);
  const dismiss = useSftpStore((s) => s.dismissTransfer);
  const running = transfer.status === 'running';
  const pct =
    transfer.totalBytes && transfer.totalBytes > 0
      ? Math.min(100, Math.round((transfer.doneBytes / transfer.totalBytes) * 100))
      : null;

  const meta = running
    ? [
        `${formatBytes(transfer.doneBytes)}${transfer.totalBytes ? ` / ${formatBytes(transfer.totalBytes)}` : ''}`,
        formatRate(rate?.bytesPerSec ?? 0),
      ]
        .filter(Boolean)
        .join(' · ')
    : transfer.status === 'error'
      ? (transfer.error ?? 'failed')
      : transfer.status;

  return (
    <div
      className={`tc-row ${transfer.status} ${transfer.direction}`}
      data-testid={`tc-row-${transfer.transferId}`}
    >
      <span className="tc-dir">{transfer.direction === 'upload' ? '↑' : '↓'}</span>
      <div className="tc-main">
        <div className="tc-head-row">
          <span className="tc-name" title={transfer.name}>
            {transfer.name}
          </span>
          <span className={`tc-meta ${transfer.status}`}>{meta}</span>
        </div>
        {running ? (
          <div className="sftp-bar">
            <div
              className={`sftp-bar-fill${pct === null ? ' indeterminate' : ''}`}
              style={pct === null ? undefined : { width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>
      {running ? (
        <button
          className="rm-icon-btn"
          title="Cancel transfer"
          aria-label={`Cancel ${transfer.name}`}
          data-testid={`tc-cancel-${transfer.transferId}`}
          onClick={() => cancel(transfer.transferId)}
        >
          ✕
        </button>
      ) : transfer.status === 'error' ? (
        <button
          className="rm-icon-btn"
          title="Retry transfer"
          aria-label={`Retry ${transfer.name}`}
          data-testid={`tc-retry-${transfer.transferId}`}
          onClick={() => void retry(transfer.transferId)}
        >
          ↺
        </button>
      ) : (
        <button
          className="rm-icon-btn"
          title="Dismiss"
          aria-label={`Dismiss ${transfer.name}`}
          onClick={() => dismiss(transfer.transferId)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Global Transfer Center (fused mockup): a persistent bottom-right pill that
 * aggregates every SFTP transfer across hosts and surfaces; expands into a
 * host-grouped popover with cancel / retry / clear. Replaces the old inline
 * per-panel transfer strip.
 */
export function TransferCenter(): React.JSX.Element | null {
  const transfers = useSftpStore((s) => s.transfers);
  const rates = useSftpStore((s) => s.rates);
  const clearFinished = useSftpStore((s) => s.clearFinished);
  const hosts = useSshStore((s) => s.hosts);
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const byHost = new Map<string, SftpTransferState[]>();
    for (const t of transfers) {
      const list = byHost.get(t.hostId) ?? [];
      list.push(t);
      byHost.set(t.hostId, list);
    }
    return [...byHost.entries()].map(([hostId, list]) => {
      const host = hosts.find((h) => h.id === hostId);
      return {
        hostId,
        label: host ? `${host.label} · ${host.username}@${host.host}` : hostId,
        list,
      };
    });
  }, [transfers, hosts]);

  if (transfers.length === 0) return null;

  const running = transfers.filter((t) => t.status === 'running');
  const failed = transfers.filter((t) => t.status === 'error');
  const withTotals = running.filter((t) => t.totalBytes && t.totalBytes > 0);
  const pct =
    withTotals.length > 0
      ? Math.min(
          100,
          Math.round(
            (withTotals.reduce((n, t) => n + t.doneBytes, 0) /
              withTotals.reduce((n, t) => n + (t.totalBytes ?? 0), 0)) *
              100,
          ),
        )
      : null;
  const totalRate = running.reduce((n, t) => n + (rates[t.transferId]?.bytesPerSec ?? 0), 0);

  const summary =
    running.length > 0
      ? `${running.length} active`
      : failed.length > 0
        ? `${failed.length} failed`
        : 'Transfers done';
  const detail =
    running.length > 0
      ? [pct !== null ? `${pct}%` : '', formatRate(totalRate)].filter(Boolean).join(' · ')
      : `${transfers.length}`;

  return (
    <div className="tc-anchor" data-testid="transfer-center">
      {open ? (
        <div className="tc-popover" data-testid="transfer-center-pop">
          <div className="tc-pop-head">
            <h3>Transfers</h3>
            <button className="tc-clear" onClick={clearFinished}>
              Clear finished
            </button>
          </div>
          <div className="tc-pop-list">
            {groups.map((g) => (
              <React.Fragment key={g.hostId}>
                <div className="tc-group">{g.label}</div>
                {g.list.map((t) => (
                  <TransferRow key={t.transferId} transfer={t} />
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : null}
      <button
        className={`tc-pill${failed.length > 0 && running.length === 0 ? ' failed' : ''}`}
        data-testid="transfer-center-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Transfer Center"
      >
        <span
          className="tc-ring"
          style={
            { '--p': pct !== null ? pct : running.length > 0 ? 30 : 100 } as React.CSSProperties
          }
          data-indeterminate={running.length > 0 && pct === null ? '1' : undefined}
        >
          <i>{running.length > 0 ? '↑' : failed.length > 0 ? '!' : '✓'}</i>
        </span>
        <b>{summary}</b>
        <span className="tc-rate">· {detail}</span>
      </button>
    </div>
  );
}
