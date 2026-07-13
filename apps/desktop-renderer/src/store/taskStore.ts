import { create } from 'zustand';
import type { ModelDescriptorDto, TaskDto, TimelineEventDto } from '@pi-ide/ipc-contracts';
import { onEvent, rpcResult } from '../bridge.js';
import { useAppStore } from './appStore.js';

export interface StreamingMessage {
  runId: string;
  messageId: string;
  text: string;
}

interface TaskStore {
  tasks: TaskDto[];
  activeTaskId: string | null;
  timeline: TimelineEventDto[];
  streaming: StreamingMessage | null;
  models: ModelDescriptorDto[];
  workerAlive: boolean;
  newTaskOpen: boolean;
  loadingTimeline: boolean;
  initialized: boolean;

  init(): void;
  refreshTasks(): Promise<void>;
  refreshModels(): Promise<void>;
  openTask(taskId: string): Promise<void>;
  setNewTaskOpen(open: boolean): void;
  createAndStart(input: {
    title: string;
    goalMd: string;
    acceptance: string[];
    mode: 'ask' | 'edit' | 'auto';
    model: { providerId: string; modelId: string };
  }): Promise<boolean>;
  send(text: string, during: 'steer' | 'followUp'): Promise<void>;
  stop(): Promise<void>;
  decidePermission(input: {
    requestId: string;
    kind: 'allow' | 'deny';
    scope: 'once' | 'task' | 'workspace' | 'always';
    expectedParamsHash: string;
    reason?: string;
    applyToSimilar?: boolean;
  }): Promise<void>;
  answerUser(callId: string, answer: string): Promise<void>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTaskId: null,
  timeline: [],
  streaming: null,
  models: [],
  workerAlive: false,
  newTaskOpen: false,
  loadingTimeline: false,
  initialized: false,

  init() {
    if (get().initialized) return;
    set({ initialized: true });

    onEvent('task.event', ({ taskId, event }) => {
      if (taskId !== get().activeTaskId) return;
      const timeline = get().timeline;
      // Ephemeral events have sequence 0; persisted ones are monotonic.
      if (event.sequence > 0 && timeline.some((e) => e.id === event.id)) return;
      const next = [...timeline, event].sort((a, b) =>
        a.sequence === 0 || b.sequence === 0 ? 0 : a.sequence - b.sequence,
      );
      // Completed agent message replaces the streaming bubble.
      const patch: Partial<TaskStore> = { timeline: next };
      if (event.type === 'agent.message') patch.streaming = null;
      set(patch as never);
    });
    onEvent('task.stream', ({ taskId, runId, messageId, delta }) => {
      if (taskId !== get().activeTaskId) return;
      const current = get().streaming;
      set({
        streaming:
          current && current.messageId === messageId
            ? { ...current, text: current.text + delta }
            : { runId, messageId, text: delta },
      });
    });
    onEvent('task.stateChanged', ({ taskId, state }) => {
      set({
        tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, state } : t)),
      });
      if (state === 'REVIEW_READY' || state === 'FAILED' || state === 'INTERRUPTED') {
        set({ streaming: null });
      }
      void get().refreshTasks();
    });
    onEvent('agent.workerStatus', ({ alive }) => set({ workerAlive: alive }));
    onEvent('workspace.changed', () => {
      set({ tasks: [], activeTaskId: null, timeline: [], streaming: null });
      void get().refreshTasks();
    });
    void get().refreshTasks();
  },

  async refreshTasks() {
    const res = await rpcResult('task.list', { filter: 'all', includeArchived: false });
    if (res.ok) set({ tasks: res.data.tasks });
  },

  async refreshModels() {
    const res = await rpcResult('models.list', {});
    if (res.ok) set({ models: res.data.models, workerAlive: res.data.workerAlive });
  },

  async openTask(taskId) {
    set({ activeTaskId: taskId, timeline: [], streaming: null, loadingTimeline: true });
    const res = await rpcResult('task.get', { taskId, eventsAfter: 0 });
    if (res.ok) {
      set({ timeline: res.data.timeline, loadingTimeline: false });
      const tasks = get().tasks;
      if (!tasks.some((t) => t.id === taskId)) set({ tasks: [res.data.task, ...tasks] });
    } else {
      set({ loadingTimeline: false });
    }
  },

  setNewTaskOpen(open) {
    set({ newTaskOpen: open });
  },

  async createAndStart(input) {
    const create = await rpcResult('task.create', {
      title: input.title,
      goalMd: input.goalMd,
      acceptance: input.acceptance,
      mode: input.mode,
      model: input.model,
      verification: [],
    });
    if (!create.ok) {
      useAppStore.getState().pushToast('error', create.error.userMessage);
      return false;
    }
    const task = create.data.task;
    set({ newTaskOpen: false });
    await get().openTask(task.id);
    await get().refreshTasks();
    const start = await rpcResult('task.start', { taskId: task.id });
    if (!start.ok) {
      useAppStore.getState().pushToast('error', start.error.userMessage);
      return false;
    }
    if (start.data.queued) {
      useAppStore.getState().pushToast('info', 'Queued: another agent run is active.');
    }
    return true;
  },

  async send(text, during) {
    const taskId = get().activeTaskId;
    if (!taskId) return;
    const res = await rpcResult('task.message', { taskId, text, during });
    if (!res.ok) useAppStore.getState().pushToast('error', res.error.userMessage);
  },

  async stop() {
    const taskId = get().activeTaskId;
    if (!taskId) return;
    await rpcResult('task.stop', { taskId });
  },

  async decidePermission(input) {
    const res = await rpcResult('task.permissionDecision', {
      requestId: input.requestId,
      kind: input.kind,
      scope: input.scope,
      expectedParamsHash: input.expectedParamsHash,
      ...(input.reason ? { reason: input.reason } : {}),
      applyToSimilar: input.applyToSimilar ?? false,
    });
    if (!res.ok) {
      useAppStore.getState().pushToast('error', res.error.userMessage);
    } else if (res.data.resolvedRequestIds.length === 0) {
      useAppStore
        .getState()
        .pushToast('info', 'That approval is no longer valid — the request was refreshed.');
    }
  },

  async answerUser(callId, answer) {
    const res = await rpcResult('task.answerUser', { callId, answer });
    if (!res.ok) useAppStore.getState().pushToast('error', res.error.userMessage);
    else if (!res.data.ok)
      useAppStore.getState().pushToast('info', 'This question is no longer waiting.');
  },
}));

export function activeTask(state: TaskStore): TaskDto | null {
  return state.tasks.find((t) => t.id === state.activeTaskId) ?? null;
}

export const RUNNING_TASK_STATES = new Set([
  'EXPLORING',
  'PLANNING',
  'IN_PROGRESS',
  'AWAITING_PERMISSION',
  'VERIFYING',
]);
