import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ToolGateway } from './gateway.js';

/**
 * Skills (ADR-0015/0019): one enabled managed or linked skill.
 * The provider callback resolves at call time, so Settings toggles apply to
 * running sessions immediately.
 */
export interface SkillProviderEntry {
  /** Slug the model/user addresses the skill by. */
  name: string;
  description: string;
  /** Absolute source directory. It is canonicalized before every read. */
  dir: string;
  /** Canonical directory observed by the trusted catalog scan. */
  canonicalDir?: string;
  /** Discovery revision for reproducible audit/result metadata. */
  revision?: string;
  source?: string;
}

const CONTENT_CAP = 256 * 1024;

/**
 * load_skill (ADR-0015): the ONLY way agent runs read skill content. It reads
 * from the product skill catalog — never the workspace — and is R0 read-only,
 * so it works in every mode. Each load lands in the tool audit + timeline,
 * which is exactly the AG-014 "loading must be auditable" requirement.
 */
export function registerSkillTool(
  gateway: ToolGateway,
  services: { skills: () => SkillProviderEntry[] },
): void {
  gateway.register({
    name: 'load_skill',
    version: 1,
    description:
      'Load an installed skill: returns its SKILL.md instructions, or a bundled reference file when `file` is given. ' +
      'Available skills are listed in your instructions; load one when the task matches its description.',
    inputSchema: z
      .object({
        name: z.string().min(1).max(96),
        /** Optional bundled file (relative to the skill folder); default SKILL.md. */
        file: z.string().min(1).max(512).optional(),
      })
      .strict(),
    risk: () => ({ level: 'R0', reasons: ['read-only skill load from a trusted source'] }),
    preview: async (input) => ({
      summary: input.file ? `Load skill ${input.name} · ${input.file}` : `Load skill ${input.name}`,
      targets: [input.name],
    }),
    async execute(input) {
      const skill = services.skills().find((s) => s.name === input.name);
      if (!skill) {
        const names = services
          .skills()
          .map((s) => s.name)
          .join(', ');
        return {
          code: 'SKILL_NOT_FOUND',
          summary: `No enabled skill named "${input.name}".${names ? ` Enabled skills: ${names}.` : ' No skills are enabled.'}`,
          data: {},
          retryable: false,
        };
      }
      let root: string;
      try {
        root = realpathSync(resolve(skill.dir));
      } catch {
        return {
          code: 'SKILL_SOURCE_MISSING',
          summary: `The source for skill "${skill.name}" is no longer available.`,
          data: { skill: skill.name, source: skill.source ?? null },
          retryable: true,
        };
      }
      if (skill.canonicalDir && root !== skill.canonicalDir) {
        return {
          code: 'SKILL_SOURCE_CHANGED',
          summary: `The source path for skill "${skill.name}" changed after discovery; rescan before loading it.`,
          data: { skill: skill.name, source: skill.source ?? null },
          retryable: true,
        };
      }
      const rel = input.file ?? 'SKILL.md';
      const logical = resolve(root, rel);
      if (logical !== root && !logical.startsWith(root + sep)) {
        return {
          code: 'SKILL_PATH_OUTSIDE',
          summary: `"${rel}" is outside the skill folder — only bundled files can be loaded.`,
          data: {},
          retryable: false,
        };
      }
      let abs: string;
      try {
        abs = realpathSync(logical === root ? join(root, 'SKILL.md') : logical);
      } catch {
        return {
          code: 'SKILL_FILE_NOT_FOUND',
          summary: `${rel} does not exist in skill "${skill.name}".`,
          data: { skill: skill.name, source: skill.source ?? null },
          retryable: false,
        };
      }
      // Lexical checks are insufficient once linked sources are supported:
      // canonicalize the target and reject nested symlinks escaping the root.
      if (abs !== root && !abs.startsWith(root + sep)) {
        return {
          code: 'SKILL_PATH_OUTSIDE',
          summary: `"${rel}" resolves outside the skill folder — linked files must stay bundled.`,
          data: { skill: skill.name, source: skill.source ?? null },
          retryable: false,
        };
      }
      let raw: Buffer;
      try {
        raw = readFileSync(abs);
      } catch {
        return {
          code: 'SKILL_FILE_NOT_FOUND',
          summary: `${rel} does not exist in skill "${skill.name}".`,
          data: {},
          retryable: false,
        };
      }
      if (raw.subarray(0, 8192).includes(0)) {
        return {
          code: 'BINARY_FILE',
          summary: `${rel} is binary (${raw.length} bytes); content not returned.`,
          data: { binary: true, sizeBytes: raw.length },
        };
      }
      const truncated = raw.length > CONTENT_CAP;
      const contentHash = createHash('sha256').update(raw).digest('hex');
      const revisionLabel = skill.revision ? skill.revision.slice(0, 12) : 'unversioned';
      return {
        code: 'OK',
        summary: `Loaded skill ${skill.name}${input.file ? ` · ${rel}` : ''} · ${skill.source ?? 'managed'} · rev ${revisionLabel}`,
        data: {
          skill: skill.name,
          file: rel,
          source: skill.source ?? 'managed',
          revision: skill.revision ?? null,
          contentHash,
          content: raw.subarray(0, CONTENT_CAP).toString('utf8'),
          truncated,
          note: 'Reference other bundled files with load_skill { name, file }. Scripts do not run by being loaded — use run_command, which follows the normal approval rules.',
        },
      };
    },
  });
}
