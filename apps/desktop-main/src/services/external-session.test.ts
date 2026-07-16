import { describe, expect, it } from 'vitest';
import { externalResumeCommand, isAccountablePath } from './external-session-service.js';

describe('isAccountablePath (ADR-0017)', () => {
  it('accepts ordinary project files', () => {
    expect(isAccountablePath('src/components/Composer.tsx')).toBe(true);
    expect(isAccountablePath('README.md')).toBe(true);
    expect(isAccountablePath('docs/adr/ADR-0017.md')).toBe(true);
  });

  it('rejects VCS and dependency noise anywhere in the path', () => {
    expect(isAccountablePath('.git/index')).toBe(false);
    expect(isAccountablePath('node_modules/react/index.js')).toBe(false);
    expect(isAccountablePath('packages/a/node_modules/b/x.js')).toBe(false);
  });

  it('rejects OS noise and the product’s own atomic-write temp files', () => {
    expect(isAccountablePath('.DS_Store')).toBe(false);
    expect(isAccountablePath('src/.DS_Store')).toBe(false);
    expect(isAccountablePath('src/.pi-ide-chg.123.456.tmp')).toBe(false);
  });
});

describe('externalResumeCommand', () => {
  it('targets the recorded conversation id when one exists (ADR-0017 amendment)', () => {
    const id = '924241d6-f2e8-444d-8d75-0386362bf52f';
    expect(externalResumeCommand('claude', id)).toBe(`claude --resume ${id}`);
    expect(externalResumeCommand('codex', id)).toBe(`codex resume ${id}`);
  });

  it('degrades to the last-session flag without an id', () => {
    expect(externalResumeCommand('claude')).toBe('claude --continue');
    expect(externalResumeCommand('claude', null)).toBe('claude --continue');
    expect(externalResumeCommand('codex')).toBe('codex resume --last');
  });

  it('never embeds a non-UUID id into PTY input', () => {
    expect(externalResumeCommand('claude', 'abc; rm -rf .')).toBe('claude --continue');
    expect(externalResumeCommand('claude', '$(evil)')).toBe('claude --continue');
    expect(externalResumeCommand('codex', 'not-a-uuid')).toBe('codex resume --last');
  });

  it('does not turn an arbitrary detected program name into shell input', () => {
    expect(externalResumeCommand('fakeagent')).toBeNull();
    expect(externalResumeCommand('claude; rm -rf .')).toBeNull();
  });
});
