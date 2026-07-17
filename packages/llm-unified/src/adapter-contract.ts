// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelProfile } from './catalogue/types.js';
import type { ReasoningIntent, StreamChunk, WireMessage } from './types.js';

export type { ModelProfile };

/** A single tool the model may call, in the canonical (provider-neutral) form. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

/** What the engine wants, before any per-model wire translation. */
export interface CanonicalRequest {
  messages: WireMessage[];
  reasoning: ReasoningIntent;
  tools?: ToolDef[];
  /**
   * Stable per-conversation key for providers with conversation-affinity prompt
   * caching (xAI's `x-grok-conv-id`; OpenAI's `prompt_cache_key` later). Ignored
   * by adapters that don't cache by conversation.
   */
  cacheKey?: string;
}

/** The upstream-bound request an adapter produces: a model slug plus a JSON body. */
export interface WireRequest {
  model: string;
  body: Record<string, unknown>;
  /**
   * Optional extra HTTP request headers the adapter needs on the wire (beyond
   * the transport's Authorisation/Content-Type). Merged on top of the base
   * headers in `transport.buildRequest`. Used e.g. by wafer to send
   * `Wafer-ZDR: required` for ZDR offerings; reusable for any provider needing
   * per-request header steering.
   */
  headers?: Record<string, string>;
  /**
   * Endpoint path the request must hit, relative to the provider's `baseUrl`.
   * Defaults to `/chat/completions` (OpenAI-compatible). A non-OpenAI provider
   * overrides it — e.g. ollama's native `/api/chat`.
   */
  path?: string;
}

/**
 * Parser state threaded across `parseChunk` calls. MUST be a plain
 * JSON-serialisable object — it crosses the Worker/postMessage boundary.
 * Adapters use it to reassemble fragmented streamed tool calls.
 */
export type ParseState = Record<string, unknown>;

/** The pure transformation contract every adapter implements. */
export interface ModelAdapter {
  buildRequest(req: CanonicalRequest): WireRequest;
  /**
   * Interpret one already-decoded stream event. `raw` is the JSON payload of an
   * SSE `data:` line, or — for `responseFraming: 'ndjson'` adapters — one parsed
   * NDJSON line (e.g. an ollama `/api/chat` chunk).
   */
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState };
  /**
   * Translate canonical OpenAI-shaped sampling params (`temperature`,
   * `max_tokens`, …) into this provider's wire form, returning a body fragment
   * to merge. Absent → the params are spread as top-level keys, which is
   * correct for every OpenAI-compatible provider. Implement it only when the
   * upstream wants them elsewhere (ollama nests them under `options`).
   */
  mapSampling?(sampling: Record<string, unknown>): Record<string, unknown>;
  readonly profile: ModelProfile;
  /**
   * How the upstream frames its streamed response: `sse` (default, OpenAI
   * `data: …\n\n` + `[DONE]`) or `ndjson` (one JSON object per line, terminated
   * by a `done: true` chunk — ollama's native `/api/chat`).
   */
  readonly responseFraming?: 'sse' | 'ndjson';
}

/**
 * Build a `ModelProfile` for the fallback case: every unverified capability
 * takes the safest, least-breaking value. Per UX *disabled over hidden*, an
 * unverified capability is later greyed out rather than offered.
 */
export function conservativeProfile(base: { toolsSupported: boolean }): ModelProfile {
  return {
    reasoning: { mode: 'fixed-on' },
    toolCalls: {
      supported: base.toolsSupported,
      streaming: false,
      concurrentWithReasoning: false,
    },
    vision: false,
    replayReasoning: true,
  };
}
