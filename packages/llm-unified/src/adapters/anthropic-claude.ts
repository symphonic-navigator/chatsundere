// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { StreamChunk } from '../types.js';
import { type CacheOptions, applyCacheControl } from './_anthropic-cache.js';
import { nanoGptSlugSwapAdapter } from './nano-gpt-slug-swap.js';

export interface ClaudeAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — source of truth for the profile. */
  reasoning: ReasoningControl;
  /** The reasoning-on slug, e.g. `<base>:thinking` or `<base>-thinking`. */
  thinkingSlug: string;
  /** Cache-breakpoint tuning. Defaults: tail 5m, anchor grid 8192 tokens. */
  cache?: CacheOptions;
}

/**
 * Claude via nano-gpt's OpenAI-compatible `/chat/completions`. Reasoning is a
 * slug swap (base = off, the `:thinking`/`-thinking` sibling = on — verified
 * live: effort does not modulate the trace, so the control is a clean toggle),
 * so this wraps the existing nano-gpt slug-swap adapter for identical request
 * building and SSE parsing. The one Claude-specific addition: Anthropic prompt
 * caching is opt-in, so it injects `cache_control` breakpoints (stable prefix +
 * token-anchored history point + rolling tail; see `_anthropic-cache.ts`).
 * nano-gpt passes cache_control through to Anthropic — verified live: a stable
 * prefix is read back on the next turn (cache_read ≈ full prefix).
 *
 * We deliver Claude via nano-gpt, NOT OpenRouter: OpenRouter is used with
 * privacy-limited keys (the community "limited keys" convention), which exclude
 * the Anthropic-direct endpoint and route to Amazon Bedrock — which does not
 * honour Anthropic cache_control. See ADR 0032.
 *
 * Extended-thinking signature replay for the tool-use loop is intentionally NOT
 * implemented — deferred build-when-needed (spec §5.2): no live tool-loop
 * consumer yet, and plain multi-turn chat does not require replay.
 */
export function claudeAdapter(baseSlug: string, opts: ClaudeAdapterOptions): ModelAdapter {
  const base = nanoGptSlugSwapAdapter(baseSlug, opts.vision, opts.reasoning, opts.thinkingSlug);

  return {
    profile: base.profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const wire = base.buildRequest(req);
      wire.body.messages = applyCacheControl(req.messages, opts.cache);
      return wire;
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      return base.parseChunk(raw, state);
    },
  };
}
