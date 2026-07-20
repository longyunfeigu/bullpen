import type { ScreenshotCaptureDto, TaskDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useTaskStore } from '../store/taskStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { addFileRefWithToast } from './roomFileRefs.js';

/**
 * ADR-0036: quick-card action routing. The precedent is addCodeContext
 * (codeContext.ts) — one gesture, two delivery paths, decided by the active
 * Session: managed Pi Sessions get a composer chip via the attachment store
 * (ADR-0024), external CLI Sessions (Claude Code / Codex) get an @-reference
 * placed in their own input line (ADR-0030). Because @-references are
 * project-relative by contract, the external path first copies the screenshot
 * into assets/screenshots/. With no active Session the screenshot still lands
 * in assets and is queued for the next Home charter (pendingRefs).
 */

export type FeedRoute =
  | { kind: 'pi'; taskId: string }
  | { kind: 'external'; taskId: string; cli: string }
  | { kind: 'none' };

/** Pure route resolution — external Sessions from another project fall back
 * to 'none' (an @-reference is only meaningful relative to the open project). */
export function resolveFeedRoute(
  activeTaskId: string | null,
  tasks: readonly TaskDto[],
  workspacePath: string | null,
): FeedRoute {
  const task = activeTaskId ? tasks.find((item) => item.id === activeTaskId) : undefined;
  if (!task) return { kind: 'none' };
  if (!task.external) return { kind: 'pi', taskId: task.id };
  if (task.external.status !== 'active' || workspacePath !== task.projectPath) {
    return { kind: 'none' };
  }
  return { kind: 'external', taskId: task.id, cli: task.external.cli };
}

export function currentFeedRoute(): FeedRoute {
  return resolveFeedRoute(
    useAppStore.getState().taskRoomTaskId,
    useTaskStore.getState().tasks,
    useWorkspaceStore.getState().workspace?.path ?? null,
  );
}

/** "Screenshot X.png" → "Screenshot X.annotated.png" (assets/import display name). */
export function annotatedName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.annotated.png`;
}

type FeedSource =
  | { kind: 'path'; path: string; name: string }
  | { kind: 'bytes'; dataBase64: string; name: string };

async function saveToAssets(source: FeedSource): Promise<{ relPath: string; name: string } | null> {
  const res = await rpcResult('screenshot.saveToAssets', {
    source:
      source.kind === 'path'
        ? { kind: 'path', path: source.path }
        : { kind: 'bytes', dataBase64: source.dataBase64, name: source.name },
  });
  if (!res.ok) {
    useAppStore.getState().pushToast('warning', res.error.userMessage);
    return null;
  }
  return res.data;
}

async function feed(source: FeedSource): Promise<boolean> {
  const app = useAppStore.getState();
  const route = currentFeedRoute();

  if (route.kind === 'pi') {
    const res = await rpcResult('task.attachments.import', {
      taskId: route.taskId,
      source:
        source.kind === 'path'
          ? { kind: 'path', path: source.path }
          : {
              kind: 'bytes',
              dataBase64: source.dataBase64,
              name: source.name,
              mimeType: 'image/png',
            },
    });
    if (!res.ok) {
      app.pushToast('warning', res.error.userMessage);
      return false;
    }
    const added = addFileRefWithToast(route.taskId, {
      id: crypto.randomUUID(),
      kind: 'image',
      attachmentId: res.data.attachmentId,
      name: res.data.name,
      sizeBytes: res.data.sizeBytes,
      ...(res.data.thumbDataUrl ? { thumbDataUrl: res.data.thumbDataUrl } : {}),
    });
    if (added) {
      app.pushToast('success', `“${res.data.name}” attached — send your next message with it.`);
      app.focusComposer();
    }
    return added;
  }

  if (route.kind === 'external') {
    const saved = await saveToAssets(source);
    if (!saved) return false;
    const injected = await rpcResult('external.injectContext', {
      taskId: route.taskId,
      ref: { kind: 'file', path: saved.relPath, isFolder: false },
    });
    if (!injected.ok) {
      app.pushToast('warning', injected.error.userMessage);
      return false;
    }
    app.pushToast(
      'success',
      `Screenshot placed in ${route.cli}’s input line — press Enter there to send it.`,
    );
    return true;
  }

  // No active Session: keep the capture anyway and queue it for the next charter.
  const saved = await saveToAssets(source);
  if (!saved) return false;
  app.addPendingRefs([saved.relPath]);
  app.pushToast('success', `Saved to ${saved.relPath} — it will ride your next new Session.`);
  return true;
}

/** Quick-card primary action: feed the screenshot file to the active agent. */
export function feedScreenshot(capture: ScreenshotCaptureDto): Promise<boolean> {
  return feed({ kind: 'path', path: capture.path, name: capture.name });
}

/** Annotator hand-off: feed the exported PNG (original file stays untouched). */
export function feedAnnotatedScreenshot(
  capture: ScreenshotCaptureDto,
  dataBase64: string,
): Promise<boolean> {
  return feed({ kind: 'bytes', dataBase64, name: annotatedName(capture.name) });
}

/** Quick-card tertiary action: archive into assets/ without touching the conversation. */
export async function saveScreenshotToProject(capture: ScreenshotCaptureDto): Promise<boolean> {
  const saved = await saveToAssets({ kind: 'path', path: capture.path, name: capture.name });
  if (!saved) return false;
  useAppStore.getState().pushToast('success', `Saved to ${saved.relPath}.`);
  return true;
}

/** Annotator "save only" action. */
export async function saveAnnotatedToProject(
  capture: ScreenshotCaptureDto,
  dataBase64: string,
): Promise<boolean> {
  const saved = await saveToAssets({
    kind: 'bytes',
    dataBase64,
    name: annotatedName(capture.name),
  });
  if (!saved) return false;
  useAppStore.getState().pushToast('success', `Saved to ${saved.relPath}.`);
  return true;
}
