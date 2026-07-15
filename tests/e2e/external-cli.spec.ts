import { expect, test } from '@playwright/test';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createGitFixture } from './helpers/fixtures';

/**
 * ADR-0017 — external CLI agent sessions. A fake agent CLI (a node script, so
 * detection exercises the interpreter/descendant-scan path like an
 * npm-installed claude) runs inside a REAL embedded PTY, edits a workspace
 * file and exits. The product must detect the session, badge the terminal,
 * account the change, offer the session room and land in REVIEW_READY.
 */

function createFakeAgentBin(fixture: string): string {
  const bin = mkdtempSync(join(tmpdir(), 'pi-ide-fakebin-'));
  const target = join(fixture, 'src/util.ts').replace(/\\/g, '/');
  writeFileSync(
    join(bin, 'fakeagent'),
    [
      '#!/usr/bin/env node',
      "const fs = require('fs');",
      `const target = ${JSON.stringify(target)};`,
      "console.log('✳ fake agent session started');",
      'setTimeout(() => {',
      "  const src = fs.readFileSync(target, 'utf8');",
      "  fs.writeFileSync(target, src + 'export const externalTouch = 1;\\n');",
      "  console.log('✏ edited src/util.ts');",
      '}, 1500);',
      'setTimeout(() => process.exit(0), 4000);',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'fakeagent'), 0o755);
  return bin;
}

test.describe('ADR-0017 external CLI agent sessions', () => {
  test('detect → badge → account → session room → REVIEW_READY', async () => {
    const fixture = createGitFixture();
    const bin = createFakeAgentBin(fixture);
    const { app, page } = await launchApp({
      env: {
        PI_IDE_OPEN_WORKSPACE: fixture,
        PI_IDE_EXTERNAL_CLIS: 'fakeagent',
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
    });
    try {
      // Open a terminal on the IDE surface and start the fake agent.
      await page.keyboard.press('Control+`');
      await expect(page.getByTestId('terminal-panel')).toBeVisible();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15000 });
      await page.locator('.xterm').click();
      // zsh init can drop very-early keystrokes — prove the prompt is live first.
      await page.keyboard.type('echo ready-marker');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('terminal-panel')).toContainText('ready-marker', {
        timeout: 15000,
      });
      await page.keyboard.type('fakeagent');
      await page.keyboard.press('Enter');

      // Detection: tab renames with the EXT badge, the room entry appears.
      await expect(page.locator('[data-testid^="terminal-agent-"]')).toContainText('fakeagent', {
        timeout: 15000,
      });
      const openRoom = page.locator('[data-testid^="terminal-open-room-"]');
      await expect(openRoom).toBeVisible({ timeout: 15000 });

      // Enter the session room (Home surface): terminal takes the center column.
      await openRoom.click();
      await expect(page.getByTestId('task-room')).toBeVisible();
      await expect(page.getByTestId('task-room-external-chip')).toContainText('fakeagent');
      await expect(page.getByTestId('external-terminal-column')).toBeVisible();
      await expect(page.getByTestId('external-terminal-host')).toBeVisible();

      // Watcher accounting: the CLI's edit lands in the rail with a diffstat.
      const fileRow = page.getByTestId('task-room-file-src/util.ts');
      await expect(fileRow).toBeVisible({ timeout: 15000 });

      // Peek (ADR-0014) opens on the accounted diff, conversation stays put.
      await fileRow.click();
      await expect(page.getByTestId('file-peek')).toBeVisible();
      await expect(page.getByTestId('peek-tab-src/util.ts')).toBeVisible();

      // Session end: never auto-accepted — REVIEW_READY with a live review entry.
      await expect(page.getByTestId('external-ended')).toBeVisible({ timeout: 20000 });
      // Close the peek: the rail (and its decision panel) comes back (ADR-0014).
      await page.getByTestId('peek-close').click();
      await expect(page.getByTestId('review-open').first()).toBeVisible({ timeout: 15000 });

      // The accounted baseline is the PRE-session content: the diff must show
      // exactly the line the fake agent appended.
      const cs = await page.evaluate(async () => {
        const bridge = (
          window as never as {
            product: {
              rpc: Record<
                string,
                (p: unknown) => Promise<{
                  ok: boolean;
                  data?: {
                    changeSet: {
                      files: Array<{ path: string; status: string; additions: number }>;
                    };
                  };
                }>
              >;
            };
          }
        ).product;
        const tasks = await bridge.rpc['task.list']!({ filter: 'all', includeArchived: false });
        const list = (tasks as { data?: { tasks: Array<{ id: string; external: unknown }> } }).data
          ?.tasks;
        const external = list?.find((t) => t.external);
        if (!external) return null;
        const res = await bridge.rpc['task.changeSet']!({ taskId: external.id });
        return res.data?.changeSet ?? null;
      });
      expect(cs).not.toBeNull();
      const utilFile = cs!.files.find((f) => f.path === 'src/util.ts');
      expect(utilFile?.status).toBe('modified');
      expect(utilFile?.additions).toBe(1);

      // Disk really has the CLI's edit (the session was real, not simulated).
      expect(readFileSync(join(fixture, 'src/util.ts'), 'utf8')).toContain('externalTouch');
    } finally {
      await app.close();
    }
  });

  test('detects the native-installer shape: version-named binary behind a CLI symlink', async () => {
    // The native claude/codex installers link `claude → …/versions/2.1.209`,
    // so the kernel short name node-pty reports is the version string, never
    // the CLI name. Only the argv process-tree fallback can see the session.
    test.skip(process.platform !== 'darwin', 'kernel comm shape under test is darwin-specific');
    const fixture = createGitFixture();
    const bin = mkdtempSync(join(tmpdir(), 'pi-ide-fakebin-'));
    mkdirSync(join(bin, 'versions'));
    copyFileSync('/bin/zsh', join(bin, 'versions', '9.9.9'));
    chmodSync(join(bin, 'versions', '9.9.9'), 0o755);
    symlinkSync(join(bin, 'versions', '9.9.9'), join(bin, 'fakeclaude'));
    const target = join(fixture, 'src/util.ts').replace(/\\/g, '/');
    writeFileSync(
      join(bin, 'agent.zsh'),
      [
        "echo '✳ fake versioned agent started'",
        'sleep 2',
        `echo 'export const externalTouch = 1;' >> ${JSON.stringify(target)}`,
        "echo '✏ edited src/util.ts'",
        'sleep 1',
        '',
      ].join('\n'),
    );

    const { app, page } = await launchApp({
      env: {
        PI_IDE_OPEN_WORKSPACE: fixture,
        PI_IDE_EXTERNAL_CLIS: 'fakeclaude',
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
    });
    try {
      await page.keyboard.press('Control+`');
      await expect(page.getByTestId('terminal-panel')).toBeVisible();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15000 });
      await page.locator('.xterm').click();
      await page.keyboard.type('echo ready-marker');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('terminal-panel')).toContainText('ready-marker', {
        timeout: 15000,
      });
      await page.keyboard.type(`fakeclaude ${join(bin, 'agent.zsh')}`);
      await page.keyboard.press('Enter');

      // Detection despite the foreground title reading "9.9.9".
      await expect(page.locator('[data-testid^="terminal-agent-"]')).toContainText('fakeclaude', {
        timeout: 15000,
      });

      // Script exit ends the session (badge clears after the grace streak).
      await expect(page.locator('[data-testid^="terminal-agent-"]')).toHaveCount(0, {
        timeout: 20000,
      });

      // The edit was accounted against an external task.
      const cs = await page.evaluate(async () => {
        const bridge = (
          window as never as {
            product: { rpc: Record<string, (p: unknown) => Promise<{ ok: boolean; data?: any }>> };
          }
        ).product;
        const tasks = await bridge.rpc['task.list']!({ filter: 'all', includeArchived: false });
        const external = tasks.data?.tasks?.find((t: { external: unknown }) => t.external);
        if (!external) return null;
        const res = await bridge.rpc['task.changeSet']!({ taskId: external.id });
        return res.data?.changeSet ?? null;
      });
      expect(cs).not.toBeNull();
      const utilFile = (cs as { files: Array<{ path: string; status: string }> }).files.find(
        (f) => f.path === 'src/util.ts',
      );
      expect(utilFile?.status).toBe('modified');
      expect(readFileSync(join(fixture, 'src/util.ts'), 'utf8')).toContain('externalTouch');
    } finally {
      await app.close();
    }
  });
});
