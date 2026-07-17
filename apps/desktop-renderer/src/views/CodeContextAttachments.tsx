import React from 'react';
import type { CodeContextRefDto } from '@pi-ide/ipc-contracts';
import { useDraftStore } from '../store/draftStore.js';
import { codeContextOriginLabel, codeContextRangeLabel } from '../codeContext.js';
import { Ic } from './home-icons.js';

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? text.trim()
  );
}

export function CodeContextAttachments(props: {
  taskId: string;
  refs: CodeContextRefDto[];
  readonly?: boolean;
  testid?: string;
}): React.JSX.Element | null {
  if (props.refs.length === 0) return null;
  const lineCount = props.refs.reduce(
    (total, ref) => total + Math.max(1, ref.endLine - ref.startLine + 1),
    0,
  );
  return (
    <div
      className={`code-context-attachments ${props.readonly ? 'readonly' : ''}`}
      data-testid={props.testid ?? 'room-code-context-refs'}
      aria-label={`${props.refs.length} code context reference${props.refs.length === 1 ? '' : 's'}`}
    >
      {!props.readonly ? (
        <div className="code-context-heading">
          <span>Code context for this turn</span>
          <span>
            {props.refs.length} selection{props.refs.length === 1 ? '' : 's'} · {lineCount} line
            {lineCount === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}
      {props.refs.map((ref) => (
        <article key={ref.id} className="code-context-card" data-testid={`code-ref-${ref.id}`}>
          <span className="code-context-icon" aria-hidden>
            <Ic name="file" size={13} />
          </span>
          <span className="code-context-content">
            <span className="code-context-title mono">
              <b>{ref.path}</b>
              <span>{codeContextRangeLabel(ref)}</span>
            </span>
            <span className="code-context-snippet mono">{firstMeaningfulLine(ref.text)}</span>
            <span className="code-context-meta">
              {codeContextOriginLabel(ref.origin)} · {ref.version.replace('-', ' ')} · frozen
              snapshot
            </span>
          </span>
          {!props.readonly ? (
            <button
              type="button"
              className="code-context-remove"
              aria-label={`Remove ${ref.path} ${codeContextRangeLabel(ref)}`}
              onClick={() => useDraftStore.getState().removeCodeRef(props.taskId, ref.id)}
            >
              <Ic name="x" size={11} />
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function SentCodeContext(props: { refs: CodeContextRefDto[] }): React.JSX.Element | null {
  if (props.refs.length === 0) return null;
  return (
    <details className="rt-code-context" data-testid="tl-code-context" open>
      <summary>
        <Ic name="file" size={12} />
        {props.refs.length} code selection{props.refs.length === 1 ? '' : 's'} sent
      </summary>
      <div className="rt-code-context-list">
        {props.refs.map((ref) => (
          <div key={ref.id} className="rt-code-context-row">
            <span className="mono">
              {ref.path}:{codeContextRangeLabel(ref)}
            </span>
            <span>{codeContextOriginLabel(ref.origin)}</span>
            <code className="mono">{firstMeaningfulLine(ref.text)}</code>
          </div>
        ))}
      </div>
    </details>
  );
}
