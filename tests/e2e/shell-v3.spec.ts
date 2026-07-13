import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { createTsSmallFixture } from './helpers/fixtures';

/**
 * Shell v3 (ADR-0008): Task Room, entry consolidation and humane language.
 * The engine flows underneath are covered by E2E-009..018; these tests pin the
 * task-centric shell semantics.
 */
test.describe('Shell v3 — Task Room and entry consolidation', () => {
  test('PIVOT-021: the room hosts observation, review and the final decision', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    // Accepting unverified changes asks once more (E2E-018 semantics).
    page.on('dialog', (dialog) => void dialog.accept());
    try {
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('home-model')).toHaveValue(/mock/);
      await page.getByTestId('home-mode-auto').click();
      await page.getByTestId('home-intent').fill('[scenario:edit-basic] room flow');
      await page.getByTestId('home-submit').click();

      // Submit opens the Task Room on the Home surface (PIVOT-022: no Editor).
      await expect(page.getByTestId('task-room')).toBeVisible();
      await expect(page.getByTestId('agent-panel-main')).toHaveCount(0);
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
        timeout: 30000,
      });
      // PIVOT-023: the chip speaks human, the machine state lives in data-state.
      await expect(page.getByTestId('task-state')).toHaveText('Ready to review');

      // The rail lists what the agent touched, from recorded change events.
      await expect(page.getByTestId('task-room-file-src/index.ts')).toBeVisible();

      // Review works without ever entering the Editor.
      await page.getByTestId('review-open').click();
      await expect(page.getByTestId('review-view')).toBeVisible();
      await expect(page.getByTestId('review-file-src/index.ts')).toBeVisible();
      await page.getByTestId('review-accept-all').click();
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'ACCEPTED', {
        timeout: 20000,
      });
      // Accept closes the review; if it lingers, close it — the room remains.
      const close = page.getByTestId('review-close');
      if (await close.isVisible().catch(() => false)) await close.click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await expect(page.getByTestId('task-state')).toHaveText('Accepted');
    } finally {
      await app.close();
    }
  });

  test('PIVOT-022: Editor entries — room header in, ⌂ Home back, room state kept', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    try {
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('home-model')).toHaveValue(/mock/);
      await page.getByTestId('home-intent').fill('[scenario:edit-plan-review] entry check');
      await page.getByTestId('home-submit').click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await expect(page.getByTestId('plan-card')).toBeVisible({ timeout: 20000 });

      // No main-area workspace chip on Home anymore (entry consolidation).
      await page.getByTestId('task-room-back').click();
      await expect(page.getByTestId('home-enter-ide')).toHaveCount(0);

      // Sidebar row → Editor; ⌂ Home → back to the launcher.
      await page.getByTestId('home-open-ide').click();
      await expect(page.getByTestId('workbench')).toBeVisible();
      await expect(page.getByTestId('home-view')).toHaveCount(0);
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('home-view')).toBeVisible();

      // Task Room → "Open in editor" carries the task context (agent panel).
      await page.getByTestId(`home-task-${await taskIdOf(page)}`).click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await page.getByTestId('task-room-open-editor').click();
      await expect(page.getByTestId('agent-panel-main')).toBeVisible();
      await expect(page.getByTestId('plan-card')).toBeVisible();

      // The waiting plan is decidable from the room too.
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('task-room')).toBeVisible(); // state kept
      await page.getByTestId('plan-approve').click();
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
        timeout: 30000,
      });
    } finally {
      await app.close();
    }
  });
});

/** First (most recent) task id from the sidebar rows. */
async function taskIdOf(page: import('@playwright/test').Page): Promise<string> {
  const el = page.locator('[data-testid^="home-task-"]').first();
  const testid = await el.getAttribute('data-testid');
  return testid!.replace('home-task-', '');
}
