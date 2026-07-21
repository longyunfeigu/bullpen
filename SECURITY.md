# Charter security policy

Charter is a local-first desktop Agent IDE. It executes model-proposed work against real
repositories, so its most important security boundary is the host-side Tool Gateway—not the model,
the renderer, or repository instructions.

## Supported releases

| Release | Support level |
| --- | --- |
| `1.0.0-beta.*` | Best-effort security fixes while the public preview is current |
| Source builds from `main` | Development only; update to the latest commit before reporting |
| Older preview builds | Unsupported |

The public beta artifacts are deliberately unsigned. Verify the SHA-256 digest against the
`SHA256SUMS.txt` file attached to the same GitHub Release. A checksum detects a damaged or replaced
download only when the Release page itself is trusted; it does not provide the publisher identity
guarantee of Apple Developer ID or Windows Authenticode.

## Reporting a vulnerability

Do not include provider keys, private repository content, prompts, terminal transcripts, database
files, or support bundles in a public issue.

Use the repository's **Security → Report a vulnerability** flow when it is available. Otherwise,
contact the repository owner through their GitHub profile first and agree on a private channel
before sending sensitive detail. For a non-sensitive hardening bug, open a normal GitHub issue.

Please include:

- affected Charter version and operating system;
- the security boundary crossed and the minimum reproduction;
- whether untrusted repository content or an external CLI was involved;
- sanitized logs or a redacted support bundle, if relevant;
- the expected impact and any known workaround.

## Security boundaries

- The Electron renderer has no Node integration, uses context isolation and sandboxing, and reaches
  privileged capabilities only through a versioned, schema-validated preload bridge.
- The managed Agent Worker owns the model loop but has no built-in filesystem or shell tools.
  Tool calls return to Electron Main for risk classification, path containment, permission handling,
  execution, redaction, and audit recording.
- R4 operations such as `sudo`, secret reads, broad destructive commands, and `git push` are refused
  by the managed Tool Gateway. External Claude Code and Codex terminals retain their own permission
  systems and are not contained by Charter's Tool Gateway.
- Workspace trust is not an operating-system sandbox. Open untrusted repositories in a disposable
  VM or operating-system account when stronger isolation is required.
- Provider credentials are stored through Electron `safeStorage`; renderer-facing state is redacted.
- Preview frames accept only detected loopback development servers and remain subject to navigation,
  window-open, permission, CSP, and iframe sandbox policies.

## Release security

Every preview Release is expected to include:

- installable artifacts for the declared platforms;
- `release-manifest.json` with version, channel, commit, size and SHA-256 per artifact;
- `SHA256SUMS.txt`;
- an SPDX SBOM;
- machine-readable and human-readable third-party license inventories;
- the release-gate report and known limitations.

Unsigned artifacts must never be promoted as Stable. `scripts/release-policy.mjs` enforces that rule,
and local packaging cannot publish to GitHub implicitly.

## Dependency posture

Dependencies are exactly pinned in `package-lock.json`. Release gates run the repository secret scan,
unit/integration tests, Electron security matrix, performance suite, full E2E suite, soak test, and an
`npm audit` gate that fails on High or Critical findings. Lower-severity findings are reviewed and
recorded rather than silently ignored.
