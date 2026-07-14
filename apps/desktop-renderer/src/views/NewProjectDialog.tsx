import React, { useState } from 'react';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { Ic } from './home-icons.js';

/** Derive a folder name from a git URL ("…/repo.git" → "repo"). */
function nameFromUrl(url: string): string {
  const tail = url.replace(/\/+$/, '').split(/[/:]/).filter(Boolean).pop();
  return (tail ?? '').replace(/\.git$/i, '');
}

/**
 * Home → New project…: create an empty folder (optional git init) or clone a
 * repository, then open it as the active project (stays on the Home surface).
 */
export function NewProjectDialog(props: { onClose: () => void }): React.JSX.Element {
  const app = useAppStore();
  const [mode, setMode] = useState<'empty' | 'clone'>('empty');
  const [parentDir, setParentDir] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [gitInit, setGitInit] = useState(true);
  const [cloneUrl, setCloneUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveName = nameTouched || mode === 'empty' ? name : name || nameFromUrl(cloneUrl);
  const ready =
    parentDir.trim().length > 0 &&
    effectiveName.trim().length > 0 &&
    (mode === 'empty' || cloneUrl.trim().length > 0) &&
    !busy;

  const browse = async (): Promise<void> => {
    const res = await rpcResult('workspace.pickParentDir', {});
    if (res.ok && res.data.path) setParentDir(res.data.path);
  };

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    // Stay on Home when the new workspace opens (same as picking a recent).
    app.setHomePick(true);
    const res = await rpcResult('workspace.createProject', {
      mode,
      parentDir: parentDir.trim(),
      name: effectiveName.trim(),
      gitInit: mode === 'empty' ? gitInit : false,
      ...(mode === 'clone' ? { cloneUrl: cloneUrl.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      app.setHomePick(false);
      setError(res.error.userMessage);
      return;
    }
    app.pushToast('info', `Project “${effectiveName.trim()}” is ready.`);
    props.onClose();
  };

  return (
    <div className="modal-backdrop" data-testid="new-project-dialog">
      <div className="modal" style={{ width: 460 }} role="dialog" aria-label="New project">
        <div className="modal-header">
          <span>New project</span>
          <button className="modal-close" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div
          style={{ padding: '4px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div className="hm-seg" role="radiogroup" aria-label="Project source">
            <button
              className={mode === 'empty' ? 'on' : ''}
              role="radio"
              aria-checked={mode === 'empty'}
              data-testid="new-project-mode-empty"
              onClick={() => setMode('empty')}
            >
              Empty folder
            </button>
            <button
              className={mode === 'clone' ? 'on' : ''}
              role="radio"
              aria-checked={mode === 'clone'}
              data-testid="new-project-mode-clone"
              onClick={() => setMode('clone')}
            >
              Clone from Git
            </button>
          </div>

          {mode === 'clone' ? (
            <div className="hm-field">
              <label>Repository URL</label>
              <input
                data-testid="new-project-url"
                placeholder="https://github.com/user/repo.git"
                value={cloneUrl}
                autoFocus
                onChange={(e) => setCloneUrl(e.target.value)}
              />
              <div className="hm-sec" style={{ marginTop: 3 }}>
                Public repos, or private ones your git/SSH setup can already reach — no password
                prompts here.
              </div>
            </div>
          ) : null}

          <div className="hm-field">
            <label>Location</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                data-testid="new-project-parent"
                className="mono"
                placeholder="Choose a folder…"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                data-testid="new-project-browse"
                onClick={() => void browse()}
              >
                Browse…
              </button>
            </div>
          </div>

          <div className="hm-field">
            <label>Name</label>
            <input
              data-testid="new-project-name"
              placeholder={mode === 'clone' ? nameFromUrl(cloneUrl) || 'repo name' : 'my-project'}
              value={effectiveName}
              autoFocus={mode === 'empty'}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>

          {mode === 'empty' ? (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="new-project-gitinit"
                checked={gitInit}
                onChange={(e) => setGitInit(e.target.checked)}
              />
              Initialize a git repository (recommended — enables isolated worktree tasks)
            </label>
          ) : null}

          {error ? (
            <div
              data-testid="new-project-error"
              style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.45 }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
            <button className="btn" onClick={props.onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn primary"
              data-testid="new-project-create"
              disabled={!ready}
              onClick={() => void submit()}
            >
              {busy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Ic name="clock" size={12} />
                  {mode === 'clone' ? 'Cloning…' : 'Creating…'}
                </span>
              ) : mode === 'clone' ? (
                'Clone'
              ) : (
                'Create'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
