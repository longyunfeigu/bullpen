import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createGitFixture } from './helpers/fixtures';
import {
  terminalPtySnapshot,
  typeTerminalCommand,
  waitForTerminalOutput,
} from './helpers/terminal';

test.describe('terminal renderer and character widths', () => {
  test('WebGL degrades safely and compatibility settings apply to real xterm instances', async () => {
    const fixture = createGitFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, ZDOTDIR: fixture },
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.keyboard.press('Control+`');
      const first = page.getByTestId('terminal-host').locator('.xterm');
      await expect(first).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.terminal-row-cwd').first()).toContainText('Context cwd');
      await expect(page.locator('.tsb-context').first()).toContainText('context cwd');
      await expect(first).toHaveAttribute('data-terminal-unicode', '11');
      await expect(first).toHaveAttribute('data-terminal-renderer', /^(webgl|software)$/);

      await page.getByTestId('home-settings').click();
      await page.getByTestId('settings-section-terminal').click();
      await page.getByTestId('settings-terminal-renderer').selectOption('software');
      await page.getByTestId('settings-terminal-unicode').selectOption('6');
      await page.keyboard.press('Escape');

      // A fresh terminal picks up both settings; an older terminal will sync on
      // its next mount as it moves between the dock, room and side tool canvas.
      await page.getByTestId('terminal-new').click();
      const compatible = page.getByTestId('terminal-host').locator('.xterm');
      await expect(compatible).toHaveAttribute('data-terminal-renderer', 'software');
      await expect(compatible).toHaveAttribute('data-terminal-unicode', '6');
      await compatible.click();
      await page.keyboard.type("printf '中文%s ABC123\\n' '对齐'");
      await page.keyboard.press('Enter');
      const terminalId = (await terminalPtySnapshot(page)).items.at(-1)!.id;
      await waitForTerminalOutput(page, '中文对齐 ABC123', { terminalId });

      // Exercise Electron's native clipboard and xterm paste handler. A
      // synthetic ClipboardEvent bypasses the browser/OS path and previously
      // produced a misleading line-48 truncation report.
      const probePath = join(fixture, '.terminal-native-paste');
      const expectedLines = Array.from(
        { length: 50 },
        (_, index) => `native-paste-${String(index + 1).padStart(2, '0')}`,
      );
      const clipboardText = expectedLines
        .map(
          (line, index) =>
            `printf '%s\\n' '${line}' ${index === 0 ? '>' : '>>'} .terminal-native-paste`,
        )
        .concat("printf '\\137\\137NATIVE_PASTE_COMPLETE\\137\\137\\n'")
        .join('\n');
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardText);
      await compatible.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
      await page.keyboard.press('Enter');
      await waitForTerminalOutput(page, '__NATIVE_PASTE_COMPLETE__', {
        terminalId,
        timeout: 30_000,
      });
      expect(readFileSync(probePath, 'utf8')).toBe(`${expectedLines.join('\n')}\n`);

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 900, height: 900 });
      });
      await expect(compatible).toBeVisible();
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      expect(pageErrors).toEqual([]);

      if (process.env.PI_IDE_QA_SCREENSHOT) {
        await page.screenshot({ path: '/tmp/terminal-rendering-compat-900x900.png' });
      }
    } finally {
      await app.close();
    }
  });

  test('alternate-screen programs and Ctrl-D EOF return cleanly', async () => {
    const fixture = createGitFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture, ZDOTDIR: fixture },
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.keyboard.press('Control+`');
      const xterm = page.locator('.xterm');
      await expect(xterm).toBeVisible({ timeout: 15_000 });
      const terminal = (await terminalPtySnapshot(page)).items[0]!;

      await typeTerminalCommand(
        page,
        "printf '\\033[?1049h\\033[2J\\033[HALT_%s_ACTIVE' SCREEN; sleep 1; printf '\\033[?1049lALT_%s_DONE\\n' SCREEN",
        { terminalId: terminal.id, xterm },
      );
      await waitForTerminalOutput(page, 'ALT_SCREEN_ACTIVE', { terminalId: terminal.id });
      await waitForTerminalOutput(page, 'ALT_SCREEN_DONE', { terminalId: terminal.id });
      await expect(xterm).toHaveAttribute('data-terminal-renderer', /^(webgl|software)$/);
      expect(pageErrors).toEqual([]);

      // Drive Ctrl-D through xterm's real keyboard path while `cat` owns the
      // foreground PTY. The following shell marker can only run after EOF.
      await typeTerminalCommand(page, 'cat > .terminal-ctrl-d', {
        terminalId: terminal.id,
        xterm,
      });
      await page.keyboard.type('ctrl-d-content');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Control+d');
      await page.waitForTimeout(200);
      await page.keyboard.type("printf '\\137\\137CTRL_D_RETURNED\\137\\137\\n'");
      await page.keyboard.press('Enter');
      await waitForTerminalOutput(page, '__CTRL_D_RETURNED__', { terminalId: terminal.id });
      expect(readFileSync(join(fixture, '.terminal-ctrl-d'), 'utf8')).toBe('ctrl-d-content\n');
      expect(pageErrors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
