# ADR-0005 — Home v2, agent visibility and light editing (FanBox-inspired scope)

Date: 2026-07-13
Status: Accepted (product owner selection via in-session review)
Extends: ADR-0004 (dual-form shell)

## Context

After approving the Home v2 layout direction (Codex-style left sidebar + bottom
composer, mockup `docs/design/home-v2-mockup.html`), the product owner reviewed
FanBox (github.com/alchaincyf/fanbox), an "agent box" that wraps an external
CLI agent in a terminal and infers activity by watching the filesystem. The
owner mandated adopting its signature capabilities.

Key architectural observation: FanBox must *infer* agent activity from fs
events; Charter's agent already runs inside structured contracts — every tool
call, hunk, baseline and content hash is recorded (task_events, tool_calls,
file_changes, BlobStore). The same features are therefore cheaper and more
trustworthy here: we render recorded facts instead of guessing.

## Decisions

1. **Home v2 layout** (approved): left sidebar (New Task, Reviews, Projects,
   Tasks; bottom Open IDE workspace / Settings), centered hero, bottom composer
   with project·branch chip, approval policy, model, attach, send.
   **Selecting a project in the sidebar sets the working directory**; it
   persists and the composer always targets it — no per-task folder picking.
   The old New-Task dialog's fields (boundaries, success criteria, verification
   commands) merge into the composer's Advanced expansion.
2. **Theme: follow system** (`prefers-color-scheme`), light + dark palettes for
   Home from day one. A light theme for the Workspace surface is a follow-up
   item so surface switches don't flash mismatched schemes.
3. **Capability set adopted**, phased:
   - **P1 — Home v2 core + attention loop** (PIVOT-011..015): mission-control
     task cards (live current action, "needs you" group), native notifications
     on AWAITING_*/REVIEW_READY/FAILED, drag-and-drop + `@` context feeding,
     clickable file paths in timeline output.
   - **P2 — presence and recall** (PIVOT-016..018): activity glow on project
     rows/file tree driven by change events (with decay, no polling); session
     replay — a timeline scrubber reconstructing per-step file states from
     recorded events/baselines/blobs (read-only); ⌘K global palette over
     projects/tasks/files with project-type badges.
   - **P3 — light editing** (PIVOT-019..020): Notion-style Markdown WYSIWYG
     (editor dependency requires its own ADR before adoption) and an image
     annotation editor (arrows/rect/mosaic) with "attach to task".
4. **Parallel tasks across projects**: currently effectively single-run; the
   multi-project "glow follows the agent" experience needs a worker-concurrency
   investigation. Scheduled as part of P2; if it requires topology changes,
   a separate ADR will record them.
5. **M10–M12 stay release-blocking and unshrunk.** Only ordering relative to
   P1–P3 is variable (product-owner choice; recorded in
   IMPLEMENTATION_STATUS/HANDOFF once made).
6. **Explicitly not adopted** (boundary discipline, mirroring FanBox's own):
   general file manager features, standalone theming engine ("three skins"),
   competing with Finder. Privacy posture adapted for M12 PRIVACY.md: keys
   encrypted locally, zero telemetry, no network egress except configured model
   provider endpoints.
7. **Process rule (standing)**: every user-visible UI change is first shown as
   a high-fidelity mockup under `docs/design/` and confirmed by the product
   owner before renderer code changes; after implementation, screenshots are
   presented for review.

## Consequences

- Scope and timeline grow; the differentiators (exact-content replay, honest
  activity presence) fall out of data we already persist, so marginal cost is
  mostly renderer work plus notification/palette plumbing.
- Review surface gains non-diff renderings later (P3 pairs well with rendered
  Markdown/image previews in review — tracked in the backlog, not committed
  here).
- Acceptance rows PIVOT-011..020 added to `docs/UX_PIVOT_SPEC.md`; each phase
  lands with unit + E2E coverage like every milestone.
