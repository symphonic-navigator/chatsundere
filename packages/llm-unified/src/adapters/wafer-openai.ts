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

interface WaferUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

interface WaferDelta {
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
  usage?: WaferUsage | null;
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

function normaliseUsage(u: WaferUsage): NormalisedUsage {
  // Wafer reports the OpenAI-standard shape: reasoning_tokens nested under
  // completion_tokens_details (NOT top-level as chutes does), and cached prompt
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

export interface WaferAdapterOptions {
  vision: boolean;
  /** ZDR-capable deployment: send `Wafer-ZDR: required` so the request is
   * pinned to the ZDR-safe partition (the badge is only truthful if we ask). */
  zdr: boolean;
  /** The offering's reasoning control — source of truth for the profile. A
   * `none`-mode control means the model never receives a `reasoning_effort`
   * param (e.g. the non-reasoning Qwen3.5-397B-A17B). */
  reasoning: ReasoningControl;
}

const DEFAULT_ON_EFFORT = 'medium';

/**
 * Build a wafer adapter bound to one model slug. Wafer is uniformly
 * OpenAI-compatible (`/chat/completions`); reasoning is steered by the standard
 * `reasoning_effort` param. Probed live 2026-05-31:
 *   - `reasoning_effort: 'none'` is the genuine off-switch (reasoning_content
 *     disappears). `chat_template_kwargs.enable_thinking:false` also disables,
 *     but `reasoning_effort` is the standard surface, so we use it.
 *   - `reasoning: { enabled:false }` and a top-level `enable_thinking:false` do
 *     NOT disable thinking — they were rejected by probe.
 *   - `low | medium | high` enable reasoning; a toggle-on without an explicit
 *     effort defaults to `medium`.
 *
 * Non-reasoning models receive no reasoning param at all (`reasons:false`).
 *
 * ZDR: `Wafer-ZDR: required` is sent for ZDR offerings (header on the wire, not
 * the body). Wafer rejects the header on non-ZDR models (HTTP 422
 * `model_zdr_not_supported`), so it is sent ONLY when `zdr:true`.
 *
 * Usage is requested via `stream_options.include_usage` and delivered on a final
 * `choices: []` event. `vision` feeds only the recorded profile.
 */
export function waferAdapter(slug: string, opts: WaferAdapterOptions): ModelAdapter {
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
      const wire: WireRequest = { model: slug, body };
      // ZDR is a per-request header, not a body field. Only sent for ZDR
      // offerings — wafer 422s the header on non-ZDR models.
      if (opts.zdr) wire.headers = { 'Wafer-ZDR': 'required' };
      return wire;
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as WaferDelta;

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
