import { describe, expect, it, mock } from 'bun:test';
import {
  type OneShotArgs,
  runOneShotCompletion,
  runOneShotCompletionWithSleep,
} from './one-shot-completion.js';
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
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');
    const args: OneShotArgs = {
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'test-key',
      corsProxyUrl: null,
      corsProxyKey: null,
      target: { slug: model.upstreamSlug },
      messages: [{ role: 'user', content: 'hi' }],
      bodyExtras: { temperature: 0.3, max_tokens: 20 },
    };
    const result = await runOneShotCompletion(args);
    globalThis.fetch = oldFetch;
    expect(result).toBe('A short title');
  });

  it('throws on non-200', async () => {
    const oldFetch = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = mock(async () => {
      attempts++;
      return new Response('nope', { status: 500 });
    }) as unknown as typeof fetch;
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');

    const { runOneShotCompletionWithSleep } = await import('./one-shot-completion.js');

    await expect(
      runOneShotCompletionWithSleep(
        {
          provider: nanoGpt,
          providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
          apiKey: 'k',
          corsProxyUrl: null,
          corsProxyKey: null,
          target: { slug: model.upstreamSlug },
          messages: [],
          bodyExtras: {},
        },
        async () => {}, // instant test sleep
      ),
    ).rejects.toThrow();
    globalThis.fetch = oldFetch;
    expect(attempts).toBe(5); // 500 is retryable, so should retry 4 times (5 total)
  });

  it('throws on empty content', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');
    await expect(
      runOneShotCompletion({
        provider: nanoGpt,
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        target: { slug: model.upstreamSlug },
        messages: [],
        bodyExtras: {},
      }),
    ).rejects.toThrow();
    globalThis.fetch = oldFetch;
  });
});

describe('runOneShotCompletion retry on transient failure', () => {
  it('retries on 429 then returns the eventual content', async () => {
    const oldFetch = globalThis.fetch;
    let attempts = 0;
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');
    globalThis.fetch = mock(async () => {
      attempts++;
      if (attempts < 2) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'recovered' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // Import at test scope to allow dependency injection in next test
    const { runOneShotCompletionWithSleep } = await import('./one-shot-completion.js');

    const result = await runOneShotCompletionWithSleep(
      {
        provider: nanoGpt,
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
        apiKey: 'test-key',
        corsProxyUrl: null,
        corsProxyKey: null,
        target: { slug: model.upstreamSlug },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
      },
      async () => {}, // instant test sleep
    );
    globalThis.fetch = oldFetch;
    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('does not retry non-retryable 401', async () => {
    const oldFetch = globalThis.fetch;
    let attempts = 0;
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');
    globalThis.fetch = mock(async () => {
      attempts++;
      return new Response('unauthorised', { status: 401 });
    }) as unknown as typeof fetch;

    const { runOneShotCompletionWithSleep } = await import('./one-shot-completion.js');

    await expect(
      runOneShotCompletionWithSleep(
        {
          provider: nanoGpt,
          providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
          apiKey: 'test-key',
          corsProxyUrl: null,
          corsProxyKey: null,
          target: { slug: model.upstreamSlug },
          messages: [{ role: 'user', content: 'hi' }],
          bodyExtras: {},
        },
        async () => {}, // instant test sleep
      ),
    ).rejects.toThrow();
    globalThis.fetch = oldFetch;
    expect(attempts).toBe(1);
  });

  it('throws after exhausting retries', async () => {
    const oldFetch = globalThis.fetch;
    let attempts = 0;
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');
    globalThis.fetch = mock(async () => {
      attempts++;
      return new Response('busy', { status: 503 });
    }) as unknown as typeof fetch;

    const { runOneShotCompletionWithSleep } = await import('./one-shot-completion.js');

    await expect(
      runOneShotCompletionWithSleep(
        {
          provider: nanoGpt,
          providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
          apiKey: 'test-key',
          corsProxyUrl: null,
          corsProxyKey: null,
          target: { slug: model.upstreamSlug },
          messages: [{ role: 'user', content: 'hi' }],
          bodyExtras: {},
        },
        async () => {}, // instant test sleep
      ),
    ).rejects.toThrow();
    globalThis.fetch = oldFetch;
    expect(attempts).toBe(5); // initial + 4 retries
  });
});

describe('one-shot fresh Request per attempt (regression)', () => {
  it('retries a 503 sending a readable body each time, then succeeds', async () => {
    const model = nanoGpt.offerings[0];
    if (!model) throw new Error('no offerings');
    let attempts = 0;
    const bodies: string[] = [];
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (req: Request) => {
      attempts++;
      bodies.push(await req.text()); // consume body as real fetch does
      if (attempts < 2) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const out = await runOneShotCompletionWithSleep(
        {
          provider: nanoGpt,
          providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
          apiKey: 'test-key',
          corsProxyUrl: null,
          corsProxyKey: null,
          target: { slug: model.upstreamSlug },
          messages: [{ role: 'user', content: 'hi' }],
          bodyExtras: {},
        },
        async () => {},
      );
      expect(out).toBe('Hi');
      expect(attempts).toBe(2);
      expect(new Set(bodies).size).toBe(1); // identical body both attempts, no throw
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});
