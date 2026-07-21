#!/usr/bin/env node
import { resolve } from 'node:path';
import { root } from './build-lib.mjs';
import { generateReleaseMetadata } from './release-lib.mjs';

const valueAfter = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

try {
  const assetsDir = resolve(root, valueAfter('--assets') ?? 'release');
  const outputDir = resolve(root, valueAfter('--output') ?? 'release');
  const workflowRun =
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID &&
    process.env.GITHUB_REF_NAME &&
    process.env.GITHUB_SHA
      ? {
          tag: process.env.GITHUB_REF_NAME,
          commit: process.env.GITHUB_SHA,
          runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        }
      : null;
  const result = generateReleaseMetadata({
    assetsDir,
    outputDir,
    signingMode: process.env.CHARTER_SIGNING_MODE ?? 'unsigned',
    workflowRun,
  });
  console.log(
    `[release-metadata] ${result.manifest.artifacts.length} artifact(s), SBOM, licenses and checksums written to ${outputDir}`,
  );
} catch (error) {
  console.error(`[release-metadata] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
