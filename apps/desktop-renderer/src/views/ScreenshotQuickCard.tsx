import React, { useEffect, useRef, useState } from 'react';
import type { ScreenshotCaptureDto } from '@pi-ide/ipc-contracts';
import { onEvent, rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useScreenshotStore } from '../store/screenshotStore.js';
import { useTaskStore } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { Annotator } from './Annotator.js';
import {
  feedAnnotatedScreenshot,
  feedScreenshot,
  resolveFeedRoute,
  saveAnnotatedToProject,
  saveScreenshotToProject,
} from './screenshotFeed.js';

/**
 * ADR-0036: the screenshot quick card. A fresh OS screenshot pops this card
 * bottom-right; it never steals focus and auto-dismisses after 8s (hover
 * pauses) with zero side effects. Acting on the shown capture pops the next
 * one; ✕ / timeout clears the whole stack. Shortcut keys (Enter / E / S)
 * apply only while the pointer or focus is on the card AND no editor-ish
 * element owns the keyboard — a screenshot must never eat a keystroke meant
 * for the composer or terminal.
 */

const AUTO_DISMISS_MS = 8_000;

function keyboardOwnedElsewhere(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (active.closest('[data-screenshot-card]')) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((active as HTMLElement).isContentEditable) return true;
  return active.closest('.xterm') !== null;
}

export function ScreenshotQuickCard(): React.JSX.Element | null {
  const queue = useScreenshotStore((s) => s.queue);
  const revision = useScreenshotStore((s) => s.revision);
  const activeTaskId = useAppStore((s) => s.taskRoomTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path ?? null);
  const [engaged, setEngaged] = useState(false); // hover / focus-within
  const [busy, setBusy] = useState(false);
  const [annotating, setAnnotating] = useState<{
    capture: ScreenshotCaptureDto;
    src: string;
  } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const current = queue[0] ?? null;
  const route = resolveFeedRoute(activeTaskId, tasks, workspacePath);

  // The card is the event subscriber: mount once, feed the store.
  useEffect(
    () => onEvent('screenshot.captured', (capture) => useScreenshotStore.getState().add(capture)),
    [],
  );

  // Auto-dismiss with hover/annotate/busy pause. Timeout clears the STACK.
  useEffect(() => {
    if (!current || engaged || busy || annotating) return;
    const timer = setTimeout(() => useScreenshotStore.getState().clear(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [current, engaged, busy, annotating, revision]);

  const act = async (run: (capture: ScreenshotCaptureDto) => Promise<boolean>): Promise<void> => {
    if (!current || busy) return;
    setBusy(true);
    const done = await run(current);
    setBusy(false);
    if (done) useScreenshotStore.getState().popCurrent();
  };

  const openAnnotator = async (): Promise<void> => {
    if (!current || busy) return;
    setBusy(true);
    const res = await rpcResult('screenshot.read', { path: current.path });
    setBusy(false);
    if (!res.ok) {
      useAppStore.getState().pushToast('warning', res.error.userMessage);
      return;
    }
    setAnnotating({ capture: current, src: `data:${res.data.mime};base64,${res.data.dataBase64}` });
  };

  // Card-scoped shortcuts, guarded against editor/terminal keyboard owners.
  useEffect(() => {
    if (!current || annotating) return;
    const onKey = (e: KeyboardEvent): void => {
      const focusInCard = cardRef.current?.contains(document.activeElement) ?? false;
      if (!engaged && !focusInCard) return;
      if (keyboardOwnedElsewhere() && !focusInCard) return;
      if (e.key === 'Enter') void act(feedScreenshot);
      else if (e.key === 'e' || e.key === 'E') void openAnnotator();
      else if (e.key === 's' || e.key === 'S') void act(saveScreenshotToProject);
      else if (e.key === 'Escape') useScreenshotStore.getState().clear();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, engaged, annotating, busy]);

  if (annotating) {
    return (
      <Annotator
        src={annotating.src}
        hint="The original screenshot is never modified — the annotated copy is what travels."
        actions={[
          {
            testId: 'feed',
            label: route.kind === 'external' ? `Send to ${route.cli}` : 'Send to agent',
            primary: true,
            run: async (dataBase64) => {
              const done = await feedAnnotatedScreenshot(annotating.capture, dataBase64);
              if (done) useScreenshotStore.getState().popCurrent();
              return done;
            },
          },
          {
            testId: 'assets',
            label: 'Save to assets only',
            run: async (dataBase64) => {
              const done = await saveAnnotatedToProject(annotating.capture, dataBase64);
              if (done) useScreenshotStore.getState().popCurrent();
              return done;
            },
          },
        ]}
        onClose={() => setAnnotating(null)}
      />
    );
  }

  if (!current) return null;

  const primaryLabel =
    route.kind === 'external'
      ? `Feed to ${route.cli}`
      : route.kind === 'pi'
        ? 'Feed to agent'
        : 'Keep for next Session';
  const primaryDesc =
    route.kind === 'external'
      ? `Places an @-reference in ${route.cli}’s input line — you press Enter there`
      : route.kind === 'pi'
        ? 'Attaches to the composer and rides your next message'
        : 'Saves to assets/ and rides your next new Session';

  return (
    <div
      ref={cardRef}
      className="screenshot-card"
      data-testid="screenshot-card"
      data-screenshot-card
      role="dialog"
      aria-label="New screenshot"
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={(e) => {
        if (!cardRef.current?.contains(e.relatedTarget as Node)) setEngaged(false);
      }}
    >
      <div className="screenshot-card-head">
        <span className="screenshot-card-glyph" aria-hidden>
          ⌘⇧
        </span>
        <span className="screenshot-card-title">
          <b>New screenshot</b>
          <small>
            {new Date(current.capturedAtMs).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </small>
        </span>
        <button
          className="screenshot-card-close"
          data-testid="screenshot-dismiss"
          aria-label="Dismiss screenshot card"
          onClick={() => useScreenshotStore.getState().clear()}
        >
          ✕
        </button>
      </div>

      <div className="screenshot-card-shot">
        {current.thumbDataUrl ? (
          <img src={current.thumbDataUrl} alt={current.name} draggable={false} />
        ) : (
          <div className="screenshot-card-noshot">No preview</div>
        )}
        {queue.length > 1 ? (
          <span className="screenshot-card-stack" data-testid="screenshot-stack-badge">
            +{queue.length - 1} more
          </span>
        ) : null}
        <span className="screenshot-card-name" title={current.path}>
          {current.name} · {(current.sizeBytes / 1024 / 1024).toFixed(1)} MB
        </span>
      </div>

      <div className="screenshot-card-actions">
        <button
          className="screenshot-card-btn primary"
          data-testid="screenshot-feed"
          disabled={busy}
          onClick={() => void act(feedScreenshot)}
        >
          <span className="ic">⚡</span>
          <span>
            <span className="lbl">{primaryLabel}</span>
            <span className="desc">{primaryDesc}</span>
          </span>
          <kbd>↵</kbd>
        </button>
        <button
          className="screenshot-card-btn"
          data-testid="screenshot-annotate"
          disabled={busy}
          onClick={() => void openAnnotator()}
        >
          <span className="ic">✏️</span>
          <span>
            <span className="lbl">Annotate first</span>
            <span className="desc">Box the bug, redact secrets, then send</span>
          </span>
          <kbd>E</kbd>
        </button>
        <button
          className="screenshot-card-btn"
          data-testid="screenshot-save"
          disabled={busy}
          onClick={() => void act(saveScreenshotToProject)}
        >
          <span className="ic">🗂</span>
          <span>
            <span className="lbl">Save to project assets</span>
            <span className="desc">assets/screenshots/ — no message sent</span>
          </span>
          <kbd>S</kbd>
        </button>
      </div>

      <div className="screenshot-card-life" aria-hidden>
        <i key={revision} style={{ animationPlayState: engaged || busy ? 'paused' : 'running' }} />
      </div>
    </div>
  );
}
