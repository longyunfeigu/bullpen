import { dialog } from 'electron';
import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { SkillStore } from '../services/skill-store.js';
import { composeSkillUsage, type SkillUsageAggregate } from '../services/skill-usage.js';

export interface SkillsHandlerDeps {
  /**
   * ADR-0037: invocation aggregation lives with the task database. The
   * callback indirection tolerates the TaskService being constructed after
   * these handlers register (usage reads empty until then).
   */
  usage?: (windowDays: number) => Map<string, SkillUsageAggregate>;
}

const USAGE_WINDOW_DAYS_DEFAULT = 45;

/** Skills manager (ADR-0015/0019): managed imports + linked source registry. */
export function registerSkillsHandlers(
  skills: SkillStore,
  logger: Logger,
  deps: SkillsHandlerDeps = {},
): void {
  registerHandlers(
    {
      'skills.list': async () => skills.rescan('ipc-list'),
      'skills.rescan': async () => skills.rescan('manual'),
      'skills.import': async ({ dir }) => {
        let source = dir ?? null;
        if (!source) {
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Import skill folder (must contain SKILL.md)',
            buttonLabel: 'Import',
          });
          source = result.canceled ? null : (result.filePaths[0] ?? null);
        }
        if (!source) return { skill: null };
        return { skill: skills.import(source) };
      },
      'skills.addSource': async ({ dir }) => {
        let source = dir ?? null;
        if (!source) {
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Connect a live skill source',
            buttonLabel: 'Connect',
          });
          source = result.canceled ? null : (result.filePaths[0] ?? null);
        }
        if (!source) return { source: null };
        return { source: skills.addSource(source) };
      },
      'skills.removeSource': async ({ id }) => ({ removed: skills.removeSource(id) }),
      'skills.setSourcePolicy': async ({ id, trusted, autoEnableNew }) => ({
        source: skills.setSourcePolicy(id, {
          ...(trusted !== undefined ? { trusted } : {}),
          ...(autoEnableNew !== undefined ? { autoEnableNew } : {}),
        }),
      }),
      'skills.remove': async ({ id }) => ({ removed: skills.remove(id) }),
      'skills.setEnabled': async ({ id, enabled }) => ({ skill: skills.setEnabled(id, enabled) }),
      'skills.read': async ({ id, relPath }) => skills.readFile(id, relPath),
      // ADR-0037: usage insight — catalog joined with ledger counts + the
      // preamble cost each enabled skill charges on every turn.
      'skills.usage': async ({ windowDays }) => {
        const days = windowDays ?? USAGE_WINDOW_DAYS_DEFAULT;
        const catalog = skills.list();
        const estimates = skills.preambleTokenEstimates();
        const usage = deps.usage?.(days) ?? new Map<string, SkillUsageAggregate>();
        return {
          windowDays: days,
          since: new Date(Date.now() - days * 86_400_000).toISOString(),
          preambleOverheadTokens: estimates.overheadTokens,
          skills: composeSkillUsage(catalog, estimates, usage, days),
        };
      },
    },
    logger,
  );
}
