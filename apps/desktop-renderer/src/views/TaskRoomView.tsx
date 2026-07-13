import React, { useEffect, useMemo } from 'react';
import { useTaskStore, RUNNING_TASK_STATES } from '../store/taskStore.js';
import { useActivityStore, currentActionLine } from '../store/activityStore.js';
import { useAppStore } from '../store/appStore.js';
import { useEditorStore } from '../store/editorStore.js';
import { StateBadge, TimelineList, TaskComposer } from './AgentPanel.js';
import { ConfirmDangerButton } from './ui.js';
import { Ic } from './home-icons.js';
import { modeLabel, stateLabel } from './labels.js';

/**
 * Task Room (ADR-0008, PIVOT-021): the per-task page inside the Home surface.
 * Approvals, observation, review entry and the final decision all live here —
 * the Editor is an optional deep-dive, never a required passage.
 */
export function TaskRoomView(): React.JSX.Element {
  const store = useTaskStore();
  const app = useAppStore();
  const editor = useEditorStore();
  const taskId = useAppStore((s) => s.taskRoomTaskId);
  const task = store.tasks.find((t) => t.id === taskId) ?? null;
  const activity = useActivityStore((s) => (taskId ? s.perTask[taskId] : undefined));

  useEffect(() => {
    store.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verification evidence: latest run per label from the recorded events.
  const verifications = useMemo(() => {
    const byLabel = new Map<string, { label: string; state: string }>();
    for (const event of store.timeline) {
      if (event.type !== 'verification.completed') continue;
      const run = (event.payload as { run?: { label?: unknown; state?: unknown } }).run;
      if (run && typeof run.label === 'string') {
        byLabel.set(run.label, { label: run.label, state: String(run.state ?? '') });
      }
    }
    return [...byLabel.values()].slice(-8);
  }, [store.timeline]);

  const openInEditor = (): void => {
    app.setLayout({ agentPanelVisible: true });
    app.setSurface('workspace');
  };

  if (!task) {
    return (
      <div className="tr-root" data-testid="task-room">
        <div className="tr-head">
          <button className="tr-back" data-testid="task-room-back" onClick={app.closeTaskRoom}>
            <Ic name="chevron" size={13} className="tr-back-ic" />
            Home
          </button>
        </div>
        <div className="empty-state">
          <div>This task is not available anymore.</div>
        </div>
      </div>
    );
  }

  const running = RUNNING_TASK_STATES.has(task.state);
  const action = currentActionLine(activity);
  const files = activity?.filesTouched ?? [];

  return (
    <div className="tr-root" data-testid="task-room">
      <div className="tr-head">
        <div className="tr-head-drag" />
        <button className="tr-back" data-testid="task-room-back" onClick={app.closeTaskRoom}>
          <Ic name="chevron" size={13} className="tr-back-ic" />
          Home
        </button>
        <span className="tr-title" title={task.title}>
          {task.title}
        </span>
        <StateBadge state={task.state} />
        <span className="tr-sp" />
        {running ? (
          <button className="btn danger" data-testid="agent-stop" onClick={() => void store.stop()}>
            Stop
          </button>
        ) : null}
        <button
          className="ghostbtn"
          data-testid="replay-open"
          title="Replay what the agent did, step by step"
          onClick={() => store.openReplay()}
        >
          <Ic name="play" size={12} />
          Replay
        </button>
        <button
          className="ghostbtn"
          data-testid="task-room-open-editor"
          title="Open the full editor with this task's context"
          onClick={openInEditor}
        >
          <Ic name="layout" size={12} />
          Open in editor
        </button>
      </div>

      <div className="tr-body">
        <div className="tr-main">
          <div className="tr-mode text-muted">
            {modeLabel(task.mode)} · {task.model.providerId}/{task.model.modelId}
            {action ? <span className="tr-action"> — {action.label}</span> : null}
          </div>
          <TimelineList taskState={task.state} />
          <TaskComposer running={running} />
        </div>

        <aside className="tr-rail">
          <h4>
            Changes
            {files.length > 0 ? ` · ${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </h4>
          {files.length === 0 ? (
            <div className="tr-none">Nothing touched yet.</div>
          ) : (
            files.slice(-12).map((path) => (
              <button
                key={path}
                className="tr-frow"
                data-testid={`task-room-file-${path}`}
                title={`Open ${path} in the editor`}
                onClick={() => {
                  void editor.openFile(path);
                  openInEditor();
                }}
              >
                <Ic name="file" size={11} />
                <span className="tr-fpath">{path}</span>
              </button>
            ))
          )}

          <h4>Verification</h4>
          {verifications.length === 0 ? (
            <div className="tr-none">No verification runs yet.</div>
          ) : (
            verifications.map((v) => (
              <div key={v.label} className="tr-vrow">
                <span className="tr-fpath">{v.label}</span>
                <span className={`tr-vstate ${v.state === 'passed' ? 'ok' : 'bad'}`}>
                  {v.state === 'passed' ? '✓ passed' : v.state}
                </span>
              </div>
            ))
          )}

          <h4>Your decision</h4>
          <div className="tr-decision">
            {task.state === 'REVIEW_READY' ? (
              <>
                <button
                  className="btn primary tr-wide"
                  data-testid="review-open"
                  onClick={() => void store.openReview()}
                >
                  Review changes
                </button>
                <div className="tr-note">
                  Walk through each diff, then accept. A snapshot is kept — you can restore any
                  time.
                </div>
                <hr />
                <ConfirmDangerButton
                  label="Roll back everything…"
                  confirmLabel="Confirm — restore all files"
                  testid="task-rollback"
                  quiet
                  title="Restore every touched file to its pre-task state"
                  onConfirm={() => void store.rollbackTask()}
                />
              </>
            ) : task.state === 'INTERRUPTED' || task.state === 'FAILED' ? (
              <>
                <button
                  className="btn primary tr-wide"
                  data-testid="task-resume"
                  title="Start a new run for this task"
                  onClick={() => void store.resumeTask()}
                >
                  Resume
                </button>
                <button
                  className="btn tr-wide"
                  data-testid="review-open"
                  title="Inspect what changed before deciding"
                  onClick={() => void store.openReview()}
                >
                  Review changes
                </button>
                <hr />
                <ConfirmDangerButton
                  label="Roll back…"
                  confirmLabel="Confirm — roll back"
                  testid="task-rollback"
                  quiet
                  title="Restore every touched file to its pre-task state"
                  onConfirm={() => void store.rollbackTask()}
                />
              </>
            ) : running ? (
              <div className="tr-note">
                The agent is working. You'll be asked here when a plan, permission or review needs
                you.
              </div>
            ) : (
              <div className="tr-note">{stateLabel(task.state)}.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
