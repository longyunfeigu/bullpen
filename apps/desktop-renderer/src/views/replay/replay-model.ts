import type {
  ReplayChapterCategory,
  ReplayEvidenceLevel,
  ReplayFactDto,
  ReplaySessionDto,
} from '@pi-ide/ipc-contracts';

/**
 * Renderer-side replay helpers (Replay V3). All trust-critical derivation
 * (levels, story time, chapters, coverage) lives in @pi-ide/ipc-contracts —
 * this module only formats and routes what the projection already decided.
 */

export function formatReplayTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatDurationShort(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 6) / 10} h`;
}

export const KIND_ICON: Record<string, string> = {
  message: 'bot',
  question: 'help',
  answer: 'user',
  plan: 'map',
  'plan-decision': 'check',
  read: 'file',
  search: 'search',
  command: 'terminal',
  write: 'pencil',
  permission: 'shield',
  verification: 'checkCircle',
  review: 'eye',
  state: 'info',
  report: 'clipboard',
  system: 'sliders',
  user: 'user',
};

export const LEVEL_LABEL: Record<ReplayEvidenceLevel, string> = {
  verified: '已验证',
  recorded: '结构化记录',
  observed: '观察记录',
  inferred: '推导叙事',
  missing: '证据缺失',
};

export const CHAPTER_LABEL: Record<ReplayChapterCategory, string> = {
  request: '请求',
  approach: '方法',
  discovery: '发现',
  decision: '决策',
  pivot: '转折',
  change: '变更',
  problem: '问题',
  verification: '验证',
  result: '结果',
};

/** Short reversibility badge for outward-action rows — honest, never upgraded. */
export const REVERSIBILITY_BADGE: Record<ReplayFactDto['reversibility'], string> = {
  reversible: '可回滚',
  compensatable: '可补偿',
  irreversible: '不可逆',
  unknown: '可逆性未知',
};

export function labelSource(source: string): string {
  if (source === 'pi') return 'Pi Home';
  if (source === 'claude') return 'Claude Terminal';
  if (source === 'codex') return 'Codex Terminal';
  return 'External Terminal';
}

export function labelCapture(grade: string): string {
  if (grade === 'full') return '完整记录';
  if (grade === 'structured') return '结构化记录';
  return '观察记录';
}

export function labelReversibility(value: ReplayFactDto['reversibility']): string {
  switch (value) {
    case 'reversible':
      return '可回滚（字节级快照）';
    case 'compensatable':
      return '可补偿';
    case 'irreversible':
      return '不可逆';
    default:
      return '未知';
  }
}

/** UI grouping for filters/lanes — a presentation label, never an app identity claim. */
export function appLabel(fact: ReplayFactDto): string {
  if (fact.app) return fact.app;
  if (fact.kind === 'write' || fact.kind === 'read') return 'Files';
  if (fact.kind === 'command') return fact.toolName === 'terminal' ? 'Terminal' : 'Commands';
  if (fact.kind === 'search') return 'Search';
  if (fact.kind === 'verification') return 'Verification';
  if (fact.kind === 'permission' || fact.kind === 'review') return 'Approval';
  if (['message', 'question', 'answer', 'user'].includes(fact.kind)) return 'Conversation';
  if (['plan', 'plan-decision'].includes(fact.kind)) return 'Plan';
  return 'Agent';
}

// ---------- recap story rules (Replay V3.2, ADR-0035) ----------
// The ledger never changes; these rules only decide what the Recap depth
// puts on screen by default. Explore/Verify always show every fact.

/** Status heartbeats: real records, but never worth a story row of their own.
 * They are summarized (countable) in the story footer instead. */
export function isHeartbeatFact(fact: ReplayFactDto): boolean {
  return fact.kind === 'state' || fact.kind === 'system';
}

/**
 * A process error the session recorded and then outlived: a failed read /
 * search / status probe inside a session whose recorded outcome is
 * 'completed'. Rendered as a soft amber notice with the raw record demoted to
 * small print — never hidden, never red. Deterministic: recorded kind +
 * recorded outcome only; command/write/verification/permission failures stay
 * hard story beats.
 */
export function isSoftErrorFact(
  fact: ReplayFactDto,
  outcome: ReplaySessionDto['outcome'],
): boolean {
  return (
    fact.status === 'error' &&
    outcome === 'completed' &&
    (fact.kind === 'read' ||
      fact.kind === 'search' ||
      fact.kind === 'state' ||
      fact.kind === 'system')
  );
}

export interface ApprovalChip {
  /** The recorded approval fact the chip stands for (click → audit detail). */
  fact: ReplayFactDto;
  /** Its recorded pending request, folded into the same chip when joined. */
  requestFactId: string | null;
}

/**
 * Recorded approvals pinned to the fact they resolved. Sources are the
 * projection's id-backed `resolves` relations only (permission requestId →
 * callId chain, plan version join) — an approval without a joined target
 * keeps its own story row (fail open).
 */
export function approvalChipsByTarget(
  facts: readonly ReplayFactDto[],
): Map<string, ApprovalChip[]> {
  const map = new Map<string, ApprovalChip[]>();
  for (const fact of facts) {
    if (fact.status !== 'ok') continue;
    if (fact.kind !== 'permission' && fact.kind !== 'plan-decision') continue;
    const target = fact.relations.find((r) => r.type === 'resolves')?.factId;
    if (!target) continue;
    const requestFactId = fact.relations.find((r) => r.type === 'requested-by')?.factId ?? null;
    const list = map.get(target) ?? [];
    list.push({ fact, requestFactId });
    map.set(target, list);
  }
  return map;
}

export type StorySegment =
  | { type: 'fact'; fact: ReplayFactDto; inline: boolean }
  | { type: 'fold'; hidden: ReplayFactDto[] };

/** A fold bar must hide at least this many substantive facts — a bar that
 * hides 1–2 rows costs more than it saves. */
export const FOLD_MIN = 3;

/**
 * Render plan for the gaps between kept story nodes:
 * - chip-represented approvals never appear (they are already visible);
 * - all-heartbeat spans take no row at all — they are counted for the footer;
 * - fewer than FOLD_MIN substantive facts render inline as small rows;
 * - FOLD_MIN or more keep the countable, expandable fold bar (which also
 *   accounts for the heartbeats inside its span).
 * Every fact ends up exactly once: row, chip, inside a bar, or quiet-counted.
 */
export function buildStorySegments(input: {
  facts: readonly ReplayFactDto[];
  keptIds: ReadonlySet<string>;
  chippedIds: ReadonlySet<string>;
}): { segments: StorySegment[]; quietCount: number } {
  const { facts, keptIds, chippedIds } = input;
  const segments: StorySegment[] = [];
  let quietCount = 0;
  let gap: ReplayFactDto[] = [];
  const flushGap = () => {
    if (gap.length === 0) return;
    const substantive = gap.filter((item) => !isHeartbeatFact(item));
    if (substantive.length >= FOLD_MIN) {
      segments.push({ type: 'fold', hidden: gap });
    } else {
      quietCount += gap.length - substantive.length;
      for (const item of substantive) segments.push({ type: 'fact', fact: item, inline: true });
    }
    gap = [];
  };
  for (const fact of facts) {
    if (chippedIds.has(fact.id)) continue;
    if (keptIds.has(fact.id)) {
      flushGap();
      segments.push({ type: 'fact', fact, inline: false });
    } else {
      gap.push(fact);
    }
  }
  flushGap();
  return { segments, quietCount };
}

// ---------- artifact renderer registry ----------

/** Chosen by evidence/target type — never by agent name (§6.4). */
export type ArtifactRendererId =
  | 'file'
  | 'terminal'
  | 'approval'
  | 'verification'
  | 'message'
  | 'document'
  | 'spreadsheet'
  | 'web'
  | 'generic';

const DOCUMENT_PATH = /\.(md|markdown|txt|rst|adoc)$/i;
const SHEET_PATH = /\.(csv|tsv)$/i;

export function rendererFor(fact: ReplayFactDto): ArtifactRendererId {
  if (fact.kind === 'write' && (fact.changeIds?.length ?? 0) > 0) {
    const path = fact.paths[0] ?? '';
    if (DOCUMENT_PATH.test(path)) return 'document';
    if (SHEET_PATH.test(path)) return 'spreadsheet';
    return 'file';
  }
  if (fact.kind === 'permission') return 'approval';
  if (fact.kind === 'verification') return 'verification';
  if (fact.toolName === 'terminal' || (fact.kind === 'command' && fact.capture === 'observed')) {
    return 'terminal';
  }
  if (['message', 'question', 'answer', 'user'].includes(fact.kind)) return 'message';
  const resource = (fact.resource ?? '').toLowerCase();
  if (resource.startsWith('http://') || resource.startsWith('https://')) return 'web';
  return 'generic';
}

// ---------- question-shaped filters (§Explore) ----------

export type ReplayQuestionFilter =
  'all' | 'changed' | 'decisions' | 'attention' | 'approvals' | 'unverified';

export const QUESTION_FILTERS: Array<{ id: ReplayQuestionFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'changed', label: '发生了什么变化？' },
  { id: 'decisions', label: '做了哪些决策？' },
  { id: 'attention', label: '哪里需要注意？' },
  { id: 'approvals', label: '哪些需要审批？' },
  { id: 'unverified', label: '哪些尚未验证？' },
];

export function matchesQuestionFilter(fact: ReplayFactDto, filter: ReplayQuestionFilter): boolean {
  switch (filter) {
    case 'changed':
      return fact.lane === 'artifacts' || (fact.changeIds?.length ?? 0) > 0;
    case 'decisions':
      return ['permission', 'plan-decision', 'plan', 'review'].includes(fact.kind);
    case 'attention':
      return fact.status === 'error' || fact.status === 'denied' || fact.status === 'warn';
    case 'approvals':
      return fact.kind === 'permission';
    case 'unverified':
      return fact.level === 'observed' || fact.level === 'inferred' || fact.level === 'missing';
    default:
      return true;
  }
}

export function matchesSearch(fact: ReplayFactDto, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    fact.action.toLowerCase().includes(q) ||
    (fact.detail ?? '').toLowerCase().includes(q) ||
    fact.paths.some((p) => p.toLowerCase().includes(q)) ||
    appLabel(fact).toLowerCase().includes(q)
  );
}
