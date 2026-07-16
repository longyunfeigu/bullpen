import type { ChangeKind } from '@pi-ide/change-service';
import type { VerificationRunRecord } from '@pi-ide/verification-service';
import { worktreeBranchName } from './worktree-service.js';

/**
 * PR draft generation (ADR-0022): a projection of the evidence ledger — goal,
 * accepted change list, verification matrix, receipt hash. The app only ever
 * copies this out; push/PR creation stay user actions in the user's shell
 * (GIT-007).
 */

export interface PrDraftEvidence {
  taskId: string;
  title: string;
  goalMd: string;
  acceptance: string[];
  /** Worktree audit branch (charter/<slug>-<id>) when the task had one. */
  worktreeBranch: string | null;
  files: Array<{
    path: string;
    status: ChangeKind;
    additions: number;
    deletions: number;
    renamedFrom?: string | null | undefined;
  }>;
  verification: VerificationRunRecord[];
  receiptSha256: string | null;
  unverifiedConfirmed: boolean;
  acceptedAt: string;
}

export interface PrDraft {
  branch: string;
  title: string;
  body: string;
}

/** `charter/pr/<slug>-<short>` — never collides with the audit branch. */
export function prBranchName(
  evidence: Pick<PrDraftEvidence, 'taskId' | 'title' | 'worktreeBranch'>,
): string {
  const base = evidence.worktreeBranch ?? worktreeBranchName(evidence.taskId, evidence.title);
  return base.replace(/^charter\//, 'charter/pr/');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const STATUS_LABEL: Record<ChangeKind, string> = {
  created: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
};

function durationLabel(run: VerificationRunRecord): string {
  if (!run.startedAt || !run.endedAt) return '';
  const ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ms >= 1000 ? ` (${(ms / 1000).toFixed(1)}s)` : ` (${ms}ms)`;
}

/** One line per label: the latest run's disposition, earlier runs summarized as
 * superseded — history is summarized, never erased (VER-005 semantics). */
export function verificationMatrixLines(
  runs: VerificationRunRecord[],
  unverifiedConfirmed: boolean,
): string[] {
  if (runs.length === 0) {
    return [
      unverifiedConfirmed
        ? '- ⚠ Unverified — no verification was run; accepted with explicit confirmation (VER-007).'
        : '- ⚠ Unverified — no verification was run for this task (VER-007).',
    ];
  }
  const byLabel = new Map<string, VerificationRunRecord[]>();
  for (const run of runs) {
    const list = byLabel.get(run.label) ?? [];
    list.push(run);
    byLabel.set(run.label, list);
  }
  const lines: string[] = [];
  for (const [label, list] of byLabel) {
    const latest = list[list.length - 1]!;
    const superseded = list.filter((r) => r.supersededBy !== null).length;
    const mark =
      latest.state === 'passed'
        ? '✓'
        : latest.state === 'running'
          ? '…'
          : latest.state === 'cancelled'
            ? '∅'
            : '✗';
    const detail =
      latest.state === 'passed'
        ? 'passed'
        : latest.state === 'failed'
          ? `failed (exit ${latest.exitCode ?? '?'})`
          : latest.state === 'timeout'
            ? 'timed out'
            : latest.state;
    const extras: string[] = [];
    if (superseded > 0) {
      extras.push(`${superseded} earlier run${superseded === 1 ? '' : 's'} superseded`);
    }
    if (latest.stale) extras.push('stale — code changed after this run');
    lines.push(
      `- ${mark} ${label} — ${detail}${durationLabel(latest)}${extras.length > 0 ? ` — ${extras.join('; ')}` : ''}`,
    );
  }
  return lines;
}

export function buildPrDraft(evidence: PrDraftEvidence): PrDraft {
  const branch = prBranchName(evidence);
  const title = evidence.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  const additions = evidence.files.reduce((a, f) => a + f.additions, 0);
  const deletions = evidence.files.reduce((a, f) => a + f.deletions, 0);

  const goal = evidence.goalMd.trim().slice(0, 800) || '_No goal recorded._';
  const acceptanceLines =
    evidence.acceptance.length > 0
      ? evidence.acceptance.map((a) => `- [ ] ${a.replace(/\s+/g, ' ').trim()}`)
      : ['_None recorded._'];
  const fileLines =
    evidence.files.length > 0
      ? evidence.files.map((f) => {
          const rename =
            f.status === 'renamed' && f.renamedFrom ? ` (from \`${f.renamedFrom}\`)` : '';
          return `- \`${f.path}\` — ${STATUS_LABEL[f.status]}${rename}, +${f.additions} −${f.deletions}`;
        })
      : ['_No file changes (answer-only task)._'];

  const body = [
    '## Goal',
    '',
    goal,
    '',
    '**Acceptance criteria**',
    ...acceptanceLines,
    '',
    `## Changes — ${evidence.files.length} file${evidence.files.length === 1 ? '' : 's'}, +${additions} −${deletions}`,
    '',
    ...fileLines,
    '',
    '## Verification',
    '',
    ...verificationMatrixLines(evidence.verification, evidence.unverifiedConfirmed),
    '',
    '## Evidence',
    '',
    ...(evidence.receiptSha256
      ? [
          `- Replay receipt at accept: \`sha256:${evidence.receiptSha256}\` — export the full receipt (HTML+JSON) from the task room in Charter.`,
        ]
      : ['- Replay receipt: available for export from the task room in Charter.']),
    `- Task \`${evidence.taskId}\`, accepted ${evidence.acceptedAt}.`,
    '',
    '---',
    '',
    '_Draft generated by Charter from the task evidence ledger. Push and PR creation are your explicit actions (GIT-007)._',
    '',
  ].join('\n');

  return { branch, title, body };
}

/** Ready-to-paste block. The app never executes these (GIT-007). */
export function buildPrCommands(input: {
  branch: string;
  title: string;
  files: PrDraftEvidence['files'];
  bodyPath: string;
}): string {
  const paths = new Set<string>();
  for (const f of input.files) {
    paths.add(f.path);
    if (f.renamedFrom) paths.add(f.renamedFrom);
  }
  const quoted = [...paths].map(shellQuote).join(' ');
  const lines = [
    `git switch -c ${shellQuote(input.branch)}`,
    ...(paths.size > 0 ? [`git add -A -- ${quoted}`] : []),
    `git commit -m ${shellQuote(input.title)}`,
    `git push -u origin ${shellQuote(input.branch)}`,
    `gh pr create --draft --title ${shellQuote(input.title)} --body-file ${shellQuote(input.bodyPath)}`,
  ];
  return lines.join('\n');
}
