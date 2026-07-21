#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildAll, root } from './build-lib.mjs';

const viteCli = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

console.log('[build] bundling main/preload/worker…');
await buildAll();

console.log('[build] building renderer…');
execFileSync(process.execPath, [viteCli, 'build'], {
  cwd: join(root, 'apps/desktop-renderer'),
  stdio: 'inherit',
});

console.log('[build] done');
