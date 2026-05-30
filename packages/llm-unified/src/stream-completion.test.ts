// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it, mock, spyOn, test } from 'bun:test';
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from './adapter-contract.js';
import { _resetAdapterRegistryForTests, registerAdapter } from './adapter-registry.js';
import { nanoGpt } from './providers/nano-gpt.js';
import { novita } from './providers/novita.js';
import { shouldRetryStatus } from './retry.js';
import {
  type StreamCompletionArgs,
  buildAdapterBodyForTest,
  buildBodyForTest,
  streamCompletion,
} from './stream-completion.js';
import type { KnownModel, ProviderConfig, ProviderDefinition, StreamChunk } from './types.js';

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
    const firstModel = nanoGpt.knownModels[0];
    if (!firstModel) throw new Error('nano-gpt has no known models');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'test-key',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: firstModel,
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
    const flashModel = nanoGpt.knownModels.find((m) => m.id === 'deepseek/deepseek-v4-flash');
    if (!flashModel) throw new Error('deepseek/deepseek-v4-flash not found in nano-gpt models');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: flashModel,
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
    const kimiModel = nanoGpt.knownModels.find((m) => m.id === 'moonshotai/kimi-k2.6');
    if (!kimiModel) throw new Error('moonshotai/kimi-k2.6 not found in nano-gpt models');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: kimiModel,
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
    const firstModel = nanoGpt.knownModels[0];
    if (!firstModel) throw new Error('nano-gpt has no known models');
    const args: StreamCompletionArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: firstModel,
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
    const flashModel = novita.knownModels.find((m) => m.id === 'deepseek/deepseek-v4-flash');
    if (!flashModel) throw new Error('deepseek/deepseek-v4-flash not found in novita models');
    const body = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: flashModel,
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: { reasoning: { enabled: true, effort: 'high' } },
    });
    expect(body.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(body.model).toBe('deepseek/deepseek-v4-flash');
    expect(body.stream).toBe(true);
  });

  it('does NOT consume the legacy boolean thinking extra (drops silently)', () => {
    const flashModel = novita.knownModels.find((m) => m.id === 'deepseek/deepseek-v4-flash');
    if (!flashModel) throw new Error('deepseek/deepseek-v4-flash not found in novita models');
    const body = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: flashModel,
      messages: [{ role: 'user', content: 'hi' }],
      // `thinking` is the legacy Phase 3.1 boolean — should be dropped without
      // contributing a reasoning struct.
      bodyExtras: { thinking: true } as Record<string, unknown>,
    });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning');
  });

  it('preserves unrelated bodyExtras (e.g. temperature)', () => {
    const flashModel = novita.knownModels.find((m) => m.id === 'deepseek/deepseek-v4-flash');
    if (!flashModel) throw new Error('deepseek/deepseek-v4-flash not found in novita models');
    const body = buildBodyForTest({
      provider: novita,
      providerConfig: { baseUrl: novita.baseUrl, routing: { kind: 'direct' } },
      apiKey: '',
      corsProxyUrl: null,
      corsProxyKey: null,
      model: flashModel,
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: { temperature: 0.7, reasoning: { enabled: true } },
    });
    expect(body.temperature).toBe(0.7);
    expect(body.reasoning).toEqual({ enabled: true });
  });
});

// ---------------------------------------------------------------------------
// Retry test helpers
// ---------------------------------------------------------------------------

/** Returns a minimal valid StreamCompletionArgs using the nano-gpt provider. */
function streamArgs(): StreamCompletionArgs {
  const firstModel = nanoGpt.knownModels[0];
  if (!firstModel) throw new Error('nano-gpt has no known models');
  return {
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
    apiKey: 'test-key',
    corsProxyUrl: null,
    corsProxyKey: null,
    model: firstModel,
    messages: [{ role: 'user', content: 'hi' }],
    bodyExtras: {},
    // Keep the TTFB timeout short so tests don't hang on slow paths.
    initialResponseTimeoutMs: 5_000,
  };
}

describe('streamCompletion retry on transient initial-fetch failure', () => {
  it('retries on 503 then succeeds with streamed content', async () => {
    let attempts = 0;
    const fetchMock = mock(async () => {
      attempts++;
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
const model: KnownModel = {
  id: 'slug',
  displayName: 'M',
  contextWindow: 100_000,
  reasoning: { kind: 'optional', defaultOn: false, replayReasoning: false },
  vision: false,
  tools: true,
  adapterId: 'rec',
};

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
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
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
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
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
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        messages: [],
        bodyExtras: {},
      },
      recordingAdapter,
    );
    expect(lastReq?.reasoning).toEqual({ enabled: false });
  });
});
