import { describe, expect, it } from 'vitest';
import type { SkillConsumerUsage, SkillDto, SkillUsageDto } from '@pi-ide/ipc-contracts';
import {
  consumerBreakdown,
  declutterCandidates,
  lastUsedLabel,
  preambleTotalTokens,
  projectUsage,
  sortSkillsForInsight,
  sparkStacks,
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

function series(patch: Partial<SkillConsumerUsage> = {}): SkillConsumerUsage {
  return { uses: 0, lastUsedAt: null, weekly: [0], ...patch };
}

/** Unless byConsumer is given, all top-level uses read as Charter's own. */
function usage(name: string, patch: Partial<SkillUsageDto> = {}): SkillUsageDto {
  const base = { name, preambleTokens: 0, uses: 0, lastUsedAt: null, weekly: [0], ...patch };
  return {
    ...base,
    byConsumer: patch.byConsumer ?? {
      charter: series({ uses: base.uses, lastUsedAt: base.lastUsedAt, weekly: base.weekly }),
      claude: series({ weekly: base.weekly.map(() => 0) }),
      codex: series({ weekly: base.weekly.map(() => 0) }),
    },
  };
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
    const candidates = declutterCandidates(skills, map, 45);
    expect(candidates.map((c) => c.skill.name)).toEqual(['unused', 'costly']);
    expect(candidates.map((c) => c.preselect)).toEqual([true, false]);
  });

  it('labels the last invocation in relative days', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    expect(lastUsedLabel(null, now)).toBeNull();
    expect(lastUsedLabel('2026-07-20T09:00:00.000Z', now)).toBe('today');
    expect(lastUsedLabel('2026-07-17T09:00:00.000Z', now)).toBe('3d ago');
    expect(lastUsedLabel('not-a-date', now)).toBeNull();
  });
});

describe('per-consumer insight helpers (ADR-0040)', () => {
  const mixed = usage('mixed', {
    preambleTokens: 400,
    uses: 5,
    lastUsedAt: '2026-07-19T10:00:00.000Z',
    weekly: [2, 3],
    byConsumer: {
      charter: series({ uses: 2, lastUsedAt: '2026-07-14T10:00:00.000Z', weekly: [2, 0] }),
      claude: series({ uses: 3, lastUsedAt: '2026-07-19T10:00:00.000Z', weekly: [0, 3] }),
      codex: series({ weekly: [0, 0] }),
    },
  });

  it('projectUsage keeps rows verbatim for "all" and swaps in one slice otherwise', () => {
    expect(projectUsage([mixed], 'all')).toEqual([mixed]);
    const [claudeOnly] = projectUsage([mixed], 'claude');
    expect(claudeOnly).toMatchObject({
      uses: 3,
      lastUsedAt: '2026-07-19T10:00:00.000Z',
      weekly: [0, 3],
      preambleTokens: 400,
    });
    expect(claudeOnly!.byConsumer).toEqual(mixed.byConsumer);
  });

  it('sorts follow the projection (a Claude-heavy skill wins under the claude filter)', () => {
    const skills = [skill('local'), skill('mixed')];
    const local = usage('local', { preambleTokens: 100, uses: 4 }); // all charter
    const projected = usageByName(projectUsage([local, mixed], 'claude'));
    expect(sortSkillsForInsight(skills, projected, 'uses').map((s) => s.name)).toEqual([
      'mixed',
      'local',
    ]);
  });

  it('consumerBreakdown lists non-zero consumers with their own recency', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    expect(consumerBreakdown(mixed, now)).toBe(
      'Charter 2× (last 6d ago) · Claude Code 3× (last 1d ago)',
    );
    expect(consumerBreakdown(usage('idle'), now)).toBe('no invocations in the window');
  });

  it('sparkStacks stacks non-zero segments per bucket in fixed consumer order', () => {
    expect(sparkStacks(mixed, 'all')).toEqual([
      [{ consumer: 'charter', count: 2, color: '#6ca1e8' }],
      [{ consumer: 'claude', count: 3, color: '#e0876a' }],
    ]);
    expect(sparkStacks(mixed, 'claude')).toEqual([
      [],
      [{ consumer: 'claude', count: 3, color: '#e0876a' }],
    ]);
  });

  it('externally-used skills stay candidates but are never preselected', () => {
    const skills = [skill('external-only')];
    const map = usageByName([
      usage('external-only', {
        preambleTokens: 500,
        uses: 4,
        weekly: [4],
        byConsumer: {
          charter: series(),
          claude: series({ uses: 4, lastUsedAt: '2026-07-19T10:00:00.000Z', weekly: [4] }),
          codex: series(),
        },
      }),
    ]);
    const candidates = declutterCandidates(skills, map, 45);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.preselect).toBe(false);
    expect(candidates[0]!.reason).toContain('Claude Code 4×');
  });

  it('cost-per-use divides by Charter uses only (external runs cost nothing here)', () => {
    const skills = [skill('shared')];
    // 20 total uses would look healthy, but only 2 hit Charter's preamble.
    const map = usageByName([
      usage('shared', {
        preambleTokens: 900,
        uses: 20,
        weekly: [20],
        byConsumer: {
          charter: series({ uses: 2, lastUsedAt: '2026-07-19T10:00:00.000Z', weekly: [2] }),
          claude: series({ uses: 18, lastUsedAt: '2026-07-19T10:00:00.000Z', weekly: [18] }),
          codex: series(),
        },
      }),
    ]);
    const candidates = declutterCandidates(skills, map, 45);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.preselect).toBe(false);
    expect(candidates[0]!.reason).toContain('450 tokens per use');
  });
});
