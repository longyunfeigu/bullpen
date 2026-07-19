import React, { useEffect, useState } from 'react';
import type {
  ExternalMemoryFileDto,
  MemoryCandidateDto,
  MemoryOverviewDto,
  MemoryRuleDto,
  MemorySyncStateDto,
  MemorySyncTarget,
} from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useMemoryStore } from '../store/memoryStore.js';
import '../styles/memory.css';

/**
 * Memory (ADR-0028) — the rail's fifth destination, two layers in one place:
 * shared project rules (captured from review corrections, distributed to every
 * agent) and each CLI's private memory files (managed, never merged).
 */
type MemorySection = 'rules' | 'sync' | 'claude' | 'codex' | 'charter';

function when(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/** Two-step destructive button (repo confirm convention). */
function ConfirmButton(props: {
  label: string;
  confirmLabel: string;
  testid?: string;
  onConfirm: () => void;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`mv-btn danger ${armed ? 'confirming' : ''}`}
      data-testid={props.testid}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        props.onConfirm();
      }}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  );
}

function CandidateCard(props: { candidate: MemoryCandidateDto }): React.JSX.Element {
  const store = useMemoryStore();
  const { candidate } = props;
  const [text, setText] = useState(candidate.text);
  const isHit = candidate.matchedRuleId !== null;
  return (
    <div className={`mv-candidate ${isHit ? 'hit' : ''}`} data-testid="memory-candidate">
      <div className="mv-candidate-origin">
        <span>{candidate.origin.label ?? 'Captured correction'}</span>
        {candidate.similarCount > 1 ? (
          <span className="sim">×{candidate.similarCount} similar corrections</span>
        ) : null}
        {isHit ? <span>matches an existing rule — it slipped again</span> : null}
        <span>{when(candidate.createdAt)}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        data-testid="memory-candidate-text"
      />
      <div className="mv-row-actions">
        <button
          className="mv-btn primary"
          data-testid="memory-candidate-approve"
          onClick={() =>
            void store.resolveCandidate({
              candidateId: candidate.id,
              action: 'approve',
              editedText: text,
            })
          }
        >
          Distill into a rule
        </button>
        <button
          className="mv-btn quiet"
          data-testid="memory-candidate-dismiss"
          onClick={() =>
            void store.resolveCandidate({ candidateId: candidate.id, action: 'dismiss' })
          }
        >
          {isHit ? 'Got it' : 'Not a rule'}
        </button>
      </div>
    </div>
  );
}

function RuleRow(props: { rule: MemoryRuleDto }): React.JSX.Element {
  const store = useMemoryStore();
  const { rule } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  return (
    <div className={`mv-rule ${rule.enabled ? '' : 'off'}`} data-testid="memory-rule-row">
      <div className="mv-rule-body">
        {editing ? (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
            <div className="mv-row-actions" style={{ marginTop: 6 }}>
              <button
                className="mv-btn primary"
                onClick={() => {
                  void store.updateRule(rule.id, { text });
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button
                className="mv-btn quiet"
                onClick={() => {
                  setText(rule.text);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mv-rule-text">{rule.text}</div>
            <div className="mv-rule-meta">
              {rule.sourceLabel ? <span className="src">{rule.sourceLabel}</span> : null}
              {rule.injectedTasks > 0 ? (
                <span className="use">injected into {rule.injectedTasks} tasks</span>
              ) : (
                <span>not injected yet</span>
              )}
              {rule.hitCount > 0 ? (
                <span className="hit">slipped again ×{rule.hitCount}</span>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="mv-row-actions">
        {!editing ? (
          <button className="mv-btn quiet" onClick={() => setEditing(true)} aria-label="Edit rule">
            Edit
          </button>
        ) : null}
        <ConfirmButton
          label="Remove"
          confirmLabel="Really remove?"
          onConfirm={() => void store.removeRule(rule.id)}
        />
        <div
          className={`mv-toggle ${rule.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`Rule enabled: ${rule.enabled}`}
          tabIndex={0}
          data-testid="memory-rule-toggle"
          onClick={() => void store.updateRule(rule.id, { enabled: !rule.enabled })}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              void store.updateRule(rule.id, { enabled: !rule.enabled });
            }
          }}
        />
      </div>
    </div>
  );
}

function RulesSection(props: { overview: MemoryOverviewDto }): React.JSX.Element {
  const store = useMemoryStore();
  const { overview } = props;
  const [draft, setDraft] = useState('');
  const groups = overview.groups.length > 0 ? overview.groups : [];
  return (
    <>
      <div className="mv-stats" data-testid="memory-stats">
        <span>
          <b>{overview.stats.enabled}</b>enabled rules
        </span>
        <span>
          <b>{overview.stats.injectedTasks7d}</b>tasks injected · 7d
        </span>
        <span>
          <b>{overview.stats.hitsTotal}</b>slipped-again hits
        </span>
        <span>
          <b>{overview.stats.candidates}</b>candidates
        </span>
      </div>

      {overview.candidates.length > 0 ? (
        <div className="mv-card" data-testid="memory-candidates">
          <div className="mv-card-title">Candidates — captured from your corrections</div>
          <div style={{ display: 'grid', gap: 9 }}>
            {overview.candidates.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        </div>
      ) : null}

      {overview.rules.length === 0 ? (
        <div className="mv-empty" data-testid="memory-rules-empty">
          No rules yet. Reject a hunk or send a request-fix note during review and Charter will
          offer to distill it — or add one below. Rules live in <code>.charter/rules.md</code> and
          ride every managed run.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group}>
            <div className="mv-group-head">{group}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {overview.rules
                .filter((rule) => rule.group === group)
                .map((rule) => (
                  <RuleRow key={rule.id} rule={rule} />
                ))}
            </div>
          </div>
        ))
      )}

      <div className="mv-add-rule">
        <textarea
          placeholder="New rule, e.g. “Named exports only; never default export.”"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="memory-add-rule-input"
        />
        <button
          className="mv-btn primary"
          data-testid="memory-add-rule"
          disabled={draft.trim().length === 0}
          onClick={() => {
            void store.addRule(draft.trim()).then((ok) => {
              if (ok) setDraft('');
            });
          }}
        >
          Add rule
        </button>
      </div>
      <div className="mv-hint">
        Stored in <code>{overview.rulesFilePath}</code> — hand edits are safe and git-shareable;
        provenance and counters stay on this machine.{' '}
        <button
          className="mv-btn quiet"
          style={{ marginLeft: 6 }}
          onClick={() => void rpcResult('app.revealPath', { path: overview.rulesFilePath })}
        >
          Reveal in Finder
        </button>
      </div>
    </>
  );
}

const SYNC_LABEL: Record<MemorySyncTarget, { name: string; how: string }> = {
  'claude-md': {
    name: 'Claude Code · CLAUDE.md',
    how: 'Managed block holds one import line (@.charter/rules.md) — your prose stays untouched.',
  },
  'agents-md': {
    name: 'Codex · AGENTS.md',
    how: 'AGENTS.md has no import semantics — the managed block carries the rendered rule list.',
  },
};

function SyncCard(props: { sync: MemorySyncStateDto }): React.JSX.Element {
  const store = useMemoryStore();
  const { sync } = props;
  const meta = SYNC_LABEL[sync.target];
  return (
    <div className="mv-card" data-testid={`memory-sync-${sync.target}`}>
      <div className="mv-sync-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{meta.name}</div>
          <div className="path">{sync.filePath}</div>
        </div>
        <span
          className={`mv-status ${sync.status}`}
          data-testid={`memory-sync-status-${sync.target}`}
        >
          {sync.status === 'ok'
            ? `✓ synced ${sync.lastSyncedAt ? when(sync.lastSyncedAt) : ''}`
            : sync.status === 'drift'
              ? '⚠ hand-edited'
              : sync.status}
        </span>
        <div
          className={`mv-toggle ${sync.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={sync.enabled}
          aria-label={`Sync ${meta.name}`}
          tabIndex={0}
          data-testid={`memory-sync-toggle-${sync.target}`}
          onClick={() => void store.setSyncEnabled(sync.target, !sync.enabled)}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              void store.setSyncEnabled(sync.target, !sync.enabled);
            }
          }}
        />
      </div>
      <div className="mv-sync-detail">{meta.how}</div>
      {sync.detail ? <div className="mv-sync-detail">{sync.detail}</div> : null}
      {sync.status === 'drift' ? (
        <div className="mv-drift-actions" data-testid={`memory-drift-${sync.target}`}>
          <button
            className="mv-btn primary"
            data-testid={`memory-drift-import-${sync.target}`}
            onClick={() => void store.resolveDrift(sync.target, 'import')}
          >
            Import hand edits as candidates
          </button>
          <button
            className="mv-btn"
            onClick={() => void store.resolveDrift(sync.target, 'overwrite')}
          >
            Overwrite from rules source
          </button>
          <button
            className="mv-btn quiet"
            onClick={() => void store.resolveDrift(sync.target, 'stop')}
          >
            Stop managing this file
          </button>
        </div>
      ) : sync.enabled ? (
        <div className="mv-drift-actions">
          <button className="mv-btn quiet" onClick={() => void store.applySync(sync.target)}>
            Sync now
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ReverseImportCard(): React.JSX.Element {
  const store = useMemoryStore();
  const [items, setItems] = useState<{ text: string; source: 'claude-md' | 'agents-md' }[] | null>(
    null,
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  return (
    <div className="mv-card" data-testid="memory-import">
      <div className="mv-card-title">Reverse import — existing conventions</div>
      <div className="mv-hint" style={{ marginBottom: 8 }}>
        Scan hand-written CLAUDE.md / AGENTS.md (outside the managed block) for bullet conventions
        and bring them in as candidates — so there is never a fourth memory to maintain.
      </div>
      {items === null ? (
        <button
          className="mv-btn"
          data-testid="memory-import-scan"
          onClick={() =>
            void store.scanImport().then((found) => {
              setItems(found);
              setPicked(new Set(found.map((_, index) => index)));
            })
          }
        >
          Scan for conventions
        </button>
      ) : items.length === 0 ? (
        <div className="mv-hint">
          Nothing new found — existing rules and candidates already cover it.
        </div>
      ) : (
        <>
          {items.map((item, index) => (
            <label className="mv-import-item" key={`${item.source}-${index}`}>
              <input
                type="checkbox"
                checked={picked.has(index)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(index);
                  else next.delete(index);
                  setPicked(next);
                }}
              />
              <span className="from">
                {item.source === 'claude-md' ? 'CLAUDE.md' : 'AGENTS.md'}
              </span>
              <span>{item.text}</span>
            </label>
          ))}
          <div className="mv-row-actions" style={{ marginTop: 8 }}>
            <button
              className="mv-btn primary"
              data-testid="memory-import-apply"
              disabled={picked.size === 0}
              onClick={() => {
                const selected = items.filter((_, index) => picked.has(index));
                void store.applyImport(selected).then(() => setItems(null));
              }}
            >
              Import {picked.size} as candidates
            </button>
            <button className="mv-btn quiet" onClick={() => setItems(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SyncSection(props: { overview: MemoryOverviewDto }): React.JSX.Element {
  return (
    <>
      <div className="mv-card">
        <div className="mv-sync-head">
          <div style={{ flex: 1 }}>
            <div className="name">Charter · managed runs</div>
          </div>
          <span className="mv-status ok">always on</span>
        </div>
        <div className="mv-sync-detail">
          Enabled rules ride every managed run as a preamble block and refresh on every reply — no
          project file involved. Rule changes reach the very next turn.
        </div>
      </div>
      {props.overview.sync.map((sync) => (
        <SyncCard key={sync.target} sync={sync} />
      ))}
      <ReverseImportCard />
      <div className="mv-hint">
        Writes are atomic and visible in git diff. A hand-edited managed block is never overwritten
        silently — you choose import / overwrite / stop.
      </div>
    </>
  );
}

function FileRow(props: { file: ExternalMemoryFileDto }): React.JSX.Element {
  const store = useMemoryStore();
  const { file } = props;
  const [mode, setMode] = useState<'closed' | 'view' | 'edit'>('closed');
  const [content, setContent] = useState('');
  const [mtime, setMtime] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);

  const open = async (nextMode: 'view' | 'edit'): Promise<void> => {
    const data = await store.readExternal(file.id);
    if (!data) return;
    setContent(data.content);
    setMtime(data.mtimeMs);
    setTruncated(data.truncated);
    setMode(nextMode);
  };

  return (
    <div className="mv-file" data-testid="memory-external-file">
      <div className="mv-file-head">
        <span className="label">{file.label}</span>
        <span className="scope">{file.scope === 'global' ? 'global' : 'this project'}</span>
        {file.role === 'memory-index' ? <span className="scope">index</span> : null}
        <span className="when">{when(file.updatedAt)}</span>
      </div>
      <div className="mv-file-summary">{file.summary}</div>
      <div className="mv-file-path">{file.path}</div>
      <div className="mv-file-actions">
        {file.readable ? (
          <>
            <button className="mv-btn quiet" onClick={() => void open('view')}>
              View
            </button>
            <button
              className="mv-btn quiet"
              data-testid="memory-external-edit"
              onClick={() => void open('edit')}
            >
              Edit
            </button>
          </>
        ) : (
          <span className="mv-hint">too large or binary — view disabled</span>
        )}
        {file.role === 'memory' && file.readable ? (
          <button
            className="mv-btn"
            data-testid="memory-external-promote"
            onClick={() => void store.promoteExternal(file.id)}
          >
            ↑ Promote to shared rule
          </button>
        ) : null}
        <ConfirmButton
          label="Delete"
          confirmLabel="Backup & delete?"
          testid="memory-external-delete"
          onConfirm={() => void store.deleteExternal(file.id)}
        />
      </div>
      {mode === 'view' ? (
        <div className="mv-viewer" data-testid="memory-external-viewer">
          {truncated ? '…(truncated view)\n' : ''}
          {content}
        </div>
      ) : null}
      {mode === 'edit' ? (
        <div className="mv-editor">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            data-testid="memory-external-editor"
          />
          <div className="foot">
            <button
              className="mv-btn primary"
              data-testid="memory-external-save"
              onClick={() =>
                void store.writeExternal(file.id, content, mtime).then((ok) => {
                  if (ok) setMode('closed');
                })
              }
            >
              Save
            </button>
            <button className="mv-btn quiet" onClick={() => setMode('closed')}>
              Cancel
            </button>
            {truncated ? (
              <span className="mv-hint">truncated — saving would lose the tail; view only</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {mode === 'view' ? (
        <div className="mv-file-actions">
          <button className="mv-btn quiet" onClick={() => setMode('closed')}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ExternalSection(props: {
  agent: 'claude' | 'codex';
  files: ExternalMemoryFileDto[];
  overview: MemoryOverviewDto;
}): React.JSX.Element {
  const projectSync = props.overview.sync.find(
    (sync) => sync.target === (props.agent === 'claude' ? 'claude-md' : 'agents-md'),
  );
  return (
    <>
      <div className="mv-hint">
        Discovered read-only from {props.agent === 'claude' ? '~/.claude' : '~/.codex'} path
        conventions. Charter writes only on your explicit action, backs up before delete, and never
        touches session transcripts. Promote copies a note into shared-rule candidates — one-way.
      </div>
      {props.files.length === 0 ? (
        <div className="mv-empty" data-testid={`memory-${props.agent}-empty`}>
          {props.agent === 'codex'
            ? 'This Codex version keeps no auto-memory directory — only AGENTS.md files were looked for, and none exist yet. If a future version adds a memory store, it will appear here under the same read-only rules.'
            : 'No Claude Code memory found for this machine/project yet. Files appear here as soon as Claude Code writes them.'}
        </div>
      ) : (
        props.files.map((file) => <FileRow key={file.id} file={file} />)
      )}
      {projectSync ? (
        <div className="mv-card">
          <div className="mv-card-title">
            Project-level {props.agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}
          </div>
          <div className="mv-sync-detail">
            {projectSync.filePath} —{' '}
            {projectSync.enabled
              ? `managed block ${projectSync.status === 'ok' ? 'in sync with the rules source' : projectSync.status}`
              : 'not managed (enable under Sync & distribution)'}
          </div>
        </div>
      ) : null}
    </>
  );
}

function CharterSection(props: { overview: MemoryOverviewDto | null }): React.JSX.Element {
  return (
    <>
      <div className="mv-card">
        <div className="mv-sync-detail" style={{ fontSize: 13 }}>
          <b>Charter has no hidden private memory.</b> Its long-term memory is the shared project
          rules (injected into every managed run); its working memory is the task ledger — timeline,
          evidence and replay — which the product already keeps. ⌘K search covers rules, private
          memory files and the ledger.
        </div>
      </div>
      {props.overview ? (
        <div className="mv-hint">
          Rules source: <code>{props.overview.rulesFilePath}</code>
          {props.overview.rulesFileExists ? '' : ' (created on first rule)'}
        </div>
      ) : null}
    </>
  );
}

export function MemoryView(): React.JSX.Element {
  const store = useMemoryStore();
  const [section, setSection] = useState<MemorySection>('rules');
  useEffect(() => {
    store.init();
    void store.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overview = store.overview;
  const claudeFiles = store.external.filter((file) => file.agent === 'claude');
  const codexFiles = store.external.filter((file) => file.agent === 'codex');
  const candidateCount = overview?.candidates.length ?? 0;

  const navItem = (
    id: MemorySection,
    label: string,
    extra?: React.ReactNode,
  ): React.JSX.Element => (
    <button
      className={`mv-nav-item ${section === id ? 'active' : ''}`}
      data-testid={`memory-nav-${id}`}
      onClick={() => setSection(id)}
    >
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <div className="mv-root" data-testid="memory-view">
      <nav className="mv-nav" aria-label="Memory sections">
        <div className="mv-nav-group">Shared — Charter distributes</div>
        {navItem(
          'rules',
          'Project rules',
          candidateCount > 0 ? (
            <span className="mv-nav-badge" data-testid="memory-nav-candidates">
              {candidateCount}
            </span>
          ) : (
            <span className="mv-nav-count">{overview?.rules.length ?? 0}</span>
          ),
        )}
        {navItem('sync', 'Sync & distribution')}
        <div className="mv-nav-group">Private — managed, never merged</div>
        {navItem(
          'claude',
          'Claude Code',
          <span className="mv-nav-count">{claudeFiles.length}</span>,
        )}
        {navItem('codex', 'Codex', <span className="mv-nav-count">{codexFiles.length}</span>)}
        {navItem('charter', 'Charter ledger')}
      </nav>
      <main className="mv-main">
        <div className="mv-main-inner">
          {!overview || !overview.available ? (
            section === 'claude' || section === 'codex' ? (
              <ExternalSectionNoProject
                agent={section}
                files={section === 'claude' ? claudeFiles : codexFiles}
              />
            ) : (
              <div className="mv-empty" data-testid="memory-no-project">
                Open a project first — rules and memories are per-project. Global CLI files are
                still browsable under Claude Code / Codex.
              </div>
            )
          ) : section === 'rules' ? (
            <RulesSection overview={overview} />
          ) : section === 'sync' ? (
            <SyncSection overview={overview} />
          ) : section === 'claude' ? (
            <ExternalSection agent="claude" files={claudeFiles} overview={overview} />
          ) : section === 'codex' ? (
            <ExternalSection agent="codex" files={codexFiles} overview={overview} />
          ) : (
            <CharterSection overview={overview} />
          )}
        </div>
      </main>
    </div>
  );
}

/** Global CLI files remain reachable without an open project. */
function ExternalSectionNoProject(props: {
  agent: 'claude' | 'codex';
  files: ExternalMemoryFileDto[];
}): React.JSX.Element {
  return (
    <>
      <div className="mv-hint">No project selected — showing global files only.</div>
      {props.files
        .filter((file) => file.scope === 'global')
        .map((file) => (
          <FileRow key={file.id} file={file} />
        ))}
    </>
  );
}
