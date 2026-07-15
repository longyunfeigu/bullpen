import { dialog } from 'electron';
import type { Logger } from '@pi-ide/foundation';
import { registerHandlers } from './router.js';
import type { SkillStore } from '../services/skill-store.js';

/** Skills manager (ADR-0015/0019): managed imports + linked source registry. */
export function registerSkillsHandlers(skills: SkillStore, logger: Logger): void {
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
    },
    logger,
  );
}
