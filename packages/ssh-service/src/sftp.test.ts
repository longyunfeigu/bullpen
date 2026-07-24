import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SshConnectionManager } from './connection-manager.js';
import { startFakeSshd, MemFs, type FakeSshd } from './testing/fake-sshd.js';
import type { HostKeyStore, SftpSession, SshPromptBridge, SshTargetConfig } from './types.js';

function trustingHostKeys(): HostKeyStore {
  return {
    check: () => ({
      status: 'trusted',
      fingerprintSha256: 'SHA256:test',
      keyType: 'ssh-ed25519',
      knownFingerprint: null,
    }),
    remember: () => {},
    forget: () => {},
  };
}

const prompts: SshPromptBridge = {
  hostKey: async () => ({ accept: true, remember: false }),
  auth: async () => ({ answers: [], save: false }),
};

function target(port: number): SshTargetConfig {
  return {
    id: 'host1',
    label: 'host1',
    host: '127.0.0.1',
    port,
    username: 'tester',
    auth: 'agent',
    identityFile: null,
    keepaliveSeconds: 0,
    autoReconnect: false,
  };
}

describe('SftpSession (over the in-memory fake sshd)', () => {
  let server: FakeSshd | null = null;
  let mgr: SshConnectionManager | null = null;

  async function setup(fs: MemFs): Promise<SftpSession> {
    server = await startFakeSshd({ fs });
    mgr = new SshConnectionManager({
      hostKeys: trustingHostKeys(),
      prompts,
      secrets: { password: async () => null, passphrase: async () => null, store: async () => {} },
    });
    return mgr.openSftp(target(server.port));
  }

  afterEach(async () => {
    mgr?.disconnectAll();
    await server?.close();
    server = null;
    mgr = null;
  });

  it('resolves home, lists directories (dirs first), and stats entries', async () => {
    const fs = new MemFs('/home/tester');
    fs.writeFile('/home/tester/notes.txt', 'hello');
    fs.mkdirp('/home/tester/projects');
    const sftp = await setup(fs);

    expect(await sftp.realpath('.')).toBe('/home/tester');
    const entries = await sftp.list('/home/tester');
    expect(entries.map((e) => `${e.type}:${e.name}`)).toEqual(['dir:projects', 'file:notes.txt']);
    expect(entries[1]?.size).toBe(5);
    expect(await sftp.stat('/home/tester/notes.txt')).toEqual({ type: 'file', size: 5 });
  });

  it('mkdir / rename / delete round-trip', async () => {
    const fs = new MemFs();
    const sftp = await setup(fs);
    await sftp.mkdir('/home/tester/newdir');
    expect(fs.nodes.get('/home/tester/newdir')?.type).toBe('dir');
    await sftp.rename('/home/tester/newdir', '/home/tester/renamed');
    expect(fs.nodes.has('/home/tester/newdir')).toBe(false);
    expect(fs.nodes.get('/home/tester/renamed')?.type).toBe('dir');
    fs.writeFile('/home/tester/renamed/file.bin', 'x');
    await sftp.delete('/home/tester/renamed/file.bin');
    await sftp.rmdir('/home/tester/renamed');
    expect(fs.nodes.has('/home/tester/renamed')).toBe(false);
  });

  it('uploads a local file with progress and byte-exact content', async () => {
    const fs = new MemFs();
    const sftp = await setup(fs);
    const dir = mkdtempSync(join(tmpdir(), 'sftp-up-'));
    const local = join(dir, 'payload.bin');
    const payload = Buffer.alloc(300_000, 7);
    writeFileSync(local, payload);

    const ticks: Array<[number, number]> = [];
    await sftp.upload(local, '/home/tester/payload.bin', {
      onProgress: (done, total) => ticks.push([done, total]),
    });
    expect(fs.nodes.get('/home/tester/payload.bin')?.data.equals(payload)).toBe(true);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.at(-1)?.[0]).toBe(payload.length);
    expect(ticks.at(-1)?.[1]).toBe(payload.length);
  });

  it('downloads a remote file and removes the partial local file on abort', async () => {
    const fs = new MemFs();
    const payload = Buffer.alloc(200_000, 3);
    fs.writeFile('/home/tester/big.bin', payload);
    const sftp = await setup(fs);
    const dir = mkdtempSync(join(tmpdir(), 'sftp-dl-'));

    const ok = join(dir, 'ok.bin');
    await sftp.download('/home/tester/big.bin', ok);
    expect(readFileSync(ok).equals(payload)).toBe(true);

    // Cancel: an already-aborted signal must reject and leave no partial file.
    const canceled = join(dir, 'canceled.bin');
    const controller = new AbortController();
    controller.abort();
    await expect(
      sftp.download('/home/tester/big.bin', canceled, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(existsSync(canceled)).toBe(false);
  });

  it('counts the SFTP channel as a hold: the transport stays up, then idles after close', async () => {
    const fs = new MemFs();
    server = await startFakeSshd({ fs });
    mgr = new SshConnectionManager({
      hostKeys: trustingHostKeys(),
      prompts,
      secrets: { password: async () => null, passphrase: async () => null, store: async () => {} },
      idleDisconnectMs: 40,
    });
    const sftp = await mgr.openSftp(target(server.port));
    await new Promise((r) => setTimeout(r, 150));
    expect(mgr.snapshot('host1').state).toBe('connected');
    sftp.close();
    const manager = mgr;
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const poll = (): void => {
        if (manager.snapshot('host1').state === 'disconnected') return resolve();
        if (Date.now() > deadline) return reject(new Error('still connected'));
        setTimeout(poll, 25);
      };
      poll();
    });
  });
});
