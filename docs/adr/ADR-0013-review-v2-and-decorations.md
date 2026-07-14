# ADR-0013 — Review v2: Monaco side-by-side diff, git decorations, feedback loop

Status: accepted
Date: 2026-07-14
Related: spec §5.4/§13.2 (REV, CHG-005/007/008 — semantics unchanged), PIVOT-024, ADR-0009 (worktrees), E2E-014/015

## Context

Review was a bespoke full-screen list of text hunks: no syntax highlighting, no
side-by-side alignment, no way to navigate large files, and review was a dead
end — feedback required leaving for the composer. Separately, nothing in the
editor surface showed which files the current work touched (no explorer badges,
no tab marks, no gutter bars), although VS Code trained users to expect them.

## Decision

### Review v2 (presentation only — decision semantics untouched)

- The review surface keeps its overlay container, `review-view` test contract
  and open/close flow, but renders: a **Changes list** (A/M/D/R letters, ±
  counts, per-file accept/reject, review state) and a **Monaco DiffEditor**
  (baseline snapshot left, current file right, `diffAlgorithm: 'advanced'`,
  read-only both sides).
- New channel `task.reviewFile` returns both sides from the ChangeService
  (baseline blob + current logical content — never git, exactly the hash-guarded
  records the decisions run against). The diff pane re-fetches when
  `file.currentHash` changes, so hunk rejects (which rewrite the file) stay
  truthful.
- **Hunk strip**: content-derived hunk keys, `hunk-accept/reject-*` testids and
  `task.reviewDecision` payloads are byte-identical to v1 — E2E-014/015 pass
  unmodified. Chips scroll the diff to their hunk.
- **Request fix** (the review→agent loop): selecting lines in the modified pane
  offers "Request fix"; a note dialog sends path + line range + selected code +
  feedback as a steer message (starts a new run from REVIEW_READY) and returns
  to the Task Room.
- Worktree tasks work unchanged: `readLogical` resolves against the task's
  context root (the worktree), so the right side shows the worktree content.

### Git decorations (workspace surface)

- Shared `gitStatusStore` (renderer): one `git.status` snapshot, refreshed by
  the fs watcher (400 ms debounce) and workspace switches.
- Explorer rows: colored filename + status letter (A/M/D/U/R/C); folders with
  changed descendants get a small dot. Home project tree tints file names.
- Tabs: status letter next to the dirty dot.
- Editor gutter: change bars vs the git index (`git.diffFile`) — green added,
  blue modified, red triangle for deletions — recomputed on open, save
  (dirty→clean edge) and status refreshes. Pure diff parsing is unit-tested
  (`gutter-diff.test.ts`).

## Alternatives considered

- Opening review as regular editor diff-tabs (VS Code style) instead of the
  overlay: rejected for V1 — tabs would mix reviewable and normal editors in
  one strip and require a tab-kind model change; the overlay keeps review a
  modal, decision-focused surface (and the existing test contract).
- Buffer-live gutter bars (diff against the in-memory buffer): deferred; bars
  currently refresh on save, which keeps the data source (git index) honest.

## Consequences

- The old hand-rendered hunk list is gone (one review implementation).
- p4-review-v2.spec covers the diff editor, hunk strip decisions, request-fix
  round-trip, explorer/tab letters and gutter bars.
- `review://` in-memory models are disposed per file switch; the diff editor
  itself is reused per pane.
