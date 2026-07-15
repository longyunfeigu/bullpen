import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '@pi-ide/ipc-contracts';
import {
  buildReplayTimeline,
  confidenceForActivity,
  indexAtTime,
  replayGrade,
} from './replay-model.js';

function item(at: string, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    key: at,
    taskId: 'task-1',
    sequence: 1,
    at,
    kind: 'message',
    label: 'event',
    status: 'ok',
    paths: [],
    author: 'agent',
    source: 'pi',
    captureGrade: 'full',
    ...overrides,
  };
}

describe('replay model', () => {
  it('uses actual wall-clock gaps and seeks to the latest event at a time', () => {
    const items = [
      item('2026-07-15T00:00:00.000Z'),
      item('2026-07-15T00:00:07.000Z'),
      item('2026-07-15T00:00:20.000Z'),
    ];
    const timeline = buildReplayTimeline(items);
    expect(timeline.offsets).toEqual([0, 7000, 20000]);
    expect(indexAtTime(timeline.offsets, 6999)).toBe(0);
    expect(indexAtTime(timeline.offsets, 7000)).toBe(1);
    expect(indexAtTime(timeline.offsets, 19999)).toBe(1);
  });

  it('promotes the session only from positively observed structured evidence', () => {
    expect(replayGrade([item('2026-07-15T00:00:00Z')])).toBe('full');
    expect(
      replayGrade([
        item('2026-07-15T00:00:00Z', {
          source: 'claude',
          captureGrade: 'observed',
        }),
      ]),
    ).toBe('observed');
    expect(
      replayGrade([
        item('2026-07-15T00:00:00Z', { captureGrade: 'observed' }),
        item('2026-07-15T00:00:01Z', { captureGrade: 'structured' }),
      ]),
    ).toBe('structured');
  });

  it('keeps observed terminal prose below durable file evidence confidence', () => {
    const terminal = item('2026-07-15T00:00:00Z', {
      kind: 'command',
      captureGrade: 'observed',
      evidenceKinds: ['terminal'],
    });
    const file = item('2026-07-15T00:00:01Z', {
      kind: 'write',
      captureGrade: 'observed',
      changeIds: ['chg-1'],
      evidenceKinds: ['file'],
    });
    expect(confidenceForActivity(file)).toBeGreaterThan(confidenceForActivity(terminal));
  });
});
