import { create } from 'zustand';
import { onEvent, rpcResult } from '../bridge.js';

/**
 * Workspace git status for decorations (ADR-0013): explorer rows, tabs and
 * gutters read one shared, watcher-refreshed snapshot (same visual language
 * as VS Code: A green, M amber, D red, U green-untracked, C conflict).
 */

export type GitMark = 'A' | 'M' | 'D' | 'U' | 'R' | 'C';

export const MARK_COLOR: Record<GitMark, string> = {
  A: 'var(--success)',
  U: 'var(--success)',
  M: 'var(--warning)',
  R: 'var(--info)',
  D: 'var(--danger)',
  C: 'var(--danger)',
};

interface GitStatusStore {
  isRepo: boolean;
  /** workspace-relative path → mark */
  byPath: Record<string, GitMark>;
  /** directories that contain at least one marked file */
  dirty: Record<string, true>;
  /** bumps on every refresh — gutter recompute trigger */
  version: number;
  initialized: boolean;
  init(): void;
  refresh(): Promise<void>;
}

function markOf(entry: {
  group: 'staged' | 'changes' | 'untracked' | 'conflict';
  indexState: string;
  workState: string;
}): GitMark {
  if (entry.group === 'conflict') return 'C';
  if (entry.group === 'untracked') return 'U';
  const s = (entry.workState.trim() || entry.indexState.trim()).toUpperCase();
  if (s.startsWith('A')) return 'A';
  if (s.startsWith('D')) return 'D';
  if (s.startsWith('R')) return 'R';
  return 'M';
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useGitStatusStore = create<GitStatusStore>((set, get) => ({
  isRepo: false,
  byPath: {},
  dirty: {},
  version: 0,
  initialized: false,

  init() {
    if (get().initialized) return;
    set({ initialized: true });
    onEvent('workspace.changed', () => {
      set({ byPath: {}, dirty: {}, isRepo: false });
      void get().refresh();
    });
    // Watcher events debounce into one status refresh.
    onEvent('fs.batch', () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void get().refresh();
      }, 400);
    });
    void get().refresh();
  },

  async refresh() {
    const res = await rpcResult('git.status', {});
    if (!res.ok || !res.data.isRepo) {
      if (get().isRepo || Object.keys(get().byPath).length > 0) {
        set({ isRepo: false, byPath: {}, dirty: {}, version: get().version + 1 });
      }
      return;
    }
    const byPath: Record<string, GitMark> = {};
    const dirty: Record<string, true> = {};
    for (const entry of res.data.entries) {
      byPath[entry.path] = markOf(entry);
      let dir = entry.path;
      while (dir.includes('/')) {
        dir = dir.slice(0, dir.lastIndexOf('/'));
        dirty[dir] = true;
      }
    }
    set({ isRepo: true, byPath, dirty, version: get().version + 1 });
  },
}));
