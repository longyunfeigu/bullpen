import { describe, expect, it } from 'vitest';
import {
  formatConsoleSteer,
  isWriteToolName,
  mergeEntry,
  shouldAutoForward,
  WRITE_ATTRIBUTION_MS,
  type ConsoleEntry,
} from './preview-console.js';

/** ADR-0022 am.2 — console self-heal guardrails. */

const err = (
  message: string,
  over: Partial<ConsoleEntry> = {},
): Omit<ConsoleEntry, 'count' | 'at'> => ({
  level: 'error',
  message,
  sourceId: 'http://localhost:4173/app.js',
  line: 42,
  ...over,
});

describe('mergeEntry (dedupe)', () => {
  it('same message+source+line increments count instead of stacking', () => {
    let list: ConsoleEntry[] = [];
    let r = mergeEntry(list, err('boom'), 1000);
    expect(r.isNew).toBe(true);
    r = mergeEntry(r.list, err('boom'), 2000);
    expect(r.isNew).toBe(false);
    expect(r.list).toHaveLength(1);
    expect(r.list[0]!.count).toBe(2);
    r = mergeEntry(r.list, err('other'), 3000);
    expect(r.isNew).toBe(true);
    expect(r.list).toHaveLength(2);
  });
});

describe('shouldAutoForward (它弄坏的它自己修 — and only then)', () => {
  const base = { lastWriteAt: 10000, sentForWriteAt: null, sentThisRun: 0 };

  it('forwards inside the write-attribution window while running', () => {
    expect(shouldAutoForward({ setting: 'auto', taskRunning: true, state: base, now: 12000 })).toBe(
      true,
    );
  });
  it('never forwards when manual/off, idle, or with no write at all', () => {
    expect(
      shouldAutoForward({ setting: 'manual', taskRunning: true, state: base, now: 12000 }),
    ).toBe(false);
    expect(shouldAutoForward({ setting: 'off', taskRunning: true, state: base, now: 12000 })).toBe(
      false,
    );
    expect(
      shouldAutoForward({ setting: 'auto', taskRunning: false, state: base, now: 12000 }),
    ).toBe(false);
    expect(
      shouldAutoForward({
        setting: 'auto',
        taskRunning: true,
        state: { ...base, lastWriteAt: null },
        now: 12000,
      }),
    ).toBe(false);
  });
  it('errors long after the write are not the agent’s (third-party noise)', () => {
    expect(
      shouldAutoForward({
        setting: 'auto',
        taskRunning: true,
        state: base,
        now: 10000 + WRITE_ATTRIBUTION_MS + 1,
      }),
    ).toBe(false);
  });
  it('one send per write burst; capped per run', () => {
    expect(
      shouldAutoForward({
        setting: 'auto',
        taskRunning: true,
        state: { ...base, sentForWriteAt: 10000 },
        now: 12000,
      }),
    ).toBe(false);
    expect(
      shouldAutoForward({
        setting: 'auto',
        taskRunning: true,
        state: { ...base, sentThisRun: 5 },
        now: 12000,
      }),
    ).toBe(false);
  });
});

describe('formatConsoleSteer', () => {
  it('compact, sourced, capped at 5 lines', () => {
    const entries: ConsoleEntry[] = Array.from({ length: 7 }, (_, i) => ({
      ...err(`e${i}`),
      count: i === 0 ? 3 : 1,
      at: 0,
    }));
    const text = formatConsoleSteer(entries, 'http://localhost:4173/');
    expect(text).toContain('[Preview console] 7 errors');
    expect(text).toContain('- e0 (app.js:42) ×3');
    expect(text).toContain('(+2 more)');
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5);
  });
});

describe('isWriteToolName', () => {
  it('write tools yes, read tools no', () => {
    expect(isWriteToolName('apply_patch')).toBe(true);
    expect(isWriteToolName('write_file')).toBe(true);
    expect(isWriteToolName('read_file')).toBe(false);
    expect(isWriteToolName(undefined)).toBe(false);
  });
});
