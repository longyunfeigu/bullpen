import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { LivePreview } from './LivePreview.js';

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
  const [width, setWidth] = useState(savedWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = useCallback(
    (value: number): number =>
      Math.min(Math.max(value, MIN_W), Math.max(MIN_W, Math.round(window.innerWidth * 0.68))),
    [],
  );

  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  return (
    <div className="tr-preview" data-testid="room-preview-rail" style={{ width }}>
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
        <span className="tr-preview-title">Live preview</span>
        <span className="tr-preview-sub">the task's own tree · any state</span>
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
      <LivePreview task={task} variant="rail" />
    </div>
  );
}

/** Header badge: detection decorates, layout changes wait for the click. */
export function PreviewBadge({ task }: { task: TaskDto }): React.JSX.Element | null {
  const app = useAppStore();
  const open = useAppStore((s) => s.previewRailTaskId === task.id);
  const [firstPort, setFirstPort] = useState<number | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probe = async (): Promise<void> => {
      const res = await rpcResult('task.previewPorts', { taskId: task.id });
      if (cancelled || !res.ok) return;
      setFirstPort(res.data.ports[0]?.port ?? null);
      setAvailable(res.data.ports.length > 0 || res.data.webish);
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
      {open ? 'Preview · live' : firstPort !== null ? `Preview :${firstPort}` : 'Preview'}
    </button>
  );
}
