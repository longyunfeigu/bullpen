import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from './command-runner.js';

const node = process.execPath;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'pi-ide-cmd-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function run(
  executable: string,
  args: string[],
  extra?: Partial<Parameters<typeof runCommand>[0]>,
  signal?: AbortSignal,
) {
  return runCommand(
    { executable, args, cwd, timeoutMs: 10_000, graceMs: 300, ...extra },
    signal ?? new AbortController().signal,
  );
}

describe('command runner (CMD-001/003/004/005)', () => {
  it('runs a structured command and reports stdout + exit code', async () => {
    const result = await run(node, ['-e', "console.log('hi'); process.exit(3)"]);
    expect(result.stdout.trim()).toBe('hi');
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stderr separately', async () => {
    const result = await run(node, ['-e', "console.error('bad'); process.exit(0)"]);
    expect(result.stderr.trim()).toBe('bad');
    expect(result.exitCode).toBe(0);
  });

  it('does not inherit arbitrary parent environment (CMD-005 minimal env)', async () => {
    process.env.PI_IDE_TEST_SECRET_TOKEN = 'super-secret';
    try {
      const result = await run(node, ['-p', "process.env.PI_IDE_TEST_SECRET_TOKEN ?? 'unset'"]);
      expect(result.stdout.trim()).toBe('unset');
    } finally {
      delete process.env.PI_IDE_TEST_SECRET_TOKEN;
    }
  });

  it('passes explicitly allowed env vars through', async () => {
    const result = await run(node, ['-p', 'process.env.MY_FLAG'], { env: { MY_FLAG: 'on' } });
    expect(result.stdout.trim()).toBe('on');
  });

  it('enforces the timeout and reports it honestly (CMD-004)', async () => {
    const started = Date.now();
    const result = await run(node, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toMatch(/SIGTERM|SIGKILL/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    const result = await run(
      node,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 100)"],
      { timeoutMs: 300, graceMs: 200 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGKILL');
  });

  it('kills the whole process tree on timeout (CMD-004)', async () => {
    const marker = join(cwd, 'grandchild-was-alive.txt');
    const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1200)`;
    const script = `require('child_process').spawn(${JSON.stringify(node)}, ['-e', ${JSON.stringify(grandchild)}]); setInterval(() => {}, 100)`;
    const result = await run(node, ['-e', script], { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(existsSync(marker)).toBe(false);
  });

  it('supports cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await run(
      node,
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 30_000 },
      controller.signal,
    );
    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('truncates oversized output with an explicit flag (CMD-003)', async () => {
    const result = await run(node, ['-e', "process.stdout.write('x'.repeat(300000))"], {
      maxOutputBytes: 10_000,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(10_000);
    expect(result.exitCode).toBe(0);
  });

  it('runs shell strings through /bin/sh when requested', async () => {
    const result = await run('echo hi | tr a-z A-Z', [], { requiresShell: true });
    expect(result.stdout.trim()).toBe('HI');
  });

  it('fails with a stable error code for unknown executables', async () => {
    const error = await run('definitely-not-a-real-binary-xyz', []).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeTruthy();
    expect((error as { error: { code: string } }).error.code).toBe('CMD_SPAWN_FAILED');
  });
});
