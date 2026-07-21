# Charter 1.0.0-beta.1 Test Report

## Build identity

- Version: `1.0.0-beta.1`
- Commit: release candidate; the immutable commit is recorded by tag `v1.0.0-beta.1`
- Pi SDK: `@earendil-works/pi-coding-agent@0.80.6`
- Electron: `43.1.0`
- Date: 2026-07-21
- Release scope: zero-cost, unsigned GitHub Prerelease

This report qualifies the public Beta. It does not qualify a signed/notarized Stable release.

## Automated suites

| Suite | Platform | Result | Evidence |
| --- | --- | --- | --- |
| Static checks | macOS arm64 | PASS — Prettier, TypeScript, 346 boundary files | `npm run check` |
| Unit/integration | macOS arm64 | PASS — 805/805 across 94 files | `npm test` |
| Performance | macOS arm64 | PASS — 6/6; search first-200 p95 ≈254 ms; 10k replay p95 ≈35 ms | `npm run test:perf` |
| Electron E2E | macOS arm64 | PASS — 138 passed, 19 feature/environment-gated skips, 0 failed, local retries disabled | `npm run test:e2e` |
| Security | macOS arm64 | PASS — repository secret scan; 139 Vitest security cases; 2 packaged-boundary Electron cases | `npm run test:security` |
| Reliability soak | macOS arm64 | PASS — 50 task laps, one worker, no restart, clean exit | `npm run test:soak` |
| Dependency audit | installed production tree | PASS — audited resolutions enforced; `npm audit` reports 0 vulnerabilities | `node scripts/dependency-safety.mjs --check`; `npm audit --audit-level=high` |
| Package/install smoke | macOS arm64 | PASS — DMG mount, clean copy, app launch, cleanup | `npm run package`; `npm run test:install:e2e` |
| Packaged application | macOS arm64 | PASS — real packaged executable, `app://`, isolated renderer, correct version, no page errors | `npm run test:package:e2e` |

The GitHub candidate workflow repeats native package and install smoke tests on macOS, Windows, and Linux before the tag is created. The tag-triggered release workflow repeats the complete release gates and only publishes assets after every job passes.

## E2E acceptance

| ID | Local result | Evidence | Release note |
| --- | --- | --- | --- |
| E2E-001–022 | PASS | `tests/e2e/*.spec.ts`, `tests/security/*.spec.ts` | Full macOS Electron run is green |
| E2E-023 | PASS | `tests/e2e/m12-release.spec.ts`; `packages/persistence/src/database.test.ts` | Old schema migrates through v7; task remains readable; injected failure restores a byte-identical backup |
| E2E-024 | PASS (macOS); native matrix required before tag | `tests/release/packaged.spec.ts`; `scripts/install-smoke.mjs`; GitHub candidate workflow | Launches the packaged binary, not the development Electron entry point |

## Release gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Data integrity and rollback | PASS | 50-lap soak, migration restore, rollback matrix, E2E-023 |
| Permission R3/R4 | PASS | Security suite; R3 approval and R4 fail-closed policy |
| Path boundary | PASS | Traversal, symlink and race coverage in the security suite |
| Secret leakage | PASS | Repository scan plus renderer storage, heap, log and support-bundle checks |
| Crash recovery | PASS | Worker, Renderer, LSP/PTY degradation and interrupted-task recovery coverage |
| Performance | PASS | All six performance budgets met |
| SBOM/licenses/checksums | PASS | SPDX SBOM, dependency inventory, third-party notices, manifest and SHA-256 files generated with release artifacts |
| Unsigned Beta packaging | PASS on macOS; native CI matrix required before tag | Ad-hoc macOS signature verified; Gatekeeper rejection is expected and documented |
| Signed/notarized Stable | BLOCKED | Requires paid Apple Developer ID/notarization and Windows code-signing credentials |
| Fixed real-provider 20-task product evaluation | OPEN | Not claimed by this Beta; requires provider credentials and product-owner sign-off |

## Release decision

`1.0.0-beta.1` is approved for an **unsigned GitHub Prerelease** after the native candidate matrix and tag release workflow pass. Stable remains blocked and the release policy rejects an unsigned stable version.
