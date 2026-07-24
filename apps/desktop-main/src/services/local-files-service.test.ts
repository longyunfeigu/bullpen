import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFilesService } from './local-files-service.js';

describe('LocalFilesService', () => {
  const service = new LocalFilesService();

  it('lists a directory dirs-first with sizes and symlink flags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lfs-'));
    writeFileSync(join(dir, 'b.txt'), 'hello');
    mkdirSync(join(dir, 'a-dir'));
    symlinkSync(join(dir, 'b.txt'), join(dir, 'link.txt'));

    const { path, entries } = await service.list(dir);
    expect(path).toBe(dir);
    expect(entries.map((e) => e.name)).toEqual(['a-dir', 'b.txt', 'link.txt']);
    expect(entries[0]).toMatchObject({ type: 'dir', symlink: false, size: 0 });
    expect(entries[1]).toMatchObject({ type: 'file', symlink: false, size: 5 });
    expect(entries[2]).toMatchObject({ type: 'file', symlink: true });
    // DTO shape matches the remote listing exactly (no local-only fields).
    expect(Object.keys(entries[0]!).sort()).toEqual(['mtimeMs', 'name', 'size', 'symlink', 'type']);
  });

  it('expands ~ and rejects relative paths', async () => {
    const { path } = await service.list('~');
    expect(path).toBe(homedir());
    await expect(service.list('relative/dir')).rejects.toThrow(/absolute/i);
  });

  it('skips unreadable entries instead of failing the listing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lfs-broken-'));
    symlinkSync(join(dir, 'missing-target'), join(dir, 'dangling'));
    writeFileSync(join(dir, 'ok.txt'), 'x');
    const { entries } = await service.list(dir);
    const names = entries.map((e) => e.name);
    expect(names).toContain('ok.txt');
    // The dangling link still shows (lstat succeeds) — flagged as symlink.
    expect(entries.find((e) => e.name === 'dangling')?.symlink).toBe(true);
  });
});
