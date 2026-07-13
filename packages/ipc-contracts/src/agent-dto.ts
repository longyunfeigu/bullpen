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
