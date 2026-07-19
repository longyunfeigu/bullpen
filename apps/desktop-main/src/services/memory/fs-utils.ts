/** Shared fs helpers for project memory (ADR-0028). Main-process only. */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Durable atomic write (same-dir tmp → fsync → rename), the document-store
 * model: user-owned files (.charter/rules.md, CLAUDE.md, AGENTS.md, external
 * memory notes) must never be left half-written.
 */
export function writeFileAtomicDurable(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = join(dirname(absPath), `.charter-tmp-${process.pid}-${Date.now()}`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, absPath);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best effort tmp cleanup
    }
    throw error;
  }
}

export function isInsidePath(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`);
}
