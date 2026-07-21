import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  launchPackagedApp,
  packagedExecutablePath,
} from '../e2e/helpers/launch';

test('E2E-024: packaged app starts on a clean profile and survives security checks', async () => {
  const executablePath = packagedExecutablePath();
  expect(existsSync(executablePath)).toBe(true);

  if (process.platform === 'darwin') {
    const appBundle = resolve(dirname(executablePath), '../..');
    // Unsigned Preview still carries a valid ad-hoc signature after fuse
    // mutation. Gatekeeper trust/notarization is deliberately NOT claimed.
    execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'pipe' });
  }

  const rendererErrors: string[] = [];
  const launched = await launchPackagedApp({ executablePath });
  try {
    launched.page.on('pageerror', (error) => rendererErrors.push(error.message));
    await expect(launched.page.getByTestId('workbench')).toBeVisible();
    await expect(launched.page.getByTestId('startup-error')).toHaveCount(0);
    await expect(launched.page.getByTestId('status-version')).toHaveText('v1.0.0-beta.1');
    expect(launched.page.url()).toMatch(/^app:\/\//);
    expect((await launched.page.locator('body').innerText()).trim().length).toBeGreaterThan(100);

    const rendererBoundary = await launched.page.evaluate(() => ({
      nodeRequire: typeof (window as unknown as { require?: unknown }).require,
      nodeProcess: typeof (window as unknown as { process?: unknown }).process,
      charterBridge: typeof (window as unknown as { product?: unknown }).product,
    }));
    expect(rendererBoundary).toEqual({
      nodeRequire: 'undefined',
      nodeProcess: 'undefined',
      charterBridge: 'object',
    });
    expect(rendererErrors).toEqual([]);
  } finally {
    await launched.close();
    rmSync(launched.userDataDir, { recursive: true, force: true });
  }
});
