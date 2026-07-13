import React from 'react';
import { useAppStore } from '../store/appStore.js';
import { useEditorStore } from '../store/editorStore.js';

/** Open a workspace-relative file in the editor, surfacing the IDE (PIVOT-015). */
export function openWorkspaceFile(path: string): void {
  useAppStore.getState().setSurface('workspace');
  void useEditorStore.getState().openFile(path);
}

/** Clickable mono chips for workspace-relative paths in timeline/report cards. */
export function PathChips(props: {
  paths: string[];
  testidPrefix?: string;
}): React.JSX.Element | null {
  if (props.paths.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
      {props.paths.slice(0, 8).map((path) => (
        <button
          key={path}
          className="mono"
          data-testid={`${props.testidPrefix ?? 'path-link'}-${path}`}
          title={`Open ${path}`}
          onClick={(e) => {
            e.stopPropagation();
            openWorkspaceFile(path);
          }}
          style={{
            fontSize: 10.5,
            border: '1px solid var(--border)',
            background: 'var(--bg-hover)',
            color: 'var(--fg)',
            borderRadius: 5,
            padding: '1px 6px',
            cursor: 'pointer',
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {path}
        </button>
      ))}
    </div>
  );
}
