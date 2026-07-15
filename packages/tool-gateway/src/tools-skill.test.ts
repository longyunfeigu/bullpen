import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolGateway } from './gateway.js';
import { registerSkillTool, type SkillProviderEntry } from './tools-skill.js';

function call(input: unknown) {
  return {
    callId: 'c1',
    runId: 'r1',
    taskId: 't1',
    toolName: 'load_skill',
    input,
  };
}

describe('load_skill (ADR-0015)', () => {
  let dir: string;
  let gateway: ToolGateway;
  let skills: SkillProviderEntry[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skill-tool-'));
    mkdirSync(join(dir, 'refs'));
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: alpha\n---\nAlpha instructions.');
    writeFileSync(join(dir, 'refs', 'notes.md'), 'reference notes');
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2]));
    skills = [
      {
        name: 'alpha',
        description: 'Alpha skill',
        dir,
        revision: '1234567890abcdef',
        source: 'Claude Code',
      },
    ];
    gateway = new ToolGateway({ root: dir, mode: 'ask' });
    registerSkillTool(gateway, { skills: () => skills });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is R0 — available even in ask mode, auto-allowed', async () => {
    const result = await gateway.executeCall(call({ name: 'alpha' }), new AbortController().signal);
    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toContain('Alpha instructions.');
    expect((result.data as { revision: string }).revision).toBe('1234567890abcdef');
    expect((result.data as { contentHash: string }).contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary).toContain('Claude Code · rev 1234567890ab');
  });

  it('serves bundled reference files', async () => {
    const result = await gateway.executeCall(
      call({ name: 'alpha', file: 'refs/notes.md' }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect((result.data as { content: string }).content).toBe('reference notes');
  });

  it('rejects traversal outside the skill folder', async () => {
    const result = await gateway.executeCall(
      call({ name: 'alpha', file: '../secrets.txt' }),
      new AbortController().signal,
    );
    expect(result.ok).toBe(true); // tool returns a structured error, not a crash
    expect(result.code).toBe('SKILL_PATH_OUTSIDE');
  });

  it('rejects a bundled symlink whose canonical target escapes the skill root', async () => {
    const outside = `${dir}-outside.txt`;
    writeFileSync(outside, 'not bundled');
    symlinkSync(outside, join(dir, 'escape.txt'));
    try {
      const result = await gateway.executeCall(
        call({ name: 'alpha', file: 'escape.txt' }),
        new AbortController().signal,
      );
      expect(result.code).toBe('SKILL_PATH_OUTSIDE');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('fails closed when a linked skill root is retargeted after discovery', async () => {
    skills = [{ ...skills[0]!, canonicalDir: `${dir}-different-target` }];
    const result = await gateway.executeCall(call({ name: 'alpha' }), new AbortController().signal);
    expect(result.code).toBe('SKILL_SOURCE_CHANGED');
    expect(result.retryable).toBe(true);
  });

  it('names enabled skills when the requested one is unknown', async () => {
    const result = await gateway.executeCall(call({ name: 'nope' }), new AbortController().signal);
    expect(result.code).toBe('SKILL_NOT_FOUND');
    expect(result.summary).toContain('alpha');
    // Disabled-at-runtime skills disappear immediately (provider is live).
    skills = [];
    const again = await gateway.executeCall(call({ name: 'alpha' }), new AbortController().signal);
    expect(again.code).toBe('SKILL_NOT_FOUND');
    expect(again.summary).toContain('No skills are enabled');
  });

  it('flags binary files instead of returning bytes', async () => {
    const result = await gateway.executeCall(
      call({ name: 'alpha', file: 'blob.bin' }),
      new AbortController().signal,
    );
    expect(result.code).toBe('BINARY_FILE');
    expect((result.data as { binary: boolean }).binary).toBe(true);
  });
});
