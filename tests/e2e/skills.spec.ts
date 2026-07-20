import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch.js';
import { createGitFixture } from './helpers/fixtures.js';

/**
 * Skills (ADR-0015): managed store + Settings manager + composer "/" picker.
 * Skills are pre-seeded into the managed store (userData/skills) — the product
 * itself never scans project folders for skills (AG-014).
 */

function seedSkill(
  skillsDir: string,
  name: string,
  options: { description: string; explicitOnly?: boolean; script?: boolean } = {
    description: '',
  },
): void {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${options.description}`,
      ...(options.explicitOnly ? ['disable-model-invocation: true'] : []),
      '---',
      `You are using the ${name} skill. Follow its steps carefully.`,
      '',
    ].join('\n'),
  );
  if (options.script) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'run.py'), 'print("hi")\n');
  }
}

test('skills: manager (toggle/audit) + "/" picker + /skill: task through the mock runtime', async () => {
  test.setTimeout(120000);
  const userDataDir = mkdtempSync(join(tmpdir(), 'pi-ide-skills-'));
  const skillsDir = join(userDataDir, 'skills');
  seedSkill(skillsDir, 'pdf-fill', {
    description: 'Fill and extract fields from PDF forms.',
    script: true,
  });
  seedSkill(skillsDir, 'deploy-staging', {
    description: 'Deploy the current branch to staging.',
    explicitOnly: true,
  });

  const fixture = createGitFixture();
  const { app, page } = await launchApp({
    userDataDir,
    env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
  });
  try {
    await page.getByTestId('surface-home').click();
    await expect(page.getByTestId('home-model')).toContainText(/mock/i, { timeout: 15000 });

    // ---- composer "/" picker: only enabled skills, filter + insert ----
    const intent = page.getByTestId('home-intent');
    await intent.click();
    await intent.press('/');
    await expect(page.getByTestId('home-skill-picker')).toBeVisible();
    await expect(page.getByTestId('home-skill-item-pdf-fill')).toBeVisible();
    // The explicit-only skill still appears in "/" — that is its invocation path.
    await expect(page.getByTestId('home-skill-item-deploy-staging')).toContainText('explicit-only');
    // Typing filters; Enter inserts the /skill: command.
    await intent.pressSequentially('pdf');
    await expect(page.getByTestId('home-skill-item-deploy-staging')).toHaveCount(0);
    await intent.press('Enter');
    await expect(intent).toHaveValue('/skill:pdf-fill ');
    await expect(page.getByTestId('home-skill-picker')).toHaveCount(0);

    // ---- a /skill: task runs (mock scenario tag rides in the args) ----
    await page.getByTestId('home-mode-ask').click();
    await intent.pressSequentially('[scenario:ask-basic] what is this project?');
    await intent.press('Enter');
    await expect(page.getByTestId('tl-answered')).toBeVisible({ timeout: 30000 });
    // The timeline shows what the user typed — the raw command, not the expansion.
    await expect(page.getByTestId('task-room')).toContainText('/skill:pdf-fill');
    await page.getByTestId('task-room-back').click();

    // ---- Settings → Agent → Skills manager ----
    await page.getByTestId('home-settings').click();
    await page.locator('.st-nav-item', { hasText: 'Skills' }).click();
    const row = page.getByTestId('skill-row-pdf-fill');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Fill and extract fields');
    await expect(row).toContainText('1 script');
    await expect(page.getByTestId('skill-row-deploy-staging')).toContainText('explicit-only');

    // Audit view: SKILL.md + bundled files, scripts flagged.
    await page.getByTestId('skill-audit-pdf-fill').click();
    const audit = page.getByTestId('skill-audit-panel-pdf-fill');
    await expect(audit).toBeVisible();
    await expect(audit).toContainText('You are using the pdf-fill skill');
    await expect(audit).toContainText('scripts/run.py');
    await expect(audit).toContainText('Permission Engine');

    // Toggle Off: the row dims…
    await page.getByTestId('skill-off-pdf-fill').click();
    await expect(row).toHaveClass(/off/);

    // …and the skill vanishes from the "/" picker immediately.
    await page.getByTestId('overlay-settings').getByLabel('Close').click();
    await intent.click();
    await intent.press('/');
    await expect(page.getByTestId('home-skill-picker')).toBeVisible();
    await expect(page.getByTestId('home-skill-item-deploy-staging')).toBeVisible();
    await expect(page.getByTestId('home-skill-item-pdf-fill')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('skills: discovers and live-syncs a trusted external Agent Skills source', async () => {
  test.setTimeout(120000);
  const userDataDir = mkdtempSync(join(tmpdir(), 'pi-ide-live-skills-'));
  const skillHome = mkdtempSync(join(tmpdir(), 'pi-ide-skill-home-'));
  const agentsRoot = join(skillHome, '.agents', 'skills');
  const alphaDir = join(agentsRoot, 'live-alpha');
  seedSkill(agentsRoot, 'live-alpha', { description: 'Live description version one.' });

  const fixture = createGitFixture();
  const { app, page } = await launchApp({
    userDataDir,
    env: {
      PI_IDE_OPEN_WORKSPACE: fixture,
      PI_IDE_FORCE_MOCK: '1',
      PI_IDE_SKILLS_HOME: skillHome,
    },
  });
  try {
    await page.getByTestId('surface-home').click();
    await page.getByTestId('home-settings').click();
    await page.locator('.st-nav-item', { hasText: 'Skills' }).click();

    const source = page.getByTestId('skill-source-agents');
    await expect(source).toContainText('1 found');
    const alphaRow = page.locator('.st-skill-row', { hasText: 'live-alpha' });
    await expect(alphaRow).toBeVisible();
    await expect(alphaRow).toContainText('Agent Skills');
    await expect(alphaRow).toContainText('live');
    await expect(alphaRow).toHaveClass(/off/); // discovery is not trust

    // Trust the root and opt into automatic enablement for existing/future
    // skills that do not have a per-skill override.
    await page.getByTestId('skill-source-trust-agents').check();
    await page.getByTestId('skill-source-auto-agents').check();
    await expect(alphaRow).not.toHaveClass(/off/);

    // Atomic-ish editor update + newly added folder are reconciled by the
    // watcher and broadcast to the already-open Settings surface.
    writeFileSync(
      join(alphaDir, 'SKILL.md'),
      [
        '---',
        'name: live-alpha',
        'description: Live description version two.',
        '---',
        'Updated live instructions.',
      ].join('\n'),
    );
    seedSkill(agentsRoot, 'live-beta', { description: 'Added after app launch.' });
    await expect(source).toContainText('2 found', { timeout: 15000 });
    await expect(alphaRow).toContainText('Live description version two.');
    const betaRow = page.locator('.st-skill-row', { hasText: 'live-beta' });
    await expect(betaRow).toBeVisible();
    await expect(betaRow).not.toHaveClass(/off/);

    // Deletion propagates too; Charter never owns or recreates linked files.
    rmSync(alphaDir, { recursive: true, force: true });
    await expect(source).toContainText('1 found', { timeout: 15000 });
    await expect(alphaRow).toHaveCount(0);

    await page.getByTestId('overlay-settings').getByLabel('Close').click();
    const intent = page.getByTestId('home-intent');
    await intent.click();
    await intent.press('/');
    await expect(page.getByTestId('home-skill-item-live-beta')).toBeVisible();
    await expect(page.getByTestId('home-skill-item-live-alpha')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(skillHome, { recursive: true, force: true });
  }
});
