# Charter 1.0.0-beta.3 Test Report

## Build identity

- Version: `1.0.0-beta.3`
- Commit: release candidate; the immutable commit is recorded by tag `v1.0.0-beta.3`
- Pi SDK: `@earendil-works/pi-coding-agent@0.80.6`
- Electron: `43.1.0`
- Date: 2026-07-23
- Release scope: zero-cost, unsigned GitHub Prerelease

This report qualifies the Beta 3 release candidate. The tag-triggered workflow repeats every release
gate and publishes only after the native macOS, Windows and Linux package jobs pass. It does not
qualify a signed/notarized Stable release.

## Previous release channel audit

The initial 2026-07-22 acceptance audit verified the successful tag workflow and 13 published assets
but found the public GitHub API reporting `prerelease:false` and the Release page labeling the
unsigned build `Latest`. That metadata-only channel error was corrected without replacing the tag or
assets. At 2026-07-22 23:27 CST, the API and `gh release view` were reverified as
`prerelease:true`, `draft:false`; the “Unsigned Preview” title and all 13 assets remained unchanged.

## Automated release gates

The local release runner and tag workflow generate machine-readable gate reports. Counts and timings
belong to those reports rather than being copied into this document, where they would become stale as
the test suite grows.

| Suite | Release result | Evidence |
| --- | --- | --- |
| Static checks | PASS | Prettier, architecture boundaries and TypeScript via `npm run check` |
| Unit/integration | PASS | `npm test` |
| Performance | PASS | Search, tree scan and 10k-event timeline budgets via `npm run test:perf` |
| Electron E2E | PASS | Real Electron surface with isolated user-data via `npm run test:e2e` |
| Security | PASS | Secret scan, security Vitest and Electron boundary matrix via `npm run test:security` |
| Reliability soak | PASS | 50 deterministic task laps via `npm run test:soak` |
| Dependency safety | PASS | Pinned-resolution safety and High/Critical audit gate |
| Native package matrix | REQUIRED ON TAG | macOS arm64, Windows x64 and Linux x64 package jobs must all pass before publish |
| Release metadata | REQUIRED ON TAG | SPDX SBOM, license inventory, third-party notices, manifest and SHA-256 checksums |

The workflow can publish only after all release gates and native package jobs pass. Release assets
then include the immutable manifest, checksums and generated gate report for independent verification.

## E2E acceptance

| ID | Result at tag | Evidence |
| --- | --- | --- |
| E2E-001–022 | PASS | `tests/e2e/*.spec.ts`, `tests/security/*.spec.ts` and the generated gate report |
| E2E-023 | PASS | `tests/e2e/m12-release.spec.ts`; persistence migration/backup tests |
| E2E-024 | PASS | `tests/release/packaged.spec.ts`; native package/install jobs |

## Release gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Data integrity and rollback | PASS | Soak, migration restore, rollback matrix and E2E-023 |
| Permission R3/R4 | PASS | R3 approval plus R4 fail-closed security policy |
| Path boundary | PASS | Traversal, symlink and race coverage |
| Secret leakage | PASS | Renderer storage, heap, log and support-bundle checks |
| Crash recovery | PASS | Worker, Renderer, interrupted-task and packaged recovery coverage |
| Performance | PASS | All configured performance gates passed |
| SBOM/licenses/checksums | PASS | Published beside the native assets |
| Unsigned Beta packaging | PASS | Published for macOS arm64, Windows x64 and Linux x64 |
| GitHub distribution channel | REQUIRED ON TAG | Workflow enforces `prerelease:true`, `draft:false` and `--latest=false` |
| Signed/notarized Stable | BLOCKED | Requires Apple Developer ID/notarization and Windows signing credentials |
| Fixed real-provider 20-task evaluation | OPEN | Requires owner credentials and sign-off; not claimed by this Beta |

## Development-head rule

This tagged report must not be used to certify later source changes. A development candidate records
its own commit, fresh build, current test counts, Electron traces and any failing gates. A new release
updates this file to the new immutable tag only after its native release workflow succeeds.

## Release decision

`1.0.0-beta.3` is approved as an **unsigned GitHub Prerelease candidate** after the local release
gates pass. Publication remains conditional on the tag workflow's repeated gates, native package
matrix and artifact metadata. Stable remains blocked, and the release policy rejects an unsigned
Stable version.
