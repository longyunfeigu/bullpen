import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { productError, ProductFailure, type Logger } from '@pi-ide/foundation';

/**
 * Local project creation (Home → New project…): an empty directory (optional
 * `git init`) or a `git clone`. Runs the system git binary — clone supports
 * only non-interactive auth (public repos or credentials already configured
 * for git/SSH); interactive prompts are disabled so a missing credential
 * fails fast with a clear message instead of hanging.
 */

const NAME_RE = /^[^/\\:*?"<>|]+$/;

function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // never hang on credential prompts
        GIT_ASKPASS: 'true', // "true" binary: returns empty instead of asking
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr += '\n(timed out)';
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stderr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr });
    });
  });
}

export interface CreateProjectInput {
  mode: 'empty' | 'clone';
  parentDir: string;
  name: string;
  gitInit: boolean;
  cloneUrl?: string | undefined;
}

export async function createProject(input: CreateProjectInput, logger: Logger): Promise<string> {
  const name = input.name.trim();
  if (!NAME_RE.test(name) || name === '.' || name === '..' || name.startsWith('..')) {
    throw new ProductFailure(
      productError('PROJECT_BAD_NAME', {
        userMessage: 'The project name contains characters that are not allowed in a folder name.',
      }),
    );
  }
  const parent = resolve(input.parentDir);
  const parentStat = await fs.stat(parent).catch(() => null);
  if (!parentStat?.isDirectory()) {
    throw new ProductFailure(
      productError('PROJECT_PARENT_MISSING', {
        userMessage: 'The chosen parent folder does not exist.',
      }),
    );
  }
  const target = join(parent, name);
  if (basename(target) !== name) {
    throw new ProductFailure(
      productError('PROJECT_BAD_NAME', {
        userMessage: 'The project name is not a valid folder name.',
      }),
    );
  }
  const existing = await fs.stat(target).catch(() => null);
  if (existing) {
    throw new ProductFailure(
      productError('PROJECT_EXISTS', {
        userMessage: `“${name}” already exists in that folder. Choose another name.`,
      }),
    );
  }

  if (input.mode === 'clone') {
    const url = (input.cloneUrl ?? '').trim();
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(url)) {
      throw new ProductFailure(
        productError('PROJECT_BAD_CLONE_URL', {
          userMessage: 'Enter a git URL (https://…, git@…, or ssh://…).',
        }),
      );
    }
    logger.info('project clone starting', { url, target });
    const { code, stderr } = await runGit(['clone', '--', url, target], parent, 10 * 60 * 1000);
    if (code !== 0) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      const detail = stderr.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
      throw new ProductFailure(
        productError('PROJECT_CLONE_FAILED', {
          userMessage: `git clone failed${detail ? ` — ${detail}` : ''}. Only repositories that authenticate non-interactively (public, or credentials already set up for git) can be cloned here.`,
          retryable: true,
        }),
      );
    }
    logger.info('project cloned', { target });
    return target;
  }

  await fs.mkdir(target, { recursive: false });
  if (input.gitInit) {
    const { code, stderr } = await runGit(['init'], target, 30 * 1000);
    if (code !== 0) {
      // The folder itself is fine — surface the git problem without deleting it.
      logger.warn('git init failed for new project', { target, stderr: stderr.slice(0, 300) });
      throw new ProductFailure(
        productError('PROJECT_GIT_INIT_FAILED', {
          userMessage: `The folder was created, but git init failed${stderr ? ` — ${stderr.split('\n')[0]}` : ''}.`,
          retryable: true,
        }),
      );
    }
  }
  logger.info('project created', { target, gitInit: input.gitInit });
  return target;
}
