import { readdir, stat, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { SftpEntry } from '@pi-ide/ipc-contracts';

/** Response cap mirrors ssh.localList's schema bound. */
const MAX_ENTRIES = 5000;

/**
 * Local side of the dual-pane Files panel (ADR-0047). Directory *metadata*
 * only — names, sizes, mtimes; file contents never cross this service. The
 * renderer is sandboxed and cannot read the disk itself; this is the same
 * user-facing browsing capability an OS file dialog exposes.
 */
export class LocalFilesService {
  home(): string {
    return homedir();
  }

  /** List a directory, dirs first — same shape and ordering as the remote
   * SFTP listing so both panes render identically. */
  async list(path: string): Promise<{ path: string; entries: SftpEntry[] }> {
    const resolved = this.resolvePath(path);
    const names = await readdir(resolved);
    const entries: SftpEntry[] = [];
    for (const name of names.slice(0, MAX_ENTRIES)) {
      const full = join(resolved, name);
      try {
        const link = await lstat(full);
        const symlink = link.isSymbolicLink();
        // Broken symlinks still list (as 'other') instead of vanishing.
        const info = symlink ? await stat(full).catch(() => link) : link;
        entries.push({
          name,
          type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other',
          symlink,
          size: info.isFile() ? info.size : 0,
          mtimeMs: Number.isFinite(info.mtimeMs) ? info.mtimeMs : null,
        });
      } catch {
        // Unreadable entry (permissions, race) — skip rather than fail the dir.
      }
    }
    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
    return { path: resolved, entries };
  }

  /** Expand ~, require absolute, normalize. Relative paths are rejected so a
   * listing can never depend on the main process cwd. */
  private resolvePath(path: string): string {
    const expanded =
      path === '~'
        ? homedir()
        : path.startsWith(`~${sep}`) || path.startsWith('~/')
          ? join(homedir(), path.slice(2))
          : path;
    if (!isAbsolute(expanded)) throw new Error('Local path must be absolute');
    return resolve(expanded);
  }
}
