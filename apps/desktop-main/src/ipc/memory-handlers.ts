import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { MemoryService } from '../services/memory-service.js';

/** Project memory (ADR-0028): rules source, candidates, sync, external files. */
export function registerMemoryHandlers(memory: MemoryService, logger: Logger): void {
  registerHandlers(
    {
      'memory.tree': async () => memory.agentsTree(),
      'memory.overview': async ({ projectPath }) => memory.overview(projectPath),
      'memory.rules.add': async ({ projectPath, text, group, enabled, source }) => ({
        rule: memory.addRuleFromInput({
          projectPath,
          text,
          ...(group !== undefined ? { group } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(source !== undefined ? { source } : {}),
        }),
      }),
      'memory.rules.update': async ({ projectPath, ruleId, text, group, enabled }) => ({
        rule: memory.updateRuleFromInput({
          projectPath,
          ruleId,
          ...(text !== undefined ? { text } : {}),
          ...(group !== undefined ? { group } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        }),
      }),
      'memory.rules.remove': async ({ projectPath, ruleId }) => ({
        removed: memory.removeRuleById(projectPath, ruleId),
      }),
      'memory.candidates.forTask': async ({ taskId }) => memory.candidatesForTask(taskId),
      'memory.candidates.resolve': async ({
        projectPath,
        candidateId,
        action,
        editedText,
        group,
      }) => ({
        rule: memory.resolveCandidate({
          projectPath,
          candidateId,
          action,
          ...(editedText !== undefined ? { editedText } : {}),
          ...(group !== undefined ? { group } : {}),
        }),
      }),
      'memory.sync.setEnabled': async ({ projectPath, target, enabled }) => ({
        sync: memory.setSyncEnabled(projectPath, target, enabled),
      }),
      'memory.sync.apply': async ({ projectPath, target }) => ({
        sync: memory.applySync(projectPath, target),
      }),
      'memory.sync.resolveDrift': async ({ projectPath, target, action }) =>
        memory.resolveDrift(projectPath, target, action),
      'memory.import.scan': async ({ projectPath }) => memory.scanImport(projectPath),
      'memory.import.apply': async ({ projectPath, items }) => ({
        added: memory.applyImport(projectPath, items),
      }),
      'memory.external.list': async ({ projectPath }) => ({
        files: memory.externalList(projectPath),
      }),
      'memory.external.read': async ({ fileId }) => memory.externalRead(fileId),
      'memory.external.write': async ({ fileId, content, expectedMtimeMs }) => ({
        file: memory.externalWrite(fileId, content, expectedMtimeMs),
      }),
      'memory.external.delete': async ({ fileId }) => memory.externalDelete(fileId),
      'memory.external.promote': async ({ projectPath, fileId }) => ({
        candidate: memory.externalPromote(projectPath, fileId),
      }),
    },
    logger,
  );
}
