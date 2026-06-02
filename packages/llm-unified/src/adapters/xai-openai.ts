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

export interface XaiAdapterOptions {
  vision: boolean;
}

const REASONING: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'none',
  defaultStep: 'low',
};
const DEFAULT_ON_EFFORT = 'low';

/**
 * Grok 4.3 via xAI's OpenAI-compatible `/chat/completions`. Probed live
 * 2026-06-02: reasoning is the native `reasoning_effort` param (no slug swap),
 * `none` disables, `low|medium|high` enable (`low` is xAI's default). Reasoning
 * streams on `delta.reasoning_content` and is ALREADY the human-readable summary
 * — there is no opaque encrypted blob on the Chat Completions surface, so it is
 * display-only and never replayed (`replayReasoning: false`).
 *
 * Prompt caching uses the `x-grok-conv-id` request header: set per-request from
 * `req.cacheKey` (the chat's UUIDv7 id) so all turns of one chat route to the
 * same cache server. Usage via `stream_options.include_usage`.
 */
export function xaiAdapter(slug: string, opts: XaiAdapterOptions): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: REASONING,
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
          ? (req.reasoning.effort ?? DEFAULT_ON_EFFORT)
          : 'none',
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

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
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
    },
  };
}
