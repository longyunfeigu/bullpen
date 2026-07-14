# ADR-0011 — Model thinking visibility and the live activity strip

Status: accepted (product owner decision, 2026-07-14)
Date: 2026-07-14
Related: spec AG-005/AG-006 (amended), ADR-0006 (activity stream), PIVOT-032 (room timeline)

## Context

AG-006 originally forbade showing the model's private chain-of-thought; the Pi
adapter dropped `thinking_delta` events entirely. In practice every comparable
agent product (Claude Code, Codex, Cursor, Pi's own TUI) streams the reasoning
as a quiet, collapsible channel — users read it to judge whether the agent
understood the task, and its absence makes long silent stretches look hung.
Separately, a running task presented only a bare "Working" state chip; the
recorded activity stream (ADR-0006) already knew the current tool, target and
usage but no surface narrated it.

## Decision

1. **Thinking is a first-class presentation channel, never evidence.**
   - Contract: `thinking.delta` / `thinking.completed` (messageId, text,
     durationMs) join `AgentEvent`. The Pi adapter forwards pi's
     `thinking_delta`/`thinking_end` streams per content block; the mock
     runtime gains a `thinking` scenario step for deterministic tests.
   - Main: gated by `settings.agent.showThinking` (default **on**). Live
     deltas broadcast on `task.streamThinking` (ephemeral); completed blocks
     persist as `agent.thinking` timeline events (replay-visible).
   - Presentation: streaming shows an open, softly-shimmering "Thinking · Ns"
     block that folds into a collapsed "Thought for Ns" row when the block
     completes; expanding is on demand. Muted styling — visually subordinate
     to real output.
   - **Evidence exclusion (the AG-006 amendment's teeth):** `agent.thinking`
     never projects into the activity stream (no action lines, no pulses), is
     not consulted by the final report, verification or review surfaces, and
     is excluded from "Needs you" logic. AG-006 now reads: thinking is shown
     only as a collapsed presentation channel and never enters the evidence
     system.

2. **Live activity strip replaces bare "Working".**
   The Task Room shows a strip above the composer while running: pulsing dot,
   current action ("Editing src/index.ts…", "Thinking…", "Writing a reply…"),
   elapsed seconds for the running tool, and cumulative token spend (↑in ↓out)
   from recorded usage events. Data comes exclusively from the existing
   recorded activity projection and timeline — no new state channels.

## Consequences

- Session logs now contain reasoning text on disk (same store as messages).
  Users who consider thinking sensitive can disable the setting — then it is
  neither streamed nor persisted.
- Replay shows collapsed thinking blocks exactly as live did (same events).
- The mock `ask-basic` scenario emits thinking, so the default ask-task E2E
  path continuously covers the collapse/expand/evidence-exclusion behaviour
  (p2-visibility.spec.ts).
