import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductFailure } from '@pi-ide/foundation';
import { openWorkspaceInfo, listDirectory, resolveInsideRoot } from './workspace.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-ide-ws-'));
  mkdirSync(join(root, 'src/deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'src/a.ts'), 'a');
  writeFileSync(join(root, 'src/deep/b.ts'), 'b');
  writeFileSync(join(root, 'README.md'), 'readme');
  writeFileSync(join(root, 'node_modules/pkg/index.js'), 'x');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('workspace open (WS-001/002/015)', () => {
  it('resolves canonical path and detects git and pi resources', async () => {
    const info = await openWorkspaceInfo(root);
    expect(info.canonicalPath.length).toBeGreaterThan(0);
    expect(info.isGitRepo).toBe(true);
    expect(info.hasPiProjectResources).toBe(false);
    mkdirSync(join(root, '.pi'));
    const info2 = await openWorkspaceInfo(root);
    expect(info2.hasPiProjectResources).toBe(true);
  });

  it('rejects missing directories with a structured error', async () => {
    await expect(openWorkspaceInfo(join(root, 'nope'))).rejects.toThrowError(ProductFailure);
  });

  it('rejects files (not directories)', async () => {
    await expect(openWorkspaceInfo(join(root, 'README.md'))).rejects.toThrowError(ProductFailure);
  });
});

describe('directory listing with ignore rules (WS-003/004)', () => {
  it('hides default-ignored entries and orders directories first', async () => {
    const entries = await listDirectory(root, '', { showIgnored: false, extraIgnores: [] });
    const names = entries.map((e) => e.name);
    expect(names).toContain('src');
    expect(names).toContain('README.md');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
    expect(entries[0]!.kind).toBe('dir');
  });

  it('can reveal ignored entries marked as ignored', async () => {
    const entries = await listDirectory(root, '', { showIgnored: true, extraIgnores: [] });
    const nm = entries.find((e) => e.name === 'node_modules');
    expect(nm).toBeTruthy();
    expect(nm!.ignored).toBe(true);
  });

  it('applies user-provided ignore globs', async () => {
    const entries = await listDirectory(root, 'src', {
      showIgnored: false,
      extraIgnores: ['**/*.md', 'deep'],
    });
    expect(entries.map((e) => e.name)).toEqual(['a.ts']);
  });
});

describe('path boundary (WS-010)', () => {
  it('rejects traversal and absolute escapes', async () => {
    await expect(resolveInsideRoot(root, '../etc/passwd')).rejects.toThrowError(ProductFailure);
    await expect(resolveInsideRoot(root, '/etc/passwd')).rejects.toThrowError(ProductFailure);
    await expect(resolveInsideRoot(root, 'src/../../x')).rejects.toThrowError(ProductFailure);
    const ok = await resolveInsideRoot(root, 'src/a.ts');
    expect(ok.endsWith('src/a.ts')).toBe(true);
  });

  it('rejects symlinks whose real target escapes the root', async () => {
    symlinkSync(tmpdir(), join(root, 'link-out'));
    await expect(resolveInsideRoot(root, 'link-out/secret.txt')).rejects.toThrowError(
      ProductFailure,
    );
  });

  it('rejects NUL bytes', async () => {
    await expect(resolveInsideRoot(root, 'a\u0000b')).rejects.toThrowError(ProductFailure);
  });
});
