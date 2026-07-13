import { z } from 'zod';
import { productError, ProductFailure, redactText } from '@pi-ide/foundation';
import { resolveInsideRoot } from '@pi-ide/workspace-service';
import { classifyCommand } from './command-classifier.js';
import { runCommand } from './command-runner.js';
import type { ToolGateway } from './gateway.js';

export interface AskUserPrompt {
  callId: string;
  taskId: string;
  runId: string;
  question: string;
  options: string[];
  allowFreeForm: boolean;
}

export interface UserGate {
  /** Show the question to the user and resolve with their answer. */
  ask(prompt: AskUserPrompt, signal: AbortSignal): Promise<string>;
}

export interface CommandToolServices {
  root: string;
  userGate: UserGate;
  maxOutputBytes?: number;
  /** SIGTERM→SIGKILL grace; tests shrink it. */
  graceMs?: number;
  onCommandOutput?: (callId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
}

/** CMD-006: per task, at most 1 write-ish command and 2 read-only verification processes. */
class CommandSlots {
  private readonly counts = new Map<string, { write: number; verify: number }>();

  acquire(taskId: string, kind: 'write' | 'verify'): () => void {
    const slot = this.counts.get(taskId) ?? { write: 0, verify: 0 };
    const limit = kind === 'write' ? 1 : 2;
    if (slot[kind] >= limit) {
      throw new ProductFailure(
        productError('COMMAND_CONCURRENCY_LIMIT', {
          userMessage:
            kind === 'write'
              ? 'Another command from this task is still running. Wait for it to finish and retry.'
              : 'Two verification commands from this task are already running. Retry when one finishes.',
          retryable: true,
        }),
      );
    }
    slot[kind] += 1;
    this.counts.set(taskId, slot);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      slot[kind] -= 1;
    };
  }
}

const RunCommandInputSchema = z
  .object({
    executable: z.string().min(1).max(500),
    args: z.array(z.string().max(4000)).max(100).default([]),
    cwd: z.string().max(1000).default(''),
    timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
    purpose: z.enum(['test', 'lint', 'build', 'inspect', 'other']).default('other'),
    env: z.record(z.string(), z.string().max(4000)).optional(),
    requiresShell: z.boolean().default(false),
  })
  .strict();

type RunCommandInput = z.infer<typeof RunCommandInputSchema>;

export function registerCommandTools(gateway: ToolGateway, services: CommandToolServices): void {
  const slots = new CommandSlots();

  gateway.register<RunCommandInput>({
    name: 'run_command',
    version: 1,
    description:
      'Run a command inside the workspace as a structured spawn (executable + args array, no shell). ' +
      'cwd is workspace-relative. Set requiresShell=true only when shell syntax is unavoidable — it raises the risk level. ' +
      'Output is captured, credential-like values are redacted, and long output is truncated.',
    promptGuidance:
      'Prefer recognized verification commands (npm test, npm run lint, npx tsc --noEmit). ' +
      'sudo, git push, workspace-external paths and credential files are always refused.',
    inputSchema: RunCommandInputSchema,
    risk: (input) => {
      const c = classifyCommand({
        executable: input.executable,
        args: input.args,
        cwd: input.cwd,
        requiresShell: input.requiresShell,
      });
      return { level: c.level, reasons: c.reasons, recognized: c.recognized };
    },
    preview: async (input) => {
      const c = classifyCommand({
        executable: input.executable,
        args: input.args,
        cwd: input.cwd,
        requiresShell: input.requiresShell,
      });
      const line = [input.executable, ...input.args].join(' ');
      return {
        summary: `$ ${line.slice(0, 160)}${line.length > 160 ? '…' : ''}`,
        detail: `purpose: ${input.purpose}; timeout: ${Math.round(input.timeoutMs / 1000)}s${input.requiresShell ? '; runs via shell' : ''}`,
        command: { executable: input.executable, args: input.args, cwd: input.cwd || '.' },
        ruleKey: c.ruleKey,
      };
    },
    async execute(input, signal, call) {
      const classification = classifyCommand({
        executable: input.executable,
        args: input.args,
        cwd: input.cwd,
        requiresShell: input.requiresShell,
      });
      const slotKind =
        classification.recognized && ['test', 'lint', 'inspect'].includes(input.purpose)
          ? 'verify'
          : 'write';
      const release = slots.acquire(call.taskId, slotKind);
      try {
        const cwdAbs = await resolveInsideRoot(services.root, input.cwd || '.');
        const result = await runCommand(
          {
            executable: input.executable,
            args: input.args,
            cwd: cwdAbs,
            timeoutMs: input.timeoutMs,
            ...(input.env ? { env: input.env } : {}),
            requiresShell: input.requiresShell,
            ...(services.maxOutputBytes !== undefined
              ? { maxOutputBytes: services.maxOutputBytes }
              : {}),
            ...(services.graceMs !== undefined ? { graceMs: services.graceMs } : {}),
            ...(services.onCommandOutput
              ? {
                  onOutput: (stream: 'stdout' | 'stderr', chunk: string) =>
                    services.onCommandOutput!(call.callId, stream, chunk),
                }
              : {}),
          },
          signal,
        );
        if (result.cancelled) {
          throw new ProductFailure(
            productError('CANCELLED', { userMessage: 'The command was cancelled.' }),
          );
        }
        const code = result.timedOut
          ? 'COMMAND_TIMEOUT'
          : result.exitCode === 0
            ? 'OK'
            : 'COMMAND_EXIT_NONZERO';
        const summary = result.timedOut
          ? `Timed out after ${Math.round(input.timeoutMs / 1000)}s and was terminated (${result.signal ?? 'killed'}).`
          : `Exited with code ${result.exitCode} in ${(result.durationMs / 1000).toFixed(1)}s.`;
        return {
          code,
          summary,
          data: {
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            stdout: redactText(result.stdout),
            stderr: redactText(result.stderr),
            truncated: result.truncated,
            executable: input.executable,
            args: input.args,
            cwd: input.cwd || '.',
          },
        };
      } finally {
        release();
      }
    },
  });

  gateway.register({
    name: 'ask_user',
    version: 1,
    description:
      'Ask the user a clarifying question (requirements, choices, risk decisions). ' +
      'The run pauses until they answer. Do not use it to work around denied permissions.',
    inputSchema: z
      .object({
        question: z.string().min(1).max(2000),
        options: z.array(z.string().min(1).max(200)).max(6).default([]),
        allowFreeForm: z.boolean().default(true),
      })
      .strict(),
    risk: () => ({ level: 'R0', reasons: ['asks the user; no side effects'] }),
    preview: async (input) => ({ summary: `Ask: ${input.question.slice(0, 120)}` }),
    async execute(input, signal, call) {
      const answer = await services.userGate.ask(
        {
          callId: call.callId,
          taskId: call.taskId,
          runId: call.runId,
          question: input.question,
          options: input.options,
          allowFreeForm: input.allowFreeForm,
        },
        signal,
      );
      return {
        code: 'OK',
        summary: `User answered: ${answer.slice(0, 140)}`,
        data: { answer },
      };
    },
  });
}
