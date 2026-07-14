# ADR-0010 — Agent-prose Markdown rendering and per-model reasoning effort

Status: accepted
Date: 2026-07-14
Related: ADR-0007 (rich markdown file editor), spec §8 (agent contract), MOD-001, PIVOT-032 (room timeline)

## Context

1. **Agent replies rendered as plain text.** Models emit GitHub-flavoured markdown
   (tables, fences, emphasis); the Task Room bubbles, editor agent panel, plan
   summaries, report narratives and question cards all rendered raw source. A
   simple table reply read as line noise (user-reported).
2. **Reasoning effort was model-blind.** The composer offered one fixed 6-level
   list (`off…max`) to every model. Pi's contract is 7 levels (`xhigh` exists);
   models differ in what they accept (non-reasoning models: nothing; GPT-5 family:
   `xhigh`; Anthropic: `max`). Users could ask for effort the provider call would
   silently drop, and could not pick `xhigh` at all.

## Decision

### Markdown for agent-authored prose only

- New dependencies, exact-pinned in `desktop-renderer`: **react-markdown@10.1.0 +
  remark-gfm@4.0.1**. Chosen over `marked`/`dangerouslySetInnerHTML` because output
  is a React element tree: **no raw-HTML rendering path exists at all** (we do not
  install `rehype-raw`), URL schemes go through react-markdown's default sanitiser,
  and link clicks are routed to `app.openExternal` (main-process checked opener).
- One shared `<Markdown>` component (`views/Markdown.tsx`) used by: agent bubbles
  (timeline + streaming), plan summaries, final-report agent narrative, question
  cards. **User-authored text stays plain** (`user.message` bubbles) so a user
  pasting markdown/HTML is never interpreted.
- Fenced code blocks colorize via Monaco's tokenizer (`monaco.editor.colorize`,
  already bundled — zero new highlight dependency; token spans only) with a copy
  affordance.

### Per-model effort levels

- `agent-contract`: `ThinkingLevel` gains `'xhigh'`; `ModelDescriptor` gains
  `supportedThinkingLevels: ThinkingLevel[]`.
- `agent-runtime-pi` computes the list with `getSupportedThinkingLevels` and clamps
  at `createSession` with `clampThinkingLevel` from **@earendil-works/pi-ai@0.80.6**,
  now an exact-pinned direct dependency of that package (the same version
  pi-coding-agent@0.80.6 ships; pure functions over model metadata). The boundary
  rule is unchanged: only `packages/agent-runtime-pi` may import `@earendil-works/*`.
- Composer: the effort select shows **only** the selected model's supported levels
  (unsupported levels are hidden, per product decision); switching models clamps the
  current choice to the nearest supported level (higher first — mirrors the runtime
  clamp). Non-reasoning models disable the control ("no thinking").
- Gateway-listed models (custom endpoints) expose no reasoning metadata → they offer
  the full range and rely on the runtime clamp.
- Settings keeps the full-range default preference; every dispatch path clamps.

## Consequences

- Two renderer dependencies and one adapter dependency to track at Pi SDK upgrades
  (pi-ai must move in lockstep with pi-coding-agent — release checklist item).
- Old persisted `ModelDescriptor` snapshots lack `supportedThinkingLevels`; the DTO
  schema defaults the field to the full list, so stale catalogs degrade to the old
  behaviour (runtime still clamps).
- Timeline text assertions in tests keep working: rendered markdown preserves text
  content (`toContainText` semantics), only markup changes.
