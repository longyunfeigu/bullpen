import { beforeEach, describe, expect, it } from 'vitest';
import type { ScreenshotCaptureDto } from '@pi-ide/ipc-contracts';
import { useScreenshotStore } from './screenshotStore.js';

function capture(path: string): ScreenshotCaptureDto {
  return {
    path,
    name: path.split('/').pop() ?? path,
    sizeBytes: 10,
    capturedAtMs: 1,
    thumbDataUrl: '',
  };
}

beforeEach(() => {
  useScreenshotStore.setState({ queue: [], revision: 0 });
});

describe('screenshotStore', () => {
  it('shows the newest capture first and stacks older ones behind it', () => {
    const store = useScreenshotStore.getState();
    store.add(capture('/d/one.png'));
    store.add(capture('/d/two.png'));
    const { queue } = useScreenshotStore.getState();
    expect(queue.map((c) => c.name)).toEqual(['two.png', 'one.png']);
  });

  it('deduplicates by path', () => {
    const store = useScreenshotStore.getState();
    store.add(capture('/d/one.png'));
    store.add(capture('/d/one.png'));
    expect(useScreenshotStore.getState().queue).toHaveLength(1);
  });

  it('popCurrent surfaces the next capture; clear drops the whole stack', () => {
    const store = useScreenshotStore.getState();
    store.add(capture('/d/one.png'));
    store.add(capture('/d/two.png'));
    useScreenshotStore.getState().popCurrent();
    expect(useScreenshotStore.getState().queue.map((c) => c.name)).toEqual(['one.png']);
    useScreenshotStore.getState().add(capture('/d/three.png'));
    useScreenshotStore.getState().clear();
    expect(useScreenshotStore.getState().queue).toEqual([]);
  });

  it('bumps revision on every visible change so the card timer restarts', () => {
    const before = useScreenshotStore.getState().revision;
    useScreenshotStore.getState().add(capture('/d/one.png'));
    const afterAdd = useScreenshotStore.getState().revision;
    expect(afterAdd).toBeGreaterThan(before);
    useScreenshotStore.getState().popCurrent();
    expect(useScreenshotStore.getState().revision).toBeGreaterThan(afterAdd);
    // No-op pops/clears do not churn subscribers.
    useScreenshotStore.getState().popCurrent();
    useScreenshotStore.getState().clear();
    expect(useScreenshotStore.getState().revision).toBe(afterAdd + 1);
  });
});
