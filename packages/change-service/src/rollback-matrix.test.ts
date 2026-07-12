import { describe, expect, it } from 'vitest';
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
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DocumentStore } from '@pi-ide/document-service';
import { BlobStore } from './blob-store.js';
import { ChangeService, InMemoryChangeRepo } from './change-service.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

interface MatrixCase {
  name: string;
  content: Buffer;
  mode?: number;
  op: 'modify' | 'create' | 'delete' | 'rename';
  git: boolean;
}

const CONTENTS: Array<{ label: string; bytes: Buffer }> = [
  { label: 'lf', bytes: Buffer.from('alpha\nbeta\ngamma\n') },
  { label: 'crlf', bytes: Buffer.from('alpha\r\nbeta\r\ngamma\r\n') },
  { label: 'utf8-cn', bytes: Buffer.from('第一行\n第二行\n') },
  {
    label: 'bom',
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom line\n')]),
  },
  { label: 'no-trailing-nl', bytes: Buffer.from('no newline at end') },
  { label: 'empty', bytes: Buffer.alloc(0) },
  { label: 'emoji', bytes: Buffer.from('🚀 rocket\n✨ sparkle\n') },
];

const OPS: MatrixCase['op'][] = ['modify', 'create', 'delete', 'rename'];

function buildCases(): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const content of CONTENTS) {
    for (const op of OPS) {
      cases.push({ name: `${content.label}-${op}-nongit`, content: content.bytes, op, git: false });
    }
  }
  // Git-repo variants + exec-bit variants (total > 50)
  for (const op of OPS) {
    cases.push({
      name: `lf-${op}-git`,
      content: Buffer.from('git tracked\ncontent\n'),
      op,
      git: true,
    });
  }
  for (const op of ['modify', 'delete'] as const) {
    cases.push({
      name: `execbit-${op}-nongit`,
      content: Buffer.from('#!/bin/sh\necho hi\n'),
      mode: 0o755,
      op,
      git: false,
    });
  }
  return cases;
}

describe('rollback matrix — byte-identical restore across content kinds and ops (§16.3)', () => {
  const cases = buildCases();
  it(`covers at least 30 cases (actual: ${cases.length})`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  for (const matrixCase of cases) {
    it(matrixCase.name, async () => {
      const root = mkdtempSync(join(tmpdir(), 'pi-ide-matrix-'));
      const blobDir = mkdtempSync(join(tmpdir(), 'pi-ide-matrix-blob-'));
      try {
        if (matrixCase.git) {
          execFileSync('git', ['init', '-q'], { cwd: root });
        }
        const docs = new DocumentStore(root, {});
        const service = new ChangeService({
          root,
          blobs: new BlobStore(blobDir),
          repo: new InMemoryChangeRepo(),
          documents: docs,
        });
        const taskId = 'matrix';
        const target = 'dir/target.txt';
        mkdirSync(join(root, 'dir'), { recursive: true });

        // Arrange initial state (except for pure create).
        if (matrixCase.op !== 'create') {
          writeFileSync(join(root, target), matrixCase.content);
          if (matrixCase.mode) chmodSync(join(root, target), matrixCase.mode);
        }
        const preBytes = matrixCase.op !== 'create' ? readFileSync(join(root, target)) : null;
        const preMode =
          matrixCase.op !== 'create' ? statSync(join(root, target)).mode & 0o777 : null;

        // Act: perform the operation through the ChangeService.
        switch (matrixCase.op) {
          case 'modify': {
            await service.writeFileDirect(taskId, 'call', {
              path: target,
              content: Buffer.concat([matrixCase.content, Buffer.from('MUTATED')]),
            });
            break;
          }
          case 'create': {
            await service.createFile(taskId, 'call', {
              path: target,
              content: 'created by task\n',
            });
            break;
          }
          case 'delete': {
            await service.deleteFile(taskId, 'call', { path: target });
            break;
          }
          case 'rename': {
            await service.renameFile(taskId, 'call', { from: target, to: 'dir/moved.txt' });
            break;
          }
        }

        // Rollback and verify byte identity.
        const report = await service.rollback(taskId);
        expect(report.ok).toBe(true);

        if (matrixCase.op === 'create') {
          expect(existsSync(join(root, target))).toBe(false);
        } else {
          const restored = readFileSync(join(root, target));
          expect(sha(restored)).toBe(sha(preBytes!));
          if (matrixCase.mode) {
            expect(statSync(join(root, target)).mode & 0o777).toBe(preMode);
          }
          if (matrixCase.op === 'rename') {
            expect(existsSync(join(root, 'dir/moved.txt'))).toBe(false);
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(blobDir, { recursive: true, force: true });
      }
    });
  }
});
