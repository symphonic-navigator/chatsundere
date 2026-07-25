// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { ParseState } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import { nanoGptSlugSwapAdapter } from './nano-gpt-slug-swap.js';

const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: false };
const adapter = nanoGptSlugSwapAdapter('vendor/model', false, TOGGLE);

/** Feed one raw SSE payload through the adapter and return the usage it emits. */
function usageFor(payload: unknown) {
  const { events } = adapter.parseChunk(payload, {} as ParseState);
  const usage = events.find((e) => e.type === 'usage');
  return usage?.type === 'usage' ? usage.usage : undefined;
}

describe('nano-gpt usage normalisation', () => {
  it('folds Anthropic cache counters into promptTokens and cachedTokens', () => {
    // The shape nano-gpt returns for the Claude family (probed live 2026-07-25):
    // the cached prefix is billed separately and EXCLUDED from prompt_tokens,
    // and the read is reported only as cache_read_input_tokens. Reading the
    // OpenAI-shaped fields alone understated input by the whole cached prefix
    // and reported the cache as dead.
    const usage = usageFor({
      choices: [],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 6,
        total_tokens: 8,
        cache_read_input_tokens: 11_213,
        cache_creation_input_tokens: 19,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });

    expect(usage?.promptTokens).toBe(11_234);
    expect(usage?.cachedTokens).toBe(11_213);
    expect(usage?.totalTokens).toBe(11_240);
  });

  it('leaves OpenAI-shaped usage untouched so cached input is never double-counted', () => {
    // Every other nano-gpt family reports the OpenAI way: prompt_tokens already
    // includes the cached portion, and the Anthropic counters are absent or 0.
    const usage = usageFor({
      choices: [],
      usage: {
        prompt_tokens: 1_500,
        completion_tokens: 40,
        total_tokens: 1_540,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        prompt_tokens_details: { cached_tokens: 900 },
      },
    });

    expect(usage?.promptTokens).toBe(1_500);
    expect(usage?.cachedTokens).toBe(900);
    expect(usage?.totalTokens).toBe(1_540);
  });

  it('reports a cold Anthropic turn as a plain cache write', () => {
    const usage = usageFor({
      choices: [],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 6,
        total_tokens: 8,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 11_213,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });

    expect(usage?.promptTokens).toBe(11_215);
    expect(usage?.cachedTokens).toBe(0);
  });
});
