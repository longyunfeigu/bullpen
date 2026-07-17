import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch.js';

/**
 * Multi-provider configuration (PIVOT-033): presets (Anthropic/OpenAI/
 * OpenRouter/LiteLLM) plus custom Anthropic-/OpenAI-compatible gateways,
 * stored side by side and independently removable.
 */
test('providers: presets, custom gateways and required-URL validation', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByTestId('home-settings').click();
    await page.getByText('Models', { exact: true }).click();

    // 1) OpenRouter preset: key only — the default endpoint is implied.
    await page.getByTestId('provider-select').selectOption('openrouter');
    await page.getByTestId('provider-key-input').fill('sk-or-e2e-000000');
    await page.getByTestId('provider-key-save').click();
    const orRow = page.getByTestId('provider-row-openrouter');
    await expect(orRow).toBeVisible();
    await expect(orRow).toContainText('OpenRouter');
    await expect(page.getByTestId('provider-api-openrouter')).toContainText('OpenAI API');
    await expect(page.getByTestId('provider-baseurl-openrouter')).toContainText(
      'https://openrouter.ai/api/v1 (default)',
    );
    await expect(orRow).not.toContainText('sk-or-e2e-000000'); // masked

    // 2) LiteLLM preset refuses to save without its Base URL.
    await page.getByTestId('provider-select').selectOption('litellm');
    await page.getByTestId('provider-key-input').fill('sk-litellm-e2e');
    await page.getByTestId('provider-key-save').click();
    await expect(page.locator('.toast').filter({ hasText: 'Base URL' })).toBeVisible();
    await expect(page.getByTestId('provider-row-litellm')).toHaveCount(0);

    // …and saves with one.
    await page.getByTestId('provider-baseurl-input').fill('http://localhost:4000/v1');
    await page.getByTestId('provider-key-save').click();
    await expect(page.getByTestId('provider-row-litellm')).toBeVisible();
    await expect(page.getByTestId('provider-baseurl-litellm')).toContainText(
      'http://localhost:4000/v1',
    );

    // 3) Custom Anthropic-compatible gateway.
    await page.getByTestId('provider-select').selectOption('custom');
    await page.getByTestId('provider-custom-id').fill('team-gw');
    await page.getByTestId('provider-custom-api').selectOption('anthropic');
    await page.getByTestId('provider-custom-name').fill('Team Gateway');
    await page.getByTestId('provider-key-input').fill('cr-team-e2e-1234');
    await page.getByTestId('provider-baseurl-input').fill('http://gw.internal:3000/api');
    await page.getByTestId('provider-key-save').click();
    const gwRow = page.getByTestId('provider-row-team-gw');
    await expect(gwRow).toBeVisible();
    await expect(gwRow).toContainText('Team Gateway');
    await expect(page.getByTestId('provider-api-team-gw')).toContainText('Claude API');
    await expect(page.getByTestId('provider-baseurl-team-gw')).toContainText(
      'http://gw.internal:3000/api',
    );

    // 4) Rows are independent: deleting one leaves the others.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('provider-delete-openrouter').click();
    await expect(page.getByTestId('provider-row-openrouter')).toHaveCount(0);
    await expect(page.getByTestId('provider-row-litellm')).toBeVisible();
    await expect(gwRow).toBeVisible();
  } finally {
    await app.close();
  }
});
