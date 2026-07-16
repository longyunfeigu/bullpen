import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * ADR-0017 amendment — locating the CLI's own conversation id so resume can
 * target the exact session (`claude --resume <id>` / `codex resume <id>`)
 * instead of "whatever was most recent in this directory".
 *
 * Ground truth (verified against real installs):
 * - Claude Code: `~/.claude/projects/<munged cwd>/<session-uuid>.jsonl`, where
 *   the munge replaces every non-alphanumeric character with `-`
 *   (`/private/var/.../pi_ide` → `-private-var----pi-ide`).
 * - Codex CLI: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`.
 *
 * Discovery is time-window based: the newest transcript whose mtime falls
 * inside the session's lifetime is the session. It runs at session end (the
 * transcript's last write is the session's own end), so a later session in the
 * same directory can never be picked. Everything is best-effort: any fs error
 * resolves to null and resume falls back to the CLI's "most recent" flag.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODEX_ROLLOUT_RE =
  /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Session ids are written into a PTY — only exact UUIDs are ever embedded. */
export function isSafeCliSessionId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Claude Code's transcript folder name for a working directory. */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Lead slack: the transcript may be created moments before we saw the agent. */
const START_SLACK_MS = 60_000;
/** Tail slack: final writes can land after the exit edge debounce. */
const END_SLACK_MS = 120_000;
/** Backfill safety: never walk more day directories than this. */
const MAX_CODEX_DAYS = 16;

export interface DiscoverInput {
  cli: string;
  /** The directory the CLI ran in (external.cwd), not the accounting root. */
  cwd: string;
  startedAtMs: number;
  endedAtMs: number;
  /** Test seam. */
  home?: string;
}

interface Candidate {
  sessionId: string;
  mtimeMs: number;
}

async function newestInWindow(
  candidates: Candidate[],
  input: DiscoverInput,
): Promise<string | null> {
  const from = input.startedAtMs - START_SLACK_MS;
  const to = input.endedAtMs + END_SLACK_MS;
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.mtimeMs < from || candidate.mtimeMs > to) continue;
    if (!best || candidate.mtimeMs > best.mtimeMs) best = candidate;
  }
  return best?.sessionId ?? null;
}

async function discoverClaude(input: DiscoverInput): Promise<string | null> {
  const dir = join(input.home ?? homedir(), '.claude', 'projects', claudeProjectDirName(input.cwd));
  const candidates: Candidate[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const sessionId = name.slice(0, -'.jsonl'.length);
    if (!isSafeCliSessionId(sessionId)) continue;
    try {
      const info = await stat(join(dir, name));
      candidates.push({ sessionId, mtimeMs: info.mtimeMs });
    } catch {
      // raced deletion — skip
    }
  }
  return newestInWindow(candidates, input);
}

/** Local-date day keys covering [start, end] with one day of slack each side. */
function codexDayKeys(startedAtMs: number, endedAtMs: number): string[] {
  const keys: string[] = [];
  const day = 24 * 60 * 60 * 1000;
  for (let t = startedAtMs - day; t <= endedAtMs + day && keys.length < MAX_CODEX_DAYS; t += day) {
    const d = new Date(t);
    const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

async function discoverCodex(input: DiscoverInput): Promise<string | null> {
  const root = join(input.home ?? homedir(), '.codex', 'sessions');
  const candidates: Candidate[] = [];
  for (const key of codexDayKeys(input.startedAtMs, input.endedAtMs)) {
    const dir = join(root, key);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // day directory does not exist
    }
    for (const name of names) {
      const match = CODEX_ROLLOUT_RE.exec(name);
      if (!match) continue;
      try {
        const info = await stat(join(dir, name));
        candidates.push({ sessionId: match[1]!.toLowerCase(), mtimeMs: info.mtimeMs });
      } catch {
        // raced deletion — skip
      }
    }
  }
  return newestInWindow(candidates, input);
}

/**
 * The CLI-native conversation id for a session bounded by [startedAt, endedAt]
 * in `cwd`, or null when it cannot be established (unknown CLI, no transcript,
 * fs errors). Never throws.
 */
export async function discoverCliSessionId(input: DiscoverInput): Promise<string | null> {
  try {
    if (input.cli === 'claude') return await discoverClaude(input);
    if (input.cli === 'codex') return await discoverCodex(input);
    return null;
  } catch {
    return null;
  }
}
