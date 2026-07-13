import React from 'react';
import { rpcResult } from '../bridge.js';
import { Ic } from './home-icons.js';

/** Safe diagnostics mode shown when the database or another core service failed
 * to start (APP-004 / UPD-004). No workbench features are available here. */
export function StartupErrorView(props: { code: string; message: string }): React.JSX.Element {
  return (
    <div className="empty-state" role="alert" data-testid="startup-error">
      <div style={{ color: 'var(--warning)' }}>
        <Ic name="alert" size={34} strokeWidth={1.5} />
      </div>
      <div className="es-title">Charter could not start normally</div>
      <p style={{ maxWidth: 520 }}>{props.message}</p>
      <p className="mono text-muted" style={{ fontSize: 12 }}>
        Error code: {props.code}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn primary"
          onClick={() => void rpcResult('diagnostics.openLogsFolder', {})}
        >
          Open logs folder
        </button>
        <button className="btn" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, maxWidth: 520 }}>
        Your task history and snapshots were NOT deleted. If a database migration failed, the
        previous database was restored from the automatic backup; report this error with the log
        files.
      </p>
    </div>
  );
}
