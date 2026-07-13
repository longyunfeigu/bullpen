import { describe, expect, it } from 'vitest';
import { ProductFailure, createLogger } from '@pi-ide/foundation';
import type { ModelDescriptor } from '@pi-ide/agent-contract';
import { ModelCatalogService, type FetchLike } from './model-catalog.js';

const logger = createLogger('test', { write: () => undefined });

function fetchReturning(status: number, body: unknown): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const anthropicBody = {
  data: [
    { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
  ],
};

describe('ModelCatalogService (PIVOT-009)', () => {
  it('fetches, maps and caches provider models with the stored key', async () => {
    let seenHeaders: Record<string, string> | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      seenHeaders = init.headers;
      return { ok: true, status: 200, json: async () => anthropicBody };
    };
    const catalog = new ModelCatalogService(
      () => ({ apiKey: 'sk-test-123', baseUrl: null }),
      logger,
      fetchImpl,
    );
    const models = await catalog.fetchRemote('anthropic');
    expect(models.map((m) => m.modelId)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
    expect(models[0]!.displayName).toBe('Claude Opus 4.8');
    expect(models[0]!.configured).toBe(true);
    expect(seenHeaders!['x-api-key']).toBe('sk-test-123');
    expect(catalog.cached()).toHaveLength(2);
  });

  it('merges fetched models into the registry without duplicating ids', async () => {
    const catalog = new ModelCatalogService(
      () => ({ apiKey: 'sk-x', baseUrl: null }),
      logger,
      fetchReturning(200, anthropicBody),
    );
    await catalog.fetchRemote('anthropic');
    const registry: ModelDescriptor[] = [
      {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-opus-4-8',
        displayName: 'Opus (registry)',
        contextWindow: 200000,
        supportsThinking: true,
        configured: true,
        authKind: 'api-key',
      },
    ];
    const merged = catalog.merge(registry);
    expect(merged).toHaveLength(2); // registry opus + fetched haiku
    expect(merged.find((m) => m.modelId === 'claude-opus-4-8')!.displayName).toBe(
      'Opus (registry)',
    );
  });

  it('classifies missing keys, bad keys and unsupported providers', async () => {
    const noKey = new ModelCatalogService(() => null, logger, fetchReturning(200, {}));
    await expect(noKey.fetchRemote('anthropic')).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'MODELS_NO_CREDENTIAL',
    );

    const badKey = new ModelCatalogService(
      () => ({ apiKey: 'sk-bad', baseUrl: null }),
      logger,
      fetchReturning(401, {}),
    );
    await expect(badKey.fetchRemote('anthropic')).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'MODELS_BAD_CREDENTIAL',
    );

    const catalog = new ModelCatalogService(
      () => ({ apiKey: 'sk-x', baseUrl: null }),
      logger,
      fetchReturning(200, {}),
    );
    await expect(catalog.fetchRemote('nope')).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'MODELS_PROVIDER_UNSUPPORTED',
    );
  });

  it('uses the credential base URL for gateways and keeps both auth headers', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return { ok: true, status: 200, json: async () => anthropicBody };
    };
    const catalog = new ModelCatalogService(
      () => ({ apiKey: 'cr-gw-1', baseUrl: 'http://10.0.0.9:3000/api/' }),
      logger,
      fetchImpl,
    );
    await catalog.fetchRemote('anthropic');
    expect(seenUrl).toBe('http://10.0.0.9:3000/api/v1/models');
    expect(seenHeaders['x-api-key']).toBe('cr-gw-1');
    expect(seenHeaders['Authorization']).toBe('Bearer cr-gw-1');
  });

  it('filters OpenAI ids down to chat-capable models', async () => {
    const catalog = new ModelCatalogService(
      () => ({ apiKey: 'sk-x', baseUrl: null }),
      logger,
      fetchReturning(200, {
        data: [{ id: 'gpt-5.2' }, { id: 'o4-mini' }, { id: 'whisper-1' }, { id: 'dall-e-3' }],
      }),
    );
    const models = await catalog.fetchRemote('openai');
    expect(models.map((m) => m.modelId)).toEqual(['gpt-5.2', 'o4-mini']);
  });
});
