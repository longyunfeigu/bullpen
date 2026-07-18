import type React from 'react';
import type { FileContextRefDto } from '@pi-ide/ipc-contracts';
import { pathForDroppedFile, rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useDraftStore } from '../store/draftStore.js';
import { readDragRef } from './dragRefs.js';

/**
 * ADR-0024: shared landing logic for Room context feeding. One code path turns
 * tree drags, @-picker picks, OS drops and clipboard pastes into fileRefs
 * chips; out-of-project images are imported into the task's attachment store.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

function refId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function baseName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.split('/').pop() ?? trimmed;
}

/** A workspace-relative payload (tree drag / @ pick) → chip ref. Directories
 * arrive with a trailing "/" (dragRefs contract). */
export function refFromRel(rel: string): FileContextRefDto {
  const isFolder = rel.endsWith('/');
  const path = isFolder ? rel.slice(0, -1) : rel;
  return {
    id: refId(),
    kind: isFolder ? 'folder' : IMAGE_EXT.test(path) ? 'image' : 'file',
    path,
    name: baseName(path),
  };
}

type AddResult = 'added' | 'duplicate' | 'limit' | 'image-limit';

/** Adds one chip and narrates rejections (dedupe, caps) through toasts. */
export function addFileRefWithToast(taskId: string, ref: FileContextRefDto): boolean {
  const result: AddResult = useDraftStore.getState().addFileRef(taskId, ref);
  const toast = useAppStore.getState().pushToast;
  if (result === 'duplicate') toast('info', `“${ref.name}” is already attached.`);
  else if (result === 'limit') toast('warning', 'Reference limit reached (12 per message).');
  else if (result === 'image-limit') toast('warning', 'Image limit reached (4 per message).');
  return result === 'added';
}

async function importExternalImage(
  taskId: string,
  source:
    | { kind: 'path'; path: string }
    | { kind: 'bytes'; dataBase64: string; name: string; mimeType: string },
): Promise<boolean> {
  const res = await rpcResult('task.attachments.import', { taskId, source });
  if (!res.ok) {
    useAppStore.getState().pushToast('warning', res.error.userMessage);
    return false;
  }
  return addFileRefWithToast(taskId, {
    id: refId(),
    kind: 'image',
    attachmentId: res.data.attachmentId,
    name: res.data.name,
    sizeBytes: res.data.sizeBytes,
    ...(res.data.thumbDataUrl ? { thumbDataUrl: res.data.thumbDataUrl } : {}),
  });
}

/** OS drop payload → chips. In-project paths become path refs (folder kind via
 * the directory entry), out-of-project images are imported, everything else is
 * rejected with an explanation (ADR-0024 phase-1 scope). */
export async function addDroppedOsFiles(taskId: string, e: React.DragEvent): Promise<void> {
  const toast = useAppStore.getState().pushToast;
  const items = Array.from(e.dataTransfer.items ?? []).filter((item) => item.kind === 'file');
  const dropped: Array<{ abs: string; isDirectory: boolean }> = [];
  for (const item of items) {
    const file = item.getAsFile();
    if (!file) continue;
    const abs = pathForDroppedFile(file);
    if (!abs) continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    dropped.push({ abs, isDirectory: entry?.isDirectory ?? false });
  }
  if (dropped.length === 0) return;

  const res = await rpcResult('workspace.relativize', {
    paths: dropped.slice(0, 50).map((d) => d.abs),
  });
  if (!res.ok) {
    toast('error', res.error.userMessage);
    return;
  }

  const byAbs = new Map(dropped.map((d) => [d.abs, d]));
  for (const inside of res.data.inside) {
    const isDirectory = byAbs.get(inside.abs)?.isDirectory ?? false;
    addFileRefWithToast(taskId, refFromRel(isDirectory ? `${inside.rel}/` : inside.rel));
  }

  let rejected = 0;
  for (const abs of res.data.outside) {
    const meta = byAbs.get(abs);
    if (meta?.isDirectory || !IMAGE_EXT.test(abs)) {
      rejected += 1;
      continue;
    }
    await importExternalImage(taskId, { kind: 'path', path: abs });
  }
  if (rejected > 0) {
    toast(
      'warning',
      `${rejected} item(s) outside the project were skipped — only images can be attached from outside (move other files into the project first).`,
    );
  }
}

/** Full Room drop handler: internal tree payloads first, then OS files. */
export async function handleRoomDrop(
  taskId: string,
  sameProject: boolean,
  e: React.DragEvent,
): Promise<void> {
  const rel = readDragRef(e);
  if (rel) {
    if (!sameProject) {
      useAppStore
        .getState()
        .pushToast('warning', 'Open this task’s project to attach its files by path.');
      return;
    }
    addFileRefWithToast(taskId, refFromRel(rel));
    return;
  }
  await addDroppedOsFiles(taskId, e);
}

/** Clipboard paste → image chips (screenshots). Returns true when the paste
 * carried at least one image (the caller then prevents the text insertion). */
export function handleComposerPaste(taskId: string, e: React.ClipboardEvent): boolean {
  const images = Array.from(e.clipboardData?.items ?? []).filter((item) =>
    item.type.startsWith('image/'),
  );
  if (images.length === 0) return false;
  let sequence = 0;
  for (const item of images) {
    const file = item.getAsFile();
    if (!file) continue;
    sequence += 1;
    const fallbackName = `pasted-image-${new Date()
      .toISOString()
      .slice(11, 19)
      .replaceAll(':', '.')}${sequence > 1 ? `-${sequence}` : ''}.png`;
    const name = file.name && file.name !== 'image.png' ? file.name : fallbackName;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (!dataBase64) return;
      void importExternalImage(taskId, {
        kind: 'bytes',
        dataBase64,
        name,
        mimeType: file.type || 'image/png',
      });
    };
    reader.readAsDataURL(file);
  }
  return true;
}
