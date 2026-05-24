import { describe, expect, it, mock } from 'bun:test';
import { type OneShotArgs, runOneShotCompletion } from './one-shot-completion.js';
import { nanoGpt } from './providers/nano-gpt.js';

const successBody = JSON.stringify({
  choices: [{ message: { role: 'assistant', content: 'A short title' } }],
});

describe('runOneShotCompletion', () => {
  it('returns the assistant message content on 200', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response(successBody, { status: 200 }),
    ) as unknown as typeof fetch;
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    const args: OneShotArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'test-key',
      corsProxyUrl: null,
      corsProxyKey: null,
      model,
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: { temperature: 0.3, max_tokens: 20 },
    };
    const result = await runOneShotCompletion(args);
    globalThis.fetch = oldFetch;
    expect(result).toBe('A short title');
  });

  it('throws on non-200', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await expect(
      runOneShotCompletion({
        provider: nanoGpt,
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        messages: [],
        bodyExtras: {},
      }),
    ).rejects.toThrow();
    globalThis.fetch = oldFetch;
  });

  it('throws on empty content', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await expect(
      runOneShotCompletion({
        provider: nanoGpt,
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        messages: [],
        bodyExtras: {},
      }),
    ).rejects.toThrow();
    globalThis.fetch = oldFetch;
  });
});
