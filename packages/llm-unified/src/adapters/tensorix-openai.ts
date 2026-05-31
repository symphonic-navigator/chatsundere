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

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface TensorixUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

interface TensorixDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      // Tensorix surfaces reasoning on TWO channels depending on the model:
      // GLM and Kimi use `reasoning_content`; DeepSeek emits BOTH `reasoning`
      // and `reasoning_content` carrying the SAME text. We read
      // `reasoning_content` first and only fall back to `reasoning`, so the
      // DeepSeek duplicate is never double-counted (probed live 2026-05-31).
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: TensorixUsage | null;
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

function normaliseUsage(u: TensorixUsage): NormalisedUsage {
  // OpenAI-standard shape: reasoning_tokens nested under
  // completion_tokens_details (NOT top-level as chutes does), cached prompt
  // tokens under prompt_tokens_details. Confirmed live 2026-05-31.
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

export interface TensorixAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — source of truth for the profile. A
   * `none`-mode control means the model never receives a `reasoning_effort`
   * param. */
  reasoning: ReasoningControl;
}

const DEFAULT_ON_EFFORT = 'medium';

/**
 * Build a Tensorix adapter bound to one model slug. Tensorix is uniformly
 * OpenAI-compatible (`/chat/completions`, Bearer auth); reasoning is steered by
 * the standard `reasoning_effort` param. Probed live 2026-05-31:
 *   - `reasoning_effort: 'low' | 'medium' | 'high'` enable reasoning; `'none'`
 *     is the off-switch where the model honours it. A toggle-on without an
 *     explicit effort defaults to `medium`.
 *   - Reasoning text arrives on `reasoning_content` for GLM and Kimi; DeepSeek
 *     emits the same text on both `reasoning` and `reasoning_content`, so the
 *     parser prefers `reasoning_content` and never double-counts.
 *
 * Unlike wafer, Tensorix ZDR is policy-default (architectural, every request),
 * not a per-request opt-in header, so the adapter sends no trust header.
 *
 * Usage is requested via `stream_options.include_usage` and delivered on a final
 * `choices: []` event. `vision` feeds only the recorded profile.
 */
export function tensorixAdapter(slug: string, opts: TensorixAdapterOptions): ModelAdapter {
  const reasons = opts.reasoning.mode !== 'none';
  const profile: ModelProfile = {
    reasoning: opts.reasoning,
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision: opts.vision,
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
      // Reasoning steering via the standard `reasoning_effort`. Only emitted for
      // reasoning-capable offerings — a non-reasoning model gets no param.
      if (reasons) {
        body.reasoning_effort = req.reasoning.enabled
          ? (req.reasoning.effort ?? DEFAULT_ON_EFFORT)
          : 'none';
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
      const p = raw as TensorixDelta;

      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      // Prefer reasoning_content; fall back to reasoning only when it is absent
      // (DeepSeek sends both with identical text — see TensorixDelta).
      const reasoningText = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
      if (reasoningText) events.push({ type: 'reasoning', text: reasoningText });
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
