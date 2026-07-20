import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared image annotator (PIVOT-020, generalized for ADR-0036). Draws arrows,
 * boxes and mosaic redactions over a data-URL base image and exports the
 * canvas as PNG bytes. What happens to those bytes is the caller's business —
 * ImageView saves next to the source file, the screenshot quick card feeds
 * the active agent / assets folder. The base image is never modified.
 */

type Tool = 'arrow' | 'rect' | 'mosaic';

interface Shape {
  tool: Tool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const STROKE = '#e5484d';

function drawShape(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  shape: Shape,
  scale: number,
): void {
  const { x1, y1, x2, y2 } = shape;
  ctx.save();
  ctx.strokeStyle = STROKE;
  ctx.fillStyle = STROKE;
  ctx.lineWidth = Math.max(2, 3 / scale);
  if (shape.tool === 'rect') {
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (shape.tool === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(10, 14 / scale);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - head * Math.cos(angle - Math.PI / 6),
      y2 - head * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      x2 - head * Math.cos(angle + Math.PI / 6),
      y2 - head * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
  } else {
    // Mosaic: resample the ORIGINAL pixels at low resolution (true redaction —
    // the covered pixels never survive into the exported PNG).
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (w < 2 || h < 2) {
      ctx.restore();
      return;
    }
    const block = 14;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w / block));
    off.height = Math.max(1, Math.round(h / block));
    const offCtx = off.getContext('2d')!;
    offCtx.drawImage(image, x, y, w, h, 0, 0, off.width, off.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, off.width, off.height, x, y, w, h);
  }
  ctx.restore();
}

export interface AnnotatorAction {
  /** data-testid suffix: `annot-${testId}`. */
  testId: string;
  label: string;
  primary?: boolean;
  /** Receives base64 PNG bytes; resolve true to close the annotator. */
  run(dataBase64: string): Promise<boolean> | boolean;
}

export function Annotator(props: {
  src: string;
  actions: AnnotatorAction[];
  hint: string;
  onClose: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('arrow');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
      }
      const fit = Math.min(
        1,
        (window.innerWidth * 0.78) / image.naturalWidth,
        (window.innerHeight * 0.66) / image.naturalHeight,
      );
      setScale(fit);
      setReady(true);
    };
    image.src = props.src;
  }, [props.src]);

  // Redraw on every state change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0);
    for (const shape of shapes) drawShape(ctx, image, shape, scale);
    if (draft) drawShape(ctx, image, draft, scale);
  }, [shapes, draft, ready, scale]);

  const toImageCoords = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const runAction = async (action: AnnotatorAction): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    const dataUrl = canvas.toDataURL('image/png');
    const done = await action.run(dataUrl.slice(dataUrl.indexOf(',') + 1));
    setBusy(false);
    if (done) props.onClose();
  };

  return (
    <div
      data-testid="annotator"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        background: 'var(--bg-overlay)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          padding: '6px 10px',
        }}
      >
        {(['arrow', 'rect', 'mosaic'] as Tool[]).map((t) => (
          <button
            key={t}
            className={`btn ${tool === t ? 'primary' : ''}`}
            data-testid={`annot-tool-${t}`}
            onClick={() => setTool(t)}
          >
            {t === 'arrow' ? '↗ Arrow' : t === 'rect' ? '▢ Box' : '▦ Mosaic'}
          </button>
        ))}
        <span style={{ width: 8 }} />
        <button
          className="btn"
          data-testid="annot-undo"
          disabled={shapes.length === 0}
          onClick={() => setShapes(shapes.slice(0, -1))}
        >
          ↩ Undo
        </button>
        {props.actions.map((action) => (
          <button
            key={action.testId}
            className={`btn ${action.primary ? 'primary' : ''}`}
            data-testid={`annot-${action.testId}`}
            disabled={busy}
            onClick={() => void runAction(action)}
          >
            {action.label}
          </button>
        ))}
        <button className="btn" data-testid="annot-close" onClick={props.onClose}>
          ✕
        </button>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="annot-canvas"
        style={{
          width: ready && imageRef.current ? imageRef.current.naturalWidth * scale : 200,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-editor)',
          cursor: 'crosshair',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onMouseDown={(e) => {
          const p = toImageCoords(e);
          setDraft({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        }}
        onMouseMove={(e) => {
          if (!draft) return;
          const p = toImageCoords(e);
          setDraft({ ...draft, x2: p.x, y2: p.y });
        }}
        onMouseUp={() => {
          if (!draft) return;
          if (Math.abs(draft.x2 - draft.x1) > 3 || Math.abs(draft.y2 - draft.y1) > 3) {
            setShapes([...shapes, draft]);
          }
          setDraft(null);
        }}
        onMouseLeave={() => setDraft(null)}
      />
      <div className="text-muted" style={{ fontSize: 11.5 }}>
        {props.hint}
      </div>
    </div>
  );
}
