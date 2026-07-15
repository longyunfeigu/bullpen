# Test Report

## Build identity

- Version:
- Commit:
- Pi SDK version:
- Electron version:
- Date:

## Automated suites

| Suite | Platform | Result | Duration | Artifact |
| --- | --- | --- | --- | --- |
| Replay V2 — full unit/integration | macOS | PASS — 367/367 | 3.47s | Vitest |
| Replay V2 — live provider structured streams | macOS | PASS — Claude Code 2.1.210 stream-json + Codex CLI 0.144.4 JSONL; exact response received, no tools/files | 6.8s + 11.6s | direct CLI smoke |
| Replay V2 — managed-agent Electron E2E | macOS | PASS | See Playwright output | `tests/e2e/p2-parallel-replay.spec.ts` |
| Replay V2 — real PTY external session E2E | macOS | PASS — observed terminal + per-write evidence + D detail | See Playwright output | `tests/e2e/external-cli.spec.ts` |
| Replay V2 — contracts, boundaries, TypeScript and production build | macOS | PASS — boundary 217, TypeScript clean, build clean | See command output | npm scripts |
| Replay V2 — visual and interaction QA | macOS, 1440×900 + 1024×768 | PASS — A–E managed; A/D/E external; scrub, mode switching and evidence inspection | Playwright Electron + image inspection | temporary QA captures |
| Full unit/integration suite | macOS | PASS — 358/358 | 3.48s | Vitest |
| Coordinated skins — settings unit | macOS | PASS — 5/5 | 0.29s | Vitest |
| Coordinated skins — Electron E2E | macOS | PASS — 3/3 | 7.3s | `tests/e2e/m2-shell.spec.ts` |
| Coordinated skins — production build | macOS | PASS | 3.2s | Vite/Electron build |
| Coordinated skins — visual QA | macOS, 1440×900 + 1024×640 | PASS — three editor skins + picker; no console errors, clipping or horizontal overflow | 3.6s | `/tmp/charter-skin-*.png` |

## E2E acceptance

| ID | macOS | Windows | Linux Preview | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| E2E-001 | | | | | |
| E2E-002 | | | | | |
| E2E-003 | | | | | |
| E2E-004 | | | | | |
| E2E-005 | | | | | |
| E2E-006 | | | | | |
| E2E-007 | | | | | |
| E2E-008 | | | | | |
| E2E-009 | | | | | |
| E2E-010 | | | | | |
| E2E-011 | | | | | |
| E2E-012 | | | | | |
| E2E-013 | | | | | |
| E2E-014 | | | | | |
| E2E-015 | | | | | |
| E2E-016 | | | | | |
| E2E-017 | | | | | |
| E2E-018 | | | | | |
| E2E-019 | | | | | |
| E2E-020 | | | | | |
| E2E-021 | | | | | |
| E2E-022 | | | | | |
| E2E-023 | | | | | |
| E2E-024 | | | | | |

## Security, integrity, reliability and performance gates

| Gate | Result | Evidence | Open issue |
| --- | --- | --- | --- |
| Data integrity | | | |
| Permission/R3/R4 | | | |
| Path boundary | | | |
| Secret leakage | | | |
| Crash recovery | | | |
| Soak test | | | |
| Performance | | | |
| Packaging/update | | | |
