import React, { useEffect } from 'react';
import type { DirEntryDto } from '@pi-ide/ipc-contracts';
import { useEditorStore } from '../store/editorStore.js';
import { useAppStore } from '../store/appStore.js';
import { useTaskStore } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { useGitStatusStore, MARK_COLOR } from '../store/gitStatusStore.js';
import { useGlowPaths } from './useGlow.js';
import { Ic } from './home-icons.js';
import { setDragRef } from './dragRefs.js';

const MAX_ENTRIES = 200;

/**
 * Lightweight lazy file tree under the ACTIVE project row on Home. Directories
 * expand in place; clicking a file opens it in the Editor. Only the selected
 * project can expand (the engine reads one workspace at a time).
 *
 * Data source is the shared workspaceStore (same as the Editor explorer), so
 * `fs.batch` watcher events refresh this tree live — agent-created files
 * appear as they are written and glow while the change is fresh (PIVOT-016).
 */
export function HomeProjectTree(props: {
  /** Distinct testid when mounted outside Home (session Files pane, ADR-0024). */
  testid?: string;
  /** ADR-0024: hover “+” — attach a workspace-relative ref (dirs get a trailing /). */
  onQuickAdd?: (rel: string) => void;
}): React.JSX.Element {
  const app = useAppStore();
  const editor = useEditorStore();
  const glow = useGlowPaths();
  const dirs = useWorkspaceStore((s) => s.dirs);
  const expanded = useWorkspaceStore((s) => s.expanded);
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand);
  const loadDir = useWorkspaceStore((s) => s.loadDir);
  const gitMarks = useGitStatusStore((s) => s.byPath);

  // Root loads on mount (expanding the project row mounts the tree).
  useEffect(() => {
    if (dirs[''] === undefined) void loadDir('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFile = (path: string, e?: React.MouseEvent): void => {
    // PIVOT-027r (ADR-0014): while a room of THIS project is open, a plain
    // click peeks beside the conversation; ⌘/alt-click keeps the Editor jump.
    const explicit = e ? e.metaKey || e.altKey || e.ctrlKey : false;
    const roomTaskId = app.taskRoomTaskId;
    if (!explicit && roomTaskId) {
      const task = useTaskStore.getState().tasks.find((t) => t.id === roomTaskId);
      const focused = useWorkspaceStore.getState().workspace?.path;
      if (task && task.projectPath === focused) {
        app.openPeek(task.id, path, 'file');
        return;
      }
    }
    void editor.openFile(path);
    app.closeTaskRoom();
    app.setProjectTool('files');
  };

  const treeTestid = props.testid ?? 'home-project-tree';
  const rowTestidPrefix = treeTestid === 'home-project-tree' ? 'home-tree' : treeTestid;

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const raw = dirs[dir];
    if (!raw) {
      return (
        <div className="hm-tree-loading" style={{ paddingLeft: 26 + depth * 12 }}>
          Loading…
        </div>
      );
    }
    const entries = raw
      .filter((e: DirEntryDto) => (e.kind === 'file' || e.kind === 'dir') && !e.ignored)
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
      )
      .slice(0, MAX_ENTRIES);
    return entries.map((entry) => {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      const isDir = entry.kind === 'dir';
      const isOpen = Boolean(expanded[path]);
      const relPayload = isDir ? `${path}/` : path;
      return (
        <React.Fragment key={path}>
          <div
            role="button"
            tabIndex={0}
            className={`hm-tree-row ${glow.has(path) ? 'glow-pulse' : ''}`}
            data-testid={`${rowTestidPrefix}-${path}`}
            style={{ paddingLeft: 10 + depth * 12 }}
            title={path}
            draggable
            onDragStart={(e) => setDragRef(e, relPayload)}
            onClick={(e) => (isDir ? toggleExpand(path) : openFile(path, e))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (isDir) toggleExpand(path);
                else openFile(path);
              }
            }}
          >
            <span className={`hm-tree-caret ${isDir ? (isOpen ? 'open' : '') : 'none'}`}>
              {isDir ? <Ic name="chevron" size={11} /> : null}
            </span>
            <Ic name={isDir ? 'folder' : 'file'} size={12} />
            <span
              className="hm-tree-name"
              style={!isDir && gitMarks[path] ? { color: MARK_COLOR[gitMarks[path]!] } : undefined}
            >
              {entry.name}
            </span>
            {!isDir && gitMarks[path] ? (
              <span
                className="mono hm-tree-mark"
                data-testid={`${rowTestidPrefix}-mark-${path}`}
                style={{
                  color: MARK_COLOR[gitMarks[path]!],
                  fontSize: 9.5,
                  fontWeight: 700,
                  marginLeft: 'auto',
                  paddingRight: 2,
                }}
              >
                {gitMarks[path]}
              </span>
            ) : null}
            {props.onQuickAdd ? (
              <button
                type="button"
                className="hm-tree-add"
                aria-label={`Attach ${path} to the conversation`}
                data-testid={`${rowTestidPrefix}-add-${path}`}
                title="Attach to the conversation"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onQuickAdd?.(relPayload);
                }}
              >
                <Ic name="plus" size={11} />
              </button>
            ) : null}
          </div>
          {isDir && isOpen ? renderDir(path, depth + 1) : null}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="hm-tree" data-testid={treeTestid}>
      {renderDir('', 0)}
    </div>
  );
}
