import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { productError, ProductFailure, type Logger } from '@pi-ide/foundation';
import type { WorkerCredential } from '@pi-ide/agent-contract';

/**
 * Provider credentials encrypted with the OS keychain scope (ONB-004).
 * The renderer only ever sees `configured` + a masked hint; plaintext exists
 * in the main process transiently and in the agent worker for the session.
 */
export class SecretService {
  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(providerId: string): string {
    const safe = providerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `${safe}.bin`);
  }

  setApiKey(providerId: string, apiKey: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ProductFailure(
        productError('SEC_ENCRYPTION_UNAVAILABLE', {
          userMessage: 'OS-level encryption is unavailable; credentials cannot be stored safely.',
          severity: 'fatal',
        }),
      );
    }
    const payload = JSON.stringify({ kind: 'api-key', value: apiKey });
    const encrypted = safeStorage.encryptString(payload);
    const hint = apiKey.length > 4 ? `…${apiKey.slice(-4)}` : '…';
    writeFileSync(this.fileFor(providerId), encrypted);
    writeFileSync(
      `${this.fileFor(providerId)}.meta`,
      JSON.stringify({ providerId, hint, updatedAt: new Date().toISOString() }),
    );
    this.logger.info('credential stored', { providerId });
  }

  delete(providerId: string): boolean {
    const file = this.fileFor(providerId);
    const existed = existsSync(file);
    rmSync(file, { force: true });
    rmSync(`${file}.meta`, { force: true });
    if (existed) this.logger.info('credential deleted', { providerId });
    return existed;
  }

  list(): Array<{ providerId: string; configured: boolean; hint: string }> {
    const items: Array<{ providerId: string; configured: boolean; hint: string }> = [];
    try {
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith('.meta')) continue;
        try {
          const meta = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as {
            providerId: string;
            hint: string;
          };
          items.push({ providerId: meta.providerId, configured: true, hint: meta.hint });
        } catch {
          // skip broken meta
        }
      }
    } catch {
      // dir unreadable
    }
    return items;
  }

  hasAny(): boolean {
    return this.list().length > 0;
  }

  /** Decrypted credentials for the agent worker (never crosses to the renderer). */
  credentialsForWorker(): WorkerCredential[] {
    const credentials: WorkerCredential[] = [];
    for (const item of this.list()) {
      try {
        const encrypted = readFileSync(this.fileFor(item.providerId));
        const payload = JSON.parse(safeStorage.decryptString(encrypted)) as {
          kind: string;
          value: string;
        };
        if (payload.kind === 'api-key') {
          credentials.push({ providerId: item.providerId, kind: 'api-key', value: payload.value });
        }
      } catch (e) {
        this.logger.warn('credential unreadable', {
          providerId: item.providerId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return credentials;
  }
}
