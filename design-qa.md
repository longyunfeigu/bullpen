# Unified Session Canvas — Design QA

## Comparison target

- Source visual truths:
  - `/Users/edy/.codex/generated_images/019f6dd2-efed-7192-8c25-8f0354b55d93/exec-1cfca054-d647-4bf0-88d9-2576809d4d68.png` — persistent Session shell.
  - `/Users/edy/.codex/generated_images/019f6dd2-efed-7192-8c25-8f0354b55d93/exec-c1c556a8-07b7-4365-8efc-5b3a70e831f0.png` — tool/code-expanded state.
  - `/Users/edy/.codex/generated_images/019f6dd2-efed-7192-8c25-8f0354b55d93/exec-fea62e94-43e2-4833-a959-023093980346.png` — evidence-first Review state.
- Implementation screenshots captured from the real Electron renderer:
  - `/tmp/charter-session-canvas/launcher-1440.png`
  - `/tmp/charter-session-canvas/agent-picker-1440.png`
  - `/tmp/charter-session-canvas/review-1440.png`
  - `/tmp/charter-session-canvas/diff-zoom-1440.png`
  - `/tmp/charter-session-canvas/diff-zoom-900.png`
  - `/tmp/charter-session-canvas/claude-session-1440.png`
- Viewport: 1440 × 900 CSS pixels; responsive validation at 900 × 900.
- Theme: Studio light, using the existing Charter tokens and icon system.
- States: shared Agent Picker open, managed Session ready for review, balanced
  evidence ledger, expanded Diff tool, narrow reordered canvas, and preserved
  Claude native PTY Session. The existing multi-terminal manager is also
  preserved as a Session-owned Terminal state rather than a second IDE shell.
  Before a Session exists, Files, Search, Changes, the editor, and Problems are
  available as Project Tool content states inside the same persistent shell.

## Visual evidence

- Full-view Review source/implementation comparison:
  `/tmp/charter-session-canvas/design-qa-review-comparison.png`
- Focused collaboration-plus-Diff comparison:
  `/tmp/charter-session-canvas/design-qa-diff-focus-comparison.png`

Both comparison images normalize the source and implementation to 1440 × 900
before stacking them in one input. Fixture project names, one-file mock output
and verification counts are dynamic data and were not treated as design drift.

## Findings

No actionable P0, P1 or P2 findings remain.

- Fonts and typography: the existing Charter UI/monospace stacks are retained,
  with a serif Session title and compact metadata hierarchy matching the source
  direction. Titles and project paths truncate instead of changing track size.
- Spacing and layout rhythm: the implementation has one 210px persistent rail,
  a balanced 56/44 collaboration/tool split, a 38/62 expanded-tool state, one
  bottom Action Dock, and consistent small-radius cards. The source's three
  stable regions remain visually legible without the former nested Activity
  Bar, global Sidebar, or Agent Panel shell. Project diagnostics use a local
  lower panel inside Project Tools instead of restoring global workspace chrome.
- Colors and tokens: warm Studio neutrals, green completion states, amber Needs
  You attention, blue selection, and red/green diff semantics map to existing
  product variables. No new independent theme or decorative gradient was added.
- Image quality and asset fidelity: these application screens contain no
  photographic or illustrative assets. Existing provider marks and product
  icons are reused and remain sharp; no placeholder imagery, custom SVG art,
  CSS art, emoji, or generated substitute asset was introduced.
- Copy and content: the primary user object is consistently Session. Internal
  mock scenario directives no longer leak into titles or transcripts, Replay is
  secondary under More, and review-ready copy asks for changes or context rather
  than claiming it starts another run.
- States and interactions: Summary, Diff, Preview, Terminal, and Review are
  states of the same tool canvas. Review becomes the default at review-ready but
  remains user-switchable. File Peek expands in place and the single Action Dock
  retains accept, rollback, request-changes/resume, stop, and completion states.
  Control+backquote opens the mature multi-terminal manager inside the same
  persistent Session shell; live PTYs, promotion, resizing, return-to-dock, and
  external-session accounting remain intact. A zero-change answer stays on
  Summary instead of showing an empty Review, and rollback retires the active
  Review state as soon as its change set is gone.
- Responsiveness and accessibility: at 900px the rail compresses to 210px and
  the center/tool tracks reorder vertically at full available width. There is no
  global horizontal overflow or hidden persistent decision control. Tabs use
  tab semantics, menus/dialogs retain accessible labels, buttons remain keyboard
  reachable, and reduced-motion removes layout transitions.

Residual P3: the reference screens use richer multi-file and CI fixtures, while
the deterministic Electron fixture changes one file with no configured checks.
This leaves more white space in the final capture but does not change hierarchy,
layout, or interaction behavior.

## Comparison history

1. Initial Review pass — blocked by P1 interaction/copy ambiguity.
   - Finding: the review-ready Composer said a reply would start another run,
     while the decision was duplicated between the old review bar and side card.
   - Fix: moved all decisions into one responsive Action Dock and changed the
     Composer prompt to “Request changes or add review context…”.
   - Post-fix evidence: `review-1440.png` and
     `design-qa-review-comparison.png` show one decision surface.
2. Initial production-data pass — blocked by P2 internal vocabulary leakage.
   - Finding: `[scenario:edit-basic]` and provider id `mock` were visible as
     product content.
   - Fix: strip mock-runner directives at the transcript presentation boundary,
     sanitize the Session title, and map the mock provider to Charter.
   - Post-fix evidence: `review-1440.png` contains the clean Session title and
     transcript plus the Charter identity chip.
3. Initial 900px pass — blocked by P2 responsive instability.
   - Finding: the first capture measured the center and tool columns during a
     width transition, leaving each narrower than the available canvas.
   - Fix: disable track-width transitions below 1120px and explicitly set both
     reordered regions to 100% width.
   - Post-fix evidence: `diff-zoom-900.png`; the Electron test also asserts both
     regions equal the body width and global overflow is at most one pixel.
4. Tool-state pass — blocked by P2 state lock-in.
   - Finding: the automatic Review default effect re-ran after every store
     update, preventing the user from switching back to Summary.
   - Fix: apply the Review default only when Session id/state crosses the
     review-ready boundary.
   - Post-fix evidence: the final E2E switches Review → Summary → Review before
     opening Diff and expanding the tool canvas.
5. Full-regression pass — blocked by P1 terminal shortcut regression.
   - Finding: Control+backquote still created a shell PTY, but the removed legacy
     workspace shell meant that PTY no longer had a visible host.
   - Fix: mounted the existing Terminal Parallel manager and promoted external
     panel as a Session-owned Terminal view, including the single-terminal
     auto-collapse rule and a stacked narrow layout. No PTY/session behavior was
     reimplemented or discarded.
   - Post-fix evidence: all five `external-cli.spec.ts` scenarios cover live
     xterm input, multi-agent switching, panel promotion/resize, return to dock,
   native-installer detection, durable review, and resume/restart behavior.
6. Project-capability pass — blocked by P1 access regression.
   - Finding: removing the legacy workspace shell also hid arbitrary file
     editing, Search/Replace, Git Changes, TypeScript Problems, split editors,
     and conflict handling before a Session existed.
   - Fix: added `ProjectToolView`, which mounts those mature tools as contextual
     content beside the same global Session Rail. Problems open in a local
     lower panel; terminal commands open a Terminal Session. No second Activity
     Bar, global Sidebar, or Agent Panel was restored.
   - Post-fix evidence: M3 editor, M4 search/LSP/terminal, and M5 Git Electron
     suites pass against the unified shell.
7. Final accessibility/regression pass — blocked by P2 keyboard focus and stale
   product contracts.
   - Finding: historical plan disclosure lacked a visible programmatic/keyboard
     focus outline, while several E2E cases still required deleted Live Board,
     report-card, creation-dialog, or Full workspace controls.
   - Fix: restored the plan disclosure focus ring and migrated those contracts
     to the Session ledger, Agent Picker, Review Checks, Project Tools, and one
     Action Dock. The superseded sidebar mock is explicitly gated out.
   - Post-fix evidence: the complete Electron suite passes with only manual or
     environment-gated scenarios skipped.

## Primary interactions tested

- Open the single Composer Agent Picker and select Charter, Claude, or Codex.
- Create a managed auto-mode Session and run it through plan, file write, final
  report, evidence-first Review, Diff, and expanded tool states.
- Switch Summary and Review without losing the Session or conversation.
- Open a changed file in File Peek while the timeline remains mounted.
- Reorder the same canvas at 900px and verify no horizontal overflow.
- Accept unverified changes from the single Action Dock and remain in the same
  persistent Session shell.
- Dispatch Claude from the same Composer into a real preserved PTY and verify
  its Session row, working directory, and global rail remain present.
- Open a plain shell with Control+backquote, launch/switch external agents,
  promote and resize a live terminal, return it to the dock, and resume ended or
  interrupted Claude Sessions without restoring the old global Agent Panel.
- Open Project Files, Search, Changes, split editor, TypeScript Problems, and a
  plain terminal before a Session exists without changing the global shell.

Console errors checked: yes. The final Playwright flow collected renderer
`pageerror` and `console.error` events and asserted an empty list.

## Implementation checklist

- [x] Keep one persistent Session Rail as the only global navigation.
- [x] Merge managed and native agents into one Composer Agent Picker.
- [x] Make files, Diff, Preview, Terminal, Summary, and Review Session-owned
      tool states.
- [x] Preserve the existing live multi-terminal/Claude/Codex manager inside the
      Session-owned Terminal state, including PTY identity and promotion.
- [x] Preserve editor, Search/Replace, Git, Problems, split/conflict handling,
      and Quick Open as Project Tool states before a Session exists.
- [x] Remove the runtime Full workspace Activity Bar/Sidebar/Agent Panel shell.
- [x] Use one responsive Action Dock for all review and execution decisions.
- [x] Demote Replay and remove default Live Board waveform/heat presentation.
- [x] Restore execution presence without restoring dashboard noise: the Summary
      shows an event-driven Live activity band, fresh current action/path/time,
      recent file-write pulses, and a direct live-file → Diff interaction.
- [x] Verify desktop, narrow, managed-agent, native-agent, tool zoom, and accept
      paths in the production Electron renderer.

final result: passed

---

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

---

# Session Rail Workbench Production — Design QA

## Comparison target

- Source visual truth: `/Users/edy/.codex/generated_images/019f68a6-81e9-7783-8ddf-35ffd5e32238/exec-fa30f18e-7158-4ec4-bc28-0fc4a7b7fd80.png`
- Production implementation: `apps/desktop-renderer/src/views/SessionRail.tsx`,
  `apps/desktop-renderer/src/views/SessionTerminalView.tsx` and the resident
  Home/Task Room/Workbench surfaces.
- Native comparison viewport: 1440 × 1024 CSS pixels; responsive validation:
  1180 × 820 CSS pixels.
- Capture method: the repository Playwright Electron launcher with an isolated
  Git fixture and temporary user-data directory. This is the product's real
  renderer and PTY integration, not the in-app Browser.

## Visual evidence

- Codex-style entry: `/tmp/session-workbench-production-entry.png`
- Pi review plus live edit: `/tmp/session-workbench-production.png`
- Session type chooser: `/tmp/session-workbench-production-modal.png`
- Narrow state: `/tmp/session-workbench-production-narrow.png`
- Same-input full comparison: `/tmp/session-workbench-production-comparison-final.png`
- Old Tasks density versus production Sessions:
  `/tmp/session-workbench-rail-comparison-final.png`
- Original Composer versus production Composer:
  `/tmp/session-workbench-entry-comparison-final.png`

The source and production capture were combined into the same comparison
inputs and opened at original detail. No actionable P0, P1 or P2 visual issue
remains.

## Findings

- Entry hierarchy: New Session now returns directly to the existing “What
  should we build?” Composer. Pi/Claude/Codex selection is a secondary split
  action, so the Session shell does not replace the product's primary task
  entry.
- Session density: rows use the previous Tasks list's compact rhythm. Project
  and branch share one metadata line, state stays scannable at the right edge,
  and unselected rows do not become dashboard cards.
- Terminology: the recent-folder domain section is labeled Project. Workspace
  remains only the name of the full editor surface in the footer.
- Layout: the permanent Session rail, continuous Pi surface, resident editor
  and review Composer preserve the reference's workbench geometry while using
  the application's existing title bar and design tokens.
- Typography and colors: existing Charter UI tokens remain authoritative;
  provider marks and semantic live/review states stay distinct across all four
  application backgrounds.
- Assets: existing product icons and provider marks are reused; no substitute
  illustration, handcrafted SVG or placeholder asset was introduced.
- Responsiveness: at 1180 × 820 session titles truncate before state labels,
  the review card and reply Composer stay visible, and the editor remains
  usable without horizontal control overlap.
- Accessibility and health: the split New Session controls have distinct
  accessible names, the chooser exposes dialog semantics, keyboard session
  switching remains intact, and the Electron flow asserted zero renderer
  `pageerror` or `console.error` events.

## Comparison history

1. The first production pass used 112px Session cards and made the rail feel
   like a second dashboard. It also opened the provider chooser as the primary
   New Session action and labeled the recent-folder section Workspace.
2. The final pass reduced rows to a 74px list rhythm, merged project/branch
   metadata, made the task Composer the direct entry, moved provider choice to
   the split menu and renamed the section Project.
3. Same-input comparison confirmed that the core rail/main/editor/review
   composition matches the selected workbench direction while restoring the
   existing product's original Composer and Tasks information density.

## Primary interactions tested

- Enter the original task Composer directly from New Session.
- Open the secondary chooser and select Pi, Claude or Codex.
- Run a multi-step Pi task to review-ready state.
- Open a changed file in the real resident Monaco editor without ending the
  session.
- Move to the full Workspace and return to the same task, file peek and draft.
- Keep real external PTY sessions visible and resumable in the Session rail.
- Switch sessions with Command+[ / Command+] and direct number shortcuts.

Intentional P3 deviations: the production capture uses Charter's real host
title bar, fixture paths and actual application copy rather than the mock's
illustrative window title and sample repository. These preserve product truth
without changing the selected interaction model.

final result: passed

---

# Session Rail Workbench Mock — Design QA

## Comparison target

- Source visual truth: `/Users/edy/.codex/generated_images/019f68a6-81e9-7783-8ddf-35ffd5e32238/exec-fa30f18e-7158-4ec4-bc28-0fc4a7b7fd80.png`
- Implementation: `docs/design/session-rail-workbench.html`
- Native comparison viewport: 1440 × 1024 CSS pixels.
- Captured state: `?clean=1&step=7`, with the Pi session selected and ready
  for review while Claude and Codex remain live in the rail.
- Capture method: the repository Playwright Electron harness with an isolated
  temporary user-data directory. The project AGENTS.md explicitly requires
  Electron Playwright instead of the in-app Browser for Charter UI validation.

## Visual evidence

- Latest implementation: `/tmp/session-rail-workbench-pi-ready.png`
- Same-input full comparison: `/tmp/session-rail-workbench-comparison.png`
- Same-input top-region comparison: `/tmp/session-rail-workbench-focused-top.png`
- Claude plus Markdown state: `/tmp/session-rail-workbench-claude-markdown.png`
- Split PTY state: `/tmp/session-rail-workbench-split.png`
- New Session modal: `/tmp/session-rail-workbench-new-session.png`
- Narrow state at 1180 × 820: `/tmp/session-rail-workbench-narrow.png`

The source and latest implementation were both opened and inspected at the
same normalized viewport. No actionable P0, P1 or P2 visual finding remains.

## Findings

- Typography: the mock preserves the reference's compact system UI hierarchy,
  with a restrained monospace stack for paths, terminal output and diffs.
- Layout: the centered window title, persistent 210px session rail, two-row
  shell header, main work surface, bottom changes pane and status bar preserve
  the reference composition and information priority.
- Session rail: Claude, Codex and Pi remain independently visible with live,
  paused and ready-for-review states; switching sessions does not collapse the
  user's mental model into Home versus Editor.
- Main surface: Pi keeps its structured, multi-run execution timeline and
  review card. Claude and Codex keep terminal-native PTY surfaces rather than
  being forced into Pi's task-log grammar.
- Tools: code editing, Markdown editing/preview, Changes, Tests and Agent Log
  stay in the same workbench and can coexist with a running session.
- Colors: the true-white/cool-gray shell, cobalt selection, purple Pi, orange
  Claude, green Codex and semantic success/error colors match the selected
  reference direction.
- Assets: this desktop workbench has no photographic or illustrative assets;
  provider monograms and controls are rendered from product UI primitives and
  remain sharp at device scale.
- Copy above the fold: labels follow the selected visual truth. The final clean
  capture removes exploratory labels such as “Session-first prototype” and
  uses the reference-like ellipsis action in the header.
- Responsiveness: at 1180 × 820 the review card and composer remain visible;
  the guided cursor scrolls its target into view instead of covering or
  clipping the primary action.
- Accessibility and console health: buttons and session rows are keyboard
  reachable, focus is visible, dialog semantics are present, reduced motion is
  respected, and the Electron test asserted zero page errors and zero
  `console.error` events.

## Comparison history

1. Initial comparison found a missing global window bar, undersized session
   rows, an overly compressed Pi timeline and missing background-session
   context in the tool pane.
2. The mock added the reference's four-row shell geometry, restored session
   row height and timeline rhythm, added the background Claude notice and file
   breadcrumb, and limited the default Pi tool tabs to the useful code and
   preview surfaces.
3. The final comparison removed invented top-right copy, replaced the visible
   Tools label with the reference-like overflow action, fixed split-terminal
   contrast and centered guided-tour targets at the narrow viewport.

## Primary interactions tested

- Switch among Pi, Claude and Codex without losing each session's native state.
- Open Claude's terminal plus Markdown surface and Codex's live test terminal.
- Restore Pi's ready-for-review state after visiting external PTY sessions.
- Open New Session and choose Pi, Claude or Codex.
- Split Claude and Codex into a side-by-side terminal work surface.
- Use Previous/Next session shortcuts and Meta+1–4 direct selection.
- Send a Pi follow-up to start Run 4.
- Step through, replay and autoplay the nine-stage product journey.
- Verify the clean 1440 × 1024 state and the 1180 × 820 responsive state.

Intentional P3 deviations: macOS traffic lights are treated as host window
chrome, and the interactive tour controls are hidden in clean comparison mode.
Neither deviation changes the product workflow or the approved workbench
geometry.

final result: passed
