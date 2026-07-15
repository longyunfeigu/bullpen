import { create } from 'zustand';
import { onEvent, rpcResult } from '../bridge.js';
import { useAppStore } from './appStore.js';
import { useTaskStore } from './taskStore.js';
import { useActivityStore } from './activityStore.js';
// Runtime-only access (inside handlers), so the module cycle with
// TerminalPanel → externalStore is harmless under ESM live bindings.
import { useTerminalStore } from '../views/TerminalPanel.js';

export interface ExternalSessionFile {
  path: string;
  status: 'created' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface ExternalSession {
  terminalId: string;
  taskId: string;
  cli: string;
  snapshotRef: string | null;
  status: 'active' | 'ended';
  files: ExternalSessionFile[];
}

/** ADR-0017 决策 4「检测升格」— the promoted session's shell placement. */
export interface PromotedSession {
  terminalId: string;
  taskId: string;
  /** The (terminal-only) dock was collapsed on promote; restore it on return. */
  collapsedDock: boolean;
}

interface ExternalStore {
  initialized: boolean;
  /** Agent CLI currently running per terminal (badge even without accounting). */
  agentByTerminal: Record<string, string>;
  /** Accounting task per terminal, while a session is attached. */
  taskByTerminal: Record<string, string>;
  /** Live sessions by task id (kept after end for the room summary). */
  sessions: Record<string, ExternalSession>;
  /** Latest accounting delta — drives the peek's live auto-follow in the room. */
  lastDelta: { taskId: string; paths: string[]; seq: number } | null;
  /** Peek auto-follow per external task (absent = on). */
  follow: Record<string, boolean>;
  /** The accounted session currently promoted to the right-side column. */
  promoted: PromotedSession | null;
  setFollow(taskId: string, on: boolean): void;
  init(): void;
}

let seq = 0;

/** New/changed paths between two accounting states — drives the glow pulses. */
export function sessionDelta(
  prev: ExternalSessionFile[] | undefined,
  next: ExternalSessionFile[],
): string[] {
  const before = new Map(
    (prev ?? []).map((f) => [f.path, `${f.additions}/${f.deletions}/${f.status}`]),
  );
  return next
    .filter((f) => before.get(f.path) !== `${f.additions}/${f.deletions}/${f.status}`)
    .map((f) => f.path);
}

/** ADR-0017: renderer projection of external CLI agent sessions. */
export const useExternalStore = create<ExternalStore>((set, get) => {
  // 「检测升格」(ADR-0017 决策 4): an accounted session promotes its terminal to
  // the right-side column; a dock that held only this terminal collapses.
  const promote = (terminalId: string, taskId: string): void => {
    // One promoted column (mock shape). A second concurrent session keeps its
    // badge + room entry but does not steal the column.
    if (get().promoted) return;
    const app = useAppStore.getState();
    const others = useTerminalStore.getState().items.filter((t) => t.id !== terminalId).length;
    const collapsedDock =
      others === 0 && app.layout.bottomPanelVisible && app.layout.bottomTab === 'terminal';
    if (collapsedDock) app.setLayout({ bottomPanelVisible: false });
    set({ promoted: { terminalId, taskId, collapsedDock } });
  };
  const unpromote = (terminalId: string): void => {
    const p = get().promoted;
    if (!p || p.terminalId !== terminalId) return;
    if (p.collapsedDock) {
      useAppStore.getState().setLayout({ bottomPanelVisible: true, bottomTab: 'terminal' });
    }
    set({ promoted: null });
  };

  return {
    initialized: false,
    agentByTerminal: {},
    taskByTerminal: {},
    sessions: {},
    lastDelta: null,
    follow: {},
    promoted: null,

    setFollow(taskId, on) {
      set({ follow: { ...get().follow, [taskId]: on } });
    },

    init() {
      if (get().initialized) return;
      set({ initialized: true });

      onEvent('terminal.agentState', ({ id, agent, taskId }) => {
        const agents = { ...get().agentByTerminal };
        const tasks = { ...get().taskByTerminal };
        const app = useAppStore.getState();
        if (agent) {
          agents[id] = agent;
          if (taskId) {
            tasks[id] = taskId;
            app.pushToast(
              'success',
              `Detected a ${agent} session — entry snapshot taken, changes are being tracked (EXT).`,
            );
            promote(id, taskId);
          } else {
            app.pushToast(
              'info',
              `Detected a ${agent} session in this terminal (outside the focused project — not tracked).`,
            );
          }
        } else {
          delete agents[id];
          const endedTask = tasks[id];
          delete tasks[id];
          if (endedTask) {
            const files = get().sessions[endedTask]?.files.length ?? 0;
            app.pushToast(
              'info',
              files > 0
                ? `External session ended — ${files} file${files === 1 ? '' : 's'} changed, ready for review.`
                : 'External session ended — no file changes.',
            );
          }
          // 退出归位 — the pane returns to the dock.
          unpromote(id);
        }
        set({ agentByTerminal: agents, taskByTerminal: tasks });
        // The backing task appeared / changed state — keep the sidebar truthful.
        void useTaskStore.getState().refreshTasks();
      });

      onEvent('external.sessionChanged', (session) => {
        const sessions = get().sessions;
        const delta = sessionDelta(sessions[session.taskId]?.files, session.files);
        if (delta.length > 0) {
          // Feed the shared presence machinery: tree/task glow + the room rail's
          // filesTouched + FilePeek's pulse-following refetch all key off this.
          seq += 1;
          useActivityStore.getState().ingest({
            key: `ext-${session.taskId}-${seq}`,
            taskId: session.taskId,
            sequence: Date.now() + seq,
            at: new Date().toISOString(),
            kind: 'write',
            label: `${session.cli} edited ${delta.length} file${delta.length === 1 ? '' : 's'}`,
            status: 'ok',
            paths: delta,
            author: 'agent',
          });
        }
        set({
          sessions: { ...sessions, [session.taskId]: session },
          ...(delta.length > 0 && session.status === 'active'
            ? { lastDelta: { taskId: session.taskId, paths: delta, seq } }
            : {}),
        });
      });

      void rpcResult('external.listSessions', {}).then((res) => {
        if (!res.ok) return;
        const sessions: Record<string, ExternalSession> = {};
        const agents: Record<string, string> = {};
        const tasks: Record<string, string> = {};
        for (const s of res.data.sessions) {
          sessions[s.taskId] = s;
          if (s.status === 'active') {
            agents[s.terminalId] = s.cli;
            tasks[s.terminalId] = s.taskId;
          }
        }
        set({
          sessions: { ...get().sessions, ...sessions },
          agentByTerminal: { ...agents, ...get().agentByTerminal },
          taskByTerminal: { ...tasks, ...get().taskByTerminal },
        });
        // A session that survived an app restart promotes again on hydrate.
        const active = res.data.sessions.find((s) => s.status === 'active');
        if (active) promote(active.terminalId, active.taskId);
      });
    },
  };
});
