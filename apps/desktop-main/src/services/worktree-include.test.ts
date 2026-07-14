import { describe, expect, it } from 'vitest';
import { matchesWorktreeInclude, worktreeBranchName } from './worktree-service.js';

describe('matchesWorktreeInclude (.worktreeinclude gitignore-subset)', () => {
  it('matches plain file names at any depth', () => {
    expect(matchesWorktreeInclude(['.env'], '.env')).toBe(true);
    expect(matchesWorktreeInclude(['.env'], 'config/.env')).toBe(true);
    expect(matchesWorktreeInclude(['.env'], '.env.local')).toBe(false);
  });

  it('supports * within a segment', () => {
    expect(matchesWorktreeInclude(['.env.*'], '.env.local')).toBe(true);
    expect(matchesWorktreeInclude(['.env.*'], 'apps/web/.env.production')).toBe(true);
    expect(matchesWorktreeInclude(['*.pem'], 'certs/dev.pem')).toBe(true);
    expect(matchesWorktreeInclude(['*.pem'], 'certs/dev.pem.bak')).toBe(false);
  });

  it('anchors patterns with a leading slash to the root', () => {
    expect(matchesWorktreeInclude(['/.env'], '.env')).toBe(true);
    expect(matchesWorktreeInclude(['/.env'], 'sub/.env')).toBe(false);
  });

  it('treats patterns containing a slash as root-relative', () => {
    expect(matchesWorktreeInclude(['config/secrets.json'], 'config/secrets.json')).toBe(true);
    expect(matchesWorktreeInclude(['config/secrets.json'], 'x/config/secrets.json')).toBe(false);
  });

  it('supports ** across directories', () => {
    expect(matchesWorktreeInclude(['config/**/key.json'], 'config/a/b/key.json')).toBe(true);
    expect(matchesWorktreeInclude(['**/*.local'], 'deep/nested/app.local')).toBe(true);
  });

  it('directory patterns match the directory and its contents', () => {
    expect(matchesWorktreeInclude(['.certs/'], '.certs')).toBe(true);
    expect(matchesWorktreeInclude(['.certs/'], '.certs/site.pem')).toBe(true);
    expect(matchesWorktreeInclude(['.certs/'], 'certs')).toBe(false);
  });

  it('ignores comments, blanks and negations', () => {
    expect(matchesWorktreeInclude(['# comment', '', '!.env'], '.env')).toBe(false);
  });

  it('matches git --directory entries with trailing slash', () => {
    expect(matchesWorktreeInclude(['.venv/'], '.venv/')).toBe(true);
  });
});

describe('worktreeBranchName', () => {
  it('builds a readable slug + short id', () => {
    const branch = worktreeBranchName('task_abc123XYZ789', 'Add rate limiting to the login API!');
    expect(branch).toMatch(/^charter\/add-rate-limiting-to-the-login-api-[a-z0-9]{1,6}$/);
  });

  it('falls back to the task id when the title has no usable characters', () => {
    expect(worktreeBranchName('task_1', '!!!')).toBe('charter/task_1');
  });

  it('keeps branch names git-safe and bounded', () => {
    const branch = worktreeBranchName('task_x'.padEnd(30, '9'), 'A'.repeat(300));
    expect(branch.length).toBeLessThanOrEqual(60);
    expect(branch).toMatch(/^[A-Za-z0-9_./-]+$/);
  });
});
