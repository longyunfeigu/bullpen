import { describe, expect, it } from 'vitest';
import { ProductFailure, createLogger } from '@pi-ide/foundation';
import type { ModelDescriptor } from '@pi-ide/agent-contract';
import { ModelCatalogService, type CatalogProvider, type FetchLike } from './model-catalog.js';

const logger = createLogger('test', { write: () => undefined });

function fetchReturning(status: number, body: unknown): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function provider(overrides: Partial<CatalogProvider> = {}): CatalogProvider {
  return {
    providerId: 'anthropic',
    displayName: 'Anthropic',
    api: 'anthropic',
    apiKey: 'sk-test-123',
    baseUrl: 'https://api.anthropic.com',
    ...overrides,
  };
}

const anthropicBody = {
  data: [
    { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
  ],
};

describe('ModelCatalogService (PIVOT-009/033)', () => {
  it('fetches, maps and caches provider models with the stored key', async () => {
    let seenHeaders: Record<string, string> | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      seenHeaders = init.headers;
      return { ok: true, status: 200, json: async () => anthropicBody };
    };
    const catalog = new ModelCatalogService(() => provider(), logger, fetchImpl);
    const models = await catalog.fetchRemote('anthropic');
    expect(models.map((m) => m.modelId)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
    expect(models[0]!.displayName).toBe('Claude Opus 4.8');
    expect(models[0]!.configured).toBe(true);
    expect(seenHeaders!['x-api-key']).toBe('sk-test-123');
    expect(catalog.cached()).toHaveLength(2);
  });

  it('merges fetched models into the registry without duplicating ids', async () => {
    const catalog = new ModelCatalogService(
      () => provider(),
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

  it('classifies missing keys and bad keys', async () => {
    const noKey = new ModelCatalogService(() => null, logger, fetchReturning(200, {}));
    await expect(noKey.fetchRemote('anthropic')).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'MODELS_NO_CREDENTIAL',
    );

    const badKey = new ModelCatalogService(() => provider(), logger, fetchReturning(401, {}));
    await expect(badKey.fetchRemote('anthropic')).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'MODELS_BAD_CREDENTIAL',
    );
  });

  it('uses the gateway base URL for anthropic-protocol providers, both auth headers', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return { ok: true, status: 200, json: async () => anthropicBody };
    };
    const catalog = new ModelCatalogService(
      () => provider({ apiKey: 'cr-gw-1', baseUrl: 'http://10.0.0.9:3000/api/' }),
      logger,
      fetchImpl,
    );
    await catalog.fetchRemote('anthropic');
    expect(seenUrl).toBe('http://10.0.0.9:3000/api/v1/models');
    expect(seenHeaders['x-api-key']).toBe('cr-gw-1');
    expect(seenHeaders['Authorization']).toBe('Bearer cr-gw-1');
  });

  it('filters the OFFICIAL OpenAI list down to chat-capable models', async () => {
    const catalog = new ModelCatalogService(
      () => provider({ providerId: 'openai', displayName: 'OpenAI', api: 'openai', baseUrl: null }),
      logger,
      fetchReturning(200, {
        data: [{ id: 'gpt-5.2' }, { id: 'o4-mini' }, { id: 'whisper-1' }, { id: 'dall-e-3' }],
      }),
    );
    const models = await catalog.fetchRemote('openai');
    expect(models.map((m) => m.modelId)).toEqual(['gpt-5.2', 'o4-mini']);
  });

  it('OpenRouter: /models on the base, Bearer auth, name + context_length mapped, no filter', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'anthropic/claude-sonnet-4.5',
              name: 'Claude Sonnet 4.5',
              context_length: 200000,
            },
            { id: 'meta-llama/llama-4-70b', name: 'Llama 4 70B', context_length: 131072 },
          ],
        }),
      };
    };
    const catalog = new ModelCatalogService(
      () =>
        provider({
          providerId: 'openrouter',
          displayName: 'OpenRouter',
          api: 'openai',
          apiKey: 'sk-or-1',
          baseUrl: 'https://openrouter.ai/api/v1',
        }),
      logger,
      fetchImpl,
    );
    const models = await catalog.fetchRemote('openrouter');
    expect(seenUrl).toBe('https://openrouter.ai/api/v1/models');
    expect(seenHeaders['Authorization']).toBe('Bearer sk-or-1');
    expect(seenHeaders['x-api-key']).toBeUndefined();
    expect(models.map((m) => m.modelId)).toEqual([
      'anthropic/claude-sonnet-4.5',
      'meta-llama/llama-4-70b',
    ]);
    expect(models[0]!.displayName).toBe('Claude Sonnet 4.5');
    expect(models[0]!.contextWindow).toBe(200000);
    expect(models[0]!.providerName).toBe('OpenRouter');
  });

  it('LiteLLM/custom openai-compatible providers refuse to fetch without a base URL', async () => {
    const catalog = new ModelCatalogService(
      () =>
        provider({ providerId: 'litellm', displayName: 'LiteLLM', api: 'openai', baseUrl: null }),
      logger,
      fetchReturning(200, { data: [] }),
    );
    await expect(catalog.fetchRemote('litellm')).rejects.toSatisfy(
      (e: unknown) => e instanceof ProductFailure && e.error.code === 'MODELS_NO_BASE_URL',
    );
  });

  it('evict() forgets a deleted provider; other caches survive', async () => {
    const catalog = new ModelCatalogService(
      () => provider(),
      logger,
      fetchReturning(200, anthropicBody),
    );
    await catalog.fetchRemote('anthropic');
    expect(catalog.cached()).toHaveLength(2);
    catalog.evict('anthropic');
    expect(catalog.cached()).toHaveLength(0);
  });
});
