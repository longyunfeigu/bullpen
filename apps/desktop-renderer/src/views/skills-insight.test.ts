import { describe, expect, it } from 'vitest';
import type { SkillDto, SkillUsageDto } from '@pi-ide/ipc-contracts';
import {
  declutterCandidates,
  lastUsedLabel,
  preambleTotalTokens,
  sortSkillsForInsight,
  usageByName,
} from './skills-insight.js';

function skill(name: string, patch: Partial<SkillDto> = {}): SkillDto {
  return {
    id: name,
    name,
    displayName: name,
    description: `${name} things`,
    enabled: true,
    explicitOnly: false,
    source: 'managed',
    sourceId: 'managed',
    sourceLabel: 'Charter Managed',
    sourcePath: `~/skills/${name}`,
    live: false,
    status: 'ready',
    compatibility: 'compatible',
    issues: [],
    revision: 'r'.repeat(64),
    files: ['SKILL.md'],
    scriptCount: 0,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function usage(name: string, patch: Partial<SkillUsageDto> = {}): SkillUsageDto {
  return { name, preambleTokens: 0, uses: 0, lastUsedAt: null, weekly: [0], ...patch };
}

describe('skills insight helpers (ADR-0037)', () => {
  it('totals the preamble spend including framing overhead, or zero when empty', () => {
    expect(preambleTotalTokens([usage('a'), usage('b')], 40)).toBe(0);
    expect(preambleTotalTokens([usage('a', { preambleTokens: 100 }), usage('b')], 40)).toBe(140);
  });

  it('sorts by uses, tokens or cost-per-use while catalog keeps store order', () => {
    const skills = [skill('a'), skill('b'), skill('c')];
    const map = usageByName([
      usage('a', { preambleTokens: 900, uses: 1 }), // 900 per use
      usage('b', { preambleTokens: 200, uses: 20 }), // 10 per use
      usage('c', { preambleTokens: 400, uses: 0 }), // unused → infinite cost
    ]);
    expect(sortSkillsForInsight(skills, map, 'catalog').map((s) => s.name)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(sortSkillsForInsight(skills, map, 'uses').map((s) => s.name)).toEqual(['b', 'a', 'c']);
    expect(sortSkillsForInsight(skills, map, 'tokens').map((s) => s.name)).toEqual(['a', 'c', 'b']);
    expect(sortSkillsForInsight(skills, map, 'cost').map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });

  it('nominates unused-then-costly preamble skills; explicit-only and disabled stay out', () => {
    const skills = [
      skill('unused'),
      skill('costly'),
      skill('healthy'),
      skill('ondemand', { explicitOnly: true }),
      skill('off', { enabled: false }),
    ];
    const map = usageByName([
      usage('unused', { preambleTokens: 500, uses: 0 }),
      usage('costly', { preambleTokens: 900, uses: 2 }), // 450 per use ≥ 300
      usage('healthy', { preambleTokens: 200, uses: 30 }),
      usage('ondemand', { preambleTokens: 0, uses: 0 }),
      usage('off', { preambleTokens: 0, uses: 0 }),
    ]);
    const names = declutterCandidates(skills, map, 45).map((c) => c.skill.name);
    expect(names).toEqual(['unused', 'costly']);
  });

  it('labels the last invocation in relative days', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    expect(lastUsedLabel(null, now)).toBeNull();
    expect(lastUsedLabel('2026-07-20T09:00:00.000Z', now)).toBe('today');
    expect(lastUsedLabel('2026-07-17T09:00:00.000Z', now)).toBe('3d ago');
    expect(lastUsedLabel('not-a-date', now)).toBeNull();
  });
});
