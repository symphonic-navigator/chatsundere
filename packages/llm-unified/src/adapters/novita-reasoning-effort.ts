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
  // novita nests reasoning_tokens under completion_tokens_details (probed live).
  // MiniMax M3 omits it entirely on novita — hence the null/undefined guard.
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Build a novita adapter for any slug whose reasoning is steered by the OpenAI
 * `reasoning_effort` parameter rather than the top-level `enable_thinking`
 * boolean — novita's mechanism for the newer Hy3, Kimi K3 and MiniMax M3
 * families (probed live 2026-07-18). The older GLM/DeepSeek/Kimi-K2.6 slugs use
 * `enable_thinking` (see `novita-thinking.ts`); on these newer slugs
 * `enable_thinking: false` is IGNORED — thinking continues — and only
 * `reasoning_effort: 'none'` truly disables it (Hy3, Kimi K3). MiniMax M3 cannot
 * be disabled at all (`reasoning_effort` has no effect — it always reasons), so
 * its caller passes a `fixed-on` control and this adapter emits no
 * `reasoning_effort` for it. Thinking streams on `reasoning_content`. Tool calls
 * arrive as a single block (the fragment buffer is kept for safety) and may run
 * concurrently with reasoning. Usage via `stream_options.include_usage`.
 *
 * The caller passes the probed `ReasoningControl` so the profile matches the
 * offering: `steps` (Hy3, Kimi K3 — `off` maps to `reasoning_effort: 'none'`) or
 * `fixed-on` (MiniMax M3).
 */
export function novitaReasoningEffortAdapter(
  slug: string,
  vision: boolean,
  reasoning: ReasoningControl,
): ModelAdapter {
  const profile: ModelProfile = {
    reasoning,
    toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
    vision,
    replayReasoning: false, // Hy3/Kimi/MiniMax are soft-CoT — never replay their thinking
  };

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      // Map the reasoning intent to novita's `reasoning_effort`. Off → the
      // literal `none` bucket (the only switch that disables Hy3/Kimi K3). On
      // with a chosen effort → that bucket. On without an effort (a `fixed-on`
      // model like MiniMax M3) → omit the parameter and let the model reason.
      if (req.reasoning.enabled) {
        if (req.reasoning.effort) body.reasoning_effort = req.reasoning.effort;
      } else {
        body.reasoning_effort = 'none';
      }
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
