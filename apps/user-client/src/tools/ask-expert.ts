// SPDX-License-Identifier: AGPL-3.0-only
import {
  type CompletionTarget,
  type ProviderConfig,
  type ProviderDefinition,
  type ReasoningIntent,
  type StreamChunk,
  type WireMessage,
  streamCompletion,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from './types.js';

/** The shared subset of StreamCompletionArgs the expert call needs (resolved on
 *  the send path, which holds the MasterKey). */
export interface ExpertBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  target: CompletionTarget;
}

export const EXPERT_SYSTEM_PROMPT =
  'You are a subject-matter expert consulted on a single, self-contained technical ' +
  'question — typically mathematics, science, software engineering, or another rigorous ' +
  'domain. Answer it precisely, rigorously, and completely; show the key steps where they ' +
  'aid correctness. You have no access to any prior conversation, so treat the question as ' +
  'wholly standalone and do not ask for clarification — state any assumptions you must make. ' +
  'Answer the question as asked, without moralising or adding unsolicited caveats.';

const INSTRUCTION =
  'An `ask_expert` tool forwards a single self-contained question to a more capable expert ' +
  'model. Reach for it when a maths, science, or engineering question is genuinely beyond ' +
  'what you can answer confidently on your own. Write the question as a clean, standalone ' +
  'technical query: include every fact needed to answer it, but strip names, personal ' +
  'details, and any emotional or relational context — only the question text travels to the ' +
  'expert, nothing else from this conversation. Then weave the expert’s answer into your own ' +
  'reply, in your own voice.';

/**
 * Build the ask_expert tool over a resolved expert model. The expert sees ONLY
 * `[system(EXPERT_SYSTEM_PROMPT), user(question)]` — no history, no persona, no
 * tools (the structural-isolation invariant). The caller is expected to pass
 * max-effort reasoning (via `maxReasoningIntent`) so the reasoning pill can show
 * live progress and a long trace is not timeout-capped.
 * `runtimeEnabled` is the per-chat cockpit toggle: when false the tool stays in
 * `toolDefs` (cache-prefix stable) but execute returns a constructive error.
 */
export function createAskExpertTool(
  base: ExpertBase,
  modelLabel: string,
  reasoning: ReasoningIntent,
  runtimeEnabled: boolean,
  streamFn: typeof streamCompletion = streamCompletion,
): Tool {
  return {
    name: 'ask_expert',
    description:
      'Forward one self-contained technical question to a more capable expert model and return its answer.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'A clean, standalone technical question with every fact needed to answer it, and no personal, emotional, or relational context.',
        },
      },
      required: ['question'],
    },
    systemPromptInstruction: INSTRUCTION,

    async execute(args, signal, onProgress): Promise<ToolResult> {
      if (!runtimeEnabled) {
        return {
          ok: false,
          output: '',
          error:
            'The expert is switched off for this chat. Answer the question yourself as best you can; do not call ask_expert again this turn.',
        };
      }
      const question = typeof args.question === 'string' ? args.question : '';
      if (question.trim().length === 0) {
        return { ok: false, output: '', error: 'No question provided.' };
      }

      const messages: WireMessage[] = [
        { role: 'system', content: EXPERT_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ];
      let answer = '';
      let reasoningChars = 0;
      try {
        for await (const chunk of streamFn({
          provider: base.provider,
          providerConfig: base.providerConfig,
          apiKey: base.apiKey,
          corsProxyUrl: base.corsProxyUrl,
          corsProxyKey: base.corsProxyKey,
          target: base.target,
          messages,
          bodyExtras: { reasoning },
          signal,
        } as Parameters<typeof streamCompletion>[0])) {
          const c = chunk as StreamChunk;
          if (c.type === 'reasoning') {
            reasoningChars += c.text.length;
            onProgress?.({ charCount: reasoningChars, phase: 'reasoning' });
          } else if (c.type === 'token') {
            answer += c.text;
            onProgress?.({ charCount: answer.length, phase: 'answer' });
          } else if (c.type === 'error') {
            throw new Error(c.message);
          }
        }
      } catch (e) {
        return {
          ok: false,
          output: '',
          error: e instanceof Error ? e.message : 'Expert call failed.',
        };
      }
      if (answer.trim().length === 0) {
        return { ok: false, output: '', error: 'The expert returned no answer.' };
      }
      return { ok: true, output: answer, error: null, meta: { question, model: modelLabel } };
    },
  };
}
