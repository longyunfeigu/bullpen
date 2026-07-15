import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { TaskService } from '../services/task-service.js';
import type { WorkspaceHost } from '../services/workspace-host.js';

/** Activity stream, replay records and path relativization (ADR-0006, P1). */
export function registerActivityHandlers(
  tasks: TaskService,
  workspace: WorkspaceHost,
  logger: Logger,
): void {
  registerHandlers(
    {
      'task.activity': async ({ taskId, tail }) => tasks.activity(taskId, tail),
      'task.changeRecord': async ({ taskId, changeId }) => ({
        record: tasks.changeRecord(taskId, changeId),
      }),
      'task.changeEvidence': async ({ taskId, changeId }) => ({
        evidence: await tasks.changeEvidence(taskId, changeId),
      }),
      'workspace.relativize': async ({ paths }) => {
        const ws = workspace.mustActive();
        const root = ws.canonicalPath;
        const inside: Array<{ abs: string; rel: string }> = [];
        const outside: string[] = [];
        for (const raw of paths) {
          let abs = resolve(raw);
          try {
            abs = realpathSync(abs);
          } catch {
            // keep the resolved path; a dangling drop is classified below
          }
          const rel = relative(root, abs);
          if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
            outside.push(raw);
          } else {
            inside.push({ abs, rel });
          }
        }
        return { inside, outside };
      },
    },
    logger,
  );
}
