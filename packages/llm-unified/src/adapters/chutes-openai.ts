// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { NormalisedUsage, StreamChunk } from '../types.js';

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface ChutesUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

interface ChutesDelta {
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
  usage?: ChutesUsage | null;
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

function normaliseUsage(u: ChutesUsage): NormalisedUsage {
  // Chutes reports reasoning_tokens TOP-LEVEL in usage (not under
  // completion_tokens_details as OpenAI does). Empirically confirmed.
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  if (u.reasoning_tokens !== undefined && u.reasoning_tokens !== null) {
    usage.reasoningTokens = u.reasoning_tokens;
  }
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Build a chutes adapter bound to one model slug. Chutes is uniformly
 * OpenAI-compatible. Reasoning is a symmetric `chat_template_kwargs` toggle:
 * ON via `{ enable_thinking: true }`, OFF via `{ enable_thinking: false }`.
 *
 * `reasoning_effort` is NOT the on-switch: probed live 2026-05-31, GLM and Kimi
 * happen to reason by default and surface `reasoning_content` regardless, but
 * DeepSeek-V3.2 and Gemma-4-31B-turbo emit ZERO `reasoning_content` (and zero
 * `reasoning_tokens`) under `reasoning_effort` alone — they reason in bare
 * `content` prose. Setting `chat_template_kwargs.enable_thinking: true` makes
 * all four surface the reasoning channel. The effort buckets do not measurably
 * modulate the trace (low/medium/high are flat), so reasoning is modelled as a
 * toggle, not steps; an `effort` hint is still forwarded when present, for any
 * future model that honours it. The earlier "DeepSeek/Gemma have no reasoning
 * channel" finding (2026-05-30) was an artefact of the wrong on-switch.
 *
 * The off mechanism is NOT `reasoning_effort: 'none'`: that 400s on
 * Kimi-K2.6-TEE (especially together with an image), whereas
 * `chat_template_kwargs.enable_thinking: false` disables thinking uniformly
 * across every chutes model and works on image turns too. Usage is requested
 * via `stream_options.include_usage` and delivered on a final `choices: []`
 * event. `vision` feeds only the recorded profile.
 */
export function chutesAdapter(slug: string, vision: boolean): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: { mode: 'toggle', defaultOn: true },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision,
    replayReasoning: false,
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
      // Reasoning steering is a symmetric chat_template_kwargs toggle (see the
      // factory doc). An effort hint is forwarded when present, but it does not
      // gate or modulate thinking on chutes — enable_thinking does.
      if (req.reasoning.enabled) {
        body.chat_template_kwargs = { enable_thinking: true };
        if (req.reasoning.effort) body.reasoning_effort = req.reasoning.effort;
      } else {
        body.chat_template_kwargs = { enable_thinking: false };
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
      const p = raw as ChutesDelta;

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
