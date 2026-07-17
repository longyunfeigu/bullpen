import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers/launch.js';
import { createTsSmallFixture } from './helpers/fixtures.js';

/** Visual acceptance walk for ADR-0022 (preview gate + PR draft) —
 * screenshots to /tmp/ui-shots/pg-*.png. Gated behind CHARTER_SHOTS. */
test.skip(!process.env.CHARTER_SHOTS, 'set CHARTER_SHOTS=1 to capture');

const OUT = '/tmp/ui-shots';

const CHECKOUT_HTML = `<!doctype html><meta charset="utf-8"><title>Checkout</title>
<style>body{font-family:-apple-system,sans-serif;max-width:520px;margin:40px auto;padding:0 16px}
.box{border:1px solid #ddd;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;margin-bottom:14px}
.row{display:flex;gap:8px;margin-bottom:10px}.row input{flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-family:monospace}
.row button{padding:8px 14px;border:1px solid #ccc;background:#f4f4f4;border-radius:8px}
.hint{width:130px;line-height:1.4;color:#b06f10;background:#faf0dc;border:1px solid #ecd9ae;border-radius:8px;padding:6px 10px;font-size:13px;margin-bottom:12px}
.submit{width:100%;padding:12px 0;border:none;border-radius:10px;background:#1b1a16;color:#fff;font-size:15px}</style>
<h2>Checkout</h2>
<div class="box"><span>Subtotal (2 items)</span><b>¥ 468.00</b></div>
<div class="row"><input value="SUMMER-20 (expired)"><button>Apply coupon</button></div>
<div class="hint">This coupon expired on Jun 30 — replace or remove it</div>
<button class="submit">Place order</button>`;

function startServer(cwd: string, html: string): Promise<{ child: ChildProcess; port: number }> {
  const script = `const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(${JSON.stringify(html)})});s.listen(0,'127.0.0.1',()=>console.log('PORT:'+s.address().port));`;
  const child = spawn(process.execPath, ['-e', script], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 10000);
    child.stdout!.on('data', (chunk: Buffer) => {
      const m = chunk.toString().match(/PORT:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]) });
      }
    });
  });
}

function findWorktree(userDataDir: string): string {
  const base = join(userDataDir, 'worktrees');
  for (const wsId of readdirSync(base)) {
    const tasks = readdirSync(join(base, wsId));
    if (tasks.length > 0) return join(base, wsId, tasks[0]!);
  }
  throw new Error('no worktree');
}

test('preview gate visual walk', async () => {
  test.setTimeout(300000);
  // Webish BEFORE the commit — the worktree is created from git HEAD, so the
  // dev script must be committed for the isolated tree to look web-ish.
  const fixture = createTsSmallFixture();
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify(
      {
        name: 'shots',
        private: true,
        scripts: { dev: 'node server.mjs', test: 'node run-tests.mjs' },
      },
      null,
      2,
    ),
  );
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: fixture });
  const { app, page, userDataDir } = await launchApp({
    env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
  });
  let server: ChildProcess | null = null;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('surface-home').click();
    await expect(page.getByTestId('home-model')).toContainText(/mock/i, { timeout: 15000 });
    await page.getByTestId('home-advanced-toggle').click();
    await page.getByTestId('home-adv-worktree').check();
    await page.getByTestId('home-intent').fill('[scenario:edit-basic] coupon expiry hint');
    await page.getByTestId('home-submit').click();
    await page.getByTestId('plan-approve').click({ timeout: 20000 });
    await page.getByTestId('perm-allow-task').click({ timeout: 20000 });
    await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
      timeout: 30000,
    });

    // 1 — gate opens on Changes with the new tab strip.
    await page.getByTestId('review-bar-open').click();
    await expect(page.getByTestId('review-view')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/pg-1-gate-changes.png` });

    // 2 — Preview tab: honest empty state (webish, no server yet).
    await page.getByTestId('review-tab-preview').click({ timeout: 10000 });
    await expect(page.getByTestId('preview-empty')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${OUT}/pg-2-preview-empty.png` });

    // 3 — dev server appears (poll picks it up).
    const worktree = findWorktree(userDataDir);
    server = (await startServer(worktree, CHECKOUT_HTML)).child;
    await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/pg-3-preview-live.png` });

    // 4 — marquee armed.
    await page.getByTestId('preview-mark').click();
    await expect(page.getByTestId('preview-overlay')).toBeVisible();
    await page.screenshot({ path: `${OUT}/pg-4-mark-armed.png` });

    // 5 — dragged + note card.
    const box = (await page.getByTestId('preview-overlay').boundingBox())!;
    await page.mouse.move(box.x + 330, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 640, box.y + 420, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('preview-note-input')).toBeVisible();
    await page
      .getByTestId('preview-note-input')
      .fill('Hint wraps to 3 lines; submit should be disabled.');
    await page.screenshot({ path: `${OUT}/pg-5-marquee-note.png` });

    // 6 — sent: room timeline with thumbnail.
    await page.getByTestId('preview-note-send').click();
    await expect(page.getByTestId('tl-preview-feedback').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/pg-6-room-feedback.png` });

    // Let the fix run finish (plan gate again — approve).
    await page.getByTestId('plan-approve').click({ timeout: 20000 });
    await page
      .getByTestId('perm-allow-task')
      .click({ timeout: 8000 })
      .catch(() => undefined);
    await expect(page.getByTestId('task-state')).toHaveAttribute('data-state', 'REVIEW_READY', {
      timeout: 30000,
    });

    // 7 — Checks tab (light), then dark spot-checks while the gate is open.
    await page.getByTestId('review-bar-open').click();
    await expect(page.getByTestId('review-view')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('review-tab-checks').click();
    await expect(page.getByTestId('checks-pane')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/pg-7-checks.png` });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/pg-8-checks-dark.png` });
    await page.getByTestId('review-tab-preview').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/pg-9-preview-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(400);

    // 10 — accept → PR draft card.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('review-accept-all').click();
    await expect(page.getByTestId('pr-draft-card')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/pg-10-pr-draft.png` });

    // 11 — dismissed: the timeline entry remains.
    await page.getByTestId('pr-draft-dismiss').click();
    await expect(page.getByTestId('tl-pr-draft')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/pg-11-room-done.png` });
  } finally {
    server?.kill();
    await app.close();
  }
});
