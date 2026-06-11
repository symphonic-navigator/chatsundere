// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SpeechSynthesisError, synthesiseSpeech } from './synthesise-speech.js';
import { listTtsVoices } from './voices.js';

const PROVIDER = { baseUrl: 'https://api.mistral.ai/v1', routing: { kind: 'direct' } as const };

function asMockFetch(
  impl: (input: string | Request | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(impl, { preconnect: async () => {} }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('synthesiseSpeech', () => {
  test('POSTs model/input/voice_id, decodes base64 audio_data to an MP3 blob', async () => {
    type Captured = { url: string; body: Record<string, unknown>; auth: string | null };
    const captures: Captured[] = [];
    const fetchFn = asMockFetch(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      captures.push({
        url: req.url,
        body: JSON.parse(await req.text()) as Record<string, unknown>,
        auth: req.headers.get('authorization'),
      });
      return jsonResponse({ audio_data: 'abc=' });
    });

    const result = await synthesiseSpeech({
      providerConfig: PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'voxtral-mini-tts-2603',
      teal: 'strip',
      text: 'Hello [laugh] there, <whisper>friend</whisper>.',
      voiceId: 'v1',
      fetchFn,
    });

    const captured = captures[0];
    if (captured === undefined) throw new Error('fetch was never called');
    expect(captured.url).toBe('https://api.mistral.ai/v1/audio/speech');
    expect(captured.auth).toBe('Bearer k');
    expect(captured.body).toEqual({
      model: 'voxtral-mini-tts-2603',
      input: 'Hello there, friend.', // TEAL stripped via the hook
      voice_id: 'v1',
      stream: false,
    });
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.blob.type).toBe('audio/mpeg');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  test('teal passthrough leaves tags in the input', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = asMockFetch(async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      bodies.push(JSON.parse(await req.text()) as Record<string, unknown>);
      return jsonResponse({ audio_data: 'abc=' });
    });
    await synthesiseSpeech({
      providerConfig: PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'voxtral-mini-tts-2603',
      teal: 'passthrough',
      text: 'Hello [laugh].',
      voiceId: 'v1',
      fetchFn,
    });
    const body = bodies[0];
    if (body === undefined) throw new Error('fetch was never called');
    expect(body.input).toBe('Hello [laugh].');
  });

  test('non-OK status throws SpeechSynthesisError carrying the status', async () => {
    const fetchFn = asMockFetch(async () => new Response('nope', { status: 429 }));
    await expect(
      synthesiseSpeech({
        providerConfig: PROVIDER,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        upstreamSlug: 'voxtral-mini-tts-2603',
        teal: 'strip',
        text: 'x',
        voiceId: 'v1',
        fetchFn,
      }),
    ).rejects.toThrow(SpeechSynthesisError);
  });

  test('missing audio_data throws', async () => {
    const fetchFn = asMockFetch(async () => jsonResponse({}));
    await expect(
      synthesiseSpeech({
        providerConfig: PROVIDER,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        upstreamSlug: 'voxtral-mini-tts-2603',
        teal: 'strip',
        text: 'x',
        voiceId: 'v1',
        fetchFn,
      }),
    ).rejects.toThrow('audio_data');
  });
});

describe('listTtsVoices', () => {
  test('paginates /audio/voices and maps id+name', async () => {
    const pages = [
      { items: [{ id: 'a', name: 'Alice' }], page: 1, total_pages: 2 },
      { items: [{ id: 'b', name: 'Bob' }], page: 2, total_pages: 2 },
    ];
    let call = 0;
    const fetchFn = asMockFetch(async () => jsonResponse(pages[call++]));
    const voices = await listTtsVoices({
      providerConfig: PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      fetchFn,
    });
    expect(voices).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });
});
