import { create } from 'zustand';
import type { DirEntryDto, WorkspaceDto } from '@pi-ide/ipc-contracts';
import { onEvent, rpcResult } from '../bridge.js';
import { useAppStore } from './appStore.js';

interface WorkspaceStore {
  workspace: WorkspaceDto | null;
  showIgnored: boolean;
  dirs: Record<string, DirEntryDto[] | undefined>;
  expanded: Record<string, boolean>;
  treeVersion: number;
  trustPromptVisible: boolean;
  selection: string | null;

  init(): Promise<void>;
  openViaDialog(): Promise<void>;
  openPath(path: string): Promise<void>;
  closeWorkspace(): Promise<void>;
  setTrust(trusted: boolean): Promise<void>;
  loadDir(dir: string): Promise<void>;
  toggleExpand(dir: string): void;
  setShowIgnored(show: boolean): void;
  refreshAll(): void;
  setSelection(path: string | null): void;
  dismissTrustPrompt(): void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspace: null,
  showIgnored: false,
  dirs: {},
  expanded: {},
  treeVersion: 0,
  trustPromptVisible: false,
  selection: null,

  async init() {
    onEvent('workspace.changed', ({ workspace }) => {
      const previous = get().workspace;
      set({
        workspace,
        dirs: {},
        expanded: {},
        treeVersion: get().treeVersion + 1,
        trustPromptVisible: Boolean(
          workspace &&
          workspace.hasPiProjectResources &&
          workspace.trustState === 'untrusted' &&
          previous?.id !== workspace.id,
        ),
      });
      if (workspace) void get().loadDir('');
    });
    onEvent('fs.batch', ({ changes }) => {
      const { dirs } = get();
      const invalidate = new Set<string>();
      for (const change of changes) {
        const parent = change.relativePath.includes('/')
          ? change.relativePath.slice(0, change.relativePath.lastIndexOf('/'))
          : '';
        if (dirs[parent] !== undefined) invalidate.add(parent);
        if (
          change.isDirectory &&
          dirs[change.relativePath] !== undefined &&
          change.kind === 'deleted'
        ) {
          invalidate.add(change.relativePath);
        }
      }
      for (const dir of invalidate) void get().loadDir(dir);
    });
    const current = await rpcResult('workspace.current', {});
    if (current.ok && current.data.workspace && !get().workspace) {
      const workspace = current.data.workspace;
      set({
        workspace,
        trustPromptVisible: Boolean(
          workspace.hasPiProjectResources && workspace.trustState === 'untrusted',
        ),
      });
      void get().loadDir('');
      const { useEditorStore } = await import('./editorStore.js');
      void useEditorStore.getState().restoreTabs();
    }
  },

  async openViaDialog() {
    const result = await rpcResult('workspace.pickAndOpen', {});
    if (!result.ok) {
      useAppStore.getState().pushToast('error', result.error.userMessage);
    }
  },

  async openPath(path: string) {
    const result = await rpcResult('workspace.open', { path });
    if (!result.ok) {
      useAppStore.getState().pushToast('error', `${result.error.userMessage}`);
    }
  },

  async closeWorkspace() {
    await rpcResult('workspace.close', {});
  },

  async setTrust(trusted: boolean) {
    const result = await rpcResult('workspace.setTrust', { trusted });
    if (result.ok) {
      set({ trustPromptVisible: false });
      useAppStore
        .getState()
        .pushToast(
          trusted ? 'warning' : 'info',
          trusted
            ? 'Project Pi resources will be available to agent sessions in this workspace.'
            : 'Project stays untrusted: local Pi extensions/skills are not loaded.',
        );
    }
  },

  async loadDir(dir: string) {
    const result = await rpcResult('fs.listDir', { dir, showIgnored: get().showIgnored });
    if (result.ok) {
      set({
        dirs: { ...get().dirs, [dir]: result.data.entries },
        treeVersion: get().treeVersion + 1,
      });
    }
  },

  toggleExpand(dir: string) {
    const expanded = { ...get().expanded, [dir]: !get().expanded[dir] };
    set({ expanded, treeVersion: get().treeVersion + 1 });
    if (expanded[dir] && get().dirs[dir] === undefined) void get().loadDir(dir);
  },

  setShowIgnored(show: boolean) {
    set({ showIgnored: show, dirs: {} });
    void get().loadDir('');
    for (const dir of Object.keys(get().expanded)) {
      if (get().expanded[dir]) void get().loadDir(dir);
    }
  },

  refreshAll() {
    const { expanded } = get();
    set({ dirs: {} });
    void get().loadDir('');
    for (const dir of Object.keys(expanded)) {
      if (expanded[dir]) void get().loadDir(dir);
    }
  },

  setSelection(path) {
    set({ selection: path });
  },
  dismissTrustPrompt() {
    set({ trustPromptVisible: false });
  },
}));
