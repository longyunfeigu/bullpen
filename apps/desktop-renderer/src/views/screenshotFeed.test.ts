import { describe, expect, it } from 'vitest';
import type { TaskDto } from '@pi-ide/ipc-contracts';
import { annotatedName, resolveFeedRoute } from './screenshotFeed.js';

const PROJECT = '/Users/u/code/app';

function task(overrides: Partial<TaskDto>): TaskDto {
  return {
    id: 't1',
    projectPath: PROJECT,
    external: null,
    ...overrides,
  } as TaskDto;
}

describe('resolveFeedRoute (ADR-0036)', () => {
  it('routes a managed Pi Session to the composer attachment path', () => {
    expect(resolveFeedRoute('t1', [task({})], PROJECT)).toEqual({ kind: 'pi', taskId: 't1' });
  });

  it('routes an active external CLI Session to the inject path with its CLI name', () => {
    const external = task({
      external: { cli: 'claude', terminalId: 'term1', snapshotRef: null, status: 'active' },
    });
    expect(resolveFeedRoute('t1', [external], PROJECT)).toEqual({
      kind: 'external',
      taskId: 't1',
      cli: 'claude',
    });
  });

  it('falls back to none when the external Session has ended (resume first)', () => {
    const ended = task({
      external: { cli: 'codex', terminalId: 'term1', snapshotRef: null, status: 'ended' },
    });
    expect(resolveFeedRoute('t1', [ended], PROJECT)).toEqual({ kind: 'none' });
  });

  it('falls back to none when the external Session belongs to another project', () => {
    // @-references are project-relative by contract (ADR-0030) — injecting a
    // path from a different open workspace would point the CLI at nothing.
    const external = task({
      external: { cli: 'claude', terminalId: 'term1', snapshotRef: null, status: 'active' },
    });
    expect(resolveFeedRoute('t1', [external], '/Users/u/code/other')).toEqual({ kind: 'none' });
  });

  it('falls back to none without an active Session', () => {
    expect(resolveFeedRoute(null, [task({})], PROJECT)).toEqual({ kind: 'none' });
    expect(resolveFeedRoute('missing', [task({})], PROJECT)).toEqual({ kind: 'none' });
  });
});

describe('annotatedName', () => {
  it('marks the annotated copy and forces .png', () => {
    expect(annotatedName('Screenshot 2026-07-20 at 15.42.31.png')).toBe(
      'Screenshot 2026-07-20 at 15.42.31.annotated.png',
    );
    expect(annotatedName('capture.jpg')).toBe('capture.annotated.png');
    expect(annotatedName('no-extension')).toBe('no-extension.annotated.png');
  });
});
