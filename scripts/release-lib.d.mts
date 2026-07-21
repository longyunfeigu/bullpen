export interface ReleasePolicy {
  channel: 'stable' | 'beta' | 'rc' | 'nightly' | 'preview';
  prerelease: boolean;
  signed: boolean;
}

export function readProductPackage(projectRoot?: string): Record<string, unknown> & {
  version: string;
};
export function releaseChannel(version: string): ReleasePolicy['channel'];
export function validateReleasePolicy(input: {
  version: string;
  tag?: string;
  signingMode?: string;
}): ReleasePolicy;
export function sha256File(file: string): string;
export function collectReleaseArtifacts(assetsDir: string): string[];
export function dependencyInventory(projectRoot?: string): Array<{
  name: string;
  version: string;
  license: string;
  developmentOnly: boolean;
  optional: boolean;
  source: string | null;
}>;
export function workflowGateReport(input: {
  version: string;
  tag: string;
  commit: string;
  runUrl: string;
  signingMode: string;
}): string;
export function generateReleaseMetadata(input: {
  projectRoot?: string;
  assetsDir: string;
  outputDir?: string;
  signingMode?: string;
  requireArtifacts?: boolean;
  workflowRun?: { tag: string; commit: string; runUrl: string } | null;
}): {
  manifest: Record<string, unknown>;
  files: Record<string, string>;
};
