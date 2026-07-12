import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';

test('corrupted database sends the app into safe diagnostics mode (APP-004/UPD-004)', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'pi-ide-dbfail-'));
  writeFileSync(join(userDataDir, 'app.db'), 'this is definitely not a sqlite file');

  const { app, page } = await launchApp({ userDataDir });
  try {
    await expect(page.getByTestId('startup-error')).toBeVisible();
    await expect(page.getByText(/could not start normally/i)).toBeVisible();
    // Workbench must NOT be available in safe mode.
    await expect(page.getByTestId('workbench')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
