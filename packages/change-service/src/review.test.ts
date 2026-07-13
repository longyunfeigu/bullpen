import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProductFailure } from '@pi-ide/foundation';
import { DocumentStore } from '@pi-ide/document-service';
import { BlobStore } from './blob-store.js';
import { ChangeService, InMemoryChangeRepo } from './change-service.js';
import { parseHunks, reverseHunkPatchText } from './review.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const BASE = ['export function add(a, b) {', '  return a + b;', '}', ''].join('\n');
// Two separated edits so the diff produces two hunks.
const LONG_BASE = [
  'function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'const KEEP_1 = 1;',
  'const KEEP_2 = 2;',
  'const KEEP_3 = 3;',
  'const KEEP_4 = 4;',
  'const KEEP_5 = 5;',
  '',
  'function sub(a, b) {',
  '  return a - b;',
  '}',
  '',
].join('\n');
const LONG_NEXT = LONG_BASE.replace('return a + b;', 'return b + a;').replace(
  'function sub(a, b) {\n  return a - b;\n}',
  'function sub(a, b) {\n  return a - b;\n}\n\nfunction mul(a, b) {\n  return a * b;\n}',
);

let root: string;
let blobDir: string;
let service: ChangeService;
let docs: DocumentStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-ide-review-'));
  blobDir = mkdtempSync(join(tmpdir(), 'pi-ide-review-blob-'));
  docs = new DocumentStore(root, {});
  service = new ChangeService({
    root,
    blobs: new BlobStore(blobDir),
    repo: new InMemoryChangeRepo(),
    documents: docs,
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(blobDir, { recursive: true, force: true });
});

describe('parseHunks', () => {
  it('splits a multi-hunk unified diff into stable, content-keyed hunks', async () => {
    writeFileSync(join(root, 'multi.ts'), LONG_BASE);
    await service.writeFileDirect('t1', null, {
      path: 'multi.ts',
      content: Buffer.from(LONG_NEXT, 'utf8'),
    });
    const cs = await service.changeSet('t1');
    const file = cs.files.find((f) => f.path === 'multi.ts')!;
    const hunks = parseHunks(file.diff!);
    expect(hunks.length).toBe(2);
    expect(hunks[0]!.lines.some((l) => l.startsWith('+  return b + a;'))).toBe(true);
    expect(hunks[1]!.lines.some((l) => l.startsWith('+function mul(a, b) {'))).toBe(true);
    // Keys are deterministic for identical content.
    expect(hunks[0]!.key).toBe(parseHunks(file.diff!)[0]!.key);
    expect(hunks[0]!.key).not.toBe(hunks[1]!.key);
  });

  it('returns an empty list for empty or null-ish diffs', () => {
    expect(parseHunks('')).toEqual([]);
  });
});

describe('reverseHunkPatchText', () => {
  it('produces a patch that undoes exactly one hunk', async () => {
    writeFileSync(join(root, 'multi.ts'), LONG_BASE);
    await service.writeFileDirect('t1', null, {
      path: 'multi.ts',
      content: Buffer.from(LONG_NEXT, 'utf8'),
    });
    const cs = await service.changeSet('t1');
    const hunks = parseHunks(cs.files[0]!.diff!);
    const reversed = reverseHunkPatchText('multi.ts', hunks[1]!);
    expect(reversed).toContain('-function mul(a, b) {');
  });
});

describe('ChangeService.rejectHunk (CHG-008)', () => {
  it('reverse-applies a single hunk while keeping the other hunk', async () => {
    writeFileSync(join(root, 'multi.ts'), LONG_BASE);
    await service.writeFileDirect('t1', null, {
      path: 'multi.ts',
      content: Buffer.from(LONG_NEXT, 'utf8'),
    });
    const before = await service.changeSet('t1');
    const hunks = parseHunks(before.files[0]!.diff!);
    const currentHash = before.files[0]!.currentHash!;

    await service.rejectHunk('t1', null, {
      path: 'multi.ts',
      hunkKey: hunks[1]!.key,
      expectedCurrentHash: currentHash,
    });

    const text = readFileSync(join(root, 'multi.ts'), 'utf8');
    expect(text).toContain('return b + a;'); // hunk 1 kept
    expect(text).not.toContain('mul'); // hunk 2 undone
    const after = await service.changeSet('t1');
    expect(parseHunks(after.files[0]!.diff!).length).toBe(1);
  });

  it('rejects with CHG_REVIEW_STALE when the file changed since the review was rendered', async () => {
    writeFileSync(join(root, 'multi.ts'), LONG_BASE);
    await service.writeFileDirect('t1', null, {
      path: 'multi.ts',
      content: Buffer.from(LONG_NEXT, 'utf8'),
    });
    const before = await service.changeSet('t1');
    const hunks = parseHunks(before.files[0]!.diff!);
    writeFileSync(join(root, 'multi.ts'), LONG_NEXT + '// external edit\n');
    await expect(
      service.rejectHunk('t1', null, {
        path: 'multi.ts',
        hunkKey: hunks[0]!.key,
        expectedCurrentHash: before.files[0]!.currentHash!,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'CHG_REVIEW_STALE',
    );
    // Nothing was overwritten.
    expect(readFileSync(join(root, 'multi.ts'), 'utf8')).toContain('// external edit');
  });

  it('rejecting the only hunk restores the file to baseline (drops from the change set)', async () => {
    writeFileSync(join(root, 'one.ts'), BASE);
    const next = BASE.replace('a + b', 'b + a');
    await service.writeFileDirect('t2', null, {
      path: 'one.ts',
      content: Buffer.from(next, 'utf8'),
    });
    const cs = await service.changeSet('t2');
    const hunks = parseHunks(cs.files[0]!.diff!);
    expect(hunks.length).toBe(1);
    await service.rejectHunk('t2', null, {
      path: 'one.ts',
      hunkKey: hunks[0]!.key,
      expectedCurrentHash: cs.files[0]!.currentHash!,
    });
    expect(readFileSync(join(root, 'one.ts'), 'utf8')).toBe(BASE);
    const after = await service.changeSet('t2');
    expect(after.files.length).toBe(0);
  });
});

describe('ChangeService.revertFile', () => {
  it('restores a modified file to its baseline bytes', async () => {
    writeFileSync(join(root, 'a.txt'), 'original\n');
    await service.writeFileDirect('t3', null, {
      path: 'a.txt',
      content: Buffer.from('changed\n', 'utf8'),
    });
    const result = await service.revertFile('t3', null, { path: 'a.txt' });
    expect(result.kind).toBe('restored');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('original\n');
    expect((await service.changeSet('t3')).files.length).toBe(0);
  });

  it('removes a file the task created (baseline did not exist)', async () => {
    await service.createFile('t4', null, { path: 'new.txt', content: 'created\n' });
    const result = await service.revertFile('t4', null, { path: 'new.txt' });
    expect(result.kind).toBe('removed');
    expect(existsSync(join(root, 'new.txt'))).toBe(false);
  });

  it('recreates a file the task deleted', async () => {
    writeFileSync(join(root, 'gone.txt'), 'bytes\n');
    await service.deleteFile('t5', null, { path: 'gone.txt' });
    expect(existsSync(join(root, 'gone.txt'))).toBe(false);
    const result = await service.revertFile('t5', null, { path: 'gone.txt' });
    expect(result.kind).toBe('restored');
    expect(readFileSync(join(root, 'gone.txt'), 'utf8')).toBe('bytes\n');
  });

  it('refuses to overwrite external edits unless the expected hash matches (CHG-010)', async () => {
    writeFileSync(join(root, 'a.txt'), 'original\n');
    await service.writeFileDirect('t6', null, {
      path: 'a.txt',
      content: Buffer.from('changed\n', 'utf8'),
    });
    writeFileSync(join(root, 'a.txt'), 'user external edit\n');
    await expect(
      service.revertFile('t6', null, { path: 'a.txt', expectedCurrentHash: sha('changed\n') }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'CHG_REVIEW_STALE',
    );
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('user external edit\n');
  });
});
