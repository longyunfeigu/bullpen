# ADR-0004 — Dual-form shell pivot ("Charter"), engine unchanged

Date: 2026-07-13 · Status: ACCEPTED · Supersedes: spec §4 shell layout (UI form factor only)

## Context

After trialing the M9 build, the product owner redirected the **shell**:

1. The default entry should feel like a task launcher (reference: Codex App home) —
   one free-form input, inline project/model/approval selectors — not an IDE-first
   window with a form dialog.
2. The underlying agent engine must be **invisible**: no "Pi" in any user-visible
   surface. Pi is the v1 engine choice, later to be extended/replaced with our own
   agent logic.
3. Settings must manage provider API keys and fetch live model lists.
4. The full IDE workbench remains available (dual form), because manual editing,
   terminals and git review stay in scope.

The owner also asked whether the SDK is slower than "using Pi directly" and
whether to vendor Pi's source into the repo.

## Decision

1. **Dual-surface shell**: a new `home` surface (task launcher) is the default
   entry; the existing workbench becomes the `workspace` surface. Opening a
   workspace auto-switches to `workspace`; a title-bar control switches back.
   Detailed behavior: `docs/UX_PIVOT_SPEC.md` (PIVOT-001..010).
2. **Product name: "Charter"** (user-visible branding only). Rationale: a
   charter *is* the product's task object — goal, boundaries, success criteria;
   noun+verb marketing ("charter your agent"); dictionary-word open-source
   branding precedent (Helm/Vault). Internal package scope `@pi-ide/*`, env vars
   `PI_IDE_*` and repo name stay unchanged — they are invisible to users and a
   rename would churn every import for zero user value.
3. **Keep the pinned Pi SDK; do NOT vendor Pi source.** The npm package is the
   same code that would be copied in; runtime cost of our isolation (worker
   process + one IPC hop per tool call) is milliseconds against seconds of model
   latency. Vendoring buys no speed and costs upstream maintenance. The fork
   trigger stays as spec §8.5: patch only when a numbered P0 requirement is
   blocked; consider a fork after 3+ standing core patches. Custom agent logic
   later lands as a new `AgentRuntime` implementation behind the existing
   contract (product principle #7, Runtime replaceable).
4. **Model catalog service (main process)**: provider API keys via the existing
   SecretService; `models.fetchRemote` calls the provider's public model-list
   endpoint (Anthropic/OpenAI v1) with the stored key, caches per session and
   merges into `models.list` output. The agent worker is not involved.
5. **Task fast path**: submitting the Home input creates and starts a task with
   a derived title and the raw intent as the goal. Meta-agent drafting of
   acceptance criteria/verification from the intent is **phase 2** (recorded,
   not implemented now).
6. **M10–M12 are deferred, not descoped.** Recovery, hardening and packaging are
   form-factor-agnostic and resume after the pivot ships.

## Consequences

- Spec §4's "welcome page" is replaced by the Home surface; E2E launch helper
  dismisses Home for workbench-focused suites; new pivot E2E covers Home.
- `docs/PRODUCT_ENGINEERING_SPEC.md` remains the engine/security source of
  truth; UI-shell conflicts resolve in favor of `docs/UX_PIVOT_SPEC.md`.
- The trust dialog / preamble / crash copy no longer mention Pi; wording refers
  to "project agent resources" and "Charter".
