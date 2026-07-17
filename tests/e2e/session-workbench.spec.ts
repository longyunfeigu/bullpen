import { expect, test } from '@playwright/test';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createGitFixture } from './helpers/fixtures';

/** Idle fake agent CLIs so quick-spawned PTYs stay alive without real agents. */
function createIdleAgentBins(): string {
  const bin = mkdtempSync(join(tmpdir(), 'pi-ide-qs-bin-'));
  for (const cli of ['claude', 'codex']) {
    writeFileSync(
      join(bin, cli),
      [
        '#!/usr/bin/env node',
        `console.log(${JSON.stringify(`${cli} ready`)});`,
        'process.stdin.resume();',
        'setTimeout(() => process.exit(0), 60000);',
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, cli), 0o755);
  }
  return bin;
}

test.describe('Session Rail Workbench', () => {
  test('keeps Sessions present across Pi, in-room editing and the full workspace', async () => {
    const fixture = realpathSync(createGitFixture());
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
      home: 'keep',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    try {
      await expect(page.getByTestId('home-sidebar')).toBeVisible();

      // New Session returns directly to the Codex-style task composer; choosing
      // a different native execution surface remains one secondary action away.
      await page.getByTestId('home-new-task').click();
      await expect(page.getByTestId('home-view')).toBeVisible();
      await page.getByTestId('session-new-menu').click();
      await expect(page.getByTestId('session-create-dialog')).toBeVisible();
      await page.getByTestId('session-kind-claude').click();
      await expect(page.getByTestId('session-create-submit')).toContainText('Claude Session');
      await page.getByTestId('session-kind-codex').click();
      await expect(page.getByTestId('session-create-submit')).toContainText('Codex Session');
      await page.getByTestId('session-kind-pi').click();
      await page.getByTestId('session-create-submit').click();

      await expect(page.getByTestId('home-view')).toBeVisible();
      await page.getByTestId('home-mode-auto').click();
      await page.getByTestId('home-intent').fill('[scenario:edit-basic] session-first edit');
      await page.getByTestId('home-submit').click();
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
        timeout: 30000,
      });

      // The real Monaco document model opens beside the continuous Pi run.
      await page.getByTestId('task-room-edit-file').click();
      await expect(page.getByTestId('peek-mode-edit')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('file-peek').getByTestId('editor-groups')).toBeVisible();
      await expect(page.getByTestId('home-sidebar')).toBeVisible();

      // The expert workspace is another view in the same Session shell, not a
      // second global entry; the selected Session remains visible and resumable.
      await page.getByTestId('task-room-open-editor').click();
      await expect(page.getByTestId('editor-area')).toBeVisible();
      await expect(page.getByTestId('home-sidebar')).toContainText('session-first edit');
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await expect(page.getByTestId('file-peek')).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // ADR-0023 direction D: activity bar + project-grouped panel with an
  // attention row, an Inbox destination and a resident working-context row.
  test('groups sessions by project and routes attention through the inbox', async () => {
    const fixture = realpathSync(createGitFixture());
    const name = fixture.split('/').pop()!;
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
      home: 'keep',
    });
    try {
      await expect(page.getByTestId('home-sidebar')).toBeVisible();
      await page.getByTestId('home-new-task').click();
      await expect(page.getByTestId('home-view')).toBeVisible();
      await expect(page.getByTestId('home-model')).toContainText(/mock/i, { timeout: 15000 });
      await page.getByTestId('home-mode-auto').click();
      await page.getByTestId('home-intent').fill('[scenario:edit-basic] direction d walk');
      await page.getByTestId('home-submit').click();
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
        timeout: 30000,
      });

      // The session sits under its project group; the header carries the
      // attention badge so a collapsed group never hides that it wants you.
      const group = page.getByTestId(`rail-group-${name}`);
      await expect(group).toBeVisible();
      await expect(group).toContainText('1 need you');

      // The amber Needs-you row and the Inbox destination are one queue:
      // the row opens the triage panel, a panel row opens its room.
      await expect(page.getByTestId('rail-needs-you')).toContainText('1');
      await page.getByTestId('rail-needs-you').click();
      await expect(page.getByTestId('rail-inbox-panel')).toBeVisible();
      await page
        .locator('[data-testid="rail-inbox-panel"] [data-testid^="home-task-"]')
        .first()
        .click();
      await expect(page.getByTestId('task-room')).toBeVisible();

      // Collapse hides the rows but keeps the badge; expand restores them.
      await page.getByTestId('rail-view-sessions').click();
      await group.click();
      await expect(page.locator('[data-testid^="home-task-"]')).toHaveCount(0);
      await expect(group).toContainText('1 need you');
      await group.click();
      await expect(page.locator('[data-testid^="home-task-"]').first()).toBeVisible();

      // The resident working-context row routes to the Projects panel.
      await expect(page.getByTestId('rail-context')).toContainText(name);
      await page.getByTestId('rail-context').click();
      await expect(page.getByTestId('rail-projects-panel')).toBeVisible();
      await expect(page.locator('[data-testid^="home-recent-"].active')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  // ADR-0023 amendment: hovering a Projects-panel row reveals π/Claude/Codex
  // starters — one click starts a session bound to that project, without
  // touching the global working context (Claude/Codex) or with the composer
  // focused (π). Session rows never repeat the CLI name as their title.
  test('starts project-bound sessions from the Projects panel starters', async () => {
    const fixture = realpathSync(createGitFixture());
    const bin = createIdleAgentBins();
    const { app, page } = await launchApp({
      env: {
        PI_IDE_OPEN_WORKSPACE: fixture,
        PI_IDE_FORCE_MOCK: '1',
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
      home: 'keep',
    });
    const name = fixture.split('/').pop()!;
    try {
      await expect(page.getByTestId('home-sidebar')).toBeVisible();
      // The boot-time workspace open swaps the shell tree and remounts the
      // rail — wait until the working context is bound before driving panel
      // state, or the Projects view resets underneath the test.
      await expect(page.getByTestId('rail-context')).toContainText(name);
      await page.getByTestId('rail-view-projects').click();
      await expect(page.getByTestId('rail-projects-panel')).toBeVisible();

      // The starter chip is hover-revealed (opacity, so the buttons keep
      // their geometry); the row keeps its full hit area.
      const row = page.getByTestId(`home-recent-${fixture}`);
      await expect(row).toBeVisible();
      const chip = page.locator('.sr-project-wrap').filter({ has: row }).locator('.sr-project-qs');
      await expect(chip).toHaveCSS('opacity', '0');
      await row.hover();
      await expect(chip).toHaveCSS('opacity', '1');

      // One click: a Claude PTY session opens, cwd-bound to the project.
      await page.getByTestId(`project-spawn-claude-${fixture}`).click();
      await expect(page.getByTestId('session-terminal-view')).toBeVisible();
      await expect(page.getByTestId('session-terminal-view')).toContainText(fixture);

      // The rail row identifies the provider by mark, not by a hardcoded
      // CLI-name title. The fake CLI is detected as an external session and
      // the row converts from terminal to task — both shapes must satisfy
      // the naming rule.
      const railRow = page
        .locator('[data-session-key]')
        .filter({ has: page.locator('.sr-provider.claude') })
        .first();
      await expect(railRow).toBeVisible();
      await expect(railRow).toContainText(/New session|external session/i);
      await expect(railRow).not.toContainText('Claude Code');

      // π starter: the project becomes the working context and the composer
      // is focused, ready for intent.
      await page.getByTestId('rail-view-projects').click();
      await page.getByTestId(`home-recent-${fixture}`).hover();
      await page.getByTestId(`project-spawn-pi-${fixture}`).click();
      await expect(page.getByTestId('home-view')).toBeVisible();
      await expect(page.getByTestId('home-intent')).toBeFocused();
    } finally {
      await app.close();
    }
  });
});
