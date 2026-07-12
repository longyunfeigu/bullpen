import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createTsSmallFixture } from './helpers/fixtures';

test.describe('M3 workspace and editor', () => {
  test('E2E-002: edit, save, split; tabs and content restored after restart', async () => {
    const fixture = createTsSmallFixture();
    const first = await launchApp({ env: { PI_IDE_OPEN_WORKSPACE: fixture } });
    const { page } = first;

    // Explorer shows the workspace tree.
    await expect(page.getByTestId('workspace-chip')).toBeVisible();
    await page.getByTestId('tree-item-src').click();
    await page.getByTestId('tree-item-src/index.ts').click();
    await expect(page.getByTestId('tab-src/index.ts')).toBeVisible();

    // Type into Monaco and save.
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type('// edited by e2e');
    await expect(page.getByTestId('status-dirty')).toBeVisible();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect(page.getByTestId('status-dirty')).toHaveCount(0);
    expect(readFileSync(join(fixture, 'src/index.ts'), 'utf8')).toContain('// edited by e2e');

    // Open a second file and split the editor.
    await page.getByTestId('tree-item-src/util.ts').click();
    await expect(page.getByTestId('tab-src/util.ts')).toBeVisible();
    await page.getByTestId('palette-chip').click();
    await page.keyboard.type('Split Editor');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('monaco-pane-1')).toBeVisible();

    await page.waitForTimeout(800); // allow tabs/layout persistence to flush
    await first.app.close();

    // Restart into the same workspace and user data.
    const second = await launchApp({
      userDataDir: first.userDataDir,
      env: { PI_IDE_OPEN_WORKSPACE: fixture },
    });
    await expect(second.page.getByTestId('tab-src/index.ts').first()).toBeVisible({
      timeout: 15000,
    });
    await expect(second.page.getByTestId('tab-src/util.ts').first()).toBeVisible();
    await expect(second.page.getByTestId('monaco-pane-1')).toBeVisible(); // split restored
    await second.app.close();
  });

  test('E2E-003: unsaved buffer vs external change — Reload/Compare/Keep, nothing lost silently', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({ env: { PI_IDE_OPEN_WORKSPACE: fixture } });
    try {
      await page.getByTestId('tree-item-src').click();
      await page.getByTestId('tree-item-src/util.ts').click();
      await page.locator('.monaco-editor').first().click();
      await page.keyboard.type('// user unsaved work\n');
      await expect(page.getByTestId('status-dirty')).toBeVisible();

      // External process rewrites the file on disk.
      writeFileSync(join(fixture, 'src/util.ts'), '// EXTERNAL OVERWRITE\n');

      // Conflict bar must appear; the buffer must keep the user's text.
      await expect(page.getByTestId('conflict-bar')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('conflict-compare')).toBeVisible();
      await expect(page.getByTestId('conflict-reload')).toBeVisible();
      await expect(page.getByTestId('conflict-keep')).toBeVisible();

      // Saving while conflicted must NOT overwrite silently.
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
      expect(readFileSync(join(fixture, 'src/util.ts'), 'utf8')).toBe('// EXTERNAL OVERWRITE\n');

      // Keep my version → explicit save now wins.
      await page.getByTestId('conflict-keep').click();
      await expect(page.getByTestId('conflict-bar')).toHaveCount(0);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
      await expect
        .poll(() => readFileSync(join(fixture, 'src/util.ts'), 'utf8'))
        .toContain('// user unsaved work');
    } finally {
      await app.close();
    }
  });

  test('external change with clean buffer auto-reloads', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({ env: { PI_IDE_OPEN_WORKSPACE: fixture } });
    try {
      await page.getByTestId('tree-item-README.md').click();
      await expect(page.getByTestId('tab-README.md')).toBeVisible();
      writeFileSync(join(fixture, 'README.md'), '# Reloaded externally\n');
      await expect(page.locator('.monaco-editor').first()).toContainText('Reloaded externally', {
        timeout: 15000,
      });
    } finally {
      await app.close();
    }
  });
});
