// SPDX-License-Identifier: LGPL-3.0-only
import type { CacheControl, WireContentPart, WireMessage } from '../types.js';

/** Anthropic ephemeral-cache TTL. 5m is the default tier; 1h is long-lived. */
export type CacheTtl = '5m' | '1h';

export interface CacheBreakpoint {
  /** Index into the messages array whose content gets the cache_control marker. */
  index: number;
  ttl: CacheTtl;
}

export interface CacheOptions {
  /** TTL for the rolling-tail breakpoint. Default '5m'. */
  tailTtl?: CacheTtl;
  /** Token grid the history anchor snaps to, for cross-turn stability. Default 8192. */
  anchorGridTokens?: number;
}

/** Cheap, deterministic token estimate: ~4 chars per token over the message text. */
function estimateTokens(m: WireMessage): number {
  const text =
    typeof m.content === 'string'
      ? m.content
      : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
  return Math.ceil(text.length / 4);
}

/**
 * Compute up to three cache breakpoints for an Anthropic request:
 *  - BP1: the leading system message (stable prefix), 1h.
 *  - BP2: a token-anchored history point, snapped to a coarse grid so it stays
 *    put across turns and only advances when a new grid band is crossed, 1h.
 *  - BP3: the rolling tail (last message), default 5m.
 * Anthropic auto-reads the longest cached prefix, so the tail writes only the
 * delta. Deterministic and stateless — the same messages always yield the same
 * breakpoints, which is what makes the cached prefix reusable across turns.
 */
export function computeCacheBreakpoints(
  messages: WireMessage[],
  opts: CacheOptions = {},
): CacheBreakpoint[] {
  const tailTtl = opts.tailTtl ?? '5m';
  const grid = opts.anchorGridTokens ?? 8192;
  const last = messages.length - 1;
  if (last < 0) return [];

  const bps: CacheBreakpoint[] = [];

  // BP1 — stable prefix: a leading system message, if present.
  const hasSystem = messages[0]?.role === 'system';
  const prefixEnd = hasSystem ? 0 : -1;
  if (hasSystem) bps.push({ index: 0, ttl: '1h' });

  // Cumulative token counts.
  const cum: number[] = [];
  let running = 0;
  for (let i = 0; i <= last; i++) {
    running += estimateTokens(messages[i] as WireMessage);
    cum[i] = running;
  }

  // BP2 — history anchor: snap to the largest grid multiple of the SETTLED
  // history (everything but the rolling tail). Skipped when there isn't a full
  // grid band yet, or it would coincide with the prefix or the tail.
  const settledTokens = last > 0 ? (cum[last - 1] ?? 0) : 0;
  const target = Math.floor(settledTokens / grid) * grid;
  if (target > 0) {
    let anchorIdx = -1;
    for (let i = prefixEnd + 1; i < last; i++) {
      if ((cum[i] ?? 0) <= target) anchorIdx = i;
      else break;
    }
    if (anchorIdx > prefixEnd) bps.push({ index: anchorIdx, ttl: '1h' });
  }

  // BP3 — rolling tail.
  if (last > prefixEnd) bps.push({ index: last, ttl: tailTtl });

  return bps;
}

/** Attach an ephemeral marker to the last content part, promoting string content. */
function withCacheControl(m: WireMessage, ttl: CacheTtl): WireMessage {
  const marker: CacheControl = { type: 'ephemeral', ttl };
  if (typeof m.content === 'string') {
    const part: WireContentPart = { type: 'text', text: m.content, cache_control: marker };
    return { ...m, content: [part] };
  }
  const parts: WireContentPart[] = m.content.map((p) => ({ ...p }));
  const lastPart = parts[parts.length - 1];
  if (lastPart) lastPart.cache_control = marker;
  return { ...m, content: parts };
}

/**
 * Return a copy of `messages` with cache_control markers applied at the computed
 * breakpoints. Unmarked messages are passed through by reference. Returns the
 * original array reference when there are no breakpoints (empty input).
 */
export function applyCacheControl(messages: WireMessage[], opts: CacheOptions = {}): WireMessage[] {
  const bps = computeCacheBreakpoints(messages, opts);
  if (bps.length === 0) return messages;
  const ttlByIndex = new Map(bps.map((b) => [b.index, b.ttl]));
  return messages.map((m, i) => {
    const ttl = ttlByIndex.get(i);
    return ttl ? withCacheControl(m, ttl) : m;
  });
}
