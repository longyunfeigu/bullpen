import { create } from 'zustand';
import type { DiscoveredSessionDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { okOrToast, useAppStore } from './appStore.js';
import { useTaskStore } from './taskStore.js';

/**
 * ADR-0038 — session archaeology. `scan` mirrors the host's read-only sweep
 * over `~/.claude` / `~/.codex`; `adopt` runs the two-phase resume: the
 * renderer opens a terminal whose cwd the HOST resolves from the discovery
 * cache (`archaeology` context), then asks the host to inject the CLI's own
 * resume command and mint the external task.
 */

const SCAN_FRESH_MS = 60_000;

export function isDiscoveryStale(scannedAt: string | null, now = Date.now()): boolean {
  if (!scannedAt) return true;
  const at = Date.parse(scannedAt);
  return !Number.isFinite(at) || now - at > SCAN_FRESH_MS;
}

/** Sessions belonging to a scope path (project or discovered directory). */
export function sessionsInScope(
  sessions: DiscoveredSessionDto[],
  scope: string | null,
): DiscoveredSessionDto[] {
  if (scope === null) return sessions;
  return sessions.filter(
    (item) => item.projectPath === scope || item.cwd === scope || item.cwd.startsWith(`${scope}/`),
  );
}

/** ADR-0041 — status is a per-row fact (badge + button), not a grouping.
 * The list filters on it instead. */
export type ArchaeologyFilter = 'all' | 'external' | 'tracked';

export function filterSessions(
  sessions: DiscoveredSessionDto[],
  filter: ArchaeologyFilter,
): DiscoveredSessionDto[] {
  if (filter === 'all') return sessions;
  return sessions.filter((item) =>
    filter === 'tracked' ? item.trackedTaskId !== null : item.trackedTaskId === null,
  );
}

export interface SessionDayBucket {
  key: 'today' | 'yesterday' | 'week' | 'earlier' | 'undated';
  label: string;
  sessions: DiscoveredSessionDto[];
}

const DAY_MS = 86_400_000;

const BUCKET_ORDER: Array<[SessionDayBucket['key'], string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'Past 7 days'],
  ['earlier', 'Earlier'],
  ['undated', 'Undated'],
];

/** ADR-0041 — the archaeology timeline groups by local calendar day (episodic
 * recall: "the thing I ran yesterday"), one bucket per recall horizon rather
 * than per date so a 30-day window doesn't produce 30 headers. Input order is
 * preserved (the host already sorts by endedAt desc); empty buckets are
 * omitted. Rounding absorbs DST-shifted days. */
export function bucketSessionsByDay(
  sessions: DiscoveredSessionDto[],
  now = Date.now(),
): SessionDayBucket[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const buckets: Record<SessionDayBucket['key'], DiscoveredSessionDto[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
    undated: [],
  };
  for (const session of sessions) {
    const at = session.endedAt === null ? Number.NaN : Date.parse(session.endedAt);
    if (!Number.isFinite(at)) {
      buckets.undated.push(session);
      continue;
    }
    const startOfThatDay = new Date(at);
    startOfThatDay.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((startOfToday.getTime() - startOfThatDay.getTime()) / DAY_MS);
    if (daysAgo <= 0) buckets.today.push(session);
    else if (daysAgo === 1) buckets.yesterday.push(session);
    else if (daysAgo < 7) buckets.week.push(session);
    else buckets.earlier.push(session);
  }
  return BUCKET_ORDER.filter(([key]) => buckets[key].length > 0).map(([key, label]) => ({
    key,
    label,
    sessions: buckets[key],
  }));
}

/** Directories with agent activity that Charter has never opened as projects
 * (the "Agent activity · 30d" list) — grouped by cwd, newest first. */
export function unknownDirectories(
  sessions: DiscoveredSessionDto[],
): Array<{ cwd: string; count: number; lastAt: string | null; clis: string[] }> {
  const groups = new Map<string, { count: number; lastAt: string | null; clis: Set<string> }>();
  for (const session of sessions) {
    if (session.projectPath !== null) continue;
    const group = groups.get(session.cwd) ?? { count: 0, lastAt: null, clis: new Set<string>() };
    group.count += 1;
    group.clis.add(session.cli);
    if (session.endedAt && (!group.lastAt || session.endedAt > group.lastAt)) {
      group.lastAt = session.endedAt;
    }
    groups.set(session.cwd, group);
  }
  return [...groups.entries()]
    .map(([cwd, group]) => ({
      cwd,
      count: group.count,
      lastAt: group.lastAt,
      clis: [...group.clis].sort(),
    }))
    .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
}

interface ArchaeologyStore {
  sessions: DiscoveredSessionDto[];
  scannedAt: string | null;
  enabled: boolean;
  loading: boolean;
  /** sessionId being adopted — one adoption at a time. */
  adoptingId: string | null;
  /** Fresh-enough results are reused; `force` is the explicit Rescan button. */
  scan(force?: boolean): Promise<void>;
  adopt(session: DiscoveredSessionDto): Promise<void>;
}

export const useArchaeologyStore = create<ArchaeologyStore>((set, get) => ({
  sessions: [],
  scannedAt: null,
  enabled: true,
  loading: false,
  adoptingId: null,

  async scan(force = false) {
    if (get().loading) return;
    if (!force && !isDiscoveryStale(get().scannedAt)) return;
    set({ loading: true });
    try {
      const res = await rpcResult('archaeology.scan', {});
      if (!res.ok) return; // Discovery is ambient — a failed sweep stays quiet.
      set({
        sessions: res.data.sessions,
        scannedAt: res.data.scannedAt,
        enabled: res.data.enabled,
      });
    } finally {
      set({ loading: false });
    }
  },

  async adopt(session) {
    if (get().adoptingId) return;
    const app = useAppStore.getState();
    if (session.trackedTaskId) {
      // Never adopt twice — the conversation already lives in a Session.
      void useTaskStore.getState().openTask(session.trackedTaskId);
      app.openTaskRoom(session.trackedTaskId);
      return;
    }
    set({ adoptingId: session.sessionId });
    try {
      // Deferred import: TerminalPanel drags xterm/monaco along — fine in the
      // renderer, fatal for node-side unit tests of this store's pure half.
      const { useTerminalStore } = await import('../views/TerminalPanel.js');
      const terminals = useTerminalStore.getState();
      const terminalId = await terminals.create({
        context: { kind: 'archaeology', cli: session.cli, sessionId: session.sessionId },
        title: `${session.cli} resume`,
      });
      if (!terminalId) return;
      useTerminalStore.setState({ active: terminalId });
      const result = await rpcResult('archaeology.adopt', {
        cli: session.cli,
        sessionId: session.sessionId,
        terminalId,
      });
      if (!okOrToast(result)) return;
      app.pushToast('success', `Resumed the ${session.cli} conversation as a new session.`);
      await useTaskStore.getState().refreshTasks();
      void useTaskStore.getState().openTask(result.data.taskId);
      useAppStore.getState().openTaskRoom(result.data.taskId);
      // The adopted conversation is now tracked — reflect it without a rescan.
      set({
        sessions: get().sessions.map((item) =>
          item.cli === session.cli && item.sessionId === session.sessionId
            ? { ...item, trackedTaskId: result.data.taskId }
            : item,
        ),
      });
    } finally {
      set({ adoptingId: null });
    }
  },
}));
