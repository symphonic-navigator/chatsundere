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

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

interface OpenRouterDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      // OpenRouter normalises every upstream's thinking onto a single
      // `reasoning` field, regardless of whether the underlying model natively
      // emits `reasoning` or `reasoning_content` (probed live across DeepSeek,
      // GLM, Kimi, Gemma, Qwen on 2026-05-31 — all surfaced on `reasoning`,
      // never `reasoning_content`). `reasoning_content` is read defensively in
      // case a future route leaks the native field.
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
  usage?: OpenRouterUsage | null;
  // OpenRouter signals a mid-stream upstream failure as an SSE `error` object
  // (HTTP stays 200), which the runtime would otherwise swallow silently.
  error?: { message?: string; code?: number | string } | null;
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

function normaliseUsage(u: OpenRouterUsage): NormalisedUsage {
  // OpenRouter reports the OpenAI-standard shape: reasoning_tokens nested under
  // completion_tokens_details, cached prompt tokens under prompt_tokens_details
  // (confirmed live 2026-05-31 — cached_tokens populated on a cache hit).
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined && cached !== null) usage.cachedTokens = cached;
  return usage;
}

/** Optional attribution headers OpenRouter surfaces on its dashboard/rankings. */
export interface OpenRouterAttribution {
  /** Sent as `HTTP-Referer` — the app/site URL OpenRouter attributes traffic to. */
  referer?: string;
  /** Sent as `X-Title` — the human-readable app name shown on OpenRouter. */
  title?: string;
}

export interface OpenRouterAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — source of truth for the profile. A
   * `none`-mode control means the model never receives a `reasoning` param. */
  reasoning: ReasoningControl;
  /** Optional OpenRouter attribution headers (cosmetic, never functional). */
  attribution?: OpenRouterAttribution;
}

const DEFAULT_ON_EFFORT = 'medium';

/**
 * Build an OpenRouter adapter bound to one model slug. OpenRouter is a US-based
 * router/aggregator that presents a uniform OpenAI-compatible surface
 * (`/chat/completions`, Bearer auth) and normalises reasoning across every
 * underlying model onto a single unified `reasoning` request param and a single
 * `delta.reasoning` response channel. Probed live 2026-05-31:
 *   - `reasoning: { enabled: true, effort? }` enables; `{ enabled: false }` is a
 *     GENUINE off across all curated targets — including GLM-5.1, which cannot
 *     be silenced on Tensorix/wafer but is a clean toggle here. The unified
 *     param is honoured per route, so every curated offering is a `toggle`.
 *   - Reasoning text always arrives on `delta.reasoning` (never
 *     `reasoning_content`), even for models whose native field is
 *     `reasoning_content`. The parser prefers `reasoning` and falls back to
 *     `reasoning_content` only defensively.
 *   - Tool calls stream FRAGMENTED (id + name on one event, `arguments` on a
 *     later event), so `parseChunk` buffers and concatenates them — exactly the
 *     case `src/streaming.ts` gets wrong.
 *
 * Usage is requested via `stream_options.include_usage` and delivered on the
 * final `choices`-bearing event. `vision` feeds only the recorded profile.
 *
 * Optional attribution (`HTTP-Referer` / `X-Title`) is emitted as per-request
 * headers when supplied — cosmetic only; OpenRouter functions without them.
 */
export function openRouterAdapter(slug: string, opts: OpenRouterAdapterOptions): ModelAdapter {
  const reasons = opts.reasoning.mode !== 'none';
  const profile: ModelProfile = {
    reasoning: opts.reasoning,
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision: opts.vision,
    replayReasoning: false,
  };

  const attributionHeaders: Record<string, string> = {};
  if (opts.attribution?.referer) attributionHeaders['HTTP-Referer'] = opts.attribution.referer;
  if (opts.attribution?.title) attributionHeaders['X-Title'] = opts.attribution.title;
  const hasAttribution = Object.keys(attributionHeaders).length > 0;

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      // Reasoning steering via OpenRouter's unified `reasoning` object. Only
      // emitted for reasoning-capable offerings — a non-reasoning model gets no
      // param. `{ enabled: false }` is a genuine off across every curated target.
      if (reasons) {
        body.reasoning = req.reasoning.enabled
          ? { enabled: true, effort: req.reasoning.effort ?? DEFAULT_ON_EFFORT }
          : { enabled: false };
      }
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      const wire: WireRequest = { model: slug, body };
      if (hasAttribution) wire.headers = { ...attributionHeaders };
      return wire;
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as OpenRouterDelta;

      // OpenRouter can open with HTTP 200 and then emit an SSE `error` object on
      // an upstream failure — surface it as a stream error rather than dropping.
      if (p.error) {
        events.push({ type: 'error', message: p.error.message ?? 'OpenRouter upstream error' });
        return { events, state };
      }

      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      // OpenRouter unifies thinking onto `reasoning`; fall back to
      // `reasoning_content` only if a route ever leaks the native field.
      const reasoningText = choice.delta?.reasoning ?? choice.delta?.reasoning_content;
      if (reasoningText) events.push({ type: 'reasoning', text: reasoningText });
      if (choice.delta?.content) events.push({ type: 'token', text: choice.delta.content });

      const pending = getPending(state);
      for (const tc of choice.delta?.tool_calls ?? []) {
        const key = String(tc.index ?? 0);
        const acc = pending[key] ?? { id: '', name: '', args: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        // Concatenate fragmented argument deltas — OpenRouter streams the
        // arguments across multiple SSE events.
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
