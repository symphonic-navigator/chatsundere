// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import type { ProviderConfig, StreamChunk, WireMessage } from '../types.js';
import { streamCompletion } from './openai-chat-completions.js';

function asMockFetch(
  impl: (input: string | Request | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(impl, { preconnect: async () => {} }) as unknown as typeof fetch;
}

const directProvider: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};

const messages: WireMessage[] = [
  { role: 'system', content: 'You are Aurum.' },
  { role: 'user', content: 'Hi.' },
];

let fetchCalls: Array<{ url: string; init: RequestInit; bodyText: string }> = [];

beforeEach(() => {
  fetchCalls = [];
});

function mockFetchWithSse(sseBody: string): typeof fetch {
  return asMockFetch(async (input) => {
    const req = input as Request;
    const bodyText = await req.text();
    fetchCalls.push({ url: req.url, init: {}, bodyText });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('streamCompletion (openai-chat-completions)', () => {
  it('POSTs to /chat/completions with the expected body', async () => {
    const fetchFn = mockFetchWithSse(
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    );
    await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://nano-gpt.com/api/v1/chat/completions');
    const call = fetchCalls[0];
    const body = JSON.parse(call?.bodyText ?? '');
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.messages).toEqual(messages);
    expect(body.stream).toBe(true);
  });

  it('yields parsed chunks from the SSE body', async () => {
    const fetchFn = mockFetchWithSse(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
    );
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toEqual([
      { type: 'token', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('emits an error chunk on non-2xx response with the upstream status', async () => {
    const fetchFn = asMockFetch(async () => new Response('rate-limited', { status: 429 }));
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect(chunks[0].message).toMatch(/429/);
    }
  });

  it('emits an error chunk when the response has no body', async () => {
    const fetchFn = asMockFetch(async () => new Response(null, { status: 200 }));
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
  });

  it('emits an error chunk when fetch itself throws (network failure)', async () => {
    const fetchFn = asMockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const chunks = await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        messages,
        modelId: 'deepseek-v4-flash',
        fetchFn,
      }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect(chunks[0].message).toMatch(/Failed to fetch/);
    }
  });

  it('passes the abort signal to fetch', async () => {
    const ac = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fetchFn = asMockFetch(async (_input, init) => {
      receivedSignal = init?.signal ?? undefined;
      return new Response('', { status: 200 });
    });
    await collect(
      streamCompletion({
        provider: directProvider,
        apiKey: 'sk-test',
        messages,
        modelId: 'deepseek-v4-flash',
        signal: ac.signal,
        fetchFn,
      }),
    );
    expect(receivedSignal).toBe(ac.signal);
  });
});
