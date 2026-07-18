# ADR-0024: Room context feeding parity — persistent Files pane, unified file-reference chips, task-attachment images

- Status: Accepted (user decision 2026-07-18, mockup `docs/design/context-attach-mockups/bd-fusion.html`)
- Relates to: PIVOT-015 (context feeding), PIVOT-020 (image annotation attach), ADR-0014 (session shell), ADR-0022 (preview images rail), spec §IDE 集成 "显式上下文附件注入"
- Supersedes in part: the "no second Explorer inside the Session view" working constraint recorded in `docs/design/code-context-ref-mockups/design-qa.md`

## Context

PIVOT-015 context feeding shipped on the **Home** surface: `HomeProjectTree` rows are
draggable (`views/dragRefs.ts`, MIME `application/x-charter-ref`, folders carry a
trailing `/`), the Home composer accepts OS file drops (`pathForDroppedFile` →
`workspace.relativize`) and renders removable path chips.

The **Session/Room view** — where users actually spend follow-up time — has none of
that surface: no visible file tree, no OS drop handling (`TaskRoomView` `dragHandlers`
accept only the internal MIME), and references land as inline `@path` prose
(`insertRef`, TaskRoomView.tsx) instead of chips, a second UX pattern coexisting with
Home's chips. Generic image attachment does not exist anywhere (only ADR-0022 preview
screenshots). Users cannot drag a file, folder or design screenshot into a running
conversation.

Five interactive mockups were built and reviewed in the browser
(`docs/design/context-attach-mockups/`); the user picked **B+D**: persistent
Sessions/Files rail tabs (plan B) + plan D's landing mechanics.

## Decision

1. **Session rail gains `Sessions | Files` tabs.** The Files pane is a persistent
   project tree for the session's project, reusing the Home tree implementation
   (draggable rows via `dragRefs`, hover quick-add, session changed-file badges).
   A search field routes to `search.files` and returns flat draggable results.
   While the Files pane is active, the Sessions tab shows an attention dot when any
   session needs the user. This *revises* the earlier "no second Explorer in the
   Session view" constraint, narrowly: the Files pane is a rail panel (a drag
   source), not a second Activity Bar, editor surface or Explorer clone; the Editor
   surface keeps the canonical `ExplorerView`.

2. **Unified file references, chips only.** File / folder / image references are a
   new draft-scoped collection (`fileRefs`) beside `codeRefs`/`terminalRefs`/
   `previewRefs`. In the Room, the `@` picker and tree drags now land as removable
   chips above the input (same visual rail as `CodeContextAttachments`); the Room
   stops inserting inline `@path` prose. Home's chip behavior is unchanged.

3. **OS drop parity + whole-column target.** The Room conversation column (composer
   included) is one depth-tracked drop target. Internal tree payloads add path refs;
   OS drops resolve via `pathForDroppedFile` → `workspace.relativize`: in-project
   files/folders become path refs, out-of-project images are imported as task
   attachments, and out-of-project non-image files are rejected with an explanatory
   toast (phase-1 limit, see Consequences).

4. **Task-attachment images.** A new versioned IPC channel `task.attachments.import`
   copies an external image (by absolute path, or by bytes for clipboard paste) into
   the existing per-task store `workspaceDataDir/attachments/<taskId>/` (same root as
   ADR-0022 preview screenshots; never inside the project tree), enforcing size/MIME
   caps and returning `{attachmentId, name, mimeType, size, thumbDataUrl}` (thumbnail
   via `nativeImage`). Pasting an image into the Room composer creates such a ref.

5. **Send pipeline.** `task.message` (and follow-up task creation) carries
   `fileRefs` alongside `codeRefs`. In `task-service`, refs are (a) recorded on the
   `user.message` event payload for timeline rendering, (b) formatted into the prompt
   as an explicit `<file_context>` data block (same anti-injection framing as
   `formatPromptWithCodeContext`), and (c) image refs are resolved to `PromptImage`
   bytes (from the attachments store, or from the project tree for in-project images)
   and ride the existing `images` parameter (ADR-0022 rail) on
   `host.steer`/`followUp`/`StartRunInput`. The timeline renders sent refs as
   read-only chips (pattern of `SentCodeContext`).

6. **Caps** (mirroring the codeRefs precedent): ≤ 12 file refs per message; ≤ 4
   image refs per message; imported image ≤ 10 MiB; folder refs carry the path only
   (no recursive inlining — the agent lists contents itself through the Tool
   Gateway).

## Alternatives considered

- **D "composer drawer"** (on-demand tree popover): rejected by the user — the felt
  need is *persistent* visibility of project files while conversing.
- **E inline rich tokens** (mention tokens inside the sentence): deferred —
  contenteditable × CJK IME atomic-token editing is high-risk for low incremental
  value while `@` exists.
- **Pinned project context / Context tab** (mock C): deliberately split into a
  future ADR; introduces a persistence + injection scope concept that must not
  block parity work.

## Consequences

- Two UX patterns collapse into one (chips); message text no longer smuggles
  references, they are structured and replayable.
- Out-of-project **non-image** files are *not* attachable in phase 1. Supporting
  them requires granting the agent read access to `attachments/<taskId>/` through
  the Tool Gateway (a permission-boundary change) — deliberately deferred; the
  target semantics are sketched here so the follow-up ADR only decides the boundary.
- The attachments store grows with imported images; HIST-005 deletion/retention
  already covers `attachments/<taskId>/`.
- `task.message` schema bumps its channel version (additive optional field, strict
  schema).
- Security: import validates MIME/size, generates a fresh attachment id, resolves
  symlinks and rejects path escapes; nothing is ever written into the project tree;
  image bytes only flow renderer→main by explicit user action (paste), otherwise
  main reads from disk. The agent gains no new filesystem scope in phase 1.

## Verification

- Unit: draftStore fileRefs (dedupe/caps), import service (size/MIME/path-escape,
  thumbnail), prompt formatter block, relativize routing (in/out of project).
- E2E: Room drag from Files pane → chip → send → timeline chip (mirrors
  `home-dragref.spec.ts`); OS-drop simulation at the handler seam; paste-image path.
- Screenshot re-check against `bd-fusion.html` states (workflow: mockup → implement
  → screenshot).
