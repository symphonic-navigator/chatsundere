// SPDX-License-Identifier: AGPL-3.0-only
import type { SandboxRun } from './sandbox-exec.js';
import { runSandbox } from './sandbox-host.js';
import type { Tool, ToolResult } from './types.js';

/** Build the model-facing output string from a sandbox run: console output,
 *  then the final value on its own line when both are present. */
export function assembleOutput(run: SandboxRun): string {
  const parts: string[] = [];
  if (run.stdout.length > 0) parts.push(run.stdout);
  if (run.value !== undefined) parts.push(run.value);
  return parts.join('\n');
}

const INSTRUCTION =
  'A `calculate_js` tool runs JavaScript and returns its output. Prefer it for any ' +
  'arithmetic, counting, or string manipulation rather than computing in your head — even ' +
  'simple sums. It eliminates slips such as miscounting the letters in a word.';

export const calculateJs: Tool = {
  name: 'calculate_js',
  description:
    'Execute JavaScript and return its output. Use for arithmetic, counting, and string manipulation.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript to execute. The value of the final expression is returned; console.* output is captured too.',
      },
    },
    required: ['code'],
  },
  systemPromptInstruction: INSTRUCTION,

  async execute(args, signal): Promise<ToolResult> {
    const code = typeof args.code === 'string' ? args.code : '';
    if (code.trim().length === 0) {
      return { ok: false, output: '', error: 'No code provided' };
    }
    const run = await runSandbox(code, signal);
    if (run.error !== null) {
      return { ok: false, output: assembleOutput(run), error: run.error };
    }
    return { ok: true, output: assembleOutput(run), error: null };
  },
};
