import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeProjectDirName,
  discoverCliSessionId,
  isSafeCliSessionId,
} from './cli-session-locator.js';

const ID_A = '11111111-2222-3333-4444-555555555555';
const ID_B = '66666666-7777-8888-9999-aaaaaaaaaaaa';

function touch(path: string, mtimeMs: number): void {
  writeFileSync(path, '{"sessionId":"x"}\n');
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

describe('claudeProjectDirName', () => {
  it('replaces every non-alphanumeric character with a dash (verified against real installs)', () => {
    expect(claudeProjectDirName('/Users/x/git/bullpen')).toBe('-Users-x-git-bullpen');
    // Underscores and dots are munged too — the fixture dirs prove it.
    expect(claudeProjectDirName('/var/folders/ab_cd/T/pi-ide.fixture')).toBe(
      '-var-folders-ab-cd-T-pi-ide-fixture',
    );
  });
});

describe('isSafeCliSessionId', () => {
  it('accepts exactly UUIDs and nothing shell-shaped', () => {
    expect(isSafeCliSessionId(ID_A)).toBe(true);
    expect(isSafeCliSessionId('abc; rm -rf .')).toBe(false);
    expect(isSafeCliSessionId('$(evil)')).toBe(false);
    expect(isSafeCliSessionId('')).toBe(false);
  });
});

describe('discoverCliSessionId — claude transcripts', () => {
  it('picks the newest transcript inside the session window and ignores older sessions', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cli-loc-'));
    const cwd = '/work/app';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    const start = Date.now() - 10 * 60_000;
    touch(join(dir, `${ID_A}.jsonl`), start - 60 * 60_000); // an hour-old session
    touch(join(dir, `${ID_B}.jsonl`), start + 5 * 60_000); // this session
    writeFileSync(join(dir, 'not-a-session.jsonl'), ''); // non-UUID ignored

    await expect(
      discoverCliSessionId({ cli: 'claude', cwd, startedAtMs: start, endedAtMs: Date.now(), home }),
    ).resolves.toBe(ID_B);
  });

  it('resolves null when the project has no transcript directory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cli-loc-'));
    await expect(
      discoverCliSessionId({
        cli: 'claude',
        cwd: '/nowhere',
        startedAtMs: Date.now() - 1000,
        endedAtMs: Date.now(),
        home,
      }),
    ).resolves.toBeNull();
  });

  it('resolves null when every transcript predates the session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cli-loc-'));
    const cwd = '/work/app';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    const start = Date.now();
    touch(join(dir, `${ID_A}.jsonl`), start - 3 * 60 * 60_000);
    await expect(
      discoverCliSessionId({
        cli: 'claude',
        cwd,
        startedAtMs: start,
        endedAtMs: start + 1000,
        home,
      }),
    ).resolves.toBeNull();
  });
});

describe('discoverCliSessionId — codex rollouts', () => {
  it('walks the date-partitioned tree and extracts the rollout UUID', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cli-loc-'));
    const now = new Date();
    const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const dir = join(home, '.codex', 'sessions', key);
    mkdirSync(dir, { recursive: true });
    const start = Date.now() - 5 * 60_000;
    touch(join(dir, `rollout-2026-07-16T12-00-00-${ID_A}.jsonl`), start - 60 * 60_000);
    touch(join(dir, `rollout-2026-07-16T12-30-00-${ID_B}.jsonl`), start + 60_000);

    await expect(
      discoverCliSessionId({
        cli: 'codex',
        cwd: '/any',
        startedAtMs: start,
        endedAtMs: Date.now(),
        home,
      }),
    ).resolves.toBe(ID_B);
  });

  it('resolves null for unknown CLIs', async () => {
    await expect(
      discoverCliSessionId({
        cli: 'fakeagent',
        cwd: '/any',
        startedAtMs: 0,
        endedAtMs: 1,
        home: '/nonexistent',
      }),
    ).resolves.toBeNull();
  });
});
