// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { StreamChunk, WireMessage } from '../types.js';
import { type CacheOptions, applyCacheControl } from './_anthropic-cache.js';
import { openRouterAdapter } from './openrouter-openai.js';

/** Flatten a message's content to plain text (system messages carry no images). */
function textOf(m: WireMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/**
 * Merge every `system` message into a single leading one. Anthropic treats system
 * as a top-level construct and OpenRouter rejects a `system` message that sits
 * after an assistant turn ("role 'system' must precede an 'assistant' message or
 * end the array" — probed live 2026-06-30), so a mid-conversation system message
 * (e.g. an injected memory fact) would 400. nano-gpt hoists implicitly; on
 * OpenRouter we must do it ourselves. A no-op when there are no system messages
 * or exactly one already-leading system message (the common production shape),
 * so working turns stay byte-identical.
 */
function hoistSystemMessages(messages: WireMessage[]): WireMessage[] {
  const systemCount = messages.filter((m) => m.role === 'system').length;
  if (systemCount === 0) return messages;
  if (systemCount === 1 && messages[0]?.role === 'system') return messages;

  const systemText = messages
    .filter((m) => m.role === 'system')
    .map(textOf)
    .join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: systemText }, ...rest];
}

export interface ClaudeOpenRouterAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — source of truth for the profile. For
   * Sonnet 5 this is a `steps` union (off/low/medium/high), mirroring the
   * Fable-family treatment: effort genuinely modulates the trace (probed live
   * 2026-06-30 — low ≈ 17 reasoning tokens, high ≈ 270). */
  reasoning: ReasoningControl;
  /** Cache-breakpoint tuning. Defaults: tail 5m, anchor grid 8192 tokens. */
  cache?: CacheOptions;
}

/**
 * Claude via OpenRouter's OpenAI-compatible `/chat/completions`. This is the one
 * Claude offering NOT delivered via nano-gpt (see ADR 0032): on OpenRouter the
 * user owns the upstream route, so the offering carries the CENSORED badge and
 * the honest US-router trust posture — no ZDR claim.
 *
 * Request/response shaping is identical to every other OpenRouter offering, so it
 * reuses `openRouterAdapter`: reasoning steers via OpenRouter's unified
 * `reasoning` object (`{ enabled, effort }`), thinking arrives on `delta.reasoning`,
 * and fragmented tool calls are buffered and flushed on `finish_reason`. The one
 * Claude-specific addition is Anthropic prompt caching: `buildRequest` injects
 * `cache_control` breakpoints (stable prefix + token-anchored history point +
 * rolling tail; see `_anthropic-cache.ts`).
 *
 * Probed live 2026-06-30 (key routed to Google Vertex): `cache_control` is
 * accepted (no HTTP 400) and engages a cache write (`cache_write_tokens` > 0). A
 * cache READ-back is route-dependent — an aggregator may load-balance across
 * regional endpoints with no shared cache, so the saving lands only where routing
 * is sticky (e.g. an Anthropic-direct route on the user's key). The injection is
 * harmless where unsupported, so it is always emitted.
 *
 * Extended-thinking signature replay for the tool-use loop is intentionally NOT
 * implemented — same deferral as the nano-gpt Claude adapter (no live tool-loop
 * consumer yet; plain multi-turn chat does not require replay).
 */
export function claudeOpenRouterAdapter(
  slug: string,
  opts: ClaudeOpenRouterAdapterOptions,
): ModelAdapter {
  const base = openRouterAdapter(slug, { vision: opts.vision, reasoning: opts.reasoning });

  return {
    profile: base.profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const wire = base.buildRequest(req);
      // Normalise system-message ordering to Anthropic's contract BEFORE caching,
      // so the cache prefix breakpoint lands on the consolidated leading system.
      const hoisted = hoistSystemMessages(req.messages);
      wire.body.messages = applyCacheControl(hoisted, opts.cache);
      return wire;
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      return base.parseChunk(raw, state);
    },
  };
}
