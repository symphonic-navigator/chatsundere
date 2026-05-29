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
}

/** The upstream-bound request an adapter produces: a model slug plus a JSON body. */
export interface WireRequest {
  model: string;
  body: Record<string, unknown>;
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
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState };
  readonly profile: ModelProfile;
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
