import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/launch';

test.describe('M2 shell, settings and persistence', () => {
  test('layout, theme and settings survive a restart', async () => {
    const first = await launchApp();
    const { page } = first;
    await expect(page.getByTestId('workbench')).toBeVisible();

    // Defaults: agent panel visible, bottom panel hidden, dark by system or theme.
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await expect(page.getByTestId('bottom-panel')).toHaveCount(0);

    // Open command palette and switch theme to light. Fill the input directly
    // — free-typing races the palette's focus timing and drops keystrokes.
    await page.getByTestId('palette-chip').click();
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.getByRole('textbox', { name: 'Command' }).fill('Theme: Light');
    await page.getByRole('textbox', { name: 'Command' }).press('Enter');
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');

    await page.getByTestId('palette-chip').click();
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.getByRole('textbox', { name: 'Command' }).fill('Skin: Index');
    await page.getByRole('textbox', { name: 'Command' }).press('Enter');
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.skin))
      .toBe('index');

    // Toggle bottom panel via palette; hide agent panel via keyboard.
    await page.getByTestId('palette-chip').click();
    await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
    await page.getByRole('textbox', { name: 'Command' }).fill('Toggle Bottom Panel');
    await page.getByRole('textbox', { name: 'Command' }).press('Enter');
    await expect(page.getByTestId('bottom-panel')).toBeVisible();

    // Change a setting through the Settings UI.
    await page.getByTestId('activity-settings').click();
    await expect(page.getByTestId('overlay-settings')).toBeVisible();
    await page.getByText('Editor', { exact: true }).click();
    const fontInput = page.locator('input[type="number"]').first();
    await fontInput.fill('15');
    await page.keyboard.press('Escape');

    // Wait until the debounced layout save has actually reached the database
    // (deterministic — proves the write happened rather than racing the 400ms
    // debounce against quit; if persistence were broken this poll would fail
    // here, on the write, not after restart).
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const bridge = (
              window as never as {
                product: {
                  rpc: Record<string, (p: unknown) => Promise<{ ok: boolean; data?: unknown }>>;
                };
              }
            ).product;
            const res = await bridge.rpc['layout.get']!({});
            return (res.data as { layout: { bottomPanelVisible?: boolean } | null }).layout
              ?.bottomPanelVisible;
          }),
        { timeout: 15000 },
      )
      .toBe(true);
    await first.app.close();

    // Relaunch with the same user-data dir.
    const second = await launchApp({ userDataDir: first.userDataDir });
    await expect(second.page.getByTestId('workbench')).toBeVisible();
    await expect(second.page.getByTestId('bottom-panel')).toBeVisible();
    await expect
      .poll(async () => second.page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');
    await expect
      .poll(async () => second.page.evaluate(() => document.documentElement.dataset.skin))
      .toBe('index');
    const fontSize = await second.page.evaluate(async () => {
      const bridge = (
        window as never as {
          product: {
            rpc: Record<string, (p: unknown) => Promise<{ ok: boolean; data?: unknown }>>;
          };
        }
      ).product;
      const res = await bridge.rpc['settings.get']!({});
      return (res.data as { effective: { editor: { fontSize: number } } }).effective.editor
        .fontSize;
    });
    expect(fontSize).toBe(15);
    await second.app.close();
  });

  test('settings switches all four coordinated skins live', async () => {
    const { app, page } = await launchApp();
    try {
      await page.getByTestId('activity-settings').click();
      await expect(page.getByTestId('overlay-settings')).toBeVisible();
      await page
        .locator('.st-row')
        .filter({ hasText: 'Brightness' })
        .locator('select')
        .selectOption('dark');
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe('dark');

      const expectedAccent = {
        studio: '#e8e6e0',
        terminal: '#52ff78',
        archive: '#ef7b57',
        index: '#ff304f',
      } as const;

      for (const skin of ['studio', 'terminal', 'archive', 'index'] as const) {
        await page.getByTestId(`settings-skin-${skin}`).click();
        await expect
          .poll(async () =>
            page.evaluate(() => ({
              skin: document.documentElement.dataset.skin,
              accent: getComputedStyle(document.documentElement)
                .getPropertyValue('--accent')
                .trim(),
            })),
          )
          .toEqual({ skin, accent: expectedAccent[skin] });
        await expect(page.getByTestId(`settings-skin-${skin}`)).toHaveAttribute(
          'aria-checked',
          'true',
        );
      }
    } finally {
      await app.close();
    }
  });

  test('diagnostics view reports healthy database', async () => {
    const { app, page } = await launchApp();
    try {
      await page.getByTestId('palette-chip').click();
      await page.keyboard.type('Open Diagnostics');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('overlay-diagnostics')).toBeVisible();
      await expect(page.getByText('OK —')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
