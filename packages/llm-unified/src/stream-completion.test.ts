// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it, mock, spyOn, test } from 'bun:test';
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from './adapter-contract.js';
import { _resetAdapterRegistryForTests, registerAdapter } from './adapter-registry.js';
import { chutesAdapter } from './adapters/chutes-openai.js';
import { nanoGpt } from './providers/nano-gpt.js';
import { novita } from './providers/novita.js';
import { type ProxyAuthSource, setProxyAuthSource } from './proxy-auth.js';
import {
  type StreamCompletionArgs,
  UpstreamHttpError,
  _buildWireForTests,
  buildAdapterBodyForTest,
  buildBodyForTest,
  composeWire,
  streamCompletion,
} from './stream-completion.js';
import type { ProviderConfig, ProviderDefinition, StreamChunk } from './types.js';

const sseBody = [
  'data: {"choices":[{"delta":{"content":"Hi "}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"there"}}]}',
  '',
  'data: {"choices":[{"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  '',
].join('\n');

function mockFetch(body: string, status = 200) {
  return mock(
    async () =>
      new Response(body, {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  );
}

describe('streamCompletion', () => {
  it('emits chunks parsed from the SSE response', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(sseBody) as unknown as typeof fetch;
    const firstOffering = nanoGpt.offerings[0];
    if (!firstOffering) throw new Error('nano-gpt has no offerings');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'test-key',
      target: { slug: firstOffering.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: {},
    };
    const chunks = [];
    for await (const c of streamCompletion(args)) chunks.push(c);
    globalThis.fetch = oldFetch;
    expect(
      chunks
        .filter((c) => c.type === 'token')
        .map((c) => (c as { type: 'token'; text: string }).text)
        .join(''),
    ).toBe('Hi there');
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('nano-gpt slug-mode swaps modelId when reasoning is enabled', async () => {
    let capturedBody: unknown = null;
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(async (req: Request) => {
      capturedBody = JSON.parse(await req.text());
      return new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;
    const flashOffering = nanoGpt.offerings.find(
      (o) => o.upstreamSlug === 'deepseek/deepseek-v4-flash',
    );
    if (!flashOffering)
      throw new Error('deepseek/deepseek-v4-flash not found in nano-gpt offerings');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      target: { slug: flashOffering.upstreamSlug },
      messages: [],
      bodyExtras: { reasoning: { enabled: true } },
    };
    for await (const _ of streamCompletion(args)) {
      /* drain */
    }
    globalThis.fetch = oldFetch;
    const body = capturedBody as { model: string; reasoning?: unknown; thinking?: unknown };
    expect(body.model).toBe('deepseek/deepseek-v4-flash:thinking');
    expect(body.reasoning).toBeUndefined(); // consumed by slug-swap
    expect(body.thinking).toBeUndefined();
  });

  it('nano-gpt flag-mode keeps slug and forwards reasoning struct on body', async () => {
    let capturedBody: unknown = null;
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(async (req: Request) => {
      capturedBody = JSON.parse(await req.text());
      return new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;
    const kimiOffering = nanoGpt.offerings.find((o) => o.upstreamSlug === 'moonshotai/kimi-k2.6');
    if (!kimiOffering) throw new Error('moonshotai/kimi-k2.6 not found in nano-gpt offerings');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      target: { slug: kimiOffering.upstreamSlug },
      messages: [],
      bodyExtras: { reasoning: { enabled: true } },
    };
    for await (const _ of streamCompletion(args)) {
      /* drain */
    }
    globalThis.fetch = oldFetch;
    const body = capturedBody as { model: string; reasoning?: { enabled: boolean } };
    expect(body.model).toBe('moonshotai/kimi-k2.6');
    expect(body.reasoning).toEqual({ enabled: true });
  });

  it('non-ok response throws (non-retryable 401)', async () => {
    const oldFetch = globalThis.fetch;
    // Use a non-retryable status (401) so the test does not trigger the retry
    // loop and remains fast. Non-ok responses now throw rather than yielding
    // an error chunk, so the engine layer handles them via try/catch.
    globalThis.fetch = mock(
      async () => new Response('nope', { status: 401 }),
    ) as unknown as typeof fetch;
    const firstOffering = nanoGpt.offerings[0];
    if (!firstOffering) throw new Error('nano-gpt has no offerings');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      target: { slug: firstOffering.upstreamSlug },
      messages: [],
      bodyExtras: {},
    };
    let threw = false;
    try {
      for await (const _c of streamCompletion(args)) {
        /* drain */
      }
    } catch {
      threw = true;
    }
    globalThis.fetch = oldFetch;
    expect(threw).toBe(true);
  });
});

describe('stream-completion.buildBody', () => {
  it('routes extras.reasoning through applyReasoningToBody (novita)', () => {
    const flashOffering = novita.offerings.find(
      (o) => o.upstreamSlug === 'deepseek/deepseek-v4-flash',
    );
    if (!flashOffering) throw new Error('deepseek/deepseek-v4-flash not found in novita offerings');
    const body = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      target: { slug: flashOffering.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: { reasoning: { enabled: true, effort: 'high' } },
    });
    expect(body.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(body.model).toBe('deepseek/deepseek-v4-flash');
    expect(body.stream).toBe(true);
  });

  it('does NOT consume the legacy boolean thinking extra (drops silently)', () => {
    const flashOffering = novita.offerings.find(
      (o) => o.upstreamSlug === 'deepseek/deepseek-v4-flash',
    );
    if (!flashOffering) throw new Error('deepseek/deepseek-v4-flash not found in novita offerings');
    const body = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      target: { slug: flashOffering.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      // `thinking` is the legacy Phase 3.1 boolean — should be dropped without
      // contributing a reasoning struct.
      bodyExtras: { thinking: true } as Record<string, unknown>,
    });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning');
  });

  it('preserves unrelated bodyExtras (e.g. temperature)', () => {
    const flashOffering = novita.offerings.find(
      (o) => o.upstreamSlug === 'deepseek/deepseek-v4-flash',
    );
    if (!flashOffering) throw new Error('deepseek/deepseek-v4-flash not found in novita offerings');
    const body = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      target: { slug: flashOffering.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: { temperature: 0.7, reasoning: { enabled: true } },
    });
    expect(body.temperature).toBe(0.7);
    expect(body.reasoning).toEqual({ enabled: true });
  });

  it('injects tools (OpenAI shape) into the generic body, omitting when absent', () => {
    const flashOffering = novita.offerings.find(
      (o) => o.upstreamSlug === 'deepseek/deepseek-v4-flash',
    );
    if (!flashOffering) throw new Error('deepseek/deepseek-v4-flash not found in novita offerings');
    const withTools = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      target: { slug: flashOffering.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: {},
      tools: [
        {
          name: 'web_search',
          description: 'Search the web.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });
    expect(withTools.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ]);

    // stream_options is requested unconditionally so usage surfaces.
    expect(withTools.stream_options).toEqual({ include_usage: true });

    const withoutTools = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      target: { slug: flashOffering.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: {},
    });
    expect(withoutTools).not.toHaveProperty('tools');
    expect(withoutTools.stream_options).toEqual({ include_usage: true });
  });
});

// ---------------------------------------------------------------------------
// Retry test helpers
// ---------------------------------------------------------------------------

/** Returns a minimal valid StreamCompletionArgs using the nano-gpt provider. */
function streamArgs(): StreamCompletionArgs {
  const firstOffering = nanoGpt.offerings[0];
  if (!firstOffering) throw new Error('nano-gpt has no offerings');
  return {
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
    apiKey: 'test-key',
    target: { slug: firstOffering.upstreamSlug },
    messages: [{ role: 'user', content: 'hi' }],
    bodyExtras: {},
    // Keep the TTFB timeout short so tests don't hang on slow paths.
    initialResponseTimeoutMs: 5_000,
  };
}

describe('streamCompletion retry on transient initial-fetch failure', () => {
  it('retries on 503 then succeeds with streamed content', async () => {
    let attempts = 0;
    const bodies: string[] = [];
    const fetchMock = mock(async (req: Request) => {
      attempts++;
      bodies.push(await req.text()); // consume the body, as real fetch does
      if (attempts < 3) {
        return new Response('upstream busy', { status: 503 });
      }
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            ctrl.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);

    const chunks: StreamChunk[] = [];
    for await (const c of streamCompletion(streamArgs())) {
      chunks.push(c);
    }
    expect(attempts).toBe(3);
    // All three attempts sent an identical, fully-readable body.
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
  });

  it('does not retry once the response body is being read', async () => {
    let bodyReads = 0;
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
        );
        bodyReads++;
        ctrl.error(new TypeError('network gone'));
      },
    });
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    let threw = false;
    try {
      for await (const _c of streamCompletion(streamArgs())) {
        // consume
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(bodyReads).toBe(1);
  });

  it('does not retry on non-retryable status codes (401)', async () => {
    let attempts = 0;
    // biome-ignore lint/suspicious/noExplicitAny: test mock — full fetch signature not needed
    (spyOn(globalThis, 'fetch') as any).mockImplementation(async () => {
      attempts++;
      return new Response('unauthorised', { status: 401 });
    });
    let threw = false;
    try {
      for await (const _c of streamCompletion(streamArgs())) {
        /* consume */
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(attempts).toBe(1);
  });

  it('aborts cleanly when signal fires during retry backoff', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    // biome-ignore lint/suspicious/noExplicitAny: test mock — full fetch signature not needed
    (spyOn(globalThis, 'fetch') as any).mockImplementation(async () => {
      attempts++;
      queueMicrotask(() => ctrl.abort());
      return new Response('busy', { status: 503 });
    });
    let threw = false;
    try {
      for await (const _c of streamCompletion({ ...streamArgs(), signal: ctrl.signal })) {
        /* consume */
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(attempts).toBeLessThanOrEqual(2);
  });
});

describe('streamCompletion cors-proxy 401 wiring', () => {
  it('passes onUnauthorised only for cors-proxy routing, refreshing the token exactly once', async () => {
    let refreshCalls = 0;
    const authSource: ProxyAuthSource = {
      getUrl: () => 'https://proxy.test',
      getToken: () => 'account-token',
      refreshToken: async () => {
        refreshCalls++;
        return 'fresh-account-token';
      },
    };
    setProxyAuthSource(authSource);
    const oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 401 });
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            ctrl.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch;

    try {
      const chunks: StreamChunk[] = [];
      for await (const c of streamCompletion({
        ...streamArgs(),
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'cors-proxy' } },
      })) {
        chunks.push(c);
      }
      expect(refreshCalls).toBe(1);
      expect(calls).toBe(2);
      // The retried request's body is just `data: [DONE]`, so the stream ends
      // with no chunks — asserted so the collected array is not dead weight.
      expect(chunks).toEqual([]);
    } finally {
      globalThis.fetch = oldFetch;
      setProxyAuthSource(null);
    }
  });

  it('never passes onUnauthorised for direct routing, so a 401 never refreshes the proxy token', async () => {
    let refreshCalls = 0;
    const authSource: ProxyAuthSource = {
      getUrl: () => 'https://proxy.test',
      getToken: () => 'account-token',
      refreshToken: async () => {
        refreshCalls++;
        return 'fresh-account-token';
      },
    };
    setProxyAuthSource(authSource);
    const oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('', { status: 401 });
    }) as unknown as typeof fetch;

    try {
      let threw = false;
      try {
        for await (const _c of streamCompletion({
          ...streamArgs(),
          providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
        })) {
          /* drain */
        }
      } catch {
        threw = true;
      }
      // A 401 on direct routing is a plain non-retryable upstream error — there
      // is no proxy token to refresh, so passing onUnauthorised here would be a
      // real leak of cors-proxy-only wiring into the direct path.
      expect(threw).toBe(true);
      expect(refreshCalls).toBe(0);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = oldFetch;
      setProxyAuthSource(null);
    }
  });
});

// ---------------------------------------------------------------------------
// buildAdapterBody tests
// ---------------------------------------------------------------------------

let lastReq: CanonicalRequest | null = null;
const recordingAdapter: ModelAdapter = {
  profile: {
    reasoning: { mode: 'toggle', defaultOn: false },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  buildRequest(req: CanonicalRequest): WireRequest {
    lastReq = req;
    return { model: 'slug', body: { model: 'slug', messages: req.messages, stream: true } };
  },
  parseChunk(_raw: unknown, state: ParseState) {
    return { events: [], state };
  },
};

const provider = { id: 'p' } as ProviderDefinition;
const providerConfig = {} as ProviderConfig;
// Stub target — adapterId and slug feed the adapter routing.
const modelStub = {
  id: 'slug',
  adapterId: 'rec',
} as const;

afterEach(() => {
  _resetAdapterRegistryForTests();
  lastReq = null;
});

describe('buildAdapterBody', () => {
  test('assembles a CanonicalRequest with reasoning intent and preserves temperature', () => {
    registerAdapter('rec', recordingAdapter);
    const body = buildAdapterBodyForTest(
      {
        provider,
        providerConfig,
        apiKey: 'k',
        target: { slug: modelStub.id, adapterId: modelStub.adapterId },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: { reasoning: { enabled: true, effort: 'high' }, temperature: 0.4 },
      },
      recordingAdapter,
    );
    expect(lastReq?.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(lastReq?.messages).toEqual([{ role: 'user', content: 'hi' }]);
    // temperature is a generic sampling param layered onto the adapter body.
    expect(body.temperature).toBe(0.4);
    expect(body.model).toBe('slug');
  });

  test('includes tools when provided, omits when absent', () => {
    registerAdapter('rec', recordingAdapter);
    buildAdapterBodyForTest(
      {
        provider,
        providerConfig,
        apiKey: 'k',
        target: { slug: modelStub.id, adapterId: modelStub.adapterId },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
        tools: [
          { name: 'generate_image', description: 'make an image', parameters: { type: 'object' } },
        ],
      },
      recordingAdapter,
    );
    expect(lastReq?.tools).toHaveLength(1);
    expect(lastReq?.tools?.[0]?.name).toBe('generate_image');
  });

  test('defaults reasoning to disabled when no intent is supplied', () => {
    registerAdapter('rec', recordingAdapter);
    buildAdapterBodyForTest(
      {
        provider,
        providerConfig,
        apiKey: 'k',
        target: { slug: modelStub.id, adapterId: modelStub.adapterId },
        messages: [],
        bodyExtras: {},
      },
      recordingAdapter,
    );
    expect(lastReq?.reasoning).toEqual({ enabled: false });
  });
});

describe('cacheKey threading', () => {
  it('passes args.cacheKey into the CanonicalRequest the adapter receives', () => {
    let seen: string | undefined;
    const fake: ModelAdapter = {
      profile: {
        reasoning: { mode: 'none' },
        toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
        vision: false,
        replayReasoning: false,
      },
      buildRequest(req) {
        seen = req.cacheKey;
        return { model: 'm', body: { model: 'm' } };
      },
      parseChunk(_raw, state) {
        return { events: [], state };
      },
    };
    _buildWireForTests(
      {
        provider: { id: 'xai' } as never,
        providerConfig: { baseUrl: 'x', routing: { kind: 'direct' } },
        apiKey: 'k',
        target: { slug: 'm', adapterId: 'xai:grok-4.3' },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
        cacheKey: 'chat-uuid-123',
      } as never,
      fake,
    );
    expect(seen).toBe('chat-uuid-123');
  });
});

/** Minimal adapter stub; `profile` is unused by composition. */
function stubAdapter(over: Partial<ModelAdapter> = {}): ModelAdapter {
  return {
    profile: {
      reasoning: { mode: 'fixed-on' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    buildRequest: () => ({ model: 'm', body: { model: 'm', stream: true } }),
    parseChunk: () => ({ events: [], state: {} }),
    ...over,
  };
}

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('streamCompletion error surface', () => {
  it('throws UpstreamHttpError carrying the status so callers can classify it', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response('nope', { status: 401, headers: { 'retry-after': '2' } }),
    ) as unknown as typeof fetch;
    try {
      const iter = streamCompletion({
        provider: { id: 'ollama-cloud' },
        providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } },
        apiKey: 'k',
        target: { slug: 'glm-5.2:cloud' },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
      } as never);
      const run = (async () => {
        for await (const _ of iter);
      })();
      await expect(run).rejects.toBeInstanceOf(UpstreamHttpError);
      await expect(run).rejects.toMatchObject({ status: 401, retryAfter: 2 });
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

describe('composeWire sampling', () => {
  it('uses the adapter mapSampling fragment instead of a top-level spread', () => {
    const adapter = stubAdapter({
      mapSampling: (s) => ({ options: { num_predict: s.max_tokens } }),
    });
    const wire = composeWire(
      { messages, bodyExtras: { max_tokens: 8, reasoning: { enabled: false } } },
      adapter,
    );
    expect(wire.body.options).toEqual({ num_predict: 8 });
    expect(wire.body.max_tokens).toBeUndefined();
  });

  it('spreads sampling top-level when the adapter has no mapSampling', () => {
    const wire = composeWire(
      { messages, bodyExtras: { temperature: 0.3, reasoning: { enabled: false } } },
      stubAdapter(),
    );
    expect(wire.body.temperature).toBe(0.3);
  });

  it('lets adapter structural keys win over sampling on a clash', () => {
    const adapter = stubAdapter({
      buildRequest: () => ({ model: 'adapter-model', body: { model: 'adapter-model' } }),
    });
    const wire = composeWire(
      { messages, bodyExtras: { model: 'sampling-model', reasoning: { enabled: false } } },
      adapter,
    );
    expect(wire.body.model).toBe('adapter-model');
  });

  it('never passes the reasoning intent through as a sampling param', () => {
    // `reasoning` is consumed into CanonicalRequest; leaking it into `options`
    // would send ollama a field it rejects.
    const adapter = stubAdapter({ mapSampling: (s) => ({ options: { ...s } }) });
    const wire = composeWire(
      { messages, bodyExtras: { reasoning: { enabled: true }, temperature: 0.3 } },
      adapter,
    );
    expect(wire.body.options).toEqual({ temperature: 0.3 });
  });

  it('produces a byte-identical body to the adapter wire when sampling is empty (spec §7.3)', () => {
    // For an adapter lacking `mapSampling`, empty bodyExtras (bar `reasoning`)
    // means `sampling` is `{}`, so `composeWire`'s body is exactly the adapter's
    // own `wire.body` — no added or reordered keys. Asserted rather than merely
    // reasoned about: a silent body change here would invalidate every existing
    // provider's Curation Record at once.
    const adapter = chutesAdapter('deepseek-ai/DeepSeek-V3.2-TEE', false);
    const req: CanonicalRequest = { messages, reasoning: { enabled: false } };
    const directWire = adapter.buildRequest(req);
    const composed = composeWire(
      { messages, bodyExtras: { reasoning: { enabled: false } } },
      adapter,
    );
    expect(composed.body).toEqual(directWire.body);
    expect(Object.keys(composed.body)).toEqual(Object.keys(directWire.body));
  });
});
