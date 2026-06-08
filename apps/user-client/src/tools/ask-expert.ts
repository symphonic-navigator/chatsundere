// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ReasoningIntent,
  type StreamChunk,
  type ToolDef,
  type WireMessage,
  streamCompletion,
} from '@chatsundere/llm-unified';
import type { SubagentBase } from '../lib/subagent-base.js';
import { dispatch, toolDefs } from './tool-defs.js';
import type { Tool, ToolProgress, ToolResult } from './types.js';

/** @deprecated alias — use SubagentBase. Kept so existing imports resolve. */
export type ExpertBase = SubagentBase;

/** Default cap on web-executing rounds before a tools-less answer is forced. */
export const EXPERT_MAX_ROUNDS = 8;

export const EXPERT_SYSTEM_PROMPT =
  'You are a subject-matter expert consulted on a single, self-contained technical ' +
  'question — typically mathematics, science, software engineering, or another rigorous ' +
  'domain. Answer it precisely, rigorously, and completely; show the key steps where they ' +
  'aid correctness. You have no access to any prior conversation, so treat the question as ' +
  'wholly standalone and do not ask for clarification — state any assumptions you must make. ' +
  'You may use web_search / web_fetch when current or external facts would improve the answer; ' +
  'keep it to a few focused searches, then answer. ' +
  'Answer the question as asked, without moralising or adding unsolicited caveats.';

const INSTRUCTION =
  'An `ask_expert` tool forwards a single self-contained question to a more capable expert ' +
  'model. Reach for it when a maths, science, or engineering question is genuinely beyond ' +
  'what you can answer confidently on your own. Write the question as a clean, standalone ' +
  'technical query: include every fact needed to answer it, but strip names, personal ' +
  'details, and any emotional or relational context — only the question text travels to the ' +
  'expert, nothing else from this conversation. Then weave the expert’s answer into your own ' +
  'reply, in your own voice.';

/** Optional web access for the expert: the web tools (from buildWebTools) and the
 *  round cap for the tool loop. */
export interface ExpertWeb {
  tools: Tool[];
  maxRounds: number;
}

/**
 * Build the ask_expert tool over a resolved expert model. The expert sees ONLY
 * `[system(EXPERT_SYSTEM_PROMPT), user(question)]` — no history, no persona. When
 * `expertWeb` is supplied the expert may additionally call web tools, with the
 * conversation bounded by `expertWeb.maxRounds` before a final tools-less answer
 * is forced. Without `expertWeb` the structural-isolation invariant holds: a single
 * `streamCompletion` call with no tools.
 * `runtimeEnabled` is the per-chat cockpit toggle: when false the tool stays in
 * `toolDefs` (cache-prefix stable) but execute returns a constructive error.
 */
export function createAskExpertTool(
  base: ExpertBase,
  modelLabel: string,
  reasoning: ReasoningIntent,
  runtimeEnabled: boolean,
  streamFn: typeof streamCompletion = streamCompletion,
  expertWeb?: ExpertWeb,
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

      const webTools = expertWeb?.tools ?? [];
      const webDefs: ToolDef[] = webTools.length > 0 ? toolDefs(webTools) : [];
      const maxRounds = expertWeb?.maxRounds ?? 0;

      // INVARIANT (isolation): the conversation begins with EXACTLY the expert
      // system prompt + the sanitised question. Only the expert's OWN tool calls
      // and their results are appended below — never persona/history/about-me.
      const messages: WireMessage[] = [
        { role: 'system', content: EXPERT_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ];
      let answer = '';
      let reasoningChars = 0;
      const webSteps: { kind: 'searching' | 'fetching'; detail: string }[] = [];

      for (let round = 0; ; round++) {
        const forceAnswer = maxRounds === 0 || round >= maxRounds;
        let roundAnswer = '';
        const roundCalls: { toolCallId: string; name: string; argumentsJson: string }[] = [];
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
            tools: forceAnswer || webDefs.length === 0 ? undefined : webDefs,
            signal,
          } as Parameters<typeof streamCompletion>[0])) {
            const c = chunk as StreamChunk;
            if (c.type === 'reasoning') {
              reasoningChars += c.text.length;
              onProgress?.({ charCount: reasoningChars, phase: 'reasoning' });
            } else if (c.type === 'token') {
              roundAnswer += c.text;
              onProgress?.({ charCount: roundAnswer.length, phase: 'answer' });
            } else if (c.type === 'tool-call') {
              roundCalls.push({
                toolCallId: c.toolCallId,
                name: c.name,
                argumentsJson: c.argumentsJson,
              });
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

        if (roundCalls.length === 0 || forceAnswer) {
          answer = roundAnswer;
          break;
        }

        const toolResultMsgs: WireMessage[] = [];
        for (const call of roundCalls) {
          const onWebProgress = (p: ToolProgress): void => {
            if (p.phase === 'searching' || p.phase === 'fetching') {
              webSteps.push({ kind: p.phase, detail: p.detail ?? '' });
              onProgress?.({ charCount: p.charCount, phase: p.phase, detail: p.detail });
            }
          };
          const parsed = ((): Record<string, unknown> => {
            try {
              const v = JSON.parse(call.argumentsJson);
              return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
            } catch {
              return {};
            }
          })();
          const r = await dispatch(webTools, call.name, parsed, signal, onWebProgress);
          toolResultMsgs.push({
            role: 'tool',
            tool_call_id: call.toolCallId,
            content: r.ok ? r.output : (r.error ?? ''),
          });
        }
        messages.push({
          role: 'assistant',
          content: roundAnswer,
          tool_calls: roundCalls.map((c) => ({
            id: c.toolCallId,
            type: 'function',
            function: { name: c.name, arguments: c.argumentsJson },
          })),
        });
        messages.push(...toolResultMsgs);
      }

      if (answer.trim().length === 0) {
        return { ok: false, output: '', error: 'The expert returned no answer.' };
      }
      return {
        ok: true,
        output: answer,
        error: null,
        meta: { question, model: modelLabel, webSteps },
      };
    },
  };
}
