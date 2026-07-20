import type { SkillUsageDto } from '@pi-ide/ipc-contracts';

/**
 * Skills usage insight (ADR-0037): pure aggregation over invocation events.
 *
 * Events come from two ledgers with full-fidelity history:
 * - tool_calls rows where name = 'load_skill' (model-initiated loads), and
 * - skill_invocations rows (explicit `/skill:name` expansions, which bypass
 *   the tool gateway and are ledgered by TaskService at expansion time).
 *
 * Everything here is deterministic on (events, nowMs, windowDays) so the
 * SQLite plumbing stays a thin, untestable-in-name-only shell.
 */

export interface SkillUsageEvent {
  /** Runtime invocation name as recorded at call time. */
  skill: string;
  /** ISO timestamp of the invocation. */
  at: string;
}

export interface SkillUsageAggregate {
  uses: number;
  lastUsedAt: string | null;
  /** Per-week buckets, oldest → newest; length = usageWeekCount(windowDays). */
  weekly: number[];
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export function usageWeekCount(windowDays: number): number {
  return Math.max(1, Math.ceil(windowDays / 7));
}

/** Count events per skill inside the window; malformed/out-of-window rows drop. */
export function aggregateSkillUsage(
  events: SkillUsageEvent[],
  nowMs: number,
  windowDays: number,
): Map<string, SkillUsageAggregate> {
  const weeks = usageWeekCount(windowDays);
  const windowMs = windowDays * DAY_MS;
  const out = new Map<string, SkillUsageAggregate>();
  for (const event of events) {
    const parsed = Date.parse(event.at);
    if (!Number.isFinite(parsed)) continue;
    // Small clock skew clamps to "now"; anything older than the window drops.
    const at = Math.min(parsed, nowMs);
    if (nowMs - at >= windowMs) continue;
    const entry = out.get(event.skill) ?? {
      uses: 0,
      lastUsedAt: null,
      weekly: new Array<number>(weeks).fill(0),
    };
    entry.uses += 1;
    if (entry.lastUsedAt === null || event.at > entry.lastUsedAt) entry.lastUsedAt = event.at;
    const bucket = weeks - 1 - Math.min(weeks - 1, Math.floor((nowMs - at) / WEEK_MS));
    entry.weekly[bucket] = (entry.weekly[bucket] ?? 0) + 1;
    out.set(event.skill, entry);
  }
  return out;
}

/**
 * Join the catalog with usage + preamble-cost estimates into the wire DTO.
 * Every catalog skill gets a row (zeroes for never-invoked ones); usage rows
 * for skills that no longer exist are dropped with their skill.
 */
export function composeSkillUsage(
  catalog: Array<{ name: string }>,
  estimates: { bySkill: Map<string, number> },
  usage: Map<string, SkillUsageAggregate>,
  windowDays: number,
): SkillUsageDto[] {
  const weeks = usageWeekCount(windowDays);
  return catalog.map((skill) => {
    const used = usage.get(skill.name);
    return {
      name: skill.name,
      preambleTokens: estimates.bySkill.get(skill.name) ?? 0,
      uses: used?.uses ?? 0,
      lastUsedAt: used?.lastUsedAt ?? null,
      weekly: used ? [...used.weekly] : new Array<number>(weeks).fill(0),
    };
  });
}
