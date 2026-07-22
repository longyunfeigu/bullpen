import type { Logger } from '@pi-ide/foundation';
import type { ArtifactService } from '../services/artifact-service.js';
import { registerHandlers } from './router.js';

export function registerArtifactHandlers(artifacts: ArtifactService, logger: Logger): void {
  registerHandlers(
    {
      'artifact.list': async ({ taskId }) => ({ artifacts: await artifacts.list(taskId) }),
      'artifact.open': async (input) => artifacts.open(input),
      'artifact.reveal': async ({ taskId, path, action }) => {
        await artifacts.reveal(taskId, path, action);
        return { ok: true };
      },
    },
    logger,
  );
}
