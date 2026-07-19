import { create } from 'zustand';
import type {
  MemoryAgentsTreeDto,
  MemoryCandidateDto,
  MemoryOverviewDto,
  MemorySyncTarget,
} from '@pi-ide/ipc-contracts';
import { onEvent, rpcResult } from '../bridge.js';
import { okOrToast, useAppStore } from './appStore.js';

/**
 * Project memory (ADR-0028, IA v3): the panel spine is `memory.tree`
 * (agents → global + project groups); Charter project detail loads lazily via
 * `memory.overview`. Every mutation names its project explicitly — the panel
 * never depends on "the currently focused workspace".
 */
interface MemoryStore {
  tree: MemoryAgentsTreeDto | null;
  /** Lazily loaded Charter project detail, keyed by projectPath. */
  projectOverviews: Record<string, MemoryOverviewDto>;
  /** Pending candidates per task (distill cards in the Task Room). */
  taskCandidates: Record<string, MemoryCandidateDto[]>;
  /** projectPath owning each task's candidates (resolve calls need it). */
  taskProjects: Record<string, string | null>;
  loaded: boolean;
  initialized: boolean;

  init(): void;
  refresh(): Promise<void>;
  refreshProject(projectPath: string): Promise<void>;
  refreshTask(taskId: string): Promise<void>;
  addRule(projectPath: string, text: string, group?: string): Promise<boolean>;
  updateRule(
    projectPath: string,
    ruleId: string,
    patch: { text?: string; group?: string; enabled?: boolean },
  ): Promise<void>;
  removeRule(projectPath: string, ruleId: string): Promise<void>;
  resolveCandidate(input: {
    projectPath: string;
    candidateId: string;
    action: 'approve' | 'dismiss';
    editedText?: string;
  }): Promise<boolean>;
  setSyncEnabled(projectPath: string, target: MemorySyncTarget, enabled: boolean): Promise<void>;
  applySync(projectPath: string, target?: MemorySyncTarget): Promise<void>;
  resolveDrift(
    projectPath: string,
    target: MemorySyncTarget,
    action: 'import' | 'overwrite' | 'stop',
  ): Promise<void>;
  scanImport(projectPath: string): Promise<{ text: string; source: 'claude-md' | 'agents-md' }[]>;
  applyImport(
    projectPath: string,
    items: { text: string; source: 'claude-md' | 'agents-md' }[],
  ): Promise<number>;
  readExternal(
    fileId: string,
  ): Promise<{ content: string; truncated: boolean; path: string; mtimeMs: number } | null>;
  writeExternal(fileId: string, content: string, expectedMtimeMs: number | null): Promise<boolean>;
  deleteExternal(fileId: string): Promise<string | null>;
  promoteExternal(projectPath: string, fileId: string): Promise<boolean>;
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  tree: null,
  projectOverviews: {},
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
    const res = await rpcResult('memory.tree', {});
    if (res.ok) set({ tree: res.data, loaded: true });
    // Keep already-expanded Charter groups current.
    for (const projectPath of Object.keys(get().projectOverviews)) {
      void get().refreshProject(projectPath);
    }
  },

  async refreshProject(projectPath) {
    const res = await rpcResult('memory.overview', { projectPath });
    if (!res.ok) return;
    set({ projectOverviews: { ...get().projectOverviews, [projectPath]: res.data } });
  },

  async refreshTask(taskId) {
    const res = await rpcResult('memory.candidates.forTask', { taskId });
    if (!res.ok) return;
    set({
      taskCandidates: { ...get().taskCandidates, [taskId]: res.data.candidates },
      taskProjects: { ...get().taskProjects, [taskId]: res.data.projectPath },
    });
  },

  async addRule(projectPath, text, group) {
    const res = await rpcResult('memory.rules.add', {
      projectPath,
      text,
      ...(group !== undefined ? { group } : {}),
    });
    if (!okOrToast(res)) return false;
    await get().refreshProject(projectPath);
    return true;
  },

  async updateRule(projectPath, ruleId, patch) {
    const res = await rpcResult('memory.rules.update', { projectPath, ruleId, ...patch });
    if (!okOrToast(res)) return;
    await get().refreshProject(projectPath);
  },

  async removeRule(projectPath, ruleId) {
    const res = await rpcResult('memory.rules.remove', { projectPath, ruleId });
    if (!okOrToast(res)) return;
    await get().refreshProject(projectPath);
  },

  async resolveCandidate({ projectPath, candidateId, action, editedText }) {
    const res = await rpcResult('memory.candidates.resolve', {
      projectPath,
      candidateId,
      action,
      ...(editedText !== undefined ? { editedText } : {}),
    });
    if (!okOrToast(res)) return false;
    if (action === 'approve') {
      useAppStore.getState().pushToast('success', 'Distilled into a project rule.');
    }
    await get().refreshProject(projectPath);
    return true;
  },

  async setSyncEnabled(projectPath, target, enabled) {
    const res = await rpcResult('memory.sync.setEnabled', { projectPath, target, enabled });
    if (!okOrToast(res)) return;
    await get().refreshProject(projectPath);
  },

  async applySync(projectPath, target) {
    const res = await rpcResult('memory.sync.apply', {
      projectPath,
      ...(target !== undefined ? { target } : {}),
    });
    if (!okOrToast(res)) return;
    await get().refreshProject(projectPath);
  },

  async resolveDrift(projectPath, target, action) {
    const res = await rpcResult('memory.sync.resolveDrift', { projectPath, target, action });
    if (!okOrToast(res)) return;
    if (action === 'import' && res.data.candidateId) {
      useAppStore.getState().pushToast('success', 'Hand edits moved to candidates for review.');
    }
    await get().refreshProject(projectPath);
  },

  async scanImport(projectPath) {
    const res = await rpcResult('memory.import.scan', { projectPath });
    if (!okOrToast(res)) return [];
    return res.data.items;
  },

  async applyImport(projectPath, items) {
    if (items.length === 0) return 0;
    const res = await rpcResult('memory.import.apply', { projectPath, items });
    if (!okOrToast(res)) return 0;
    await get().refreshProject(projectPath);
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

  async promoteExternal(projectPath, fileId) {
    const res = await rpcResult('memory.external.promote', { projectPath, fileId });
    if (!okOrToast(res)) return false;
    useAppStore.getState().pushToast('success', 'Copied into rule candidates (one-way).');
    await get().refresh();
    await get().refreshProject(projectPath);
    return true;
  },
}));
