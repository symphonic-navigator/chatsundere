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

interface XaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

interface XaiDelta {
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
  usage?: XaiUsage | null;
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

function normaliseUsage(u: XaiUsage): NormalisedUsage {
  // Grok reports the OpenAI-standard shape (probed live 2026-06-02): reasoning
  // tokens under completion_tokens_details, cached prompt tokens under
  // prompt_tokens_details. total_tokens already includes reasoning tokens.
  // Note: completion_tokens EXCLUDES reasoning tokens — so
  // total = prompt + completion + reasoning (unlike providers that roll reasoning into completion).
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

/**
 * Shared SSE parser for every xAI Grok adapter. Reasoning streams on
 * `delta.reasoning_content` as the human-readable summary (no opaque blob on the
 * Chat Completions surface), tool calls arrive in (occasionally fragmented)
 * deltas and are reassembled, and `usage` rides the final `choices: []` event.
 * Identical across the `reasoning_effort` (Grok 4.3) and slug-swap (Grok 4.20)
 * steering styles — only `buildRequest` differs between them.
 */
function xaiParseChunk(
  raw: unknown,
  state: ParseState,
): { events: StreamChunk[]; state: ParseState } {
  const events: StreamChunk[] = [];
  const p = raw as XaiDelta;

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
}

export interface XaiAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — source of truth for the profile AND for
   * which `reasoning_effort` values may be emitted. Defaults to the Grok 4.3
   * shape below. Grok 4.5 passes a control with `offStep: null`: it rejects
   * `reasoning_effort: 'none'` with HTTP 400 and has no off switch at all
   * (probed live 2026-07-15), so the adapter must never emit an off value. */
  reasoning?: ReasoningControl;
}

/** Grok 4.3: low/medium/high, with `none` a genuine off (probed 2026-06-02). */
const REASONING: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'none',
  defaultStep: 'low',
};
const DEFAULT_ON_EFFORT = 'low';

/**
 * Grok 4.3 and 4.5 via xAI's OpenAI-compatible `/chat/completions`. Reasoning is
 * the native `reasoning_effort` param (no slug swap) and streams on
 * `delta.reasoning_content` as the human-readable summary — there is no opaque
 * encrypted blob on this surface, so it is display-only and never replayed
 * (`replayReasoning: false`).
 *
 * The two models differ ONLY in whether reasoning can be switched off, which the
 * caller expresses through `opts.reasoning`:
 *   - **Grok 4.3** (probed 2026-06-02): `none` disables, `low|medium|high`
 *     enable (`low` is xAI's default) — the default control below.
 *   - **Grok 4.5** (probed 2026-07-15): reasoning is MANDATORY. `none` is
 *     rejected with HTTP 400 ("This model does not support `reasoning_effort`
 *     value `none`"), and the unified `reasoning: {enabled:false}` object is
 *     accepted but silently ignored — the model reasons regardless. Its control
 *     therefore carries `offStep: null` and a disabled intent falls back to the
 *     lightest effort rather than producing a wire error.
 *
 * Prompt caching uses the `x-grok-conv-id` request header: set per-request from
 * `req.cacheKey` (the chat's UUIDv7 id) so all turns of one chat route to the
 * same cache server. Usage via `stream_options.include_usage`.
 */
export function xaiAdapter(slug: string, opts: XaiAdapterOptions): ModelAdapter {
  const control = opts.reasoning ?? REASONING;
  // The wire value meaning "off", or null when the model always reasons.
  const offEffort = control.mode === 'steps' ? control.offStep : null;
  const defaultEffort = control.mode === 'steps' ? control.defaultStep : DEFAULT_ON_EFFORT;

  const profile: ModelProfile = {
    reasoning: control,
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
        reasoning_effort: req.reasoning.enabled
          ? (req.reasoning.effort ?? defaultEffort)
          : (offEffort ?? defaultEffort),
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      const wire: WireRequest = { model: slug, body };
      // Conversation-affinity caching: route same-chat turns to one server.
      if (req.cacheKey) wire.headers = { 'x-grok-conv-id': req.cacheKey };
      return wire;
    },

    parseChunk: xaiParseChunk,
  };
}

const SLUG_SWAP_TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

export interface XaiSlugSwapAdapterOptions {
  vision: boolean;
}

/**
 * Grok 4.20 via xAI's OpenAI-compatible `/chat/completions`. Unlike Grok 4.3,
 * Grok 4.20 steers reasoning by a MODEL-SLUG SWAP, not the `reasoning_effort`
 * param (probed live 2026-06-28: `grok-4.20-0309-reasoning` and
 * `-non-reasoning` both reject `reasoning_effort` with HTTP 400). The reasoning
 * slug always reasons and the non-reasoning slug never does — a binary toggle
 * with no effort buckets. Reasoning streams on `delta.reasoning_content` (the
 * same human-readable summary as 4.3, so display-only, `replayReasoning: false`)
 * and `usage` is the standard xAI shape. Conversation-affinity caching uses the
 * `x-grok-conv-id` header, identical to {@link xaiAdapter}.
 */
export function xaiSlugSwapAdapter(
  baseSlug: string,
  thinkingSlug: string,
  opts: XaiSlugSwapAdapterOptions,
): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: SLUG_SWAP_TOGGLE,
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision: opts.vision,
    replayReasoning: false,
  };

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const model = req.reasoning.enabled ? thinkingSlug : baseSlug;
      // No `reasoning_effort`: Grok 4.20 rejects it on either slug (HTTP 400).
      const body: Record<string, unknown> = {
        model,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      const wire: WireRequest = { model, body };
      if (req.cacheKey) wire.headers = { 'x-grok-conv-id': req.cacheKey };
      return wire;
    },

    parseChunk: xaiParseChunk,
  };
}
