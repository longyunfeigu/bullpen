import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createTsSmallFixture } from './helpers/fixtures';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('rich Markdown authoring', () => {
  test('insertion tools and fenced-code language preserve the Monaco-backed document path', async () => {
    const fixture = createTsSmallFixture();
    const { app, page } = await launchApp({ env: { PI_IDE_OPEN_WORKSPACE: fixture } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.getByTestId('rail-tab-files').click();
      await page.getByTestId('tree-item-README.md').click();
      const modeToggle = page.getByTestId('md-mode-toggle');
      await expect(modeToggle).toHaveAttribute('aria-label', 'Markdown editing mode');
      await expect(modeToggle).not.toContainText('✨');
      await expect(page.getByTestId('md-mode-rich').locator('[data-icon="pencil"]')).toBeVisible();
      await page.getByTestId('md-mode-rich').click();
      await expect(page.getByTestId('md-rich-editor')).toBeVisible();
      await expect(page.getByTestId('md-mode-rich')).toHaveAttribute('aria-pressed', 'true');

      await expect(page.getByRole('radio', { name: 'Inline code format' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Insert Table' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Insert thematic break' })).toBeVisible();

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 980, height: 760 });
      });

      const assertNarrowToolbarIsUsable = async (): Promise<void> => {
        const toolbar = page.locator('.mdxeditor-toolbar');
        await expect(toolbar).toBeVisible();
        await expect
          .poll(() =>
            toolbar.evaluate((element) => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
          )
          .toEqual(
            expect.objectContaining({
              clientWidth: expect.any(Number),
              scrollWidth: expect.any(Number),
            }),
          );

        const geometry = await toolbar.locator('button, [role="radio"], select').evaluateAll(
          (actions, toolbarElement) => {
            const bounds = (toolbarElement as HTMLElement).getBoundingClientRect();
            const hostBounds = (toolbarElement as HTMLElement)
              .closest('.md-rich-host')!
              .getBoundingClientRect();
            return actions.map((action) => {
              const rect = action.getBoundingClientRect();
              return {
                label: action.getAttribute('aria-label') ?? action.textContent?.trim() ?? '',
                tabIndex: (action as HTMLElement).tabIndex,
                verticallyInside:
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.top >= bounds.top - 1 &&
                  rect.bottom <= bounds.bottom + 1 &&
                  rect.top >= hostBounds.top - 1 &&
                  rect.bottom <= hostBounds.bottom + 1,
                top: Math.round(rect.top),
              };
            });
          },
          await toolbar.elementHandle(),
        );
        expect(geometry.length).toBeGreaterThan(10);
        expect(geometry.filter((action) => !action.verticallyInside)).toEqual([]);
        expect(new Set(geometry.map((action) => action.top)).size).toBe(1);
        // MDXEditor uses the ARIA toolbar roving-tabindex pattern for toggle
        // groups. Native buttons/selects provide the tab-order entry point.
        const keyboardEntryIndex = geometry.findIndex((action) => action.tabIndex >= 0);
        expect(keyboardEntryIndex).toBeGreaterThanOrEqual(0);
        const keyboardEntry = toolbar
          .locator('button, [role="radio"], select')
          .nth(keyboardEntryIndex);
        await keyboardEntry.focus();
        await expect(keyboardEntry).toBeFocused();

        const finalAction = toolbar.locator('button, [role="radio"], select').last();
        await finalAction.focus();
        await expect(finalAction).toBeFocused();
        const finalActionIsVisible = await finalAction.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const toolbarRect = element
            .parentElement!.closest('.mdxeditor-toolbar')!
            .getBoundingClientRect();
          return rect.left >= toolbarRect.left - 1 && rect.right <= toolbarRect.right + 1;
        });
        expect(finalActionIsVisible).toBe(true);
      };

      const setTheme = async (theme: 'Light' | 'Dark'): Promise<void> => {
        await page.getByTestId('palette-chip').click();
        const command = page.getByRole('textbox', { name: 'Command' });
        await command.fill(`Theme: ${theme}`);
        await command.press('Enter');
        await expect
          .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
          .toBe(theme.toLocaleLowerCase());
      };

      await setTheme('Light');
      await assertNarrowToolbarIsUsable();
      await setTheme('Dark');
      await assertNarrowToolbarIsUsable();

      const paragraph = page.locator('.md-rich-content p').first();
      await paragraph.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await expect(page.getByTestId('md-selection-toolbar')).toBeVisible();
      await expect(page.getByTestId('md-selection-toolbar')).toHaveAttribute(
        'aria-label',
        'Format selection',
      );
      const selectionToolbarInsideEditor = await page
        .getByTestId('md-selection-toolbar')
        .evaluate((toolbar) => {
          const toolbarRect = toolbar.getBoundingClientRect();
          const editorRect = toolbar.closest('.md-rich-host')!.getBoundingClientRect();
          return (
            toolbarRect.left >= editorRect.left &&
            toolbarRect.right <= editorRect.right &&
            toolbarRect.top >= editorRect.top &&
            toolbarRect.bottom <= editorRect.bottom
          );
        });
      expect(selectionToolbarInsideEditor).toBe(true);

      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('/');
      await expect(page.getByTestId('md-slash-menu')).toBeVisible();
      await expect(page.getByRole('option', { name: /Heading 2/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('md-slash-menu')).toHaveCount(0);

      await page.locator('.md-rich-content').click();
      await page.getByRole('button', { name: 'Insert Code Block' }).click();
      const codeBlock = page.locator('.md-plain-code').last();
      await expect(codeBlock).toBeVisible();
      await codeBlock
        .getByRole('combobox', { name: 'Code block language' })
        .selectOption('typescript');
      await codeBlock.locator('textarea').fill('const answer: number = 42;');
      await expect(page.getByTestId('status-dirty')).toBeVisible();
      await page.keyboard.press(`${mod}+s`);

      await expect
        .poll(() => readFileSync(join(fixture, 'README.md'), 'utf8'))
        .toContain('```typescript\nconst answer: number = 42;\n```');

      await expect(page.getByTestId('md-rich-editor')).toBeVisible();
      await expect(codeBlock.getByRole('combobox', { name: 'Code block language' })).toBeVisible();
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      expect(pageErrors).toEqual([]);

      await page.getByTestId('md-mode-source').click();
      await expect(page.getByTestId('md-rich-editor')).toHaveCount(0);
      await expect(page.getByTestId('md-mode-source')).toHaveAttribute('aria-pressed', 'true');

      if (process.env.PI_IDE_QA_SCREENSHOT) {
        await page.getByTestId('md-mode-rich').click();
        await expect(page.getByTestId('md-rich-editor')).toBeVisible();
        await paragraph.click();
        await page.keyboard.press('End');
        await page.keyboard.press('/');
        await expect(page.getByTestId('md-slash-menu')).toBeVisible();
        await page.screenshot({ path: '/tmp/markdown-rich-toolbar-dark-980x760.png' });
        await page.keyboard.press('Escape');
      }
    } finally {
      await app.close();
    }
  });
});
