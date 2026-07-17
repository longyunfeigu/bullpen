import type { CodeContextRefDto } from '@pi-ide/ipc-contracts';
import { useAppStore } from './store/appStore.js';
import { useDraftStore } from './store/draftStore.js';

export type CodeContextCapture = Omit<
  CodeContextRefDto,
  'id' | 'createdAt' | 'selectionHash' | 'language' | 'contentHash'
> & {
  language?: string;
  contentHash?: string | null;
};

export function languageForCodePath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const languages: Record<string, string> = {
    c: 'c',
    cjs: 'javascript',
    cpp: 'cpp',
    css: 'css',
    go: 'go',
    h: 'c',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    kt: 'kotlin',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    scss: 'scss',
    sh: 'shell',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'typescript',
    vue: 'html',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension] ?? 'plaintext';
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function refId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `code-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Capture and enqueue one exact source selection for the Session's next turn. */
export async function createCodeContextRef(
  capture: CodeContextCapture,
): Promise<CodeContextRefDto | null> {
  const text = capture.text.replace(/\r\n/gu, '\n');
  if (!text.trim()) return null;
  return {
    ...capture,
    text,
    id: refId(),
    createdAt: new Date().toISOString(),
    selectionHash: await sha256(text),
    language: capture.language ?? languageForCodePath(capture.path),
    contentHash: capture.contentHash ?? null,
  };
}

/** Capture and enqueue one exact source selection for the Session's next turn. */
export async function addCodeContext(
  taskId: string,
  capture: CodeContextCapture,
): Promise<CodeContextRefDto | null> {
  const ref = await createCodeContextRef(capture);
  if (!ref) return null;
  const result = useDraftStore.getState().addCodeRef(taskId, ref);
  const app = useAppStore.getState();
  if (result === 'duplicate') {
    app.pushToast('info', 'That exact code selection is already attached.');
    return null;
  }
  if (result === 'limit') {
    app.pushToast('warning', 'A turn can carry up to 6 code selections.');
    return null;
  }
  if (result === 'too-large') {
    app.pushToast('warning', 'The attached code snapshots exceed the 48,000 character limit.');
    return null;
  }
  app.pushToast(
    'success',
    `Added ${capture.path}:${capture.startLine}${capture.endLine === capture.startLine ? '' : `–${capture.endLine}`} to context.`,
  );
  app.focusComposer();
  return ref;
}

export function codeContextRangeLabel(ref: CodeContextRefDto): string {
  return ref.startLine === ref.endLine ? `L${ref.startLine}` : `L${ref.startLine}–${ref.endLine}`;
}

export function codeContextOriginLabel(origin: CodeContextRefDto['origin']): string {
  const labels: Record<CodeContextRefDto['origin'], string> = {
    diff: 'Diff',
    'file-peek': 'File Peek',
    editor: 'Editor',
    search: 'Search',
    review: 'Review',
  };
  return labels[origin];
}
