import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProductFailure } from '@pi-ide/foundation';
import { DocumentStore } from '@pi-ide/document-service';
import { BlobStore } from './blob-store.js';
import { ChangeService, InMemoryChangeRepo } from './change-service.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

let root: string;
let blobDir: string;
let service: ChangeService;
let repo: InMemoryChangeRepo;
let docs: DocumentStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-ide-chg-'));
  blobDir = mkdtempSync(join(tmpdir(), 'pi-ide-blob-'));
  writeFileSync(join(root, 'a.txt'), 'line1\nline2\nline3\n');
  writeFileSync(join(root, 'crlf.txt'), 'one\r\ntwo\r\n');
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'nested/deep.txt'), 'deep\n');
  docs = new DocumentStore(root, {});
  repo = new InMemoryChangeRepo();
  service = new ChangeService({
    root,
    blobs: new BlobStore(blobDir),
    repo,
    documents: docs,
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(blobDir, { recursive: true, force: true });
});

describe('BlobStore', () => {
  it('stores and retrieves content-addressed blobs idempotently', async () => {
    const store = new BlobStore(blobDir);
    const a = await store.put(Buffer.from('hello'));
    const b = await store.put(Buffer.from('hello'));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(sha('hello'));
    expect((await store.get(a.hash))!.toString()).toBe('hello');
    expect(await store.get('0'.repeat(64))).toBeNull();
  });
});

describe('baseline capture (CHG-001)', () => {
  it('captures bytes, mode and existence exactly once per task+path', async () => {
    chmodSync(join(root, 'a.txt'), 0o755);
    const first = await service.ensureBaseline('t1', 'a.txt');
    expect(first.existed).toBe(true);
    expect(first.blobHash).toBe(sha('line1\nline2\nline3\n'));
    expect((first.mode! & 0o777).toString(8)).toBe('755');

    writeFileSync(join(root, 'a.txt'), 'changed\n');
    const second = await service.ensureBaseline('t1', 'a.txt');
    expect(second.blobHash).toBe(first.blobHash); // still the original capture

    const missing = await service.ensureBaseline('t1', 'not-yet.txt');
    expect(missing.existed).toBe(false);
    expect(missing.blobHash).toBeNull();
  });
});

describe('patch engine (CHG-002/003)', () => {
  it('applies a unified patch when the base hash matches and records the change', async () => {
    const before = readFileSync(join(root, 'a.txt'), 'utf8');
    const result = await service.applyPatch('t1', 'call1', {
      path: 'a.txt',
      patch: '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3\n',
      baseHash: sha(before),
      reason: 'test',
    });
    expect(result.afterHash).toBe(sha('line1\nLINE2\nline3\n'));
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('line1\nLINE2\nline3\n');
    const changes = repo.changesFor('t1');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('modified');
    expect(changes[0]!.beforeHash).toBe(sha(before));
  });

  it('rejects stale base hashes with VERSION_CONFLICT and leaves the file untouched', async () => {
    const original = readFileSync(join(root, 'a.txt'), 'utf8');
    await expect(
      service.applyPatch('t1', 'call1', {
        path: 'a.txt',
        patch: '--- a\n+++ b\n@@ -1,1 +1,1 @@\n-line1\n+X\n',
        baseHash: 'f'.repeat(64),
        reason: 'stale',
      }),
    ).rejects.toThrowError(ProductFailure);
    try {
      await service.applyPatch('t1', 'c', {
        path: 'a.txt',
        patch: '',
        baseHash: 'f'.repeat(64),
        reason: 'stale',
      });
    } catch (e) {
      expect((e as ProductFailure).error.code).toBe('CHG_VERSION_CONFLICT');
    }
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(original);
  });

  it('reads the OPEN BUFFER as the logical base (spec §6.4)', async () => {
    await docs.open('a.txt');
    docs.updateBuffer('a.txt', 'buffered\n');
    const result = await service.applyPatch('t1', 'call1', {
      path: 'a.txt',
      patch: '--- a\n+++ b\n@@ -1,1 +1,1 @@\n-buffered\n+patched-buffer\n',
      baseHash: sha('buffered\n'),
      reason: 'buffer-aware',
    });
    expect(result.afterHash).toBe(sha('patched-buffer\n'));
    // Applied through the document store: buffer updated AND saved to disk.
    expect(docs.get('a.txt')!.content).toBe('patched-buffer\n');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('patched-buffer\n');
  });

  it('creates and deletes files with baselines', async () => {
    await service.createFile('t1', 'c1', { path: 'new/file.txt', content: 'fresh\n' });
    expect(readFileSync(join(root, 'new/file.txt'), 'utf8')).toBe('fresh\n');
    await expect(
      service.createFile('t1', 'c2', { path: 'new/file.txt', content: 'again' }),
    ).rejects.toThrowError(ProductFailure);

    await service.deleteFile('t1', 'c3', { path: 'a.txt' });
    expect(existsSync(join(root, 'a.txt'))).toBe(false);
    const kinds = repo.changesFor('t1').map((c) => c.kind);
    expect(kinds).toContain('created');
    expect(kinds).toContain('deleted');
  });
});

describe('change set projection (CHG-005)', () => {
  it('reports net changes, collapsing intermediate patches', async () => {
    const h0 = sha(readFileSync(join(root, 'a.txt')));
    await service.applyPatch('t1', 'c1', {
      path: 'a.txt',
      patch: '--- a\n+++ b\n@@ -1,3 +1,3 @@\n line1\n-line2\n+v1\n line3\n',
      baseHash: h0,
      reason: 'step1',
    });
    await service.applyPatch('t1', 'c2', {
      path: 'a.txt',
      patch: '--- a\n+++ b\n@@ -1,3 +1,3 @@\n line1\n-v1\n+v2\n line3\n',
      baseHash: sha('line1\nv1\nline3\n'),
      reason: 'step2',
    });
    await service.createFile('t1', 'c3', { path: 'brand-new.txt', content: 'nn\n' });

    const changeSet = await service.changeSet('t1');
    expect(changeSet.files).toHaveLength(2);
    const a = changeSet.files.find((f) => f.path === 'a.txt')!;
    expect(a.status).toBe('modified');
    expect(a.diff).toContain('+v2');
    expect(a.diff).not.toContain('+v1'); // net diff, not intermediate
    const b = changeSet.files.find((f) => f.path === 'brand-new.txt')!;
    expect(b.status).toBe('created');
    expect(changeSet.totalAdditions).toBeGreaterThan(0);
  });
});

describe('rollback engine (CHG-009..012)', () => {
  it('restores modify/create/delete/rename to byte-identical baseline state', async () => {
    chmodSync(join(root, 'a.txt'), 0o750);
    const beforeBytes = readFileSync(join(root, 'a.txt'));
    const beforeCrlf = readFileSync(join(root, 'crlf.txt'));

    await service.applyPatch('t1', 'c1', {
      path: 'a.txt',
      patch: '--- a\n+++ b\n@@ -1,3 +1,3 @@\n line1\n-line2\n+HACK\n line3\n',
      baseHash: sha(beforeBytes),
      reason: 'modify',
    });
    await service.createFile('t1', 'c2', { path: 'created.txt', content: 'temp\n' });
    await service.deleteFile('t1', 'c3', { path: 'crlf.txt' });
    await service.renameFile('t1', 'c4', { from: 'nested/deep.txt', to: 'nested/renamed.txt' });

    const preflight = await service.rollbackPreflight('t1');
    expect(preflight.conflicts).toHaveLength(0);

    const report = await service.rollback('t1');
    expect(report.ok).toBe(true);
    expect(report.verified.every((v) => v.ok)).toBe(true);

    expect(readFileSync(join(root, 'a.txt'))).toEqual(beforeBytes);
    expect((statSync(join(root, 'a.txt')).mode & 0o777).toString(8)).toBe('750');
    expect(existsSync(join(root, 'created.txt'))).toBe(false);
    expect(readFileSync(join(root, 'crlf.txt'))).toEqual(beforeCrlf);
    expect(existsSync(join(root, 'nested/deep.txt'))).toBe(true);
    expect(existsSync(join(root, 'nested/renamed.txt'))).toBe(false);
  });

  it('refuses to overwrite external edits made after the task changes (CHG-010)', async () => {
    const h0 = sha(readFileSync(join(root, 'a.txt')));
    await service.applyPatch('t1', 'c1', {
      path: 'a.txt',
      patch: '--- a\n+++ b\n@@ -1,3 +1,3 @@\n line1\n-line2\n+AGENT\n line3\n',
      baseHash: h0,
      reason: 'agent change',
    });
    // User edits the same file afterwards, outside the task.
    writeFileSync(join(root, 'a.txt'), 'precious user work\n');

    const preflight = await service.rollbackPreflight('t1');
    expect(preflight.conflicts.map((c) => c.path)).toContain('a.txt');

    await expect(service.rollback('t1')).rejects.toThrowError(ProductFailure);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('precious user work\n');

    // Forced rollback (explicit user decision) does restore baseline.
    const forced = await service.rollback('t1', { force: true });
    expect(forced.ok).toBe(true);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('line1\nline2\nline3\n');
  });
});
