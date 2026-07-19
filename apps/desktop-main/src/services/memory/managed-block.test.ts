import { describe, expect, it } from 'vitest';
import {
  contentOutsideManagedBlock,
  extractConventionBullets,
  extractManagedBlock,
  managedBlockHash,
  MANAGED_BLOCK_BEGIN,
  MANAGED_BLOCK_END,
  renderAgentsInner,
  renderClaudeInner,
  upsertManagedBlock,
} from './managed-block.js';

describe('managed-block (ADR-0028)', () => {
  it('appends a new block to a file with content, preserving the prose', () => {
    const original = '# My CLAUDE.md\n\nHand-written instructions.\n';
    const next = upsertManagedBlock(original, '@.charter/rules.md');
    expect(next).toContain('Hand-written instructions.');
    expect(next).toContain(MANAGED_BLOCK_BEGIN);
    expect(next.trimEnd().endsWith(MANAGED_BLOCK_END)).toBe(true);
    // Idempotent: same inner → byte-identical output.
    expect(upsertManagedBlock(next, '@.charter/rules.md')).toBe(next);
  });

  it('creates a bare block for an empty file', () => {
    const next = upsertManagedBlock('', 'inner');
    expect(next).toBe(`${MANAGED_BLOCK_BEGIN}\ninner\n${MANAGED_BLOCK_END}\n`);
  });

  it('replaces only the block, leaving surrounding prose untouched', () => {
    const doc = ['before', MANAGED_BLOCK_BEGIN, 'old', MANAGED_BLOCK_END, 'after', ''].join('\n');
    const next = upsertManagedBlock(doc, 'new-inner');
    expect(next).toContain('before');
    expect(next).toContain('after');
    expect(next).toContain('new-inner');
    expect(next).not.toContain('old');
  });

  it('extract tolerates annotation variants on the begin marker', () => {
    const doc = [
      '<!-- charter:rules:begin (v1, do not edit) -->',
      'x',
      '<!-- charter:rules:end -->',
    ].join('\n');
    expect(extractManagedBlock(doc)?.inner).toBe('x');
  });

  it('contentOutsideManagedBlock removes exactly the block', () => {
    const doc = ['keep1', MANAGED_BLOCK_BEGIN, 'managed', MANAGED_BLOCK_END, 'keep2'].join('\n');
    expect(contentOutsideManagedBlock(doc)).toBe('keep1\nkeep2');
    expect(contentOutsideManagedBlock('no block')).toBe('no block');
  });

  it('renders the two projections', () => {
    expect(renderClaudeInner()).toBe('@.charter/rules.md');
    expect(renderAgentsInner([])).toBe('(no enabled project rules yet)');
    expect(renderAgentsInner(['a', 'b'])).toBe('- a\n- b');
  });

  it('hashes are stable and content-sensitive', () => {
    expect(managedBlockHash('x')).toBe(managedBlockHash('x'));
    expect(managedBlockHash('x')).not.toBe(managedBlockHash('y'));
  });

  it('extractConventionBullets keeps plausible conventions only', () => {
    const doc = [
      '# Title',
      '- Use named exports everywhere in this repo',
      '- ok', // too short
      '- [link list](https://example.com)', // link list — likely nav, skipped by [ prefix
      '```',
      '- inside a fence is code, not a convention',
      '```',
      '* Asterisk bullets also count as conventions',
    ].join('\n');
    const bullets = extractConventionBullets(doc);
    expect(bullets).toEqual([
      'Use named exports everywhere in this repo',
      'Asterisk bullets also count as conventions',
    ]);
  });
});
