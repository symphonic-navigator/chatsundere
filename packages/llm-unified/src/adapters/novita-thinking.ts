// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { NormalisedUsage, StreamChunk } from '../types.js';

/** One fragmented tool call, accumulated across SSE events. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface NovitaUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

interface NovitaDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: NovitaUsage | null;
}

type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';

function normaliseFinish(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'unknown';
  }
}

function normaliseUsage(u: NovitaUsage): NormalisedUsage {
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  // novita reports reasoning_tokens nested under completion_tokens_details
  // (probed live — NOT top-level as chutes does).
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Build a novita adapter for any slug whose reasoning is steered by the
 * TOP-LEVEL BOOLEAN body flag `enable_thinking` — novita's mechanism for the
 * GLM and DeepSeek families (probed live across glm-5, glm-5.1,
 * deepseek-v4-flash, deepseek-v4-pro). The heuristic `reasoning: { enabled }`
 * flag, `chat_template_kwargs.enable_thinking` and `reasoning_effort: 'none'`
 * were ALL found NOT to disable thinking; `enable_thinking: false` is the only
 * switch that does. There are no granular effort buckets, so the control is a
 * plain toggle. Thinking streams on `reasoning_content`. Tool calls arrive as a
 * single block (buffer kept for safety) and may run concurrently with reasoning.
 * Usage via `stream_options.include_usage` with reasoning_tokens nested under
 * completion_tokens_details.
 */
export function novitaThinkingAdapter(slug: string, vision: boolean): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: { mode: 'toggle', defaultOn: true },
    toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
    vision,
    replayReasoning: false, // GLM/DeepSeek are soft-CoT — never replay their thinking
  };

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
        enable_thinking: req.reasoning.enabled,
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      return { model: slug, body };
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as NovitaDelta;

      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      if (choice.delta?.reasoning_content)
        events.push({ type: 'reasoning', text: choice.delta.reasoning_content });
      if (choice.delta?.content) events.push({ type: 'token', text: choice.delta.content });

      const pending = getPending(state);
      for (const tc of choice.delta?.tool_calls ?? []) {
        const key = String(tc.index ?? 0);
        const acc = pending[key] ?? { id: '', name: '', args: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments;
        pending[key] = acc;
      }

      if (choice.finish_reason) {
        for (const acc of Object.values(pending)) {
          if (acc.id && acc.name) {
            events.push({
              type: 'tool-call',
              toolCallId: acc.id,
              name: acc.name,
              argumentsJson: acc.args,
            });
          }
        }
        state.toolCalls = {};
        events.push({ type: 'finish', reason: normaliseFinish(choice.finish_reason) });
      }
      return { events, state };
    },
  };
}
