import { z } from 'zod';

export const AgentModeSchema = z.enum(['ask', 'edit', 'auto']);
export const TaskStateSchema = z.enum([
  'DRAFT',
  'READY',
  'EXPLORING',
  'PLANNING',
  'AWAITING_PLAN_APPROVAL',
  'IN_PROGRESS',
  'AWAITING_PERMISSION',
  'VERIFYING',
  'REVIEW_READY',
  'ACCEPTED',
  'ROLLED_BACK',
  'INTERRUPTED',
  'FAILED',
  'CANCELLED',
  'ARCHIVED',
]);

export const ModelRefSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'max']).optional(),
});

export const VerificationCommandSchema = z.object({
  label: z.string().min(1).max(120),
  executable: z.string().min(1).max(200),
  args: z.array(z.string().max(500)).max(50),
  cwd: z.string().max(500).default(''),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30 * 60 * 1000)
    .default(300000),
});

export const TaskDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  goalMd: z.string(),
  acceptance: z.array(z.string()),
  mode: AgentModeSchema,
  state: TaskStateSchema,
  model: ModelRefSchema,
  verification: z.array(VerificationCommandSchema),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  gitBaseline: z.object({ head: z.string().nullable(), branch: z.string().nullable() }).nullable(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const TimelineEventDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sequence: z.number().int(),
  type: z.string(),
  schemaVersion: z.number().int(),
  at: z.string(),
  payload: z.unknown(),
});
export type TimelineEventDto = z.infer<typeof TimelineEventDtoSchema>;

export const RiskLevelSchema = z.enum(['R0', 'R1', 'R2', 'R3', 'R4']);

/** Approval card shown to the user (§13.3, PERM-004). */
export const PermissionCardDtoSchema = z.object({
  requestId: z.string(),
  callId: z.string(),
  runId: z.string(),
  taskId: z.string(),
  toolName: z.string(),
  toolDescription: z.string(),
  reason: z.string().nullable(),
  risk: z.object({ level: RiskLevelSchema, reasons: z.array(z.string()) }),
  preview: z.object({
    summary: z.string(),
    detail: z.string().optional(),
    diff: z.string().nullable().optional(),
    command: z
      .object({ executable: z.string(), args: z.array(z.string()), cwd: z.string() })
      .nullable()
      .optional(),
    targets: z.array(z.string()).optional(),
  }),
  input: z.unknown(),
  paramsHash: z.string(),
  options: z.object({
    allowScopes: z.array(z.enum(['once', 'task', 'workspace'])),
    denyScopes: z.array(z.enum(['once', 'always'])),
  }),
  createdAt: z.string(),
});
export type PermissionCardDto = z.infer<typeof PermissionCardDtoSchema>;

/** Clarifying question raised by the ask_user tool. */
export const AskUserPromptDtoSchema = z.object({
  callId: z.string(),
  taskId: z.string(),
  runId: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  allowFreeForm: z.boolean(),
  createdAt: z.string(),
});
export type AskUserPromptDto = z.infer<typeof AskUserPromptDtoSchema>;

export const ModelDescriptorDtoSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  contextWindow: z.number().nullable(),
  supportsThinking: z.boolean(),
  configured: z.boolean(),
  authKind: z.enum(['api-key', 'oauth', 'none', 'unknown']),
});
export type ModelDescriptorDto = z.infer<typeof ModelDescriptorDtoSchema>;
