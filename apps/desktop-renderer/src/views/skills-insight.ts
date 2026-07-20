import type { SkillDto, SkillUsageDto } from '@pi-ide/ipc-contracts';

/**
 * Skills usage insight (ADR-0037) — pure helpers behind Settings → Skills.
 * The panel's job is decluttering: show what each enabled skill costs on
 * every turn (preamble tokens) against how often it actually fires.
 */

export type SkillInsightSort = 'catalog' | 'uses' | 'tokens' | 'cost';

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
}

/**
 * Skills worth reviewing: enabled, paying preamble tokens every turn, and
 * either never invoked inside the window or costing a lot per invocation.
 * Explicit-only skills never appear — they are free until invoked.
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
    if (row.uses === 0) {
      out.push({
        skill,
        usage: row,
        reason: `Not invoked in ${windowDays} days — still costs ~${row.preambleTokens} tokens on every turn.`,
      });
    } else if (row.preambleTokens / row.uses >= COSTLY_TOKENS_PER_USE) {
      out.push({
        skill,
        usage: row,
        reason: `${row.uses}× in ${windowDays} days for ~${row.preambleTokens} tokens/turn — ~${Math.round(row.preambleTokens / row.uses)} tokens per use.`,
      });
    }
  }
  // Unused first, then most expensive per use.
  return out.sort((a, b) => {
    const aUnused = a.usage.uses === 0 ? 1 : 0;
    const bUnused = b.usage.uses === 0 ? 1 : 0;
    return bUnused - aUnused || b.usage.preambleTokens - a.usage.preambleTokens;
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
