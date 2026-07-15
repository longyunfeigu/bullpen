# Terminal Parallel vNext — Design QA

## Comparison target

- Source visual truth:
  - `docs/design/audit/terminal-vnext-01-bottom.png`
  - `docs/design/audit/terminal-vnext-02-codex-side.png`
  - `docs/design/audit/terminal-vnext-03-new-terminal.png`
  - Interactive source: `docs/design/terminal-parallel-vnext.html`
- Browser-rendered implementation screenshots (Electron Chromium, captured by
  the repository Playwright harness):
  - `docs/design/audit/terminal-vnext-implementation-01-bottom.png`
  - `docs/design/audit/terminal-vnext-implementation-02-codex-side.png`
  - `docs/design/audit/terminal-vnext-implementation-03-new-terminal.png`
- Viewport: 1440 × 900 CSS pixels. The source side screenshot was 1458 × 900
  and was normalized to 1440 × 900 for comparison.
- Theme: the product's light theme and existing design tokens.
- States:
  - Codex and Claude Code are live in different project contexts.
  - Codex is active in the Bottom Panel.
  - Codex occupies the single right focus slot while Claude remains in the
    Bottom Panel list.
  - New Terminal selects Claude Code plus the recent project and displays
    focused, recent, Task/worktree and scratch contexts.

## Visual evidence

Full-view source/implementation comparisons:

- `docs/design/audit/terminal-vnext-qa-full-bottom.png`
- `docs/design/audit/terminal-vnext-qa-full-side.png`
- `docs/design/audit/terminal-vnext-qa-full-modal.png`

Focused region comparisons:

- `docs/design/audit/terminal-vnext-qa-focus-bottom.png`
- `docs/design/audit/terminal-vnext-qa-focus-side.png`
- `docs/design/audit/terminal-vnext-qa-focus-modal.png`

The source side capture contains a prototype transition fade. The stable
implementation state was compared against both that capture and the approved
interactive HTML structure; the fade itself is not a product requirement.
Fixture project names, absolute temporary paths and terminal output are dynamic
content and were not treated as visual drift.

## Findings

No actionable P0, P1 or P2 findings remain.

- Fonts and typography: the implementation preserves the product's existing UI
  and monospace font stacks, weights and small-label hierarchy. Long real paths
  truncate instead of wrapping or changing row height.
- Spacing and layout rhythm: the 260px terminal list, 35px New Terminal row,
  34px session bar, 590px chooser, single 600px side slot and dense row rhythm
  match the approved composition. Production Explorer and Agent Panel widths
  leave less center space than the mock fixture; below 560px the session-bar
  context chip hides cleanly while the same context remains visible in the
  terminal row and tooltip.
- Colors and tokens: the implementation maps the mock's warm neutral surfaces,
  amber live state, green live counter, muted borders and selected fills to the
  existing theme variables. No new independent palette was introduced.
- Image quality and asset fidelity: the feature has no photographic,
  illustrative, logo or generated-image assets. Existing product icons and the
  source's compact terminal/placement symbols remain sharp at device scale.
- Copy and content: Shell, Claude Code, Codex, Focused, Recent Project,
  Isolated, Temporary, Room, Move/Replace and Return labels follow the approved
  terminology. The host-resolution note and same-working-tree warning reflect
  real behavior.
- Responsiveness and accessibility: the panel has no persistent-control
  overflow at the tested viewport; rows and dialog choices are keyboard
  reachable, visible focus styles are retained, the resize separator exposes
  ARIA values and reduced-motion rules disable status animation.

Residual P3 note: the production shell's existing Explorer and Agent Panel are
wider than the prototype's illustrative rails, so the editor canvas and bottom
terminal text area are narrower. The terminal feature responds without overlap
or control loss; changing those global product widths is outside this mock's
scope.

## Comparison history

1. Initial comparison — blocked by P2 bottom-panel clipping.
   - Finding: focusing the mounted xterm scrolled the Bottom Panel layout by
     35px, hiding the session bar and New Terminal row.
   - Fix: made the terminal grid/main pane zero-scroll, minimum-height-safe
     containers and reset the ancestor scroll position after xterm reparenting.
   - Post-fix evidence: `terminal-vnext-qa-full-bottom.png` and
     `terminal-vnext-qa-focus-bottom.png` show both persistent rows visible.
2. Narrow production center column — blocked by P2 responsive truncation.
   - Finding: the session context compressed to one character while preserving
     the higher-priority Room and Move controls.
   - Fix: added a container query that hides only that redundant context chip
     below 560px; the terminal row and title retain the full context.
   - Post-fix evidence: the focused bottom comparison shows a clean, complete
     control row with no clipped text or overlap.
3. State normalization — blocked by P2 comparison-state mismatch.
   - Finding: the first implementation capture had no Task/worktree fixture and
     selected Codex while the approved chooser capture selected Claude Code and
     showed four context kinds.
   - Fix: the visual E2E now creates a real isolated Task worktree, restores the
     intended focused/recent project order and selects Claude Code before
     capture.
   - Post-fix evidence: `terminal-vnext-qa-full-modal.png` and
     `terminal-vnext-qa-focus-modal.png` show the same four-row structure and
     selected state as the source.

## Primary interactions tested

- Open the existing terminal home with Control+backquote without creating a
  duplicate terminal.
- Launch Codex in project A, move editor focus to project B and verify the same
  terminal id and process id survive.
- Launch Claude Code in project B while Codex remains live.
- Move Claude to the side slot, then replace it with Codex in one click and
  verify neither PTY is killed or recreated.
- Return the side terminal to the Bottom Panel and restore the prior Agent Panel
  state.
- Open the split New Terminal chooser, switch launch types and select a recent
  project while focused, recent, Task/worktree and scratch contexts are shown.
- Exercise the live xterm in both dock and side mounts and confirm its output
  and scrollback remain present.

Console errors checked: yes. The final Playwright flow collected renderer
`pageerror` and `console.error` events and asserted an empty list.

## Implementation checklist

- [x] Match the approved terminal-home, side-slot and chooser geometry.
- [x] Preserve real xterm/PTy identity during reparent and atomic swap.
- [x] Keep project/task accounting bound to the terminal's host-resolved
      context across editor focus changes.
- [x] Verify full and focused visual comparisons after each P2 fix.
- [x] Verify keyboard/accessibility affordances and renderer console health.

final result: passed
