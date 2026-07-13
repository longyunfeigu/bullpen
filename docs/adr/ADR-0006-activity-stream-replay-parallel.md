# ADR-0006 — Activity stream, action-centric replay, and parallel runs

Date: 2026-07-13
Status: Accepted (product owner delegated final authority for Home v2 scope)
Extends: ADR-0005 (capability set), ADR-0002 (process topology)

## Context

PIVOT-013/016/017 need a product-grade "what is the agent doing right now"
surface and an action-centric replay ("what did the agent DO" — the agent is
not necessarily a coding agent; messages, questions, commands and searches are
first-class actions, not just file edits).

Audit of the existing engine shows the data layer already records everything
required, immutably:

- `task_events` — per-task monotonic `sequence`; every meaningful action is
  already an event (`user.message`, `agent.message`, `agent.question`,
  `permission.requested/decided`, `tool.call` (terminal, with input/summary/risk),
  `agent.planProposed/planUpdated`, `user.planEdited/planDecision`,
  `verification.started/completed`, `review.decision`, `task.stateChanged`,
  `run.completed/failed/aborted`, `report.final`, `system.*`). Every insert is
  broadcast to all renderer windows as `task.event` — for **all** tasks, not
  just the focused one.
- `tool_calls` — started_at/ended_at per call (durations).
- `file_changes` (ChangeService repo) — **per-change unified patch text**,
  before/after hashes, `toolCallId` linkage, author, kind.

## Decisions

1. **No new source-of-truth tables.** The activity stream and replay are pure
   projections of the records above. Recording twice would eventually disagree
   with itself; a projection cannot.

2. **`projectActivity` is a pure, shared function** in
   `packages/ipc-contracts/src/activity.ts`: `TimelineEventDto → ActivityItem | null`
   (plus a batch variant). `ActivityItem = { key, sequence, at, kind, label,
   detail?, status, paths, toolName?, callId?, diffstat? }` with
   `kind ∈ message | question | answer | plan | plan-decision | read | search |
   command | write | permission | verification | state | report | system | user`.
   Tool calls map to semantic kinds by tool name (write tools → `write` with
   paths; run_command → `command`; read_file/list_dir → `read`; search → `search`).
   Used by BOTH the live dashboard (renderer projects incoming `task.event`
   broadcasts) and replay (main projects the persisted log) — live and replay
   can never drift apart. Unit-tested exhaustively.

3. **Live "current action" needs a start signal**: terminal `tool.call` events
   exist only when a call ends. The gateway audit callback already fires at
   call start; `persistToolAudit` now ALSO broadcasts non-terminal states as an
   **ephemeral** `task.event` (`sequence: 0`, same pattern as the existing
   `agent.toolProposed`), so "running `npm test`…" appears the moment it starts
   and is replaced by the persisted terminal event. Ephemeral events are never
   persisted; replay remains projection-of-log only.

4. **Hydration + replay IPC**: `task.activity { taskId, tail? }` returns the
   projected `ActivityItem[]` (optionally only the last N), enriched main-side
   with durations (`tool_calls`) and per-change diffstat/paths (`file_changes`).
   `task.changeRecord { taskId, changeId }` returns one stored change (patch
   text, hashes) for the replay diff pane. Replay is strictly read-only.

5. **Notifications** (`notification-service.ts`, main): on task state edges
   → AWAITING_PLAN_APPROVAL, AWAITING_PERMISSION, REVIEW_READY, FAILED.
   Electron `Notification`, suppressed while a window is focused, deduped per
   (task, state) edge, toggle in `settings.notifications.enabled` (default on).
   Click focuses the window and emits `app.focusTask { taskId }` (new event
   channel); the renderer opens the task. TaskService gains a small
   `onStateChanged` listener set — no polling, no broadcast interception.

6. **Parallel runs (supersedes the TASK-004 single-run reading).** TASK-004's
   FIFO queue remains the behavior **beyond the concurrency limit**; the limit
   itself becomes `settings.agent.maxConcurrentRuns` (default 3, 1..8; value 1
   restores the old behavior exactly). Enablers, in order:
   - `ToolGateway` gets a `modeForTask(taskId)` resolver; the mutable
     `gateway.mode` single-flight hack is removed (this was the real blocker).
   - `TaskService.startTask` admits runs while `activeRuns < limit`, else
     queues (event `task.queued` unchanged); `onRunEnded` drains the queue
     while capacity remains.
   - AgentHost/worker/mock already key everything by runId/sessionId
     (verified: `activeRuns` map, per-run tool controllers, mock `runs` map).
   Parallelism is **within the open workspace**. Parallel agents across
   *different* projects requires multi-workspace hosting (gateway, ChangeService,
   documents and trust are per-workspace singletons) — out of scope here,
   recorded as a future ADR trigger. The Home dashboard therefore shows live
   glow for the active project's tasks and last-known states for others.

7. **Presence/glow** is renderer-side: an `activityStore` subscribes to
   `task.event` globally, keeps per-task latest action + per-path pulse rings,
   and decays intensity over ~4s. Zero filesystem watching (we know the writes;
   we do not guess them), zero polling.

8. **⌘K palette**: overlay fed by existing channels (`workspace.recent`,
   `task.list`, `search.files`) plus static actions. `RecentWorkspaceDto`
   gains an optional `kind` badge (node/py/rust/go/web/…) detected cheaply at
   recents-listing time in main.

## Consequences

- Replay quality is bounded by the event log — which is exactly the audited
  truth; an agent action that never touched a gateway/tool/message cannot be
  claimed in replay. That is the honest behavior the spec's evidence rules
  (§13.4) already demand.
- `user review` actions (hunk rejects) appear in replay as `user`-authored
  changes — replay distinguishes agent vs user vs system authorship.
- Steps: P1 = items 2,3,4(tail),5 + Home v2 UI; P2 = 4(full)+6+7+8 (replay UI,
  parallel, glow, ⌘K); P3 = light editing (separate dependency ADR).
