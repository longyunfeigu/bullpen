import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductFailure } from '@pi-ide/foundation';
import { DocumentStore } from './document-store.js';

let root: string;
let store: DocumentStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-ide-doc-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/a.ts'), 'const a = 1;\n');
  store = new DocumentStore(root, { largeFileBytes: 1024 * 1024 });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('DocumentStore (spec §6.4)', () => {
  it('opens a document with revision, hash, eol and clean state', async () => {
    const doc = await store.open('src/a.ts');
    expect(doc.content).toBe('const a = 1;\n');
    expect(doc.dirty).toBe(false);
    expect(doc.eol).toBe('lf');
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.diskRevision).toBe(1);
    expect(doc.bufferRevision).toBe(1);
  });

  it('buffer edits bump bufferRevision and mark dirty; save persists atomically', async () => {
    await store.open('src/a.ts');
    const updated = store.updateBuffer('src/a.ts', 'const a = 2;\n');
    expect(updated.dirty).toBe(true);
    expect(updated.bufferRevision).toBe(2);

    const saved = await store.save('src/a.ts');
    expect(saved.dirty).toBe(false);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('const a = 2;\n');
    expect(saved.diskRevision).toBeGreaterThan(1);
  });

  it('external change on a clean buffer reloads content', async () => {
    await store.open('src/a.ts');
    writeFileSync(join(root, 'src/a.ts'), 'external\n');
    const state = await store.handleExternalChange('src/a.ts');
    expect(state?.externalState).toBe('clean');
    expect(state?.content).toBe('external\n');
  });

  it('external change on a dirty buffer flags conflict and never overwrites the buffer (WS-009)', async () => {
    await store.open('src/a.ts');
    store.updateBuffer('src/a.ts', 'user work in progress\n');
    writeFileSync(join(root, 'src/a.ts'), 'external change\n');
    const state = await store.handleExternalChange('src/a.ts');
    expect(state?.externalState).toBe('externallyModified');
    expect(state?.content).toBe('user work in progress\n');
    // Saving now must fail with a conflict, not overwrite silently.
    await expect(store.save('src/a.ts')).rejects.toThrowError(ProductFailure);
    try {
      await store.save('src/a.ts');
    } catch (e) {
      expect((e as ProductFailure).error.code).toBe('DOC_SAVE_CONFLICT');
    }
    // Disk content is untouched.
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('external change\n');
  });

  it('conflict resolution: reload takes disk, keep keeps buffer and allows explicit save', async () => {
    await store.open('src/a.ts');
    store.updateBuffer('src/a.ts', 'mine\n');
    writeFileSync(join(root, 'src/a.ts'), 'theirs\n');
    await store.handleExternalChange('src/a.ts');

    const kept = await store.resolveExternal('src/a.ts', 'keep');
    expect(kept.content).toBe('mine\n');
    expect(kept.externalState).toBe('clean');
    const saved = await store.save('src/a.ts');
    expect(saved.dirty).toBe(false);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('mine\n');
  });

  it('external delete of a dirty buffer is flagged, not silently dropped', async () => {
    await store.open('src/a.ts');
    store.updateBuffer('src/a.ts', 'unsaved\n');
    rmSync(join(root, 'src/a.ts'));
    const state = await store.handleExternalChange('src/a.ts');
    expect(state?.externalState).toBe('externallyDeleted');
    expect(state?.content).toBe('unsaved\n');
  });

  it('detects binary files and refuses text open with metadata instead', async () => {
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x50, 0x00, 0x01, 0x02]));
    const doc = await store.open('bin.dat');
    expect(doc.binary).toBe(true);
    expect(doc.content).toBe('');
  });

  it('flags large files for degraded mode (ED-009)', async () => {
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(2 * 1024 * 1024));
    const doc = await store.open('big.txt');
    expect(doc.largeFile).toBe(true);
    expect(doc.content.length).toBeGreaterThan(0); // still editable text
  });

  it('preserves CRLF on save and supports changing EOL', async () => {
    writeFileSync(join(root, 'win.txt'), 'a\r\nb\r\n');
    const doc = await store.open('win.txt');
    expect(doc.eol).toBe('crlf');
    store.updateBuffer('win.txt', 'a\r\nb\r\nc\r\n');
    await store.save('win.txt');
    expect(readFileSync(join(root, 'win.txt'), 'utf8')).toBe('a\r\nb\r\nc\r\n');

    const changed = store.setEol('win.txt', 'lf');
    expect(changed.eol).toBe('lf');
    await store.save('win.txt');
    expect(readFileSync(join(root, 'win.txt'), 'utf8')).toBe('a\nb\nc\n');
  });

  it('rejects paths escaping the workspace root', async () => {
    await expect(store.open('../outside.txt')).rejects.toThrowError(ProductFailure);
    try {
      await store.open('../outside.txt');
    } catch (e) {
      expect((e as ProductFailure).error.code).toBe('WS_PATH_ESCAPE');
    }
  });

  it('save suppression window lets the watcher ignore our own writes', async () => {
    await store.open('src/a.ts');
    store.updateBuffer('src/a.ts', 'v2\n');
    await store.save('src/a.ts');
    expect(store.isOwnWrite('src/a.ts')).toBe(true);
    const state = await store.handleExternalChange('src/a.ts');
    expect(state).toBeNull(); // own write, no external event surfaced
    expect(store.isOwnWrite('src/a.ts')).toBe(false);
  });
});
