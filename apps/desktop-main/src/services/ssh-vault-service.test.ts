import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// safeStorage is unavailable outside a running Electron app; emulate it with a
// reversible-but-non-plaintext transform so the vault's on-disk isolation is
// still observable (the ciphertext must never equal the secret).
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`).reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf8').replace(/^enc:/, ''),
  },
}));

import { SshVaultService } from './ssh-vault-service.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => logger,
} as unknown as import('@pi-ide/foundation').Logger;

describe('SshVaultService (ADR-0047)', () => {
  let dir: string;
  let vault: SshVaultService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssh-vault-'));
    vault = new SshVaultService(dir, logger);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores, reads back, and clears a password', () => {
    expect(vault.has('h1', 'password')).toBe(false);
    vault.set('h1', 'password', 'hunter2');
    expect(vault.has('h1', 'password')).toBe(true);
    expect(vault.get('h1', 'password')).toBe('hunter2');
    expect(vault.clear('h1', 'password')).toBe(true);
    expect(vault.has('h1', 'password')).toBe(false);
    expect(vault.get('h1', 'password')).toBeNull();
  });

  it('keeps password and passphrase independent per host', () => {
    vault.set('h1', 'password', 'pw');
    vault.set('h1', 'passphrase', 'pp');
    expect(vault.get('h1', 'password')).toBe('pw');
    expect(vault.get('h1', 'passphrase')).toBe('pp');
    vault.clearHost('h1');
    expect(vault.has('h1', 'password')).toBe(false);
    expect(vault.has('h1', 'passphrase')).toBe(false);
  });

  it('never writes the plaintext secret to disk', () => {
    vault.set('h1', 'password', 'topsecret-value');
    for (const name of readdirSync(dir)) {
      const contents = readFileSync(join(dir, name));
      expect(contents.includes(Buffer.from('topsecret-value'))).toBe(false);
    }
  });

  it('meta files carry no secret material', () => {
    vault.set('h1', 'passphrase', 'my-passphrase');
    const meta = readdirSync(dir).find((n) => n.endsWith('.meta'))!;
    const parsed = JSON.parse(readFileSync(join(dir, meta), 'utf8'));
    expect(parsed).toMatchObject({ hostId: 'h1', kind: 'passphrase' });
    expect(JSON.stringify(parsed)).not.toContain('my-passphrase');
  });

  it('sanitizes host ids into safe filenames', () => {
    vault.set('../evil/../h', 'password', 'x');
    for (const name of readdirSync(dir)) {
      expect(name.includes('/')).toBe(false);
      expect(name.includes('..')).toBe(false);
    }
  });
});
