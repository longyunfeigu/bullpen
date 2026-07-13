import React, { useState } from 'react';
import type { ChangeSetFileDto, ReviewHunkDto } from '@pi-ide/ipc-contracts';
import { useTaskStore, activeTask } from '../store/taskStore.js';
import { useEditorStore } from '../store/editorStore.js';
import { ConfirmDangerButton } from './ui.js';
import { stateLabel } from './labels.js';

const STATUS_LABEL: Record<ChangeSetFileDto['status'], string> = {
  created: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

function DiffLine({ line }: { line: string }): React.JSX.Element {
  const color = line.startsWith('+')
    ? 'var(--success)'
    : line.startsWith('-')
      ? 'var(--danger)'
      : 'var(--fg-muted)';
  return (
    <div
      className="mono"
      style={{ color, whiteSpace: 'pre-wrap', fontSize: 11.5, lineHeight: '17px' }}
    >
      {line || ' '}
    </div>
  );
}

function HunkCard({
  file,
  hunk,
}: {
  file: ChangeSetFileDto;
  hunk: ReviewHunkDto;
}): React.JSX.Element {
  const store = useTaskStore();
  const decided = hunk.state !== 'pending';
  return (
    <div
      data-testid={`hunk-${hunk.key}`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        margin: '6px 0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '3px 8px',
          background: 'var(--bg-input)',
          fontSize: 11,
        }}
      >
        <span className="mono text-muted" style={{ flex: 1 }}>
          {hunk.header}
        </span>
        {decided ? (
          <span
            data-testid={`hunk-state-${hunk.key}`}
            style={{
              color: hunk.state === 'accepted' ? 'var(--success)' : 'var(--danger)',
              fontWeight: 600,
            }}
          >
            {hunk.state}
          </span>
        ) : (
          <>
            <button
              className="btn"
              data-testid={`hunk-accept-${hunk.key}`}
              onClick={() =>
                void store.reviewDecision({
                  path: file.path,
                  scope: 'hunk',
                  decision: 'accept',
                  hunkKey: hunk.key,
                  ...(file.currentHash ? { expectedCurrentHash: file.currentHash } : {}),
                })
              }
            >
              ✓ Accept
            </button>
            <button
              className="btn danger"
              data-testid={`hunk-reject-${hunk.key}`}
              onClick={() =>
                void store.reviewDecision({
                  path: file.path,
                  scope: 'hunk',
                  decision: 'reject',
                  hunkKey: hunk.key,
                  ...(file.currentHash ? { expectedCurrentHash: file.currentHash } : {}),
                })
              }
            >
              ✕ Reject
            </button>
          </>
        )}
      </div>
      <div style={{ padding: '4px 8px', maxHeight: 260, overflow: 'auto' }}>
        {hunk.lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </div>
    </div>
  );
}

function FileSection({ file }: { file: ChangeSetFileDto }): React.JSX.Element {
  const store = useTaskStore();
  const editor = useEditorStore();
  const [open, setOpen] = useState(true);
  return (
    <div
      data-testid={`review-file-${file.path}`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        margin: '8px 0',
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px' }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--fg)',
            cursor: 'pointer',
            padding: 0,
          }}
          aria-label={open ? 'Collapse file' : 'Expand file'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span
          className="mono"
          style={{
            color:
              file.status === 'created'
                ? 'var(--success)'
                : file.status === 'deleted'
                  ? 'var(--danger)'
                  : 'var(--info)',
            fontWeight: 700,
          }}
        >
          {STATUS_LABEL[file.status]}
        </span>
        <button
          className="mono"
          onClick={() => file.status !== 'deleted' && void editor.openFile(file.path)}
          style={{
            flex: 1,
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: 'var(--fg)',
            cursor: file.status === 'deleted' ? 'default' : 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 12.5,
          }}
          title={file.renamedFrom ? `renamed from ${file.renamedFrom}` : file.path}
        >
          {file.path}
          {file.renamedFrom ? ` ← ${file.renamedFrom}` : ''}
        </button>
        <span style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--success)' }}>+{file.additions}</span>{' '}
          <span style={{ color: 'var(--danger)' }}>-{file.deletions}</span>
        </span>
        <span
          className="text-muted"
          data-testid={`review-file-state-${file.path}`}
          style={{ fontSize: 11 }}
        >
          {file.reviewState}
        </span>
        {file.reviewState !== 'accepted' ? (
          <>
            <button
              className="btn"
              data-testid={`file-accept-${file.path}`}
              onClick={() =>
                void store.reviewDecision({ path: file.path, scope: 'file', decision: 'accept' })
              }
            >
              Accept file
            </button>
            <button
              className="btn danger"
              data-testid={`file-reject-${file.path}`}
              onClick={() => {
                if (
                  window.confirm(
                    `Reject all changes to ${file.path}? The file is restored to its pre-task state.`,
                  )
                ) {
                  void store.reviewDecision({
                    path: file.path,
                    scope: 'file',
                    decision: 'reject',
                    ...(file.currentHash ? { expectedCurrentHash: file.currentHash } : {}),
                  });
                }
              }}
            >
              Reject file
            </button>
          </>
        ) : null}
      </div>
      {open ? (
        <div style={{ padding: '0 10px 8px 10px' }}>
          {file.binary ? (
            <div className="text-muted" style={{ fontSize: 12 }}>
              Binary file — no text diff available.
            </div>
          ) : file.hunks.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 12 }}>
              No remaining diff (the change was reverted or superseded).
            </div>
          ) : (
            file.hunks.map((hunk) => <HunkCard key={hunk.key} file={file} hunk={hunk} />)
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Task-level review (REV, CHG-005/007/008): net diff per file, hunk decisions, accept. */
export function ReviewView(): React.JSX.Element | null {
  const store = useTaskStore();
  const task = activeTask(store);
  if (!store.reviewOpen || !task) return null;
  const cs = store.changeSet;
  const canDecide = task.state === 'REVIEW_READY';

  return (
    <div
      data-testid="review-view"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        // Opaque surface: a transparent overlay let the workbench chrome and
        // its empty states bleed through (PIVOT-024 collision fix).
        background: 'var(--bg-editor)',
        display: 'flex',
        flexDirection: 'column',
      }}
      role="dialog"
      aria-label="Review changes"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontWeight: 700 }}>Review — {task.title}</span>
        {cs ? (
          <span className="text-muted" style={{ fontSize: 12 }} data-testid="review-totals">
            {cs.files.length} file{cs.files.length === 1 ? '' : 's'} ·{' '}
            <span style={{ color: 'var(--success)' }}>+{cs.totalAdditions}</span>{' '}
            <span style={{ color: 'var(--danger)' }}>-{cs.totalDeletions}</span>
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {!canDecide ? (
          <span className="text-muted" style={{ fontSize: 12 }}>
            Read-only — {stateLabel(task.state)}
          </span>
        ) : null}
        <button
          className="btn primary"
          data-testid="review-accept-all"
          disabled={!canDecide}
          onClick={() => void store.acceptTask()}
        >
          Accept all changes
        </button>
        <button className="btn" data-testid="review-close" onClick={() => store.closeReview()}>
          Close
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 16px 24px 16px' }}>
        {store.loadingChangeSet ? (
          <div className="text-muted" style={{ padding: 16 }}>
            Computing change set…
          </div>
        ) : !cs || cs.files.length === 0 ? (
          <div className="empty-state" data-testid="review-empty">
            <div className="es-title">No file changes</div>
            <div>This task has no remaining net changes to review.</div>
          </div>
        ) : (
          cs.files.map((file) => <FileSection key={file.path} file={file} />)
        )}
      </div>
      {/* Danger zone (ADR-0008 §3): rollback never sits beside Accept. */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <ConfirmDangerButton
          label="Roll back everything…"
          confirmLabel="Confirm — restore all files"
          testid="review-rollback"
          quiet
          disabled={!canDecide}
          title="Restore every touched file to its pre-task state"
          onConfirm={() => void store.rollbackTask()}
        />
        <span className="text-muted" style={{ fontSize: 11 }}>
          Restores every touched file to its pre-task state. Asks once more before running.
        </span>
      </div>
    </div>
  );
}
