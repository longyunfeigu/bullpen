import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { LivePreview } from './LivePreview.js';
import { SessionArtifactView } from './SessionArtifactView.js';

/**
 * The Room's live window (ADR-0022 am.2): a persistent, resizable preview
 * column beside the conversation — available in EVERY task state (running,
 * review, full-auto, accepted). Detection only lights the header badge; this
 * column appears when the user asks and its width is remembered.
 */

const WIDTH_KEY = 'charter.previewRail.width';
const MIN_W = 360;

function savedWidth(): number {
  const raw = Number(window.localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw >= MIN_W ? raw : 560;
}

export function RoomPreviewRail({ task }: { task: TaskDto }): React.JSX.Element {
  const app = useAppStore();
  const focused = useAppStore(
    (state) => state.sessionTool === 'preview' && state.sessionToolExpanded,
  );
  const [width, setWidth] = useState(savedWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [mode, setMode] = useState<'artifact' | 'live'>('live');
  const [artifactCount, setArtifactCount] = useState(0);
  const modeTouched = useRef(false);

  const clamp = useCallback(
    (value: number): number =>
      Math.min(Math.max(value, MIN_W), Math.max(MIN_W, Math.round(window.innerWidth * 0.68))),
    [],
  );

  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const response = await rpcResult('artifact.list', { taskId: task.id });
      if (cancelled || !response.ok) return;
      setArtifactCount(response.data.artifacts.length);
      if (!modeTouched.current && response.data.artifacts.length > 0) setMode('artifact');
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [task.id]);

  return (
    <div
      className={`tr-preview ${focused ? 'focus' : ''}`}
      data-testid="room-preview-rail"
      data-preview-layout={focused ? 'focus' : 'quick'}
      style={{ width }}
    >
      <div
        className="tr-preview-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the preview"
        tabIndex={0}
        onPointerDown={(e) => {
          dragRef.current = { startX: e.clientX, startWidth: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          setWidth(clamp(drag.startWidth + (drag.startX - e.clientX)));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => clamp(w + 32));
          if (e.key === 'ArrowRight') setWidth((w) => clamp(w - 32));
        }}
      />
      <div className="tr-preview-head">
        <span className="tr-preview-title">Session preview</span>
        <div className="tr-preview-modes" role="tablist" aria-label="Preview mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'artifact'}
            className={mode === 'artifact' ? 'active' : ''}
            data-testid="preview-mode-artifacts"
            onClick={() => {
              modeTouched.current = true;
              setMode('artifact');
            }}
          >
            Artifacts {artifactCount > 0 ? artifactCount : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'live'}
            className={mode === 'live' ? 'active' : ''}
            data-testid="preview-mode-live"
            onClick={() => {
              modeTouched.current = true;
              setMode('live');
            }}
          >
            Live web
          </button>
        </div>
        <span className="pv-sp" />
        <button
          className="ghostbtn"
          data-testid="room-preview-close"
          title="Close the preview column"
          onClick={app.closePreviewRail}
        >
          ✕
        </button>
      </div>
      {mode === 'artifact' ? (
        <SessionArtifactView task={task} focused={focused} />
      ) : (
        <LivePreview task={task} variant="rail" />
      )}
    </div>
  );
}

/** Header badge: detection decorates, layout changes wait for the click. */
export function PreviewBadge({ task }: { task: TaskDto }): React.JSX.Element | null {
  const app = useAppStore();
  const open = useAppStore((s) => s.previewRailTaskId === task.id);
  const [firstPort, setFirstPort] = useState<number | null>(null);
  const [available, setAvailable] = useState(false);
  const [artifactCount, setArtifactCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const probe = async (): Promise<void> => {
      const [res, artifactRes] = await Promise.all([
        rpcResult('task.previewPorts', { taskId: task.id }),
        rpcResult('artifact.list', { taskId: task.id }),
      ]);
      if (cancelled) return;
      if (res.ok) setFirstPort(res.data.ports[0]?.port ?? null);
      const count = artifactRes.ok ? artifactRes.data.artifacts.length : 0;
      setArtifactCount(count);
      setAvailable((res.ok && (res.data.ports.length > 0 || res.data.webish)) || count > 0);
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [task.id]);

  if (!available) return null;
  return (
    <button
      className={`tr-pvbadge ${open ? 'live' : ''} ${firstPort !== null ? 'hot' : ''}`}
      data-testid="task-room-preview-badge"
      title={
        open
          ? 'Close the live preview column'
          : firstPort !== null
            ? `A dev server is listening in this task's tree — open the live preview`
            : 'This looks like a web project — open the preview to start its dev server'
      }
      onClick={() => (open ? app.closePreviewRail() : app.openPreviewRail(task.id))}
    >
      <span className="tr-pvbadge-dot" aria-hidden />
      {open
        ? artifactCount > 0
          ? `Artifacts ${artifactCount}`
          : 'Preview live'
        : artifactCount > 0
          ? `Artifacts ${artifactCount}`
          : firstPort !== null
            ? `Preview :${firstPort}`
            : 'Preview'}
    </button>
  );
}
