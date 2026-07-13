import { describe, expect, it } from 'vitest';
import { applyPlanEdit, applyStatusUpdates, normalizeProposedPlan } from './plan-utils.js';

describe('normalizeProposedPlan', () => {
  it('assigns version-scoped ids and pending status', () => {
    const plan = normalizeProposedPlan(
      {
        summary: 'Fix the bug',
        steps: [
          { title: 'Read code', expectedFiles: ['src/a.ts'] },
          { title: 'Patch it', verification: 'npm test' },
        ],
      },
      1,
    );
    expect(plan.version).toBe(1);
    expect(plan.steps.map((s) => s.id)).toEqual(['step-1-1', 'step-1-2']);
    expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(plan.steps[0]!.expectedFiles).toEqual(['src/a.ts']);
    expect(plan.steps[1]!.verification).toBe('npm test');
  });
});

describe('applyPlanEdit (AG-008, §13.2)', () => {
  const current = normalizeProposedPlan(
    { summary: 'Original', steps: [{ title: 'one' }, { title: 'two' }, { title: 'three' }] },
    1,
  );

  it('preserves ids and status for surviving steps, reorders and retitles', () => {
    const edited = applyPlanEdit(
      current,
      {
        summary: 'Edited',
        steps: [
          { id: 'step-1-2', title: 'two (first now)' },
          { id: 'step-1-1', title: 'one' },
          { title: 'brand new step' },
        ],
      },
      2,
    );
    expect(edited.changed).toBe(true);
    expect(edited.plan.version).toBe(2);
    expect(edited.plan.summary).toBe('Edited');
    expect(edited.plan.steps[0]!.id).toBe('step-1-2');
    expect(edited.plan.steps[0]!.title).toBe('two (first now)');
    expect(edited.plan.steps[2]!.id).toBe('step-2-3');
    expect(edited.removedDone).toEqual([]); // 'three' was pending, silently droppable
  });

  it('flags removal of done steps for confirmation', () => {
    const withDone = {
      ...current,
      steps: current.steps.map((s, i) => (i === 0 ? { ...s, status: 'done' as const } : s)),
    };
    const edited = applyPlanEdit(
      withDone,
      {
        steps: [
          { id: 'step-1-2', title: 'two' },
          { id: 'step-1-3', title: 'three' },
        ],
      },
      2,
    );
    expect(edited.removedDone.map((s) => s.id)).toEqual(['step-1-1']);
  });

  it('reports changed=false for an identical round trip', () => {
    const same = applyPlanEdit(
      current,
      { steps: current.steps.map((s) => ({ id: s.id, title: s.title })) },
      2,
    );
    expect(same.changed).toBe(false);
  });
});

describe('applyStatusUpdates', () => {
  it('updates statuses and records the delta only for real changes', () => {
    const plan = normalizeProposedPlan(
      { summary: 's', steps: [{ title: 'a' }, { title: 'b' }] },
      1,
    );
    const { plan: next, delta } = applyStatusUpdates(
      plan,
      [
        { id: 'step-1-1', status: 'done' },
        { id: 'step-1-2', status: 'pending' }, // no-op
        { id: 'missing', status: 'done' }, // ignored
      ],
      2,
    );
    expect(next.steps[0]!.status).toBe('done');
    expect(delta).toEqual([{ id: 'step-1-1', from: 'pending', to: 'done' }]);
    expect(next.version).toBe(2);
  });
});
