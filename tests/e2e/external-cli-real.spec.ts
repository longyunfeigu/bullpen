import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers/launch';
import { createGitFixture } from './helpers/fixtures';

/**
 * ADR-0017 — manual, env-gated (real-gateway.spec convention): drives the
 * REAL claude/codex CLIs installed on this machine through the embedded PTY.
 * Costs real tokens (claude runs one tiny haiku task) and depends on local
 * install shapes — exactly what the fake-CLI specs cannot cover:
 *   - claude: native installer, `claude → …/versions/<semver>` (kernel comm
 *     is the version string — the ADR-0017 amendment regression).
 *   - codex: whatever wrapper/shim the user's shell resolves (here a zsh
 *     function → nvm shim).
 * Run: PI_IDE_REAL_EXTERNAL_CLI=1 npx playwright test external-cli-real …
 */
const REAL = process.env.PI_IDE_REAL_EXTERNAL_CLI === '1';
const SHOTS = '/tmp/live-e2e';
/** Optional demo capture: set to a directory to record .webm videos of the runs. */
const VIDEO_DIR = process.env.PI_IDE_E2E_VIDEO_DIR;
const recordVideo = VIDEO_DIR ? { dir: VIDEO_DIR, size: { width: 1600, height: 900 } } : undefined;

async function openLiveTerminal(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Control+`');
  await expect(page.getByTestId('terminal-panel')).toBeVisible();
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 15000 });
  await page.locator('.xterm').click();
  await page.keyboard.type('echo ready-marker');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal-panel')).toContainText('ready-marker', {
    timeout: 15000,
  });
}

test.describe('ADR-0017 real external CLIs (manual, gated)', () => {
  test.skip(!REAL, 'set PI_IDE_REAL_EXTERNAL_CLI=1 to drive the real claude/codex CLIs');
  test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

  test('real claude: detect → real edit accounted → REVIEW_READY', async () => {
    test.setTimeout(240000); // a real model round-trip sits in the middle
    const fixture = createGitFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture },
      recordVideo,
    });
    try {
      await openLiveTerminal(page);

      // Print mode: one deterministic tiny edit, cheap fast model, no
      // interactive permission stops, scoped to the throwaway git fixture.
      await page.keyboard.type(
        'claude --model haiku --dangerously-skip-permissions -p ' +
          '"Create a file named e2e-touch.txt containing exactly: external e2e ok"',
      );
      await page.keyboard.press('Enter');

      // Detection despite the version-named binary (kernel comm = "2.1.209").
      await expect(page.locator('[data-testid^="terminal-agent-"]')).toContainText('claude', {
        timeout: 30000,
      });
      await page.screenshot({ path: join(SHOTS, 'claude-detected.png') });

      // -p exits on its own; the session must end (badge clears).
      await expect(page.locator('[data-testid^="terminal-agent-"]')).toHaveCount(0, {
        timeout: 180000,
      });
      await page.screenshot({ path: join(SHOTS, 'claude-ended.png') });

      // The real edit is on disk and accounted; the task landed in review.
      expect(readFileSync(join(fixture, 'e2e-touch.txt'), 'utf8')).toContain('external e2e ok');
      const result = await page.evaluate(async () => {
        const bridge = (
          window as never as {
            product: { rpc: Record<string, (p: unknown) => Promise<{ ok: boolean; data?: any }>> };
          }
        ).product;
        const tasks = await bridge.rpc['task.list']!({ filter: 'all', includeArchived: false });
        const external = tasks.data?.tasks?.find((t: { external: unknown }) => t.external);
        if (!external) return null;
        const cs = await bridge.rpc['task.changeSet']!({ taskId: external.id });
        return { state: external.state as string, changeSet: cs.data?.changeSet ?? null };
      });
      expect(result).not.toBeNull();
      expect(result!.state).toBe('REVIEW_READY');
      const touched = (
        result!.changeSet as { files: Array<{ path: string; status: string }> }
      ).files.find((f) => f.path === 'e2e-touch.txt');
      expect(touched?.status).toBe('created');
    } finally {
      const video = page.video();
      await app.close();
      if (VIDEO_DIR && video) await video.saveAs(join(VIDEO_DIR, 'real-claude.webm'));
    }
  });

  test('real codex: session enter is detected through the local wrapper', async () => {
    test.setTimeout(120000);
    const fixture = createGitFixture();
    const { app, page } = await launchApp({
      env: { PI_IDE_OPEN_WORKSPACE: fixture },
      recordVideo,
    });
    try {
      await openLiveTerminal(page);
      await page.keyboard.type('codex');
      await page.keyboard.press('Enter');

      // The user's zsh function (nvm lazy-load + proxy) wraps the real CLI;
      // detection must see through whatever shim shape it resolves to.
      await expect(page.locator('[data-testid^="terminal-agent-"]')).toContainText('codex', {
        timeout: 45000,
      });
      await page.screenshot({ path: join(SHOTS, 'codex-detected.png') });

      // An external task exists for the session (accounting armed).
      const hasExternal = await page.evaluate(async () => {
        const bridge = (
          window as never as {
            product: { rpc: Record<string, (p: unknown) => Promise<{ ok: boolean; data?: any }>> };
          }
        ).product;
        const tasks = await bridge.rpc['task.list']!({ filter: 'all', includeArchived: false });
        return Boolean(tasks.data?.tasks?.some((t: { external: unknown }) => t.external));
      });
      expect(hasExternal).toBe(true);
      // Closing the app kills the PTY, which fires the session-exit edge
      // (fireAgentExitIfActive) — quitting the TUI itself is not under test.
    } finally {
      const video = page.video();
      await app.close();
      if (VIDEO_DIR && video) await video.saveAs(join(VIDEO_DIR, 'real-codex.webm'));
    }
  });
});
