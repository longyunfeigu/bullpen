import { productError, ProductFailure, type Logger } from '@pi-ide/foundation';
import type { ModelDescriptor } from '@pi-ide/agent-contract';

export interface ProviderEndpoint {
  providerId: string;
  providerName: string;
  url: string;
  headers(apiKey: string): Record<string, string>;
  /** Map the provider's response body to model descriptors. */
  map(body: unknown): Array<{ modelId: string; displayName: string; contextWindow?: number }>;
}

/** Public model-list endpoints for providers the runtime can execute against. */
export const PROVIDER_ENDPOINTS: ProviderEndpoint[] = [
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    url: 'https://api.anthropic.com/v1/models?limit=100',
    headers: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
    map: (body) => {
      const data = (body as { data?: Array<{ id: string; display_name?: string }> }).data ?? [];
      return data.map((m) => ({ modelId: m.id, displayName: m.display_name ?? m.id }));
    },
  },
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    url: 'https://api.openai.com/v1/models',
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    map: (body) => {
      const data = (body as { data?: Array<{ id: string }> }).data ?? [];
      // The OpenAI list includes non-chat artifacts; keep model-ish ids only.
      return data
        .filter((m) => /^(gpt|o[0-9]|chatgpt)/i.test(m.id))
        .map((m) => ({ modelId: m.id, displayName: m.id }));
    },
  },
];

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Live provider model catalog (PIVOT-009, ONB-002): fetches the provider's
 * public model list with the stored key, caches per session, and merges into
 * the registry-backed models.list. Runs entirely in the main process.
 */
export class ModelCatalogService {
  private readonly cache = new Map<string, ModelDescriptor[]>();

  constructor(
    private readonly getApiKey: (providerId: string) => string | null,
    private readonly logger: Logger,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly timeoutMs = 12_000,
  ) {}

  supportedProviders(): string[] {
    return PROVIDER_ENDPOINTS.map((p) => p.providerId);
  }

  cached(): ModelDescriptor[] {
    return [...this.cache.values()].flat();
  }

  /** Merge registry models with remotely fetched ones (registry wins on id clashes). */
  merge(registry: ModelDescriptor[]): ModelDescriptor[] {
    const seen = new Set(registry.map((m) => `${m.providerId}::${m.modelId}`));
    const merged = [...registry];
    for (const model of this.cached()) {
      const key = `${model.providerId}::${model.modelId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(model);
      }
    }
    return merged;
  }

  async fetchRemote(providerId: string): Promise<ModelDescriptor[]> {
    const endpoint = PROVIDER_ENDPOINTS.find((p) => p.providerId === providerId);
    if (!endpoint) {
      throw new ProductFailure(
        productError('MODELS_PROVIDER_UNSUPPORTED', {
          userMessage: `Live model listing is not supported for "${providerId}" yet.`,
        }),
      );
    }
    const apiKey = this.getApiKey(providerId);
    if (!apiKey) {
      throw new ProductFailure(
        productError('MODELS_NO_CREDENTIAL', {
          userMessage: `Add an API key for ${endpoint.providerName} first, then fetch models.`,
        }),
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(endpoint.url, {
        headers: endpoint.headers(apiKey),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProductFailure(
          productError(response.status === 401 ? 'MODELS_BAD_CREDENTIAL' : 'MODELS_FETCH_FAILED', {
            userMessage:
              response.status === 401
                ? `${endpoint.providerName} rejected the API key (401). Check the key in Settings.`
                : `${endpoint.providerName} model list failed with HTTP ${response.status}.`,
            retryable: response.status !== 401,
          }),
        );
      }
      const body = await response.json();
      const models: ModelDescriptor[] = endpoint.map(body).map((m) => ({
        providerId: endpoint.providerId,
        providerName: endpoint.providerName,
        modelId: m.modelId,
        displayName: m.displayName,
        contextWindow: m.contextWindow ?? null,
        supportsThinking: false,
        configured: true,
        authKind: 'api-key',
      }));
      this.cache.set(providerId, models);
      this.logger.info('remote models fetched', { providerId, count: models.length });
      return models;
    } catch (e) {
      if (e instanceof ProductFailure) throw e;
      throw new ProductFailure(
        productError('MODELS_FETCH_FAILED', {
          userMessage: `Could not reach ${endpoint.providerName} to list models (network error or timeout).`,
          technicalMessage: e instanceof Error ? e.message : String(e),
          retryable: true,
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
