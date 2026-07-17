import React, { useEffect, useState } from 'react';
import type { ReplayRequest, TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useTaskStore } from '../store/taskStore.js';
import { useReplayController } from './replay/replay-controller.js';
import { ReplayHeader } from './replay/ReplayHeader.js';
import { SessionContract } from './replay/SessionContract.js';
import { RecapDepth } from './replay/RecapDepth.js';
import { ExploreDepth } from './replay/ExploreDepth.js';
import { VerifyDepth } from './replay/VerifyDepth.js';
import { SemanticTimeline } from './replay/SemanticTimeline.js';
import '../styles/replay.css';

/**
 * Replay V3 (ADR-0017 am.8): one story, three depths. This component only
 * assembles the shell — the controller owns the shared position, and all
 * trust-critical derivation lives in @pi-ide/ipc-contracts.
 */
export function ReplayView(): React.JSX.Element | null {
  const store = useTaskStore();
  const request = store.replayRequest;
  if (!request) return null;
  return <ReplayShell key={request.taskId} request={request} />;
}

function ReplayShell({ request }: { request: ReplayRequest }): React.JSX.Element | null {
  const store = useTaskStore();
  // Bind to request.taskId — never to whatever activeTaskId later becomes.
  const knownTask = store.tasks.find((t) => t.id === request.taskId) ?? null;
  const [fetchedTask, setFetchedTask] = useState<TaskDto | null>(null);
  useEffect(() => {
    if (knownTask) return;
    let disposed = false;
    void rpcResult('task.get', { taskId: request.taskId, eventsAfter: 0 }).then((result) => {
      if (!disposed && result.ok) setFetchedTask(result.data.task);
    });
    return () => {
      disposed = true;
    };
  }, [knownTask, request.taskId]);
  const task = knownTask ?? fetchedTask;

  const controller = useReplayController(request, task);
  const projection = controller.projection;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) {
        if (event.key === 'Escape') (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        store.closeReplay();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        controller.stepBy(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        controller.stepBy(-1);
      } else if (event.key === ' ') {
        event.preventDefault();
        controller.togglePlay();
      } else if (event.key === '1' || event.key === '2' || event.key === '3') {
        controller.setDepth((['recap', 'explore', 'verify'] as const)[Number(event.key) - 1]!);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [store, controller]);

  useEffect(() => {
    document.documentElement.classList.add('replay-active');
    return () => document.documentElement.classList.remove('replay-active');
  }, []);

  if (!task) return null;
  const source = projection?.facts.find((f) => f.source !== 'pi')?.source ?? 'pi';

  return (
    <div
      className="rp-root"
      data-testid="replay-view"
      data-depth={controller.depth}
      role="dialog"
      aria-label={`Replay: ${task.title}`}
    >
      <ReplayHeader
        task={task}
        session={projection?.session ?? null}
        source={source}
        depth={controller.depth}
        onDepth={controller.setDepth}
        onJumpResult={() => {
          const result = [...(projection?.facts ?? [])]
            .reverse()
            .find((fact) => fact.kind === 'report');
          const fallback = projection?.facts.at(-1);
          if (result ?? fallback) controller.selectFact((result ?? fallback)!.id);
          controller.setDepth('recap');
        }}
        onClose={store.closeReplay}
      />
      {projection ? <SessionContract session={projection.session} /> : null}
      <div className="rp-body">
        {controller.loading || !projection ? (
          <div className="rp-loading">Loading the recorded session…</div>
        ) : projection.facts.length === 0 ? (
          <div className="rp-loading">Nothing has been recorded for this task yet.</div>
        ) : controller.depth === 'recap' ? (
          <RecapDepth controller={controller} projection={projection} task={task} />
        ) : controller.depth === 'explore' ? (
          <ExploreDepth controller={controller} projection={projection} task={task} />
        ) : (
          <VerifyDepth controller={controller} projection={projection} task={task} />
        )}
      </div>
      {projection && projection.facts.length > 0 ? (
        <SemanticTimeline controller={controller} projection={projection} />
      ) : null}
      <div className="rp-live-region" aria-live="polite">
        {controller.playing && controller.currentFact ? controller.currentFact.action : ''}
      </div>
    </div>
  );
}
