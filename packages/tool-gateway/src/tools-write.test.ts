import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { DocumentStore } from '@pi-ide/document-service';
import { BlobStore, ChangeService, InMemoryChangeRepo } from '@pi-ide/change-service';
import type { TaskPlan, ToolCallRequest } from '@pi-ide/agent-contract';
import { ToolGateway, type PermissionDecider, type ToolAuditRecord } from './gateway.js';
import {
  createPlanAwarePermission,
  registerWriteTools,
  type PlanGate,
  type ProposedPlanInput,
} from './tools-write.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const allowAll: PermissionDecider = {
  decide: async () => ({ kind: 'allow', scope: 'auto' }),
};

function call(toolName: string, input: unknown, taskId = 'task-1'): ToolCallRequest {
  return {
    callId: `call-${Math.random().toString(36).slice(2)}`,
    runId: 'run-1',
    taskId,
    toolName,
    input,
  };
}

let root: string;
let blobDir: string;
let docs: DocumentStore;
let blobs: BlobStore;
let repo: InMemoryChangeRepo;
let changes: ChangeService;
let audits: ToolAuditRecord[];
let planCalls: Array<{ kind: string; taskId: string }>;

function stubPlanGate(overrides: Partial<PlanGate> = {}): PlanGate {
  return {
    propose: async (input: {
      taskId: string;
      plan: ProposedPlanInput;
    }): Promise<{
      decision: 'approved' | 'edited';
      plan: TaskPlan;
    }> => {
      planCalls.push({ kind: 'propose', taskId: input.taskId });
      return {
        decision: 'approved',
        plan: {
          version: 1,
          summary: input.plan.summary,
          steps: input.plan.steps.map((s, i) => ({
            id: `step-${i + 1}`,
            title: s.title,
            status: 'pending',
          })),
        },
      };
    },
    update: async (input: { taskId: string }) => {
      planCalls.push({ kind: 'update', taskId: input.taskId });
      return { version: 2, summary: 'updated', steps: [] };
    },
    ...overrides,
  };
}

function buildGateway(
  options: {
    mode?: 'ask' | 'edit' | 'auto';
    permission?: PermissionDecider;
    planGate?: PlanGate;
  } = {},
): ToolGateway {
  const gateway = new ToolGateway({
    root,
    mode: options.mode ?? 'edit',
    permission: options.permission ?? allowAll,
    audit: (r) => audits.push(r),
  });
  registerWriteTools(gateway, {
    root,
    changes: () => changes,
    documents: docs,
    planGate: options.planGate ?? stubPlanGate(),
  });
  return gateway;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-ide-wt-'));
  blobDir = mkdtempSync(join(tmpdir(), 'pi-ide-wt-blob-'));
  writeFileSync(join(root, 'src.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  docs = new DocumentStore(root, {});
  blobs = new BlobStore(blobDir);
  repo = new InMemoryChangeRepo();
  changes = new ChangeService({ root, blobs, repo, documents: docs });
  audits = [];
  planCalls = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(blobDir, { recursive: true, force: true });
});

describe('catalog exposure (TOOL-001/AG-001)', () => {
  it('exposes write and plan tools in edit/auto but never in ask', () => {
    const gateway = buildGateway();
    const editNames = gateway.catalog('edit').map((t) => t.name);
    for (const name of [
      'apply_patch',
      'create_file',
      'delete_file',
      'propose_plan',
      'update_plan',
    ]) {
      expect(editNames).toContain(name);
    }
    const askNames = gateway.catalog('ask').map((t) => t.name);
    for (const name of [
      'apply_patch',
      'create_file',
      'delete_file',
      'propose_plan',
      'update_plan',
    ]) {
      expect(askNames).not.toContain(name);
    }
  });
});

describe('apply_patch (M8-02, CHG-002/003)', () => {
  it('applies a base-hash verified patch through the ChangeService and records the change', async () => {
    const gateway = buildGateway();
    const current = await docs.readLogical('src.ts');
    const next = current.content.replace('const b = 2;', 'const b = 22;');
    const patch = createTwoFilesPatch('src.ts', 'src.ts', current.content, next, '', '');

    const result = await gateway.executeCall(
      call('apply_patch', { path: 'src.ts', patch, baseHash: current.hash, reason: 'bump b' }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toContain('const b = 22;');
    expect((result.data as { afterHash: string }).afterHash).toBe(sha(next));
    expect(repo.changesFor('task-1').some((c) => c.kind === 'modified')).toBe(true);
    expect(audits.some((a) => a.name === 'apply_patch' && a.state === 'SUCCEEDED')).toBe(true);
  });

  it('returns a retryable VERSION_CONFLICT for a stale base hash and leaves the file untouched', async () => {
    const gateway = buildGateway();
    const before = readFileSync(join(root, 'src.ts'), 'utf8');
    const result = await gateway.executeCall(
      call('apply_patch', {
        path: 'src.ts',
        patch: '@@ -1 +1 @@\n-const a = 1;\n+const a = 9;\n',
        baseHash: sha('some stale content'),
        reason: 'stale',
      }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('CHG_VERSION_CONFLICT');
    expect(result.retryable).toBe(true);
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toBe(before);
  });

  it('produces a real projected diff in its preview (PERM-004)', async () => {
    const gateway = buildGateway();
    const current = await docs.readLogical('src.ts');
    const next = current.content.replace('const c = 3;', 'const c = 33;');
    const patch = createTwoFilesPatch('src.ts', 'src.ts', current.content, next, '', '');
    const preview = await gateway.preview(
      call('apply_patch', { path: 'src.ts', patch, baseHash: current.hash, reason: 'bump c' }),
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.diff).toContain('+const c = 33;');
      expect(preview.value.targets).toEqual(['src.ts']);
    }
  });
});

describe('create_file / delete_file (M8-02)', () => {
  it('creates a new file but never overwrites an existing one', async () => {
    const gateway = buildGateway();
    const created = await gateway.executeCall(
      call('create_file', {
        path: 'nested/new.ts',
        content: 'export const x = 1;\n',
        reason: 'add module',
      }),
      new AbortController().signal,
    );
    expect(created.ok).toBe(true);
    expect(readFileSync(join(root, 'nested/new.ts'), 'utf8')).toBe('export const x = 1;\n');

    const clash = await gateway.executeCall(
      call('create_file', { path: 'src.ts', content: 'overwrite!', reason: 'oops' }),
      new AbortController().signal,
    );
    expect(clash.ok).toBe(false);
    expect(clash.code).toBe('CHG_ALREADY_EXISTS');
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toContain('const a = 1;');
  });

  it('delete_file is R3, snapshots the bytes first and removes the file', async () => {
    const gateway = buildGateway();
    const bytes = readFileSync(join(root, 'src.ts'));
    const result = await gateway.executeCall(
      call('delete_file', { path: 'src.ts', reason: 'obsolete' }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, 'src.ts'))).toBe(false);
    expect(await blobs.get(createHash('sha256').update(bytes).digest('hex'))).not.toBeNull();
    expect(
      audits.some((a) => a.name === 'delete_file' && a.risk === 'R3' && a.state === 'SUCCEEDED'),
    ).toBe(true);
  });
});

describe('ask mode boundary (AG-001)', () => {
  it('refuses writes in ask mode even if called directly', async () => {
    const gateway = buildGateway({ mode: 'ask' });
    const result = await gateway.executeCall(
      call('apply_patch', {
        path: 'src.ts',
        patch: '@@ -1 +1 @@\n-a\n+b\n',
        baseHash: sha('x'),
        reason: 'nope',
      }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toContain('const a = 1;');
  });
});

describe('plan gate (AG-007, M8-01/04)', () => {
  it('denies the first write in edit mode until a plan is approved, then allows it', async () => {
    let approved = false;
    const permission = createPlanAwarePermission(allowAll, { planApproved: () => approved });
    const gateway = buildGateway({ permission });
    const current = await docs.readLogical('src.ts');
    const next = current.content.replace('const a = 1;', 'const a = 10;');
    const patch = createTwoFilesPatch('src.ts', 'src.ts', current.content, next, '', '');
    const input = { path: 'src.ts', patch, baseHash: current.hash, reason: 'gated write' };

    const denied = await gateway.executeCall(
      call('apply_patch', input),
      new AbortController().signal,
    );
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(denied.summary).toContain('propose_plan');
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toContain('const a = 1;');
    expect(audits.some((a) => a.name === 'apply_patch' && a.state === 'DENIED')).toBe(true);

    approved = true;
    const allowed = await gateway.executeCall(
      call('apply_patch', input),
      new AbortController().signal,
    );
    expect(allowed.ok).toBe(true);
    expect(readFileSync(join(root, 'src.ts'), 'utf8')).toContain('const a = 10;');
  });

  it('plan tools bypass the permission engine and reach the plan gate', async () => {
    const denyEverything: PermissionDecider = {
      decide: async () => ({
        kind: 'deny',
        reason: 'engine should not be consulted',
        permanent: true,
      }),
    };
    const permission = createPlanAwarePermission(denyEverything, { planApproved: () => false });
    const gateway = buildGateway({ permission });

    const proposed = await gateway.executeCall(
      call('propose_plan', { summary: 'do the work', steps: [{ title: 'step one' }] }),
      new AbortController().signal,
    );
    expect(proposed.ok).toBe(true);
    const data = proposed.data as { decision: string; plan: TaskPlan };
    expect(data.decision).toBe('approved');
    expect(data.plan.steps[0]!.title).toBe('step one');
    expect(planCalls.some((c) => c.kind === 'propose')).toBe(true);

    const updated = await gateway.executeCall(
      call('update_plan', { updates: [{ id: 'step-1', status: 'done' }] }),
      new AbortController().signal,
    );
    expect(updated.ok).toBe(true);
    expect(planCalls.some((c) => c.kind === 'update')).toBe(true);
  });

  it('surfaces plan rejection as a failed, non-ok tool result', async () => {
    const rejectingGate = stubPlanGate({
      propose: async () => {
        const { ProductFailure, productError } = await import('@pi-ide/foundation');
        throw new ProductFailure(
          productError('PLAN_REJECTED', {
            userMessage: 'The user rejected the plan; the task was cancelled.',
          }),
        );
      },
    });
    const gateway = buildGateway({ planGate: rejectingGate });
    const result = await gateway.executeCall(
      call('propose_plan', { summary: 'nope', steps: [{ title: 'x' }] }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_REJECTED');
  });
});

describe('rename_file (M9, CHG-004)', () => {
  it('renames a file and refuses to overwrite an existing target', async () => {
    const gateway = buildGateway();
    const moved = await gateway.executeCall(
      call('rename_file', { from: 'src.ts', to: 'renamed.ts', reason: 'restructure' }),
      new AbortController().signal,
    );
    expect(moved.ok).toBe(true);
    expect(existsSync(join(root, 'src.ts'))).toBe(false);
    expect(readFileSync(join(root, 'renamed.ts'), 'utf8')).toContain('const a = 1;');

    writeFileSync(join(root, 'other.ts'), 'occupied\n');
    const clash = await gateway.executeCall(
      call('rename_file', { from: 'renamed.ts', to: 'other.ts', reason: 'collide' }),
      new AbortController().signal,
    );
    expect(clash.ok).toBe(false);
    expect(clash.code).toBe('CHG_ALREADY_EXISTS');
    expect(readFileSync(join(root, 'other.ts'), 'utf8')).toBe('occupied\n');
    expect(existsSync(join(root, 'renamed.ts'))).toBe(true);
  });
});
