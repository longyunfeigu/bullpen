import { expect, test } from '@playwright/test';
import { realpathSync } from 'node:fs';
import { launchApp } from './helpers/launch';
import { createGitFixture } from './helpers/fixtures';

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
});
