import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useExternalStore } from '../store/externalStore.js';
import { useTerminalStore } from './TerminalPanel.js';

/**
 * ADR-0017 决策 4 —「检测升格」. While an accounted external CLI session is
 * active, its terminal (same xterm instance, PTY uninterrupted) is promoted
 * out of the bottom dock into this right-side vertical column. The column
 * carries a live "session changes" strip driven by the FS-watcher accounting;
 * a change row zooms into the session room, landing on that file's diff peek
 * (the peek is a room facility, ADR-0014). Session end returns the pane to
 * the dock.
 */
export function ExternalPanel(): React.JSX.Element | null {
  const promoted = useExternalStore((s) => s.promoted);
  const cli = useExternalStore((s) =>
    promoted ? (s.agentByTerminal[promoted.terminalId] ?? null) : null,
  );
  const session = useExternalStore((s) => (promoted ? s.sessions[promoted.taskId] : undefined));
  const surface = useAppStore((s) => s.surface);
  const items = useTerminalStore((s) => s.items);
  const hostRef = useRef<HTMLDivElement>(null);

  const item = promoted ? (items.find((t) => t.id === promoted.terminalId) ?? null) : null;

  // Mount the promoted terminal (same mount pattern as the dock / the room).
  // The room takes the instance while it is open (Home surface) — only claim
  // it while the Editor surface is actually in front.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !item || surface !== 'workspace') return;
    host.innerHTML = '';
    item.term.open(host);
    item.fit.fit();
    item.term.focus();
    const observer = new ResizeObserver(() => {
      try {
        item.fit.fit();
      } catch {
        // fit races during teardown are harmless
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [item, surface]);

  if (!promoted) return null;

  const files = session?.files ?? [];
  const openRoom = (path?: string): void => {
    const app = useAppStore.getState();
    app.openTaskRoom(promoted.taskId);
    if (path) app.openPeek(promoted.taskId, path, 'diff');
  };

  return (
    <aside className="external-panel" data-testid="external-panel" aria-label="External session">
      <div className="xp-head">
        <span className="xp-dot" />
        <span className="term-agent" data-testid={`terminal-agent-${promoted.terminalId}`}>
          ✳ {cli ?? session?.cli ?? 'agent'}{' '}
          <span
            className="term-agent-ext"
            title="External agent session — unmanaged (outside the Tool Gateway); tracked & reviewable"
          >
            EXT
          </span>
        </span>
        <span className="xp-sp" />
        <button
          className="xp-room"
          data-testid={`terminal-open-room-${promoted.terminalId}`}
          title="Open this session's Task Room — live changes, peek and review around this terminal"
          onClick={() => openRoom()}
        >
          ⤢ Open session room
        </button>
      </div>
      <div ref={hostRef} className="xp-term" data-testid="external-panel-terminal" />
      <div className="xp-strip" data-testid="external-strip">
        <div className="xp-strip-h">
          Session changes
          <span className="xp-cnt">{files.length}</span>
        </div>
        <div className="xp-strip-body">
          {files.length === 0 ? (
            <div className="xp-empty">No file changes yet.</div>
          ) : (
            files.map((f) => (
              <button
                key={f.path}
                className="xp-chg"
                data-testid={`external-strip-file-${f.path}`}
                title={`${f.path} — open the diff in the session room`}
                onClick={() => openRoom(f.path)}
              >
                <span className="xp-nm">{f.path.split('/').pop()}</span>
                <span className="xp-pm">
                  <span className="xp-p">+{f.additions}</span>{' '}
                  <span className="xp-m">−{f.deletions}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
