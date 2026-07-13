import { z } from 'zod';
import type { ToolGateway } from './gateway.js';

export interface VerificationRunSummary {
  id: string;
  label: string;
  state: string;
  exitCode: number | null;
  outputExcerpt: string;
}

/**
 * Bridge to the host verification runner (VER-001..010). The host owns state
 * transitions (VERIFYING), persistence and event recording.
 */
export interface VerificationGate {
  run(
    input: { taskId: string; runId: string; callId: string; label?: string },
    signal: AbortSignal,
  ): Promise<{ configured: boolean; runs: VerificationRunSummary[] }>;
}

/** run_verification (TOOL-003): execute the task's configured verification commands. */
export function registerVerificationTool(
  gateway: ToolGateway,
  services: { gate: VerificationGate },
): void {
  gateway.register({
    name: 'run_verification',
    version: 1,
    description:
      'Run the verification commands configured for this task (all of them, or one by label). ' +
      'Results are recorded by the IDE with exit codes and output; re-runs supersede older results.',
    promptGuidance:
      'Run this after your changes. If it fails, fix the code and run it again — earlier results stay recorded.',
    inputSchema: z
      .object({
        label: z.string().min(1).max(120).optional(),
      })
      .strict(),
    risk: () => ({
      level: 'R2',
      reasons: ['runs the task-configured verification commands'],
      recognized: true,
    }),
    preview: async (input) => ({
      summary: input.label ? `Run verification "${input.label}"` : 'Run all task verifications',
      ruleKey: 'verify:run',
    }),
    async execute(input, signal, call) {
      const outcome = await services.gate.run(
        {
          taskId: call.taskId,
          runId: call.runId,
          callId: call.callId,
          ...(input.label !== undefined ? { label: input.label } : {}),
        },
        signal,
      );
      if (!outcome.configured) {
        return {
          code: 'NO_VERIFICATION_CONFIGURED',
          summary:
            'No verification commands are configured for this task. The final report will be marked unverified.',
          data: { configured: false, runs: [] },
        };
      }
      const passed = outcome.runs.filter((r) => r.state === 'passed').length;
      const failed = outcome.runs.filter((r) => r.state === 'failed').length;
      const other = outcome.runs.length - passed - failed;
      return {
        code: failed > 0 ? 'VERIFICATION_FAILED' : 'OK',
        summary: `Verification: ${passed} passed, ${failed} failed${other > 0 ? `, ${other} other` : ''}.`,
        data: { configured: true, runs: outcome.runs },
      };
    },
  });
}
