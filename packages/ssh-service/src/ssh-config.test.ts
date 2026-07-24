import { describe, expect, it } from 'vitest';
import { parseSshConfig } from './ssh-config.js';

const HOME = '/home/tester';

function parse(text: string) {
  return parseSshConfig(text, { homedir: HOME });
}

describe('parseSshConfig (SSH-CONFIG)', () => {
  it('evaluates multiple Host sections independently', () => {
    const { hosts } = parse(`
Host alpha
  HostName 10.0.0.1
  User alice
  Port 2201

Host beta
  HostName 10.0.0.2
  User bob
`);
    expect(hosts).toHaveLength(2);
    const alpha = hosts.find((h) => h.alias === 'alpha')!;
    expect(alpha).toMatchObject({ host: '10.0.0.1', username: 'alice', port: 2201 });
    const beta = hosts.find((h) => h.alias === 'beta')!;
    expect(beta).toMatchObject({ host: '10.0.0.2', username: 'bob', port: 22 });
  });

  it('applies Host * defaults with first-value-wins when the wildcard is last', () => {
    const { hosts } = parse(`
Host myhost
  HostName 1.2.3.4
  User specific

Host *
  User fallback
  Port 2200
`);
    const entry = hosts.find((h) => h.alias === 'myhost')!;
    // Specific section comes first, so its User wins; Port only in the wildcard.
    expect(entry.username).toBe('specific');
    expect(entry.port).toBe(2200);
    expect(entry.host).toBe('1.2.3.4');
  });

  it('lets a leading Host * win earlier for first-value-wins', () => {
    const { hosts } = parse(`
Host *
  User fallback

Host myhost
  HostName 1.2.3.4
  User specific
`);
    const entry = hosts.find((h) => h.alias === 'myhost')!;
    // The wildcard is evaluated first, so its User wins (classic OpenSSH gotcha).
    expect(entry.username).toBe('fallback');
  });

  it('defaults HostName to the alias and Port to 22', () => {
    const { hosts } = parse(`
Host bare
  User root
`);
    expect(hosts[0]).toMatchObject({
      alias: 'bare',
      host: 'bare',
      port: 22,
      username: 'root',
    });
  });

  it('handles quoted values and = separators', () => {
    const { hosts } = parse(`
Host quoted
  HostName="server.example.com"
  User = "deploy user"
`);
    const entry = hosts[0]!;
    expect(entry.host).toBe('server.example.com');
    expect(entry.username).toBe('deploy user');
  });

  it('expands ~ in IdentityFile and keeps only the first', () => {
    const { hosts } = parse(`
Host keyed
  IdentityFile ~/.ssh/id_ed25519
  IdentityFile ~/.ssh/other
`);
    expect(hosts[0]!.identityFile).toBe(`${HOME}/.ssh/id_ed25519`);
  });

  it('keeps only the first hop of ProxyJump', () => {
    const { hosts } = parse(`
Host jumped
  ProxyJump bastion.example.com:2222,inner.example.com
`);
    expect(hosts[0]!.proxyJump).toBe('bastion.example.com:2222');
  });

  it('lets wildcard Host patterns match without producing an entry', () => {
    const { hosts } = parse(`
Host *.internal
  User svc

Host web.internal
  HostName 10.9.0.1
`);
    // Only the concrete alias is emitted; the wildcard still contributes User.
    expect(hosts.map((h) => h.alias)).toEqual(['web.internal']);
    const entry = hosts[0]!;
    expect(entry.username).toBe('svc');
    expect(entry.host).toBe('10.9.0.1');
  });

  it('honours ! negation to exclude an alias from a section', () => {
    const { hosts } = parse(`
Host prod-a prod-b
  HostName placeholder

Host !prod-a *
  User general
`);
    const a = hosts.find((h) => h.alias === 'prod-a')!;
    const b = hosts.find((h) => h.alias === 'prod-b')!;
    // prod-a is excluded by !prod-a, so it gets no User; prod-b matches *.
    expect(a.username).toBeNull();
    expect(b.username).toBe('general');
  });

  it('warns once each for Include and Match, and ignores their scope', () => {
    const { hosts, warnings } = parse(`
Include ~/.ssh/config.d/*
Include /etc/ssh/extra

Host real
  HostName 10.0.0.9

Match host real
  User should-be-ignored

Host real2
  HostName 10.0.0.10
`);
    expect(warnings.filter((w) => w.startsWith('Include directive ignored'))).toHaveLength(1);
    expect(warnings.filter((w) => w.startsWith('Match directive ignored'))).toHaveLength(1);
    // The Match block must not leak its User into the following Host section.
    const real = hosts.find((h) => h.alias === 'real')!;
    expect(real.username).toBeNull();
    const real2 = hosts.find((h) => h.alias === 'real2')!;
    expect(real2.host).toBe('10.0.0.10');
  });

  it('tolerates malformed lines without throwing', () => {
    const { hosts } = parse(`
Host ok
  HostName 10.0.0.1
  ThisLineHasNoBusinessHere
  =
  Port notanumber
`);
    const entry = hosts[0]!;
    expect(entry.host).toBe('10.0.0.1');
    // A non-numeric Port falls back to the default.
    expect(entry.port).toBe(22);
  });
});
