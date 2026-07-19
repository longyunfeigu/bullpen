import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, MIGRATIONS, type SqlDatabase } from '@pi-ide/persistence';
import { createLogger } from '@pi-ide/foundation';
import { ProductFailure } from '@pi-ide/foundation';
import { MemoryService } from './memory-service.js';
import { MANAGED_BLOCK_BEGIN, MANAGED_BLOCK_END } from './memory/managed-block.js';

let dir: string;
let project: string;
let db: SqlDatabase;
let service: MemoryService;
let events: { projectPath: string | null; reason: string }[];
let taskEvents: { taskId: string; type: string; payload: unknown }[];
let capture = true;
let idCounter = 0;

const logger = createLogger('memory-test', { write: () => {} }, { minLevel: 'error' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-ide-memsvc-'));
  project = mkdtempSync(join(tmpdir(), 'pi-ide-memsvc-proj-'));
  db = openDatabase({
    file: join(dir, 'app.db'),
    backupDir: join(dir, 'backups'),
    migrations: MIGRATIONS,
  }).db;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO workspaces (id, canonical_path, display_name, last_opened_at, created_at) VALUES ('ws1', ?, 'w', ?, ?)",
  ).run(project, now, now);
  db.prepare(
    "INSERT INTO tasks (id, workspace_id, title, goal_md, mode, state, model_json, created_at, updated_at) VALUES ('t1', 'ws1', '修复登录重定向', 'g', 'edit', 'REVIEW_READY', '{}', ?, ?)",
  ).run(now, now);
  events = [];
  taskEvents = [];
  capture = true;
  idCounter = 0;
  service = new MemoryService({
    db,
    logger,
    trashDir: join(dir, 'trash'),
    homeDir: join(dir, 'home'),
    broadcast: (payload) => events.push(payload),
    captureEnabled: () => capture,
    recordTaskEvent: (taskId, type, payload) => taskEvents.push({ taskId, type, payload }),
    idFactory: () => `r-fix${(idCounter += 1)}`,
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const CORRECTION = '不要用 default export,项目一律具名导出';

describe('MemoryService (ADR-0028)', () => {
  it('captures a request-fix correction as a pending candidate with provenance', () => {
    service.captureCorrection({ taskId: 't1', kind: 'request-fix', text: CORRECTION });
    const { candidates, projectPath } = service.candidatesForTask('t1');
    expect(projectPath).toBe(project);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      text: CORRECTION,
      status: 'pending',
      similarCount: 1,
      matchedRuleId: null,
    });
    expect(candidates[0]?.origin).toMatchObject({ kind: 'request-fix', taskId: 't1' });
    expect(candidates[0]?.origin.label).toContain('修复登录重定向');
    expect(events.some((event) => event.reason === 'candidate-captured')).toBe(true);
  });

  it('merges similar corrections into one candidate instead of stacking duplicates', () => {
    service.captureCorrection({ taskId: 't1', kind: 'request-fix', text: CORRECTION });
    service.captureCorrection({
      taskId: 't1',
      kind: 'request-fix',
      text: '禁止 default export;导出一律使用具名导出',
    });
    const { candidates } = service.candidatesForTask('t1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.similarCount).toBe(2);
  });

  it('capture is a no-op when the setting is off', () => {
    capture = false;
    service.captureCorrection({ taskId: 't1', kind: 'request-fix', text: CORRECTION });
    expect(service.candidatesForTask('t1').candidates).toHaveLength(0);
  });

  it('approving a candidate writes the rule into .charter/rules.md with source stats', () => {
    service.captureCorrection({ taskId: 't1', kind: 'request-fix', text: CORRECTION });
    const [candidate] = service.candidatesForTask('t1').candidates;
    const rule = service.resolveCandidate({
      projectPath: project,
      candidateId: candidate!.id,
      action: 'approve',
      editedText: '导出一律使用具名导出;禁止 default export。',
      group: 'Conventions',
    });
    expect(rule).toMatchObject({
      text: '导出一律使用具名导出;禁止 default export。',
      group: 'Conventions',
      enabled: true,
      sourceTaskId: 't1',
    });
    const file = readFileSync(join(project, '.charter', 'rules.md'), 'utf8');
    expect(file).toContain('# Project rules');
    expect(file).toContain('## Conventions');
    expect(file).toContain('- [x] 导出一律使用具名导出;禁止 default export。');
    // Candidate is resolved, not pending anymore.
    expect(service.candidatesForTask('t1').candidates).toHaveLength(0);
    const overview = service.overview(project);
    expect(overview.stats.enabled).toBe(1);
    expect(overview.rules[0]?.sourceLabel).toContain('Request fix');
    // Timeline receipt lands in the source task (replay-traceable provenance).
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]).toMatchObject({ taskId: 't1', type: 'memory.distilled' });
  });

  it('approving a task-less candidate (manual/import/promote) records no timeline receipt', () => {
    const added = service.applyImport(project, [
      { text: 'Always pin dependency versions in package.json', source: 'agents-md' },
    ]);
    expect(added).toBe(1);
    const [candidate] = service.overview(project).candidates;
    service.resolveCandidate({
      projectPath: project,
      candidateId: candidate!.id,
      action: 'approve',
    });
    expect(taskEvents).toHaveLength(0);
  });

  it('a correction matching an existing enabled rule counts as a hit and marks the candidate', () => {
    service.addRuleFromInput({ projectPath: project, text: CORRECTION });
    service.captureCorrection({
      taskId: 't1',
      kind: 'request-fix',
      text: '又来了:不要 default export,要具名导出',
    });
    const overview = service.overview(project);
    expect(overview.stats.hitsTotal).toBe(1);
    expect(overview.rules[0]?.hitCount).toBe(1);
    const [candidate] = service.candidatesForTask('t1').candidates;
    expect(candidate?.matchedRuleId).toBe(overview.rules[0]?.id);
  });

  it('projectRulesBlock renders enabled rules only and records injections per task', () => {
    service.addRuleFromInput({ projectPath: project, text: 'Rule A' });
    const disabled = service.addRuleFromInput({ projectPath: project, text: 'Rule B' });
    service.updateRuleFromInput({ projectPath: project, ruleId: disabled.id, enabled: false });

    const block = service.projectRulesBlock('t1');
    expect(block).toContain('<project_rules>');
    expect(block).toContain('- Rule A');
    expect(block).not.toContain('Rule B');

    // Injection recorded once per rule+task (idempotent re-runs).
    service.projectRulesBlock('t1');
    const overview = service.overview(project);
    const ruleA = overview.rules.find((rule) => rule.text === 'Rule A');
    expect(ruleA?.injectedTasks).toBe(1);
    expect(overview.stats.injectedTasks7d).toBe(1);
  });

  it('projectRulesBlock is null with no rules and never throws for unknown tasks', () => {
    expect(service.projectRulesBlock('t1')).toBeNull();
    expect(service.projectRulesBlock('nope')).toBeNull();
  });

  it('sync enable writes the CLAUDE.md managed block as one import line, preserving prose', () => {
    writeFileSync(join(project, 'CLAUDE.md'), '# Hand written\n\nKeep me.\n');
    service.addRuleFromInput({ projectPath: project, text: 'Rule A' });
    service.setSyncEnabled(project, 'claude-md', true);
    const content = readFileSync(join(project, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('Keep me.');
    expect(content).toContain(MANAGED_BLOCK_BEGIN);
    expect(content).toContain('@.charter/rules.md');
    expect(content).not.toContain('- Rule A'); // import line, not rendered rules
    const state = service.syncStatesFor(project).find((s) => s.target === 'claude-md');
    expect(state).toMatchObject({ enabled: true, status: 'ok' });
  });

  it('AGENTS.md projection renders the enabled rule list and follows rule changes', () => {
    service.addRuleFromInput({ projectPath: project, text: 'Rule A' });
    service.setSyncEnabled(project, 'agents-md', true);
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toContain('- Rule A');
    // Rules change → enabled projection follows automatically.
    service.addRuleFromInput({ projectPath: project, text: 'Rule B' });
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toContain('- Rule B');
  });

  it('hand edits inside the managed block flag drift and are never overwritten silently', () => {
    service.addRuleFromInput({ projectPath: project, text: 'Rule A' });
    service.setSyncEnabled(project, 'agents-md', true);
    const drifted = readFileSync(join(project, 'AGENTS.md'), 'utf8').replace(
      '- Rule A',
      '- Rule A\n- Hand-added rule about npm run check',
    );
    writeFileSync(join(project, 'AGENTS.md'), drifted);

    service.applySync(project, 'agents-md');
    const state = service.syncStatesFor(project).find((s) => s.target === 'agents-md');
    expect(state?.status).toBe('drift');
    // File untouched by the refused sync.
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toContain('Hand-added rule');
  });

  it('resolveDrift import moves the hand edit into candidates, then rewrites the block', () => {
    service.addRuleFromInput({ projectPath: project, text: 'Rule A' });
    service.setSyncEnabled(project, 'agents-md', true);
    const drifted = readFileSync(join(project, 'AGENTS.md'), 'utf8').replace(
      '- Rule A',
      '- Rule A\n- Always run npm run check before committing changes',
    );
    writeFileSync(join(project, 'AGENTS.md'), drifted);
    service.applySync(project, 'agents-md');

    const { sync, candidateId } = service.resolveDrift(project, 'agents-md', 'import');
    expect(candidateId).not.toBeNull();
    expect(sync.find((s) => s.target === 'agents-md')?.status).toBe('ok');
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).not.toContain('npm run check');
    const overview = service.overview(project);
    expect(overview.candidates.some((candidate) => candidate.text.includes('npm run check'))).toBe(
      true,
    );
  });

  it('resolveDrift stop disables the target without touching the file', () => {
    service.addRuleFromInput({ projectPath: project, text: 'Rule A' });
    service.setSyncEnabled(project, 'agents-md', true);
    const before = readFileSync(join(project, 'AGENTS.md'), 'utf8');
    const { sync } = service.resolveDrift(project, 'agents-md', 'stop');
    expect(sync.find((s) => s.target === 'agents-md')).toMatchObject({
      enabled: false,
      status: 'off',
    });
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toBe(before);
  });

  it('reverse import scans conventions outside the managed block and dedupes against rules', () => {
    service.addRuleFromInput({ projectPath: project, text: 'Named exports only, never default' });
    writeFileSync(
      join(project, 'CLAUDE.md'),
      [
        '# Instructions',
        '- Named exports only — never use default export', // similar to existing rule → skipped
        '- Always run the boundary checker before pushing',
        '',
      ].join('\n'),
    );
    const { items } = service.scanImport(project);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('boundary checker');
    const added = service.applyImport(project, items);
    expect(added).toBe(1);
    expect(service.overview(project).candidates[0]?.origin.kind).toBe('reverse-import');
  });

  it('overview flags unknown folders as unavailable; mutations require a workspace', () => {
    const overview = service.overview('/nowhere/special');
    expect(overview.available).toBe(false);
    expect(() => service.addRuleFromInput({ projectPath: '/nowhere/special', text: 'x' })).toThrow(
      ProductFailure,
    );
  });

  it('hand-edited rules file (no ids) is adopted: ids assigned on next write, content kept', () => {
    mkdirSync(join(project, '.charter'), { recursive: true });
    writeFileSync(
      join(project, '.charter', 'rules.md'),
      '## Conventions\n- [x] Hand written rule\n',
    );
    const overview = service.overview(project);
    expect(overview.rules).toHaveLength(1);
    // A write path (add) re-serializes and assigns the id.
    service.addRuleFromInput({ projectPath: project, text: 'Second rule', group: 'Conventions' });
    const file = readFileSync(join(project, '.charter', 'rules.md'), 'utf8');
    expect(file).toContain('- [x] Hand written rule <!-- charter:id=');
    expect(file).toContain('- [x] Second rule');
  });

  it('external discovery is gated off (E2E-style) when discoverExternal is false', () => {
    const gated = new MemoryService({
      db,
      logger,
      trashDir: join(dir, 'trash'),
      homeDir: join(dir, 'home'),
      discoverExternal: false,
    });
    mkdirSync(join(dir, 'home', '.claude'), { recursive: true });
    writeFileSync(join(dir, 'home', '.claude', 'CLAUDE.md'), 'x\n');
    expect(gated.externalList(project)).toEqual([]);
  });

  it('external promote lands as a candidate bound to the project', () => {
    mkdirSync(join(dir, 'home', '.claude'), { recursive: true });
    writeFileSync(
      join(dir, 'home', '.claude', 'CLAUDE.md'),
      'Global habit: verify before claiming done.\n',
    );
    const [file] = service.externalList(project);
    const candidate = service.externalPromote(project, file!.id);
    expect(candidate.origin).toMatchObject({ kind: 'external-promote', agent: 'claude' });
    expect(candidate.text).toContain('verify before claiming');
    expect(existsSync(join(dir, 'home', '.claude', 'CLAUDE.md'))).toBe(true); // one-way copy
  });
});
