import { z } from 'zod';

/**
 * Project memory (ADR-0028): one shared rules source per project distilled
 * from review-gate corrections, injected into every managed run and optionally
 * projected into CLAUDE.md / AGENTS.md managed blocks for external CLIs.
 * Private per-CLI memory files are surfaced read-mostly (view/edit/delete/
 * promote) — never merged, never rewritten in the background.
 */

/** Where a candidate rule came from. */
export const MemoryCandidateOriginSchema = z.object({
  kind: z.enum(['request-fix', 'plan-changes', 'external-promote', 'reverse-import', 'manual']),
  taskId: z.string().nullable().default(null),
  /** Human provenance, e.g. "修复登录重定向 · Request fix". */
  label: z.string().nullable().default(null),
  /** Set for external-promote / reverse-import origins. */
  agent: z.enum(['claude', 'codex']).nullable().default(null),
  /** Home-shortened display path for file-derived candidates. */
  path: z.string().nullable().default(null),
});
export type MemoryCandidateOrigin = z.infer<typeof MemoryCandidateOriginSchema>;

/** One enabled/disabled rule parsed from .charter/rules.md. */
export const MemoryRuleDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  group: z.string(),
  enabled: z.boolean(),
  /** Provenance recorded locally (not in the shared file). Null for hand-written rules. */
  sourceTaskId: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  createdAt: z.string().nullable(),
  /** Observation: distinct managed tasks this rule was injected into. */
  injectedTasks: z.number().int().nonnegative(),
  /** Observation: later corrections that matched this rule again ("it slipped again"). */
  hitCount: z.number().int().nonnegative(),
  lastInjectedAt: z.string().nullable(),
});
export type MemoryRuleDto = z.infer<typeof MemoryRuleDtoSchema>;

/** A captured-but-unapproved rule (inline distill card + candidate queue). */
export const MemoryCandidateDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  origin: MemoryCandidateOriginSchema,
  /** How many similar corrections were seen (incl. this one). */
  similarCount: z.number().int().positive(),
  /** When the correction matches an existing enabled rule instead of proposing a new one. */
  matchedRuleId: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'dismissed']),
  createdAt: z.string(),
});
export type MemoryCandidateDto = z.infer<typeof MemoryCandidateDtoSchema>;

export const MemorySyncTargetSchema = z.enum(['claude-md', 'agents-md']);
export type MemorySyncTarget = z.infer<typeof MemorySyncTargetSchema>;

/** Managed-block projection state for one target file in one project. */
export const MemorySyncStateDtoSchema = z.object({
  target: MemorySyncTargetSchema,
  enabled: z.boolean(),
  /**
   * ok      = block present and byte-identical to what we last wrote
   * drift   = block edited by hand since our last write (never overwritten silently)
   * missing = file or block not present yet (sync will create it)
   * off     = projection disabled for this project
   * error   = last sync attempt failed (see detail)
   */
  status: z.enum(['ok', 'drift', 'missing', 'off', 'error']),
  /** Home-shortened display path of the target file. */
  filePath: z.string(),
  lastSyncedAt: z.string().nullable(),
  detail: z.string().nullable(),
});
export type MemorySyncStateDto = z.infer<typeof MemorySyncStateDtoSchema>;

export const ExternalMemoryAgentSchema = z.enum(['claude', 'codex']);
export type ExternalMemoryAgent = z.infer<typeof ExternalMemoryAgentSchema>;

/** One discovered private-memory file of an external CLI. Reads/writes stay in main. */
export const ExternalMemoryFileDtoSchema = z.object({
  /** Opaque stable id; the only accepted handle for read/write/delete/promote. */
  id: z.string(),
  agent: ExternalMemoryAgentSchema,
  scope: z.enum(['global', 'project']),
  /** instructions = hand-written CLAUDE.md/AGENTS.md; memory-index = MEMORY.md;
   * memory = one auto-memory note. */
  role: z.enum(['instructions', 'memory-index', 'memory']),
  label: z.string(),
  /** Home-shortened display path. */
  path: z.string(),
  /** First heading / first content line, for list rows. */
  summary: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  updatedAt: z.string(),
  /** False when the file exceeds caps or looks binary — view/edit disabled, delete allowed. */
  readable: z.boolean(),
});
export type ExternalMemoryFileDto = z.infer<typeof ExternalMemoryFileDtoSchema>;

/** Everything the memory panel needs for one project, in one round trip. */
export const MemoryOverviewDtoSchema = z.object({
  projectPath: z.string(),
  /** False when the path is not a registered workspace (panel shows guidance). */
  available: z.boolean(),
  rules: z.array(MemoryRuleDtoSchema),
  /** Group display order (file order; "未分组" last when present). */
  groups: z.array(z.string()),
  candidates: z.array(MemoryCandidateDtoSchema),
  stats: z.object({
    enabled: z.number().int().nonnegative(),
    /** Distinct managed tasks injected within the last 7 days. */
    injectedTasks7d: z.number().int().nonnegative(),
    /** Total "slipped again" correction hits across rules (all time — honest counter). */
    hitsTotal: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
  }),
  sync: z.array(MemorySyncStateDtoSchema),
  /** Absolute path of .charter/rules.md (open-in-editor affordance). */
  rulesFilePath: z.string(),
  rulesFileExists: z.boolean(),
});
export type MemoryOverviewDto = z.infer<typeof MemoryOverviewDtoSchema>;
