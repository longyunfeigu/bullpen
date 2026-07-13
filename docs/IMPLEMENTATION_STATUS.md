# IMPLEMENTATION_STATUS.md

Overall status: IN_PROGRESS  
Current milestone: 7  
Last verified commit: —

## Status legend

- NOT_STARTED
- IN_PROGRESS
- BLOCKED
- DONE
- VERIFIED

## Milestones

| Milestone | Status | Exit evidence | Notes |
| --- | --- | --- | --- |
| 1. Engineering baseline | VERIFIED | E2E m1-baseline (isolation+IPC), 28 unit tests, packaged .app launch smoke, boundary lint | node:sqlite/node-pty/rg strategies in ADR-0003 |
| 2. Shell and persistence | VERIFIED | E2E m2-shell (restart restore), m2-db-failure (safe mode), 10 unit tests (db+settings) | |
| 3. Workspace and editor | VERIFIED | E2E-002/003 pass (m3-editor.spec), 31 unit tests (doc store/workspace/path boundary), 10k-file lazy tree integration test | Data-loss race renderer-guard documented in editorStore |
| 4. Search, LSP, terminal | VERIFIED | E2E-004..007 pass, 6 search unit tests, full E2E suite 12/12 twice | rg via system binary (ADR-0003); python LSP degrades with guidance |
| 5. Git and changes | VERIFIED | E2E-008 + non-git flow, 51 unit tests incl. 34-case rollback matrix | Full 50-case matrix expands at M12 gate run |
| 6. Pi read-only agent | VERIFIED | E2E-009/019-core/HIST-002 (4 E2E), pi adapter contract tests (no-builtin-tools), 141 unit tests total | OAuth providers deferred to API-key flow (ADR pending M12 notes) |
| 7. Tools and permissions | NOT_STARTED | | |
| 8. Agent editing and review | NOT_STARTED | | |
| 9. Verification and history | NOT_STARTED | | |
| 10. Recovery and diagnostics | NOT_STARTED | | |
| 11. Security and quality hardening | NOT_STARTED | | |
| 12. Packaging and Stable release | NOT_STARTED | | |

## Current blockers

None.

## Latest test evidence

| Date | Commit | Command | Result | Artifact |
| --- | --- | --- | --- | --- |

## Requirement exceptions

None. Any exception requires an ADR and product-owner approval.
