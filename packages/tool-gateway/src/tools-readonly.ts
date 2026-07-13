import { z } from 'zod';
import { listDirectory } from '@pi-ide/workspace-service';
import type { DocumentStore } from '@pi-ide/document-service';
import type { SearchService } from '@pi-ide/search-service';
import type { GitService } from '@pi-ide/git-service';
import type { ToolGateway } from './gateway.js';

export interface ReadOnlyToolServices {
  root: string;
  documents: DocumentStore;
  search: () => SearchService;
  git: () => GitService | null;
}

const CONTENT_CAP = 1024 * 1024;

/** R0 tools available in every mode (TOOL-003 read set). */
export function registerReadOnlyTools(gateway: ToolGateway, services: ReadOnlyToolServices): void {
  gateway.register({
    name: 'list_directory',
    version: 1,
    description:
      'List entries of a workspace directory (relative path, "" = root). Directories first.',
    inputSchema: z
      .object({
        path: z.string().default(''),
        showIgnored: z.boolean().default(false),
      })
      .strict(),
    risk: () => ({ level: 'R0', reasons: ['read-only directory listing'] }),
    preview: async (input) => ({ summary: `List ${input.path || '/'}` }),
    async execute(input) {
      const entries = await listDirectory(services.root, input.path, {
        showIgnored: input.showIgnored,
        extraIgnores: [],
      });
      return {
        code: 'OK',
        summary: `${entries.length} entries in ${input.path || '/'}`,
        data: { entries: entries.slice(0, 2000) },
      };
    },
  });

  gateway.register({
    name: 'read_file',
    version: 1,
    description:
      'Read a workspace file. Returns the logical content (unsaved editor state included), its revision hash, EOL style and whether it came from an unsaved buffer. Use the hash as baseHash when patching.',
    inputSchema: z
      .object({
        path: z.string().min(1),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      })
      .strict(),
    risk: () => ({ level: 'R0', reasons: ['read-only file read'] }),
    preview: async (input) => ({ summary: `Read ${input.path}`, targets: [input.path] }),
    async execute(input) {
      const logical = await services.documents.readLogical(input.path);
      if (logical.binary) {
        return {
          code: 'BINARY_FILE',
          summary: `${input.path} is binary (${logical.sizeBytes} bytes); content not returned.`,
          data: { binary: true, sizeBytes: logical.sizeBytes, hash: logical.hash },
        };
      }
      let content = logical.content;
      let lineInfo = '';
      if (input.startLine !== undefined || input.endLine !== undefined) {
        const lines = content.split('\n');
        const start = Math.max(1, input.startLine ?? 1);
        const end = Math.min(lines.length, input.endLine ?? lines.length);
        content = lines.slice(start - 1, end).join('\n');
        lineInfo = ` (lines ${start}-${end} of ${lines.length})`;
      }
      const truncated = content.length > CONTENT_CAP;
      if (truncated) content = content.slice(0, CONTENT_CAP);
      return {
        code: 'OK',
        summary: `Read ${input.path}${lineInfo}${logical.fromBuffer ? ' [unsaved buffer]' : ''}`,
        data: {
          content,
          hash: logical.hash,
          eol: logical.eol,
          fromBuffer: logical.fromBuffer,
          sizeBytes: logical.sizeBytes,
          truncated,
        },
      };
    },
  });

  gateway.register({
    name: 'search_text',
    version: 1,
    description:
      'Search text across the workspace (literal or regex). Results are grouped by file with line numbers.',
    inputSchema: z
      .object({
        query: z.string().min(1).max(1000),
        isRegex: z.boolean().default(false),
        caseSensitive: z.boolean().default(false),
        wholeWord: z.boolean().default(false),
        includeGlob: z.string().max(300).optional(),
        maxResults: z.number().int().min(1).max(2000).default(200),
      })
      .strict(),
    risk: () => ({ level: 'R0', reasons: ['read-only search'] }),
    preview: async (input) => ({ summary: `Search "${input.query.slice(0, 60)}"` }),
    async execute(input, signal) {
      const result = await services.search().textSearch(
        {
          query: input.query,
          isRegex: input.isRegex,
          caseSensitive: input.caseSensitive,
          wholeWord: input.wholeWord,
          ...(input.includeGlob ? { includeGlob: input.includeGlob } : {}),
          maxResults: input.maxResults,
        },
        signal,
      );
      const total = result.groups.reduce((n, g) => n + g.matches.length, 0);
      return {
        code: 'OK',
        summary: `${total} matches in ${result.groups.length} files${result.truncated ? ' (truncated)' : ''}`,
        data: {
          groups: result.groups.map((g) => ({
            path: g.path,
            contentHash: g.contentHash,
            matches: g.matches.slice(0, 50).map((m) => ({
              line: m.line,
              column: m.column,
              preview: m.previewText.slice(0, 240),
            })),
          })),
          truncated: result.truncated,
        },
      };
    },
  });

  gateway.register({
    name: 'git_status',
    version: 1,
    description: 'Git repository status: branch, staged/unstaged/untracked files.',
    inputSchema: z.object({}).strict(),
    risk: () => ({ level: 'R0', reasons: ['read-only git status'] }),
    preview: async () => ({ summary: 'git status' }),
    async execute() {
      const git = services.git();
      if (!git)
        return {
          code: 'NOT_A_REPO',
          summary: 'This workspace is not a git repository.',
          data: { isRepo: false },
        };
      const detect = await git.detect();
      if (!detect.isRepo) {
        return {
          code: 'NOT_A_REPO',
          summary: 'This workspace is not a git repository.',
          data: { isRepo: false },
        };
      }
      const status = await git.status();
      return {
        code: 'OK',
        summary: `branch ${status.branch ?? 'detached'}, ${status.entries.length} changed entries`,
        data: { isRepo: true, branch: status.branch, head: detect.head, entries: status.entries },
      };
    },
  });

  gateway.register({
    name: 'git_diff',
    version: 1,
    description: 'Unified diff of a file against HEAD (working tree), or the staged diff.',
    inputSchema: z.object({ path: z.string().min(1), staged: z.boolean().default(false) }).strict(),
    risk: () => ({ level: 'R0', reasons: ['read-only git diff'] }),
    preview: async (input) => ({ summary: `git diff ${input.path}`, targets: [input.path] }),
    async execute(input) {
      const git = services.git();
      if (!git)
        return { code: 'NOT_A_REPO', summary: 'Not a git repository.', data: { isRepo: false } };
      const diff = await git.diffFile(input.path, { staged: input.staged });
      return {
        code: 'OK',
        summary: diff.length === 0 ? 'No changes.' : `Diff for ${input.path}`,
        data: { diff: diff.slice(0, CONTENT_CAP), truncated: diff.length > CONTENT_CAP },
      };
    },
  });
}
