import { promises as fs } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep, basename, dirname } from 'node:path';
import ignoreFactory from 'ignore';
import { productError, ProductFailure } from '@pi-ide/foundation';

export interface WorkspaceInfo {
  canonicalPath: string;
  displayName: string;
  isGitRepo: boolean;
  hasPiProjectResources: boolean;
}

export const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.DS_Store',
  '*.pyc',
  '.next',
  '.turbo',
  'target',
];

function wsError(
  code: string,
  userMessage: string,
  context?: Record<string, unknown>,
): ProductFailure {
  return new ProductFailure(productError(code, { userMessage, context }));
}

/** WS-001/002/015: canonicalize, validate and describe a workspace root. */
export async function openWorkspaceInfo(path: string): Promise<WorkspaceInfo> {
  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(path);
  } catch {
    throw wsError('WS_NOT_FOUND', 'That folder does not exist or cannot be accessed.', { path });
  }
  let stat;
  try {
    stat = await fs.stat(canonicalPath);
  } catch {
    throw wsError('WS_NOT_READABLE', 'The folder cannot be read.', { path });
  }
  if (!stat.isDirectory()) {
    throw wsError('WS_NOT_A_DIRECTORY', 'That path is a file. Choose a folder to open.', { path });
  }
  try {
    await fs.access(canonicalPath, fs.constants.R_OK);
  } catch {
    throw wsError('WS_NOT_READABLE', 'You do not have permission to read this folder.', { path });
  }

  const exists = async (rel: string) => {
    try {
      await fs.stat(join(canonicalPath, rel));
      return true;
    } catch {
      return false;
    }
  };

  return {
    canonicalPath,
    displayName: basename(canonicalPath),
    isGitRepo: await exists('.git'),
    hasPiProjectResources: (await exists('.pi')) || (await exists('.agents')),
  };
}

/**
 * WS-010/TOOL-005: resolve a workspace-relative path and verify BOTH the lexical
 * path and the final real path stay inside the canonical root. Non-existent
 * leaves are allowed (for creation) as long as the deepest existing ancestor is inside.
 */
export async function resolveInsideRoot(root: string, relativePath: string): Promise<string> {
  if (relativePath.includes('\u0000')) {
    throw wsError('WS_PATH_INVALID', 'The path contains invalid characters.');
  }
  if (isAbsolute(relativePath)) {
    throw wsError('WS_PATH_ESCAPE', 'Absolute paths are not allowed here.', { relativePath });
  }
  let rootNorm: string;
  try {
    rootNorm = normalize(await fs.realpath(root));
  } catch {
    throw wsError('WS_NOT_FOUND', 'The workspace root no longer exists.', { root });
  }
  const lexical = normalize(resolve(rootNorm, relativePath));
  if (lexical !== rootNorm && !lexical.startsWith(rootNorm + sep)) {
    throw wsError('WS_PATH_ESCAPE', 'The path escapes the workspace.', { relativePath });
  }
  // Walk to the deepest existing ancestor and realpath it (symlink escape check).
  let probe = lexical;
  const pending: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const realNorm = normalize(real);
      if (realNorm !== rootNorm && !realNorm.startsWith(rootNorm + sep)) {
        throw wsError('WS_PATH_ESCAPE', 'The path resolves outside the workspace.', {
          relativePath,
        });
      }
      return pending.length === 0 ? realNorm : join(realNorm, ...pending.reverse());
    } catch (e) {
      if (e instanceof ProductFailure) throw e;
      const parent = dirname(probe);
      if (parent === probe) {
        throw wsError('WS_PATH_INVALID', 'The path cannot be resolved.', { relativePath });
      }
      pending.push(basename(probe));
      probe = parent;
    }
  }
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  size: number | null;
  ignored: boolean;
}

export interface ListOptions {
  showIgnored: boolean;
  extraIgnores: string[];
}

/** WS-003/004/005: one directory level, dirs first, ignore rules applied. */
export async function listDirectory(
  root: string,
  relativeDir: string,
  options: ListOptions,
): Promise<DirEntry[]> {
  const abs = relativeDir === '' ? root : await resolveInsideRoot(root, relativeDir);
  const matcher = ignoreFactory().add(DEFAULT_IGNORES).add(options.extraIgnores);
  let dirents;
  try {
    dirents = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    throw wsError('WS_DIR_UNREADABLE', 'This directory cannot be read.', { relativeDir });
  }
  const out: DirEntry[] = [];
  for (const dirent of dirents) {
    const rel = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
    const testPath = dirent.isDirectory() ? `${rel}/` : rel;
    const ignored = matcher.ignores(testPath) || matcher.ignores(dirent.name);
    if (ignored && !options.showIgnored) continue;
    let kind: DirEntry['kind'] = 'other';
    if (dirent.isSymbolicLink()) kind = 'symlink';
    else if (dirent.isDirectory()) kind = 'dir';
    else if (dirent.isFile()) kind = 'file';
    let size: number | null = null;
    if (kind === 'file') {
      try {
        size = (await fs.stat(join(abs, dirent.name))).size;
      } catch {
        size = null;
      }
    }
    out.push({ name: dirent.name, kind, size, ignored });
  }
  out.sort((a, b) => {
    const ad = a.kind === 'dir' || a.kind === 'symlink' ? 0 : 1;
    const bd = b.kind === 'dir' || b.kind === 'symlink' ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return out;
}
