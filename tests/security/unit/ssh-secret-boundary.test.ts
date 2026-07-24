import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CHANNELS, EVENT_CHANNELS } from '@pi-ide/ipc-contracts';

/**
 * ADR-0047 secret-boundary invariant: SSH secrets flow renderer→main ONLY.
 * No `ssh.*` response schema and no `ssh.*` event payload may carry a
 * password, passphrase, or private-key material. The only request payloads
 * allowed a secret field are `ssh.setSecret` and `ssh.respondAuth` (both
 * renderer→main). This test walks the actual zod schemas so a future channel
 * that leaks a secret back to the renderer fails here.
 */

const SECRET_KEY_RE = /pass(word|phrase)|secret|privatekey|private_key|credential/i;
/** `hasPassword` / `hasPassphrase` are boolean presence flags, not secrets. */
const PRESENCE_FLAG_RE = /^has[A-Z]/;
const isSecretKey = (k: string): boolean => SECRET_KEY_RE.test(k) && !PRESENCE_FLAG_RE.test(k);
/** `value` is only legitimate on the two renderer→main secret inputs. */
const VALUE_ALLOWED_REQUESTS = new Set(['ssh.setSecret', 'ssh.respondAuth']);

/** Collect every property name that appears anywhere in a zod schema tree. */
function collectKeys(schema: z.ZodTypeAny, seen = new Set<z.ZodTypeAny>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  if (!def) return [];
  const keys: string[] = [];
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (shape && typeof shape === 'object') {
    for (const [key, child] of Object.entries(shape)) {
      keys.push(key);
      keys.push(...collectKeys(child, seen));
    }
  }
  // Unwrap the common wrappers (optional/nullable/default/array/union/record).
  for (const prop of ['innerType', 'type', 'element', 'valueType'] as const) {
    const inner = def[prop] as z.ZodTypeAny | undefined;
    if (inner && typeof inner === 'object') keys.push(...collectKeys(inner, seen));
  }
  for (const prop of ['options', 'items'] as const) {
    const arr = def[prop] as z.ZodTypeAny[] | undefined;
    if (Array.isArray(arr)) for (const opt of arr) keys.push(...collectKeys(opt, seen));
  }
  return keys;
}

describe('SSH secret boundary (ADR-0047)', () => {
  const sshChannels = Object.entries(CHANNELS).filter(([name]) => name.startsWith('ssh.'));
  const sshEvents = Object.entries(EVENT_CHANNELS).filter(([name]) => name.startsWith('ssh.'));

  it('registers the SSH channels and events', () => {
    expect(sshChannels.length).toBeGreaterThanOrEqual(11);
    expect(sshEvents.map(([n]) => n)).toEqual(
      expect.arrayContaining(['ssh.state', 'ssh.hostKeyPrompt', 'ssh.authPrompt']),
    );
  });

  it('never returns a secret field on any ssh.* response', () => {
    for (const [name, def] of sshChannels) {
      const keys = collectKeys(def.response);
      const leaked = keys.filter(isSecretKey);
      expect(leaked, `${name} response leaks ${leaked.join(', ')}`).toEqual([]);
    }
  });

  it('never carries a secret field on any ssh.* event payload', () => {
    for (const [name, def] of sshEvents) {
      const keys = collectKeys(def.payload);
      const leaked = keys.filter(isSecretKey);
      expect(leaked, `${name} event leaks ${leaked.join(', ')}`).toEqual([]);
    }
  });

  it('only allows a secret value on the two renderer→main request inputs', () => {
    for (const [name, def] of sshChannels) {
      const keys = collectKeys(def.request);
      const hasValue = keys.includes('value');
      if (hasValue) {
        expect(
          VALUE_ALLOWED_REQUESTS.has(name),
          `${name} request must not accept a raw value`,
        ).toBe(true);
      }
    }
  });
});
