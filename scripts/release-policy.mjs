#!/usr/bin/env node
import { readProductPackage, validateReleasePolicy } from './release-lib.mjs';

const valueAfter = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

try {
  const pkg = readProductPackage();
  const policy = validateReleasePolicy({
    version: pkg.version,
    tag: valueAfter('--tag'),
    signingMode: valueAfter('--signing-mode') ?? process.env.CHARTER_SIGNING_MODE ?? 'unsigned',
  });
  process.stdout.write(`${JSON.stringify({ version: pkg.version, ...policy }, null, 2)}\n`);
} catch (error) {
  console.error(`[release-policy] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
