import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SftpEntry, SshHostDto } from '@pi-ide/ipc-contracts';
import { pathForDroppedFile } from '../bridge.js';
import {
  useSftpStore,
  remoteJoin,
  remoteParent,
  localJoin,
  localParent,
} from '../store/sftpStore.js';
import { Ic } from './home-icons.js';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatMtime(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const now = Date.now();
  if (now - ms < 24 * 3600 * 1000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString();
}

/** Internal cross-pane drag marker (OS drops carry dataTransfer.files instead). */
const DRAG_MIME = 'application/x-charter-sftp';

type Side = 'local' | 'remote';

/** Multi-select bookkeeping: names + shift anchor, reset on navigation. */
function useSelection(entries: SftpEntry[], path: string) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<number>(-1);
  useEffect(() => {
    setSelected(new Set());
    anchor.current = -1;
  }, [path]);
  // Drop selections that no longer exist after a refresh.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const names = new Set(entries.map((e) => e.name));
      const next = new Set([...prev].filter((n) => names.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  const onRowClick = (e: React.MouseEvent, index: number): void => {
    const name = entries[index]?.name;
    if (!name) return;
    if (e.shiftKey && anchor.current >= 0) {
      const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      setSelected(new Set(entries.slice(from, to + 1).map((en) => en.name)));
    } else if (e.metaKey || e.ctrlKey) {
      anchor.current = index;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    } else {
      anchor.current = index;
      setSelected(new Set([name]));
    }
  };
  return { selected, setSelected, onRowClick };
}

function Crumbs(props: {
  side: Side;
  path: string;
  onNavigate: (p: string) => void;
}): React.JSX.Element {
  const { side, path, onNavigate } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(path);
  useEffect(() => {
    if (!editing) setValue(path);
  }, [path, editing]);

  const crumbs = useMemo(() => {
    const out: Array<{ label: string; path: string }> = [];
    if (side === 'remote' || !path.includes('\\')) {
      out.push({ label: '/', path: '/' });
      let acc = '';
      for (const part of path.split('/').filter(Boolean)) {
        acc += `/${part}`;
        out.push({ label: part, path: acc });
      }
    } else {
      // Windows local path: "C:\Users\me" → C: \ Users \ me
      const parts = path.split('\\').filter(Boolean);
      let acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}\\${part}` : part;
        out.push({ label: part, path: acc.includes('\\') ? acc : `${acc}\\` });
      }
    }
    return out;
  }, [side, path]);
  const parent = side === 'remote' ? remoteParent(path) : localParent(path);

  const submit = (): void => {
    setEditing(false);
    const target = value.trim();
    if (target && target !== path) onNavigate(target);
  };

  if (editing) {
    return (
      <div
        className="sftp-crumbs editing"
        data-testid={side === 'remote' ? 'sftp-crumbs' : 'sftp-local-crumbs'}
      >
        <input
          className="sftp-goto"
          data-testid={side === 'remote' ? 'sftp-path-input' : 'sftp-local-path-input'}
          value={value}
          autoFocus
          spellCheck={false}
          placeholder={side === 'remote' ? '/absolute/path or ~/…' : '/absolute/path or ~/…'}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="sftp-crumbs"
      data-testid={side === 'remote' ? 'sftp-crumbs' : 'sftp-local-crumbs'}
      title="Click to type a path"
      onClick={(e) => {
        // Empty-track click opens the path editor; crumbs keep their own clicks.
        if (e.target === e.currentTarget) setEditing(true);
      }}
    >
      {crumbs.map((c, i) => (
        <React.Fragment key={c.path}>
          {i > 1 ? <span className="sftp-crumb-sep">/</span> : null}
          <button
            className={`sftp-crumb${i === crumbs.length - 1 ? ' current' : ''}`}
            onClick={() => onNavigate(c.path)}
          >
            {c.label}
          </button>
        </React.Fragment>
      ))}
      <button
        className="rm-icon-btn sftp-goto-btn"
        title="Go to path…"
        aria-label="Go to path"
        data-testid={side === 'remote' ? 'sftp-path-edit' : 'sftp-local-path-edit'}
        onClick={() => setEditing(true)}
      >
        <Ic name="pencil" size={12} />
      </button>
      {parent !== path ? (
        <button className="btn sm sftp-up" onClick={() => onNavigate(parent)}>
          ↑ Up
        </button>
      ) : null}
    </div>
  );
}

function EntryRow(props: {
  side: Side;
  entry: SftpEntry;
  index: number;
  selected: boolean;
  onRowClick: (e: React.MouseEvent, index: number) => void;
  onOpen: () => void;
  onActivateFile: () => void;
  onDragStart: (e: React.DragEvent) => void;
  /** Remote-side management actions (rename/delete/download). */
  remoteActions?: {
    onDownload: () => void;
    onRename: (next: string) => Promise<void>;
    onDelete: () => void;
    confirmDelete: boolean;
  };
}): React.JSX.Element {
  const { side, entry, index, selected, onRowClick, onOpen, onActivateFile, onDragStart } = props;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(entry.name);
  const isDir = entry.type === 'dir';

  const submitRename = async (): Promise<void> => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === entry.name) return;
    await props.remoteActions?.onRename(next);
  };

  return (
    <div
      className={`sftp-row${isDir ? ' dir' : ''}${selected ? ' sel' : ''}`}
      data-testid={
        side === 'remote' ? `sftp-entry-${entry.name}` : `sftp-local-entry-${entry.name}`
      }
      draggable={!renaming}
      onDragStart={onDragStart}
      onClick={(e) => onRowClick(e, index)}
      onDoubleClick={() => (isDir ? onOpen() : onActivateFile())}
    >
      <span className="sftp-icn">
        <Ic name={isDir ? 'folder' : 'file'} size={14} />
      </span>
      {renaming ? (
        <input
          className="sftp-rename"
          value={name}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void submitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitRename();
            if (e.key === 'Escape') {
              setName(entry.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button
          className="sftp-name"
          title={entry.name}
          onClick={(e) => {
            if (isDir) {
              e.stopPropagation();
              onOpen();
            }
          }}
        >
          {entry.name}
          {entry.symlink ? <span className="sftp-sym">→</span> : null}
        </button>
      )}
      <span className="sftp-size">{isDir ? '' : formatBytes(entry.size)}</span>
      <span className="sftp-mtime">{formatMtime(entry.mtimeMs)}</span>
      {props.remoteActions ? (
        <span className="sftp-actions">
          {!isDir ? (
            <button
              className="rm-icon-btn"
              title="Download to the local folder"
              aria-label={`Download ${entry.name}`}
              data-testid={`sftp-download-${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                props.remoteActions?.onDownload();
              }}
            >
              <Ic name="inbox" size={13} />
            </button>
          ) : null}
          <button
            className="rm-icon-btn"
            title="Rename"
            aria-label={`Rename ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setName(entry.name);
              setRenaming(true);
            }}
          >
            <Ic name="pencil" size={13} />
          </button>
          <button
            className="rm-icon-btn danger"
            title={
              props.remoteActions.confirmDelete ? 'Click again to delete' : `Delete ${entry.name}`
            }
            aria-label={`Delete ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              props.remoteActions?.onDelete();
            }}
          >
            <Ic name={props.remoteActions.confirmDelete ? 'check' : 'trash'} size={13} />
          </button>
        </span>
      ) : (
        <span className="sftp-actions" />
      )}
    </div>
  );
}

/**
 * Dual-pane SFTP browser (fused mockup): local pane ↔ transfer gutter ↔
 * remote pane. Select rows and push them across with ›/‹, drag between panes,
 * or drop OS files on the remote side. Bytes stream entirely in the main
 * process; transfers surface in the global Transfer Center.
 */
export function SftpPanel(props: { host: SshHostDto; onBack: () => void }): React.JSX.Element {
  const { host, onBack } = props;
  const {
    hostId,
    path,
    entries,
    loading,
    error,
    localPath,
    localEntries,
    localLoading,
    localError,
  } = useSftpStore();
  const [dragSide, setDragSide] = useState<Side | null>(null); // pane being hovered by a drag
  const [internalDrag, setInternalDrag] = useState<Side | null>(null); // pane a drag started from
  const [actionError, setActionError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const local = useSelection(localEntries, localPath);
  const remote = useSelection(entries, path);

  useEffect(() => {
    void useSftpStore.getState().open(host.id);
    return () => useSftpStore.getState().close();
  }, [host.id]);

  const navigate = (p: string): void => {
    setActionError(null);
    // The SFTP server treats ~ literally — expand it against the known home.
    const home = useSftpStore.getState().remoteHome;
    const target =
      home && p === '~' ? home : home && p.startsWith('~/') ? remoteJoin(home, p.slice(2)) : p;
    void useSftpStore.getState().navigate(target);
  };
  const navigateLocal = (p: string): void => {
    setActionError(null);
    void useSftpStore.getState().navigateLocal(p);
  };

  const uploadNames = (names: string[]): void => {
    const paths = names.map((n) => localJoin(localPath, n));
    if (paths.length > 0) void useSftpStore.getState().upload(paths);
  };
  const downloadNames = (names: string[]): void => {
    const picked = entries.filter((e) => names.includes(e.name));
    if (picked.length > 0) void useSftpStore.getState().download(picked);
  };

  const uploadSelection = (): void => uploadNames([...local.selected]);
  const downloadSelection = (): void => downloadNames([...remote.selected]);

  /** Drag started on a row: drag the selection, or just that row if unselected. */
  const startDrag = (side: Side, entryName: string) => (e: React.DragEvent) => {
    const sel = side === 'local' ? local : remote;
    const names = sel.selected.has(entryName) ? [...sel.selected] : [entryName];
    if (!sel.selected.has(entryName)) sel.setSelected(new Set([entryName]));
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ side, names }));
    e.dataTransfer.effectAllowed = 'copy';
    setInternalDrag(side);
  };

  const onPaneDrop =
    (side: Side) =>
    (e: React.DragEvent): void => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragSide(null);
      setInternalDrag(null);
      const internal = e.dataTransfer.getData(DRAG_MIME);
      if (internal) {
        try {
          const { side: from, names } = JSON.parse(internal) as { side: Side; names: string[] };
          if (from === 'local' && side === 'remote') uploadNames(names);
          else if (from === 'remote' && side === 'local') downloadNames(names);
        } catch {
          /* malformed internal payload — ignore */
        }
        return;
      }
      // OS file drop → upload into the remote directory, wherever it landed.
      const paths = [...e.dataTransfer.files]
        .map((f) => pathForDroppedFile(f))
        .filter((p): p is string => Boolean(p));
      if (paths.length > 0) void useSftpStore.getState().upload(paths);
    };

  const paneDragProps = (side: Side) => ({
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current += 1;
      setDragSide(side);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragSide(null);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: onPaneDrop(side),
  });

  /** A drop target only lights up when something transferable hovers it. */
  const dropActive = (side: Side): boolean => {
    if (dragSide !== side) return false;
    if (internalDrag) return internalDrag !== side;
    return side === 'remote'; // OS files can only go remote
  };

  const requestDelete = (entry: SftpEntry): void => {
    if (confirmDelete !== entry.name) {
      setConfirmDelete(entry.name);
      window.setTimeout(() => setConfirmDelete((v) => (v === entry.name ? null : v)), 3000);
      return;
    }
    setConfirmDelete(null);
    void useSftpStore
      .getState()
      .remove(entry)
      .then((err) => err && setActionError(err));
  };

  const localSelSize = localEntries
    .filter((e) => local.selected.has(e.name) && e.type !== 'dir')
    .reduce((n, e) => n + e.size, 0);
  const remoteFileSel = entries.filter((e) => remote.selected.has(e.name) && e.type !== 'dir');

  return (
    <div className="sftp-panel" data-testid="sftp-panel">
      <div className="sftp-head">
        <button className="btn sm" onClick={onBack} data-testid="sftp-back">
          ← Hosts
        </button>
        <div className="sftp-title">
          <strong>{host.label}</strong>
          <span>
            {host.username}@{host.host} · Files
          </span>
        </div>
        <div className="sftp-tools">
          <button
            className="btn sm"
            onClick={() => setNewFolder('')}
            disabled={loading || hostId !== host.id}
          >
            New Folder
          </button>
          <button
            className="btn sm"
            onClick={() => {
              void useSftpStore.getState().refresh();
              void useSftpStore.getState().refreshLocal();
            }}
          >
            <Ic name="refresh" size={12} /> Refresh
          </button>
        </div>
      </div>

      {actionError ? <div className="rm-error">{actionError}</div> : null}

      <div className="sftp-cols" onDragEnd={() => setInternalDrag(null)}>
        {/* ---- local pane ---- */}
        <div className="sftp-pane" data-testid="sftp-local-pane" {...paneDragProps('local')}>
          <div className="sftp-pane-head">
            <span className="rm-dot" />
            <span className="sftp-pane-who">This Mac</span>
          </div>
          <Crumbs side="local" path={localPath} onNavigate={navigateLocal} />
          {localError ? <div className="rm-error">{localError}</div> : null}
          <div className={`sftp-list${dropActive('local') ? ' dropping' : ''}`}>
            {localLoading ? (
              <div className="sftp-hintline">Loading…</div>
            ) : localEntries.length === 0 && !localError ? (
              <div className="sftp-hintline">Empty folder.</div>
            ) : (
              localEntries.map((entry, i) => (
                <EntryRow
                  key={entry.name}
                  side="local"
                  entry={entry}
                  index={i}
                  selected={local.selected.has(entry.name)}
                  onRowClick={local.onRowClick}
                  onOpen={() => navigateLocal(localJoin(localPath, entry.name))}
                  onActivateFile={() => uploadNames([entry.name])}
                  onDragStart={startDrag('local', entry.name)}
                />
              ))
            )}
          </div>
          <div className="sftp-pane-foot">
            {local.selected.size > 0
              ? `${local.selected.size} selected${localSelSize > 0 ? ` · ${formatBytes(localSelSize)}` : ''}`
              : 'Select files, then › to upload'}
          </div>
        </div>

        {/* ---- transfer gutter ---- */}
        <div className="sftp-gutter">
          <button
            className={`sftp-xfer-btn${local.selected.size > 0 ? ' on' : ''}`}
            title="Upload selected to the remote folder"
            aria-label="Upload selected"
            data-testid="sftp-upload-selected"
            disabled={local.selected.size === 0}
            onClick={uploadSelection}
          >
            ›
          </button>
          <small>transfer</small>
          <button
            className={`sftp-xfer-btn${remoteFileSel.length > 0 ? ' on' : ''}`}
            title="Download selected to the local folder"
            aria-label="Download selected"
            data-testid="sftp-download-selected"
            disabled={remoteFileSel.length === 0}
            onClick={downloadSelection}
          >
            ‹
          </button>
        </div>

        {/* ---- remote pane ---- */}
        <div
          className="sftp-pane remote"
          data-testid="sftp-remote-pane"
          {...paneDragProps('remote')}
        >
          <div className="sftp-pane-head">
            <span className={`rm-dot ${host.connection.state}`} />
            <span className="sftp-pane-who">
              {host.username}@{host.host}
            </span>
          </div>
          <Crumbs side="remote" path={path} onNavigate={navigate} />
          {error ? <div className="rm-error">{error}</div> : null}
          {newFolder !== null ? (
            <div className="sftp-newfolder">
              <Ic name="folder" size={14} />
              <input
                autoFocus
                placeholder="folder name"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNewFolder(null);
                  if (e.key === 'Enter' && newFolder.trim()) {
                    void useSftpStore
                      .getState()
                      .mkdir(newFolder.trim())
                      .then((err) => {
                        if (err) setActionError(err);
                        else setNewFolder(null);
                      });
                  }
                }}
              />
              <button
                className="rm-icon-btn"
                aria-label="Cancel"
                onClick={() => setNewFolder(null)}
              >
                <Ic name="x" size={13} />
              </button>
            </div>
          ) : null}
          <div
            className={`sftp-list${dropActive('remote') ? ' dropping' : ''}`}
            data-testid="sftp-list"
          >
            {loading ? (
              <div className="sftp-hintline">Loading {path}…</div>
            ) : entries.length === 0 && !error ? (
              <div className="sftp-hintline">Empty directory — drop files here to upload.</div>
            ) : (
              entries.map((entry, i) => (
                <EntryRow
                  key={entry.name}
                  side="remote"
                  entry={entry}
                  index={i}
                  selected={remote.selected.has(entry.name)}
                  onRowClick={remote.onRowClick}
                  onOpen={() => navigate(remoteJoin(path, entry.name))}
                  onActivateFile={() => downloadNames([entry.name])}
                  onDragStart={startDrag('remote', entry.name)}
                  remoteActions={{
                    onDownload: () => downloadNames([entry.name]),
                    onRename: async (next) => {
                      const err = await useSftpStore
                        .getState()
                        .rename(remoteJoin(path, entry.name), next);
                      if (err) setActionError(err);
                    },
                    onDelete: () => requestDelete(entry),
                    confirmDelete: confirmDelete === entry.name,
                  }}
                />
              ))
            )}
          </div>
          <div className="sftp-pane-foot">
            {remote.selected.size > 0
              ? `${remote.selected.size} selected · ‹ downloads to ${localPath || 'local'}`
              : `Drop files here · uploads to ${path}`}
          </div>
        </div>
      </div>
    </div>
  );
}
