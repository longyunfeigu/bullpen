import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage, productError, ProductFailure, type Logger } from '@pi-ide/foundation';
import type { SshSecretKind } from '@pi-ide/ipc-contracts';

/**
 * SSH passwords and key passphrases, encrypted with the OS keychain (ADR-0047).
 *
 * Deliberately separate from SecretService (which is provider/api-key shaped):
 * its own directory keeps the provider list scan clean, and this vault never
 * exposes plaintext to the renderer — callers get a boolean, or (main-process
 * only) the decrypted value for a single handshake. Nothing is logged in clear.
 */
export class SshVaultService {
  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(hostId: string, kind: SshSecretKind): string {
    const safe = hostId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `host-${safe}-${kind}.bin`);
  }

  set(hostId: string, kind: SshSecretKind, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ProductFailure(
        productError('SEC_ENCRYPTION_UNAVAILABLE', {
          userMessage: 'OS-level encryption is unavailable; SSH secrets cannot be stored safely.',
          severity: 'fatal',
        }),
      );
    }
    const file = this.fileFor(hostId, kind);
    // payload kind is a self-check; no hint is stored (SSH secrets are not shown).
    const encrypted = safeStorage.encryptString(JSON.stringify({ kind, value }));
    writeFileSync(file, encrypted);
    writeFileSync(
      `${file}.meta`,
      JSON.stringify({ hostId, kind, updatedAt: new Date().toISOString() }),
    );
    this.logger.info('ssh secret stored', { hostId, kind });
  }

  has(hostId: string, kind: SshSecretKind): boolean {
    return existsSync(this.fileFor(hostId, kind));
  }

  clear(hostId: string, kind: SshSecretKind): boolean {
    const file = this.fileFor(hostId, kind);
    const existed = existsSync(file);
    rmSync(file, { force: true });
    rmSync(`${file}.meta`, { force: true });
    if (existed) this.logger.info('ssh secret cleared', { hostId, kind });
    return existed;
  }

  /** Remove every secret for a host (used when the host is deleted). */
  clearHost(hostId: string): void {
    this.clear(hostId, 'password');
    this.clear(hostId, 'passphrase');
  }

  /** Decrypt for a single handshake (main-process only, never to the renderer). */
  get(hostId: string, kind: SshSecretKind): string | null {
    const file = this.fileFor(hostId, kind);
    if (!existsSync(file)) return null;
    try {
      const payload = JSON.parse(safeStorage.decryptString(readFileSync(file))) as {
        kind: string;
        value: string;
      };
      if (payload.kind !== kind) return null;
      return payload.value;
    } catch (e) {
      this.logger.warn('ssh secret unreadable', { hostId, kind, error: errorMessage(e) });
      return null;
    }
  }
}
