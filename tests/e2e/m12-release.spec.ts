import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../packages/persistence/src/database';
import { MIGRATIONS } from '../../packages/persistence/src/migrations';
import { createTsSmallFixture } from './helpers/fixtures';
import { launchApp } from './helpers/launch';

test('E2E-023: a previous-schema profile upgrades with its Session readable and a backup kept', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'charter-upgrade-e2e-'));
  const fixture = createTsSmallFixture();
  const now = new Date().toISOString();
  const legacy = openDatabase({
    file: join(userDataDir, 'app.db'),
    backupDir: join(userDataDir, 'backups'),
    migrations: MIGRATIONS.slice(0, 7),
  });
  legacy.db
    .prepare(
      'INSERT INTO workspaces (id, canonical_path, display_name, trust_state, last_opened_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('m12-workspace', fixture, 'M12 upgrade fixture', 'trusted', now, now);
  legacy.db
    .prepare(
      'INSERT INTO tasks (id, workspace_id, title, goal_md, mode, state, model_json, created_at, updated_at) VALUES (?, ?, ?, \'\', \'ask\', \'IDLE\', \'{"providerId":"mock","modelId":"mock-1"}\', ?, ?)',
    )
    .run('m12-legacy-task', 'm12-workspace', 'M12 legacy Session survives', now, now);
  legacy.db.close();

  const launched = await launchApp({
    userDataDir,
    env: { PI_IDE_OPEN_WORKSPACE: fixture, PI_IDE_FORCE_MOCK: '1' },
  });
  try {
    await expect(launched.page.getByTestId('startup-error')).toHaveCount(0);
    const titles = await launched.page.evaluate(async () => {
      const bridge = (
        window as never as {
          product: { rpc: Record<string, (payload: unknown) => Promise<unknown>> };
        }
      ).product;
      const result = (await bridge.rpc['task.list']!({
        filter: 'all',
        includeArchived: false,
        scope: 'all',
      })) as { ok: boolean; data?: { tasks: Array<{ title: string }> } };
      return result.data?.tasks.map((task) => task.title) ?? [];
    });
    expect(titles).toContain('M12 legacy Session survives');
  } finally {
    await launched.app.close();
  }

  const db = new DatabaseSync(join(userDataDir, 'app.db'));
  try {
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual(
      MIGRATIONS.map((migration) => migration.version),
    );
    expect(db.prepare('SELECT title FROM tasks WHERE id = ?').get('m12-legacy-task')).toEqual({
      title: 'M12 legacy Session survives',
    });
  } finally {
    db.close();
  }
  expect(existsSync(join(userDataDir, 'backups'))).toBe(true);
  expect(readdirSync(join(userDataDir, 'backups')).some((name) => name.includes('.v7.'))).toBe(
    true,
  );
  rmSync(userDataDir, { recursive: true, force: true });
});
