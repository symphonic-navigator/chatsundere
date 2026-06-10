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

export interface ClaudeEffortAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — a `steps` union for the Fable family. */
  reasoning: ReasoningControl;
  /** Cache-breakpoint tuning. Defaults: tail 5m, anchor grid 8192 tokens. */
  cache?: CacheOptions;
}

/**
 * Effort-based Claude (the Fable family) via nano-gpt. Unlike the Claude 4
 * family there is NO thinking sibling slug — reasoning is steered by a body
 * flag, `reasoning: { enabled, effort }`. The effort value is MANDATORY when
 * reasoning is on: `{ enabled: true }` alone is a silent no-op (probed live
 * 2026-06-10 — zero reasoning tokens, plain completion back), so the adapter
 * falls back to `medium` if the intent carries no effort. Thinking is also
 * adaptive — on trivial prompts Fable may skip reasoning even at high effort,
 * and `usage.reasoning_tokens` stays 0 with the trace rolled into
 * `completion_tokens`. SSE parsing is identical to the rest of the nano-gpt
 * surface (thinking on the `reasoning` delta channel), so it is reused from
 * the slug-swap adapter, as is the Anthropic `cache_control` injection.
 */
export function claudeEffortAdapter(slug: string, opts: ClaudeEffortAdapterOptions): ModelAdapter {
  const base = nanoGptSlugSwapAdapter(slug, opts.vision, opts.reasoning, slug);

  return {
    profile: base.profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: applyCacheControl(req.messages, opts.cache),
        stream: true,
        stream_options: { include_usage: true },
        reasoning: req.reasoning.enabled
          ? { enabled: true, effort: req.reasoning.effort ?? 'medium' }
          : { enabled: false },
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      return { model: slug, body };
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      return base.parseChunk(raw, state);
    },
  };
}
