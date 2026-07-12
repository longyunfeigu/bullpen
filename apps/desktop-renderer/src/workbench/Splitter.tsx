import React, { useCallback, useRef, useState } from 'react';

interface SplitterProps {
  direction: 'vertical' | 'horizontal';
  /** Called with the pointer delta since drag start; consumer applies clamping. */
  onDrag(delta: number): void;
  onDragStart?(): void;
  ariaLabel: string;
}

/** Draggable divider between panes (keyboard: arrow keys resize by 16px). */
export function Splitter({
  direction,
  onDrag,
  onDragStart,
  ariaLabel,
}: SplitterProps): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = direction === 'vertical' ? e.clientX : e.clientY;
      onDragStart?.();
      setDragging(true);
    },
    [direction, onDragStart],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const pos = direction === 'vertical' ? e.clientX : e.clientY;
      onDrag(pos - start.current);
    },
    [dragging, direction, onDrag],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      className={`splitter ${direction === 'horizontal' ? 'horizontal' : ''} ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        const step = 16;
        if (direction === 'vertical' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          onDragStart?.();
          onDrag(e.key === 'ArrowLeft' ? -step : step);
          e.preventDefault();
        }
        if (direction === 'horizontal' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          onDragStart?.();
          onDrag(e.key === 'ArrowUp' ? -step : step);
          e.preventDefault();
        }
      }}
    />
  );
}
