import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskDto } from '@pi-ide/ipc-contracts';
import { useAppStore, type SessionTool } from '../store/appStore.js';
import { useTaskStore, RUNNING_TASK_STATES } from '../store/taskStore.js';
import { currentActionLine, useActivityStore } from '../store/activityStore.js';
import { FilePeek } from './FilePeek.js';
import { RoomPreviewRail } from './RoomPreviewRail.js';
import { ReviewChecks } from './ReviewChecks.js';
import { ConfirmDangerButton } from './ui.js';
import { Ic } from './home-icons.js';
import { mountTerminal, observeTerminalFit, useTerminalStore } from './TerminalPanel.js';
import { isAnswered, presentedMeta } from './labels.js';
import { roomCopyFor } from './roomCopy.js';
import { LiveBoard } from './LiveBoard.js';

export interface SessionVerification {
  label: string;
  state: string;
}

export interface SessionFileStat {
  additions: number;
  deletions: number;
}

const TOOL_TABS: Array<{ id: SessionTool; label: string; icon: string }> = [
  { id: 'summary', label: 'Summary', icon: 'map' },
  { id: 'diff', label: 'Diff', icon: 'file' },
  { id: 'preview', label: 'Preview', icon: 'eye' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'review', label: 'Review', icon: 'check' },
];

/**
 * The Session-owned tool canvas. Files, diffs, preview, terminal and review
 * are states of one collaboration object — never a second application shell.
 */
export function SessionToolCanvas(props: {
  task: TaskDto;
  files: string[];
  fileStats: Record<string, SessionFileStat>;
  verifications: SessionVerification[];
  editableInWorkspace: boolean;
  onOpenFile: (path: string) => void;
}): React.JSX.Element {
  const { task, files, fileStats, verifications } = props;
  const app = useAppStore();
  const tool = useAppStore((state) => state.sessionTool);
  const expanded = useAppStore((state) => state.sessionToolExpanded);
  const running = RUNNING_TASK_STATES.has(task.state);

  useEffect(() => {
    const current = useAppStore.getState();
    if (task.state === 'REVIEW_READY' && files.length > 0 && current.sessionTool === 'summary') {
      current.setSessionTool('review');
    } else if (isAnswered(task) && current.sessionTool === 'review') {
      // A zero-change answer has nothing to inspect. Keep the Session summary
      // and its Done action in focus instead of presenting a 0-file review.
      current.setSessionTool('summary');
    } else if (task.state === 'ROLLED_BACK' && current.sessionTool === 'review') {
      // The proposed change set no longer exists after rollback. Preserve the
      // timeline record, but retire the active review surface immediately.
      current.setSessionTool('summary');
    }
  }, [task.state, task.id, files.length]);

  const chooseTool = (next: SessionTool): void => {
    if ((next === 'diff' || next === 'file') && files.length > 0) {
      const active = app.peek?.taskId === task.id ? app.peek.active : files[0]!;
      app.openPeek(task.id, active, next === 'diff' ? 'diff' : 'file');
      return;
    }
    if (next === 'preview') {
      app.openPreviewRail(task.id);
      return;
    }
    app.setSessionTool(next);
  };

  return (
    <aside
      className={`session-tool-canvas ${expanded ? 'expanded' : ''}`}
      data-testid="session-tool-canvas"
      aria-label="Session tools"
    >
      <header className="session-tool-tabs">
        <div className="session-tool-tablist" role="tablist" aria-label="Session tools">
          {TOOL_TABS.map((item) => {
            const active =
              item.id === tool || (item.id === 'diff' && (tool === 'diff' || tool === 'file'));
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'active' : ''}
                data-testid={`session-tool-${item.id}`}
                disabled={item.id === 'diff' && files.length === 0}
                onClick={() => chooseTool(item.id)}
              >
                <Ic name={item.icon} size={13} />
                <span>{item.label}</span>
                {item.id === 'diff' && files.length > 0 ? <small>{files.length}</small> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="session-tool-expand"
          data-testid="session-tool-expand"
          aria-pressed={expanded}
          title={expanded ? 'Restore balanced Session view' : 'Give the tool canvas more room'}
          onClick={() => app.setSessionToolExpanded(!expanded)}
        >
          <Ic name="layout" size={13} />
          <span>{expanded ? 'Balance' : 'Expand'}</span>
        </button>
      </header>

      <div className="session-tool-body">
        {tool === 'diff' || tool === 'file' ? (
          files.length > 0 ? (
            <FilePeek
              taskId={task.id}
              worktree={task.worktree !== null}
              editableInWorkspace={props.editableInWorkspace}
              onOpenInEditor={props.onOpenFile}
            />
          ) : (
            <ToolEmpty icon="file" title="No changes yet">
              Files touched by this Session will appear here without replacing the conversation.
            </ToolEmpty>
          )
        ) : tool === 'preview' ? (
          <RoomPreviewRail task={task} />
        ) : tool === 'terminal' ? (
          <SessionTerminalTool task={task} />
        ) : tool === 'review' ? (
          <SessionReviewSummary
            task={task}
            files={files}
            fileStats={fileStats}
            verifications={verifications}
            onOpenDiff={(path) => app.openPeek(task.id, path, 'diff')}
          />
        ) : (
          <SessionSummary
            task={task}
            files={files}
            fileStats={fileStats}
            verifications={verifications}
            onOpenDiff={(path) => app.openPeek(task.id, path, 'diff')}
          />
        )}
      </div>

      <SessionActionDock task={task} files={files} />
    </aside>
  );
}

function ToolEmpty(props: {
  icon: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="session-tool-empty">
      <Ic name={props.icon} size={20} />
      <strong>{props.title}</strong>
      <div className="session-tool-empty-copy">{props.children}</div>
    </div>
  );
}

function SessionSummary(props: {
  task: TaskDto;
  files: string[];
  fileStats: Record<string, SessionFileStat>;
  verifications: SessionVerification[];
  onOpenDiff: (path: string) => void;
}): React.JSX.Element {
  const activity = useActivityStore((state) => state.perTask[props.task.id]);
  const action = currentActionLine(activity);
  const meta = presentedMeta(props.task);
  const running = RUNNING_TASK_STATES.has(props.task.state);
  const streaming = useTaskStore(
    (state) => state.activeTaskId === props.task.id && state.streaming,
  );
  const streamingThinking = useTaskStore((state) =>
    state.activeTaskId === props.task.id ? state.streamingThinking : null,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const current = activity?.current ?? null;
  const elapsed = current ? Math.max(0, Math.round((now - Date.parse(current.at)) / 1000)) : null;
  const liveLabel = streamingThinking
    ? 'Thinking through the next change…'
    : (current?.label ??
      (streaming
        ? 'Composing the next update…'
        : (action?.label ??
          (props.task.state === 'REVIEW_READY'
            ? 'The change set is ready for your decision.'
            : 'No action is currently running.'))));

  return (
    <div className="session-summary" data-testid="session-summary">
      {running ? (
        <LiveBoard
          taskId={props.task.id}
          variant="rail"
          currentAction={{
            label: liveLabel,
            path: current?.paths[0] ?? action?.paths[0] ?? null,
            elapsed,
          }}
          fileStats={props.fileStats}
          onOpenLens={props.onOpenDiff}
        />
      ) : (
        <>
          <section className="session-summary-lead">
            <div className={`session-status-mark ${meta.tone}`}>
              <Ic name={meta.tone === 'ok' ? 'check' : 'clock'} size={15} />
            </div>
            <div>
              <span>Session status</span>
              <strong>{meta.label}</strong>
              <p>{liveLabel}</p>
            </div>
          </section>
          <EvidenceSection
            files={props.files}
            fileStats={props.fileStats}
            onOpenDiff={props.onOpenDiff}
          />
        </>
      )}
      <VerificationSection verifications={props.verifications} task={props.task} />
    </div>
  );
}

function SessionReviewSummary(props: {
  task: TaskDto;
  files: string[];
  fileStats: Record<string, SessionFileStat>;
  verifications: SessionVerification[];
  onOpenDiff: (path: string) => void;
}): React.JSX.Element {
  const store = useTaskStore();
  const copy = roomCopyFor(`${props.task.title}\n${props.task.goalMd}`);

  useEffect(() => {
    if (props.task.state === 'REVIEW_READY' || props.files.length > 0) {
      void store.refreshChangeSet();
    }
    // task id is the refresh boundary; event updates refresh through the review overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.task.id]);

  const report = useMemo(() => {
    for (let index = store.timeline.length - 1; index >= 0; index -= 1) {
      const event = store.timeline[index]!;
      if (event.type === 'report.final') return event.payload as Record<string, unknown>;
    }
    return null;
  }, [store.timeline]);

  const agentSummary = typeof report?.agentSummary === 'string' ? report.agentSummary : null;
  const risks = Array.isArray(report?.unresolvedRisks)
    ? report.unresolvedRisks.filter((risk): risk is string => typeof risk === 'string')
    : [];
  const additions =
    store.changeSet?.totalAdditions ??
    Object.values(props.fileStats).reduce((sum, stat) => sum + stat.additions, 0);
  const deletions =
    store.changeSet?.totalDeletions ??
    Object.values(props.fileStats).reduce((sum, stat) => sum + stat.deletions, 0);

  return (
    <div className="session-review-summary" data-testid="review-bar">
      <section className="session-review-lead">
        <span className="session-review-icon">
          <Ic name="check" size={16} />
        </span>
        <div>
          <span>{copy.reviewReady}</span>
          <strong>
            {props.files.length} file{props.files.length === 1 ? '' : 's'} changed
          </strong>
          <p>{copy.evidenceNote}</p>
        </div>
        <span className="session-diff-total mono">
          <i className="plus">+{additions}</i> <i className="minus">−{deletions}</i>
        </span>
      </section>

      {agentSummary ? (
        <section className="session-review-narrative">
          <h3>Outcome</h3>
          <p>{agentSummary}</p>
        </section>
      ) : null}

      <EvidenceSection
        files={props.files}
        fileStats={props.fileStats}
        onOpenDiff={props.onOpenDiff}
      />
      <div className="session-review-checks">
        <ReviewChecks task={props.task} />
      </div>

      {risks.length > 0 ? (
        <section className="session-risk" data-testid="session-review-risks">
          <div>
            <Ic name="alert" size={14} />
            <strong>{copy.risks}</strong>
          </div>
          <ul>
            {risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <button
        type="button"
        className="session-open-full-diff"
        data-testid="review-bar-open"
        onClick={() => void store.openReview()}
      >
        <span>{copy.reviewChanges}</span>
        <Ic name="chevron" size={13} className="session-arrow-right" />
      </button>
    </div>
  );
}

function EvidenceSection(props: {
  files: string[];
  fileStats: Record<string, SessionFileStat>;
  onOpenDiff: (path: string) => void;
}): React.JSX.Element {
  return (
    <section className="session-evidence-section">
      <header>
        <h3>Changed files</h3>
        <span>{props.files.length}</span>
      </header>
      {props.files.length === 0 ? (
        <p className="session-tool-muted">Nothing touched yet.</p>
      ) : (
        <div className="session-file-ledger">
          {props.files.slice(-12).map((path) => {
            const stat = props.fileStats[path];
            return (
              <button
                key={path}
                type="button"
                data-testid={`task-room-file-${path}`}
                onClick={() => props.onOpenDiff(path)}
              >
                <Ic name="file" size={12} />
                <span>{path}</span>
                {stat ? (
                  <small className="mono">
                    <i className="plus">+{stat.additions}</i>{' '}
                    <i className="minus">−{stat.deletions}</i>
                  </small>
                ) : null}
                <Ic name="chevron" size={11} className="session-row-chevron" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function VerificationSection(props: {
  verifications: SessionVerification[];
  task: TaskDto;
}): React.JSX.Element {
  const store = useTaskStore();
  const configured = props.task.verification.length > 0;
  return (
    <section className="session-evidence-section" data-testid="session-verification">
      <header>
        <h3>Verification</h3>
        <span>{props.verifications.length}</span>
      </header>
      {props.verifications.length === 0 ? (
        <div className="session-verification-empty">
          <p className="session-tool-muted" data-testid="session-verification-pending">
            {configured
              ? `${props.task.verification.length} configured check${props.task.verification.length === 1 ? ' has' : 's have'} not run yet.`
              : 'No verification configured.'}
          </p>
          {configured ? (
            <button
              type="button"
              className="btn"
              data-testid="session-run-verification"
              onClick={() => void store.runVerification()}
            >
              Run checks
            </button>
          ) : null}
        </div>
      ) : (
        <div className="session-verification-result">
          <div className="session-check-ledger" data-testid="session-verification-ledger">
            {props.verifications.map((verification) => {
              const passed = verification.state === 'passed';
              return (
                <div key={verification.label}>
                  <Ic name={passed ? 'check' : 'alert'} size={12} />
                  <span>{verification.label}</span>
                  <strong className={passed ? 'ok' : 'bad'}>
                    {passed ? 'Passed' : verification.state}
                  </strong>
                </div>
              );
            })}
          </div>
          {configured ? (
            <button
              type="button"
              className="session-verification-rerun"
              data-testid="session-run-verification"
              onClick={() => void store.runVerification()}
            >
              Re-run checks
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SessionActionDock({ task, files }: { task: TaskDto; files: string[] }): React.JSX.Element {
  const store = useTaskStore();
  const app = useAppStore();
  const copy = roomCopyFor(`${task.title}\n${task.goalMd}`);
  const running = RUNNING_TASK_STATES.has(task.state);
  const answered = isAnswered(task);

  if (task.state === 'REVIEW_READY' && !answered) {
    return (
      <footer className="session-action-dock" data-testid="session-action-dock">
        {task.external ? (
          <button
            type="button"
            className="btn"
            data-testid="task-resume"
            onClick={() => void store.resumeTask(task.id)}
          >
            Resume {task.external.cli === 'claude' ? 'Claude' : 'Codex'} session
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            data-testid="session-request-changes"
            onClick={() => {
              app.setSessionTool('summary');
              app.focusComposer();
            }}
          >
            Request changes
          </button>
        )}
        <ConfirmDangerButton
          label={task.worktree ? 'Discard…' : 'Rollback…'}
          confirmLabel={task.worktree ? 'Confirm — discard worktree' : 'Confirm — roll back'}
          testid="task-rollback"
          quiet
          onConfirm={() => void store.rollbackTask()}
        />
        <button
          type="button"
          className="btn primary session-approve"
          data-testid="review-bar-accept"
          onClick={() => void store.acceptTask()}
        >
          <Ic name="check" size={13} /> {copy.accept}
        </button>
      </footer>
    );
  }

  if (task.state === 'REVIEW_READY' && answered) {
    return (
      <footer className="session-action-dock" data-testid="session-action-dock">
        <span className="session-action-note" data-testid="task-room-answered">
          Answer complete · no file changes
        </span>
        {task.external ? (
          <button
            className="btn"
            data-testid="task-resume"
            onClick={() => void store.resumeTask(task.id)}
          >
            Resume {task.external.cli === 'claude' ? 'Claude' : 'Codex'} session
          </button>
        ) : null}
        <button
          className="btn primary"
          data-testid="task-done"
          onClick={() => void store.acceptTask()}
        >
          Done
        </button>
      </footer>
    );
  }

  if (task.state === 'FAILED' || task.state === 'INTERRUPTED') {
    return (
      <footer className="session-action-dock" data-testid="session-action-dock">
        {files.length > 0 ? (
          <button
            className="btn"
            data-testid="review-open"
            onClick={() => app.setSessionTool('review')}
          >
            Review evidence
          </button>
        ) : null}
        {files.length > 0 ? (
          <ConfirmDangerButton
            label={task.worktree ? 'Discard…' : 'Rollback…'}
            confirmLabel={task.worktree ? 'Confirm — discard worktree' : 'Confirm — roll back'}
            testid="task-rollback"
            quiet
            onConfirm={() => void store.rollbackTask()}
          />
        ) : null}
        <span className="session-action-note">The Session stopped before completion.</span>
        <button
          className="btn primary"
          data-testid="task-resume"
          onClick={() => void store.resumeTask(task.id)}
        >
          Resume
        </button>
      </footer>
    );
  }

  if (running) {
    return (
      <footer className="session-action-dock compact" data-testid="session-action-dock">
        <span className="session-action-live">
          <i /> Agent working
        </span>
        <span className="session-action-note">You can steer it from the composer.</span>
        {!task.external ? (
          <button className="btn danger" data-testid="agent-stop" onClick={() => void store.stop()}>
            Stop
          </button>
        ) : null}
      </footer>
    );
  }

  if (task.state === 'ACCEPTED' && !task.worktree) {
    return (
      <footer className="session-action-dock compact" data-testid="session-action-dock">
        <span className="session-action-note" data-testid="task-room-accepted">
          Accepted · snapshot retained
        </span>
        <ConfirmDangerButton
          label="Rollback…"
          confirmLabel="Confirm — restore all files"
          testid="task-rollback"
          quiet
          onConfirm={() => void store.rollbackTask()}
        />
      </footer>
    );
  }

  return <footer className="session-action-dock empty" data-testid="session-action-dock" />;
}

function SessionTerminalTool({ task }: { task: TaskDto }): React.JSX.Element {
  const terminalStore = useTerminalStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const item = terminalStore.items.find(
    (candidate) => !candidate.hidden && candidate.contextTaskId === task.id,
  );

  useEffect(() => {
    terminalStore.init();
  }, [terminalStore]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !item) return;
    mountTerminal(host, item);
    return observeTerminalFit(host, item);
  }, [item]);

  const createTerminal = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    await terminalStore.create({
      taskId: task.id,
      context: { kind: 'task', taskId: task.id },
      title: task.worktree?.branch ?? task.title,
      reveal: false,
    });
    setCreating(false);
  };

  if (!item) {
    return (
      <ToolEmpty icon="terminal" title="Session terminal">
        <span>
          Open a terminal in this Session's {task.worktree ? 'isolated worktree' : 'project'}.
        </span>
        <button
          className="btn primary"
          data-testid="session-terminal-create"
          disabled={creating}
          onClick={() => void createTerminal()}
        >
          {creating ? 'Opening…' : 'Open terminal'}
        </button>
      </ToolEmpty>
    );
  }

  return (
    <section className="session-terminal-tool" data-testid="session-terminal-tool">
      <header>
        <span>
          <Ic name="terminal" size={13} /> {item.title}
        </span>
        <small>{item.contextLabel}</small>
        <span className={`session-terminal-state ${item.exited ? 'ended' : ''}`}>
          {item.exited ? 'Ended' : 'Live'}
        </span>
      </header>
      <div ref={hostRef} className="session-terminal-host" />
    </section>
  );
}
