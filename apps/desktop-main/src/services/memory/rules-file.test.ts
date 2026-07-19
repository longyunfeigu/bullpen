import { describe, expect, it } from 'vitest';
import {
  addRule,
  createDefaultRulesFile,
  DEFAULT_RULE_GROUP,
  findRule,
  listGroups,
  listRules,
  normalizeRuleText,
  parseRulesFile,
  removeRule,
  serializeRulesFile,
  updateRule,
} from './rules-file.js';

let counter = 0;
const nextId = (): string => `r-test${(counter += 1)}`;

describe('rules-file (ADR-0028)', () => {
  it('round-trips hand-written content byte-identically', () => {
    const content = [
      '# Project rules',
      '',
      '<!-- a hand comment -->',
      'Some prose the user wrote, kept verbatim.',
      '',
      '## Conventions',
      '- [x] Named exports only. <!-- charter:id=r-aaa -->',
      '- [ ] Commit messages in English. <!-- charter:id=r-bbb -->',
      '',
      '```',
      '- [x] inside a fence — not a rule',
      '```',
      '',
    ].join('\n');
    const model = parseRulesFile(content, nextId);
    expect(serializeRulesFile(model)).toBe(content);
    expect(model.assignedIds).toBe(false);
    const rules = listRules(model);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ id: 'r-aaa', enabled: true, group: 'Conventions' });
    expect(rules[1]).toMatchObject({ id: 'r-bbb', enabled: false });
  });

  it('fenced checkbox lines are preserved as raw, never parsed as rules', () => {
    const content = ['```md', '- [x] looks like a rule', '```', ''].join('\n');
    const model = parseRulesFile(content, nextId);
    expect(listRules(model)).toHaveLength(0);
    expect(serializeRulesFile(model)).toBe(content);
  });

  it('assigns ids to hand-written rules and flags the file for rewrite', () => {
    const model = parseRulesFile('- [x] Hand-written rule without id\n', nextId);
    expect(model.assignedIds).toBe(true);
    const [rule] = listRules(model);
    expect(rule?.id).toMatch(/^r-test/);
    expect(rule?.hadId).toBe(false);
    // Serialize normalizes the line with the assigned id.
    expect(serializeRulesFile(model)).toContain(`<!-- charter:id=${rule?.id} -->`);
  });

  it('rules before any heading fall into the default group', () => {
    const model = parseRulesFile('- [x] top rule <!-- charter:id=r-top -->\n', nextId);
    expect(listRules(model)[0]?.group).toBe(DEFAULT_RULE_GROUP);
    expect(listGroups(model)).toEqual([DEFAULT_RULE_GROUP]);
  });

  it('addRule appends to an existing group after its last rule', () => {
    const content = [
      '## A',
      '- [x] first <!-- charter:id=r-1 -->',
      'prose between rules stays put',
      '- [x] second <!-- charter:id=r-2 -->',
      '',
      '## B',
      '- [x] other <!-- charter:id=r-3 -->',
      '',
    ].join('\n');
    const model = parseRulesFile(content, nextId);
    addRule(model, { id: 'r-new', text: 'third', group: 'A' });
    const out = serializeRulesFile(model);
    const indexNew = out.indexOf('r-new');
    expect(indexNew).toBeGreaterThan(out.indexOf('r-2'));
    expect(indexNew).toBeLessThan(out.indexOf('## B'));
  });

  it('addRule creates a missing group heading at EOF', () => {
    const model = parseRulesFile(createDefaultRulesFile(), nextId);
    addRule(model, { id: 'r-x', text: 'Use vitest', group: 'Testing' });
    const out = serializeRulesFile(model);
    expect(out).toContain('## Testing');
    expect(out).toContain('- [x] Use vitest <!-- charter:id=r-x -->');
  });

  it('updateRule toggles enabled and rewrites text; group move re-homes the line', () => {
    const model = parseRulesFile('## A\n- [x] rule <!-- charter:id=r-1 -->\n', nextId);
    updateRule(model, 'r-1', { enabled: false, text: 'better  text' });
    expect(findRule(model, 'r-1')).toMatchObject({ enabled: false, text: 'better text' });
    updateRule(model, 'r-1', { group: 'B' });
    expect(findRule(model, 'r-1')?.group).toBe('B');
    expect(serializeRulesFile(model)).toContain('## B');
  });

  it('removeRule deletes only the rule line', () => {
    const model = parseRulesFile('## A\n- [x] rule <!-- charter:id=r-1 -->\nprose\n', nextId);
    expect(removeRule(model, 'r-1')).toBe(true);
    expect(removeRule(model, 'r-1')).toBe(false);
    expect(serializeRulesFile(model)).toBe('## A\nprose\n');
  });

  it('normalizeRuleText collapses newlines (rules are single-line)', () => {
    expect(normalizeRuleText('no default\nexport,\r\n  ever')).toBe('no default export, ever');
  });
});
