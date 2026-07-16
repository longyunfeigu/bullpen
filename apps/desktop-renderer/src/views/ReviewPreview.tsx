import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewPortDto, PreviewRectDto, TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useTaskStore } from '../store/taskStore.js';
import { useAppStore } from '../store/appStore.js';
import { Ic } from './home-icons.js';

/**
 * Acceptance-gate preview (ADR-0022): render the task's OWN dev server in a
 * sandboxed iframe, and turn "I can see the problem" into the same request-fix
 * loop Review v2 uses — marquee + note + screenshot, one conversation.
 */

const POLL_MS = 4000;

interface Marquee {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizedRect(a: { x: number; y: number }, b: { x: number; y: number }): Marquee {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Burn the selection rectangle into the captured PNG (canvas is same-origin
 * for data-URL images, so this never taints). Returns raw base64. */
async function compositeSelection(
  pngBase64: string,
  capturedCssSize: { width: number; height: number },
  selection: Marquee,
): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('screenshot decode failed'));
    img.src = `data:image/png;base64,${pngBase64}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return pngBase64;
  ctx.drawImage(img, 0, 0);
  const sx = img.naturalWidth / Math.max(1, capturedCssSize.width);
  const sy = img.naturalHeight / Math.max(1, capturedCssSize.height);
  const x = selection.x * sx;
  const y = selection.y * sy;
  const w = selection.width * sx;
  const h = selection.height * sy;
  ctx.save();
  ctx.fillStyle = 'rgba(214, 60, 50, 0.10)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#d63c32';
  ctx.lineWidth = Math.max(2, 2 * sx);
  ctx.setLineDash([8 * sx, 5 * sx]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.slice('data:image/png;base64,'.length);
}

export function ReviewPreview({ task }: { task: TaskDto }): React.JSX.Element {
  const store = useTaskStore();
  const app = useAppStore();
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [ports, setPorts] = useState<PreviewPortDto[] | null>(null);
  const [root, setRoot] = useState('');
  const [selectedPort, setSelectedPort] = useState<number | null>(null);
  const [path, setPath] = useState('/');
  const [frameSeq, setFrameSeq] = useState(0);
  const [armed, setArmed] = useState(false);
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; rect: Marquee } | null>(null);
  const [note, setNote] = useState<{ rect: Marquee; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    const res = await rpcResult('task.previewPorts', { taskId: task.id });
    if (!res.ok) return;
    setRoot(res.data.root);
    setPorts(res.data.ports);
    setSelectedPort((current) => {
      if (current !== null && res.data.ports.some((p) => p.port === current)) return current;
      return res.data.ports[0]?.port ?? null;
    });
  }, [task.id]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const active = ports?.find((p) => p.port === selectedPort) ?? null;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const frameUrl = active ? `http://localhost:${active.port}${cleanPath}` : null;

  const cancelMarquee = useCallback(() => {
    setDrag(null);
    setNote(null);
  }, []);

  useEffect(() => {
    if (!armed) cancelMarquee();
  }, [armed, cancelMarquee]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (drag || note || armed)) {
        e.stopPropagation();
        cancelMarquee();
        setArmed(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [armed, drag, note, cancelMarquee]);

  useEffect(() => {
    if (note) noteRef.current?.focus();
  }, [note]);

  const overlayPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const box = frameBoxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(0, e.clientX - box.left), box.width),
      y: Math.min(Math.max(0, e.clientY - box.top), box.height),
    };
  };

  const sendFeedback = async (): Promise<void> => {
    if (!note || !frameUrl || sending) return;
    const text = note.text.trim();
    if (!text) {
      noteRef.current?.focus();
      return;
    }
    setSending(true);
    try {
      const box = frameBoxRef.current!.getBoundingClientRect();
      const sel: PreviewRectDto = {
        x: Math.round(note.rect.x),
        y: Math.round(note.rect.y),
        width: Math.max(1, Math.round(note.rect.width)),
        height: Math.max(1, Math.round(note.rect.height)),
      };
      const message = [
        `Preview feedback on ${frameUrl} (acceptance-gate preview of this task's own tree):`,
        `- Selected region: x=${sel.x}, y=${sel.y}, width=${sel.width}, height=${sel.height} (CSS px, relative to the page viewport)`,
        `- Note: ${text}`,
        'The attached screenshot shows the rendered page with the selected region outlined in red.',
      ].join('\n');
      const captured = await rpcResult('task.capturePreview', {
        taskId: task.id,
        rect: {
          x: Math.max(0, Math.round(box.left)),
          y: Math.max(0, Math.round(box.top)),
          width: Math.max(1, Math.round(box.width)),
          height: Math.max(1, Math.round(box.height)),
        },
      });
      let delivered: boolean;
      if (captured.ok) {
        const composed = await compositeSelection(
          captured.data.dataBase64,
          { width: box.width, height: box.height },
          note.rect,
        );
        delivered = await store.sendPreviewFeedback(message, {
          dataBase64: composed,
          mimeType: 'image/png',
          pageUrl: frameUrl,
          rect: sel,
          note: text,
        });
      } else {
        // Degraded but honest: the structured note still flows back.
        app.pushToast('info', 'Screenshot capture failed — sending the note without it.');
        await store.send(`${message}\n(Screenshot capture failed — none attached.)`, 'steer');
        delivered = true;
      }
      if (delivered) {
        cancelMarquee();
        setArmed(false);
        store.closeReview();
        app.openTaskRoom(task.id);
        app.pushToast('success', 'Feedback sent — the agent continues with your selection.');
      }
    } finally {
      setSending(false);
    }
  };

  if (ports === null) {
    return (
      <div className="pv-pane" data-testid="preview-pane">
        <div className="pv-note">Scanning this task’s tree for dev servers…</div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="pv-pane" data-testid="preview-pane">
        <div className="pv-empty empty-state" data-testid="preview-empty">
          <div className="es-title">No dev server detected in this task’s tree</div>
          <div className="pv-empty-body">
            The gate looks for processes listening on localhost whose working directory is inside
            <span className="mono pv-root"> {root || task.worktree?.path || task.projectPath}</span>
            — it never starts one for you.
          </div>
          <div className="pv-empty-body">
            Start your dev command (e.g. <span className="mono">npm run dev</span>) in this task’s
            terminal, then refresh.
          </div>
          <button className="btn" data-testid="preview-refresh" onClick={() => void refresh()}>
            <Ic name="refresh" size={12} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pv-pane" data-testid="preview-pane">
      <div className="pv-toolbar">
        {ports.map((p) => (
          <button
            key={p.port}
            className={`pv-port ${p.port === selectedPort ? 'active' : ''}`}
            data-testid={`preview-port-${p.port}`}
            title={`${p.command} (pid ${p.pid})`}
            onClick={() => setSelectedPort(p.port)}
          >
            :{p.port} <span className="pv-port-cmd">{p.command}</span>
          </button>
        ))}
        <input
          className="pv-path mono"
          data-testid="preview-path"
          value={path}
          placeholder="/"
          spellCheck={false}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFrameSeq((s) => s + 1);
          }}
        />
        <button
          className="btn"
          data-testid="preview-reload"
          title="Reload the preview"
          onClick={() => setFrameSeq((s) => s + 1)}
        >
          <Ic name="refresh" size={12} />
        </button>
        <button
          className="btn"
          data-testid="preview-open-external"
          title="Open in your browser (same port — real DevTools live there)"
          onClick={() =>
            void rpcResult('task.previewOpenExternal', {
              taskId: task.id,
              port: active.port,
              path: cleanPath,
            }).then((res) => {
              if (!res.ok) app.pushToast('error', res.error.userMessage);
            })
          }
        >
          <Ic name="external" size={12} /> Browser
        </button>
        <span className="pv-sp" />
        <button
          className={`pv-mark ${armed ? 'armed' : ''}`}
          data-testid="preview-mark"
          title="Drag a rectangle on the preview; your note + screenshot go back to the agent"
          onClick={() => setArmed((a) => !a)}
        >
          <Ic name="pencil" size={12} /> {armed ? 'Marking — drag on the page' : 'Mark issue'}
        </button>
      </div>

      <div className="pv-framebox" ref={frameBoxRef}>
        <iframe
          key={`${frameUrl}#${frameSeq}`}
          className="pv-frame"
          data-testid="preview-frame"
          src={frameUrl ?? undefined}
          sandbox="allow-scripts allow-same-origin allow-forms"
          title="Task preview"
        />
        <span className="pv-badge" data-testid="preview-badge">
          {task.worktree ? 'task worktree · isolated' : 'task tree'}
        </span>
        {armed ? (
          <div
            className="pv-overlay"
            data-testid="preview-overlay"
            onPointerDown={(e) => {
              if (note) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const start = overlayPoint(e);
              setDrag({ start, rect: { ...start, width: 0, height: 0 } });
            }}
            onPointerMove={(e) => {
              if (!drag || note) return;
              setDrag({ start: drag.start, rect: normalizedRect(drag.start, overlayPoint(e)) });
            }}
            onPointerUp={() => {
              if (!drag || note) return;
              if (drag.rect.width >= 8 && drag.rect.height >= 8) {
                setNote({ rect: drag.rect, text: '' });
              } else {
                setDrag(null);
              }
            }}
          >
            {!drag && !note ? (
              <div className="pv-overlay-hint">Drag to select the problem area — Esc cancels</div>
            ) : null}
            {drag ? (
              <div
                className="pv-marquee"
                style={{
                  left: drag.rect.x,
                  top: drag.rect.y,
                  width: drag.rect.width,
                  height: drag.rect.height,
                }}
              />
            ) : null}
            {note ? (
              <div
                className="pv-notecard"
                style={{
                  left: Math.min(
                    note.rect.x + note.rect.width + 10,
                    (frameBoxRef.current?.clientWidth ?? 600) - 270,
                  ),
                  top: Math.min(
                    note.rect.y,
                    Math.max(8, (frameBoxRef.current?.clientHeight ?? 400) - 150),
                  ),
                }}
              >
                <textarea
                  ref={noteRef}
                  data-testid="preview-note-input"
                  rows={3}
                  placeholder="What's wrong here? (sent with the screenshot + selection)"
                  value={note.text}
                  onChange={(e) => setNote({ rect: note.rect, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendFeedback();
                    }
                  }}
                />
                <div className="pv-notecard-row">
                  <button className="btn" onClick={cancelMarquee}>
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    data-testid="preview-note-send"
                    disabled={sending}
                    onClick={() => void sendFeedback()}
                  >
                    {sending ? 'Sending…' : 'Send to agent'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pv-foot">
        Serving from this task’s {task.worktree ? 'worktree' : 'project tree'}
        <span className="mono pv-root"> {root}</span> — the gate never starts or stops servers.
      </div>
    </div>
  );
}
