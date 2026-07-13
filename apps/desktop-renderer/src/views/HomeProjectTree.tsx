import React, { useCallback, useEffect, useState } from 'react';
import type { DirEntryDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useEditorStore } from '../store/editorStore.js';
import { useAppStore } from '../store/appStore.js';
import { useGlowPaths } from './useGlow.js';
import { Ic } from './home-icons.js';

const MAX_ENTRIES = 200;

/**
 * Lightweight lazy file tree under the ACTIVE project row on Home. Directories
 * expand in place; clicking a file opens it in the Editor. Only the selected
 * project can expand (the engine reads one workspace at a time).
 */
export function HomeProjectTree(): React.JSX.Element {
  const app = useAppStore();
  const editor = useEditorStore();
  const glow = useGlowPaths();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, DirEntryDto[]>>({});

  const load = useCallback(async (dir: string): Promise<void> => {
    const res = await rpcResult('fs.listDir', { dir, showIgnored: false });
    if (res.ok) {
      const sorted = [...res.data.entries]
        .filter((e) => e.kind === 'file' || e.kind === 'dir')
        .sort((a, b) =>
          a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
        )
        .slice(0, MAX_ENTRIES);
      setChildren((prev) => ({ ...prev, [dir]: sorted }));
    }
  }, []);

  // Root loads on mount (expanding the project row mounts the tree).
  useEffect(() => {
    void load('');
  }, [load]);

  const toggle = useCallback(
    (dir: string): void => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) {
          next.delete(dir);
        } else {
          next.add(dir);
          if (!children[dir]) void load(dir);
        }
        return next;
      });
    },
    [children, load],
  );

  const openFile = (path: string): void => {
    void editor.openFile(path);
    app.closeTaskRoom();
    app.setSurface('workspace');
  };

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const entries = children[dir];
    if (!entries) {
      return (
        <div className="hm-tree-loading" style={{ paddingLeft: 26 + depth * 12 }}>
          Loading…
        </div>
      );
    }
    return entries.map((entry) => {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      const isDir = entry.kind === 'dir';
      const isOpen = expanded.has(path);
      return (
        <React.Fragment key={path}>
          <button
            className={`hm-tree-row ${glow.has(path) ? 'glow-pulse' : ''}`}
            data-testid={`home-tree-${path}`}
            style={{ paddingLeft: 10 + depth * 12 }}
            title={path}
            onClick={() => (isDir ? toggle(path) : openFile(path))}
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
