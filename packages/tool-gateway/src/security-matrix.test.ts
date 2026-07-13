import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  realpathSync,
  unlinkSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentStore } from '@pi-ide/document-service';
import { SearchService } from '@pi-ide/search-service';
import { ToolGateway, type ToolAuditRecord } from './gateway.js';
import { registerReadOnlyTools } from './tools-readonly.js';
import { registerCommandTools } from './tools-command.js';
import {
  PermissionEngine,
  createMemoryPermissionStore,
  type PermissionRequestCard,
} from './permission-engine.js';
import type { ToolCallRequest } from '@pi-ide/agent-contract';

/**
 * Security matrix (M7-03/M7-07): symlink escapes, TOCTOU-style swaps and
 * R3/R4 fault injection all fail closed with stable error codes and audits.
 * These are the unit-level guarantees behind E2E-012/013/021.
 */

let outside: string;
let root: string;
let gateway: ToolGateway;
let audits: ToolAuditRecord[];
let pendingCards: PermissionRequestCard[];
let engine: PermissionEngine;
let onPendingHook: ((card: PermissionRequestCard) => void) | null = null;

function call(toolName: string, input: unknown): ToolCallRequest {
  return {
    callId: `c_${Math.random().toString(36).slice(2)}`,
    runId: 'r1',
    taskId: 't1',
    toolName,
    input,
  };
}

function exec(toolName: string, input: unknown) {
  return gateway.executeCall(call(toolName, input), new AbortController().signal);
}

beforeEach(() => {
  onPendingHook = null;
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'pi-ide-outside-')));
  writeFileSync(join(outside, 'secret.txt'), 'outside-secret\n');
  mkdirSync(join(outside, 'dir'));
  writeFileSync(join(outside, 'dir', 'nested.txt'), 'outside-nested\n');

  root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-ide-secroot-')));
  writeFileSync(join(root, 'normal.txt'), 'inside\n');
  // fixture links pointing OUT of the workspace (E2E-021 fixture shape)
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link-to-file'));
  symlinkSync(join(outside, 'dir'), join(root, 'link-to-dir'));

  audits = [];
  pendingCards = [];
  const store = createMemoryPermissionStore();
  engine = new PermissionEngine({
    workspaceId: 'ws1',
    store,
    events: {
      onPending: (card) => {
        pendingCards.push(card);
        onPendingHook?.(card);
      },
      onResolved: () => undefined,
    },
  });
  gateway = new ToolGateway({
    root,
    mode: 'edit',
    permission: engine,
    audit: (r) => audits.push(r),
  });
  const documents = new DocumentStore(root, {});
  registerReadOnlyTools(gateway, {
    root,
    documents,
    search: () => new SearchService(root, []),
    git: () => null,
  });
  registerCommandTools(gateway, {
    root,
    graceMs: 300,
    userGate: { ask: async () => 'answer' },
  });
});
afterEach(() => {
  engine.cancelAll('test over');
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('symlink and path escapes (E2E-021 core)', () => {
  it('read_file through a symlink to an outside file is refused with a stable code', async () => {
    const result = await exec('read_file', { path: 'link-to-file' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('WS_PATH_ESCAPE');
    expect(JSON.stringify(result.data)).not.toContain('outside-secret');
  });

  it('read_file through a symlinked directory is refused', async () => {
    const result = await exec('read_file', { path: 'link-to-dir/nested.txt' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('WS_PATH_ESCAPE');
  });

  it('list_directory of a symlinked outside directory is refused', async () => {
    const result = await exec('list_directory', { path: 'link-to-dir' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('WS_PATH_ESCAPE');
  });

  it('TOCTOU: a file swapped for an outside symlink after first read is refused on the next read', async () => {
    const okFirst = await exec('read_file', { path: 'normal.txt' });
    expect(okFirst.ok).toBe(true);
    // Swap the file for a link between calls — resolution happens per call.
    unlinkSync(join(root, 'normal.txt'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'normal.txt'));
    const second = await exec('read_file', { path: 'normal.txt' });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('WS_PATH_ESCAPE');
    expect(JSON.stringify(second.data)).not.toContain('outside-secret');
  });

  it('run_command cwd pointing at a symlinked outside directory is refused', async () => {
    // Classifier sees a relative cwd, so this reaches execution-time resolution.
    onPendingHook = (card) =>
      engine.resolve({
        requestId: card.requestId,
        kind: 'allow',
        scope: 'once',
        expectedParamsHash: card.paramsHash,
        actor: 'user',
      });
    const result = await exec('run_command', {
      executable: process.execPath,
      args: ['-e', "require('fs').writeFileSync('pwned.txt','x')"],
      cwd: 'link-to-dir',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('WS_PATH_ESCAPE');
    expect(existsSync(join(outside, 'dir', 'pwned.txt'))).toBe(false);
  });

  it('a refused escape leaves an audit trail with the failure state', async () => {
    await exec('read_file', { path: 'link-to-file' });
    expect(
      audits.filter(
        (a) => a.name === 'read_file' && (a.state === 'FAILED' || a.state === 'DENIED'),
      ),
    ).not.toHaveLength(0);
  });
});

describe('R3/R4 fault injection through the full gateway', () => {
  it('R4 catalogue is refused permanently with zero side effects (E2E-013)', async () => {
    const marker = join(root, 'r4-marker.txt');
    const attempts: Array<Record<string, unknown>> = [
      { executable: 'sudo', args: ['touch', marker] },
      { executable: 'git', args: ['push', '--force'] },
      { executable: 'sh', args: ['-c', `git push && touch ${marker}`] },
      { executable: 'rm', args: ['-rf', '/'] },
      { executable: process.execPath, args: ['-e', '1'], cwd: '/etc' },
      { executable: 'cat', args: ['~/.aws/credentials'] },
    ];
    for (const input of attempts) {
      const result = await exec('run_command', input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.code, JSON.stringify(input)).toBe('PERMISSION_DENIED');
      expect((result.data as { permanent: boolean }).permanent, JSON.stringify(input)).toBe(true);
    }
    expect(existsSync(marker)).toBe(false);
    expect(pendingCards).toHaveLength(0); // R4 never even asks
    expect(audits.filter((a) => a.state === 'DENIED').length).toBeGreaterThanOrEqual(
      attempts.length,
    );
  });

  it('R3 (delete inside workspace) asks, and denying keeps the file intact (E2E-012 shape)', async () => {
    writeFileSync(join(root, 'precious.txt'), 'keep me\n');
    onPendingHook = (card) =>
      engine.resolve({
        requestId: card.requestId,
        kind: 'deny',
        scope: 'once',
        reason: 'do not delete',
        expectedParamsHash: card.paramsHash,
        actor: 'user',
      });
    const result = await exec('run_command', { executable: 'rm', args: ['precious.txt'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(readFileSync(join(root, 'precious.txt'), 'utf8')).toBe('keep me\n');
    expect(pendingCards[0]!.risk.level).toBe('R3');
    expect(pendingCards[0]!.options.allowScopes).toEqual(['once']); // R3: no persistent grants offered
  });

  it('schema smuggling: unexpected fields on run_command are rejected before risk/permission', async () => {
    const result = await exec('run_command', {
      executable: 'ls',
      args: [],
      dangerouslySkipPermissions: true,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TOOL_INVALID_INPUT');
    expect(pendingCards).toHaveLength(0);
  });
});
