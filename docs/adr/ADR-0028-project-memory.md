# ADR-0028 — Project memory: review-as-learning rules, one source with three projections

Status: accepted
Date: 2026-07-19
Related: docs/design/retention-features-mock.html (proposal ① views Ⓐ/Ⓑ/Ⓒ,
product-owner approved 2026-07-19), docs/design/retention-features-proposals.md
(②–⑦ pending selection), ADR-0015/0019 (skills preamble + external-root
discovery patterns reused), ADR-0017 (external CLI sessions; the withdrawn
hooks-capture direction explicitly NOT reintroduced), M11-07 (clear-history)

## Context

Every review correction the user makes today is spent once and forgotten: the
agent that wrote `default export` for the third time this week was corrected
three times in three different sessions, because nothing turns a request-fix
note into durable project knowledge. Competitor memory systems (Cursor Rules /
Memories, Windsurf Memories, Cline Memory Bank, Devin Knowledge, CodeRabbit
Learnings) mine chat streams; Charter owns a much higher-signal capture point —
the review gate, where every rejected hunk, request-fix note and plan pushback
is a decision, not chatter. An industry benchmark this month named the missing
"沉淀环" (distill loop) as one of Charter's two competitive gaps.

The multi-agent reality shapes the design: the user runs Charter/Pi managed
tasks, Claude Code and Codex side by side. Their "project convention" layers
are the same content in three containers (our preamble, CLAUDE.md, AGENTS.md);
their private memories (~/.claude auto-memory, ~/.codex session stores) are
different structures that must never be merged or rewritten in the background —
the hooks-based transcript capture withdrawn under ADR-0017 stands as the
boundary lesson.

## Decision

One source, three projections, plus managed (not merged) private memory:

1. **Source of truth** — `.charter/rules.md` in the project: rule text +
   enabled state as `- [x] / - [ ]` list items under `##` groups, one trailing
   `<!-- charter:id=… -->` per rule. Lenient parser: unrecognized lines
   round-trip byte-identically, hand-written rules get ids on the next write.
   Machine-local halves live in the DB (migration v5): captured candidates,
   per-rule provenance + observation counters, sync state. Git-shareable file,
   private counters.

2. **Capture (review-as-learning)** — `TaskService` hooks (injected
   post-construction, `TaskMemoryHooks`): a steer carrying review-origin code
   refs (request-fix) or a plan `request_changes` reason becomes a pending
   candidate. Dedupe/merge by a deterministic similarity heuristic (ASCII words
   + CJK bigrams, Jaccard ≥ 0.35 — calibrated in similarity.test.ts; no model
   call). A correction matching an existing enabled rule increments that rule's
   `hitCount` ("slipped again") instead of proposing a duplicate. The distill
   card renders the task's pending candidates inline above the composer:
   approve (editable text) → rule; dismiss; unhandled cards stay in the
   candidate queue — nothing is lost, nothing auto-applies. `settings.memory.
   captureEnabled` (default on) gates capture entirely.

3. **Projection 1: managed runs** — `buildPreamble` appends a
   `<project_rules>` block (enabled rules, binding-context framing). Because
   the preamble is delivered once per session (Pi folds it into the first
   prompt), reused sessions get the block re-attached on every later run AND
   every mid-run reply — the same freshness split the skill catalog uses
   (`<skill_catalog_refresh>`), so a rule distilled after run N binds run N+1
   and even the next reply. Injections are recorded per rule × task
   (INSERT OR IGNORE) — the observable "injected into N tasks" counter is real
   bookkeeping, not an estimate. Approving a task-sourced candidate also writes
   a `memory.distilled` timeline receipt into the source task, so replay can
   answer "why does this rule exist".

4. **Projections 2/3: managed blocks** — per-project, per-target opt-in
   (default OFF, stored in `memory_sync_state`): CLAUDE.md gets a one-line
   `@.charter/rules.md` import (Claude Code expands it natively); AGENTS.md
   gets the rendered rule list (no import semantics there). Charter writes only
   between its `charter:rules:begin/end` markers, atomically (tmp+fsync+rename)
   — content outside the block is never touched. Drift = block hash differs
   from the last hash WE wrote (including first-enable over a foreign block):
   sync refuses and the user picks import (hand edits → candidates, then
   rewrite) / overwrite / stop. Reverse import scans hand-written bullet
   conventions outside the block into candidates so a fourth memory never
   accretes.

5. **Private memory, managed not merged** — discovery over known paths only
   (`~/.claude/CLAUDE.md`, `~/.claude/projects/<munged-realpath>/memory/*.md`
   via the ADR-0017 munge helper, `~/.codex/AGENTS.md`), read-only listing with
   opaque ids (caller paths never reach the fs), logical+realpath containment
   inside the agent root (SkillStore guards), byte caps, NUL sniffing. Writes
   happen only on explicit user action with mtime-conflict rejection; delete
   backs up to `userData/memory/trash` first; promote COPIES a note into
   candidates (one-way — Charter never writes into a CLI's private store);
   session transcripts are out of scope. Codex has no auto-memory directory in
   current versions — the panel says so (honest empty state) instead of
   pretending.

6. **Surfaces** — Session Rail gains a fifth destination "Memory" opening an
   overlay (Settings pattern): Project rules (stats, candidates, grouped rules
   with enable/edit/remove), Sync & distribution (three projection cards +
   drift actions + reverse import), Claude Code / Codex (private files:
   view/edit/delete/promote), Charter ledger (explicitly: no hidden private
   memory — rules + task ledger are it). ⌘K adds a Memory group (rules +
   private files) and an Open Memory action. Settings → Agent hosts the capture
   toggle and an Open Memory shortcut.

## Consequences

- `memory.*` IPC domain (16 channels, strict schemas), `memory.changed` event,
  DB migration v5 (4 tables), `settings.memory` section, AppPaths `memoryDir`.
- `privacy.clearHistory` clears task-derived memory rows (injections FK tasks;
  candidates/stats are machine-local observations) — the rules FILE is a
  project file and is deliberately never touched by clear-history.
- E2E isolation mirrors skills: `PI_IDE_MEMORY_HOME` fake home; under
  `PI_IDE_E2E` without it, external discovery is off — tests can never scan the
  developer's real home.
## Amendment (2026-07-19): IA v3 — agents are the top level

First real-use feedback, two rounds. Round 1: the panel opened empty ("No
project selected") because it implicitly followed the focused workspace — in a
product where tasks are global citizens that binding is wrong. Round 2 rejected
a projects-first left rail too: the user's mental model is **agent first** —
"点 Claude Code 进去,先看它的全局 memory,二级才是 Project"。 Shipped as
mocked in `docs/design/memory-ia-v3.html` (v2 kept for the record):

- Left nav = agents (Claude Code / Codex / Charter). Each opens into a GLOBAL
  section, then a PROJECTS second level (collapsible groups; the focused
  project's group starts expanded, badge = pending candidates).
- New channel `memory.tree` returns the spine in one round trip; Charter
  project detail (rules/candidates/distribution) lazy-loads per group via the
  existing `memory.overview`. Every mutation now names its project explicitly.
- Claude's project list is the FULL set under `~/.claude/projects/*/memory`
  (`ExternalMemoryStore.listAll`): groups matching a known workspace (munged
  literal or realpath) show its display name and may Promote into that
  project's rules; foreign dirs keep the raw munged name, browse/delete only.
- Codex shows global AGENTS.md + an honest "no per-project auto-memory" note;
  Charter shows an honest "no global rules by design" note, and each project
  group carries rules + candidates + the Distribution lines (Charter runs /
  CLAUDE.md / AGENTS.md with the same drift three-way).

- Honest limits: (a) capture offers a card after every correction (v1) rather
  than the mock's "2nd similar correction" threshold — the card is quiet,
  single, and merges similar corrections with a ×N counter; a stricter
  candidates-only mode can follow user feedback. (b) The mock's "挡下 N 次返工"
  stat shipped as the honest counters "injected into N tasks / slipped again
  ×N" — claiming a rule *prevented* rework needs proposal ② (reviewer) as the
  checker. (c) Rules are read from the project's main root, not per-worktree —
  rules are configuration, not code under test. (d) Drift detection guards OUR
  block only; it cannot attribute who edited it. (e) The CLAUDE.md/AGENTS.md
  memory conventions were verified against current installs via the existing
  munge helper; future CLI versions may move paths — discovery then degrades
  to the empty state, never to an error.
