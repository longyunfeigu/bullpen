import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

const root = join(__dirname, '../../..');

/** Launch the packaged-mode app (app:// protocol, production CSP) with an isolated user-data dir. */
export async function launchApp(
  options: {
    userDataDir?: string;
    env?: Record<string, string>;
    /** Dual-form shell: 'dismiss' (default) lands tests in the IDE surface; 'keep' stays on Home. */
    home?: 'dismiss' | 'keep';
  } = {},
): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'pi-ide-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      PI_IDE_USER_DATA: userDataDir,
      PI_IDE_E2E: '1',
      ...options.env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  if (options.home !== 'keep') {
    if (options.env?.PI_IDE_OPEN_WORKSPACE) {
      // Opening a workspace auto-switches to the IDE surface (PIVOT-006).
      await page
        .getByTestId('home-view')
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => undefined);
    } else {
      // ADR-0008 entry consolidation: the sidebar "Editor" row is the way in.
      const enter = page.getByTestId('home-open-ide');
      await enter.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
      if (await enter.isVisible().catch(() => false)) {
        await enter.click().catch(() => undefined);
      }
    }
  }
  return { app, page, userDataDir };
}
