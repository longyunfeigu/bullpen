import type { PlanStep, TaskPlan } from '@pi-ide/agent-contract';
import type { PlanStepUpdate, ProposedPlanInput } from './tools-write.js';

/** Assign stable step ids and pending status to a freshly proposed plan (§13.2). */
export function normalizeProposedPlan(input: ProposedPlanInput, version: number): TaskPlan {
  return {
    version,
    summary: input.summary,
    steps: input.steps.map((step, i) => ({
      id: `step-${version}-${i + 1}`,
      title: step.title,
      ...(step.description !== undefined ? { description: step.description } : {}),
      status: 'pending' as const,
      ...(step.expectedFiles !== undefined ? { expectedFiles: step.expectedFiles } : {}),
      ...(step.verification !== undefined ? { verification: step.verification } : {}),
    })),
  };
}

export interface PlanEditInput {
  summary?: string;
  steps: Array<{ id?: string; title: string; description?: string }>;
}

export interface PlanEditResult {
  plan: TaskPlan;
  /** Steps that were already done and would be removed — needs explicit confirmation. */
  removedDone: PlanStep[];
  changed: boolean;
}

/**
 * Merge a user edit into the current plan (AG-008): text and order come from
 * the edit; status and metadata of surviving steps are preserved; brand-new
 * steps get fresh ids.
 */
export function applyPlanEdit(
  current: TaskPlan,
  edit: PlanEditInput,
  version: number,
): PlanEditResult {
  const byId = new Map(current.steps.map((s) => [s.id, s]));
  const steps: PlanStep[] = edit.steps.map((step, i) => {
    const prev = step.id ? byId.get(step.id) : undefined;
    const description = step.description ?? prev?.description;
    return {
      id: prev ? prev.id : `step-${version}-${i + 1}`,
      title: step.title,
      ...(description !== undefined ? { description } : {}),
      status: prev?.status ?? 'pending',
      ...(prev?.expectedFiles !== undefined ? { expectedFiles: prev.expectedFiles } : {}),
      ...(prev?.verification !== undefined ? { verification: prev.verification } : {}),
    };
  });
  const keptIds = new Set(steps.map((s) => s.id));
  const removedDone = current.steps.filter((s) => !keptIds.has(s.id) && s.status === 'done');
  const summary = edit.summary ?? current.summary;
  const shape = (plan: { summary: string; steps: PlanStep[] }) =>
    JSON.stringify({
      summary: plan.summary,
      steps: plan.steps.map((s) => ({ id: s.id, title: s.title, description: s.description })),
    });
  const changed = shape({ summary, steps }) !== shape(current);
  return { plan: { version, summary, steps }, removedDone, changed };
}

export interface PlanStatusDelta {
  id: string;
  from: PlanStep['status'];
  to: PlanStep['status'];
}

/** Apply agent status updates, returning the delta for the immutable event log. */
export function applyStatusUpdates(
  current: TaskPlan,
  updates: PlanStepUpdate[],
  version: number,
): { plan: TaskPlan; delta: PlanStatusDelta[] } {
  const wanted = new Map(updates.map((u) => [u.id, u.status]));
  const delta: PlanStatusDelta[] = [];
  const steps = current.steps.map((step) => {
    const to = wanted.get(step.id);
    if (to === undefined || to === step.status) return step;
    delta.push({ id: step.id, from: step.status, to });
    return { ...step, status: to };
  });
  return { plan: { ...current, version, steps }, delta };
}
