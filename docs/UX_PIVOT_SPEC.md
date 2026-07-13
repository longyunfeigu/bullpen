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

## Notes

- Fast path vs full form: the Home input is the primary path; the existing
  New-Task dialog remains reachable from the Workspace surface for acceptance
  criteria/verification commands ("advanced charter").
- Phase 2 (not in this change): meta-agent drafts acceptance criteria and
  verification commands from the intent for one-tap confirmation; task budgets
  (steps/tokens/time); auto-iterate-until-verification-green loop mode.
