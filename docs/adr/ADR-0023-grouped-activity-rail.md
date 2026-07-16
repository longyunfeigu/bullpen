# ADR-0023 — Session Rail direction D: grouped activity rail

Status: accepted
Date: 2026-07-16
Related: docs/design/sidebar-vnext-gallery.html (direction study A/B/C/D),
docs/design/sidebar-vnext-hybrid.html (approved direction D),
ADR-0009 (persistent shell, PIVOT-028), ADR-0014 (room zoom continuum),
PIVOT-011/013/018/027

## Context

The Session Rail shipped as one flat column: a Sessions header with the New
Session split button, a flat list of task + external-terminal rows, an inline
"Project" section (recents, lazy tree, open folder / new project) and a footer
(Inbox jump / Workspace / Settings). It works at one project and a handful of
sessions; it degrades as either dimension grows:

- Sessions from different projects interleave — every row must repeat its
  project name, and there is no way to fold a project you are not working in.
- Settled sessions (accepted / rolled back / cancelled) sit in the same list as
  live work until archived, competing for attention they no longer deserve.
- "Inbox" is a footer button that jumps to the *first* attention task — there
  is no place to *see* the queue.
- Projects consume permanent vertical space that belongs to sessions, yet the
  rail still has no room for future destinations (search, boards, …).

Four directions were mocked against the same session set
(`docs/design/sidebar-vnext-{focus,grouped,activity,hybrid}.html` behind one
gallery). The product owner reviewed them and picked **D — Grouped Activity**:
direction C's dual-rail shell (icon activity bar + one context panel, the
long-term extension point) with direction B's project-grouping mental model
absorbed into the sessions panel.

## Decision

`SessionRail` becomes a dual rail: a 46px **activity bar** — Sessions, Inbox
(badged), Projects, Search, then Editor and Settings at the bottom — driving a
single **context panel**. Concretely:

1. **Sessions panel (default).** Sessions group by project, collapsible, with
   a tree indent. Group headers carry an amber "N need you" badge and a count,
   so a collapsed group never hides that it wants a decision. Rows inside a
   group drop the redundant project name (branch stays). Order inside a group
   remains newest-first — attention is surfaced by badges and the Inbox, not
   by resorting rows under the user's cursor (deliberate deviation from the
   mock, which sorted review-first; spatial stability wins, and `.first()`
   row-order test contracts keep meaning "most recent").
2. **History group.** Settled sessions (`ACCEPTED` / `ROLLED_BACK` /
   `CANCELLED`) leave their project group for a cross-project History group,
   default-collapsed, rows keeping their project name. Attention states
   (`FAILED`, `INTERRUPTED`, review-ready) never move there. The open room's
   group auto-expands when the selection lands in a collapsed group — accepting
   a task moves its row to History *and* keeps it visible while its room is
   open. Manual collapses are respected until the selection or its group
   changes.
3. **Needs-you row ⇄ Inbox destination are one queue.** When any session needs
   the user, an amber "Needs you · N" row is pinned above the groups; clicking
   it (or the badged activity-bar Inbox) opens the **Inbox panel**: the triage
   list of exactly the attention sessions, each row routing to its room.
   *PIVOT-013r2 (revision):* the Inbox control opens the triage panel; the
   task's room is one click from there (was: blind-jump to the first task).
4. **Projects panel.** Recents (active row expands the lazy tree in place),
   Open folder…, New project… move here from the inline section. Switching to
   a *different* project completes the errand and returns the rail to the
   sessions panel; toggling the active project's tree stays.
   *PIVOT-011r/027r (navigation revision):* selecting/browsing projects happens
   in the rail's Projects panel; behavior (set working directory, persist,
   tree, file opens) is unchanged.
5. **Working-context footer.** The sessions panel ends with a resident row
   naming the focused project (what new sessions bind to); "Change" routes to
   the Projects panel.
6. **Search.** The fourth activity button opens the existing ⌘K quick launcher
   (PIVOT-018) — search is a command surface, not a panel.
7. **Editor / Settings** live at the activity bar's bottom (same handlers,
   same testids; ⌘E unchanged). User-visible copy says **Editor** per the
   naming rule in UX_PIVOT_SPEC.
8. **Selection language** absorbed from direction B: inset accent bar + tinted
   fill. ⌘1-9 / ⌘[ ⌘] keyboard order mirrors the visual order (groups
   flattened, History last).

Grouping is by project *display name* (tasks carry paths, external terminals
only names); collapsed-group state persists in renderer `localStorage`
(cosmetic UI state — deliberately not added to the `LayoutState` IPC schema).

## Testid contract

Every pre-existing testid keeps its meaning (`home-sidebar`, `home-new-task`,
`session-new-menu`, `home-task-*`, `home-archive-*`, `session-terminal-*`,
`home-recent-*`, `home-open-folder`, `home-new-project`, `home-reviews`,
`home-open-ide`, `home-settings`). New: `rail-view-sessions`,
`rail-view-projects`, `rail-search`, `rail-needs-you`, `rail-inbox-panel`,
`rail-projects-panel`, `rail-group-<name>` / `rail-group-history`,
`rail-context`. Restored: `home-task-ticker-*` on running rows — the shell-v4
heartbeat contract that was lost when `HomeSidebar` was superseded by
`SessionRail`. Spec updates are navigation-only (open the Projects panel before
clicking a recent; click through the Inbox panel to the room); no assertion was
weakened.

## Consequences and honest limits

- Two projects with the same directory basename merge into one visual group
  (rows and rooms still disambiguate); acceptable for a display-level rail.
- History shows at most what the rail's existing 20-task window admits; the
  full archive remains behind task history, not the rail.
- Collapsed-group state is per-machine renderer storage, not part of
  `layout.save`; it resets with cleared web storage, never loses data.
- The old footer rows are gone; Inbox gained a real destination, Editor and
  Settings became icons — copy moved into tooltips/aria-labels.
