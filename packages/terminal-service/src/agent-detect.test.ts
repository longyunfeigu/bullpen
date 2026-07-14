import { describe, expect, it } from 'vitest';
import {
  AgentStateTracker,
  commandMatchesAgent,
  DEFAULT_AGENT_CLIS,
  titleMatchesAgent,
} from './index.js';

describe('titleMatchesAgent (ADR-0017)', () => {
  it('matches bare and path-qualified CLI names, case-insensitively', () => {
    expect(titleMatchesAgent('claude', DEFAULT_AGENT_CLIS)).toBe('claude');
    expect(titleMatchesAgent('/Users/x/.local/bin/claude', DEFAULT_AGENT_CLIS)).toBe('claude');
    expect(titleMatchesAgent('Codex', DEFAULT_AGENT_CLIS)).toBe('codex');
  });

  it('does not match shells, editors or prefixed names', () => {
    expect(titleMatchesAgent('zsh', DEFAULT_AGENT_CLIS)).toBeNull();
    expect(titleMatchesAgent('vim', DEFAULT_AGENT_CLIS)).toBeNull();
    expect(titleMatchesAgent('claude-helper', DEFAULT_AGENT_CLIS)).toBeNull();
  });
});

describe('commandMatchesAgent (npm-installed CLIs run as node)', () => {
  it('finds the CLI in the leading argv tokens', () => {
    expect(commandMatchesAgent('node /usr/local/bin/claude', DEFAULT_AGENT_CLIS)).toBe('claude');
    expect(commandMatchesAgent('/opt/bin/node /x/codex --model gpt', DEFAULT_AGENT_CLIS)).toBe(
      'codex',
    );
  });

  it('ignores matches deep in the arguments (files named claude)', () => {
    expect(commandMatchesAgent('vim a b c ./notes/claude', DEFAULT_AGENT_CLIS)).toBeNull();
  });
});

describe('AgentStateTracker', () => {
  it('enters immediately and exits only after the grace streak', () => {
    const t = new AgentStateTracker(2);
    expect(t.update('claude')).toEqual({ agent: 'claude' });
    expect(t.agent).toBe('claude');
    // One shell flash (TUI spawning a child) must NOT end the session.
    expect(t.update(null)).toBeNull();
    expect(t.update('claude')).toBeNull(); // still the same session
    expect(t.update(null)).toBeNull();
    expect(t.update(null)).toEqual({ agent: null });
    expect(t.agent).toBeNull();
  });

  it('is quiet while idle and while the same agent keeps running', () => {
    const t = new AgentStateTracker(2);
    expect(t.update(null)).toBeNull();
    expect(t.update('codex')).toEqual({ agent: 'codex' });
    expect(t.update('codex')).toBeNull();
  });

  it('switching CLIs mid-terminal fires a fresh enter edge', () => {
    const t = new AgentStateTracker(2);
    t.update('claude');
    expect(t.update('codex')).toEqual({ agent: 'codex' });
  });
});
