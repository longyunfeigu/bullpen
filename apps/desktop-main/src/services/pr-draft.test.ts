import { describe, expect, it } from 'vitest';
import type { VerificationRunRecord } from '@pi-ide/verification-service';
import {
  buildPrCommands,
  buildPrDraft,
  prBranchName,
  verificationMatrixLines,
} from './pr-draft.js';

/** ADR-0022: the PR draft is a projection of the evidence ledger — and the
 * commands are copy-out only (GIT-007 is enforced by there being no runner). */

function run(partial: Partial<VerificationRunRecord>): VerificationRunRecord {
  return {
    id: 'run-1',
    taskId: 't-1',
    label: 'tests',
    command: { label: 'tests', executable: 'npm', args: ['test'], cwd: '', timeoutMs: 60000 },
    codeRevision: 'r1',
    state: 'passed',
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    stale: false,
    supersededBy: null,
    outputRef: null,
    outputExcerpt: '',
    startedAt: '2026-07-16T02:00:00.000Z',
    endedAt: '2026-07-16T02:00:21.000Z',
    createdAt: '2026-07-16T02:00:00.000Z',
    ...partial,
  };
}

const EVIDENCE = {
  taskId: 'task_abc123xyz',
  title: 'Coupon expiry: inline hint + disabled submit',
  goalMd: 'When a coupon is expired, show an inline hint and disable submit.',
  acceptance: ['Expired coupon shows inline hint', 'Submit disabled while expired'],
  worktreeBranch: 'charter/coupon-expiry-inline-hint-c123xy',
  files: [
    { path: 'src/CouponField.tsx', status: 'modified' as const, additions: 34, deletions: 6 },
    { path: 'src/CouponField.test.tsx', status: 'created' as const, additions: 58, deletions: 0 },
  ],
  verification: [
    run({ id: 'v1', label: 'e2e', state: 'failed', exitCode: 1, supersededBy: 'v2' }),
    run({ id: 'v2', label: 'e2e', state: 'passed' }),
    run({ id: 'v3', label: 'unit', state: 'passed' }),
  ],
  receiptSha256: 'deadbeef'.repeat(8),
  unverifiedConfirmed: false,
  acceptedAt: '2026-07-16T03:00:00.000Z',
};

describe('prBranchName', () => {
  it('derives from the worktree audit branch without colliding with it', () => {
    expect(prBranchName(EVIDENCE)).toBe('charter/pr/coupon-expiry-inline-hint-c123xy');
  });
  it('slugs from the title for non-worktree tasks', () => {
    const name = prBranchName({ ...EVIDENCE, worktreeBranch: null });
    expect(name).toMatch(/^charter\/pr\/coupon-expiry-inline-hint/);
    expect(name).not.toContain(' ');
  });
});

describe('verificationMatrixLines', () => {
  it('summarizes per label, keeps superseded history visible, never erases', () => {
    const lines = verificationMatrixLines(EVIDENCE.verification, false);
    const e2e = lines.find((l) => l.includes('e2e'))!;
    expect(e2e).toContain('✓ e2e — passed');
    expect(e2e).toContain('1 earlier run superseded');
    expect(lines.find((l) => l.includes('unit'))).toContain('✓ unit — passed');
  });
  it('marks stale runs', () => {
    const lines = verificationMatrixLines([run({ stale: true })], false);
    expect(lines[0]).toContain('stale — code changed after this run');
  });
  it('is loud about Unverified (VER-007)', () => {
    expect(verificationMatrixLines([], true)[0]).toContain('accepted with explicit confirmation');
    expect(verificationMatrixLines([], false)[0]).toContain('Unverified');
  });
});

describe('buildPrDraft', () => {
  const draft = buildPrDraft(EVIDENCE);
  it('body carries goal, acceptance, change list with ± and the receipt hash', () => {
    expect(draft.title).toBe('Coupon expiry: inline hint + disabled submit');
    expect(draft.body).toContain('## Goal');
    expect(draft.body).toContain('- [ ] Expired coupon shows inline hint');
    expect(draft.body).toContain('`src/CouponField.tsx` — modified, +34 −6');
    expect(draft.body).toContain('## Changes — 2 files, +92 −6');
    expect(draft.body).toContain(`sha256:${EVIDENCE.receiptSha256}`);
    expect(draft.body).toContain('GIT-007');
  });
  it('handles the no-receipt case honestly', () => {
    const noReceipt = buildPrDraft({ ...EVIDENCE, receiptSha256: null });
    expect(noReceipt.body).not.toContain('sha256:');
    expect(noReceipt.body).toContain('available for export');
  });
});

describe('buildPrCommands', () => {
  it('branch → add → commit → push → gh pr create, with quoting; nothing else', () => {
    const commands = buildPrCommands({
      branch: 'charter/pr/x-1',
      title: `fix: don't break`,
      files: [
        { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 },
        { path: 'new dir/b.ts', status: 'created', additions: 2, deletions: 0 },
        {
          path: 'renamed.ts',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          renamedFrom: 'old.ts',
        },
      ],
      bodyPath: '/tmp/pr body.md',
    });
    const lines = commands.split('\n');
    expect(lines[0]).toBe(`git switch -c 'charter/pr/x-1'`);
    expect(lines[1]).toBe(`git add -A -- 'src/a.ts' 'new dir/b.ts' 'renamed.ts' 'old.ts'`);
    expect(lines[2]).toBe(`git commit -m 'fix: don'\\''t break'`);
    expect(lines[3]).toBe(`git push -u origin 'charter/pr/x-1'`);
    expect(lines[4]).toBe(
      `gh pr create --draft --title 'fix: don'\\''t break' --body-file '/tmp/pr body.md'`,
    );
    expect(lines).toHaveLength(5);
    // GIT-007 sanity: the block is instructions, not an execution plan — no
    // chaining that would let one paste run past a failure silently.
    expect(commands).not.toContain('&&');
  });
});
