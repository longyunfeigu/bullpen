import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createGitFixture } from './helpers/fixtures';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root }).toString();
}

test.describe('M5 git workflow', () => {
  test('E2E-008: modify → diff → stage → commit matches git CLI', async () => {
    const fixture = createGitFixture();
    const { app, page } = await launchApp({ env: { PI_IDE_OPEN_WORKSPACE: fixture } });
    try {
      // Modify a file externally (same as editing+saving).
      writeFileSync(join(fixture, 'src/util.ts'), 'export const changed = true;\n');

      await page.getByTestId('activity-scm').click();
      await expect(page.getByTestId('scm-view')).toBeVisible();
      await expect(page.getByTestId('scm-entry-src/util.ts')).toBeVisible({ timeout: 15000 });

      // Working-tree diff opens with content.
      await page.getByTestId('scm-entry-src/util.ts').getByRole('button').first().click();
      await expect(page.getByTestId('git-diff-modal')).toBeVisible();
      await expect(page.getByTestId('git-diff-modal')).toContainText('util.ts');
      await page.getByLabel('Close').click();

      // Stage and verify against the CLI.
      await page.getByTestId('stage-src/util.ts').click();
      await expect(page.getByTestId('scm-group-staged')).toBeVisible();
      await expect.poll(() => git(fixture, ['status', '--porcelain'])).toContain('M  src/util.ts');

      // Unstage round-trip.
      await page.getByTestId('unstage-src/util.ts').click();
      await expect.poll(() => git(fixture, ['status', '--porcelain'])).toContain(' M src/util.ts');
      await page.getByTestId('stage-src/util.ts').click();

      // Commit.
      await page.getByTestId('commit-message').fill('feat: e2e commit');
      await page.getByTestId('commit-btn').click();
      await expect(page.getByTestId('scm-clean')).toBeVisible({ timeout: 15000 });
      expect(git(fixture, ['log', '--format=%s', '-1']).trim()).toBe('feat: e2e commit');
      expect(git(fixture, ['status', '--porcelain']).trim()).toBe('');

      // Branch: create and switch back.
      await page.getByTestId('status-branch').click();
      await expect(page.getByTestId('branch-picker')).toBeVisible();
      await page.keyboard.type('e2e-branch');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('status-branch')).toContainText('e2e-branch', {
        timeout: 15000,
      });
      await page.getByTestId('status-branch').click();
      await page.getByTestId('branch-main').click();
      await expect(page.getByTestId('status-branch')).toContainText('main');
    } finally {
      await app.close();
    }
  });

  test('non-git workspace offers init without forcing it (WS-013)', async () => {
    const { createTsSmallFixture } = await import('./helpers/fixtures');
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({ env: { PI_IDE_OPEN_WORKSPACE: fixture } });
    try {
      await page.getByTestId('activity-scm').click();
      await expect(page.getByTestId('scm-no-repo')).toBeVisible();
      // Editor still fully works.
      await page.getByTestId('activity-explorer').click();
      await page.getByTestId('tree-item-README.md').click();
      await expect(page.getByTestId('tab-README.md')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
