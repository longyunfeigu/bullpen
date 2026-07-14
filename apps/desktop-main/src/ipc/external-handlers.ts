import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { ExternalSessionService } from '../services/external-session-service.js';

/** ADR-0017: external CLI agent session channels. */
export function registerExternalHandlers(sessions: ExternalSessionService, logger: Logger): void {
  registerHandlers(
    {
      'external.listSessions': async () => ({ sessions: sessions.list() }),
    },
    logger,
  );
}
