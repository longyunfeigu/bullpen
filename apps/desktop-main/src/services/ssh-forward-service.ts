import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Logger } from '@pi-ide/foundation';
import type { SshForwardRecord, SshForwardState } from '@pi-ide/ipc-contracts';

export interface SshForwardServiceDeps {
  getForward(hostId: string, forwardId: string): SshForwardRecord | null;
  /** Opens a direct-tcpip channel; connects (or reconnects) first if needed. */
  openStream(hostId: string, dstHost: string, dstPort: number): Promise<Duplex>;
  /** Establish the transport up-front so auth/host-key prompts happen at
   * start time, not on the first browser request into the tunnel. */
  connect(hostId: string): Promise<void>;
  hold(hostId: string, token: string): void;
  release(hostId: string, token: string): void;
  /** ssh.forwardState broadcast. */
  emit(state: SshForwardState): void;
  logger: Logger;
}

interface ActiveForward {
  hostId: string;
  record: SshForwardRecord;
  server: net.Server;
  sockets: Set<net.Socket>;
  status: 'active' | 'error';
  error: string | null;
}

const key = (hostId: string, forwardId: string): string => `${hostId}:${forwardId}`;

/**
 * Local (-L) port forwards (PR3, ADR-0047). The local net.Server survives a
 * transport drop: each incoming TCP connection asks the connection manager for
 * a fresh direct-tcpip channel, which reconnects the transport on demand — so
 * forwards recover from network loss without their own retry machinery.
 * An active listener holds the connection, keeping it from idling out.
 */
export class SshForwardService {
  private readonly active = new Map<string, ActiveForward>();
  /** Forwards whose start() is mid-flight (connecting / binding). A stop that
   * lands in this window flips the flag so start() tears itself down instead
   * of registering a listener on a host the user just disconnected. */
  private readonly starting = new Map<string, { cancelled: boolean }>();

  constructor(private readonly deps: SshForwardServiceDeps) {}

  states(): SshForwardState[] {
    return [...this.active.values()].map((f) => this.toState(f));
  }

  isActive(hostId: string, forwardId: string): boolean {
    return this.active.has(key(hostId, forwardId));
  }

  /** Resolves once the local listener is bound; rejects on EADDRINUSE etc. */
  async start(hostId: string, forwardId: string): Promise<void> {
    const k = key(hostId, forwardId);
    if (this.active.has(k) || this.starting.has(k)) return;
    const record = this.deps.getForward(hostId, forwardId);
    if (!record) throw new Error(`Unknown forward: ${forwardId}`);

    const token = { cancelled: false };
    this.starting.set(k, token);
    try {
      await this.deps.connect(hostId);
    } catch (err) {
      this.starting.delete(k);
      throw err;
    }
    if (token.cancelled) {
      this.starting.delete(k);
      return; // stopped mid-connect — never bound a listener or took a hold
    }

    const entry: ActiveForward = {
      hostId,
      record,
      server: net.createServer(),
      sockets: new Set(),
      status: 'active',
      error: null,
    };
    entry.server.on('connection', (socket) => void this.tunnel(entry, socket));
    try {
      await new Promise<void>((resolve, reject) => {
        entry.server.once('error', reject);
        entry.server.listen(record.bindPort, record.bindHost, () => {
          entry.server.removeListener('error', reject);
          resolve();
        });
      });
    } catch (err) {
      this.starting.delete(k);
      throw err;
    }
    if (token.cancelled) {
      // Stopped while binding — close the freshly-bound listener and bail.
      entry.server.close();
      this.starting.delete(k);
      return;
    }
    this.starting.delete(k);
    entry.server.on('error', (err) => {
      entry.status = 'error';
      entry.error = err.message;
      this.deps.logger.warn('ssh forward listener error', {
        hostId,
        forwardId,
        error: err.message,
      });
      this.emit(entry);
    });

    this.active.set(k, entry);
    this.deps.hold(hostId, `forward:${forwardId}`);
    this.deps.logger.info('ssh forward started', {
      hostId,
      forwardId,
      bind: `${record.bindHost}:${record.bindPort}`,
      target: `${record.targetHost}:${record.targetPort}`,
    });
    this.emit(entry);
  }

  stop(hostId: string, forwardId: string): boolean {
    const k = key(hostId, forwardId);
    // Cancel an in-flight start so it tears itself down instead of registering.
    const pending = this.starting.get(k);
    if (pending) pending.cancelled = true;
    const entry = this.active.get(k);
    if (!entry) return pending !== undefined;
    this.active.delete(k);
    entry.server.close();
    for (const socket of entry.sockets) socket.destroy();
    entry.sockets.clear();
    this.deps.release(hostId, `forward:${forwardId}`);
    this.deps.emit({
      hostId,
      forwardId,
      status: 'stopped',
      error: null,
      connections: 0,
    });
    this.deps.logger.info('ssh forward stopped', { hostId, forwardId });
    return true;
  }

  /** Explicit host disconnect / host delete tears its forwards down too —
   * otherwise the next tunneled connection would silently re-dial the host. */
  stopHost(hostId: string): void {
    const prefix = `${hostId}:`;
    for (const entry of [...this.active.values()]) {
      if (entry.hostId === hostId) this.stop(entry.hostId, entry.record.id);
    }
    // Cancel in-flight starts for this host too (not yet in `active`).
    for (const [k, token] of this.starting) {
      if (k.startsWith(prefix)) token.cancelled = true;
    }
  }

  stopAll(): void {
    for (const entry of [...this.active.values()]) this.stop(entry.hostId, entry.record.id);
    for (const token of this.starting.values()) token.cancelled = true;
  }

  // -------------------------------------------------------------------------

  private async tunnel(entry: ActiveForward, socket: net.Socket): Promise<void> {
    entry.sockets.add(socket);
    this.emit(entry);
    socket.on('close', () => {
      entry.sockets.delete(socket);
      this.emit(entry);
    });
    socket.on('error', () => socket.destroy());
    try {
      const stream = await this.deps.openStream(
        entry.hostId,
        entry.record.targetHost,
        entry.record.targetPort,
      );
      if (socket.destroyed) {
        stream.destroy();
        return;
      }
      socket.pipe(stream).pipe(socket);
      stream.on('error', () => socket.destroy());
      stream.on('close', () => socket.destroy());
    } catch (err) {
      // The transport (or the remote target) refused — drop this TCP client;
      // the listener stays up for the next attempt.
      socket.destroy();
      const message = err instanceof Error ? err.message : String(err);
      if (entry.status === 'active') {
        entry.error = message;
        this.emit(entry);
      }
      this.deps.logger.warn('ssh forward tunnel failed', {
        hostId: entry.hostId,
        forwardId: entry.record.id,
        error: message,
      });
    }
  }

  private toState(entry: ActiveForward): SshForwardState {
    return {
      hostId: entry.hostId,
      forwardId: entry.record.id,
      status: entry.status,
      error: entry.error,
      connections: entry.sockets.size,
    };
  }

  private emit(entry: ActiveForward): void {
    this.deps.emit(this.toState(entry));
  }
}
