/**
 * SSH connection management for Charter Remotes (ADR-0047).
 *
 * Owns the ssh2 protocol layer in the main process: connection lifecycle,
 * authentication orchestration, host-key trust, and ~/.ssh/config import.
 * Nothing in this package touches Electron or the renderer; secrets and
 * interactive prompts are injected by the composing service.
 */
export * from './types.js';
export { SshConnectionManager } from './connection-manager.js';
export type { SshConnectionManagerDeps, ConnectionEndReason } from './connection-manager.js';
export { createHostKeyStore } from './host-keys.js';
export { parseSshConfig } from './ssh-config.js';
export { createSftpSession, sftpJoin } from './sftp.js';
