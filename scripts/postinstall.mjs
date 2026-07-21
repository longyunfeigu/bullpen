#!/usr/bin/env node
// Post-install fixups that npm's script sandboxing skips.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceDependencySafety } from './dependency-safety.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Some published dependencies include shrinkwrap files that can re-introduce
// vulnerable nested patch versions after npm has applied the root overrides.
// Collapse those shadow copies so Node resolves the audited root versions.
enforceDependencySafety(root);

// node-pty ships N-API prebuilds but the spawn-helper loses its exec bit through npm.
for (const arch of ['darwin-arm64', 'darwin-x64']) {
  const helper = join(root, 'node_modules/node-pty/prebuilds', arch, 'spawn-helper');
  if (existsSync(helper)) {
    chmodSync(helper, 0o755);
    console.log(`postinstall: chmod +x ${helper}`);
  }
}

// Electron 43 exposes an explicit installer instead of a package postinstall.
const electronDist = join(root, 'node_modules/electron/dist');
if (!existsSync(electronDist)) {
  const installer = join(root, 'node_modules/electron/install.js');
  if (!existsSync(installer)) throw new Error('postinstall: Electron installer is missing');
  console.log('postinstall: installing the Electron runtime');
  execFileSync(process.execPath, [installer], { cwd: root, stdio: 'inherit' });
}
