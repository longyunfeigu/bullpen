import React, { useEffect, useState } from 'react';
import type { ChannelResponse } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';

type Diag = ChannelResponse<'diagnostics.get'>;

export function DiagnosticsView(): React.JSX.Element {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);

  const refresh = () => {
    void rpcResult('diagnostics.get', {}).then((res) => {
      if (res.ok) setDiag(res.data);
      else setError(res.error.userMessage);
    });
  };
  useEffect(refresh, []);

  const exportBundle = () => {
    setBundlePath(null);
    setBundleError(null);
    void rpcResult('diagnostics.supportBundle', {}).then((res) => {
      if (res.ok) setBundlePath(res.data.path);
      else setBundleError(res.error.userMessage);
    });
  };

  if (error) return <div className="empty-state text-danger">{error}</div>;
  if (!diag) return <div className="empty-state">Collecting diagnostics…</div>;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <h3 style={{ marginTop: 0 }}>Components</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {diag.components.map((c) => (
              <tr key={c.name} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px', fontWeight: 600 }}>{c.name}</td>
                <td
                  className={
                    c.status === 'ok'
                      ? 'text-success'
                      : c.status === 'down'
                        ? 'text-danger'
                        : 'text-muted'
                  }
                >
                  {c.status}
                </td>
                <td className="text-muted mono">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Database</h3>
        <p className={diag.dbOk ? 'text-success' : 'text-danger'}>
          {diag.dbOk ? 'OK' : 'Unavailable'} — <span className="text-muted">{diag.dbDetail}</span>
        </p>
      </section>
      <section>
        <h3>Recent errors</h3>
        {diag.recentErrors.length === 0 ? (
          <p className="text-muted">No recorded errors.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {diag.recentErrors.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px' }} className="mono">
                    {e.code}
                  </td>
                  <td className="text-muted">{e.component}</td>
                  <td className="text-muted">{e.severity}</td>
                  <td className="text-muted">{new Date(e.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={() => void rpcResult('diagnostics.openLogsFolder', {})}>
          Open logs folder
        </button>
        <button className="btn" onClick={refresh}>
          Refresh
        </button>
        <button
          className="btn primary"
          data-testid="support-bundle-export"
          title="Redacted: no secrets, code, prompts or absolute user paths"
          onClick={exportBundle}
        >
          Export support bundle
        </button>
      </div>
      {bundlePath ? (
        <p className="text-success" style={{ fontSize: 12 }}>
          Bundle saved:{' '}
          <span className="mono" data-testid="support-bundle-path">
            {bundlePath}
          </span>
        </p>
      ) : null}
      {bundleError ? (
        <p className="text-danger" style={{ fontSize: 12 }}>
          {bundleError}
        </p>
      ) : null}
      <p className="text-muted" style={{ fontSize: 12 }}>
        Logs directory: <span className="mono">{diag.logsDir}</span>
      </p>
    </div>
  );
}
