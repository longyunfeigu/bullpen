import { useEffect, useMemo, useState } from 'react';
import { useActivityStore } from '../store/activityStore.js';

/**
 * Presence glow (PIVOT-016): agent writes pulse the touched paths and their
 * task for a few seconds, then decay. Driven purely by recorded change events
 * from the activity stream — no filesystem watching, no polling.
 */
const GLOW_MS = 4000;

function useDecayTick(latestAt: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (latestAt === 0) return;
    const wait = Math.max(50, latestAt + GLOW_MS + 60 - Date.now());
    const timer = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [latestAt]);
  return tick;
}

/** Currently glowing workspace-relative paths, including ancestor directories. */
export function useGlowPaths(): Set<string> {
  const pulses = useActivityStore((s) => s.pulses);
  const latestAt = pulses.length > 0 ? pulses[pulses.length - 1]!.at : 0;
  const tick = useDecayTick(latestAt);
  return useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const pulse of pulses) {
      if (now - pulse.at >= GLOW_MS) continue;
      for (const path of pulse.paths) {
        set.add(path);
        let dir = path;
        while (dir.includes('/')) {
          dir = dir.slice(0, dir.lastIndexOf('/'));
          set.add(dir);
        }
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulses, tick]);
}

/** Task ids with a fresh write pulse. */
export function useGlowTasks(): Set<string> {
  const pulses = useActivityStore((s) => s.pulses);
  const latestAt = pulses.length > 0 ? pulses[pulses.length - 1]!.at : 0;
  const tick = useDecayTick(latestAt);
  return useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const pulse of pulses) {
      if (now - pulse.at < GLOW_MS) set.add(pulse.taskId);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulses, tick]);
}
