// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { WireContentPart, WireMessage } from '../types.js';
import { applyCacheControl, computeCacheBreakpoints } from './_anthropic-cache.js';

/** A message whose text is `n` characters long (≈ n/4 tokens). */
function msg(role: WireMessage['role'], chars: number): WireMessage {
  return { role, content: 'x'.repeat(chars) };
}

describe('computeCacheBreakpoints', () => {
  it('returns no breakpoints for an empty conversation', () => {
    expect(computeCacheBreakpoints([])).toEqual([]);
  });

  it('marks only the rolling tail when there is no system message', () => {
    const messages = [msg('user', 40)];
    expect(computeCacheBreakpoints(messages)).toEqual([{ index: 0, ttl: '5m' }]);
  });

  it('marks the system prefix (1h) and the tail (5m) for a short conversation', () => {
    const messages = [msg('system', 100), msg('user', 40)];
    expect(computeCacheBreakpoints(messages)).toEqual([
      { index: 0, ttl: '1h' },
      { index: 1, ttl: '5m' },
    ]);
  });

  it('adds a token-anchored history breakpoint once settled history crosses the grid', () => {
    // grid 100 tokens = 400 chars. system 400 chars (100 tok). Then several
    // 400-char turns. Settled = everything but the tail.
    const messages = [
      msg('system', 400), // idx0 cum=100
      msg('user', 400), // idx1 cum=200
      msg('assistant', 400), // idx2 cum=300
      msg('user', 400), // idx3 cum=400
      msg('assistant', 400), // idx4 cum=500  <- tail (excluded from settled)
    ];
    // settled = cum[3] = 400; target = floor(400/100)*100 = 400.
    // largest idx in (0, 4) with cum<=400 is idx3.
    expect(computeCacheBreakpoints(messages, { anchorGridTokens: 100 })).toEqual([
      { index: 0, ttl: '1h' },
      { index: 3, ttl: '1h' },
      { index: 4, ttl: '5m' },
    ]);
  });

  it('keeps the anchor stable when a short turn is appended within the same grid band', () => {
    // grid 200 tokens; system 400 chars (100 tok); turns 80 chars (20 tok each).
    // Turns are small relative to the grid, so appending one does not cross a
    // grid band and the anchor must stay put.
    const turns = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', 80));
    const base = [msg('system', 400), ...turns]; // 11 messages
    const a = computeCacheBreakpoints(base, { anchorGridTokens: 200 });
    const b = computeCacheBreakpoints([...base, msg('user', 80)], { anchorGridTokens: 200 });
    const anchorA = a.find((bp) => bp.ttl === '1h' && bp.index !== 0)?.index;
    const anchorB = b.find((bp) => bp.ttl === '1h' && bp.index !== 0)?.index;
    expect(anchorA).toBeDefined();
    expect(anchorB).toBe(anchorA);
  });

  it('honours a 1h tail TTL override', () => {
    const messages = [msg('system', 100), msg('user', 40)];
    expect(computeCacheBreakpoints(messages, { tailTtl: '1h' })).toEqual([
      { index: 0, ttl: '1h' },
      { index: 1, ttl: '1h' },
    ]);
  });

  it('never emits more than four breakpoints', () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      msg(i === 0 ? 'system' : i % 2 ? 'user' : 'assistant', 400),
    );
    expect(computeCacheBreakpoints(messages, { anchorGridTokens: 100 }).length).toBeLessThanOrEqual(
      4,
    );
  });
});

describe('applyCacheControl', () => {
  it('promotes a string system message to the array form with an ephemeral marker', () => {
    const out = applyCacheControl([msg('system', 100), msg('user', 40)]);
    const sys = out[0];
    expect(Array.isArray(sys?.content)).toBe(true);
    const part = (sys?.content as WireContentPart[])[0];
    expect(part).toEqual({
      type: 'text',
      text: 'x'.repeat(100),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
  });

  it('marks the last content part of an array-form message', () => {
    const messages: WireMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image_url', image_url: { url: 'data:...' } },
        ],
      },
    ];
    const out = applyCacheControl(messages);
    const parts = out[0]?.content as WireContentPart[];
    expect(parts[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(parts[0]?.cache_control).toBeUndefined();
  });

  it('leaves unmarked messages untouched (referential passthrough for non-breakpoint indices)', () => {
    const messages = [msg('system', 100), msg('user', 40), msg('assistant', 40), msg('user', 40)];
    const out = applyCacheControl(messages, { anchorGridTokens: 1_000_000 });
    // grid huge → no anchor; only idx0 and tail marked. idx1, idx2 unchanged.
    expect(out[1]).toBe(messages[1]);
    expect(out[2]).toBe(messages[2]);
  });

  it('returns the original array reference when there are no breakpoints', () => {
    const messages: WireMessage[] = [];
    expect(applyCacheControl(messages)).toBe(messages);
  });
});
