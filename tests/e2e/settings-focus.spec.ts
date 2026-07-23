import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/launch';

test.describe('Settings overlay focus return', () => {
  test('Escape, close, and backdrop return focus to the opener', async () => {
    const { app, page } = await launchApp({ home: 'keep' });
    try {
      const model = page.getByTestId('home-model');
      await expect(model).toContainText('No model', { timeout: 15_000 });
      await model.click();
      await expect(page.getByTestId('home-modeleffort-pop')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('home-modeleffort-pop')).toHaveCount(0);
      await expect(model).toBeFocused();

      await model.click();
      await page.getByTestId('home-model-settings').click();
      const overlay = page.getByTestId('overlay-settings');
      await expect(overlay).toBeVisible();
      const close = overlay.getByRole('button', { name: 'Close' });
      await expect(close).toBeFocused();

      // Tab and Shift+Tab wrap inside the modal, and inert background controls
      // cannot steal focus even when focus() is called directly.
      await page.keyboard.press('Shift+Tab');
      expect(await overlay.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
        true,
      );
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Tab');
        expect(await overlay.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
          true,
        );
      }
      await model.evaluate((element) => (element as HTMLElement).focus());
      expect(await overlay.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
        true,
      );

      await page.keyboard.press('Escape');
      await expect(overlay).toHaveCount(0);
      await expect(model).toBeFocused();

      const settings = page.getByTestId('home-settings');
      await settings.click();
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(page.getByTestId('overlay-settings')).toHaveCount(0);
      await expect(settings).toBeFocused();

      await settings.click();
      await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } });
      await expect(page.getByTestId('overlay-settings')).toHaveCount(0);
      await expect(settings).toBeFocused();
    } finally {
      await app.close();
    }
  });
});
