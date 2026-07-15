import type {
  ActivityItem,
  ReplayCaptureGrade,
  ReplayEvidenceKind,
  ReplaySource,
} from '@pi-ide/ipc-contracts';

export type ReplayMode = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ReplayTimeline {
  startMs: number;
  endMs: number;
  durationMs: number;
  offsets: number[];
}

export function buildReplayTimeline(items: readonly ActivityItem[]): ReplayTimeline {
  if (items.length === 0) return { startMs: 0, endMs: 0, durationMs: 0, offsets: [] };
  const parsed = items.map((item) => Date.parse(item.at));
  const valid = parsed.filter(Number.isFinite);
  const startMs = valid[0] ?? 0;
  const offsets: number[] = [];
  parsed.forEach((at, index) => {
    const wallClock = Number.isFinite(at) ? Math.max(0, at - startMs) : index * 650;
    // SQLite event timestamps can share one millisecond. Keep real gaps while
    // giving every event a seekable frame and a deterministic first step.
    offsets.push(index === 0 ? wallClock : Math.max(wallClock, (offsets[index - 1] ?? 0) + 1));
  });
  const last = Math.max(...offsets, 0);
  const terminalDuration = items.at(-1)?.durationMs ?? 0;
  const durationMs = Math.max(1_000, last + Math.max(0, terminalDuration ?? 0));
  return { startMs, endMs: startMs + durationMs, durationMs, offsets };
}

export function indexAtTime(offsets: readonly number[], playheadMs: number): number {
  if (offsets.length === 0) return 0;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((offsets[mid] ?? 0) <= playheadMs) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, Math.min(offsets.length - 1, hi));
}

export function formatReplayTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function replaySource(items: readonly ActivityItem[]): ReplaySource {
  return items.find((item) => item.source && item.source !== 'pi')?.source ?? 'pi';
}

export function replayGrade(items: readonly ActivityItem[]): ReplayCaptureGrade {
  if (items.some((item) => item.captureGrade === 'structured')) return 'structured';
  if (items.some((item) => item.captureGrade === 'observed')) return 'observed';
  return 'full';
}

export function evidenceKinds(item: ActivityItem): ReplayEvidenceKind[] {
  if (item.evidenceKinds && item.evidenceKinds.length > 0) return item.evidenceKinds;
  switch (item.kind) {
    case 'plan':
    case 'plan-decision':
      return ['plan'];
    case 'permission':
      return ['permission'];
    case 'verification':
      return ['verification', 'result'];
    case 'write':
      return ['file'];
    case 'command':
    case 'read':
    case 'search':
      return ['tool'];
    case 'message':
    case 'question':
    case 'answer':
    case 'user':
      return ['message'];
    case 'report':
      return ['result'];
    default:
      return [];
  }
}

export function appForActivity(item: ActivityItem): string {
  if (item.app) return item.app;
  if (item.kind === 'write' || item.kind === 'read') return 'Files';
  if (item.kind === 'command') return item.toolName === 'terminal' ? 'Terminal' : 'Commands';
  if (item.kind === 'search') return 'Search';
  if (item.kind === 'verification') return 'Verification';
  if (item.kind === 'permission' || item.kind === 'review') return 'Approval';
  if (['message', 'question', 'answer', 'user'].includes(item.kind)) return 'Conversation';
  if (['plan', 'plan-decision'].includes(item.kind)) return 'Plan';
  return 'Agent';
}

export function confidenceForActivity(item: ActivityItem): number {
  if (item.captureGrade === 'observed') {
    if (item.kind === 'write' && item.changeIds?.length) return 86;
    if (evidenceKinds(item).includes('terminal')) return 58;
    return 66;
  }
  if (item.kind === 'verification') return item.status === 'ok' ? 98 : 94;
  if (item.kind === 'permission' || item.kind === 'review') return 97;
  if (item.changeIds?.length) return 96;
  if (item.captureGrade === 'structured') return 91;
  return 93;
}

export function isDecision(item: ActivityItem): boolean {
  return (
    item.kind === 'plan' ||
    item.kind === 'plan-decision' ||
    item.kind === 'permission' ||
    item.kind === 'question' ||
    item.kind === 'review'
  );
}

export function chapterItems(items: readonly ActivityItem[], max = 7): ActivityItem[] {
  const meaningful = items.filter(
    (item) =>
      item.kind === 'user' ||
      item.kind === 'plan' ||
      item.kind === 'write' ||
      item.kind === 'verification' ||
      item.kind === 'report' ||
      item.status === 'error',
  );
  if (meaningful.length <= max) return meaningful;
  return Array.from({ length: max }, (_, index) => {
    const at = Math.round((index * (meaningful.length - 1)) / (max - 1));
    return meaningful[at]!;
  });
}
