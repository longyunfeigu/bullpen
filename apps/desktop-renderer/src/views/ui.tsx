import React, { useEffect, useRef, useState } from 'react';
import { Ic } from './home-icons.js';

/**
 * Two-step destructive action (ADR-0008 §3): first click arms the button,
 * the confirm step is explicit and reversible, and it disarms on blur/timeout.
 * E2E: `${testid}` arms, `${testid}-confirm` fires, `${testid}-cancel` disarms.
 */
export function ConfirmDangerButton(props: {
  label: string;
  confirmLabel?: string;
  testid: string;
  disabled?: boolean;
  quiet?: boolean;
  title?: string;
  onConfirm: () => void;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), 8000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed]);

  if (!armed) {
    return (
      <button
        className={props.quiet ? 'btn quiet-danger' : 'btn danger'}
        data-testid={props.testid}
        disabled={props.disabled === true}
        {...(props.title ? { title: props.title } : {})}
        onClick={() => setArmed(true)}
      >
        {props.label}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button
        className="btn danger"
        data-testid={`${props.testid}-confirm`}
        onClick={() => {
          setArmed(false);
          props.onConfirm();
        }}
      >
        {props.confirmLabel ?? `Confirm — ${props.label.replace(/…$/, '')}`}
      </button>
      <button
        className="btn"
        data-testid={`${props.testid}-cancel`}
        onClick={() => setArmed(false)}
      >
        Keep
      </button>
    </span>
  );
}

/**
 * Two-step icon-sized destructive action for dense rows (same arm/confirm
 * contract as ConfirmDangerButton, sized for list hover affordances).
 * First click arms it (turns red, tooltip flips), second click fires;
 * it disarms on mouse leave or after 8s (same window as ConfirmDangerButton).
 */
export function ArmedIconButton(props: {
  icon: string;
  title: string;
  armedTitle: string;
  testid: string;
  className?: string;
  onConfirm: () => void;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), 8000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed]);

  return (
    <button
      className={`${props.className ?? ''} ${armed ? 'armed' : ''}`}
      data-testid={props.testid}
      title={armed ? props.armedTitle : props.title}
      aria-label={armed ? props.armedTitle : props.title}
      onMouseLeave={() => setArmed(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        props.onConfirm();
      }}
    >
      <Ic name={armed ? 'check' : 'archive'} size={12} strokeWidth={2} />
    </button>
  );
}
