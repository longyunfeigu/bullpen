# M12 Release Checklist

## Unsigned public Beta (`1.0.0-beta.1`)

- [x] SemVer prerelease version and matching `v1.0.0-beta.1` tag policy.
- [x] Unsigned releases are restricted to prerelease channels; unsigned Stable fails closed.
- [x] macOS, Windows and Linux native package/install workflows are defined.
- [x] E2E-023 migration and backup restore coverage.
- [x] E2E-024 real packaged-application coverage.
- [x] Static, unit, performance, Electron E2E, security, soak and dependency gates are wired into `release:verify`.
- [x] DMG clean install/launch/cleanup smoke passed locally.
- [x] SPDX SBOM, license inventory, third-party notices, artifact manifest and SHA-256 checksums are generated.
- [x] Security, privacy, recovery, signing, known-limitations and release-note documents are present.
- [x] GitHub tag workflow creates a Prerelease only after all native package jobs pass.
- [ ] Record the candidate workflow URL and three-platform result before creating the tag.
- [ ] Verify the published Prerelease page and every uploaded asset after the tag workflow finishes.

## Stable handoff (intentionally not claimed)

- [ ] Obtain Apple Developer Program membership and Developer ID Application credentials.
- [ ] Configure Apple notarization credentials and validate Gatekeeper acceptance.
- [ ] Obtain a trusted Windows code-signing certificate and validate SmartScreen/install behavior.
- [ ] Run Beta-to-Stable update/rollback coverage for the chosen updater service.
- [ ] Run the fixed 20-task real-provider evaluation with owner-approved credentials.
- [ ] Obtain product-owner sign-off on the Stable test report.

The user selected the zero-cost Beta path. These Stable items do not block the GitHub Prerelease, but they do block any build labeled Stable.
