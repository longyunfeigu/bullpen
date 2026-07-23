import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { createTsSmallFixture } from './helpers/fixtures';

test.describe('Session completion attention', () => {
  test('the active Session owns its completion state without covering header actions', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    try {
      await page.getByTestId('surface-home').click();
      await page.getByTestId('home-mode-auto').click();
      await expect(page.getByTestId('home-model')).toContainText(/mock/i);
      await page
        .getByTestId('home-intent')
        .fill('[scenario:edit-basic] active completion stays in the room');
      await page.getByTestId('home-submit').click();

      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
        timeout: 30_000,
      });
      await expect(page.getByTestId('session-more')).toBeVisible();
      await expect(page.getByTestId('session-completion-notice')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('completion updates the row live, ripples, and a top-right notice reveals the Session', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    try {
      await expect(page).toHaveTitle(/Charter/i);
      expect(page.url()).toMatch(/^app:\/\//);
      await expect(page.getByTestId('workbench')).toBeVisible();
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('home-view')).toBeVisible();

      await page.getByTestId('home-mode-auto').click();
      await expect(page.getByTestId('home-model')).toContainText(/mock/i);
      await page
        .getByTestId('home-intent')
        .fill('[scenario:edit-live] live completion notification');
      await page.getByTestId('home-submit').click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await page.getByTestId('task-room-back').click();
      await page.getByTestId('rail-view-sessions').click();

      const notice = page.getByTestId('session-completion-notice').first();
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toContainText('Ready for review');
      await expect(notice).toContainText('live completion notification');
      const taskId = await notice.getAttribute('data-task-id');
      expect(taskId).toBeTruthy();

      const row = page.getByTestId(`home-task-${taskId!}`);
      await expect(row).toHaveAttribute('data-state', 'REVIEW_READY');
      await expect(row).toHaveAttribute('data-completion', 'review');
      await expect(row).toHaveAttribute('data-reply', 'true');
      await expect(row).toHaveClass(/reply-shake/);
      await expect(row.locator('.sr-provider')).toHaveClass(/session-wave/);
      await expect(row).toContainText('Review');
      await page.screenshot({ path: '/tmp/charter-session-completion-desktop.png' });

      await row.evaluate((element) => {
        const animation = element
          .getAnimations()
          .find(
            (candidate) =>
              candidate instanceof CSSAnimation &&
              candidate.animationName === 'srSessionReplyShake',
          );
        if (animation) {
          animation.pause();
          animation.currentTime = 286;
        }
      });
      await page.setViewportSize({ width: 820, height: 720 });
      const rowBox = await row.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(rowBox!.x).toBeGreaterThanOrEqual(0);
      expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(820);
      await page.screenshot({ path: '/tmp/charter-session-reply-shake-narrow.png' });

      await notice.getByRole('button', { name: /Open Session/i }).click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY');
      await expect(page.getByTestId('rail-view-sessions')).toHaveClass(/active/);
      await expect(row).toHaveClass(/selected/);

      await expect(page.getByTestId('task-room')).toBeVisible();
      await page.screenshot({ path: '/tmp/charter-session-completion-narrow.png' });
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('More expands the bounded rail while search still sees every Session', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    try {
      await page.evaluate(async (projectPath) => {
        const product = (
          window as unknown as {
            product: {
              rpc: Record<
                string,
                (payload: unknown) => Promise<{
                  ok: boolean;
                  error?: { userMessage?: string };
                }>
              >;
            };
          }
        ).product;
        for (let index = 0; index < 23; index += 1) {
          const result = await product.rpc['task.create']!({
            title: `Pagination Session ${String(index + 1).padStart(2, '0')}`,
            goalMd: 'Exercise the Session rail More control',
            acceptance: [],
            mode: 'ask',
            model: { providerId: 'mock', modelId: 'mock-1' },
            verification: [],
            projectPath,
            isolation: 'none',
            conversationRefTaskIds: [],
          });
          if (!result.ok) throw new Error(result.error?.userMessage ?? 'task.create failed');
        }
      }, fixture);

      await page.reload();
      await expect(page.getByTestId('workbench')).toBeVisible();
      await page.getByTestId('rail-view-sessions').click();
      await expect(page.locator('[data-session-key^="task:"]')).toHaveCount(20);
      const more = page.getByTestId('rail-more');
      await expect(more).toContainText('3 of 3 remaining');
      await more.click();
      await expect(page.locator('[data-session-key^="task:"]')).toHaveCount(23);
      await expect(more).toHaveCount(0);

      await page.getByTestId('rail-session-search').fill('Pagination Session 23');
      await expect(page.locator('[data-session-key^="task:"]')).toHaveCount(1);
      await expect(page.locator('[data-session-key^="task:"]').first()).toContainText(
        'Pagination Session 23',
      );
    } finally {
      await app.close();
    }
  });
});
