import { describe, expect, it } from 'vitest';
import type { SkillDto } from '@pi-ide/ipc-contracts';
import { isAgentEnabled } from './skills-model.js';

function skill(source: SkillDto['source'], patch: Partial<SkillDto> = {}): SkillDto {
  return {
    id: `${source}-skill`,
    name: `${source}-skill`,
    displayName: 'shared-skill',
    description: 'Shared skill.',
    enabled: false,
    explicitOnly: false,
    source,
    sourceId: source,
    sourceLabel: source,
    sourcePath: `~/.${source}/skills/shared-skill`,
    live: source !== 'managed',
    status: 'ready',
    compatibility: 'compatible',
    issues: [],
    revision: 'r'.repeat(64),
    files: ['SKILL.md'],
    scriptCount: 0,
    importedAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...patch,
  };
}

describe('Agent-native Skill status', () => {
  it('does not mistake Charter trust for Claude/Codex native availability', () => {
    expect(isAgentEnabled(skill('claude'))).toBe(true);
    expect(isAgentEnabled(skill('codex'))).toBe(true);
    expect(isAgentEnabled(skill('managed'))).toBe(false);
  });

  it('honors an explicit parked-copy state from the current main process', () => {
    expect(isAgentEnabled(skill('claude', { agentEnabled: false }))).toBe(false);
    expect(isAgentEnabled(skill('claude', { agentEnabled: true }))).toBe(true);
  });
});
