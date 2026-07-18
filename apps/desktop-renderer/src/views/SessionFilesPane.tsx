import React, { useEffect, useState } from 'react';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useTaskStore } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { HomeProjectTree } from './HomeProjectTree.js';
import { setDragRef } from './dragRefs.js';
import { addFileRefWithToast, refFromRel } from './roomFileRefs.js';
import { Ic } from './home-icons.js';

/**
 * ADR-0024 (mock B+D): the persistent Files pane in the session rail — the
 * drag source for context feeding. Browsing reuses the lazy project tree;
 * searching routes through search.files and returns flat draggable rows.
 * The hover “+” lands a chip directly in the open room's composer.
 */
export function SessionFilesPane(): React.JSX.Element {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const roomTaskId = useAppStore((s) => s.taskRoomTaskId);
  const task = useTaskStore((s) => (roomTaskId ? s.tasks.find((t) => t.id === roomTaskId) : null));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);

  const sameProject = Boolean(task && workspace && task.projectPath === workspace.path);
  const quickAddTaskId = task && sameProject && !task.external ? task.id : null;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !workspace) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      void rpcResult('search.files', { query: trimmed }).then((res) => {
        if (res.ok) setResults(res.data.items.slice(0, 30).map((item) => item.path));
      });
    }, 80);
    return () => clearTimeout(handle);
  }, [query, workspace]);

  const quickAdd = quickAddTaskId
    ? (rel: string): void => {
        addFileRefWithToast(quickAddTaskId, refFromRel(rel));
      }
    : undefined;

  if (!workspace) {
    return (
      <div className="sr-files-empty" data-testid="session-files-empty">
        Pick a project to browse its files.
      </div>
    );
  }

  return (
    <div className="sr-files-pane" data-testid="session-files-pane">
      <div className="sr-files-project" title={workspace.path}>
        <Ic name="folder" size={13} />
        <strong>{workspace.displayName}</strong>
        <small className="mono">{workspace.path}</small>
      </div>
      <label className="sr-search-box sr-files-search">
        <Ic name="search" size={13} />
        <input
          data-testid="session-files-search"
          value={query}
          placeholder={`Search files in ${workspace.displayName}…`}
          aria-label="Search project files"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="sr-files-scroll">
        {query.trim() ? (
          <div className="sr-files-results" data-testid="session-files-results">
            {results.map((path) => (
              <div
                key={path}
                className="hm-tree-row sr-files-result"
                role="button"
                tabIndex={0}
                title={path}
                draggable
                data-testid={`session-files-hit-${path}`}
                onDragStart={(e) => setDragRef(e, path)}
                onClick={() => quickAdd?.(path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') quickAdd?.(path);
                }}
              >
                <Ic name="file" size={12} />
                <span className="hm-tree-name mono">{path}</span>
                {quickAdd ? (
                  <span className="hm-tree-add" aria-hidden>
                    <Ic name="plus" size={11} />
                  </span>
                ) : null}
              </div>
            ))}
            {results.length === 0 ? (
              <div className="sr-files-empty">No files match “{query.trim()}”.</div>
            ) : null}
          </div>
        ) : (
          <HomeProjectTree
            testid="session-files-tree"
            {...(quickAdd ? { onQuickAdd: quickAdd } : {})}
          />
        )}
      </div>
      <p className="sr-files-tip">
        <Ic name="file" size={12} />
        {quickAddTaskId
          ? 'Drag files, folders or images into the conversation — or tap + to attach.'
          : 'Open a Session of this project, then drag files into its conversation.'}
      </p>
    </div>
  );
}
