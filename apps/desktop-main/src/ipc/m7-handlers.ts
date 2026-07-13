import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { TaskService } from '../services/task-service.js';

/** M7: permission decisions and ask_user answers (PERM-002/005/006, §13.3). */
export function registerM7Handlers(tasks: TaskService, logger: Logger): void {
  registerHandlers(
    {
      'task.permissionDecision': async (payload) => {
        const result = tasks.decidePermission({
          requestId: payload.requestId,
          kind: payload.kind,
          scope: payload.scope,
          expectedParamsHash: payload.expectedParamsHash,
          ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
          applyToSimilar: payload.applyToSimilar,
        });
        return { resolvedRequestIds: result.resolvedRequestIds };
      },
      'task.pendingPermissions': async ({ taskId }) => tasks.pendingPermissions(taskId),
      'task.answerUser': async ({ callId, answer }) => ({
        ok: tasks.answerUser(callId, answer),
      }),
    },
    logger,
  );
}
