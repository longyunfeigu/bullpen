import type { SkillConsumer, SkillDto, SkillUsageDto } from '@pi-ide/ipc-contracts';

/**
 * Skills usage insight (ADR-0037) — pure helpers behind Settings → Skills.
 * The panel's job is decluttering: show what each enabled skill costs on
 * every turn (preamble tokens) against how often it actually fires — in
 * Charter or, since ADR-0040, in an external CLI reading the same skills.
 */

export type SkillInsightSort = 'catalog' | 'uses' | 'tokens' | 'cost';

/** Row projection: merged numbers, or one consumer's slice (ADR-0040). */
export type ConsumerFilter = 'all' | SkillConsumer;

/** Fixed order + colors for every per-consumer visual (chips, stacks). */
export const CONSUMERS: ReadonlyArray<{ id: SkillConsumer; label: string; color: string }> = [
  { id: 'charter', label: 'Charter', color: '#6ca1e8' },
  { id: 'claude', label: 'Claude Code', color: '#e0876a' },
  { id: 'codex', label: 'Codex', color: '#46b477' },
];

/**
 * Replace each row's top-level uses/lastUsedAt/weekly with one consumer's
 * slice so downstream helpers (sort, spark max, last-used) need no changes.
 * 'all' returns the rows untouched — the top level already holds the merge.
 */
export function projectUsage(rows: SkillUsageDto[], filter: ConsumerFilter): SkillUsageDto[] {
  if (filter === 'all') return rows;
  return rows.map((row) => {
    const series = row.byConsumer[filter];
    return { ...row, uses: series.uses, lastUsedAt: series.lastUsedAt, weekly: series.weekly };
  });
}

/** Tooltip line: non-zero consumers only, e.g. "Charter 3× (last 2d ago) · Claude Code 9× (last today)". */
export function consumerBreakdown(row: SkillUsageDto, nowMs: number): string {
  const parts: string[] = [];
  for (const consumer of CONSUMERS) {
    const series = row.byConsumer[consumer.id];
    if (series.uses === 0) continue;
    const last = lastUsedLabel(series.lastUsedAt, nowMs);
    parts.push(`${consumer.label} ${series.uses}×${last ? ` (last ${last})` : ''}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'no invocations in the window';
}

export interface SparkSegment {
  consumer: SkillConsumer;
  count: number;
  color: string;
}

/**
 * Per week-bucket stacked segments in fixed consumer order (zero segments
 * omitted; an empty bucket yields an empty array). A single-consumer filter
 * degrades to single-color stacks.
 */
export function sparkStacks(row: SkillUsageDto, filter: ConsumerFilter): SparkSegment[][] {
  const active = filter === 'all' ? CONSUMERS : CONSUMERS.filter((c) => c.id === filter);
  const out: SparkSegment[][] = [];
  for (let bucket = 0; bucket < row.weekly.length; bucket++) {
    const segments: SparkSegment[] = [];
    for (const consumer of active) {
      const count = row.byConsumer[consumer.id].weekly[bucket] ?? 0;
      if (count > 0) segments.push({ consumer: consumer.id, count, color: consumer.color });
    }
    out.push(segments);
  }
  return out;
}

/** Reference window used to phrase the budget share (a 200k-token context). */
export const CONTEXT_WINDOW_TOKENS = 200_000;

/** Cost-per-use ceiling above which a used skill still reads as a candidate. */
const COSTLY_TOKENS_PER_USE = 300;

export function usageByName(usage: SkillUsageDto[]): Map<string, SkillUsageDto> {
  return new Map(usage.map((row) => [row.name, row]));
}

/** Total per-turn preamble spend: per-skill blocks + shared framing. */
export function preambleTotalTokens(usage: SkillUsageDto[], overheadTokens: number): number {
  const perSkill = usage.reduce((sum, row) => sum + row.preambleTokens, 0);
  return perSkill === 0 ? 0 : perSkill + overheadTokens;
}

/**
 * Sort for the manager list. `catalog` preserves the store order (source
 * priority, then name) so the default view stays exactly what it was before
 * the insight landed. Ties everywhere fall back to catalog order (stable sort).
 */
export function sortSkillsForInsight(
  skills: SkillDto[],
  usage: Map<string, SkillUsageDto>,
  sort: SkillInsightSort,
): SkillDto[] {
  if (sort === 'catalog') return skills;
  const uses = (s: SkillDto): number => usage.get(s.name)?.uses ?? 0;
  const tokens = (s: SkillDto): number => usage.get(s.name)?.preambleTokens ?? 0;
  // Never-used preamble skills are infinitely expensive per use.
  const cost = (s: SkillDto): number => {
    const tok = tokens(s);
    if (tok === 0) return -1; // free skills sort last under "cost"
    const n = uses(s);
    return n === 0 ? Number.POSITIVE_INFINITY : tok / n;
  };
  const list = [...skills];
  if (sort === 'uses') list.sort((a, b) => uses(b) - uses(a));
  else if (sort === 'tokens') list.sort((a, b) => tokens(b) - tokens(a));
  else list.sort((a, b) => cost(b) - cost(a));
  return list;
}

export interface DeclutterCandidate {
  skill: SkillDto;
  usage: SkillUsageDto;
  reason: string;
  /** Checked by default in the review panel — safe to disable outright. */
  preselect: boolean;
}

/**
 * Skills worth reviewing: enabled, paying preamble tokens every turn, and
 * either never invoked inside the window or costing a lot per invocation.
 * Explicit-only skills never appear — they are free until invoked.
 *
 * The economics stay Charter-based (ADR-0040): only Charter turns pay the
 * preamble, so cost-per-use divides by Charter uses. External-only usage
 * keeps a skill in the list (it still costs tokens here for zero local use)
 * but is never preselected — the user clearly wants it somewhere.
 */
export function declutterCandidates(
  skills: SkillDto[],
  usage: Map<string, SkillUsageDto>,
  windowDays: number,
): DeclutterCandidate[] {
  const out: DeclutterCandidate[] = [];
  for (const skill of skills) {
    const row = usage.get(skill.name);
    if (!skill.enabled || !row || row.preambleTokens === 0) continue;
    const charterUses = row.byConsumer.charter.uses;
    if (row.uses === 0) {
      out.push({
        skill,
        usage: row,
        preselect: true,
        reason: `Not invoked in ${windowDays} days — still costs ~${row.preambleTokens} tokens on every turn.`,
      });
    } else if (charterUses === 0) {
      const external = CONSUMERS.filter((c) => c.id !== 'charter' && row.byConsumer[c.id].uses > 0)
        .map((c) => `${c.label} ${row.byConsumer[c.id].uses}×`)
        .join(', ');
      out.push({
        skill,
        usage: row,
        preselect: false,
        reason: `Not invoked here in ${windowDays} days (used externally: ${external}) — still costs ~${row.preambleTokens} tokens on every turn.`,
      });
    } else if (row.preambleTokens / charterUses >= COSTLY_TOKENS_PER_USE) {
      out.push({
        skill,
        usage: row,
        preselect: false,
        reason: `${charterUses}× here in ${windowDays} days for ~${row.preambleTokens} tokens/turn — ~${Math.round(row.preambleTokens / charterUses)} tokens per use.`,
      });
    }
  }
  // Preselected (fully unused) first, then most expensive.
  return out.sort((a, b) => {
    return (
      Number(b.preselect) - Number(a.preselect) || b.usage.preambleTokens - a.usage.preambleTokens
    );
  });
}

/** "today" / "3d ago" / null (never inside the window). */
export function lastUsedLabel(lastUsedAt: string | null, nowMs: number): string | null {
  if (!lastUsedAt) return null;
  const at = Date.parse(lastUsedAt);
  if (!Number.isFinite(at)) return null;
  const days = Math.max(0, Math.floor((nowMs - at) / 86_400_000));
  return days === 0 ? 'today' : `${days}d ago`;
}

/** Stable segment/spark color per catalog position (theme-independent). */
export const INSIGHT_PALETTE = [
  '#6ca1e8',
  '#46b477',
  '#d29a3a',
  '#9a7fd1',
  '#5bb8c4',
  '#c47fb0',
  '#e0876a',
] as const;

export function insightColor(index: number): string {
  return INSIGHT_PALETTE[
    ((index % INSIGHT_PALETTE.length) + INSIGHT_PALETTE.length) % INSIGHT_PALETTE.length
  ]!;
}
