import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostKeyStore } from './host-keys.js';

let dir: string;
let trustedHostsFile: string;
let knownHostsFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-ide-ssh-hostkeys-'));
  trustedHostsFile = join(dir, 'sub', 'trusted-hosts.json');
  knownHostsFile = join(dir, 'known_hosts');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Build a synthetic SSH key blob: uint32be length + type + random key body. */
function makeKeyBlob(type = 'ssh-ed25519', body: Buffer = randomBytes(32)): Buffer {
  const typeBuf = Buffer.from(type, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(typeBuf.length, 0);
  return Buffer.concat([len, typeBuf, body]);
}

function fingerprintOf(blob: Buffer): string {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

describe('createHostKeyStore (SSH-HOSTKEY)', () => {
  it('TOFU: unknown, then remember, then trusted', () => {
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile: null });
    const blob = makeKeyBlob();

    const first = store.check('example.com', 22, blob);
    expect(first.status).toBe('unknown');
    expect(first.keyType).toBe('ssh-ed25519');
    expect(first.fingerprintSha256).toBe(fingerprintOf(blob));
    expect(first.knownFingerprint).toBeNull();

    store.remember('example.com', 22, blob);

    const second = store.check('example.com', 22, blob);
    expect(second.status).toBe('trusted');
    expect(second.fingerprintSha256).toBe(fingerprintOf(blob));
  });

  it('reports mismatch when a remembered host presents a different key', () => {
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile: null });
    const original = makeKeyBlob();
    const rotated = makeKeyBlob();
    store.remember('example.com', 22, original);

    const check = store.check('example.com', 22, rotated);
    expect(check.status).toBe('mismatch');
    expect(check.fingerprintSha256).toBe(fingerprintOf(rotated));
    expect(check.knownFingerprint).toBe(fingerprintOf(original));
  });

  it('forget drops the trusted entry back to unknown', () => {
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile: null });
    const blob = makeKeyBlob();
    store.remember('example.com', 22, blob);
    expect(store.check('example.com', 22, blob).status).toBe('trusted');

    store.forget('example.com', 22);
    expect(store.check('example.com', 22, blob).status).toBe('unknown');
  });

  it('writes the trust store atomically as versioned JSON', () => {
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile: null });
    const blob = makeKeyBlob();
    store.remember('example.com', 22, blob);

    const parsed = JSON.parse(readFileSync(trustedHostsFile, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].host).toBe('example.com');
    expect(parsed.entries[0].fingerprintSha256).toBe(fingerprintOf(blob));
  });

  it('trusts a plaintext known_hosts line', () => {
    const blob = makeKeyBlob();
    writeFileSync(knownHostsFile, `example.com ssh-ed25519 ${blob.toString('base64')}\n`, 'utf8');
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile });
    expect(store.check('example.com', 22, blob).status).toBe('trusted');
  });

  it('matches the [host]:port known_hosts form for non-default ports', () => {
    const blob = makeKeyBlob();
    writeFileSync(
      knownHostsFile,
      `[example.com]:2222 ssh-ed25519 ${blob.toString('base64')}\n`,
      'utf8',
    );
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile });
    expect(store.check('example.com', 2222, blob).status).toBe('trusted');
    // The same key on port 22 is not covered by the [host]:2222 entry.
    expect(store.check('example.com', 22, blob).status).toBe('unknown');
  });

  it('trusts a hashed (|1|salt|hash) known_hosts line', () => {
    const blob = makeKeyBlob();
    const salt = randomBytes(20);
    const hash = createHmac('sha1', salt).update('example.com').digest('base64');
    writeFileSync(
      knownHostsFile,
      `|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${blob.toString('base64')}\n`,
      'utf8',
    );
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile });
    expect(store.check('example.com', 22, blob).status).toBe('trusted');
    expect(store.check('other.example.com', 22, blob).status).toBe('unknown');
  });

  it('reports mismatch when known_hosts holds a different key of the same type', () => {
    const stored = makeKeyBlob();
    const presented = makeKeyBlob();
    writeFileSync(knownHostsFile, `example.com ssh-ed25519 ${stored.toString('base64')}\n`, 'utf8');
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile });
    const check = store.check('example.com', 22, presented);
    expect(check.status).toBe('mismatch');
    expect(check.knownFingerprint).toBe(fingerprintOf(stored));
  });

  it('skips @revoked marker lines instead of trusting them', () => {
    const blob = makeKeyBlob();
    writeFileSync(
      knownHostsFile,
      `@revoked example.com ssh-ed25519 ${blob.toString('base64')}\n`,
      'utf8',
    );
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile });
    expect(store.check('example.com', 22, blob).status).toBe('unknown');
  });

  it('tolerates malformed known_hosts lines, degrading to unknown', () => {
    const blob = makeKeyBlob();
    writeFileSync(knownHostsFile, 'garbageline\nonly two\n# a comment\n\n', 'utf8');
    const store = createHostKeyStore({ trustedHostsFile, knownHostsFile });
    expect(store.check('example.com', 22, blob).status).toBe('unknown');
  });

  it('treats a corrupt trust-store JSON as an empty store', () => {
    const corruptFile = join(dir, 'corrupt-trusted.json');
    writeFileSync(corruptFile, '{ not valid json', 'utf8');
    const store = createHostKeyStore({ trustedHostsFile: corruptFile, knownHostsFile: null });
    const blob = makeKeyBlob();
    expect(store.check('example.com', 22, blob).status).toBe('unknown');
  });
});
