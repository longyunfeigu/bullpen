# V1.0 Stable Release Checklist

## Specification and implementation

- [ ] All P0 requirements mapped to implementation and test evidence.
- [ ] All 12 milestones VERIFIED.
- [ ] E2E-001 through E2E-024 passed on required platforms.
- [ ] No data-loss, security-boundary or migration blocker.

## Security and privacy

- [ ] Renderer isolation and CSP verified in packaged build.
- [ ] R3 cannot execute without approval; R4 cannot execute.
- [ ] Path traversal/symlink/TOCTOU suite passed.
- [ ] Secrets absent from Renderer, logs, DB and support bundle.
- [ ] Dependency/security/license review complete.
- [ ] Privacy notice and local-data deletion flow verified.

## Data and reliability

- [ ] 50 rollback cases byte-identical.
- [ ] Database migration and backup restore rehearsed.
- [ ] Worker/Renderer/LSP/PTY crash injection passed.
- [ ] 50-task soak run passed with no file loss or unrecoverable corruption.
- [ ] Application exits without orphan processes.

## Packaging and update

- [ ] macOS package built, signed/notarized as required and installed on a clean machine.
- [ ] Windows package built, signed as required and installed on a clean machine.
- [ ] Linux Preview package starts and documents update limitations.
- [ ] Beta-to-Stable update and database migration passed.
- [ ] Rollback/failure behavior tested.
- [ ] Version, changelog, SBOM and third-party notices correct.

## Product readiness

- [ ] First-run onboarding and provider authentication tested.
- [ ] User documentation, known limitations and recovery guide published.
- [ ] Fixed 20-task evaluation reaches the release threshold.
- [ ] Product owner signs off on final test report.
