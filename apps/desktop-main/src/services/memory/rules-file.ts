/**
 * Parse/serialize the shared project rules file `.charter/rules.md` (ADR-0028).
 *
 * Pure string logic, no IO. The file is the single source of truth for rule
 * text + enabled state and is meant to be hand-editable and git-shareable, so
 * parsing is lenient: every line we do not recognize is preserved verbatim and
 * round-trips byte-identically. Only three shapes are structural:
 *
 *   ## Group title              → group heading
 *   - [x] rule text <!-- charter:id=r-xxxx -->   → enabled rule
 *   - [ ] rule text             → disabled rule (id assigned on next write)
 */

export interface MemoryRuleEntry {
  id: string;
  text: string;
  group: string;
  enabled: boolean;
  /** False for hand-written lines without a charter:id comment yet. */
  hadId: boolean;
}

type ModelLine =
  | { kind: 'raw'; text: string }
  | { kind: 'group'; name: string; text: string }
  | { kind: 'rule'; rule: MemoryRuleEntry };

export interface RulesFileModel {
  lines: ModelLine[];
  /** True when parse assigned ids to hand-written rules (file should be rewritten). */
  assignedIds: boolean;
}

export const DEFAULT_RULE_GROUP = 'General';

const RULE_RE = /^-\s*\[([ xX])\]\s+(.*?)(?:\s*<!--\s*charter:id=([A-Za-z0-9_-]+)\s*-->)?\s*$/;
const GROUP_RE = /^##\s+(.+?)\s*$/;

/** Rules are single-line by design; collapse all whitespace runs when adding text. */
export function normalizeRuleText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseRulesFile(content: string, idFactory: () => string): RulesFileModel {
  const rawLines = content.length === 0 ? [] : content.split('\n');
  // A trailing newline yields one empty final element; drop it (serialize re-adds it).
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  const lines: ModelLine[] = [];
  let group = DEFAULT_RULE_GROUP;
  let assignedIds = false;
  let inFence = false;
  for (const text of rawLines) {
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
    if (!inFence) {
      const groupMatch = GROUP_RE.exec(text);
      if (groupMatch) {
        group = groupMatch[1] ?? DEFAULT_RULE_GROUP;
        lines.push({ kind: 'group', name: group, text });
        continue;
      }
      const ruleMatch = RULE_RE.exec(text);
      if (ruleMatch) {
        const hadId = ruleMatch[3] !== undefined;
        if (!hadId) assignedIds = true;
        lines.push({
          kind: 'rule',
          rule: {
            id: ruleMatch[3] ?? idFactory(),
            text: (ruleMatch[2] ?? '').trim(),
            group,
            enabled: ruleMatch[1] !== ' ',
            hadId,
          },
        });
        continue;
      }
    }
    lines.push({ kind: 'raw', text });
  }
  return { lines, assignedIds };
}

function renderRuleLine(rule: MemoryRuleEntry): string {
  return `- [${rule.enabled ? 'x' : ' '}] ${rule.text} <!-- charter:id=${rule.id} -->`;
}

export function serializeRulesFile(model: RulesFileModel): string {
  const body = model.lines
    .map((line) => (line.kind === 'rule' ? renderRuleLine(line.rule) : line.text))
    .join('\n');
  return body.length > 0 ? `${body}\n` : '';
}

export function createDefaultRulesFile(): string {
  return [
    '# Project rules',
    '',
    "<!-- charter:rules v1 — maintained by Charter's memory hub. Hand edits are safe:",
    'unrecognized lines are preserved verbatim; "- [x] / - [ ]" list items are enabled/disabled rules. -->',
    '',
  ].join('\n');
}

export function listRules(model: RulesFileModel): MemoryRuleEntry[] {
  const rules: MemoryRuleEntry[] = [];
  for (const line of model.lines) if (line.kind === 'rule') rules.push(line.rule);
  return rules;
}

/** Group display order = order of appearance (rules before any heading = General). */
export function listGroups(model: RulesFileModel): string[] {
  const groups: string[] = [];
  for (const rule of listRules(model)) {
    if (!groups.includes(rule.group)) groups.push(rule.group);
  }
  return groups;
}

export function findRule(model: RulesFileModel, ruleId: string): MemoryRuleEntry | null {
  for (const line of model.lines) {
    if (line.kind === 'rule' && line.rule.id === ruleId) return line.rule;
  }
  return null;
}

export interface AddRuleInput {
  id: string;
  text: string;
  group?: string;
  enabled?: boolean;
}

/**
 * Insert after the last line of the target group (heading created at EOF when
 * missing). Returns the added entry.
 */
export function addRule(model: RulesFileModel, input: AddRuleInput): MemoryRuleEntry {
  const group = (input.group ?? DEFAULT_RULE_GROUP).trim() || DEFAULT_RULE_GROUP;
  const rule: MemoryRuleEntry = {
    id: input.id,
    text: normalizeRuleText(input.text),
    group,
    enabled: input.enabled ?? true,
    hadId: true,
  };

  let groupStart = -1;
  for (let i = 0; i < model.lines.length; i += 1) {
    const line = model.lines[i];
    if (line && line.kind === 'group' && line.name === group) groupStart = i;
  }
  if (groupStart === -1) {
    if (model.lines.length > 0) model.lines.push({ kind: 'raw', text: '' });
    model.lines.push({ kind: 'group', name: group, text: `## ${group}` });
    model.lines.push({ kind: 'rule', rule });
    return rule;
  }
  // Insert after the last rule of this group segment (or right after the heading).
  let insertAt = groupStart + 1;
  for (let i = groupStart + 1; i < model.lines.length; i += 1) {
    const line = model.lines[i];
    if (!line || line.kind === 'group') break;
    if (line.kind === 'rule') insertAt = i + 1;
  }
  model.lines.splice(insertAt, 0, { kind: 'rule', rule });
  return rule;
}

export interface UpdateRulePatch {
  text?: string;
  group?: string;
  enabled?: boolean;
}

export function updateRule(
  model: RulesFileModel,
  ruleId: string,
  patch: UpdateRulePatch,
): MemoryRuleEntry | null {
  const rule = findRule(model, ruleId);
  if (!rule) return null;
  if (patch.text !== undefined) rule.text = normalizeRuleText(patch.text);
  if (patch.enabled !== undefined) rule.enabled = patch.enabled;
  if (patch.group !== undefined && patch.group.trim() && patch.group !== rule.group) {
    // Moving groups = remove the line and re-add under the target heading.
    removeRule(model, ruleId);
    return addRule(model, {
      id: rule.id,
      text: rule.text,
      group: patch.group,
      enabled: rule.enabled,
    });
  }
  return rule;
}

export function removeRule(model: RulesFileModel, ruleId: string): boolean {
  const index = model.lines.findIndex((line) => line.kind === 'rule' && line.rule.id === ruleId);
  if (index === -1) return false;
  model.lines.splice(index, 1);
  return true;
}
