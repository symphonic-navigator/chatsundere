// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SpeechSynthesisError } from './synthesise-speech.js';
import { listTtsVoices } from './voices.js';

const MISTRAL_PROVIDER = {
  baseUrl: 'https://api.mistral.ai/v1',
  routing: { kind: 'direct' } as const,
};
const XAI_PROVIDER = { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } as const };

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

describe('listTtsVoices', () => {
  test('xai-flat: parses {voices:[{voice_id,name}]} from /tts/voices in one shot', async () => {
    let captured: Request | null = null;
    const fetchFn = asMockFetch(async (input) => {
      captured = input as Request;
      return jsonResponse({
        voices: [
          { voice_id: 'ara', name: 'Ara', language: 'multilingual', gender: 'female' },
          { voice_id: 'eve', name: 'Eve', language: 'multilingual', gender: 'female' },
          { malformed: true },
        ],
      });
    });

    const voices = await listTtsVoices({
      providerConfig: XAI_PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      endpoint: 'xai-flat',
      fetchFn,
    });

    const sentReq = captured as Request | null;
    expect(sentReq?.url).toBe('https://api.x.ai/v1/tts/voices');
    expect(voices).toEqual([
      { id: 'ara', name: 'Ara' },
      { id: 'eve', name: 'Eve' },
    ]);
  });

  test('xai-flat: non-OK status throws SpeechSynthesisError carrying the status', async () => {
    const fetchFn = asMockFetch(async () => new Response('nope', { status: 500 }));

    let thrown: unknown = null;
    try {
      await listTtsVoices({
        providerConfig: XAI_PROVIDER,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        endpoint: 'xai-flat',
        fetchFn,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SpeechSynthesisError);
    expect((thrown as SpeechSynthesisError).status).toBe(500);
  });

  test('xai-flat: 200 without a voices array throws with a null status', async () => {
    const fetchFn = asMockFetch(async () => jsonResponse({ unexpected: true }));

    let thrown: unknown = null;
    try {
      await listTtsVoices({
        providerConfig: XAI_PROVIDER,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        endpoint: 'xai-flat',
        fetchFn,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SpeechSynthesisError);
    expect((thrown as SpeechSynthesisError).status).toBeNull();
  });

  test('paginates /audio/voices and maps id+name', async () => {
    const pages = [
      { items: [{ id: 'a', name: 'Alice' }], page: 1, total_pages: 2 },
      { items: [{ id: 'b', name: 'Bob' }], page: 2, total_pages: 2 },
    ];
    let call = 0;
    const fetchFn = asMockFetch(async () => jsonResponse(pages[call++]));
    const voices = await listTtsVoices({
      providerConfig: MISTRAL_PROVIDER,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      endpoint: 'mistral-paginated',
      fetchFn,
    });
    expect(voices).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });
});
