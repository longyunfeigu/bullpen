import { watch, type FSWatcher } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';

export interface FsChange {
  kind: 'created' | 'modified' | 'deleted';
  relativePath: string;
  isDirectory: boolean;
}

export type FsBatchListener = (changes: FsChange[]) => void;

/**
 * WS-008: recursive watcher over the workspace root (fs.watch recursive is native
 * on macOS/Windows; on Linux we fall back to watching the root level only and
 * refreshing coarsely — documented degradation).
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private readonly listeners = new Set<FsBatchListener>();
  private pending = new Map<string, FsChange>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly root: string) {}

  start(): void {
    const recursive = process.platform === 'darwin' || process.platform === 'win32';
    try {
      this.watcher = watch(this.root, { recursive, persistent: false }, (_event, filename) => {
        if (!filename || this.disposed) return;
        const rel = filename.toString().split('\\').join('/');
        if (rel.startsWith('.git/') || rel === '.git') return;
        void this.classify(rel);
      });
    } catch {
      this.watcher = null; // watching is best-effort; manual refresh still works
    }
  }

  private async classify(rel: string): Promise<void> {
    let kind: FsChange['kind'];
    let isDirectory = false;
    try {
      const stat = await fs.stat(join(this.root, rel));
      isDirectory = stat.isDirectory();
      kind = this.pending.has(rel) ? this.pending.get(rel)!.kind : 'modified';
      // A stat success after a rename event usually means created-or-modified;
      // we cannot distinguish reliably, so report modified unless brand new.
      kind = kind === 'deleted' ? 'created' : kind;
    } catch {
      kind = 'deleted';
    }
    this.pending.set(rel, { kind, relativePath: rel, isDirectory });
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 120);
    }
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pending.size === 0) return;
    const changes = [...this.pending.values()];
    this.pending = new Map();
    for (const listener of this.listeners) listener(changes);
  }

  onBatch(listener: FsBatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
  }

  relativeOf(absolutePath: string): string {
    return relative(this.root, absolutePath).split('\\').join('/');
  }
}
