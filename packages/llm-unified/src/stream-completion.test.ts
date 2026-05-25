// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it, mock } from 'bun:test';
import { nanoGpt } from './providers/nano-gpt.js';
import { novita } from './providers/novita.js';
import {
  type StreamCompletionArgs,
  buildBodyForTest,
  streamCompletion,
} from './stream-completion.js';

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

  it('non-ok response yields an error chunk', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response('nope', { status: 500 }),
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
    const chunks = [];
    for await (const c of streamCompletion(args)) chunks.push(c);
    globalThis.fetch = oldFetch;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error' });
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
