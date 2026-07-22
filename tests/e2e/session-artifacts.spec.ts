import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { createTsSmallFixture } from './helpers/fixtures';

test.describe('Session artifact platform', () => {
  test('previews rich versioned outputs and sends a semantic anchor to the managed agent', async () => {
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
      await page.getByTestId('surface-home').click();
      await expect(page.getByTestId('home-model')).toContainText(/mock/i, { timeout: 15_000 });
      await page.getByTestId('home-mode-auto').click();
      await page
        .getByTestId('home-intent')
        .fill('[scenario:artifact-showcase] build review artifacts');
      await page.getByTestId('home-submit').click();
      await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
        timeout: 30_000,
      });

      await page.getByTestId('session-tool-preview').click();
      await expect(page.getByTestId('session-artifact-view')).toBeVisible({ timeout: 15_000 });
      const headerMeta = await page.locator('.session-identity-meta').boundingBox();
      const artifactButton = await page.getByTestId('task-room-preview-badge').boundingBox();
      const moreButton = await page.getByTestId('session-more').boundingBox();
      expect(headerMeta).not.toBeNull();
      expect(artifactButton).not.toBeNull();
      expect(moreButton).not.toBeNull();
      expect(Math.abs(artifactButton!.y - headerMeta!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(artifactButton!.height - headerMeta!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(moreButton!.y - headerMeta!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(moreButton!.height - headerMeta!.height)).toBeLessThanOrEqual(1);
      await page.getByTestId('artifact-item-artifacts/metrics.csv').click();
      await expect(page.getByTestId('artifact-table-view')).toBeVisible();

      const version = page.locator('.artifact-toolbar select');
      await expect(version.locator('option')).toHaveCount(2);
      await version.selectOption({ index: 0 });
      await expect(page.getByTestId('artifact-stale')).toBeVisible();
      await page.getByTestId('artifact-stale').getByRole('button', { name: 'View latest' }).click();
      await expect(page.getByTestId('artifact-stale')).not.toBeAttached();

      const tableCells = page.locator('.artifact-table td button');
      const rangeStart = await tableCells.nth(3).boundingBox();
      const rangeEnd = await tableCells.nth(8).boundingBox();
      expect(rangeStart).not.toBeNull();
      expect(rangeEnd).not.toBeNull();
      await page.mouse.move(rangeStart!.x + 8, rangeStart!.y + 8);
      await page.mouse.down();
      await page.mouse.move(rangeEnd!.x + 8, rangeEnd!.y + 8);
      await page.mouse.up();
      await expect(page.locator('.artifact-anchor-summary')).toContainText(
        /Rows 2-3, columns 1-3/i,
      );

      const rowHeaders = page.locator('.artifact-row-header button');
      const rowStart = await rowHeaders.nth(1).boundingBox();
      const rowEnd = await rowHeaders.nth(3).boundingBox();
      expect(rowStart).not.toBeNull();
      expect(rowEnd).not.toBeNull();
      await page.mouse.move(rowStart!.x + 8, rowStart!.y + 8);
      await page.mouse.down();
      await page.mouse.move(rowEnd!.x + 8, rowEnd!.y + 8);
      await page.mouse.up();
      await expect(page.locator('.artifact-anchor-summary')).toContainText(
        /Rows 2-4, columns 1-3/i,
      );

      await page.getByTestId('artifact-feedback-add').click();
      await expect(page.getByTestId('room-artifact-refs')).toContainText('metrics.csv');

      const focusButton = page.getByTestId('session-tool-expand');
      await expect(focusButton).toContainText('Focus');
      await page.getByTestId('agent-input').fill('Conversation draft survives Preview Focus.');
      await page.getByTestId('artifact-feedback-note').fill('Review draft survives Preview Focus.');
      await focusButton.click();
      await expect(page.locator('.session-canvas-body')).toHaveClass(/preview-focused/);
      await expect(page.getByTestId('session-artifact-view')).toHaveAttribute(
        'data-layout',
        'focus',
      );
      await expect(page.locator('.session-canvas-body > .tr-main')).toBeHidden();
      await expect(page.locator('.artifact-review-heading')).toBeVisible();
      await expect(page.getByTestId('artifact-feedback-note')).toHaveValue(
        'Review draft survives Preview Focus.',
      );
      await page.screenshot({ path: '/tmp/charter-artifact-focus-desktop.png' });

      await expect(focusButton).toContainText('Back to Session');
      await focusButton.click();
      await expect(page.locator('.session-canvas-body')).not.toHaveClass(/preview-focused/);
      await expect(page.locator('.session-canvas-body > .tr-main')).toBeVisible();
      await expect(page.getByTestId('session-artifact-view')).toHaveAttribute(
        'data-layout',
        'quick',
      );
      await expect(page.getByTestId('agent-input')).toHaveValue(
        'Conversation draft survives Preview Focus.',
      );
      await expect(page.getByTestId('artifact-feedback-note')).toHaveValue(
        'Review draft survives Preview Focus.',
      );
      await page.getByTestId('agent-input').fill('');
      await page.getByTestId('artifact-feedback-note').fill('');

      await page.getByTestId('artifact-item-artifacts/document.pdf').click();
      await expect(page.getByTestId('artifact-pdf-view')).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByTestId('artifact-pdf-view')
            .locator('canvas')
            .evaluate((canvas) => (canvas as HTMLCanvasElement).height),
        )
        .toBeGreaterThan(200);
      await expect(page.getByTestId('artifact-pdf-error')).not.toBeAttached();
      await expect(page.getByTestId('artifact-document-health')).toContainText('Needs source fix');
      await page
        .getByTestId('artifact-pdf-view')
        .getByRole('button', { name: 'Mark region' })
        .click();
      const pdfCanvas = page.getByTestId('artifact-pdf-view').locator('canvas');
      const pdfBox = await pdfCanvas.boundingBox();
      expect(pdfBox).not.toBeNull();
      await page.mouse.move(pdfBox!.x + 40, pdfBox!.y + 40);
      await page.mouse.down();
      await page.mouse.move(pdfBox!.x + 160, pdfBox!.y + 110);
      await page.mouse.up();
      await expect(page.locator('.artifact-anchor-summary')).toContainText(/PDF page 1 region/i);
      await page
        .getByTestId('artifact-document-health')
        .getByRole('button', { name: 'Use repair request' })
        .click();
      await expect(page.getByTestId('artifact-feedback-note')).toHaveValue(/embedded CJK font/i);
      await focusButton.click();
      await expect(page.getByTestId('session-artifact-view')).toHaveAttribute(
        'data-layout',
        'focus',
      );
      await page.screenshot({ path: '/tmp/charter-artifact-pdf-focus.png' });
      await focusButton.click();

      await page.getByTestId('artifact-item-artifacts/metrics.csv').click();
      await expect(page.getByTestId('artifact-table-view')).toBeVisible();
      await expect(page.getByTestId('artifact-feedback-note')).toHaveValue('');

      await page.getByTestId('artifact-item-artifacts/chinese-document.pdf').click();
      await expect(page.getByTestId('artifact-pdf-view')).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByTestId('artifact-pdf-view')
            .locator('canvas')
            .evaluate((canvas) => (canvas as HTMLCanvasElement).height),
        )
        .toBeGreaterThan(200);
      await expect(page.getByTestId('artifact-pdf-error')).not.toBeAttached();
      await expect(page.getByTestId('artifact-document-health')).toContainText('Loaded faithfully');
      await page.screenshot({ path: '/tmp/charter-artifact-pdf-cjk.png' });

      await page.getByTestId('artifact-item-artifacts/report.html').click();
      await expect(page.getByTestId('artifact-html-view')).toBeVisible();
      const htmlFrame = page.frameLocator('iframe[title="Static HTML artifact"]');
      await expect(htmlFrame.getByRole('heading', { name: 'Revenue pulse' })).toBeVisible({
        timeout: 10_000,
      });
      await page
        .getByTestId('artifact-html-view')
        .getByRole('button', { name: 'Interactive' })
        .click();
      await page
        .getByTestId('artifact-html-view')
        .getByRole('button', { name: 'Pick element' })
        .click();
      await htmlFrame.getByRole('heading', { name: 'Revenue pulse' }).click();
      await expect(page.locator('.artifact-anchor-summary')).toContainText('DOM');

      await page
        .getByTestId('artifact-feedback-note')
        .fill('Tighten this headline and keep the report tone.');
      await page.getByTestId('artifact-feedback-add').click();
      await expect(page.getByTestId('room-artifact-refs')).toContainText('report.html');
      await page.getByTestId('agent-input').fill('Apply the anchored report feedback.');
      await page.getByTestId('agent-send').click();
      await expect(page.getByTestId('tl-artifact-feedback').last()).toContainText(
        'Tighten this headline and keep the report tone.',
        { timeout: 15_000 },
      );

      await focusButton.click();
      await expect(page.getByTestId('session-artifact-view')).toHaveAttribute(
        'data-layout',
        'focus',
      );
      await page.screenshot({ path: '/tmp/charter-session-artifacts-desktop.png' });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 820, height: 900 });
      });
      await expect(page.getByTestId('session-artifact-view')).toBeVisible();
      await expect(page.locator('.artifact-nav-list')).toBeVisible();
      await expect(page.locator('.artifact-review-heading')).toBeVisible();
      await page.screenshot({ path: '/tmp/charter-session-artifacts-narrow.png' });

      await focusButton.click();
      await expect(page.locator('.session-canvas-body > .tr-main')).toBeVisible();

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
