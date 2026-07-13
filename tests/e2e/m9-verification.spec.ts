import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createTsSmallFixture } from './helpers/fixtures';

const ORIGINAL_INDEX = `import { add } from './util';\n\nexport function main(): number {\n  return add(2, 3);\n}\n`;
const ORIGINAL_UTIL = `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n`;

async function createTask(
  page: import('@playwright/test').Page,
  goal: string,
  mode: 'ask' | 'edit' | 'auto',
  title: string,
  options: { verification?: string } = {},
) {
  await page.getByTestId('new-task-btn').click();
  await expect(page.getByTestId('new-task-dialog')).toBeVisible();
  await page.getByTestId('task-title').fill(title);
  await page.getByTestId('task-goal').fill(goal);
  if (options.verification) {
    await page.getByTestId('task-verification-custom').fill(options.verification);
  }
  await page.getByTestId(`mode-${mode}`).check();
  await expect(page.getByTestId('task-model')).toHaveValue(/mock/);
  await page.getByTestId('task-create-start').click();
}

test.describe('M9 verification, final report and rollback (E2E-016/017/018)', () => {
  test('E2E-016: create/modify/delete/rename then roll back byte-exact', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    try {
      page.on('dialog', (dialog) => void dialog.accept());
      await createTask(page, '[scenario:edit-rollback] touch everything', 'auto', 'Rollback');

      // delete_file is R3 — even auto mode pauses for explicit confirmation.
      await expect(page.getByTestId('perm-card')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('perm-risk')).toHaveText('R3');
      await page.getByTestId('perm-allow-once').click();

      await expect(page.getByTestId('task-state')).toHaveText('REVIEW_READY', { timeout: 30000 });

      // All four change kinds really happened on disk.
      expect(existsSync(join(fixture, 'rollback-note.txt'))).toBe(true);
      expect(readFileSync(join(fixture, 'src/index.ts'), 'utf8')).toContain('add(3, 4)');
      expect(existsSync(join(fixture, 'src/util.ts'))).toBe(false);
      expect(existsSync(join(fixture, 'src/mathlib-renamed.ts'))).toBe(true);
      expect(existsSync(join(fixture, 'src/mathlib.ts'))).toBe(false);

      // Roll everything back from the review page.
      await page.getByTestId('review-open').click();
      await expect(page.getByTestId('review-view')).toBeVisible();
      await page.getByTestId('review-rollback').click();

      await expect(page.getByTestId('task-state')).toHaveText('ROLLED_BACK', { timeout: 20000 });
      await expect(page.getByTestId('tl-rolledback')).toBeVisible();

      // Byte-exact restoration (CHG-009/012).
      expect(existsSync(join(fixture, 'rollback-note.txt'))).toBe(false);
      expect(readFileSync(join(fixture, 'src/index.ts'), 'utf8')).toBe(ORIGINAL_INDEX);
      expect(readFileSync(join(fixture, 'src/util.ts'), 'utf8')).toBe(ORIGINAL_UTIL);
      expect(existsSync(join(fixture, 'src/mathlib.ts'))).toBe(true);
      expect(existsSync(join(fixture, 'src/mathlib-renamed.ts'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('E2E-017: failing verification, fix, re-run passes; both records kept, old one superseded', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    try {
      await createTask(page, '[scenario:verify-fail-fix] make the check pass', 'auto', 'Verify', {
        verification: 'node check-agent.mjs',
      });

      // First run fails, second passes — both cards stay in the timeline (VER-005).
      await expect(page.getByTestId('tl-verification-failed')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('tl-verification-passed')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('task-state')).toHaveText('REVIEW_READY', { timeout: 30000 });

      // The fix really landed.
      expect(readFileSync(join(fixture, 'check-target.txt'), 'utf8').trim()).toBe('RIGHT');

      // The final report shows the superseded old result and the passing current one.
      await expect(page.getByTestId('report-verification')).toContainText('1 passed');
      await expect(page.getByTestId('report-verification')).toContainText('superseded');
      await expect(page.getByTestId('report-verification')).toContainText('stale');
    } finally {
      await app.close();
    }
  });

  test('E2E-018: accepting unverified changes requires a second explicit confirmation', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
    });
    try {
      const dialogMessages: string[] = [];
      page.on('dialog', (dialog) => {
        dialogMessages.push(dialog.message());
        void dialog.accept();
      });

      await createTask(page, '[scenario:edit-basic] small fix', 'auto', 'Unverified accept');
      await expect(page.getByTestId('task-state')).toHaveText('REVIEW_READY', { timeout: 30000 });

      // The report clearly flags the missing verification (VER-007).
      await expect(page.getByTestId('report-unverified')).toBeVisible();
      await expect(page.getByTestId('report-unverified')).toContainText('UNVERIFIED_BY_USER');

      await page.getByTestId('review-open').click();
      await expect(page.getByTestId('review-view')).toBeVisible();
      await page.getByTestId('review-accept-all').click();

      await expect(page.getByTestId('task-state')).toHaveText('ACCEPTED', { timeout: 20000 });
      expect(dialogMessages.some((m) => m.includes('No verification was run'))).toBe(true);
    } finally {
      await app.close();
    }
  });
});
