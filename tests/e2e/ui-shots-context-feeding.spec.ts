import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch.js';
import { createTsSmallFixture } from './helpers/fixtures.js';

/** Visual acceptance walk for ADR-0024 (Room context feeding, mock B+D) —
 * screenshots to /tmp/ui-shots/ctx-*.png. Gated behind CHARTER_SHOTS. */
test.skip(!process.env.CHARTER_SHOTS, 'set CHARTER_SHOTS=1 to capture');

const OUT = '/tmp/ui-shots';

test('context feeding walk: Files pane, chips, drop veil, sent refs', async () => {
  const fixture = createTsSmallFixture();
  const { app, page } = await launchApp({
    env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('surface-home').click();
    await page.getByTestId('home-mode-auto').click();
    await page.getByTestId('home-intent').fill('[scenario:edit-basic] context feeding shots');
    await page.getByTestId('home-submit').click();
    await expect(page.getByTestId('task-room')).toBeVisible();

    // 1 — the Files tab with the persistent tree.
    await page.getByTestId('rail-tab-files').click();
    await expect(page.getByTestId('session-files-tree')).toBeVisible();
    await page.screenshot({ path: `${OUT}/ctx-1-files-pane.png` });

    // 2 — chips on the composer (folder + file via quick-add).
    const srcRow = page.getByTestId('session-files-tree-src');
    await srcRow.hover();
    await page.getByTestId('session-files-tree-add-src').click();
    await srcRow.click();
    const indexRow = page.getByTestId('session-files-tree-src/index.ts');
    await indexRow.hover();
    await page.getByTestId('session-files-tree-add-src/index.ts').click();
    await expect(page.getByTestId('room-file-refs')).toContainText('src/index.ts');
    await page.screenshot({ path: `${OUT}/ctx-2-chips.png` });

    // 3 — the room-wide drop veil (synthetic dragover carrying Files).
    await page.evaluate(() => {
      const room = document.querySelector('[data-testid="task-room"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'design.png', { type: 'image/png' }));
      room?.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    });
    await expect(page.getByTestId('room-dropveil')).toBeVisible();
    await page.screenshot({ path: `${OUT}/ctx-3-drop-veil.png` });
    await page.evaluate(() => {
      const room = document.querySelector('[data-testid="task-room"]');
      room?.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    });

    // 4 — sent refs in the timeline.
    await page.getByTestId('agent-input').fill('use the attached context');
    await page.getByTestId('agent-send').click();
    await expect(page.getByTestId('tl-file-refs').last()).toBeVisible();
    await page.screenshot({ path: `${OUT}/ctx-4-sent-refs.png` });

    // 5 — Sessions tab with the attention-dot slot (dot only when needed).
    await page.getByTestId('rail-tab-sessions').click();
    await page.screenshot({ path: `${OUT}/ctx-5-sessions-tab.png` });
  } finally {
    await app.close();
  }
});
