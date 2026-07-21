/**
 * ADR-0038: fold task rows into the conversation-id → task index behind
 * session archaeology's "Tracked" badge and its Open target. A conversation
 * resumed across several tasks records the same CLI session id on each, so
 * duplicates must resolve to the task the user can still act on: non-archived
 * beats archived, then the latest activity wins. Pure so the preference rule
 * is unit-testable without a database.
 */

// A type alias (not an interface) so the sqlite row shape converts without an
// explicit index signature.
export type ExternalSessionRow = {
  id: string;
  external_json: string;
  archived: number;
  updated_at: string;
};

export function buildExternalSessionIndex(
  rows: readonly ExternalSessionRow[],
): Map<string, string> {
  const best = new Map<string, ExternalSessionRow>();
  for (const row of rows) {
    let sessionId: string | null | undefined;
    try {
      sessionId = (JSON.parse(row.external_json) as { sessionId?: string | null }).sessionId;
    } catch {
      // A malformed legacy row must not break discovery.
      continue;
    }
    if (!sessionId) continue;
    const key = sessionId.toLowerCase();
    const current = best.get(key);
    if (!current || prefer(row, current)) best.set(key, row);
  }
  return new Map([...best].map(([sessionId, row]) => [sessionId, row.id]));
}

function prefer(candidate: ExternalSessionRow, current: ExternalSessionRow): boolean {
  if ((candidate.archived === 0) !== (current.archived === 0)) return candidate.archived === 0;
  return candidate.updated_at > current.updated_at;
}
