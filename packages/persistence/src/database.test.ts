import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductFailure } from '@pi-ide/foundation';
import { openDatabase, type Migration } from './database.js';
import { MIGRATIONS } from './migrations.js';

const M1: Migration = {
  version: 1,
  name: 'initial',
  up: 'CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT NOT NULL);',
};
const M2: Migration = {
  version: 2,
  name: 'add-count',
  up: 'ALTER TABLE items ADD COLUMN count INTEGER NOT NULL DEFAULT 0;',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-ide-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function open(migrations: Migration[]) {
  return openDatabase({
    file: join(dir, 'app.db'),
    backupDir: join(dir, 'backups'),
    migrations,
  });
}

describe('persistence database', () => {
  it('applies migrations on a fresh database and records checksums', () => {
    const { db, appliedVersions } = open([M1]);
    expect(appliedVersions).toEqual([1]);
    const rows = db
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; checksum: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
    db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run('a', 'hello');
    db.close();
  });

  it('is idempotent across reopen and applies only pending migrations with a backup', () => {
    const first = open([M1]);
    first.db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run('a', 'hello');
    first.db.close();

    const second = open([M1, M2]);
    expect(second.appliedVersions).toEqual([2]);
    const row = second.db.prepare('SELECT value, count FROM items WHERE id = ?').get('a') as {
      value: string;
      count: number;
    };
    expect(row).toEqual({ value: 'hello', count: 0 });
    second.db.close();
    // upgrade of an existing db must leave a pre-migration backup behind
    expect(existsSync(join(dir, 'backups'))).toBe(true);
    expect(readdirSync(join(dir, 'backups')).length).toBeGreaterThan(0);
  });

  it('rejects when an applied migration text was tampered with', () => {
    open([M1]).db.close();
    const tampered: Migration = { ...M1, up: M1.up + ' -- changed' };
    expect(() => open([tampered])).toThrowError(ProductFailure);
    try {
      open([tampered]);
    } catch (e) {
      expect((e as ProductFailure).error.code).toBe('DB_MIGRATION_CHECKSUM');
    }
  });

  it('restores the pre-migration backup when a migration fails', () => {
    const first = open([M1]);
    first.db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run('a', 'hello');
    first.db.close();

    const broken: Migration = { version: 2, name: 'broken', up: 'THIS IS NOT SQL;' };
    expect(() => open([M1, broken])).toThrowError(ProductFailure);

    // Database must still be usable at version 1 with data intact.
    const reopened = open([M1]);
    const row = reopened.db.prepare('SELECT value FROM items WHERE id = ?').get('a') as {
      value: string;
    };
    expect(row.value).toBe('hello');
    reopened.db.close();
  });

  it('transactions roll back on error', () => {
    const { db } = open([M1]);
    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run('x', '1');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const rows = db.prepare('SELECT * FROM items').all();
    expect(rows).toHaveLength(0);
    // and the connection is still usable afterwards
    db.transaction(() => {
      db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run('y', '2');
    });
    expect(db.prepare('SELECT * FROM items').all()).toHaveLength(1);
    db.close();
  });

  it('uses WAL journaling', () => {
    const { db } = open([M1]);
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode).toBe('wal');
    db.close();
  });

  it('upgrades an existing v3 database with conversation-reference snapshots', () => {
    const before = open(MIGRATIONS.slice(0, 3));
    before.db.close();

    const upgraded = open(MIGRATIONS);
    expect(upgraded.appliedVersions).toEqual([4]);
    const table = upgraded.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_conversation_references'",
      )
      .get() as { name: string } | undefined;
    expect(table?.name).toBe('task_conversation_references');
    upgraded.db.close();
  });
});
