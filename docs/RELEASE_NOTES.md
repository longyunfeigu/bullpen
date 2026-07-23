# Charter 1.0 Beta 3 — Unsigned Preview

Charter's complete Session-first desktop workflow is available as a public, zero-cost preview for
macOS Apple Silicon, Windows x64 and Linux x64.

This SemVer Beta is an **unsigned prerelease** published with GitHub's Prerelease flag; it is not
Stable or Latest.

## New since Beta 2

- Session review remains actionable at 200% zoom and narrow desktop viewports, including accept,
  request-changes, rollback, confirmation and Full Review controls.
- Quick Console context switching now locks while a real shell command is running and unlocks only
  after the host observes its completion boundary. Labels consistently describe the host-managed
  context cwd instead of implying that shell `cd` retargets the product.
- Replay, artifacts, Markdown authoring, Preview and Session evidence surfaces have clearer hierarchy,
  keyboard focus behavior and truthful state transitions across all four visual skins.
- Review and rollback preserve the documented Git boundary: accepting keeps workspace bytes without
  creating a commit, while rollback restores recorded changes byte-for-byte.
- Terminal and external-session coverage now exercises alternate-screen programs, Ctrl-D, native
  multiline paste, busy-state context protection and stable reply-animation evidence.

## Highlights

- One durable Session for conversation, plans, managed Agent work, external Claude Code/Codex PTYs,
  live file activity, Preview, Terminal, verification, review, rollback, Replay and Memory.
- Sandboxed Electron renderer, versioned IPC, host-side Tool Gateway policy, content/path containment,
  secret redaction and packaged Electron fuse hardening.
- Byte-exact file rollback, crash/interruption recovery, database migration backup/restore and
  deterministic 50-task soak coverage.
- Release artifacts accompanied by an SPDX SBOM, third-party license inventory, machine-readable
  manifest and SHA-256 checksums.

## Important installation notice

These artifacts are **unsigned and not notarized**. macOS Gatekeeper and Windows SmartScreen/Smart App
Control may warn or block them. Do not disable operating-system security globally. If your local policy
does not allow unsigned applications, build from source or wait for a signed release.

Before running a download, verify it against `SHA256SUMS.txt` attached to this Release.

The Linux tarball uses Chromium's setuid sandbox. After extracting it, configure the helper before
launching Charter (replace `<extracted-directory>` with the directory created by the archive):

```sh
sudo chown root:root <extracted-directory>/chrome-sandbox
sudo chmod 4755 <extracted-directory>/chrome-sandbox
<extracted-directory>/charter
```

Do not launch the Linux build with `--no-sandbox`.

## Updates and data

Updates are manual in this preview. Quit Charter, back up its application-data directory, verify the
new artifact, and replace the app. Before applying a database schema migration, Charter automatically
creates a timestamped backup and restores it if the migration fails.

Read the
[known limitations](https://github.com/longyunfeigu/Charter/blob/v1.0.0-beta.3/docs/KNOWN_LIMITATIONS.md),
[recovery guide](https://github.com/longyunfeigu/Charter/blob/v1.0.0-beta.3/docs/RECOVERY.md),
[privacy notice](https://github.com/longyunfeigu/Charter/blob/v1.0.0-beta.3/PRIVACY.md), and
[security policy](https://github.com/longyunfeigu/Charter/blob/v1.0.0-beta.3/SECURITY.md) before using
the preview on important repositories.
