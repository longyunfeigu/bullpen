import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolGateway, type ToolAuditRecord } from './gateway.js';
import {
  PermissionEngine,
  createMemoryPermissionStore,
  type MemoryPermissionStore,
  type PermissionRequestCard,
} from './permission-engine.js';
import { registerCommandTools, type AskUserPrompt } from './tools-command.js';
import type { ToolCallRequest } from '@pi-ide/agent-contract';

const node = process.execPath;

let root: string;
let gateway: ToolGateway;
let engine: PermissionEngine;
let store: MemoryPermissionStore;
let audits: ToolAuditRecord[];
let pendingCards: PermissionRequestCard[];
let autoDecision: 'allow' | 'deny' | null;
let askedQuestions: AskUserPrompt[];
let questionAnswer: string;

function call(toolName: string, input: unknown, taskId = 't1'): ToolCallRequest {
  return {
    callId: `c_${Math.random().toString(36).slice(2)}`,
    runId: 'r1',
    taskId,
    toolName,
    input,
  };
}

function exec(input: unknown, taskId = 't1') {
  return gateway.executeCall(call('run_command', input, taskId), new AbortController().signal);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-ide-cmdtool-')));
  audits = [];
  pendingCards = [];
  askedQuestions = [];
  questionAnswer = 'yes, proceed';
  autoDecision = 'allow';
  store = createMemoryPermissionStore();
  engine = new PermissionEngine({
    workspaceId: 'ws1',
    store,
    events: {
      onPending: (card) => {
        pendingCards.push(card);
        if (autoDecision) {
          queueMicrotask(() =>
            engine.resolve({
              requestId: card.requestId,
              kind: autoDecision!,
              scope: 'once',
              reason: autoDecision === 'deny' ? 'user said no' : undefined,
              expectedParamsHash: card.paramsHash,
              actor: 'user',
            }),
          );
        }
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
  registerCommandTools(gateway, {
    root,
    graceMs: 300,
    userGate: {
      ask: async (prompt) => {
        askedQuestions.push(prompt);
        return questionAnswer;
      },
    },
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('run_command tool (CMD-001..006, E2E-012/013 core)', () => {
  it('executes an approved command and reports exit code and output', async () => {
    const result = await exec({
      executable: node,
      args: ['-e', "console.log('from-child')"],
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(true);
    const data = result.data as { exitCode: number; stdout: string };
    expect(data.exitCode).toBe(0);
    expect(data.stdout).toContain('from-child');
    expect(pendingCards).toHaveLength(1);
    expect(pendingCards[0]!.preview.command?.executable).toBe(node);
  });

  it('never starts the process when the user denies (PERM-006, E2E-012)', async () => {
    autoDecision = 'deny';
    const marker = join(root, 'denied-marker.txt');
    const result = await exec({
      executable: node,
      args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(result.summary).toContain('user said no');
    expect(existsSync(marker)).toBe(false);
    expect(audits.some((a) => a.name === 'run_command' && a.state === 'DENIED')).toBe(true);
    expect(audits.some((a) => a.name === 'run_command' && a.state === 'RUNNING')).toBe(false);
  });

  it('refuses R4 commands without ever asking (PERM-008, E2E-013)', async () => {
    for (const input of [
      { executable: 'sudo', args: ['rm', '-rf', '/'] },
      { executable: 'git', args: ['push', 'origin', 'main'] },
      { executable: 'cat', args: ['~/.ssh/id_rsa'] },
      { executable: node, args: ['-e', '1'], cwd: '../outside' },
    ]) {
      const result = await exec(input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.code, JSON.stringify(input)).toBe('PERMISSION_DENIED');
      expect((result.data as { permanent: boolean }).permanent).toBe(true);
    }
    expect(pendingCards).toHaveLength(0);
  });

  it('reports non-zero exits honestly instead of pretending success', async () => {
    const result = await exec({ executable: node, args: ['-e', 'process.exit(4)'] });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('COMMAND_EXIT_NONZERO');
    expect((result.data as { exitCode: number }).exitCode).toBe(4);
  });

  it('reports timeouts honestly (CMD-004)', async () => {
    const result = await exec({
      executable: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('COMMAND_TIMEOUT');
    const data = result.data as { timedOut: boolean; exitCode: number | null };
    expect(data.timedOut).toBe(true);
    expect(data.exitCode).toBeNull();
  });

  it('limits concurrent write-ish commands per task (CMD-006)', async () => {
    const first = exec({
      executable: node,
      args: ['-e', 'setTimeout(() => {}, 1500)'],
      timeoutMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 300));
    const second = await exec({ executable: node, args: ['-e', '1'] });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('COMMAND_CONCURRENCY_LIMIT');
    expect(second.retryable).toBe(true);
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    // A different task is not blocked by t1's slot.
    const other = await exec({ executable: node, args: ['-e', '1'] }, 't2');
    expect(other.ok).toBe(true);
  });

  it('redacts credential-looking values from captured output (§10.4)', async () => {
    const result = await exec({
      executable: node,
      args: ['-e', "console.log('API_KEY=sk-abcdef1234567890abcdef')"],
    });
    const data = result.data as { stdout: string };
    expect(data.stdout).not.toContain('sk-abcdef1234567890abcdef');
    expect(data.stdout).toContain('[REDACTED');
  });

  it('is hard-blocked in ask mode before any permission prompt (AG-001)', async () => {
    gateway.mode = 'ask';
    const result = await exec({ executable: node, args: ['-e', '1'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(pendingCards).toHaveLength(0);
    gateway.mode = 'edit';
  });
});

describe('ask_user tool', () => {
  it('is R0: available even in ask mode, and returns the user answer', async () => {
    gateway.mode = 'ask';
    const result = await gateway.executeCall(
      call('ask_user', { question: 'Which framework should I use?', options: ['react', 'vue'] }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect((result.data as { answer: string }).answer).toBe('yes, proceed');
    expect(askedQuestions[0]!.question).toContain('framework');
    expect(askedQuestions[0]!.options).toEqual(['react', 'vue']);
  });
});
