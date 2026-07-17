// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it, test } from 'bun:test';
import { chutesAdapter } from '../../src/adapters/chutes-openai.js';
import { ollamaNativeAdapter } from '../../src/adapters/ollama-native.js';
import type { RetryEvent } from '../../src/retry.js';
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

  test('builds a fresh Request per attempt — retry does not reuse a consumed body', async () => {
    // Regression: the request was built once outside the retry loop, so the
    // second fetch reused a Request whose body stream was already consumed,
    // throwing ERR_BODY_ALREADY_USED. A mock that reads the body (as real fetch
    // does) reproduces it; the fix rebuilds the Request each attempt.
    let calls = 0;
    const bodies: string[] = [];
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      sleepImpl: async () => {},
      fetchImpl: (async (req: Request) => {
        calls += 1;
        bodies.push(await req.text()); // consume the body, like real fetch
        if (calls === 1) return new Response('rate limited', { status: 429 });
        return new Response(
          sseStream([
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
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
    expect(outcome.text).toBe('ok');
    // Each attempt sent the identical body — proof the rebuild is faithful.
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
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
    expect(
      binding.toolResultFor({ id: 'call_1', name: 'generate_image', argumentsJson: '{}' }),
    ).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'generate_image',
      content: JSON.stringify({ ok: true }),
    });
  });

  test('fires onRetry on a transient 503 and captures the eventual outcome', async () => {
    let calls = 0;
    const events: RetryEvent[] = [];
    const binding = makeLiveBinding({
      offeringRef: 'prov/model',
      providerConfig,
      apiKey: 'k',
      adapter,
      fetchImpl: (async (req: Request) => {
        calls++;
        await req.text();
        if (calls < 2) return new Response('busy', { status: 503 });
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              c.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }) as unknown as typeof fetch,
      sleepImpl: async () => {},
      onRetry: (e) => events.push(e),
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(calls).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 503, errorKind: 'status' });
    expect(outcome.httpStatus).toBe(200);
  });

  it('routes sampling through the adapter mapSampling rather than sending it top-level', async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchImpl = (async (req: Request) => {
      sentBody = (await req.json()) as Record<string, unknown>;
      return new Response('{"done":true}\n', { status: 200 });
    }) as unknown as typeof fetch;

    const binding = makeLiveBinding({
      offeringRef: 'ollama-cloud:glm-5.2:cloud',
      providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } },
      apiKey: 'k',
      adapter: ollamaNativeAdapter('glm-5.2:cloud', {
        vision: false,
        reasoning: { mode: 'fixed-on' },
      }),
      sampling: { max_tokens: 8 },
      fetchImpl,
    });
    await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });

    expect(sentBody.options).toEqual({ num_predict: 8 });
    expect(sentBody.max_tokens).toBeUndefined();
  });
});
