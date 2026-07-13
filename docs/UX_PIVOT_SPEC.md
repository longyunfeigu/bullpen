# Charter — Dual-form Shell UX Spec (ADR-0004)

> Shell-layer spec. Supersedes spec §4 layout for entry/branding; everything
> engine-side (state machine, permissions, change/verification, review) is
> unchanged and stays governed by `PRODUCT_ENGINEERING_SPEC.md`.

## Surfaces

```
┌ Home (default entry) ─────────────────────┐   ┌ Workspace (full IDE) ────────┐
│            What should we build?          │   │ Activity bar · editor · agent │
│  [ 📁 project ]                           │⇄ │ panel · terminals · git · ... │
│  [ free-form intent…                    ] │   │ (existing workbench, intact)  │
│  [ approval: Ask/Edit/Auto ] [ model ▾ ]↑ │   │                               │
│  Recent tasks…                            │   │                               │
└───────────────────────────────────────────┘   └───────────────────────────────┘
```

## Acceptance (PIVOT-001..010)

| ID | Requirement |
| --- | --- |
| PIVOT-001 | App launches to Home; no directory is read until the user picks a project. |
| PIVOT-002 | Home has a project selector: recent workspaces + "Open Folder…"; selection opens the workspace (trust flow unchanged). |
| PIVOT-003 | Home has an inline model selector listing configured models (mock model when mock runtime is enabled). |
| PIVOT-004 | Home has an approval selector mapping to task modes with plain labels: Read-only (ask) / Approve changes (edit) / Auto, pause on risk (auto). |
| PIVOT-005 | Submitting the intent creates and starts a task (title derived from the first line ≤ 64 chars, full text as goal) and switches to the Workspace surface with the task open. Empty intent or no project is a guided no-op. |
| PIVOT-006 | Surface switching: opening a workspace auto-switches to Workspace; a persistent title-bar control returns Home; state is not lost either way. |
| PIVOT-007 | Home lists recent tasks (state chip); clicking one opens it in the Workspace surface. |
| PIVOT-008 | No user-visible surface (title, About, welcome, menus, dialogs, agent preamble, trust prompts, error copy) says "Pi". Product name: **Charter**. |
| PIVOT-009 | Settings → Models manages provider credentials (add/replace/delete per provider) and "Fetch models" pulls the live provider list with the stored key; fetched models merge into every model selector; fetch failures surface as readable errors. |
| PIVOT-010 | E2E: Home flow works with the mock runtime end-to-end (pick project → type intent → submit → task reaches REVIEW_READY) and the rebrand assertion holds. |

## Home v2 — agent visibility and light editing (ADR-0005, PIVOT-011..020)

Mockup: `docs/design/home-v2-mockup.html` (states ①–⑥, light/dark).
Phases: P1 = 011..015, P2 = 016..018, P3 = 019..020.

| ID | Requirement |
| --- | --- |
| PIVOT-011 | Home v2 layout per mockup: left sidebar (New Task, Reviews, Projects, Tasks; bottom Open IDE workspace / Settings) + bottom composer (project·branch chip, approval, model, attach, send). Theme follows the system (light + dark). **Selecting a project in the sidebar sets the working directory**, persists across restarts, and the composer targets it — the "Select a project" chip appears only when nothing is selected. |
| PIVOT-012 | Advanced charter in the composer: an Advanced toggle expands boundaries, success criteria and verification-command fields (suggestions + custom); Simple⇄Advanced preserves typed input. Sidebar "New Task" focuses the composer in Advanced mode. |
| PIVOT-013 | Mission control: below the composer, running tasks show their live current action (latest tool/plan step) and tasks in AWAITING_PLAN_APPROVAL / awaiting-permission / REVIEW_READY surface first as a "Needs you" group; one click jumps to the task. |
| PIVOT-014 | Native (macOS) notifications when a task enters AWAITING_PLAN_APPROVAL, waits on a permission request, reaches REVIEW_READY, or FAILED; clicking focuses the task; a Settings toggle disables them. No notification spam: one per state transition. |
| PIVOT-015 | Context feeding: dragging files/folders onto the composer inserts path reference chips included in the task goal; `@` opens a file picker over the selected project; file paths in timeline/report cards are clickable and open in the editor (workspace surface). |
| PIVOT-016 | Activity presence: project rows (Home) and file-tree nodes (Workspace) glow when the agent writes, driven by change events (never fs polling), decaying within seconds; multiple concurrent tasks show glow per project (worker-concurrency investigation is part of this item). |
| PIVOT-017 | Session replay: task detail/review offers a timeline scrubber that reconstructs per-step file states from recorded events, baselines and blobs; strictly read-only (never mutates the working tree); handles 100+ step tasks. |
| PIVOT-018 | ⌘K palette: global, keyboard-only operable search over projects, recent tasks and files of the selected project, with project-type badges (node/web/py/…); Esc closes, ⏎ opens. |
| PIVOT-019 | Light edit — Markdown: Notion-style WYSIWYG for `.md` with the same dirty-guard/conflict semantics as the Monaco path (editor dependency requires its own ADR before adoption). |
| PIVOT-020 | Light edit — images: annotation editor (arrows, rectangles, mosaic/redaction) that saves a copy (never overwrites the original in place without an explicit action) and offers "attach to task". |

## Notes

- Fast path vs full form: the Home input is the primary path; the Workspace
  surface keeps its New-Task dialog until PIVOT-012 lands, after which the
  composer's Advanced mode is the canonical full form.
- Phase 2 (unchanged, from ADR-0004): meta-agent drafts acceptance criteria and
  verification commands from the intent for one-tap confirmation; task budgets
  (steps/tokens/time); auto-iterate-until-verification-green loop mode.
