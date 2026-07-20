import { describe, expect, it } from 'vitest';
import {
  aggregateSkillUsage,
  composeSkillUsage,
  usageWeekCount,
  type SkillUsageEvent,
} from './skill-usage.js';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-07-20T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

describe('aggregateSkillUsage (ADR-0037)', () => {
  it('counts events per skill inside the window and keeps the latest timestamp', () => {
    const events: SkillUsageEvent[] = [
      { skill: 'alpha', at: daysAgo(1) },
      { skill: 'alpha', at: daysAgo(10) },
      { skill: 'alpha', at: daysAgo(44) },
      { skill: 'beta', at: daysAgo(2) },
    ];
    const out = aggregateSkillUsage(events, NOW, 45);
    expect(out.get('alpha')?.uses).toBe(3);
    expect(out.get('alpha')?.lastUsedAt).toBe(daysAgo(1));
    expect(out.get('beta')?.uses).toBe(1);
  });

  it('drops events outside the window and malformed timestamps', () => {
    const out = aggregateSkillUsage(
      [
        { skill: 'alpha', at: daysAgo(46) },
        { skill: 'alpha', at: 'not-a-date' },
      ],
      NOW,
      45,
    );
    expect(out.has('alpha')).toBe(false);
  });

  it('clamps small clock skew into the newest bucket instead of dropping it', () => {
    const out = aggregateSkillUsage([{ skill: 'alpha', at: daysAgo(-0.01) }], NOW, 45);
    expect(out.get('alpha')?.uses).toBe(1);
    const weekly = out.get('alpha')!.weekly;
    expect(weekly[weekly.length - 1]).toBe(1);
  });

  it('buckets by week, oldest → newest', () => {
    const out = aggregateSkillUsage(
      [
        { skill: 'alpha', at: daysAgo(0) }, // newest bucket
        { skill: 'alpha', at: daysAgo(8) }, // one week back
        { skill: 'alpha', at: daysAgo(44) }, // oldest bucket
      ],
      NOW,
      45,
    );
    const weekly = out.get('alpha')!.weekly;
    expect(weekly).toHaveLength(usageWeekCount(45));
    expect(weekly[weekly.length - 1]).toBe(1);
    expect(weekly[weekly.length - 2]).toBe(1);
    expect(weekly[0]).toBe(1);
    expect(weekly.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('composeSkillUsage (ADR-0037)', () => {
  it('joins every catalog skill with usage + token estimates, zero-filling gaps', () => {
    const usage = aggregateSkillUsage([{ skill: 'alpha', at: daysAgo(3) }], NOW, 45);
    const rows = composeSkillUsage(
      [{ name: 'alpha' }, { name: 'idle' }],
      { bySkill: new Map([['alpha', 120]]) },
      usage,
      45,
    );
    expect(rows).toHaveLength(2);
    const alpha = rows.find((r) => r.name === 'alpha')!;
    expect(alpha.preambleTokens).toBe(120);
    expect(alpha.uses).toBe(1);
    expect(alpha.lastUsedAt).toBe(daysAgo(3));
    const idle = rows.find((r) => r.name === 'idle')!;
    expect(idle.preambleTokens).toBe(0);
    expect(idle.uses).toBe(0);
    expect(idle.lastUsedAt).toBeNull();
    expect(idle.weekly).toHaveLength(usageWeekCount(45));
    expect(idle.weekly.every((n) => n === 0)).toBe(true);
  });

  it('drops usage rows whose skill left the catalog', () => {
    const usage = aggregateSkillUsage([{ skill: 'ghost', at: daysAgo(1) }], NOW, 45);
    const rows = composeSkillUsage([{ name: 'alpha' }], { bySkill: new Map() }, usage, 45);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('alpha');
  });
});
