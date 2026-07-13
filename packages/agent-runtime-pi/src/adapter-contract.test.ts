import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Contract tests may import pi here: this package is the sanctioned adapter boundary.
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { PiAgentRuntime } from './index.js';
import type { ToolExecutor } from '@pi-ide/agent-contract';

const executor: ToolExecutor = async (call) => ({
  callId: call.callId,
  ok: true,
  code: 'OK',
  summary: 'noop',
  data: {},
});

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pi-ide-adapter-'));
});
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Pi adapter contract (AG-013 / ADR-0001)', () => {
  it('pi model catalog is available offline and includes anthropic models', () => {
    const auth = AuthStorage.inMemory({ anthropic: { type: 'api_key', key: 'sk-test-000' } });
    const registry = ModelRegistry.inMemory(auth);
    const models = registry.getAvailable();
    expect(models.length).toBeGreaterThan(5);
    expect(models.some((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('adapter initializes offline and lists models with configured flags', async () => {
    const runtime = new PiAgentRuntime({
      toolExecutor: executor,
      credentials: [{ providerId: 'anthropic', kind: 'api-key', value: 'sk-test-000' }],
    });
    const info = await runtime.initialize({ runtimeDataDir: dataDir, appVersion: '1.0.0' });
    expect(info.runtimeId).toBe('pi');
    expect(info.runtimeVersion).toMatch(/^\d+\.\d+\.\d+/);
    const models = await runtime.listModels();
    const anthropic = models.filter((m) => m.providerId === 'anthropic');
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((m) => m.configured)).toBe(true);
    await runtime.dispose();
  });

  it('SECURITY CONTRACT: sessions expose ONLY gateway tools — no pi built-ins (TOOL-001)', async () => {
    const runtime = new PiAgentRuntime({
      toolExecutor: executor,
      credentials: [{ providerId: 'anthropic', kind: 'api-key', value: 'sk-test-000' }],
    });
    await runtime.initialize({ runtimeDataDir: dataDir, appVersion: '1.0.0' });
    const models = await runtime.listModels();
    const model = models.find((m) => m.providerId === 'anthropic')!;

    const ref = await runtime.createSession({
      taskId: 'contract-task',
      workspaceRoot: dataDir,
      mode: 'ask',
      model: { providerId: model.providerId, modelId: model.modelId },
      tools: [
        {
          name: 'read_file',
          description: 'read',
          schemaVersion: 1,
          inputJsonSchema: { type: 'object' },
        },
        {
          name: 'search_text',
          description: 'search',
          schemaVersion: 1,
          inputJsonSchema: { type: 'object' },
        },
      ],
      systemPreamble: 'contract test',
    });
    expect(ref.runtimeId).toBe('pi');
    expect(ref.externalSessionId).toBeTruthy();

    const session = runtime.sessionForTest(ref.sessionId);
    expect(session).toBeTruthy();
    const active = session!.getActiveToolNames().sort();
    expect(active).toEqual(['read_file', 'search_text']);
    for (const forbidden of ['bash', 'edit', 'write', 'read']) {
      expect(active, `built-in "${forbidden}" must not be active`).not.toContain(forbidden);
    }
    // Session persistence lives under OUR runtime dir, not ~/.pi (HIST-003 reference only).
    expect(session!.sessionFile ?? '').toContain(dataDir);
    expect(existsSync(join(dataDir, 'sessions', 'contract-task'))).toBe(true);
    await runtime.dispose();
  });
});
