# ADR-0026: Boundary checker sees aliased requires; Pi package.json metadata reads are an explicit exemption

- Status: Accepted (repo-clean sweep, 2026-07-18)
- Relates to: CLAUDE.md non-negotiable "Only `packages/agent-runtime-pi` may import Pi packages", spec §9.5 dependency boundaries, `scripts/boundaries-core.mjs`

## Context

The boundary linter's import extractor matched `import … from`, `import(…)` and bare
`require(…)` — but not aliased requires. `apps/desktop-main/src/index.ts` uses the
`createRequire` idiom (`const require_ = createRequire(…)`) to read
`@earendil-works/pi-coding-agent/package.json` for the About surface's SDK version.
Because `require_(` never matched the regex, the checker was blind to this reference:
the `pi-only-in-adapter` rule could not see it, and a future genuine Pi code import
via an aliased require would have slipped through the same hole undetected.

Two ways to close the hole were considered:

1. Move the version probe behind `@pi-ide/agent-runtime-pi`. Rejected: desktop-main's
   esbuild bundle does not mark the Pi SDK external (only agent-worker's does), so
   importing the adapter's entry from main would pull the ESM/wasm Pi SDK into
   `main.cjs` — the very thing the process split exists to prevent. A subpath export
   would need extra alias plumbing in three build configs for no runtime gain.
2. Teach the extractor to see aliased requires, and make the metadata read an explicit,
   documented exemption. Chosen.

## Decision

- `IMPORT_RE` now matches `\brequire\w*\(` — `require(`, `require_(`, any
  `createRequire`-style alias. (`createRequire(` itself does not match: no word
  boundary before `require` there, and its argument is not a string literal.)
- `pi-only-in-adapter` exempts specs ending in `/package.json`: reading a package's
  manifest is metadata access — no Pi code is loaded or executed. Any other
  `@earendil-works/*` spec outside `packages/agent-runtime-pi` still violates.
- Covered by `tests/unit/boundaries.test.ts`: an aliased require of a Pi code module
  is flagged; an aliased require of the Pi package.json is not.

## Consequences

- The checker is strictly stronger: the previously invisible reference class is now
  scanned, and the one legitimate use is visible policy instead of a blind spot.
- Runtime behavior is unchanged — `piSdkVersion()` is byte-identical to before.
- The exemption is scoped to manifests only; it does not permit importing any Pi
  runtime module anywhere outside the adapter.
