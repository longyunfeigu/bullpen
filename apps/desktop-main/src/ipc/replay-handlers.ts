import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';
import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { ReplayService } from '../services/replay-service.js';

/** Replay V3 (ADR-0017 am.8): session contract, paginated facts, evidence,
 * evidence-bounded ask and the (unsigned) evidence receipt export. */
export function registerReplayHandlers(replay: ReplayService, logger: Logger): void {
  registerHandlers(
    {
      'task.replaySession': async ({ taskId }) => replay.session(taskId),
      'task.replayEvents': async ({ taskId, afterSequence, limit }) =>
        replay.events(taskId, { afterSequence, limit }),
      'task.replayEvidence': async ({ taskId, evidenceId }) => ({
        evidence: await replay.evidence(taskId, evidenceId),
      }),
      'task.replayAsk': async ({ taskId, factId, question }) =>
        replay.ask(taskId, factId, question),
      'task.replayReceipt': async ({ taskId }) => {
        const receipt = replay.receipt(taskId);
        let htmlPath: string | null;
        if (process.env.PI_IDE_E2E) {
          // Headless runs cannot answer a native save dialog.
          htmlPath = join(app.getPath('userData'), `${receipt.suggestedName}.html`);
        } else {
          const chosen = await dialog.showSaveDialog({
            title: 'Export replay evidence receipt',
            defaultPath: join(app.getPath('downloads'), `${receipt.suggestedName}.html`),
            filters: [{ name: 'HTML receipt', extensions: ['html'] }],
          });
          htmlPath = chosen.canceled || !chosen.filePath ? null : chosen.filePath;
        }
        if (!htmlPath) return { htmlPath: null, jsonPath: null, manifestSha256: null };
        const jsonPath = htmlPath.replace(/\.html?$/i, '') + '.json';
        writeFileSync(htmlPath, receipt.html, 'utf8');
        writeFileSync(jsonPath, receipt.json, 'utf8');
        logger.info('replay.receipt.exported', { taskId, htmlPath });
        return { htmlPath, jsonPath, manifestSha256: receipt.manifestSha256 };
      },
    },
    logger,
  );
}
