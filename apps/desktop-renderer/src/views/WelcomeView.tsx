import React, { useEffect, useState } from 'react';
import type { RecentWorkspaceDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { executeCommand } from '../commands.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';

export function WelcomeView(): React.JSX.Element {
  const appInfo = useAppStore((s) => s.appInfo);
  const [recent, setRecent] = useState<RecentWorkspaceDto[] | null>(null);

  useEffect(() => {
    void rpcResult('workspace.recent', {}).then((res) => {
      setRecent(res.ok ? res.data.items : []);
    });
  }, []);

  return (
    <div className="empty-state" data-testid="welcome-view">
      <div style={{ fontSize: 40 }}>⌘</div>
      <div className="es-title">Charter</div>
      <div className="text-muted">
        Local-first agentic IDE — edit like an IDE, delegate like an engineer.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          className="btn primary"
          data-testid="open-folder-btn"
          onClick={() => executeCommand('workspace.openFolder')}
        >
          Open Folder…
        </button>
        <button className="btn" onClick={() => executeCommand('app.openSettings')}>
          Settings
        </button>
      </div>
      {recent && recent.length > 0 ? (
        <div style={{ marginTop: 20, width: 'min(480px, 90%)', textAlign: 'left' }}>
          <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
            Recent
          </div>
          {recent.map((r) => (
            <button
              key={r.path}
              className="quickpick-item"
              data-testid="recent-workspace"
              disabled={!r.exists}
              title={r.path}
              onClick={() => void useWorkspaceStore.getState().openPath(r.path)}
            >
              <span>{r.displayName}</span>
              <span className="qp-detail">
                {r.path}
                {r.exists ? '' : ' (missing)'}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="text-muted" style={{ marginTop: 24, fontSize: 11 }}>
        v{appInfo?.appVersion ?? '…'} · <kbd>⌘⇧P</kbd> commands · <kbd>⌘O</kbd> open folder
      </div>
    </div>
  );
}
