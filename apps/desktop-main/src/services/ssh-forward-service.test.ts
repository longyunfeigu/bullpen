import { connect, createServer, type AddressInfo, type Server } from 'node:net';
import { PassThrough, type Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SshForwardRecord, SshForwardState } from '@pi-ide/ipc-contracts';
import { SshForwardService, type SshForwardServiceDeps } from './ssh-forward-service.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
} as unknown as SshForwardServiceDeps['logger'];

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function record(bindPort: number, targetPort: number): SshForwardRecord {
  return {
    id: 'f1',
    bindHost: '127.0.0.1',
    bindPort,
    targetHost: '127.0.0.1',
    targetPort,
  };
}

/** Echo "remote" endpoint the fake tunnel dials into. */
function startEcho(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.pipe(socket));
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    );
  });
}

describe('SshForwardService', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  function makeService(over: Partial<SshForwardServiceDeps> = {}): {
    service: SshForwardService;
    states: SshForwardState[];
    holds: Map<string, Set<string>>;
  } {
    const states: SshForwardState[] = [];
    const holds = new Map<string, Set<string>>();
    const service = new SshForwardService({
      getForward: () => null,
      openStream: async () => new PassThrough() as unknown as Duplex,
      connect: async () => {},
      hold: (hostId, token) => {
        const set = holds.get(hostId) ?? new Set();
        set.add(token);
        holds.set(hostId, set);
      },
      release: (hostId, token) => holds.get(hostId)?.delete(token),
      emit: (state) => states.push(state),
      logger: silentLogger,
      ...over,
    });
    cleanups.push(() => service.stopAll());
    return { service, states, holds };
  }

  it('binds the local port, tunnels bytes both ways, and counts connections', async () => {
    const echo = await startEcho();
    cleanups.push(() => echo.server.close());
    const bindPort = await freePort();
    const rec = record(bindPort, echo.port);

    const { service, states, holds } = makeService({
      getForward: (hostId, forwardId) => (hostId === 'h1' && forwardId === 'f1' ? rec : null),
      // The "SSH channel" is a real TCP socket to the echo server — the same
      // duplex piping the ssh2 channel gives us, without a full sshd.
      openStream: (_hostId, dstHost, dstPort) =>
        new Promise((resolve, reject) => {
          const socket = connect(dstPort, dstHost, () => resolve(socket as unknown as Duplex));
          socket.on('error', reject);
        }),
    });

    await service.start('h1', 'f1');
    expect(holds.get('h1')?.has('forward:f1')).toBe(true);
    expect(states.at(-1)).toMatchObject({ status: 'active', connections: 0 });

    const roundTrip = await new Promise<string>((resolve, reject) => {
      const client = connect(bindPort, '127.0.0.1', () => client.write('ping-through'));
      client.once('data', (chunk) => {
        resolve(chunk.toString('utf8'));
        client.end();
      });
      client.on('error', reject);
    });
    expect(roundTrip).toBe('ping-through');
    await vi.waitFor(() => expect(service.states()[0]?.connections).toBe(0));

    expect(service.stop('h1', 'f1')).toBe(true);
    expect(holds.get('h1')?.has('forward:f1')).toBe(false);
    expect(states.at(-1)).toMatchObject({ status: 'stopped' });
    // The listener is really gone.
    await expect(
      new Promise((resolve, reject) => {
        const probe = connect(bindPort, '127.0.0.1', () => resolve('connected'));
        probe.on('error', reject);
      }),
    ).rejects.toBeTruthy();
  });

  it('rejects start when the port is already in use, without leaking holds', async () => {
    const taken = createServer();
    await new Promise<void>((r) => taken.listen(0, '127.0.0.1', r));
    cleanups.push(() => taken.close());
    const port = (taken.address() as AddressInfo).port;

    const { service, holds } = makeService({
      getForward: () => record(port, 80),
    });
    await expect(service.start('h1', 'f1')).rejects.toThrow(/EADDRINUSE/);
    expect(holds.get('h1')?.size ?? 0).toBe(0);
    expect(service.states()).toEqual([]);
  });

  it('drops the TCP client when the tunnel cannot be opened but keeps listening', async () => {
    const bindPort = await freePort();
    const { service, states } = makeService({
      getForward: () => record(bindPort, 9),
      openStream: async () => {
        throw new Error('SSH connection is not available');
      },
    });
    await service.start('h1', 'f1');

    const closed = await new Promise<boolean>((resolve) => {
      const client = connect(bindPort, '127.0.0.1');
      client.on('close', () => resolve(true));
      client.on('error', () => {});
    });
    expect(closed).toBe(true);
    // Listener survives for the next attempt (reconnect-on-demand semantics).
    expect(service.isActive('h1', 'f1')).toBe(true);
    expect(states.some((s) => s.error !== null)).toBe(true);
  });

  it('cancelling (stopHost) during an in-flight start leaves no listener or hold', async () => {
    const bindPort = await freePort();
    let releaseConnect: (() => void) | null = null;
    const { service, holds } = makeService({
      getForward: () => record(bindPort, 80),
      // Block start() inside connect(), the way an auth prompt would.
      connect: () =>
        new Promise<void>((resolve) => {
          releaseConnect = resolve;
        }),
    });

    const startPromise = service.start('h1', 'f1');
    await vi.waitFor(() => expect(releaseConnect).not.toBeNull());
    // User disconnects the host while the forward is still connecting.
    service.stopHost('h1');
    releaseConnect!();
    await startPromise;

    expect(service.isActive('h1', 'f1')).toBe(false);
    expect(holds.get('h1')?.size ?? 0).toBe(0);
    // The local port was never bound (or was closed) — it is free again.
    await expect(
      new Promise((resolve, reject) => {
        const probe = connect(bindPort, '127.0.0.1', () => resolve('connected'));
        probe.on('error', reject);
      }),
    ).rejects.toBeTruthy();
  });

  it('stopHost tears down every forward of that host only', async () => {
    const p1 = await freePort();
    const p2 = await freePort();
    const recs: Record<string, SshForwardRecord> = {
      'h1:f1': { ...record(p1, 80), id: 'f1' },
      'h2:f2': { ...record(p2, 80), id: 'f2' },
    };
    const { service } = makeService({
      getForward: (hostId, forwardId) => recs[`${hostId}:${forwardId}`] ?? null,
    });
    await service.start('h1', 'f1');
    await service.start('h2', 'f2');
    service.stopHost('h1');
    expect(service.isActive('h1', 'f1')).toBe(false);
    expect(service.isActive('h2', 'f2')).toBe(true);
  });
});
