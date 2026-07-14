import { beforeEach, describe, expect, test, vi } from 'vitest';

// The module keeps run-once state at module level, so each test gets a
// fresh copy via resetModules + dynamic import.
async function freshInitModule() {
  vi.resetModules();
  return import('./init.js');
}

describe('workbench init registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('runInitsOnce runs each registered init exactly once even when invoked twice (StrictMode double-mount)', async () => {
    const { initRegistry, runInitsOnce } = await freshInitModule();
    let calls = 0;
    initRegistry.push(() => {
      calls += 1;
    });

    runInitsOnce();
    runInitsOnce();

    expect(calls).toBe(1);
  });

  test('runInitsOnce reports whether this call performed the initialization', async () => {
    const { runInitsOnce } = await freshInitModule();

    expect(runInitsOnce()).toBe(true);
    expect(runInitsOnce()).toBe(false);
  });
});
