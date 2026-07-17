import React, { useEffect, useMemo, useState } from 'react';
import type { RecentWorkspaceDto, TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useActivityStore, currentActionLine } from '../store/activityStore.js';
import { useAppStore } from '../store/appStore.js';
import { useExternalStore } from '../store/externalStore.js';
import { RUNNING_TASK_STATES, useTaskStore } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { useTerminalStore } from './TerminalPanel.js';
import { HomeProjectTree } from './HomeProjectTree.js';
import { Ic, ProviderMark } from './home-icons.js';
import { canArchiveTask, isAnswered, presentedMeta } from './labels.js';
import { ArmedIconButton } from './ui.js';
import { needsAttention } from './HomeSidebar.js';
import { useGlowTasks } from './useGlow.js';

type SessionEntry =
  | { key: string; kind: 'task'; task: TaskDto }
  | {
      key: string;
      kind: 'terminal';
      terminalId: string;
      launch: 'claude' | 'codex';
      projectName: string;
    };

/** The rail's three contextual views inside the single navigation surface. */
type RailView = 'sessions' | 'inbox' | 'projects';

interface RailGroup {
  key: string;
  name: string;
  path: string | null;
  entries: SessionEntry[];
  needs: number;
  history?: boolean;
}

/**
 * ADR-0023: settled sessions leave their project group for the collapsed
 * History group. Attention states (FAILED/INTERRUPTED, review) stay in their
 * project group — History never hides something that still wants a decision.
 */
const SETTLED_STATES = new Set(['ACCEPTED', 'ROLLED_BACK', 'CANCELLED']);

const COLLAPSED_KEY = 'charter.rail.collapsed.v1';

function loadCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (raw) {
      return new Set(
        (JSON.parse(raw) as unknown[]).filter((v): v is string => typeof v === 'string'),
      );
    }
  } catch {
    // fall through to the default below
  }
  return new Set(['history']);
}

function saveCollapsed(collapsed: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // best-effort UI state
  }
}

function providerForTask(task: TaskDto): 'pi' | 'claude' | 'codex' {
  if (task.external?.cli === 'claude') return 'claude';
  if (task.external?.cli === 'codex') return 'codex';
  return 'pi';
}

function providerLabel(provider: 'pi' | 'claude' | 'codex'): string {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  return 'Pi';
}

/** The brand mark carries the provider — the title stays bare (reference style). */
function sessionTitle(task: TaskDto): string {
  const withoutFixtureDirective = task.title.replace(/^\[scenario:[^\]]+\]\s*/i, '');
  const withoutRepeatedProvider = withoutFixtureDirective.replace(
    /^(?:claude(?: code)?|codex|pi)\s*[·:—-]\s*/i,
    '',
  );
  return withoutRepeatedProvider || 'Session';
}

function SessionTaskRow({
  task,
  showProject = true,
}: {
  task: TaskDto;
  /** Rows inside a project group drop the redundant project name (ADR-0023). */
  showProject?: boolean;
}): React.JSX.Element {
  const app = useAppStore();
  const taskStore = useTaskStore();
  const activity = useActivityStore((state) => state.perTask[task.id]);
  const glowTasks = useGlowTasks();
  const selected = app.taskRoomTaskId === task.id;
  const provider = providerForTask(task);
  const displayTitle = sessionTitle(task);
  const running = RUNNING_TASK_STATES.has(task.state);
  const meta = presentedMeta(task);
  const action = running ? currentActionLine(activity) : null;
  const externalSession = useExternalStore((state) => state.sessions[task.id]);
  const live = task.external ? externalSession?.status === 'active' : running;

  const open = (): void => {
    void taskStore.openTask(task.id);
    app.openTaskRoom(task.id);
  };

  return (
    <div className="sr-row-wrap">
      <button
        className={`sr-session ${selected ? 'selected' : ''} ${glowTasks.has(task.id) ? 'glow-pulse' : ''}`}
        data-testid={`home-task-${task.id}`}
        data-session-key={`task:${task.id}`}
        data-state={task.state}
        title={`${providerLabel(provider)} · ${displayTitle} — ${meta.label}`}
        onClick={open}
      >
        <ProviderMark provider={provider} />
        <span className="sr-session-copy">
          <span className="sr-session-title">
            <span className={`sr-live-dot ${live ? 'live' : ''}`} />
            <b>{displayTitle}</b>
            <span className={`sr-state ${meta.tone}`}>{live ? 'LIVE' : meta.short}</span>
          </span>
          <span className="sr-session-meta">
            {showProject ? <span className="sr-session-project">{task.projectName}</span> : null}
            <span className="sr-session-branch">
              <Ic name="branch" size={10} />
              {task.worktree?.branch ?? 'main'}
            </span>
          </span>
          <span className="sr-session-detail">
            {action ? (
              <span data-testid={`home-task-ticker-${task.id}`}>{action.label}</span>
            ) : isAnswered(task) ? (
              'Answered · no file changes'
            ) : (
              meta.label
            )}
          </span>
        </span>
      </button>
      {canArchiveTask(task) ? (
        <ArmedIconButton
          icon="archive"
          className="sr-archive"
          testid={`home-archive-${task.id}`}
          title="Archive session"
          armedTitle="Click again to archive"
          onConfirm={() => void taskStore.archiveTask(task.id)}
        />
      ) : null}
    </div>
  );
}

function TerminalSessionRow({
  terminalId,
  launch,
  showProject = true,
}: {
  terminalId: string;
  launch: 'claude' | 'codex';
  showProject?: boolean;
}): React.JSX.Element | null {
  const app = useAppStore();
  const item = useTerminalStore((state) => state.items.find((entry) => entry.id === terminalId));
  if (!item) return null;
  const selected = app.sessionTerminalId === terminalId;
  const provider = launch;
  // The brand mark carries the provider — never repeat the CLI name as the
  // title. Generic launch titles read as an unnamed session.
  const sessionName = /^(?:Claude Code|Codex)$/i.test(item.title) ? 'New session' : item.title;
  return (
    <button
      className={`sr-session ${selected ? 'selected' : ''}`}
      data-testid={`session-terminal-${terminalId}`}
      data-session-key={`terminal:${terminalId}`}
      title={`${providerLabel(provider)} · ${item.contextLabel}`}
      onClick={() => app.openTerminalSession(terminalId)}
    >
      <ProviderMark provider={provider} />
      <span className="sr-session-copy">
        <span className="sr-session-title">
          <span className={`sr-live-dot ${item.exited ? '' : 'live'}`} />
          <b>{sessionName}</b>
          <span className="sr-state run">{item.exited ? 'ENDED' : 'LIVE'}</span>
        </span>
        <span className="sr-session-meta">
          {showProject ? <span className="sr-session-project">{item.projectName}</span> : null}
          <span className="sr-session-branch">
            <Ic name="branch" size={10} /> main
          </span>
        </span>
        <span className="sr-session-detail">
          {item.exited
            ? 'Process ended · session state retained'
            : 'PTY starting · state preserved'}
        </span>
      </span>
    </button>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('input, textarea, [contenteditable="true"], .xterm-helper-textarea'),
  );
}

/**
 * The one global Session Rail. Sessions are grouped by project with a collapsed
 * History group for settled work; Needs You and Projects are contextual panel
 * states, not parallel navigation shells.
 */
export function SessionRail(): React.JSX.Element {
  const app = useAppStore();
  const workspaceStore = useWorkspaceStore();
  const taskStore = useTaskStore();
  const terminalStore = useTerminalStore();
  const taskByTerminal = useExternalStore((state) => state.taskByTerminal);
  const inbox = taskStore.tasks.filter((task) => !task.archived && needsAttention(task));
  const [recent, setRecent] = useState<RecentWorkspaceDto[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);
  const [view, setView] = useState<RailView>('sessions');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(loadCollapsed);

  useEffect(() => {
    taskStore.init();
    void taskStore.refreshTasks();
    terminalStore.init();
    useExternalStore.getState().init();
    void rpcResult('workspace.recent', {}).then((result) => {
      if (result.ok) setRecent(result.data.items);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceStore.workspace?.path]);

  const flatEntries = useMemo<SessionEntry[]>(() => {
    const taskEntries: SessionEntry[] = taskStore.tasks
      .filter((task) => !task.archived)
      .slice(0, 20)
      .map((task) => ({ key: `task:${task.id}`, kind: 'task', task }));
    const terminalEntries: SessionEntry[] = terminalStore.items
      .filter(
        (terminal) =>
          !terminal.hidden &&
          !taskByTerminal[terminal.id] &&
          (terminal.launch === 'claude' || terminal.launch === 'codex'),
      )
      .map((terminal) => ({
        key: `terminal:${terminal.id}`,
        kind: 'terminal',
        terminalId: terminal.id,
        launch: terminal.launch as 'claude' | 'codex',
        projectName: terminal.projectName,
      }));
    return [...terminalEntries.toReversed(), ...taskEntries];
  }, [taskStore.tasks, terminalStore.items, taskByTerminal]);

  const groups = useMemo<RailGroup[]>(() => {
    const active: RailGroup[] = [];
    const byName = new Map<string, RailGroup>();
    const history: RailGroup = {
      key: 'history',
      name: 'History',
      path: null,
      entries: [],
      needs: 0,
      history: true,
    };
    for (const entry of flatEntries) {
      if (entry.kind === 'task' && SETTLED_STATES.has(entry.task.state)) {
        history.entries.push(entry);
        continue;
      }
      const name = entry.kind === 'task' ? entry.task.projectName : entry.projectName;
      let group = byName.get(name);
      if (!group) {
        group = { key: `proj:${name}`, name, path: null, entries: [], needs: 0 };
        byName.set(name, group);
        active.push(group);
      }
      if (entry.kind === 'task') {
        group.path ??= entry.task.projectPath;
        if (needsAttention(entry.task)) group.needs += 1;
      }
      group.entries.push(entry);
    }
    return history.entries.length > 0 ? [...active, history] : active;
  }, [flatEntries]);

  /** Keyboard order mirrors the visual order (groups flattened, History last). */
  const orderedEntries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });
  };

  // The open room's row is never hidden: when the selection lands in (or moves
  // into) a collapsed group — e.g. accept sends a task to History — expand it.
  // Manual collapses are respected until the selection or its group changes.
  const selectedKey = app.taskRoomTaskId
    ? `task:${app.taskRoomTaskId}`
    : app.sessionTerminalId
      ? `terminal:${app.sessionTerminalId}`
      : null;
  const selectedGroupKey = selectedKey
    ? (groups.find((group) => group.entries.some((entry) => entry.key === selectedKey))?.key ??
      null)
    : null;
  useEffect(() => {
    if (!selectedGroupKey) return;
    setCollapsed((prev) => {
      if (!prev.has(selectedGroupKey)) return prev;
      const next = new Set(prev);
      next.delete(selectedGroupKey);
      saveCollapsed(next);
      return next;
    });
  }, [selectedGroupKey, selectedKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target) || !event.metaKey || event.altKey || event.ctrlKey) return;
      let index = -1;
      if (/^[1-9]$/.test(event.key)) index = Number(event.key) - 1;
      if (event.key === '[' || event.key === ']') {
        const currentKey = app.taskRoomTaskId
          ? `task:${app.taskRoomTaskId}`
          : app.sessionTerminalId
            ? `terminal:${app.sessionTerminalId}`
            : null;
        const current = orderedEntries.findIndex((entry) => entry.key === currentKey);
        index =
          event.key === '['
            ? current <= 0
              ? orderedEntries.length - 1
              : current - 1
            : current < 0 || current >= orderedEntries.length - 1
              ? 0
              : current + 1;
      }
      const entry = orderedEntries[index];
      if (!entry) return;
      event.preventDefault();
      if (entry.kind === 'task') {
        void taskStore.openTask(entry.task.id);
        app.openTaskRoom(entry.task.id);
      } else {
        app.openTerminalSession(entry.terminalId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, orderedEntries, taskStore]);

  const sessionsPanel = (
    <>
      <div className="sr-head">
        <div className="sr-head-title">
          <strong>Sessions</strong>
          <span className="sr-shortcuts">⌘[ ⌘]</span>
        </div>
        <div className="sr-head-actions">
          <button
            data-testid="rail-search"
            title="Search projects, Sessions and files · ⌘K"
            aria-label="Search"
            onClick={() => app.setLauncherOpen(true)}
          >
            <Ic name="search" size={13} />
          </button>
          <button
            data-testid="home-settings"
            title="Settings"
            aria-label="Settings"
            onClick={() => app.openSettings()}
          >
            <Ic name="sliders" size={13} />
          </button>
        </div>
        <div className="sr-new-wrap">
          <button
            className="sr-new"
            data-testid="home-new-task"
            title="Start from the shared Session Composer"
            onClick={() => {
              app.closeTaskRoom();
              app.setSurface('home');
              app.focusComposer();
            }}
          >
            <Ic name="plus" size={13} /> New Session
          </button>
        </div>
      </div>

      {inbox.length > 0 ? (
        <button
          className="sr-attention"
          data-testid="rail-needs-you"
          title="Open the inbox — every session waiting on you"
          onClick={() => setView('inbox')}
        >
          <Ic name="inbox" size={13} />
          <strong>Needs you</strong>
          <span>Open inbox</span>
          <b>{inbox.length}</b>
        </button>
      ) : null}

      <div className="sr-scroll">
        {groups.length === 0 ? (
          <div className="sr-empty">No sessions yet. Start with Pi, Claude or Codex.</div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <section key={group.key} className="sr-group">
                <button
                  className="sr-group-head"
                  data-testid={`rail-group-${group.history ? 'history' : group.name}`}
                  aria-expanded={!isCollapsed}
                  title={group.path ?? group.name}
                  onClick={() => toggleGroup(group.key)}
                >
                  <Ic
                    name="chevron"
                    size={12}
                    className={`sr-group-chevron ${isCollapsed ? 'closed' : ''}`}
                  />
                  <Ic name={group.history ? 'clock' : 'folder'} size={12} />
                  <strong>{group.name}</strong>
                  {group.needs > 0 ? (
                    <span className="sr-group-needs">{group.needs} need you</span>
                  ) : null}
                  <span className="sr-group-count">{group.entries.length}</span>
                </button>
                {isCollapsed ? null : (
                  <div className="sr-group-items">
                    {group.entries.map((entry) =>
                      entry.kind === 'task' ? (
                        <SessionTaskRow
                          key={entry.key}
                          task={entry.task}
                          showProject={group.history === true}
                        />
                      ) : (
                        <TerminalSessionRow
                          key={entry.key}
                          terminalId={entry.terminalId}
                          launch={entry.launch}
                          showProject={false}
                        />
                      ),
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      <div className="sr-context-foot">
        <button
          data-testid="rail-context"
          title={
            workspaceStore.workspace
              ? `${workspaceStore.workspace.path} — new sessions bind here`
              : 'Pick the project new sessions bind to'
          }
          onClick={() => setView('projects')}
        >
          <Ic name="folder" size={13} />
          <span>{workspaceStore.workspace?.displayName ?? 'No project selected'}</span>
          <small>Change</small>
        </button>
      </div>
    </>
  );

  const inboxPanel = (
    <>
      <div className="sr-head sr-head-plain">
        <button
          className="sr-head-back"
          aria-label="Back to Sessions"
          onClick={() => setView('sessions')}
        >
          <Ic name="chevron" size={12} />
        </button>
        <strong>Needs you</strong>
        <span className="sr-shortcuts">{inbox.length} waiting</span>
      </div>
      <div className="sr-scroll" data-testid="rail-inbox-panel">
        {inbox.length === 0 ? (
          <div className="sr-empty">
            Nothing needs you right now. Sessions land here when they wait on a plan, a permission
            or a review.
          </div>
        ) : (
          inbox.map((task) => <SessionTaskRow key={task.id} task={task} />)
        )}
      </div>
    </>
  );

  /** Bind the selected project to the shared Composer and focus intent. */
  const quickStartPi = (project: RecentWorkspaceDto): void => {
    if (workspaceStore.workspace?.path !== project.path) {
      app.setHomePick(true);
      void workspaceStore.openPath(project.path);
    }
    app.closeTaskRoom();
    app.setSurface('home');
    app.focusComposer();
    setView('sessions');
  };

  const projectsPanel = (
    <>
      <div className="sr-head sr-head-plain">
        <button
          className="sr-head-back"
          aria-label="Back to Sessions"
          onClick={() => setView('sessions')}
        >
          <Ic name="chevron" size={12} />
        </button>
        <strong>Projects</strong>
        <span className="sr-shortcuts">working context</span>
      </div>
      <div className="sr-scroll" data-testid="rail-projects-panel">
        {recent.slice(0, 8).map((project) => {
          const active = workspaceStore.workspace?.path === project.path;
          return (
            <React.Fragment key={project.path}>
              <div className="sr-project-wrap">
                <button
                  className={`sr-project ${active ? 'active' : ''}`}
                  data-testid={`home-recent-${project.path}`}
                  title={project.path}
                  onClick={() => {
                    if (active) setTreeOpen(!treeOpen);
                    else {
                      app.setHomePick(true);
                      void workspaceStore.openPath(project.path);
                      // Picking a new working context completes the errand —
                      // return to the sessions panel.
                      setView('sessions');
                    }
                  }}
                >
                  <Ic name="folder" size={13} />
                  <span>{project.displayName}</span>
                  {active ? (
                    <Ic name="chevron" size={12} className={treeOpen ? 'sr-chevron-open' : ''} />
                  ) : null}
                </button>
                <button
                  className="sr-project-use"
                  data-testid={`project-spawn-pi-${project.path}`}
                  title={`Use ${project.displayName} in the shared Composer`}
                  onClick={() => quickStartPi(project)}
                >
                  Use
                </button>
              </div>
              {active && treeOpen ? <HomeProjectTree /> : null}
            </React.Fragment>
          );
        })}
        <button
          className="sr-project muted"
          data-testid="home-open-folder"
          onClick={() => void workspaceStore.openViaDialog()}
        >
          <Ic name="folder" size={13} />
          <span>Open folder…</span>
        </button>
        <button
          className="sr-project muted"
          data-testid="home-new-project"
          onClick={() => app.setNewProjectOpen(true)}
        >
          <Ic name="plus" size={13} />
          <span>New project…</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="sr-rail sr-single" data-testid="home-sidebar" aria-label="Sessions">
        <section className="sr-panel">
          {view === 'inbox' ? inboxPanel : view === 'projects' ? projectsPanel : sessionsPanel}
        </section>
      </aside>
    </>
  );
}
