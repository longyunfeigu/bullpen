import { create } from 'zustand';
import type {
  EventPayload,
  SshConfigCandidate,
  SshForwardInput,
  SshForwardRecord,
  SshForwardState,
  SshHostDto,
  SshHostInput,
  SshSecretKind,
} from '@pi-ide/ipc-contracts';
import { onEvent, rpc, rpcResult } from '../bridge.js';

/** A host-key decision awaiting the user (ADR-0047 TOFU / mismatch modal). */
export type HostKeyPrompt = EventPayload<'ssh.hostKeyPrompt'>;
/** An interactive auth challenge awaiting the user (password / passphrase / 2FA). */
export type AuthPrompt = EventPayload<'ssh.authPrompt'>;

interface SshStore {
  hosts: SshHostDto[];
  loaded: boolean;
  /** At most one host-key and one auth prompt are shown at a time (FIFO). */
  hostKeyPrompts: HostKeyPrompt[];
  authPrompts: AuthPrompt[];
  /** PR3: live forward listener states, keyed "hostId:forwardId". */
  forwardStates: Record<string, SshForwardState>;
  initialized: boolean;

  init(): void;
  refresh(): Promise<void>;
  saveHost(input: SshHostInput): Promise<SshHostDto | null>;
  deleteHost(hostId: string): Promise<boolean>;
  connect(hostId: string): Promise<void>;
  disconnect(hostId: string): Promise<void>;
  setSecret(hostId: string, kind: SshSecretKind, value: string): Promise<boolean>;
  clearSecret(hostId: string, kind: SshSecretKind): Promise<boolean>;
  importConfig(): Promise<SshConfigCandidate[]>;
  applyImport(hosts: SshHostInput[]): Promise<number>;

  saveForward(hostId: string, forward: SshForwardInput): Promise<SshForwardRecord | null>;
  deleteForward(hostId: string, forwardId: string): Promise<boolean>;
  /** Resolves with an error message (null = started) so the dialog can render it inline. */
  startForward(hostId: string, forwardId: string): Promise<string | null>;
  stopForward(hostId: string, forwardId: string): Promise<void>;

  respondHostKey(requestId: string, accept: boolean, remember: boolean): Promise<void>;
  respondAuth(requestId: string, answers: string[], save: boolean): Promise<void>;
}

export const forwardKey = (hostId: string, forwardId: string): string => `${hostId}:${forwardId}`;

export const useSshStore = create<SshStore>((set, get) => ({
  hosts: [],
  loaded: false,
  hostKeyPrompts: [],
  authPrompts: [],
  forwardStates: {},
  initialized: false,

  init() {
    if (get().initialized) return;
    set({ initialized: true });
    void get().refresh();
    void rpcResult('ssh.listForwardStates', {}).then((res) => {
      if (!res.ok) return;
      const forwardStates: Record<string, SshForwardState> = {};
      for (const state of res.data.states) {
        forwardStates[forwardKey(state.hostId, state.forwardId)] = state;
      }
      set({ forwardStates });
    });
    onEvent('ssh.forwardState', (state) => {
      set((s) => ({
        forwardStates:
          state.status === 'stopped'
            ? Object.fromEntries(
                Object.entries(s.forwardStates).filter(
                  ([k]) => k !== forwardKey(state.hostId, state.forwardId),
                ),
              )
            : { ...s.forwardStates, [forwardKey(state.hostId, state.forwardId)]: state },
      }));
    });
    onEvent('ssh.state', (info) => {
      set((s) => ({
        hosts: s.hosts.map((h) =>
          h.id === info.hostId
            ? {
                ...h,
                connection: { state: info.state, sessions: info.sessions, error: info.error },
              }
            : h,
        ),
      }));
      // lastConnectedAt updates ride settings; a light refresh keeps cards honest.
      if (info.state === 'connected') void get().refresh();
    });
    onEvent('ssh.hostKeyPrompt', (prompt) => {
      set((s) => ({ hostKeyPrompts: [...s.hostKeyPrompts, prompt] }));
    });
    onEvent('ssh.authPrompt', (prompt) => {
      set((s) => ({ authPrompts: [...s.authPrompts, prompt] }));
    });
  },

  async refresh() {
    const res = await rpcResult('ssh.listHosts', {});
    if (res.ok) set({ hosts: res.data.hosts, loaded: true });
  },

  async saveHost(input) {
    const res = await rpcResult('ssh.saveHost', { host: input });
    if (!res.ok) return null;
    await get().refresh();
    return res.data.host;
  },

  async deleteHost(hostId) {
    const res = await rpcResult('ssh.deleteHost', { hostId });
    if (res.ok) await get().refresh();
    return res.ok && res.data.deleted;
  },

  async connect(hostId) {
    await rpcResult('ssh.connect', { hostId });
  },

  async disconnect(hostId) {
    await rpcResult('ssh.disconnect', { hostId });
    await get().refresh();
  },

  async setSecret(hostId, kind, value) {
    const res = await rpcResult('ssh.setSecret', { hostId, kind, value });
    if (res.ok) await get().refresh();
    return res.ok && res.data.saved;
  },

  async clearSecret(hostId, kind) {
    const res = await rpcResult('ssh.clearSecret', { hostId, kind });
    if (res.ok) await get().refresh();
    return res.ok && res.data.cleared;
  },

  async importConfig() {
    const res = await rpcResult('ssh.importConfig', {});
    return res.ok ? res.data.candidates : [];
  },

  async applyImport(hosts) {
    const res = await rpcResult('ssh.applyImport', { hosts });
    if (res.ok) await get().refresh();
    return res.ok ? res.data.added : 0;
  },

  async saveForward(hostId, forward) {
    const res = await rpcResult('ssh.saveForward', { hostId, forward });
    if (!res.ok) return null;
    await get().refresh();
    return res.data.forward;
  },

  async deleteForward(hostId, forwardId) {
    const res = await rpcResult('ssh.deleteForward', { hostId, forwardId });
    if (res.ok) await get().refresh();
    return res.ok && res.data.deleted;
  },

  async startForward(hostId, forwardId) {
    const res = await rpcResult('ssh.startForward', { hostId, forwardId });
    return res.ok ? null : res.error.userMessage;
  },

  async stopForward(hostId, forwardId) {
    await rpcResult('ssh.stopForward', { hostId, forwardId });
  },

  async respondHostKey(requestId, accept, remember) {
    await rpc('ssh.respondHostKey', { requestId, accept, remember });
    set((s) => ({ hostKeyPrompts: s.hostKeyPrompts.filter((p) => p.requestId !== requestId) }));
  },

  async respondAuth(requestId, answers, save) {
    await rpc('ssh.respondAuth', { requestId, answers, save });
    set((s) => ({ authPrompts: s.authPrompts.filter((p) => p.requestId !== requestId) }));
  },
}));
