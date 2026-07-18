import React from 'react';
import type { FileContextRefDto } from '@pi-ide/ipc-contracts';
import { useDraftStore } from '../store/draftStore.js';
import { Ic } from './home-icons.js';

/**
 * ADR-0024: file / folder / image references waiting in a composer, rendered
 * as removable chips above the input (the fileRefs sibling of
 * CodeContextAttachments). SentFileRefs is the read-only timeline variant.
 */

export function prettyRefSize(bytes?: number): string {
  if (!Number.isFinite(bytes) || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function refIconName(kind: FileContextRefDto['kind']): 'folder' | 'image' | 'file' {
  return kind === 'folder' ? 'folder' : kind === 'image' ? 'image' : 'file';
}

function refMeta(ref: Pick<FileContextRefDto, 'kind' | 'attachmentId' | 'sizeBytes'>): string {
  const parts: string[] = [];
  if (ref.kind === 'folder') parts.push('folder');
  const size = prettyRefSize(ref.sizeBytes);
  if (size) parts.push(size);
  if (ref.attachmentId) parts.push('attachment');
  return parts.join(' · ');
}

export function FileContextAttachments(props: {
  taskId: string;
  refs: FileContextRefDto[];
}): React.JSX.Element | null {
  if (props.refs.length === 0) return null;
  return (
    <div className="file-context-attachments" data-testid="room-file-refs">
      <div className="file-context-heading">
        <span>Files for this turn</span>
        <span>
          {props.refs.length} reference{props.refs.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="file-context-clear"
          data-testid="room-file-refs-clear"
          onClick={() => useDraftStore.getState().clearFileRefs(props.taskId)}
        >
          Clear
        </button>
      </div>
      <div className="file-context-chips">
        {props.refs.map((ref) => {
          const meta = refMeta(ref);
          return (
            <span
              key={ref.id}
              className={`file-ref-chip kind-${ref.kind}`}
              data-testid={`file-ref-${ref.id}`}
              title={ref.path ?? ref.name}
            >
              {ref.kind === 'image' && ref.thumbDataUrl ? (
                <img className="file-ref-thumb" src={ref.thumbDataUrl} alt="" />
              ) : (
                <Ic name={refIconName(ref.kind)} size={13} />
              )}
              <span className="file-ref-name mono">{ref.path ?? ref.name}</span>
              {meta ? <span className="file-ref-meta">{meta}</span> : null}
              <button
                type="button"
                className="file-ref-remove"
                aria-label={`Remove ${ref.name}`}
                data-testid={`file-ref-remove-${ref.id}`}
                onClick={() => useDraftStore.getState().removeFileRef(props.taskId, ref.id)}
              >
                <Ic name="x" size={10} />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Event-payload shape rendered in the timeline (ids are not persisted). */
export interface SentFileRefPayload {
  kind: FileContextRefDto['kind'];
  name: string;
  path?: string;
  sizeBytes?: number;
  thumbDataUrl?: string;
}

export function SentFileRefs(props: { refs: SentFileRefPayload[] }): React.JSX.Element | null {
  if (props.refs.length === 0) return null;
  return (
    <div className="rt-file-refs" data-testid="tl-file-refs">
      <span className="rt-file-refs-label">
        <Ic name="file" size={12} />
        {props.refs.length} file reference{props.refs.length === 1 ? '' : 's'} sent
      </span>
      <span className="rt-file-refs-chips">
        {props.refs.map((ref, index) => (
          <span
            key={`${ref.path ?? ref.name}-${index}`}
            className={`file-ref-chip sent kind-${ref.kind}`}
            title={ref.path ?? ref.name}
          >
            {ref.kind === 'image' && ref.thumbDataUrl ? (
              <img className="file-ref-thumb" src={ref.thumbDataUrl} alt="" />
            ) : (
              <Ic name={refIconName(ref.kind)} size={12} />
            )}
            <span className="file-ref-name mono">{ref.path ?? ref.name}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
