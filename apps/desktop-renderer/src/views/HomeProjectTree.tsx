import React, { useEffect } from 'react';
import type { DirEntryDto } from '@pi-ide/ipc-contracts';
import { useEditorStore } from '../store/editorStore.js';
import { useAppStore } from '../store/appStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { useGlowPaths } from './useGlow.js';
import { Ic } from './home-icons.js';

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
export function HomeProjectTree(): React.JSX.Element {
  const app = useAppStore();
  const editor = useEditorStore();
  const glow = useGlowPaths();
  const dirs = useWorkspaceStore((s) => s.dirs);
  const expanded = useWorkspaceStore((s) => s.expanded);
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand);
  const loadDir = useWorkspaceStore((s) => s.loadDir);

  // Root loads on mount (expanding the project row mounts the tree).
  useEffect(() => {
    if (dirs[''] === undefined) void loadDir('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFile = (path: string): void => {
    void editor.openFile(path);
    app.closeTaskRoom();
    app.setSurface('workspace');
  };

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
      return (
        <React.Fragment key={path}>
          <button
            className={`hm-tree-row ${glow.has(path) ? 'glow-pulse' : ''}`}
            data-testid={`home-tree-${path}`}
            style={{ paddingLeft: 10 + depth * 12 }}
            title={path}
            onClick={() => (isDir ? toggleExpand(path) : openFile(path))}
          >
            <span className={`hm-tree-caret ${isDir ? (isOpen ? 'open' : '') : 'none'}`}>
              {isDir ? <Ic name="chevron" size={11} /> : null}
            </span>
            <Ic name={isDir ? 'folder' : 'file'} size={12} />
            <span className="hm-tree-name">{entry.name}</span>
          </button>
          {isDir && isOpen ? renderDir(path, depth + 1) : null}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="hm-tree" data-testid="home-project-tree">
      {renderDir('', 0)}
    </div>
  );
}
