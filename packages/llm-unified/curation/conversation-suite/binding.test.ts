// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { chutesAdapter } from '../../src/adapters/chutes-openai.js';
import type { ProviderConfig } from '../../src/types.js';
import { makeLiveBinding } from './binding.js';

const providerConfig: ProviderConfig = {
  baseUrl: 'https://llm.chutes.ai/v1',
  routing: { kind: 'direct' },
};
const adapter = chutesAdapter('deepseek-ai/DeepSeek-V3.2-TEE', false);

function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
      else c.close();
    },
  });
}

describe('makeLiveBinding', () => {
  test('captures a non-2xx status as an outcome (no throw) — the 400 case', async () => {
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      fetchImpl: (async () =>
        new Response('bad request', { status: 400 })) as unknown as typeof fetch,
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(outcome.httpStatus).toBe(400);
    expect(outcome.toolCalls).toEqual([]);
  });

  test('parses a 200 SSE body through the adapter into a TurnOutcome', async () => {
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      fetchImpl: (async () =>
        new Response(
          sseStream([
            'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.text).toBe('hello');
    expect(outcome.usage).toEqual({ promptTokens: 2, completionTokens: 1, totalTokens: 3 });
    expect(outcome.finishReason).toBe('stop');
  });

  test('retries a transient 429 then succeeds on the 200', async () => {
    let calls = 0;
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      sleepImpl: async () => {}, // instant backoff
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) return new Response('rate limited', { status: 429 });
        return new Response(
          sseStream([
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(calls).toBe(2);
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.text).toBe('hi');
  });

  test('captures the final 429 as an outcome after exhausting retries (no throw)', async () => {
    let calls = 0;
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      sleepImpl: async () => {},
      fetchImpl: (async () => {
        calls += 1;
        return new Response('rate limited', { status: 429 });
      }) as unknown as typeof fetch,
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(outcome.httpStatus).toBe(429);
    expect(calls).toBeGreaterThan(1); // it retried before giving up
  });

  test('toolResultFor synthesises a tool-role message', () => {
    const binding = makeLiveBinding({ offeringRef: 'r', providerConfig, apiKey: 'k', adapter });
    expect(binding.toolResultFor('generate_image', '{}')).toEqual({
      role: 'tool',
      content: JSON.stringify({ ok: true }),
      name: 'generate_image',
    });
  });
});
