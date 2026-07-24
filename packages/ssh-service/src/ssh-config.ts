/**
 * Read-only importer for `~/.ssh/config` (ADR-0047).
 *
 * Parses OpenSSH client config into flat per-alias entries, applying the
 * OpenSSH "first obtained value wins" rule across matching Host sections.
 * Unsupported directives (Include, Match) are skipped and surfaced as
 * warnings. Pure Node — no ssh2, no Electron. Malformed lines are tolerated.
 */
import type { SshConfigEntry, SshConfigParseResult } from './types.js';

interface Section {
  patterns: string[];
  settings: Array<[string, string]>;
}

/** Strip a single pair of surrounding double quotes, if present. */
function unquote(value: string): string {
  const t = value.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

/** Split "Key Value" / "Key=Value" / "Key = Value" into key + raw value. */
function splitKeyValue(line: string): { key: string; rawValue: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let i = 0;
  while (i < trimmed.length && !/[\s=]/.test(trimmed[i]!)) i++;
  const key = trimmed.slice(0, i);
  if (!key) return null;
  const rawValue = trimmed.slice(i).replace(/^\s*=?\s*/, '');
  return { key, rawValue };
}

function tokenize(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean).map(unquote);
}

/** An alias yields an entry only if it carries no glob/negation metacharacter. */
function isConcreteAlias(pattern: string): boolean {
  return !/[*?!]/.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  let body = '';
  for (const ch of pattern) {
    if (ch === '*') body += '.*';
    else if (ch === '?') body += '.';
    else body += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${body}$`);
}

/**
 * OpenSSH Host matching: applies when the alias matches at least one positive
 * pattern and no negated (`!`) pattern.
 */
function sectionMatches(patterns: string[], alias: string): boolean {
  let matchedPositive = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (globToRegExp(pattern.slice(1)).test(alias)) return false;
    } else if (globToRegExp(pattern).test(alias)) {
      matchedPositive = true;
    }
  }
  return matchedPositive;
}

function expandTilde(value: string, homedir: string): string {
  if (value === '~') return homedir;
  if (value.startsWith('~/')) return homedir + value.slice(1);
  return value;
}

function buildEntry(alias: string, resolved: Map<string, string>, homedir: string): SshConfigEntry {
  const host = resolved.get('hostname') ?? alias;

  let port = 22;
  const portRaw = resolved.get('port');
  if (portRaw !== undefined) {
    const n = Number.parseInt(portRaw, 10);
    if (Number.isFinite(n) && n > 0) port = n;
  }

  const username = resolved.get('user') ?? null;

  const identityRaw = resolved.get('identityfile');
  const identityFile = identityRaw !== undefined ? expandTilde(identityRaw, homedir) : null;

  let proxyJump: string | null = null;
  const proxyRaw = resolved.get('proxyjump');
  if (proxyRaw !== undefined) {
    const firstHop = proxyRaw.split(',')[0]?.trim();
    proxyJump = firstHop ? firstHop : null;
  }

  return { alias, host, port, username, identityFile, proxyJump };
}

export function parseSshConfig(text: string, opts: { homedir: string }): SshConfigParseResult {
  const sections: Section[] = [];
  const warnings: string[] = [];
  let current: Section | null = null;
  let inMatchBlock = false;
  let warnedInclude = false;
  let warnedMatch = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const kv = splitKeyValue(line);
    if (!kv) continue;
    const key = kv.key.toLowerCase();

    if (key === 'host') {
      inMatchBlock = false;
      const patterns = tokenize(kv.rawValue);
      if (patterns.length === 0) {
        current = null;
        continue;
      }
      current = { patterns, settings: [] };
      sections.push(current);
      continue;
    }

    if (key === 'match') {
      if (!warnedMatch) {
        warnings.push(`Match directive ignored: ${kv.rawValue}`);
        warnedMatch = true;
      }
      // A Match block is ignored up to the next Host section.
      inMatchBlock = true;
      current = null;
      continue;
    }

    if (key === 'include') {
      if (!warnedInclude) {
        warnings.push(`Include directive ignored: ${kv.rawValue}`);
        warnedInclude = true;
      }
      continue;
    }

    if (inMatchBlock || !current) continue;
    current.settings.push([key, unquote(kv.rawValue)]);
  }

  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const pattern of section.patterns) {
      if (isConcreteAlias(pattern) && !seen.has(pattern)) {
        seen.add(pattern);
        aliases.push(pattern);
      }
    }
  }

  const hosts: SshConfigEntry[] = [];
  for (const alias of aliases) {
    const resolved = new Map<string, string>();
    for (const section of sections) {
      if (!sectionMatches(section.patterns, alias)) continue;
      for (const [key, value] of section.settings) {
        if (!resolved.has(key)) resolved.set(key, value);
      }
    }
    hosts.push(buildEntry(alias, resolved, opts.homedir));
  }

  return { hosts, warnings };
}
