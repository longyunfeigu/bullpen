/**
 * Host-key trust for Charter Remotes (ADR-0047).
 *
 * TOFU against a product-owned trust store, with read-only fallback to an
 * OpenSSH `known_hosts` file. Pure Node — no ssh2, no Electron. A parse error
 * anywhere degrades to "unknown"; it must never manufacture a "trusted" result.
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { HostKeyCheck, HostKeyStore } from './types.js';

interface TrustedEntry {
  host: string;
  port: number;
  keyType: string;
  fingerprintSha256: string;
  addedAt: string;
}

/** OpenSSH-style "SHA256:<base64 without padding>" over the raw key blob. */
function fingerprintOf(keyBlob: Buffer): string {
  const digest = createHash('sha256').update(keyBlob).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/** Parse the key type from an SSH key blob: uint32be length + type string. */
function keyTypeOf(keyBlob: Buffer): string {
  if (keyBlob.length < 4) return '';
  const len = keyBlob.readUInt32BE(0);
  if (len <= 0 || len > keyBlob.length - 4) return '';
  return keyBlob.subarray(4, 4 + len).toString('utf8');
}

/** Host pattern OpenSSH hashes/stores: bare host on 22, else "[host]:port". */
function hostPattern(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

function isTrustedEntry(value: unknown): value is TrustedEntry {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.host === 'string' &&
    typeof o.port === 'number' &&
    typeof o.keyType === 'string' &&
    typeof o.fingerprintSha256 === 'string'
  );
}

export function createHostKeyStore(opts: {
  trustedHostsFile: string;
  knownHostsFile: string | null;
}): HostKeyStore {
  const { trustedHostsFile, knownHostsFile } = opts;

  function loadTrusted(): TrustedEntry[] {
    try {
      if (!existsSync(trustedHostsFile)) return [];
      const parsed: unknown = JSON.parse(readFileSync(trustedHostsFile, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return [];
      const entries = (parsed as { entries?: unknown }).entries;
      if (!Array.isArray(entries)) return [];
      return entries.filter(isTrustedEntry);
    } catch {
      // Missing or corrupt store behaves as an empty store, never an error.
      return [];
    }
  }

  function saveTrusted(entries: TrustedEntry[]): void {
    const dir = dirname(trustedHostsFile);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${basename(trustedHostsFile)}.tmp-${process.pid}`);
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
    renameSync(tmp, trustedHostsFile);
  }

  /** Does one comma-separated known_hosts host field cover host:port? */
  function knownHostsFieldMatches(field: string, host: string, port: number): boolean {
    const pattern = hostPattern(host, port);
    for (const raw of field.split(',')) {
      const token = raw.trim();
      if (!token) continue;
      try {
        if (token.startsWith('|1|')) {
          // |1|<salt-b64>|<hash-b64>: HMAC-SHA1 of the host pattern.
          const parts = token.split('|');
          if (parts.length !== 4) continue;
          const salt = parts[2];
          const hash = parts[3];
          if (!salt || !hash) continue;
          const hmac = createHmac('sha1', Buffer.from(salt, 'base64'))
            .update(pattern)
            .digest('base64');
          if (hmac === hash) return true;
        } else if (token === pattern) {
          return true;
        }
      } catch {
        // A malformed token is skipped; it can never yield a match.
      }
    }
    return false;
  }

  /**
   * Look up host:port in known_hosts for the given key type. Returns null when
   * no line covers this host+type. A structurally broken line is skipped so it
   * can never be read as trusted.
   */
  function checkKnownHosts(
    host: string,
    port: number,
    presentedKeyType: string,
    presentedFingerprint: string,
  ): { status: 'trusted' | 'mismatch'; knownFingerprint: string | null } | null {
    if (!knownHostsFile) return null;
    let text: string;
    try {
      if (!existsSync(knownHostsFile)) return null;
      text = readFileSync(knownHostsFile, 'utf8');
    } catch {
      return null;
    }
    let mismatchFingerprint: string | null = null;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      try {
        const fields = line.split(/\s+/);
        // Skip @cert-authority / @revoked marker lines entirely.
        if (fields[0]?.startsWith('@')) continue;
        const hostField = fields[0];
        const keyType = fields[1];
        const keyB64 = fields[2];
        if (!hostField || !keyType || !keyB64) continue;
        if (keyType !== presentedKeyType) continue;
        if (!knownHostsFieldMatches(hostField, host, port)) continue;
        const fingerprint = fingerprintOf(Buffer.from(keyB64, 'base64'));
        if (fingerprint === presentedFingerprint) {
          return { status: 'trusted', knownFingerprint: null };
        }
        if (mismatchFingerprint === null) mismatchFingerprint = fingerprint;
      } catch {
        // Never let a parse error escalate into a trusted verdict.
      }
    }
    if (mismatchFingerprint !== null) {
      return { status: 'mismatch', knownFingerprint: mismatchFingerprint };
    }
    return null;
  }

  return {
    check(host: string, port: number, keyBlob: Buffer): HostKeyCheck {
      const fingerprintSha256 = fingerprintOf(keyBlob);
      const keyType = keyTypeOf(keyBlob);

      const stored = loadTrusted().find(
        (e) => e.host === host && e.port === port && e.keyType === keyType,
      );
      if (stored) {
        if (stored.fingerprintSha256 === fingerprintSha256) {
          return { status: 'trusted', fingerprintSha256, keyType, knownFingerprint: null };
        }
        return {
          status: 'mismatch',
          fingerprintSha256,
          keyType,
          knownFingerprint: stored.fingerprintSha256,
        };
      }

      const fromKnownHosts = checkKnownHosts(host, port, keyType, fingerprintSha256);
      if (fromKnownHosts) {
        return {
          status: fromKnownHosts.status,
          fingerprintSha256,
          keyType,
          knownFingerprint: fromKnownHosts.knownFingerprint,
        };
      }

      return { status: 'unknown', fingerprintSha256, keyType, knownFingerprint: null };
    },

    remember(host: string, port: number, keyBlob: Buffer): void {
      const fingerprintSha256 = fingerprintOf(keyBlob);
      const keyType = keyTypeOf(keyBlob);
      const entries = loadTrusted().filter(
        (e) => !(e.host === host && e.port === port && e.keyType === keyType),
      );
      entries.push({ host, port, keyType, fingerprintSha256, addedAt: new Date().toISOString() });
      saveTrusted(entries);
    },

    forget(host: string, port: number): void {
      const entries = loadTrusted().filter((e) => !(e.host === host && e.port === port));
      saveTrusted(entries);
    },
  };
}
