import React from 'react';
import type { ReplayFactDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../home-icons.js';
import { KIND_ICON, LEVEL_LABEL, appLabel, rendererFor } from './replay-model.js';
import { FileRenderer } from './renderers/FileRenderer.js';
import { DocumentRenderer, SpreadsheetRenderer } from './renderers/DocumentRenderers.js';
import {
  ApprovalRenderer,
  GenericActionRenderer,
  MessageRenderer,
  TerminalRenderer,
  VerificationRenderer,
  WebSourceRenderer,
} from './renderers/GenericRenderers.js';

/**
 * Adaptive artifact stage (§6.4): the renderer is chosen by evidence/target
 * type. Unimplemented domains fall back to the generic observable-action
 * card — never a fabricated preview.
 */
export function ArtifactStage({
  fact,
  taskId,
  compact = false,
}: {
  fact: ReplayFactDto;
  taskId: string;
  compact?: boolean;
}): React.JSX.Element {
  const renderer = rendererFor(fact);
  let body: React.JSX.Element;
  switch (renderer) {
    case 'file':
      body = <FileRenderer fact={fact} taskId={taskId} />;
      break;
    case 'document':
      body = <DocumentRenderer fact={fact} taskId={taskId} />;
      break;
    case 'spreadsheet':
      body = <SpreadsheetRenderer fact={fact} taskId={taskId} />;
      break;
    case 'terminal':
      body = <TerminalRenderer fact={fact} />;
      break;
    case 'approval':
      body = <ApprovalRenderer fact={fact} />;
      break;
    case 'verification':
      body = <VerificationRenderer fact={fact} />;
      break;
    case 'message':
      body = <MessageRenderer fact={fact} />;
      break;
    case 'web':
      body = <WebSourceRenderer fact={fact} />;
      break;
    default:
      body = <GenericActionRenderer fact={fact} />;
  }
  return (
    <section
      className={`rp-stage ${compact ? 'compact' : ''}`}
      data-testid="replay-step"
      data-kind={fact.kind}
      data-renderer={renderer}
      aria-label={`Artifact for ${fact.action}`}
    >
      <header className="rp-stage-heading">
        <div>
          <Ic name={KIND_ICON[fact.kind] ?? 'info'} size={13} />
          <strong>{fact.action}</strong>
        </div>
        <div>
          <span className="rp-app-badge">{appLabel(fact)}</span>
          <span className={`rp-level rp-level-${fact.level}`}>{LEVEL_LABEL[fact.level]}</span>
        </div>
      </header>
      <div className={`rp-stage-canvas renderer-${renderer}`}>{body}</div>
      {fact.paths.length > 0 ? (
        <div className="rp-file-trail" data-testid="replay-files">
          {fact.paths.slice(0, 4).map((path) => (
            <span key={path}>{path}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
