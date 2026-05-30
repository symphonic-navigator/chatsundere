// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
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

interface NanoGptUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

interface NanoGptDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      // nano-gpt streams GLM thinking on the `reasoning` channel (probed live);
      // `reasoning_content` is read defensively in case a sibling slug differs.
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: NanoGptUsage | null;
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

function normaliseUsage(u: NanoGptUsage): NormalisedUsage {
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  // nano-gpt reports reasoning_tokens BOTH top-level and under
  // completion_tokens_details (probed live). Prefer top-level, fall back.
  const reasoning = u.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Build a nano-gpt adapter for any base slug whose reasoning is steered by a
 * MODEL-SLUG SWAP rather than a body flag — nano-gpt's uniform mechanism for
 * the GLM and DeepSeek families (probed live; see obsidian/models/glm-5.1.md,
 * glm-5.md, deepseek-v4-flash.md, deepseek-v4-pro.md). The `:thinking` sibling
 * reasons and honours `reasoning_effort`. Whether the BARE slug truly disables
 * thinking is per-model: most (glm-5.1, both DeepSeek V4) are cleanly off
 * (→ `steps` with an off step), but glm-5 bare reasons regardless (→ `fixed-on`,
 * the "off only hides" case). The caller passes the probed `reasoning` control.
 * Thinking text streams on the `reasoning` delta channel (not `reasoning_content`,
 * which is read defensively). Tool calls arrive as a single block but the
 * fragment buffer is kept for safety. Usage is requested via
 * `stream_options.include_usage` on a final `choices: []` event.
 */
export function nanoGptSlugSwapAdapter(
  baseSlug: string,
  vision: boolean,
  reasoning: ReasoningControl,
): ModelAdapter {
  const profile: ModelProfile = {
    reasoning,
    toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
    vision,
    replayReasoning: false, // GLM/DeepSeek are soft-CoT — never replay their thinking
  };

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const thinking = req.reasoning.enabled;
      const model = thinking ? `${baseSlug}:thinking` : baseSlug;
      const body: Record<string, unknown> = {
        model,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (thinking && req.reasoning.effort) body.reasoning_effort = req.reasoning.effort;
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      return { model, body };
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as NanoGptDelta;

      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      const reasoning = (choice.delta?.reasoning ?? '') + (choice.delta?.reasoning_content ?? '');
      if (reasoning) events.push({ type: 'reasoning', text: reasoning });
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
