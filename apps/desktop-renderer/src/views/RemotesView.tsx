import React, { useEffect, useMemo, useState } from 'react';
import type { SshConfigCandidate, SshHostDto, SshHostInput } from '@pi-ide/ipc-contracts';
import { useAppStore } from '../store/appStore.js';
import { forwardKey, useSshStore } from '../store/sshStore.js';
import { useTerminalStore } from './TerminalPanel.js';
import { Ic } from './home-icons.js';
import { RemoteHostDialog } from './RemoteHostDialog.js';
import { ForwardsDialog } from './ForwardsDialog.js';
import { SftpPanel } from './SftpPanel.js';

/** The trailing path segment of an identity file, for the auth badge. */
function baseName(path: string | null): string {
  if (!path) return '';
  return (
    path
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() ?? ''
  );
}

/** Coarse "x ago" for the last-connected line; exact time isn't important here. */
function relativeTime(iso: string | null): string {
  if (!iso) return 'never connected';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never connected';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'last: just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `last: ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `last: ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `last: ${days}d ago`;
  return `last: ${new Date(then).toLocaleDateString()}`;
}

function authLabel(host: SshHostDto): string {
  if (host.auth === 'agent') return 'agent';
  if (host.auth === 'key') {
    const file = baseName(host.identityFile);
    return file ? `key · ${file}` : 'key';
  }
  return host.hasPassword ? 'password · keychain' : 'password';
}

/** Open (and implicitly connect) a remote shell session, then leave the
 * Remotes surface. Remote sessions are shell-only for now (user decision
 * 2026-07-24) — the launch×target engine stays, the UI doesn't offer it.
 * Routed through the terminal store so the renderer builds the xterm instance —
 * calling the IPC directly would leave a session id with no live terminal. */
async function openRemote(hostId: string): Promise<void> {
  const id = await useTerminalStore
    .getState()
    .create({ launch: 'shell', target: { kind: 'ssh', hostId }, reveal: false });
  if (!id) return; // create() already surfaced the failure as a toast
  useAppStore.getState().openTerminalSession(id);
  useAppStore.getState().closeRemotes?.();
}

/** Primary card action: Connect / New Session — always a shell. */
function LaunchButton(props: {
  host: SshHostDto;
  connected: boolean;
  pending: boolean;
  busy: boolean;
  onLaunch: () => void;
}): React.JSX.Element {
  const { host, connected, pending, busy, onLaunch } = props;
  return (
    <button
      className="btn sm primary"
      data-testid={connected ? `rm-new-session-${host.id}` : `rm-connect-${host.id}`}
      disabled={busy || pending}
      onClick={onLaunch}
    >
      {pending ? 'Connecting…' : busy ? 'Opening…' : connected ? '+ New Session' : 'Connect'}
    </button>
  );
}

function HostCard(props: {
  host: SshHostDto;
  onEdit: () => void;
  onFiles: () => void;
  onForwards: () => void;
}): React.JSX.Element {
  const { host, onEdit, onFiles, onForwards } = props;
  const disconnect = useSshStore((s) => s.disconnect);
  const deleteHost = useSshStore((s) => s.deleteHost);
  const forwardStates = useSshStore((s) => s.forwardStates);
  const termItems = useTerminalStore((s) => s.items);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<'open' | 'disconnect' | null>(null);

  const state = host.connection.state;
  const connected = state === 'connected';
  const pending = state === 'connecting' || state === 'reconnecting';

  const sessions = termItems.filter((t) => t.remote?.hostId === host.id && !t.exited && !t.hidden);
  const activeForwards = host.forwards.filter((f) => {
    const s = forwardStates[forwardKey(host.id, f.id)];
    return s !== undefined && s.status !== 'stopped';
  });

  const run = async (): Promise<void> => {
    setBusy('open');
    await openRemote(host.id);
    setBusy(null);
  };

  const focusSession = (id: string): void => {
    useAppStore.getState().openTerminalSession(id);
    useAppStore.getState().closeRemotes?.();
  };

  return (
    <div className="rm-card" data-testid={`rm-host-${host.id}`}>
      <div className="rm-card-row1">
        <span className={`rm-dot ${state}`} title={state} />
        <span className="rm-card-name" title={host.label}>
          {host.label}
        </span>
        <button className="rm-icon-btn" title="Edit host" aria-label="Edit host" onClick={onEdit}>
          <Ic name="pencil" size={14} />
        </button>
        <button
          className="rm-icon-btn danger"
          title={confirmDelete ? 'Click again to delete' : 'Delete host'}
          aria-label="Delete host"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              window.setTimeout(() => setConfirmDelete(false), 3000);
              return;
            }
            void deleteHost(host.id);
          }}
        >
          <Ic name={confirmDelete ? 'check' : 'trash'} size={14} />
        </button>
      </div>

      <div className="rm-addr">
        {host.username}@{host.host}:{host.port}
      </div>

      <div className="rm-badges">
        {host.tags.map((t) => (
          <span className="rm-badge tag" key={t}>
            {t}
          </span>
        ))}
        <span className="rm-badge auth">{authLabel(host)}</span>
        {host.proxyJump ? (
          <span className="rm-badge jump" title={`Single hop via ${host.proxyJump}`}>
            jump: {host.proxyJump}
          </span>
        ) : null}
        {activeForwards.length > 0 ? (
          <span
            className="rm-badge fwd"
            title={activeForwards
              .map((f) => `${f.bindHost}:${f.bindPort} → ${f.targetHost}:${f.targetPort}`)
              .join('\n')}
          >
            {activeForwards.length} fwd
          </span>
        ) : null}
      </div>

      {host.connection.error ? <div className="rm-error">{host.connection.error}</div> : null}

      {sessions.length > 0 ? (
        <div className="rm-sessions" data-testid={`rm-sessions-${host.id}`}>
          {sessions.map((s) => (
            <button
              key={s.id}
              className="rm-session-row"
              title="Go to session"
              data-testid={`rm-session-${s.id}`}
              onClick={() => focusSession(s.id)}
            >
              <Ic name={s.launch === 'shell' ? 'terminal' : s.launch} size={12} />
              <span className="rm-session-name">{s.title}</span>
              <span className="rm-session-kind">{s.launch}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="rm-foot">
        <span className="rm-last">
          {connected
            ? sessions.length > 0
              ? `connected · ${sessions.length} session${sessions.length === 1 ? '' : 's'}`
              : activeForwards.length > 0
                ? 'connected · forwards active'
                : 'connected · idle'
            : pending
              ? state === 'reconnecting'
                ? 'reconnecting…'
                : 'connecting…'
              : relativeTime(host.lastConnectedAt)}
        </span>
        <div className="rm-actions">
          <LaunchButton
            host={host}
            connected={connected}
            pending={pending}
            busy={busy !== null}
            onLaunch={() => void run()}
          />
          <button
            className="btn sm"
            data-testid={`rm-files-${host.id}`}
            title="Browse files over SFTP"
            onClick={onFiles}
          >
            Files
          </button>
          <button
            className="btn sm"
            data-testid={`rm-forwards-${host.id}`}
            title="Local port forwards"
            onClick={onForwards}
          >
            Forwards{activeForwards.length > 0 ? ` · ${activeForwards.length}` : ''}
          </button>
          {connected ? (
            <button
              className="btn sm danger"
              data-testid={`rm-disconnect-${host.id}`}
              disabled={busy === 'disconnect'}
              onClick={() => {
                setBusy('disconnect');
                void disconnect(host.id).finally(() => setBusy(null));
              }}
            >
              Disconnect
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Import preview: choose ~/.ssh/config entries to add to the host book. */
function ImportPanel(props: {
  candidates: SshConfigCandidate[];
  onClose: () => void;
}): React.JSX.Element {
  const { candidates, onClose } = props;
  const applyImport = useSshStore((s) => s.applyImport);
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(candidates.map((c, i) => (c.alreadyImported ? -1 : i)).filter((i) => i >= 0)),
  );
  const [usernames, setUsernames] = useState<string[]>(() =>
    candidates.map((c) => c.username ?? ''),
  );
  const [busy, setBusy] = useState(false);

  const toggle = (i: number): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const selected = [...picked];
  const missingUser = selected.some((i) => (usernames[i] ?? '').trim().length === 0);
  const ready = selected.length > 0 && !missingUser && !busy;

  const apply = async (): Promise<void> => {
    setBusy(true);
    const hosts: SshHostInput[] = selected.flatMap((i) => {
      const c = candidates[i];
      if (!c) return [];
      return [
        {
          label: c.alias,
          host: c.host,
          port: c.port,
          username: (usernames[i] ?? '').trim(),
          auth: c.identityFile ? ('key' as const) : ('agent' as const),
          identityFile: c.identityFile,
          proxyJump: c.proxyJump,
          tags: [],
          remoteWorkdir: null,
        },
      ];
    });
    const added = await applyImport(hosts);
    useAppStore.getState().pushToast('info', `Imported ${added} host${added === 1 ? '' : 's'}.`);
    setBusy(false);
    onClose();
  };

  return (
    <div className="rm-backdrop" role="dialog" aria-label="Import SSH hosts">
      <div className="rm-dialog wide">
        <div className="rm-dialog-head">
          <h2>Import from ~/.ssh/config</h2>
          <button className="rm-icon-btn" aria-label="Close" onClick={onClose}>
            <Ic name="x" size={15} />
          </button>
        </div>
        <div className="rm-dialog-body">
          {candidates.length === 0 ? (
            <p className="rm-hint">No hosts found in ~/.ssh/config.</p>
          ) : (
            <>
              <p className="rm-hint">
                Keys and ProxyJump are mapped automatically. Fill a username where your config omits
                one.
              </p>
              <div className="rm-imp-list">
                {candidates.map((c, i) => (
                  <div
                    className={`rm-imp-row${c.alreadyImported ? ' dim' : ''}`}
                    key={`${c.alias}-${i}`}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      aria-label={`Select ${c.alias}`}
                      onChange={() => toggle(i)}
                    />
                    <div>
                      <strong>
                        {c.alias}
                        {c.alreadyImported ? ' · already imported' : ''}
                      </strong>
                      <small>
                        {c.host}:{c.port}
                        {c.proxyJump ? ` · jump ${c.proxyJump}` : ''}
                        {c.identityFile ? ` · ${baseName(c.identityFile)}` : ''}
                      </small>
                    </div>
                    <input
                      className={`rm-imp-user${(usernames[i] ?? '').trim() ? '' : ' missing'}`}
                      placeholder="username"
                      value={usernames[i] ?? ''}
                      onChange={(e) =>
                        setUsernames((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="rm-dialog-foot">
          {missingUser ? (
            <span className="rm-spacer rm-error-line">Some selected hosts need a username.</span>
          ) : null}
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready} onClick={() => void apply()}>
            {busy ? 'Importing…' : `Import ${selected.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Remotes — the SSH host library (mockup b, screen 1). Lists saved hosts as
 * cards with connect / Claude / Codex launches, host create/edit, and a
 * ~/.ssh/config import flow. Secrets never live here (see RemoteHostDialog).
 */
export function RemotesView(): React.JSX.Element {
  const hosts = useSshStore((s) => s.hosts);
  const loaded = useSshStore((s) => s.loaded);
  const importConfig = useSshStore((s) => s.importConfig);

  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; host?: SshHostDto } | null>(null);
  const [filesHostId, setFilesHostId] = useState<string | null>(null);
  const [forwardsHostId, setForwardsHostId] = useState<string | null>(null);
  const [importState, setImportState] = useState<
    { status: 'loading' } | { status: 'open'; candidates: SshConfigCandidate[] } | null
  >(null);

  useEffect(() => {
    useSshStore.getState().init();
  }, []);

  const filesHost = filesHostId ? (hosts.find((h) => h.id === filesHostId) ?? null) : null;
  const forwardsHost = forwardsHostId ? (hosts.find((h) => h.id === forwardsHostId) ?? null) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.label, h.host, h.username, ...h.tags].join(' ').toLowerCase().includes(q),
    );
  }, [hosts, query]);

  const openImport = async (): Promise<void> => {
    setImportState({ status: 'loading' });
    const candidates = await importConfig();
    setImportState({ status: 'open', candidates });
  };

  if (filesHost) {
    return (
      <div className="rm-page" data-testid="remotes-view">
        <div className="rm-inner">
          <SftpPanel host={filesHost} onBack={() => setFilesHostId(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="rm-page" data-testid="remotes-view">
      <div className="rm-inner">
        <div className="rm-head">
          <h1>Remotes</h1>
          <div className="rm-search">
            <Ic name="search" size={14} />
            <input
              placeholder="Search hosts, tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search hosts"
            />
          </div>
          <button className="btn primary" onClick={() => setDialog({ mode: 'create' })}>
            New Host
          </button>
        </div>

        {!loaded ? (
          <div className="rm-grid">
            {[0, 1, 2].map((i) => (
              <div className="rm-skeleton" key={i} />
            ))}
          </div>
        ) : hosts.length === 0 ? (
          <div className="rm-empty">
            <strong>No remotes yet</strong>
            <p>
              Add an SSH host to open remote shells, Claude or Codex sessions — or import the hosts
              you already have in ~/.ssh/config.
            </p>
            <div className="rm-actions">
              <button className="btn primary" onClick={() => setDialog({ mode: 'create' })}>
                New Host
              </button>
              <button
                className="btn"
                onClick={() => void openImport()}
                disabled={importState?.status === 'loading'}
              >
                {importState?.status === 'loading' ? 'Scanning…' : 'Import…'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rm-grid">
            {filtered.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                onEdit={() => setDialog({ mode: 'edit', host })}
                onFiles={() => setFilesHostId(host.id)}
                onForwards={() => setForwardsHostId(host.id)}
              />
            ))}
            <div
              className="rm-card import"
              role="button"
              tabIndex={0}
              onClick={() => void openImport()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') void openImport();
              }}
            >
              <b>Import from ~/.ssh/config</b>
              <span>
                {importState?.status === 'loading'
                  ? 'Scanning…'
                  : 'Keys and ProxyJump are mapped automatically'}
              </span>
              <button
                className="btn sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void openImport();
                }}
              >
                Import…
              </button>
            </div>
          </div>
        )}

        {loaded && hosts.length > 0 && filtered.length === 0 ? (
          <div className="rm-empty">
            <p>No hosts match “{query}”.</p>
          </div>
        ) : null}
      </div>

      {dialog ? (
        <RemoteHostDialog mode={dialog.mode} host={dialog.host} onClose={() => setDialog(null)} />
      ) : null}

      {forwardsHost ? (
        <ForwardsDialog host={forwardsHost} onClose={() => setForwardsHostId(null)} />
      ) : null}

      {importState?.status === 'open' ? (
        <ImportPanel candidates={importState.candidates} onClose={() => setImportState(null)} />
      ) : null}
    </div>
  );
}
