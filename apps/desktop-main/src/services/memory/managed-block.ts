/**
 * Managed-block projection for CLAUDE.md / AGENTS.md (ADR-0028).
 *
 * Charter only ever writes between its own begin/end markers; everything
 * outside the block is the user's and round-trips untouched. Pure string
 * logic + hashing, no IO.
 */
import { createHash } from 'node:crypto';

export const MANAGED_BLOCK_BEGIN =
  '<!-- charter:rules:begin — managed by Charter; edit outside this block -->';
export const MANAGED_BLOCK_END = '<!-- charter:rules:end -->';

const BEGIN_RE = /^[ \t]*<!--\s*charter:rules:begin\b[^>]*-->[ \t]*$/;
const END_RE = /^[ \t]*<!--\s*charter:rules:end\s*-->[ \t]*$/;

export interface ManagedBlock {
  /** Inner content between the marker lines (no trailing newline). */
  inner: string;
  /** Line index of the begin marker / the end marker. */
  beginLine: number;
  endLine: number;
}

export function extractManagedBlock(content: string): ManagedBlock | null {
  const lines = content.split('\n');
  let begin = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (begin === -1 && BEGIN_RE.test(line)) {
      begin = i;
      continue;
    }
    if (begin !== -1 && END_RE.test(line)) {
      return { inner: lines.slice(begin + 1, i).join('\n'), beginLine: begin, endLine: i };
    }
  }
  return null;
}

/** Replace the block inner (or append a new block at EOF when absent). */
export function upsertManagedBlock(content: string, inner: string): string {
  const block = extractManagedBlock(content);
  const rendered = `${MANAGED_BLOCK_BEGIN}\n${inner}\n${MANAGED_BLOCK_END}`;
  if (!block) {
    if (content.trim().length === 0) return `${rendered}\n`;
    const trimmed = content.replace(/\s+$/, '');
    return `${trimmed}\n\n${rendered}\n`;
  }
  const lines = content.split('\n');
  lines.splice(block.beginLine, block.endLine - block.beginLine + 1, ...rendered.split('\n'));
  const joined = lines.join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

/** Everything except the managed block (reverse-import scans this). */
export function contentOutsideManagedBlock(content: string): string {
  const block = extractManagedBlock(content);
  if (!block) return content;
  const lines = content.split('\n');
  return [...lines.slice(0, block.beginLine), ...lines.slice(block.endLine + 1)].join('\n');
}

/** CLAUDE.md projection: one import line — Claude Code expands @path natively. */
export function renderClaudeInner(): string {
  return '@.charter/rules.md';
}

/** AGENTS.md projection: rendered rule list (AGENTS.md has no import semantics). */
export function renderAgentsInner(enabledRuleTexts: string[]): string {
  if (enabledRuleTexts.length === 0) return '(no enabled project rules yet)';
  return enabledRuleTexts.map((text) => `- ${text}`).join('\n');
}

export function managedBlockHash(inner: string): string {
  return createHash('sha256').update(inner, 'utf8').digest('hex');
}

const FENCE_RE = /^\s*(```|~~~)/;
const BULLET_RE = /^[-*]\s+(.+?)\s*$/;

/**
 * Reverse import: pull top-level bullet conventions out of a hand-written
 * CLAUDE.md / AGENTS.md (managed block excluded by the caller). Kept
 * deliberately dumb — headings, fenced code and long prose are skipped;
 * the user approves each item before anything lands in the rules file.
 */
export function extractConventionBullets(content: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = BULLET_RE.exec(line);
    if (!match) continue;
    const text = (match[1] ?? '').trim();
    if (text.length < 8 || text.length > 500) continue;
    if (text.startsWith('[')) continue; // markdown link lists are rarely conventions
    out.push(text);
  }
  return out;
}
