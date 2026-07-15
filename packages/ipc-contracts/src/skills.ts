import { z } from 'zod';

export const SkillSourceKindSchema = z.enum(['managed', 'agents', 'codex', 'claude', 'custom']);
export type SkillSourceKind = z.infer<typeof SkillSourceKindSchema>;

/** One directory Charter discovers skills from (ADR-0019). */
export const SkillSourceDtoSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: SkillSourceKindSchema,
  /** Display path only. All reads remain in main through SkillStore. */
  path: z.string(),
  available: z.boolean(),
  /** A trusted external source may offer enabled skills to the agent. */
  trusted: z.boolean(),
  /** Newly discovered skills inherit Auto when this is enabled. */
  autoEnableNew: z.boolean(),
  /** Built-in source definitions cannot be disconnected. */
  removable: z.boolean(),
  live: z.boolean(),
  skillCount: z.number().int().nonnegative(),
  lastScannedAt: z.string(),
});
export type SkillSourceDto = z.infer<typeof SkillSourceDtoSchema>;

/**
 * One managed or externally-linked skill as the renderer sees it
 * (ADR-0015 + ADR-0019). Project-local sources remain opt-in (AG-014).
 */
export const SkillDtoSchema = z.object({
  /** Stable catalog id. Managed skills preserve their legacy slug ids. */
  id: z.string(),
  /** Unique invocation name. Conflicts are qualified, e.g. pdf@claude. */
  name: z.string(),
  /** Original frontmatter name before conflict qualification. */
  displayName: z.string(),
  /** SKILL.md frontmatter `description`. */
  description: z.string(),
  /** User toggle: false = Off (disabled), true = Auto (enabled). */
  enabled: z.boolean(),
  /** Frontmatter `disable-model-invocation` — only `/skill:name`, never auto. */
  explicitOnly: z.boolean(),
  source: SkillSourceKindSchema,
  sourceId: z.string(),
  sourceLabel: z.string(),
  /** Home-shortened path for provenance/audit UI. */
  sourcePath: z.string(),
  /** Linked sources follow their owner; managed skills are copied snapshots. */
  live: z.boolean(),
  status: z.enum(['ready', 'conflict', 'invalid']),
  compatibility: z.enum(['compatible', 'needs-review']),
  issues: z.array(z.string()),
  /** Metadata/content revision written into load_skill results and audit trail. */
  revision: z.string(),
  /** Bundled files, relative to the skill root (for the audit view). */
  files: z.array(z.string()),
  /** How many bundled files look like executable scripts (audit signal). */
  scriptCount: z.number().int().nonnegative(),
  /** ISO import time. */
  importedAt: z.string(),
  /** Latest bundled-file mtime observed by discovery. */
  updatedAt: z.string(),
});
export type SkillDto = z.infer<typeof SkillDtoSchema>;
