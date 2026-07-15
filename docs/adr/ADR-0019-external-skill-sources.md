# ADR-0019 — External skill sources: discovery, trust and live reconciliation

Date: 2026-07-15 · Status: ACCEPTED  
Amends: ADR-0015's “explicit copied imports only” rule; preserves its audited
`load_skill` design and AG-014's default distrust of project resources.

## Context

ADR-0015 deliberately copied every explicitly imported `SKILL.md` folder into
`userData/skills`. That made ownership and auditing simple, but copied skills
immediately diverged from their Claude Code, Codex or shared Agent Skills source.
The user wants Charter to discover installed skills automatically and observe
edits, additions, deletions and renames without repeating an import.

Per-skill filesystem symlinks only solve edits to an already-linked folder.
They do not reconcile additions/deletions, express source trust, resolve name
collisions, notify the renderer or work consistently on every platform. They
also make ADR-0015's lexical path check unsafe because a bundled symlink can
resolve outside the apparent skill root.

## Decision

1. **Source registry, not a symlink farm.** `SkillStore` derives one catalog
   from these independent roots:
   - the existing managed copy library;
   - `~/.agents/skills` (shared Agent Skills);
   - `~/.claude/skills` (Claude Code);
   - `~/.codex/skills` (Codex, including separately visible system entries);
   - roots explicitly connected by the user.
   Project directories are still never scanned implicitly. A project root only
   participates when the user explicitly connects it as a custom source.

2. **Discovery is not trust.** Well-known external roots appear automatically,
   but begin untrusted and Off. Enabling one external skill explicitly trusts
   its source for that skill. A source-level policy can trust the root and
   optionally auto-enable newly discovered skills. Disabling source trust fails
   closed immediately; per-skill preferences remain so they can be restored.

3. **Two ownership modes stay visible.** `Connect folder` reads the external
   source live and never deletes it. `Import copy` preserves ADR-0015's isolated
   managed snapshot. Only managed copies expose Remove; custom roots expose
   Disconnect, which changes registry state without touching source files.

4. **Watcher + reconciliation.** Recursive `fs.watch` provides low-latency
   invalidation. Every event is debounced into a full source rescan instead of
   being treated as an authoritative mutation. Startup, Settings reads, window
   focus, task/tool demand and a 45-second foreground timer reconcile again, so
   dropped/coalesced watcher events cannot permanently desynchronize the
   catalog. Main broadcasts schema-validated `skills.changed` events.

5. **Stable identity and explicit collisions.** Managed ids keep their legacy
   slugs. External ids derive from source id + relative path. The highest
   priority copy (managed, custom, shared Agents, Claude, Codex) retains the
   short invocation name; other copies receive a qualified name such as
   `pdf@claude`. All copies show a conflict badge and provenance; no copy is
   silently overwritten.

6. **Canonical path containment.** Discovery records each skill's canonical
   root. Audit and `load_skill` canonicalize the target with `realpath` before
   reading and reject skill-root or nested symlinks outside the trusted source.
   The gateway also rejects a linked root retargeted after discovery. Escaping
   symlinks, 500+ files and >20 MB revisions are invalid and cannot be enabled. Import
   dereferences only validated in-root links to preserve snapshot semantics.

7. **Live revisions are auditable.** A revision digest covers `SKILL.md` plus
   bundled-file metadata. It appears in Settings, explicit expansion and every
   successful `load_skill` result together with source provenance. Existing
   runtime sessions receive a fresh derived catalog on each run/reply; a
   subsequent `load_skill` reads the current trusted revision. This deliberately
   favors the requested live-sync semantics over pinning a potentially large
   external bundle per run.

8. **Portability is reported, not assumed.** The inert frontmatter parser now
   supports quoted and folded/block descriptions. Discovery flags obvious
   Claude/Codex/MCP-specific instructions as `needs-review`; it never executes
   content. Scripts still have zero ambient privilege and can execute only
   through the existing Permission Engine.

Pi's adapter and the product `AgentRuntime` contract remain unchanged. All
runtimes continue to consume the same product-owned preamble, slash expansion
and audited gateway tool.

## Data and migration

`skills.json` migrates leniently from version 1 to version 2. Existing managed
directory ids and `enabled` flags are retained. Version 2 adds source policies
and custom source definitions; the catalog itself is derived and disposable.
No external path or policy is written into Claude/Codex directories.

E2E discovery is disabled unless `PI_IDE_SKILLS_HOME` names an isolated fake
home, preventing tests from reading a developer's real personal skills.

## Alternatives considered

- Copy on every detected change: creates competing writers and can overwrite a
  user's managed edits; source deletion semantics are ambiguous.
- One symlink per skill plus a reconciler: the reconciler is already a source
  registry in disguise, with worse portability and deletion/security behavior.
- Pi native resource discovery: remains rejected by ADR-0015 because it depends
  on Pi's disabled read tool, bypasses product audit and couples behavior to one
  runtime.
- Auto-trust every user-level root: rejected because `SKILL.md` is executable
  instruction content and may reference scripts, external MCPs or prompt
  injection.

## Verification evidence

- `skill-store.test.ts`: migration-compatible managed behavior, folded YAML,
  built-in discovery default-Off, source trust, live add/update/delete,
  custom connect/disconnect, qualified conflicts and escaping-symlink rejection.
- `tools-skill.test.ts`: canonical symlink containment plus existing R0,
  traversal, reference, binary and live-enable behavior.
- `skills.spec.ts`: existing managed flow plus isolated-home external discovery,
  source policy, watcher-driven update/add/delete and slash-picker propagation.
