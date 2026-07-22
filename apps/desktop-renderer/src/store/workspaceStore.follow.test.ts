import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskDto, WorkspaceDto } from '@pi-ide/ipc-contracts';

const rpcResult = vi.hoisted(() => vi.fn());
vi.mock('../bridge.js', () => ({
  rpcResult,
  rpc: vi.fn(),
  onEvent: vi.fn(() => () => {}),
}));

import { useAppStore } from './appStore.js';
import { useTaskStore } from './taskStore.js';
import { useWorkspaceStore } from './workspaceStore.js';

/**
 * ADR-0046 — the session the user enters defines the working context: opening
 * a room for a task from another project moves the workspace (and the rail's
 * Files tree with it) to that project.
 */

function workspace(path: string): WorkspaceDto {
  return { id: 'w1', path, displayName: path.split('/').pop() } as WorkspaceDto;
}

function task(id: string, projectPath: string): TaskDto {
  return { id, projectPath, external: null } as TaskDto;
}

beforeEach(() => {
  rpcResult.mockReset();
  useWorkspaceStore.setState({ workspace: workspace('/u/alpha') });
  useTaskStore.setState({ tasks: [] });
  useAppStore.setState({ homePick: false, toasts: [], taskRoomTaskId: null });
});

describe('workspaceStore.followProject (ADR-0046)', () => {
  it('moves the workspace to the given project with the surface pinned', async () => {
    rpcResult.mockResolvedValue({ ok: true, data: {} });
    await useWorkspaceStore.getState().followProject('/u/beta');
    expect(rpcResult).toHaveBeenCalledWith('workspace.open', { path: '/u/beta' });
    // The pin keeps the open room on screen; workspace.changed releases it.
    expect(useAppStore.getState().homePick).toBe(true);
  });

  it('is a no-op for the current project and for sessions without one', async () => {
    await useWorkspaceStore.getState().followProject('/u/alpha');
    await useWorkspaceStore.getState().followProject(null);
    expect(rpcResult).not.toHaveBeenCalled();
    expect(useAppStore.getState().homePick).toBe(false);
  });

  it('releases the surface pin and surfaces the error when the open fails', async () => {
    rpcResult.mockResolvedValue({
      ok: false,
      error: { userMessage: 'Project folder is gone' },
    });
    await useWorkspaceStore.getState().followProject('/u/beta');
    expect(useAppStore.getState().homePick).toBe(false);
    expect(useAppStore.getState().toasts.map((t) => t.message)).toContain('Project folder is gone');
  });
});

describe('openTaskRoom follows the task project (ADR-0046)', () => {
  it('opening a room for another project moves the workspace there', async () => {
    rpcResult.mockResolvedValue({ ok: true, data: {} });
    useTaskStore.setState({ tasks: [task('t1', '/u/beta')] });
    useAppStore.getState().openTaskRoom('t1');
    expect(useAppStore.getState().taskRoomTaskId).toBe('t1');
    await vi.waitFor(() =>
      expect(rpcResult).toHaveBeenCalledWith('workspace.open', { path: '/u/beta' }),
    );
  });

  it('stays put when the task already lives in the open workspace', async () => {
    useTaskStore.setState({ tasks: [task('t1', '/u/alpha')] });
    useAppStore.getState().openTaskRoom('t1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rpcResult).not.toHaveBeenCalled();
  });
});
