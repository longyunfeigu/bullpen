import React, { useEffect, useState } from 'react';
import type {
  ExternalMemoryFileDto,
  MemoryCandidateDto,
  MemoryCharterProject,
  MemoryClaudeProjectGroup,
  MemoryOverviewDto,
  MemoryRuleDto,
  MemorySyncStateDto,
} from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useMemoryStore } from '../store/memoryStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import '../styles/memory.css';

/**
 * Memory (ADR-0028, IA v3 — user-directed): agents are the top level.
 * Claude Code / Codex / Charter each open into their GLOBAL memory first,
 * then a per-project second level. Claude lists EVERY project it has
 * auto-memory for (matched Charter projects by name, foreign dirs verbatim);
 * Charter's "memory" is each project's distilled rules + distribution.
 */
type MemoryAgent = 'claude' | 'codex' | 'charter';

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

/** One external memory file row. `promoteTo` = matched Charter project path. */
function FileRow(props: {
  file: ExternalMemoryFileDto;
  promoteTo: string | null;
}): React.JSX.Element {
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
        <span className="scope">{file.scope === 'global' ? 'global' : 'project'}</span>
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
        {file.role === 'memory' && file.readable && props.promoteTo ? (
          <button
            className="mv-btn"
            data-testid="memory-external-promote"
            onClick={() => void store.promoteExternal(props.promoteTo!, file.id)}
          >
            ↑ Promote to Charter rule
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
        <>
          <div className="mv-viewer" data-testid="memory-external-viewer">
            {truncated ? '…(truncated view)\n' : ''}
            {content}
          </div>
          <div className="mv-file-actions">
            <button className="mv-btn quiet" onClick={() => setMode('closed')}>
              Close
            </button>
          </div>
        </>
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
    </div>
  );
}

/** Collapsible project group (level 2). */
function ProjGroup(props: {
  title: string;
  path: string | null;
  meta: React.ReactNode;
  current: boolean;
  open: boolean;
  onToggle: () => void;
  rawName: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`mv-proj ${props.open ? 'open' : ''}`} data-testid="memory-proj-group">
      <button className="mv-proj-head" data-testid="memory-proj-head" onClick={props.onToggle}>
        <span className="tri">▶</span>
        <span className={`name ${props.rawName ? 'raw' : ''}`}>{props.title}</span>
        {props.path ? <span className="path">{props.path}</span> : null}
        {props.current ? <span className="cur">current</span> : null}
        {props.meta}
      </button>
      {props.open ? <div className="mv-proj-body">{props.children}</div> : null}
    </div>
  );
}

// ───────────────────────── Claude Code ─────────────────────────

function ClaudeView(props: {
  global: ExternalMemoryFileDto[];
  projects: MemoryClaudeProjectGroup[];
  currentPath: string | null;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const current = props.projects.find((group) => group.projectPath === props.currentPath);
    return new Set(current ? [current.key] : []);
  });
  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <>
      <div className="mv-sec">Global — applies to every project</div>
      {props.global.length === 0 ? (
        <div className="mv-empty">No global CLAUDE.md found (~/.claude/CLAUDE.md).</div>
      ) : (
        props.global.map((file) => <FileRow key={file.id} file={file} promoteTo={null} />)
      )}
      <div className="mv-sec">Projects — auto-memory per project</div>
      {props.projects.length === 0 ? (
        <div className="mv-empty" data-testid="memory-claude-empty">
          Claude Code has no per-project auto-memory on this machine yet. Groups appear here as soon
          as it writes them (~/.claude/projects/&lt;project&gt;/memory).
        </div>
      ) : (
        props.projects.map((group) => (
          <ProjGroup
            key={group.key}
            title={group.displayName}
            path={group.projectPath}
            rawName={group.projectPath === null}
            current={group.projectPath !== null && group.projectPath === props.currentPath}
            open={expanded.has(group.key)}
            onToggle={() => toggle(group.key)}
            meta={<span className="n">{group.files.length} memories</span>}
          >
            {group.projectPath === null ? (
              <div className="mv-hint">
                Claude knows this directory but it was never opened in Charter — browse and delete
                only (there is no Charter project to promote into).
              </div>
            ) : null}
            {group.files.map((file) => (
              <FileRow key={file.id} file={file} promoteTo={group.projectPath} />
            ))}
          </ProjGroup>
        ))
      )}
      <div className="mv-hint">
        Read-only discovery over ~/.claude path conventions. Edits and deletes are explicit actions;
        deletes back up first; Promote copies a note into that project's Charter rules (one-way).
        Session transcripts are not memory and are not listed.
      </div>
    </>
  );
}

// ───────────────────────── Codex ─────────────────────────

function CodexView(props: { global: ExternalMemoryFileDto[] }): React.JSX.Element {
  return (
    <>
      <div className="mv-sec">Global — applies to every project</div>
      {props.global.length === 0 ? (
        <div className="mv-empty">No global AGENTS.md found (~/.codex/AGENTS.md).</div>
      ) : (
        props.global.map((file) => <FileRow key={file.id} file={file} promoteTo={null} />)
      )}
      <div className="mv-sec">Projects</div>
      <div className="mv-empty" data-testid="memory-codex-empty">
        This Codex version keeps no per-project auto-memory — only the global AGENTS.md above.
        Project-level AGENTS.md files are project files, managed under each project's Charter →
        Distribution. If a future Codex adds a memory store, it appears here under the same
        read-only rules.
      </div>
    </>
  );
}

// ───────────────────────── Charter ─────────────────────────

function CandidateCard(props: {
  candidate: MemoryCandidateDto;
  projectPath: string;
}): React.JSX.Element {
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
              projectPath: props.projectPath,
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
            void store.resolveCandidate({
              projectPath: props.projectPath,
              candidateId: candidate.id,
              action: 'dismiss',
            })
          }
        >
          {isHit ? 'Got it' : 'Not a rule'}
        </button>
      </div>
    </div>
  );
}

function RuleRow(props: { rule: MemoryRuleDto; projectPath: string }): React.JSX.Element {
  const store = useMemoryStore();
  const { rule, projectPath } = props;
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
                  void store.updateRule(projectPath, rule.id, { text });
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
          onConfirm={() => void store.removeRule(projectPath, rule.id)}
        />
        <div
          className={`mv-toggle ${rule.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`Rule enabled: ${rule.enabled}`}
          tabIndex={0}
          data-testid="memory-rule-toggle"
          onClick={() => void store.updateRule(projectPath, rule.id, { enabled: !rule.enabled })}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              void store.updateRule(projectPath, rule.id, { enabled: !rule.enabled });
            }
          }}
        />
      </div>
    </div>
  );
}

const SYNC_LINE_LABEL: Record<MemorySyncStateDto['target'], string> = {
  'claude-md': 'CLAUDE.md',
  'agents-md': 'AGENTS.md',
};

function SyncLine(props: { sync: MemorySyncStateDto; projectPath: string }): React.JSX.Element {
  const store = useMemoryStore();
  const { sync, projectPath } = props;
  return (
    <div className="mv-syncline-wrap" data-testid={`memory-sync-${sync.target}`}>
      <div className="mv-syncline">
        <span className="lab">{SYNC_LINE_LABEL[sync.target]}</span>
        <span
          className={`mv-status ${sync.status}`}
          data-testid={`memory-sync-status-${sync.target}`}
        >
          {sync.status === 'ok'
            ? '✓ synced'
            : sync.status === 'drift'
              ? '⚠ hand-edited'
              : sync.status}
        </span>
        <span className="path">{sync.filePath}</span>
        {sync.enabled && sync.status !== 'drift' ? (
          <button
            className="mv-btn quiet"
            onClick={() => void store.applySync(projectPath, sync.target)}
          >
            Sync now
          </button>
        ) : null}
        <div
          className={`mv-toggle ${sync.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={sync.enabled}
          aria-label={`Sync ${SYNC_LINE_LABEL[sync.target]}`}
          tabIndex={0}
          data-testid={`memory-sync-toggle-${sync.target}`}
          onClick={() => void store.setSyncEnabled(projectPath, sync.target, !sync.enabled)}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              void store.setSyncEnabled(projectPath, sync.target, !sync.enabled);
            }
          }}
        />
      </div>
      {sync.detail ? (
        <div className="mv-hint" style={{ padding: '2px 0 4px' }}>
          {sync.detail}
        </div>
      ) : null}
      {sync.status === 'drift' ? (
        <div className="mv-drift-actions" data-testid={`memory-drift-${sync.target}`}>
          <button
            className="mv-btn primary"
            data-testid={`memory-drift-import-${sync.target}`}
            onClick={() => void store.resolveDrift(projectPath, sync.target, 'import')}
          >
            Import hand edits as candidates
          </button>
          <button
            className="mv-btn"
            onClick={() => void store.resolveDrift(projectPath, sync.target, 'overwrite')}
          >
            Overwrite from rules source
          </button>
          <button
            className="mv-btn quiet"
            onClick={() => void store.resolveDrift(projectPath, sync.target, 'stop')}
          >
            Stop managing
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CharterProjectBody(props: { projectPath: string }): React.JSX.Element {
  const store = useMemoryStore();
  const overview = store.projectOverviews[props.projectPath];
  const [draft, setDraft] = useState('');
  useEffect(() => {
    void store.refreshProject(props.projectPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectPath]);

  if (!overview) return <div className="mv-hint">Loading…</div>;
  if (!overview.available) {
    return (
      <div className="mv-hint">
        This folder is not an opened project anymore — open it under Projects to manage rules.
      </div>
    );
  }
  return (
    <>
      <div className="mv-stats" data-testid="memory-stats">
        <span>
          <b>{overview.stats.enabled}</b>enabled
        </span>
        <span>
          <b>{overview.stats.injectedTasks7d}</b>tasks injected · 7d
        </span>
        <span>
          <b>{overview.stats.hitsTotal}</b>slipped again
        </span>
        <span>
          <b>{overview.stats.candidates}</b>candidates
        </span>
      </div>
      {overview.candidates.map((candidate) => (
        <CandidateCard key={candidate.id} candidate={candidate} projectPath={props.projectPath} />
      ))}
      {overview.rules.length === 0 ? (
        <div className="mv-empty" data-testid="memory-rules-empty">
          No rules yet. Reject a hunk or send a request-fix note during review and Charter offers to
          distill it — or add one below.
        </div>
      ) : (
        overview.groups.map((group) => (
          <div key={group} style={{ display: 'grid', gap: 8 }}>
            {overview.groups.length > 1 ? <div className="mv-group-head">{group}</div> : null}
            {overview.rules
              .filter((rule) => rule.group === group)
              .map((rule) => (
                <RuleRow key={rule.id} rule={rule} projectPath={props.projectPath} />
              ))}
          </div>
        ))
      )}
      <div className="mv-sec" style={{ paddingTop: 2 }}>
        Distribution
      </div>
      <div className="mv-syncline-wrap">
        <div className="mv-syncline">
          <span className="lab">Charter runs</span>
          <span className="mv-status ok">always on</span>
          <span className="mv-hint">preamble + every run &amp; reply</span>
        </div>
      </div>
      {overview.sync.map((sync) => (
        <SyncLine key={sync.target} sync={sync} projectPath={props.projectPath} />
      ))}
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
            void store.addRule(props.projectPath, draft.trim()).then((ok) => {
              if (ok) setDraft('');
            });
          }}
        >
          Add rule
        </button>
      </div>
      <div className="mv-hint">
        Stored in <code>{overview.rulesFilePath}</code> — hand edits safe, git-shareable.{' '}
        <button
          className="mv-btn quiet"
          onClick={() => void rpcResult('app.revealPath', { path: overview.rulesFilePath })}
        >
          Reveal in Finder
        </button>
      </div>
    </>
  );
}

function CharterView(props: {
  projects: MemoryCharterProject[];
  currentPath: string | null;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const current = props.projects.find((project) => project.projectPath === props.currentPath);
    return new Set(current ? [current.projectPath] : []);
  });
  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return (
    <>
      <div className="mv-sec">Global</div>
      <div className="mv-empty">
        Charter has no global rules by design — every rule belongs to a project (stored in that
        project's <code>.charter/rules.md</code>, git-shareable). Its working memory is the task
        ledger, already in the product.
      </div>
      <div className="mv-sec">Projects — rules distilled from your reviews</div>
      {props.projects.length === 0 ? (
        <div className="mv-empty">No projects opened yet.</div>
      ) : (
        props.projects.map((project) => (
          <ProjGroup
            key={project.projectPath}
            title={project.displayName}
            path={project.projectPath}
            rawName={false}
            current={project.projectPath === props.currentPath}
            open={expanded.has(project.projectPath)}
            onToggle={() => toggle(project.projectPath)}
            meta={
              <>
                {project.candidateCount > 0 ? (
                  <span className="badge" data-testid="memory-proj-candidates">
                    {project.candidateCount}
                  </span>
                ) : null}
                <span className="n">{project.ruleCount} rules</span>
              </>
            }
          >
            <CharterProjectBody projectPath={project.projectPath} />
          </ProjGroup>
        ))
      )}
    </>
  );
}

// ───────────────────────── shell ─────────────────────────

export function MemoryView(): React.JSX.Element {
  const store = useMemoryStore();
  const currentPath = useWorkspaceStore((s) => s.workspace?.path ?? null);
  const [agent, setAgent] = useState<MemoryAgent>('claude');
  useEffect(() => {
    store.init();
    void store.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = store.tree;
  const claudeCount = tree
    ? tree.claude.global.length +
      tree.claude.projects.reduce((sum, group) => sum + group.files.length, 0)
    : 0;
  const codexCount = tree?.codex.global.length ?? 0;
  const charterCandidates = tree
    ? tree.charter.projects.reduce((sum, project) => sum + project.candidateCount, 0)
    : 0;

  const navItem = (
    id: MemoryAgent,
    logo: string,
    label: string,
    extra: React.ReactNode,
  ): React.JSX.Element => (
    <button
      className={`mv-nav-item ${agent === id ? 'active' : ''}`}
      data-testid={`memory-nav-${id}`}
      onClick={() => setAgent(id)}
    >
      <span className="mv-agent-logo">{logo}</span>
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <div className="mv-root" data-testid="memory-view">
      <nav className="mv-nav" aria-label="Memory agents">
        <div className="mv-nav-group">Agents</div>
        {navItem('claude', '✳', 'Claude Code', <span className="mv-nav-count">{claudeCount}</span>)}
        {navItem('codex', '▣', 'Codex', <span className="mv-nav-count">{codexCount}</span>)}
        {navItem(
          'charter',
          '◆',
          'Charter',
          charterCandidates > 0 ? (
            <span className="mv-nav-badge" data-testid="memory-nav-candidates">
              {charterCandidates}
            </span>
          ) : (
            <span className="mv-nav-count">
              {tree?.charter.projects.reduce((sum, project) => sum + project.ruleCount, 0) ?? 0}
            </span>
          ),
        )}
      </nav>
      <main className="mv-main">
        <div className="mv-main-inner">
          {!tree ? (
            <div className="mv-hint">Loading…</div>
          ) : agent === 'claude' ? (
            <ClaudeView
              global={tree.claude.global}
              projects={tree.claude.projects}
              currentPath={currentPath}
            />
          ) : agent === 'codex' ? (
            <CodexView global={tree.codex.global} />
          ) : (
            <CharterView projects={tree.charter.projects} currentPath={currentPath} />
          )}
        </div>
      </main>
    </div>
  );
}
