import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  ArtifactAnchorDto,
  ArtifactDescriptorDto,
  ArtifactFeedbackRefDto,
  ArtifactOpenResultDto,
  TaskDto,
} from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useDraftStore } from '../store/draftStore.js';
import { ArtifactPdfViewer } from './ArtifactPdfViewer.js';
import '../styles/artifact.css';

const EMPTY_ANCHOR: ArtifactAnchorDto = { type: 'whole' };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function kindLabel(kind: ArtifactDescriptorDto['kind']): string {
  const labels: Record<ArtifactDescriptorDto['kind'], string> = {
    text: 'TEXT',
    table: 'TABLE',
    image: 'IMAGE',
    pdf: 'PDF',
    audio: 'AUDIO',
    video: 'VIDEO',
    html: 'HTML',
    archive: 'ARCHIVE',
    binary: 'BINARY',
  };
  return labels[kind];
}

function anchorLabel(anchor: ArtifactAnchorDto): string {
  if (anchor.type === 'text') return `Lines ${anchor.startLine}-${anchor.endLine}`;
  if (anchor.type === 'table') {
    return `Rows ${anchor.startRow}-${anchor.endRow}, columns ${anchor.startColumn}-${anchor.endColumn}`;
  }
  if (anchor.type === 'image') return 'Image region';
  if (anchor.type === 'pdf') return `PDF page ${anchor.page}${anchor.region ? ' region' : ''}`;
  if (anchor.type === 'media') {
    const end = anchor.endSeconds === undefined ? '' : `-${anchor.endSeconds.toFixed(2)}s`;
    return `Timeline ${anchor.startSeconds.toFixed(2)}s${end}`;
  }
  if (anchor.type === 'html') return `DOM ${anchor.selector}`;
  if (anchor.type === 'archive') return `Archive ${anchor.innerPath}`;
  return 'Whole file';
}

function parseDelimited(text: string, delimiter: string, rowLimit = 2000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      if (rows.length >= rowLimit) return rows;
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function spreadsheetColumnLabel(column: number): string {
  let current = Math.max(1, column);
  let label = '';
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label;
}

function clampRegion(input: { x: number; y: number; width: number; height: number }) {
  const x = Math.max(0, Math.min(0.999, input.x));
  const y = Math.max(0, Math.min(0.999, input.y));
  return {
    x,
    y,
    width: Math.max(0.001, Math.min(1 - x, input.width)),
    height: Math.max(0.001, Math.min(1 - y, input.height)),
  };
}

function RegionPicker(props: {
  onRegion: (region: { x: number; y: number; width: number; height: number }) => void;
  region?: { x: number; y: number; width: number; height: number };
}): React.JSX.Element {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  return (
    <div
      className="artifact-region-picker"
      data-testid="artifact-region-picker"
      onPointerDown={(event) => {
        const next = point(event);
        setStart(next);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start) return;
        const next = point(event);
        props.onRegion(
          clampRegion({
            x: Math.min(start.x, next.x),
            y: Math.min(start.y, next.y),
            width: Math.abs(next.x - start.x),
            height: Math.abs(next.y - start.y),
          }),
        );
      }}
      onPointerUp={(event) => {
        if (start) {
          const next = point(event);
          props.onRegion(
            clampRegion({
              x: Math.min(start.x, next.x),
              y: Math.min(start.y, next.y),
              width: Math.abs(next.x - start.x),
              height: Math.abs(next.y - start.y),
            }),
          );
        }
        setStart(null);
      }}
    >
      {props.region ? (
        <span
          className="artifact-region-box"
          style={{
            left: `${props.region.x * 100}%`,
            top: `${props.region.y * 100}%`,
            width: `${props.region.width * 100}%`,
            height: `${props.region.height * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

function TextArtifact(props: {
  text: string;
  truncated: boolean;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  const lines = useMemo(() => props.text.split('\n').slice(0, 5000), [props.text]);
  const startRef = useRef(1);
  return (
    <div className="artifact-text" data-testid="artifact-text-view">
      {props.truncated ? <div className="artifact-inline-note">Showing the first 4 MB.</div> : null}
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const selected =
          props.anchor.type === 'text' &&
          lineNumber >= props.anchor.startLine &&
          lineNumber <= props.anchor.endLine;
        return (
          <button
            type="button"
            className={`artifact-code-line ${selected ? 'selected' : ''}`}
            key={lineNumber}
            onClick={(event) => {
              if (!event.shiftKey) startRef.current = lineNumber;
              props.onAnchor({
                type: 'text',
                startLine: Math.min(startRef.current, lineNumber),
                endLine: Math.max(startRef.current, lineNumber),
              });
            }}
          >
            <span>{lineNumber}</span>
            <code>{line || ' '}</code>
          </button>
        );
      })}
    </div>
  );
}

function TableArtifact(props: {
  text: string;
  delimiter: string;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  const rows = useMemo(
    () => parseDelimited(props.text, props.delimiter),
    [props.text, props.delimiter],
  );
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const dragRef = useRef<{
    mode: 'cell' | 'row' | 'column';
    row: number;
    column: number;
  } | null>(null);
  const selected = (row: number, column: number): boolean =>
    props.anchor.type === 'table' &&
    row >= props.anchor.startRow &&
    row <= props.anchor.endRow &&
    column >= props.anchor.startColumn &&
    column <= props.anchor.endColumn;
  const hit = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>('[data-table-select]');
    if (!element) return null;
    const mode = element.dataset.tableSelect as 'cell' | 'row' | 'column' | undefined;
    if (!mode) return null;
    return {
      mode,
      row: Math.max(1, Number(element.dataset.row) || 1),
      column: Math.max(1, Number(element.dataset.column) || 1),
    };
  };
  const applyRange = (
    start: { mode: 'cell' | 'row' | 'column'; row: number; column: number },
    end: { row: number; column: number },
  ): void => {
    if (start.mode === 'row') {
      props.onAnchor({
        type: 'table',
        startRow: Math.min(start.row, end.row),
        endRow: Math.max(start.row, end.row),
        startColumn: 1,
        endColumn: maxColumns,
      });
      return;
    }
    if (start.mode === 'column') {
      props.onAnchor({
        type: 'table',
        startRow: 1,
        endRow: Math.max(1, rows.length),
        startColumn: Math.min(start.column, end.column),
        endColumn: Math.max(start.column, end.column),
      });
      return;
    }
    props.onAnchor({
      type: 'table',
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
      startColumn: Math.min(start.column, end.column),
      endColumn: Math.max(start.column, end.column),
    });
  };
  const selectionStart = (
    next: { mode: 'cell' | 'row' | 'column'; row: number; column: number },
    extend: boolean,
  ) => {
    if (!extend || props.anchor.type !== 'table') return next;
    if (next.mode === 'row') return { ...next, row: props.anchor.startRow };
    if (next.mode === 'column') return { ...next, column: props.anchor.startColumn };
    return {
      ...next,
      row: props.anchor.startRow,
      column: props.anchor.startColumn,
    };
  };
  return (
    <div className="artifact-table-wrap" data-testid="artifact-table-view">
      <div className="artifact-table-guide">
        <span>Drag cells, or drag row/column headers. Shift-click extends the range.</span>
        <button
          type="button"
          onClick={() =>
            props.onAnchor({
              type: 'table',
              startRow: 1,
              endRow: Math.max(1, rows.length),
              startColumn: 1,
              endColumn: maxColumns,
            })
          }
        >
          Select all
        </button>
      </div>
      <table
        className="artifact-table"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const next = hit(event.target);
          if (!next) return;
          event.preventDefault();
          const start = selectionStart(next, event.shiftKey);
          dragRef.current = start;
          event.currentTarget.setPointerCapture(event.pointerId);
          applyRange(start, next);
        }}
        onPointerMove={(event) => {
          const start = dragRef.current;
          if (!start) return;
          const next = hit(document.elementFromPoint(event.clientX, event.clientY));
          if (!next) return;
          applyRange(start, next);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <thead>
          <tr>
            <th className="artifact-table-corner" aria-hidden />
            {Array.from({ length: maxColumns }, (_, columnIndex) => (
              <th
                key={columnIndex}
                className={
                  props.anchor.type === 'table' &&
                  columnIndex + 1 >= props.anchor.startColumn &&
                  columnIndex + 1 <= props.anchor.endColumn
                    ? 'selected'
                    : ''
                }
              >
                <button
                  type="button"
                  data-table-select="column"
                  data-row="1"
                  data-column={columnIndex + 1}
                  aria-label={`Select column ${columnIndex + 1}`}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    const next = { mode: 'column' as const, row: 1, column: columnIndex + 1 };
                    applyRange(selectionStart(next, event.shiftKey), next);
                  }}
                >
                  {spreadsheetColumnLabel(columnIndex + 1)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th
                className={`artifact-row-header ${
                  props.anchor.type === 'table' &&
                  rowIndex + 1 >= props.anchor.startRow &&
                  rowIndex + 1 <= props.anchor.endRow
                    ? 'selected'
                    : ''
                }`}
              >
                <button
                  type="button"
                  data-table-select="row"
                  data-row={rowIndex + 1}
                  data-column="1"
                  aria-label={`Select row ${rowIndex + 1}`}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    const next = { mode: 'row' as const, row: rowIndex + 1, column: 1 };
                    applyRange(selectionStart(next, event.shiftKey), next);
                  }}
                >
                  {rowIndex + 1}
                </button>
              </th>
              {Array.from({ length: maxColumns }, (_, columnIndex) => (
                <td
                  key={columnIndex}
                  className={selected(rowIndex + 1, columnIndex + 1) ? 'selected' : ''}
                >
                  <button
                    type="button"
                    data-table-select="cell"
                    data-row={rowIndex + 1}
                    data-column={columnIndex + 1}
                    onClick={(event) => {
                      if (event.detail !== 0) return;
                      const next = {
                        mode: 'cell' as const,
                        row: rowIndex + 1,
                        column: columnIndex + 1,
                      };
                      applyRange(selectionStart(next, event.shiftKey), next);
                    }}
                  >
                    {row[columnIndex] || ' '}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 2000 ? (
        <div className="artifact-inline-note">Preview capped at 2,000 rows.</div>
      ) : null}
    </div>
  );
}

function ImageArtifact(props: {
  url: string;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  const region = props.anchor.type === 'image' ? props.anchor.region : undefined;
  return (
    <div className="artifact-image-stage" data-testid="artifact-image-view">
      <div className="artifact-image-frame">
        <img src={props.url} alt="Artifact preview" />
        <RegionPicker
          region={region}
          onRegion={(next) => props.onAnchor({ type: 'image', region: next })}
        />
      </div>
      <p>Drag over the image to attach a normalized region.</p>
    </div>
  );
}

function MediaArtifact(props: {
  kind: 'audio' | 'video';
  url: string;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const [current, setCurrent] = useState(0);
  const start = props.anchor.type === 'media' ? props.anchor.startSeconds : current;
  const end = props.anchor.type === 'media' ? props.anchor.endSeconds : undefined;
  const common = {
    ref: mediaRef as React.Ref<HTMLVideoElement> & React.Ref<HTMLAudioElement>,
    src: props.url,
    controls: true,
    onTimeUpdate: () => setCurrent(mediaRef.current?.currentTime ?? 0),
  };
  return (
    <div className="artifact-media" data-testid="artifact-media-view">
      {props.kind === 'video' ? <video {...common} /> : <audio {...common} />}
      <div className="artifact-media-markers">
        <span>Playhead {current.toFixed(2)}s</span>
        <button
          type="button"
          onClick={() => props.onAnchor({ type: 'media', startSeconds: current })}
        >
          Mark point
        </button>
        <button
          type="button"
          onClick={() =>
            props.onAnchor({
              type: 'media',
              startSeconds: Math.min(start, current),
              endSeconds: Math.max(start, current),
            })
          }
        >
          Mark range end
        </button>
        {end !== undefined ? (
          <span>
            Range {start.toFixed(2)}-{end.toFixed(2)}s
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PdfArtifact(props: {
  url: string;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  return (
    <ArtifactPdfViewer
      url={props.url}
      anchor={props.anchor}
      onAnchor={props.onAnchor}
      renderRegionPicker={(pickerProps) => <RegionPicker {...pickerProps} />}
    />
  );
}

function HtmlArtifact(props: {
  url: string;
  mode: 'safe' | 'interactive';
  onMode: (mode: 'safe' | 'interactive') => void;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (data?.type !== 'charter-artifact-picked' || typeof data.selector !== 'string') return;
      const rawRect = data.rect as
        { x?: number; y?: number; width?: number; height?: number } | undefined;
      const viewport = data.viewport as { width?: number; height?: number } | undefined;
      if (!rawRect || !viewport || !viewport.width || !viewport.height) return;
      props.onAnchor({
        type: 'html',
        selector: data.selector.slice(0, 1000),
        rect: clampRegion({
          x: Number(rawRect.x ?? 0),
          y: Number(rawRect.y ?? 0),
          width: Number(rawRect.width ?? 0.001),
          height: Number(rawRect.height ?? 0.001),
        }),
        viewport: { width: Math.round(viewport.width), height: Math.round(viewport.height) },
        mode: props.mode,
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [props]);
  return (
    <div className="artifact-html" data-testid="artifact-html-view">
      <div className="artifact-html-tools">
        <div className="artifact-segmented">
          <button
            className={props.mode === 'safe' ? 'active' : ''}
            onClick={() => props.onMode('safe')}
          >
            Safe
          </button>
          <button
            className={props.mode === 'interactive' ? 'active' : ''}
            onClick={() => props.onMode('interactive')}
          >
            Interactive
          </button>
        </div>
        <span>Network blocked. Local assets stay inside the task root.</span>
        <button
          type="button"
          onClick={() =>
            frameRef.current?.contentWindow?.postMessage({ type: 'charter-artifact-pick' }, '*')
          }
        >
          Pick element
        </button>
      </div>
      <iframe
        ref={frameRef}
        src={props.url}
        title="Static HTML artifact"
        sandbox={props.mode === 'interactive' ? 'allow-scripts allow-forms' : 'allow-scripts'}
      />
      {props.anchor.type === 'html' ? (
        <div className="artifact-inline-note">Picked {props.anchor.selector}</div>
      ) : null}
    </div>
  );
}

function ArtifactBody(props: {
  opened: ArtifactOpenResultDto;
  htmlMode: 'safe' | 'interactive';
  onHtmlMode: (mode: 'safe' | 'interactive') => void;
  anchor: ArtifactAnchorDto;
  onAnchor: (anchor: ArtifactAnchorDto) => void;
}): React.JSX.Element {
  const { opened } = props;
  const kind = opened.artifact.kind;
  if (kind === 'text') {
    return (
      <TextArtifact
        text={opened.text ?? ''}
        truncated={opened.textTruncated}
        anchor={props.anchor}
        onAnchor={props.onAnchor}
      />
    );
  }
  if (kind === 'table') {
    return (
      <TableArtifact
        text={opened.text ?? ''}
        delimiter={opened.artifact.path.toLowerCase().endsWith('.tsv') ? '\t' : ','}
        anchor={props.anchor}
        onAnchor={props.onAnchor}
      />
    );
  }
  if (kind === 'image' && opened.assetUrl)
    return <ImageArtifact url={opened.assetUrl} anchor={props.anchor} onAnchor={props.onAnchor} />;
  if ((kind === 'audio' || kind === 'video') && opened.assetUrl) {
    return (
      <MediaArtifact
        kind={kind}
        url={opened.assetUrl}
        anchor={props.anchor}
        onAnchor={props.onAnchor}
      />
    );
  }
  if (kind === 'pdf' && opened.assetUrl)
    return <PdfArtifact url={opened.assetUrl} anchor={props.anchor} onAnchor={props.onAnchor} />;
  if (kind === 'html' && opened.assetUrl) {
    return (
      <HtmlArtifact
        url={opened.assetUrl}
        mode={props.htmlMode}
        onMode={props.onHtmlMode}
        anchor={props.anchor}
        onAnchor={props.onAnchor}
      />
    );
  }
  if (kind === 'archive') {
    return (
      <div className="artifact-archive" data-testid="artifact-archive-view">
        {opened.archiveEntries.length > 0 ? (
          opened.archiveEntries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => props.onAnchor({ type: 'archive', innerPath: entry.path })}
            >
              <span>{entry.directory ? 'DIR' : 'FILE'}</span>
              <strong>{entry.path}</strong>
              <small>{formatBytes(entry.sizeBytes)}</small>
            </button>
          ))
        ) : (
          <div className="artifact-empty-copy">
            This archive format has no safe manifest preview. It is never extracted automatically.
          </div>
        )}
        {opened.archiveTruncated ? (
          <div className="artifact-inline-note">Manifest truncated at 2,000 entries.</div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="artifact-binary" data-testid="artifact-binary-view">
      <span>BINARY</span>
      <h3>No executable preview</h3>
      <p>{opened.artifact.mimeType}</p>
      <p>
        {formatBytes(opened.artifact.sizeBytes)}. The file remains available for reveal or OS-level
        opening.
      </p>
    </div>
  );
}

export function SessionArtifactView({
  task,
  focused = false,
}: {
  task: TaskDto;
  focused?: boolean;
}): React.JSX.Element {
  const app = useAppStore();
  const [artifacts, setArtifacts] = useState<ArtifactDescriptorDto[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [opened, setOpened] = useState<ArtifactOpenResultDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlMode, setHtmlMode] = useState<'safe' | 'interactive'>('safe');
  const [anchor, setAnchor] = useState<ArtifactAnchorDto>(EMPTY_ANCHOR);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const selectedArtifact = artifacts.find((artifact) => artifact.path === selectedPath) ?? null;
  const noteKey = opened ? `${opened.artifact.path}:${opened.requestedHash}` : null;
  const note = noteKey ? (notes[noteKey] ?? '') : '';
  const setNote = (value: string): void => {
    if (!noteKey) return;
    setNotes((current) => ({ ...current, [noteKey]: value }));
  };

  const refresh = useCallback(async () => {
    const response = await rpcResult('artifact.list', { taskId: task.id });
    if (!response.ok) {
      setError(response.error.userMessage);
      setLoading(false);
      return;
    }
    setArtifacts(response.data.artifacts);
    setSelectedPath((current) =>
      current && response.data.artifacts.some((artifact) => artifact.path === current)
        ? current
        : (response.data.artifacts[0]?.path ?? null),
    );
    setError(null);
    setLoading(false);
  }, [task.id]);

  useEffect(() => {
    setLoading(true);
    setSelectedHash(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedPath || !selectedArtifact) {
      setOpened(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void rpcResult('artifact.open', {
      taskId: task.id,
      path: selectedPath,
      ...(selectedHash ? { contentHash: selectedHash } : {}),
      htmlMode,
    }).then((response) => {
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        setError(response.error.userMessage);
        return;
      }
      setOpened(response.data);
      setAnchor(response.data.artifact.kind === 'pdf' ? { type: 'pdf', page: 1 } : EMPTY_ANCHOR);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [task.id, selectedPath, selectedHash, selectedArtifact?.contentHash, htmlMode]);

  const addFeedback = async (): Promise<void> => {
    if (!opened) return;
    const noteText = note.trim();
    const ref: ArtifactFeedbackRefDto = {
      id: `artifact_${crypto.randomUUID()}`,
      taskId: task.id,
      path: opened.artifact.path,
      contentHash: opened.requestedHash,
      artifactKind: opened.artifact.kind,
      anchor,
      ...(noteText ? { note: noteText } : {}),
      createdAt: new Date().toISOString(),
    };
    if (task.external) {
      const response = await rpcResult('external.injectContext', {
        taskId: task.id,
        ref: { kind: 'artifact', artifact: ref },
      });
      if (!response.ok) app.pushToast('error', response.error.userMessage);
      else {
        setNote('');
        app.pushToast(
          'info',
          `Artifact context inserted into ${task.external.cli}. Review it and press Enter there.`,
        );
      }
      return;
    }
    const result = useDraftStore.getState().addArtifactRef(task.id, ref);
    if (result === 'limit')
      app.pushToast('warning', 'A reply can include up to four artifact anchors.');
    else if (result === 'duplicate')
      app.pushToast('info', 'That artifact feedback is already attached.');
    else {
      setNote('');
      app.focusComposer();
      app.pushToast('info', 'Artifact context attached to the next reply.');
    }
  };

  if (loading && artifacts.length === 0) {
    return (
      <div className="artifact-loading" data-testid="artifact-loading">
        Indexing Session artifacts...
      </div>
    );
  }
  if (artifacts.length === 0) {
    return (
      <div className="artifact-empty" data-testid="artifact-empty">
        <span>ARTIFACTS</span>
        <h3>No captured files yet</h3>
        <p>Files created or changed by this Session appear here with immutable version history.</p>
        {error ? <small>{error}</small> : null}
      </div>
    );
  }

  return (
    <div
      className={`artifact-browser ${focused ? 'focus' : 'quick'}`}
      data-testid="session-artifact-view"
      data-layout={focused ? 'focus' : 'quick'}
    >
      <aside className="artifact-nav" aria-label="Session artifacts">
        <header>
          <span>SESSION OUTPUT</span>
          <strong>{artifacts.length}</strong>
        </header>
        <div className="artifact-nav-list">
          {artifacts.map((artifact) => (
            <button
              type="button"
              key={artifact.path}
              className={artifact.path === selectedPath ? 'active' : ''}
              data-testid={`artifact-item-${artifact.path}`}
              onClick={() => {
                setSelectedPath(artifact.path);
                setSelectedHash(null);
                setHtmlMode('safe');
              }}
            >
              <span className={`artifact-kind kind-${artifact.kind}`}>
                {kindLabel(artifact.kind)}
              </span>
              <span className="artifact-nav-copy">
                <strong>{artifact.path.split('/').at(-1)}</strong>
                <small>{artifact.path}</small>
              </span>
              <span className="artifact-version-count">v{artifact.currentVersion}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="artifact-main">
        {opened ? (
          <>
            <header className="artifact-toolbar">
              <div>
                <span>{kindLabel(opened.artifact.kind)}</span>
                <strong>{opened.artifact.path}</strong>
                <small>
                  {formatBytes(opened.artifact.sizeBytes)} / {opened.artifact.producer} /{' '}
                  {opened.artifact.captureGrade}
                </small>
              </div>
              <label>
                Version
                <select
                  value={opened.requestedHash}
                  onChange={(event) =>
                    setSelectedHash(
                      event.target.value === opened.artifact.contentHash
                        ? null
                        : event.target.value,
                    )
                  }
                >
                  {opened.versions.map((version) => (
                    <option key={version.contentHash} value={version.contentHash}>
                      v{version.version}
                      {version.isCurrent ? ' current' : ''} - {version.contentHash.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  void rpcResult('artifact.reveal', {
                    taskId: task.id,
                    path: opened.artifact.path,
                    action: 'reveal',
                  })
                }
              >
                Reveal
              </button>
              <button
                type="button"
                onClick={() =>
                  void rpcResult('artifact.reveal', {
                    taskId: task.id,
                    path: opened.artifact.path,
                    action: 'open',
                  })
                }
              >
                Open externally
              </button>
            </header>
            {opened.stale ? (
              <div className="artifact-stale" data-testid="artifact-stale">
                You are viewing an older immutable version. Feedback keeps this hash and will be
                marked stale against the latest file.
                <button type="button" onClick={() => setSelectedHash(null)}>
                  View latest
                </button>
              </div>
            ) : null}
            <div className="artifact-preview-surface">
              <ArtifactBody
                opened={opened}
                htmlMode={htmlMode}
                onHtmlMode={setHtmlMode}
                anchor={anchor}
                onAnchor={setAnchor}
              />
            </div>
            <footer className="artifact-feedback">
              <div className="artifact-review-heading">
                <span>REVIEW INSPECTOR</span>
                <small>Select a range to attach it directly. A note is optional.</small>
              </div>
              {opened.artifact.kind === 'pdf' ? (
                <section className="artifact-health" data-testid="artifact-document-health">
                  <header>
                    <span>DOCUMENT HEALTH</span>
                    <strong className={opened.diagnostics.length > 0 ? 'warning' : 'ok'}>
                      {opened.diagnostics.length > 0 ? 'Needs source fix' : 'Loaded faithfully'}
                    </strong>
                  </header>
                  {opened.diagnostics.length > 0 ? (
                    opened.diagnostics.map((diagnostic) => (
                      <div
                        key={diagnostic.code}
                        className={`artifact-diagnostic ${diagnostic.level}`}
                      >
                        <strong>{diagnostic.title}</strong>
                        <p>{diagnostic.message}</p>
                        {diagnostic.repairHint ? (
                          <button
                            type="button"
                            onClick={() => setNote(diagnostic.repairHint ?? '')}
                          >
                            Use repair request
                          </button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p>
                      PDF.js is rendering the glyphs exactly as stored in this version. It does not
                      rewrite or silently replace the source PDF.
                    </p>
                  )}
                </section>
              ) : null}
              <div className="artifact-anchor-summary">
                <span>ANCHOR</span>
                <strong>{anchorLabel(anchor)}</strong>
                <small>
                  {opened.requestedHash.slice(0, 12)}
                  {opened.stale ? ' / stale version' : ' / current version'}
                </small>
              </div>
              <textarea
                value={note}
                data-testid="artifact-feedback-note"
                placeholder="Optional: describe what should change at this exact location..."
                onChange={(event) => setNote(event.target.value)}
              />
              <button
                type="button"
                data-testid="artifact-feedback-add"
                onClick={() => void addFeedback()}
              >
                {task.external
                  ? `Insert ${anchor.type === 'whole' ? 'artifact' : 'selection'} into ${task.external.cli}`
                  : `Add ${anchor.type === 'whole' ? 'artifact' : 'selection'} to context`}
              </button>
            </footer>
          </>
        ) : (
          <div className="artifact-loading">{error ?? 'Opening artifact...'}</div>
        )}
      </section>
    </div>
  );
}
