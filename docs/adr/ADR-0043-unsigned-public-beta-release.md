# ADR-0043: Zero-cost unsigned public beta, signed Stable remains blocked

- Status: Accepted (product owner decision, 2026-07-21: no budget for signing certificates; proceed
  with the proposed unsigned GitHub prerelease)
- Date: 2026-07-21
- Related: M12-01..07, §12.2 update supply chain, §14 M12, §16 Release Gates, §18.2/18.3

## Context

The original V1.0 Stable gate requires Apple Developer ID signing/notarization and a trusted Windows
code-signing identity. The product owner cannot fund those external credentials. GitHub Releases do
not require them, but an unsigned binary cannot honestly claim the trust properties of Stable.

## Decision

1. Ship `1.0.0-beta.1` as a GitHub **prerelease** named “Unsigned Preview”.
2. Build native artifacts on macOS, Windows and Linux runners. Run the real packaged executable from
   a clean isolated profile on every platform before publication.
3. Keep `electron-builder publish: null`; only the tag-gated GitHub workflow may publish. Local builds
   never create or mutate a Release.
4. Make the signing path conditional, not deleted. `CHARTER_SIGNING_MODE=signed` re-enables identity
   discovery when future certificate secrets are present. Hardened Runtime is enabled now.
5. Enforce policy in code: an unsigned stable SemVer is a build error; the release tag must exactly
   match `package.json`.
6. Attach SHA-256 checksums, an artifact manifest, SPDX SBOM and license inventory. These provide
   traceability and integrity checking but are never described as publisher authentication.
7. Use manual beta updates. Database backup/restore and the E2E-023 upgrade rehearsal protect local
   state. Automatic application replacement is deferred until the artifacts can be signed.
8. Keep signed/notarized Stable, the real-provider fixed 20-task evaluation, and automatic update
   delivery as open Stable gates. M12 may be preview-complete without relabeling those gates as passed.

## Alternatives

- Self-signed certificates: rejected for public distribution because consumer operating systems do
  not trust them by default.
- Calling an unsigned build Stable: rejected because it contradicts the product's release checklist
  and would mislead users.
- No binaries until certificates can be purchased: rejected because it prevents useful public beta
  feedback and does not improve the eventual signing implementation.

## Security and data impact

Users receive explicit warning text and verifiable hashes. OS trust warnings remain expected. No
auto-update code downloads or executes unsigned replacement binaries. Migration backup/restore stays
inside the existing SQLite boundary and no repository file is deleted during install or update.

## Migration and rollback

This decision changes product version/release policy, not the database schema. Rollback is to delete
the prerelease/tag or publish a newer prerelease; already downloaded artifacts remain untrusted and
must be treated according to their recorded hash. A future signed release supplies credentials and
uses the existing conditional workflow rather than reverting this ADR.

## Verification

- `scripts/release-policy.mjs` unit coverage, including unsigned Stable refusal and tag mismatch.
- `tests/e2e/m12-release.spec.ts` old-schema upgrade and retained readable Session.
- `packages/persistence/src/database.test.ts` byte-identical restore on injected migration failure.
- `tests/release/packaged.spec.ts` actual packaged app, clean profile, production protocol, renderer
  isolation and ad-hoc macOS signature integrity.
- `.github/workflows/release.yml` credential-free full gates, three-platform package matrix, metadata
  generation and prerelease publication.
