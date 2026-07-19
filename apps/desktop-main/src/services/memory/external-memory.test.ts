import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductFailure } from '@pi-ide/foundation';
import { claudeProjectDirName } from '../cli-session-locator.js';
import { ExternalMemoryStore } from './external-memory.js';

let home: string;
let project: string;
let trash: string;
let store: ExternalMemoryStore;

function claudeMemoryDir(): string {
  // The store munges the project's realpath, exactly like Claude Code does.
  let real = project;
  try {
    real = realpathSync(project);
  } catch {
    // keep literal
  }
  return join(home, '.claude', 'projects', claudeProjectDirName(real), 'memory');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pi-ide-memhome-'));
  project = mkdtempSync(join(tmpdir(), 'pi-ide-memproj-'));
  trash = join(home, 'trash');
  store = new ExternalMemoryStore({ homeDir: home, trashDir: trash });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('ExternalMemoryStore (ADR-0028)', () => {
  it('discovers global instruction files and project auto-memory via the munged path', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# global claude\n');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'AGENTS.md'), '# global codex\n');
    const memDir = claudeMemoryDir();
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'MEMORY.md'), '# Memory Index\n- [x](a.md)\n');
    writeFileSync(join(memDir, 'deploy.md'), '---\nname: deploy\n---\nRun release:verify first.\n');

    const files = store.list(project);
    const byLabel = new Map(files.map((file) => [file.label, file]));
    expect(byLabel.get('CLAUDE.md')).toMatchObject({
      agent: 'claude',
      scope: 'global',
      role: 'instructions',
    });
    expect(byLabel.get('AGENTS.md')).toMatchObject({ agent: 'codex', scope: 'global' });
    expect(byLabel.get('MEMORY.md')).toMatchObject({ role: 'memory-index', scope: 'project' });
    expect(byLabel.get('deploy.md')).toMatchObject({ role: 'memory' });
    // Frontmatter is stripped from the summary.
    expect(byLabel.get('deploy.md')?.summary).toContain('release:verify');
  });

  it('is honestly empty when nothing exists', () => {
    expect(store.list(project)).toEqual([]);
  });

  it('read returns content; write is guarded by mtime conflict detection', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'original\n');
    const [file] = store.list(project);
    expect(file).toBeDefined();
    const read = store.read(file!.id);
    expect(read.content).toBe('original\n');
    expect(read.truncated).toBe(false);

    // Stale expectation → conflict, nothing written.
    expect(() => store.write(file!.id, 'clobber\n', read.mtimeMs - 5000)).toThrow(ProductFailure);
    expect(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe('original\n');

    // Fresh expectation → written.
    store.write(file!.id, 'edited\n', read.mtimeMs);
    expect(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe('edited\n');
  });

  it('binary files are flagged unreadable and refuse read/promote', () => {
    const memDir = claudeMemoryDir();
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'blob.md'), Buffer.from([0x61, 0x00, 0x62]));
    const files = store.list(project);
    const blob = files.find((file) => file.label === 'blob.md');
    expect(blob?.readable).toBe(false);
    expect(() => store.read(blob!.id)).toThrow(ProductFailure);
    expect(() => store.readForPromote(blob!.id)).toThrow(ProductFailure);
  });

  it('delete backs up first, then removes', () => {
    const memDir = claudeMemoryDir();
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'note.md'), 'precious\n');
    const files = store.list(project);
    const note = files.find((file) => file.label === 'note.md');
    const { backedUpTo } = store.delete(note!.id);
    expect(backedUpTo).toContain('note.md');
    expect(existsSync(join(memDir, 'note.md'))).toBe(false);
    const backups = readdirSync(trash);
    expect(backups.some((name) => name.endsWith('note.md'))).toBe(true);
    expect(readFileSync(join(trash, backups[0]!), 'utf8')).toBe('precious\n');
  });

  it('symlinks escaping the agent root are skipped, fail closed', () => {
    const outside = join(home, 'outside.md');
    writeFileSync(outside, 'secret\n');
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(outside, join(home, '.claude', 'CLAUDE.md'));
    const files = store.list(project);
    expect(files.find((file) => file.label === 'CLAUDE.md')).toBeUndefined();
  });

  it('unknown file ids are rejected (paths never come from callers)', () => {
    expect(() => store.read('deadbeef00000000')).toThrow(ProductFailure);
    expect(() => store.delete('deadbeef00000000')).toThrow(ProductFailure);
  });

  it('listAll discovers every Claude project group, resolving known workspaces by munge', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# global\n');
    // Known workspace → matched group with its display name.
    const knownDir = claudeMemoryDir();
    mkdirSync(knownDir, { recursive: true });
    writeFileSync(join(knownDir, 'a.md'), 'known note\n');
    // Foreign dir Claude knows but Charter never opened → raw munged name.
    const foreign = join(home, '.claude', 'projects', '-Users-nobody-legacy-app', 'memory');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'b.md'), 'foreign note\n');
    // A projects dir without memory/ is not a group.
    mkdirSync(join(home, '.claude', 'projects', '-Users-empty-proj'), { recursive: true });

    const tree = store.listAll([{ path: project, displayName: 'my-project' }]);
    expect(tree.claudeGlobal).toHaveLength(1);
    expect(tree.claudeProjects).toHaveLength(2);
    // Matched groups sort before foreign ones.
    expect(tree.claudeProjects[0]).toMatchObject({
      displayName: 'my-project',
      projectPath: project,
    });
    expect(tree.claudeProjects[0]?.files[0]?.label).toBe('a.md');
    expect(tree.claudeProjects[1]).toMatchObject({
      displayName: '-Users-nobody-legacy-app',
      projectPath: null,
    });
  });

  it('promote strips frontmatter and caps the body', () => {
    const memDir = claudeMemoryDir();
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, 'conv.md'),
      '---\nname: conv\n---\nAlways wrap REST errors in AppError.\n',
    );
    const files = store.list(project);
    const conv = files.find((file) => file.label === 'conv.md');
    const { text } = store.readForPromote(conv!.id);
    expect(text).toBe('Always wrap REST errors in AppError.');
  });
});
