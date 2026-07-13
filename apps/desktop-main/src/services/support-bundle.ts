import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactObject, redactText } from '@pi-ide/foundation';
import type { SqlDatabase } from '@pi-ide/persistence';

/**
 * Redacted support bundle (E2E-022, SUP): everything a maintainer needs to
 * diagnose a report, and nothing the user would regret sharing. Hard rules:
 * no secrets, no file contents, no prompts/goals/messages, no absolute
 * user paths (home/userData/workspace become tokens).
 */

export interface SupportBundleInputs {
  app: Record<string, unknown>;
  settingsEffective: unknown;
  db: SqlDatabase | null;
  appliedMigrations: number[] | null;
  recentErrors: Array<Record<string, unknown>>;
  workspace: { id: string; isGitRepo: boolean; trustState: string; path: string } | null;
  providers: Array<{ providerId: string; configured: boolean }>;
  worker: { alive: boolean; restarts: number; degraded: boolean };
  logsDir: string;
  userDataDir: string;
}

async function tailLatestLog(logsDir: string, lines: number): Promise<string[]> {
  try {
    const files = (await fs.readdir(logsDir)).filter((f) => f.endsWith('.log')).sort();
    const latest = files.at(-1);
    if (!latest) return [];
    const text = await fs.readFile(join(logsDir, latest), 'utf8');
    return text.split('\n').slice(-lines);
  } catch {
    return [];
  }
}

function scrubPaths(text: string, replacements: Array<[string, string]>): string {
  let out = text;
  for (const [needle, token] of replacements) {
    if (!needle) continue;
    out = out.split(needle).join(token);
    // JSON-escaped variant ("/Users/x" appears as \"/Users/x\" inside strings)
    const escaped = JSON.stringify(needle).slice(1, -1);
    if (escaped !== needle) out = out.split(escaped).join(token);
  }
  return out;
}

export async function buildSupportBundle(inputs: SupportBundleInputs): Promise<string> {
  const taskStats: Array<Record<string, unknown>> = [];
  const toolStats: Array<Record<string, unknown>> = [];
  const verificationStats: Array<Record<string, unknown>> = [];
  if (inputs.db) {
    try {
      // Task rows carry user text (title/goal) — export states and counters only.
      const tasks = inputs.db
        .prepare(
          'SELECT state, mode, COUNT(*) as n FROM tasks GROUP BY state, mode ORDER BY n DESC',
        )
        .all() as Array<Record<string, unknown>>;
      taskStats.push(...tasks);
      const tools = inputs.db
        .prepare(
          'SELECT name, state, COUNT(*) as n FROM tool_calls GROUP BY name, state ORDER BY n DESC LIMIT 50',
        )
        .all() as Array<Record<string, unknown>>;
      toolStats.push(...tools);
      const runs = inputs.db
        .prepare('SELECT state, COUNT(*) as n FROM verification_runs GROUP BY state')
        .all() as Array<Record<string, unknown>>;
      verificationStats.push(...runs);
    } catch {
      // a broken DB is itself diagnostic; the bundle still ships
    }
  }

  const logsTail = (await tailLatestLog(inputs.logsDir, 200)).map((line) => redactText(line));

  const bundle = {
    kind: 'charter-support-bundle',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: inputs.app,
    settings: redactObject(inputs.settingsEffective),
    workspace: inputs.workspace
      ? {
          // The path itself is user data — only its presence and shape ship.
          open: true,
          id: inputs.workspace.id,
          isGitRepo: inputs.workspace.isGitRepo,
          trustState: inputs.workspace.trustState,
        }
      : { open: false },
    providers: inputs.providers,
    agentWorker: inputs.worker,
    db: {
      available: inputs.db !== null,
      appliedMigrations: inputs.appliedMigrations ?? [],
    },
    taskStats,
    toolStats,
    verificationStats,
    recentErrors: inputs.recentErrors.map((e) => redactObject(e)),
    logsTail,
    redaction:
      'No secrets, file contents, prompts or absolute user paths are included; home/userData/workspace paths are tokenized.',
  };

  const json = JSON.stringify(bundle, null, 2);
  return scrubPaths(json, [
    [inputs.workspace?.path ?? '', '<workspace>'],
    [inputs.userDataDir, '<userData>'],
    [homedir(), '~'],
  ]);
}
