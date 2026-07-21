# Charter privacy notice

This notice describes Charter `1.0.0-beta.1`. Charter is local-first, but configured model providers
and separately installed external Agent CLIs may use network services.

## Data stored on your device

Charter stores product state under Electron's per-user application-data directory, including:

- registered workspace paths and workspace UI state;
- Sessions, event timelines, tool/permission decisions and verification history;
- SQLite migration backups, content-addressed snapshots and task attachments;
- settings, local logs and generated support bundles;
- managed Skill metadata and project-memory metadata;
- encrypted provider credentials through Electron `safeStorage`.

Repository files stay in their repository or Charter-created Git worktrees. Charter does not upload
them to a Charter-operated cloud service because no such service exists in this build.

## Data sent to other services

When you use the managed Charter Agent, the prompt and the context you explicitly attach are sent to
the model endpoint you configured. That endpoint may be Anthropic, OpenAI, OpenRouter, LiteLLM, or a
custom compatible service and is governed by that provider's privacy policy.

When you launch Claude Code or Codex as an external terminal Agent, that CLI owns its network,
authentication, telemetry, transcript and retention behavior. Charter observes the local PTY and
repository changes needed to present the Session; it does not replace the CLI's privacy policy.

Live Preview loads a development server on your own loopback interface. Links you explicitly open in
the system browser leave Charter and are governed by the destination.

## Telemetry and crash reporting

This beta contains **no product telemetry or crash-report upload transport**. The related Settings
switches record preferences for a possible future build but send nothing. The crash preview is built
from real local state and passed through the same redaction logic used by support bundles.

Ordinary logs do not intentionally record prompts, file bodies, diffs, provider keys, or complete
command output. Redaction reduces accidental disclosure but is not a promise that arbitrary user text
can never resemble sensitive data; inspect a support bundle before sharing it.

## Retention and deletion

- Product logs use a 30-day retention policy.
- Task history is retained until you delete it.
- Settings → Privacy shows local data size and provides a two-step **Delete history** action.
- Delete history removes task-derived database records, cached blobs, task attachments and logs. It
  keeps settings, encrypted provider credentials, workspace registrations and project files.
- Forgetting a project removes Charter's registration and recorded Sessions; it never deletes the
  repository from disk.
- To remove everything, quit Charter and delete its operating-system application-data directory.

Database migration backups are intentionally retained for recovery. They are local files and may
contain the older Session database; delete them only after confirming the upgraded version is healthy.

## Children and accounts

Charter does not create a Charter cloud account. Any age, billing or account requirements of a model
provider or external Agent CLI apply independently.
