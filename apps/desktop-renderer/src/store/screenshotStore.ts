import { create } from 'zustand';
import type { ScreenshotCaptureDto } from '@pi-ide/ipc-contracts';

/**
 * ADR-0036: pending screenshot quick-card stack. The card shows the NEWEST
 * capture; older unhandled ones stay behind a "+N" badge. Acting on the shown
 * capture pops it (the next one surfaces, timer restarts); dismiss / timeout
 * clears the whole stack — ignoring screenshots must stay a zero-cost act.
 * Never persisted: a card only makes sense in the moment of capture.
 */
interface ScreenshotStore {
  /** queue[0] is the capture the card currently shows. */
  queue: ScreenshotCaptureDto[];
  /** Bumped on every add so the card can restart its auto-dismiss timer. */
  revision: number;
  add(capture: ScreenshotCaptureDto): void;
  /** The user acted on the shown capture — surface the next one, if any. */
  popCurrent(): void;
  /** ✕ / timeout — drop the entire stack, no side effects. */
  clear(): void;
}

export const useScreenshotStore = create<ScreenshotStore>((set, get) => ({
  queue: [],
  revision: 0,
  add(capture) {
    const { queue, revision } = get();
    if (queue.some((item) => item.path === capture.path)) return;
    set({ queue: [capture, ...queue], revision: revision + 1 });
  },
  popCurrent() {
    const { queue, revision } = get();
    if (queue.length === 0) return;
    set({ queue: queue.slice(1), revision: revision + 1 });
  },
  clear() {
    if (get().queue.length === 0) return;
    set({ queue: [], revision: get().revision + 1 });
  },
}));
