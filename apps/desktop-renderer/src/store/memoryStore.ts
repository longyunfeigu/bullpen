import { create } from 'zustand';
import type {
  ExternalMemoryFileDto,
  MemoryCandidateDto,
  MemoryOverviewDto,
  MemorySyncTarget,
} from '@pi-ide/ipc-contracts';
import { onEvent, rpcResult } from '../bridge.js';
import { okOrToast, useAppStore } from './appStore.js';
import { useWorkspaceStore } from './workspaceStore.js';

/**
 * Project memory (ADR-0028): the memory panel + distill cards. `refresh()`
 * re-reads .charter/rules.md through main, so hand edits show up on the next
 * pull; `memory.changed` broadcasts keep every open surface current.
 */
interface MemoryStore {
  overview: MemoryOverviewDto | null;
  external: ExternalMemoryFileDto[];
  /** Pending candidates per task (distill cards in the Task Room). */
  taskCandidates: Record<string, MemoryCandidateDto[]>;
  /** projectPath owning each task's candidates (resolve calls need it). */
  taskProjects: Record<string, string | null>;
  loaded: boolean;
  initialized: boolean;

  init(): void;
  refresh(): Promise<void>;
  refreshTask(taskId: string): Promise<void>;
  addRule(text: string, group?: string): Promise<boolean>;
  updateRule(
    ruleId: string,
    patch: { text?: string; group?: string; enabled?: boolean },
  ): Promise<void>;
  removeRule(ruleId: string): Promise<void>;
  resolveCandidate(input: {
    candidateId: string;
    action: 'approve' | 'dismiss';
    editedText?: string;
    projectPath?: string;
  }): Promise<boolean>;
  setSyncEnabled(target: MemorySyncTarget, enabled: boolean): Promise<void>;
  applySync(target?: MemorySyncTarget): Promise<void>;
  resolveDrift(target: MemorySyncTarget, action: 'import' | 'overwrite' | 'stop'): Promise<void>;
  scanImport(): Promise<{ text: string; source: 'claude-md' | 'agents-md' }[]>;
  applyImport(items: { text: string; source: 'claude-md' | 'agents-md' }[]): Promise<number>;
  readExternal(
    fileId: string,
  ): Promise<{ content: string; truncated: boolean; path: string; mtimeMs: number } | null>;
  writeExternal(fileId: string, content: string, expectedMtimeMs: number | null): Promise<boolean>;
  deleteExternal(fileId: string): Promise<string | null>;
  promoteExternal(fileId: string): Promise<boolean>;
}

function currentProjectPath(): string | null {
  return useWorkspaceStore.getState().workspace?.path ?? null;
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  overview: null,
  external: [],
  taskCandidates: {},
  taskProjects: {},
  loaded: false,
  initialized: false,

  init() {
    if (get().initialized) return;
    set({ initialized: true });
    onEvent('memory.changed', () => {
      void get().refresh();
      for (const taskId of Object.keys(get().taskCandidates)) void get().refreshTask(taskId);
    });
    onEvent('workspace.changed', () => void get().refresh());
    void get().refresh();
  },

  async refresh() {
    const projectPath = currentProjectPath();
    // Global CLI files stay browsable without a project — '/' munges to a
    // nonexistent Claude project dir, so only home-level files come back.
    const externalPath = projectPath ?? '/';
    const [overviewRes, externalRes] = await Promise.all([
      projectPath ? rpcResult('memory.overview', { projectPath }) : Promise.resolve(null),
      rpcResult('memory.external.list', { projectPath: externalPath }),
    ]);
    set({
      ...(overviewRes === null
        ? { overview: null }
        : overviewRes.ok
          ? { overview: overviewRes.data }
          : {}),
      ...(externalRes.ok ? { external: externalRes.data.files } : {}),
      loaded: true,
    });
  },

  async refreshTask(taskId) {
    const res = await rpcResult('memory.candidates.forTask', { taskId });
    if (!res.ok) return;
    set({
      taskCandidates: { ...get().taskCandidates, [taskId]: res.data.candidates },
      taskProjects: { ...get().taskProjects, [taskId]: res.data.projectPath },
    });
  },

  async addRule(text, group) {
    const projectPath = get().overview?.projectPath ?? currentProjectPath();
    if (!projectPath) return false;
    const res = await rpcResult('memory.rules.add', {
      projectPath,
      text,
      ...(group !== undefined ? { group } : {}),
    });
    if (!okOrToast(res)) return false;
    await get().refresh();
    return true;
  },

  async updateRule(ruleId, patch) {
    const projectPath = get().overview?.projectPath;
    if (!projectPath) return;
    const res = await rpcResult('memory.rules.update', { projectPath, ruleId, ...patch });
    if (!okOrToast(res)) return;
    await get().refresh();
  },

  async removeRule(ruleId) {
    const projectPath = get().overview?.projectPath;
    if (!projectPath) return;
    const res = await rpcResult('memory.rules.remove', { projectPath, ruleId });
    if (!okOrToast(res)) return;
    await get().refresh();
  },

  async resolveCandidate({ candidateId, action, editedText, projectPath }) {
    const path = projectPath ?? get().overview?.projectPath ?? currentProjectPath();
    if (!path) return false;
    const res = await rpcResult('memory.candidates.resolve', {
      projectPath: path,
      candidateId,
      action,
      ...(editedText !== undefined ? { editedText } : {}),
    });
    if (!okOrToast(res)) return false;
    if (action === 'approve') {
      useAppStore.getState().pushToast('success', 'Distilled into a project rule.');
    }
    await get().refresh();
    return true;
  },

  async setSyncEnabled(target, enabled) {
    const projectPath = get().overview?.projectPath;
    if (!projectPath) return;
    const res = await rpcResult('memory.sync.setEnabled', { projectPath, target, enabled });
    if (!okOrToast(res)) return;
    await get().refresh();
  },

  async applySync(target) {
    const projectPath = get().overview?.projectPath;
    if (!projectPath) return;
    const res = await rpcResult('memory.sync.apply', {
      projectPath,
      ...(target !== undefined ? { target } : {}),
    });
    if (!okOrToast(res)) return;
    await get().refresh();
  },

  async resolveDrift(target, action) {
    const projectPath = get().overview?.projectPath;
    if (!projectPath) return;
    const res = await rpcResult('memory.sync.resolveDrift', { projectPath, target, action });
    if (!okOrToast(res)) return;
    if (action === 'import' && res.data.candidateId) {
      useAppStore.getState().pushToast('success', 'Hand edits moved to candidates for review.');
    }
    await get().refresh();
  },

  async scanImport() {
    const projectPath = get().overview?.projectPath;
    if (!projectPath) return [];
    const res = await rpcResult('memory.import.scan', { projectPath });
    if (!okOrToast(res)) return [];
    return res.data.items;
  },

  async applyImport(items) {
    const projectPath = get().overview?.projectPath;
    if (!projectPath || items.length === 0) return 0;
    const res = await rpcResult('memory.import.apply', { projectPath, items });
    if (!okOrToast(res)) return 0;
    await get().refresh();
    return res.data.added;
  },

  async readExternal(fileId) {
    const res = await rpcResult('memory.external.read', { fileId });
    if (!okOrToast(res)) return null;
    return res.data;
  },

  async writeExternal(fileId, content, expectedMtimeMs) {
    const res = await rpcResult('memory.external.write', { fileId, content, expectedMtimeMs });
    if (!okOrToast(res)) return false;
    await get().refresh();
    return true;
  },

  async deleteExternal(fileId) {
    const res = await rpcResult('memory.external.delete', { fileId });
    if (!okOrToast(res)) return null;
    useAppStore.getState().pushToast('success', `Deleted — backup kept at ${res.data.backedUpTo}`);
    await get().refresh();
    return res.data.backedUpTo;
  },

  async promoteExternal(fileId) {
    const projectPath = get().overview?.projectPath ?? currentProjectPath();
    if (!projectPath) {
      useAppStore.getState().pushToast('warning', 'Open a project first — rules are per-project.');
      return false;
    }
    const res = await rpcResult('memory.external.promote', { projectPath, fileId });
    if (!okOrToast(res)) return false;
    useAppStore.getState().pushToast('success', 'Copied into rule candidates (one-way).');
    await get().refresh();
    return true;
  },
}));
