import type { Logger } from '@pi-ide/foundation';
import { GitService } from '@pi-ide/git-service';
import type { TerminalManager } from '@pi-ide/terminal-service';
import { WorkspaceWatcher, type FsChange } from '@pi-ide/workspace-service';
import type { ChangeSet } from '@pi-ide/change-service';
import { broadcast } from '../broadcast.js';
import type { WorkspaceHost } from './workspace-host.js';
import type { TaskService } from './task-service.js';

/** Paths never attributed to an external session (product/tooling noise). */
const IGNORED_SEGMENTS = ['node_modules', '.git'];
const IGNORED_BASENAMES = ['.DS_Store'];
const IGNORED_PREFIXES = ['.pi-ide-chg.'];

export function isAccountablePath(relativePath: string): boolean {
  const parts = relativePath.split('/');
  if (parts.some((p) => IGNORED_SEGMENTS.includes(p))) return false;
  const base = parts[parts.length - 1] ?? '';
  if (IGNORED_BASENAMES.includes(base)) return false;
  if (IGNORED_PREFIXES.some((p) => base.startsWith(p))) return false;
  return true;
}

export interface ExternalSessionSnapshot {
  terminalId: string;
  taskId: string;
  cli: string;
  snapshotRef: string | null;
  status: 'active' | 'ended';
  files: Array<{
    path: string;
    status: 'created' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
}

interface LiveSession {
  terminalId: string;
  taskId: string;
  cli: string;
  root: string;
  isGitRepo: boolean;
  snapshotRef: string | null;
  git: GitService | null;
  watcher: WorkspaceWatcher;
  unsubscribe: () => void;
  seen: Set<string>;
  recomputeTimer: ReturnType<typeof setTimeout> | null;
  lastFiles: ExternalSessionSnapshot['files'];
  /** Serializes baseline capture; watcher batches can overlap. */
  work: Promise<void>;
  ended: boolean;
}

/**
 * ADR-0017 — external CLI agent sessions. Listens for agent enter/exit on user
 * terminals; on enter snapshots the project (temp-index write-tree), creates
 * the backing task and starts watcher accounting: every touched path gets a
 * baseline from the snapshot blob, so the existing change-set / review /
 * byte-exact rollback machinery works unchanged. On exit the task lands in
 * REVIEW_READY — external work is never auto-accepted.
 */
export class ExternalSessionService {
  private readonly byTerminal = new Map<string, LiveSession>();
  private readonly unsubscribeManager: () => void;

  constructor(
    private readonly terminals: TerminalManager,
    private readonly tasks: TaskService,
    private readonly workspace: WorkspaceHost,
    private readonly logger: Logger,
  ) {
    this.unsubscribeManager = terminals.onAgentState(({ id, agent, cwd }) => {
      if (agent) void this.onAgentEnter(id, agent, cwd);
      else void this.onAgentExit(id);
    });
    // App-quit strandings: close them out into review on startup.
    tasks.recoverExternalTasks();
  }

  /** Active sessions for renderer state restore. */
  list(): ExternalSessionSnapshot[] {
    return [...this.byTerminal.values()].map((s) => ({
      terminalId: s.terminalId,
      taskId: s.taskId,
      cli: s.cli,
      snapshotRef: s.snapshotRef,
      status: s.ended ? 'ended' : 'active',
      files: s.lastFiles,
    }));
  }

  private async onAgentEnter(terminalId: string, cli: string, cwd: string): Promise<void> {
    // A stale session on this terminal (previous CLI still open) ends first.
    if (this.byTerminal.has(terminalId)) await this.onAgentExit(terminalId);

    const ws = this.workspace.current;
    const inWorkspace =
      ws !== null && (cwd === ws.canonicalPath || cwd.startsWith(ws.canonicalPath + '/'));
    if (!ws || !inWorkspace) {
      // Detection UI still works (badge), but there is nothing to account
      // against — worktree terminals and foreign cwds are bounded out (ADR-0017).
      broadcast('terminal.agentState', { id: terminalId, agent: cli, taskId: null });
      this.logger.info('external session without accounting (cwd outside workspace)', {
        terminalId,
        cli,
        cwd,
      });
      return;
    }

    const root = ws.canonicalPath;
    const git = ws.isGitRepo ? new GitService(root) : null;
    let snapshotRef: string | null = null;
    if (git) {
      try {
        snapshotRef = await git.snapshotTree();
      } catch (e) {
        this.logger.warn('external session snapshot failed; degrading to first-seen baselines', {
          terminalId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let taskId: string;
    try {
      const task = await this.tasks.createExternalTask({
        cli,
        terminalId,
        projectPath: root,
        snapshotRef,
      });
      taskId = task.id;
    } catch (e) {
      this.logger.warn('external session task creation failed', {
        terminalId,
        error: e instanceof Error ? e.message : String(e),
      });
      broadcast('terminal.agentState', { id: terminalId, agent: cli, taskId: null });
      return;
    }

    const watcher = new WorkspaceWatcher(root);
    const session: LiveSession = {
      terminalId,
      taskId,
      cli,
      root,
      isGitRepo: ws.isGitRepo,
      snapshotRef,
      git,
      watcher,
      unsubscribe: () => {},
      seen: new Set(),
      recomputeTimer: null,
      lastFiles: [],
      work: Promise.resolve(),
      ended: false,
    };
    session.unsubscribe = watcher.onBatch((changes) => this.onBatch(session, changes));
    watcher.start();
    this.byTerminal.set(terminalId, session);

    broadcast('terminal.agentState', { id: terminalId, agent: cli, taskId });
    broadcast('external.sessionChanged', {
      taskId,
      terminalId,
      cli,
      status: 'active',
      snapshotRef,
      files: [],
    });
    this.logger.info('external session started', { terminalId, cli, taskId, snapshotRef });
  }

  private onBatch(session: LiveSession, changes: FsChange[]): void {
    if (session.ended) return;
    const fresh = changes.filter((c) => !c.isDirectory && isAccountablePath(c.relativePath));
    if (fresh.length === 0) return;
    session.work = session.work.then(async () => {
      const context = this.tasks.contextForTask(session.taskId);
      for (const change of fresh) {
        try {
          if (!session.seen.has(change.relativePath)) {
            session.seen.add(change.relativePath);
            if (session.git && session.snapshotRef) {
              const bytes = await session.git.readTreeBlob(
                session.snapshotRef,
                change.relativePath,
              );
              await context.changes.ensureBaselineFromBytes(
                session.taskId,
                change.relativePath,
                bytes,
              );
            } else {
              // Non-git degradation (ADR-0017): first-seen content is the baseline.
              await context.changes.ensureBaseline(session.taskId, change.relativePath);
            }
          }
          context.changes.recordExternalChange(
            session.taskId,
            change.relativePath,
            change.kind,
            null,
          );
        } catch (e) {
          this.logger.warn('external accounting skipped a path', {
            taskId: session.taskId,
            path: change.relativePath,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
    if (!session.recomputeTimer) {
      session.recomputeTimer = setTimeout(() => {
        session.recomputeTimer = null;
        void this.publish(session, 'active');
      }, 300);
      session.recomputeTimer.unref?.();
    }
  }

  private async publish(session: LiveSession, status: 'active' | 'ended'): Promise<void> {
    try {
      await session.work;
      const context = this.tasks.contextForTask(session.taskId);
      const cs: ChangeSet = await context.changes.changeSet(session.taskId);
      session.lastFiles = cs.files.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      }));
      broadcast('external.sessionChanged', {
        taskId: session.taskId,
        terminalId: session.terminalId,
        cli: session.cli,
        status,
        snapshotRef: session.snapshotRef,
        files: session.lastFiles,
      });
    } catch (e) {
      this.logger.warn('external session publish failed', {
        taskId: session.taskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async onAgentExit(terminalId: string): Promise<void> {
    const session = this.byTerminal.get(terminalId);
    if (!session) {
      broadcast('terminal.agentState', { id: terminalId, agent: null, taskId: null });
      return;
    }
    session.ended = true;
    if (session.recomputeTimer) clearTimeout(session.recomputeTimer);
    session.recomputeTimer = null;
    session.unsubscribe();
    session.watcher.dispose();
    this.byTerminal.delete(terminalId);
    await this.publish(session, 'ended');
    try {
      this.tasks.finishExternalSession(session.taskId, session.lastFiles.length);
    } catch (e) {
      this.logger.warn('external session finish failed', {
        taskId: session.taskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    broadcast('terminal.agentState', { id: terminalId, agent: null, taskId: session.taskId });
    this.logger.info('external session ended', {
      terminalId,
      taskId: session.taskId,
      changedFiles: session.lastFiles.length,
    });
  }

  dispose(): void {
    this.unsubscribeManager();
    for (const [terminalId] of [...this.byTerminal]) {
      void this.onAgentExit(terminalId);
    }
  }
}
