// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SpeechSynthesisError, synthesiseSpeech } from './synthesise-speech.js';

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
      transport: 'mistral-speech',
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
      transport: 'mistral-speech',
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
        transport: 'mistral-speech',
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
        transport: 'mistral-speech',
        text: 'x',
        voiceId: 'v1',
        fetchFn,
      }),
    ).rejects.toThrow('audio_data');
  });

  test('xai-native: posts {text, voice_id, language} to /tts and returns the binary blob', async () => {
    let captured: Request | null = null;
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // ID3 sentinel bytes
    const fetchFn = asMockFetch(async (input) => {
      captured = input instanceof Request ? input : new Request(String(input));
      return new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    });

    const result = await synthesiseSpeech({
      providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'grok-tts',
      teal: 'passthrough',
      transport: 'xai-native',
      text: '[laugh] Hello',
      voiceId: 'eve',
      fetchFn,
    });

    const req = captured as Request | null;
    if (req === null) throw new Error('fetch was never called');
    expect(req.url).toBe('https://api.x.ai/v1/tts');
    const body = JSON.parse(await req.text()) as Record<string, unknown>;
    // No model field; TEAL passthrough keeps the tag verbatim.
    expect(body).toEqual({ text: '[laugh] Hello', voice_id: 'eve', language: 'auto' });
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.blob.size).toBe(mp3.byteLength);
  });

  test('openai-speech: posts {model, input, voice} to /audio/speech and returns the binary blob', async () => {
    let captured: Request | null = null;
    const fetchFn = asMockFetch(async (input) => {
      captured = input instanceof Request ? input : new Request(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    await synthesiseSpeech({
      providerConfig: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'xai-tts',
      teal: 'passthrough',
      transport: 'openai-speech',
      text: 'Hello',
      voiceId: 'eve',
      fetchFn,
    });

    const req = captured as Request | null;
    if (req === null) throw new Error('fetch was never called');
    expect(req.url).toBe('https://nano-gpt.com/api/v1/audio/speech');
    const body = JSON.parse(await req.text()) as Record<string, unknown>;
    expect(body).toEqual({ model: 'xai-tts', input: 'Hello', voice: 'eve' });
  });

  test('raw-audio transport rejects a 200 response whose body is not audio', async () => {
    const fetchFn = asMockFetch(
      async () =>
        new Response('<html>upstream error page</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );

    const attempt = synthesiseSpeech({
      providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'grok-tts',
      teal: 'passthrough',
      transport: 'xai-native',
      text: 'Hello',
      voiceId: 'eve',
      fetchFn,
    });

    await expect(attempt).rejects.toThrow('TTS response is not audio');
  });

  test('raw-audio transport falls back to audio/mpeg when content-type is missing', async () => {
    const fetchFn = asMockFetch(async () => {
      const response = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      response.headers.delete('content-type');
      return response;
    });

    const result = await synthesiseSpeech({
      providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      upstreamSlug: 'grok-tts',
      teal: 'passthrough',
      transport: 'xai-native',
      text: 'Hello',
      voiceId: 'eve',
      fetchFn,
    });

    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.blob.size).toBe(3);
  });
});
