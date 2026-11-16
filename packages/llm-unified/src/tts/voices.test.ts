// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SpeechSynthesisError } from './synthesise-speech.js';
import { listTtsVoices } from './voices.js';

const MISTRAL_PROVIDER = {
  baseUrl: 'https://api.mistral.ai/v1',
  routing: { kind: 'direct' } as const,
};
const NANO_PROVIDER = {
  baseUrl: 'https://nano-gpt.com/api/v1',
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

    const { voices, hiddenCount: xaiHidden } = await listTtsVoices({
      providerConfig: XAI_PROVIDER,
      apiKey: 'k',
      endpoint: 'xai-flat',
      fetchFn,
    });

    const sentReq = captured as Request | null;
    expect(sentReq?.url).toBe('https://api.x.ai/v1/tts/voices');
    expect(xaiHidden).toBe(0);
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
        endpoint: 'xai-flat',
        fetchFn,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SpeechSynthesisError);
    expect((thrown as SpeechSynthesisError).status).toBeNull();
  });

  test('xai-flat: hides juvenile voices and counts them', async () => {
    const fetchFn = asMockFetch(async () =>
      jsonResponse({
        voices: [
          { voice_id: 'ara', name: 'Ara' },
          { voice_id: 'kid', name: 'Kid Sparkle' },
        ],
      }),
    );
    const result = await listTtsVoices({
      providerConfig: XAI_PROVIDER,
      apiKey: 'k',
      endpoint: 'xai-flat',
      fetchFn,
    });
    expect(result).toEqual({ voices: [{ id: 'ara', name: 'Ara' }], hiddenCount: 1 });
  });

  test('mistral-paginated: hides juvenile voices and counts them', async () => {
    const fetchFn = asMockFetch(async () =>
      jsonResponse({
        items: [
          { id: 'a', name: 'Alice' },
          { id: 't', name: 'Teen Narrator' },
        ],
        page: 1,
        total_pages: 1,
      }),
    );
    const result = await listTtsVoices({
      providerConfig: MISTRAL_PROVIDER,
      apiKey: 'k',
      endpoint: 'mistral-paginated',
      fetchFn,
    });
    expect(result).toEqual({ voices: [{ id: 'a', name: 'Alice' }], hiddenCount: 1 });
  });

  test('paginates /audio/voices and maps id+name', async () => {
    const pages = [
      { items: [{ id: 'a', name: 'Alice' }], page: 1, total_pages: 2 },
      { items: [{ id: 'b', name: 'Bob' }], page: 2, total_pages: 2 },
    ];
    let call = 0;
    const fetchFn = asMockFetch(async () => jsonResponse(pages[call++]));
    const { voices, hiddenCount } = await listTtsVoices({
      providerConfig: MISTRAL_PROVIDER,
      apiKey: 'k',
      endpoint: 'mistral-paginated',
      fetchFn,
    });
    expect(hiddenCount).toBe(0);
    expect(voices).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });

  test('elevenlabs-v2 pages through next_page_token, maps metadata and filters juveniles', async () => {
    const pages = [
      {
        voices: [
          {
            voice_id: 'j1',
            name: 'Jessica',
            category: 'premade',
            description: 'Warm',
            labels: { gender: 'female', language: 'en' },
          },
          { voice_id: 'c1', name: 'Cove', category: 'cloned', labels: {} },
        ],
        has_more: true,
        next_page_token: 't',
      },
      {
        voices: [{ voice_id: 'p1', name: 'Piku - Expressive Kid Character', category: 'premade' }],
        has_more: false,
      },
    ];
    const urls: string[] = [];
    let call = 0;
    const fetchFn = asMockFetch(async (input) => {
      urls.push((input as Request).url);
      return jsonResponse(pages[call++]);
    });
    const result = await listTtsVoices({
      providerConfig: { baseUrl: 'https://api.elevenlabs.io/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      endpoint: 'elevenlabs-v2',
      fetchFn,
    });
    expect(urls[0]).toBe('https://api.elevenlabs.io/v2/voices?page_size=100');
    expect(urls[1]).toBe('https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=t');
    expect(result).toEqual({
      voices: [
        {
          id: 'j1',
          name: 'Jessica',
          origin: 'predefined',
          gender: 'female',
          language: 'en',
          description: 'Warm',
        },
        { id: 'c1', name: 'Cove', origin: 'own' },
      ],
      hiddenCount: 1,
    });
  });

  const EL_PROVIDER = {
    baseUrl: 'https://api.elevenlabs.io/v1',
    routing: { kind: 'direct' } as const,
  };

  test('elevenlabs-v2 hides by description and descriptive label, drops unknown gender', async () => {
    const fetchFn = asMockFetch(async () =>
      jsonResponse({
        voices: [
          { voice_id: 'a', name: 'Mia', category: 'premade', description: 'a little girl voice' },
          {
            voice_id: 'b',
            name: 'Lea',
            category: 'premade',
            labels: { descriptive: 'childish' },
          },
          { voice_id: 'c', name: 'Sam', category: 'cloned', labels: { gender: 'non-binary' } },
        ],
        has_more: false,
      }),
    );
    const result = await listTtsVoices({
      providerConfig: EL_PROVIDER,
      apiKey: 'k',
      endpoint: 'elevenlabs-v2',
      fetchFn,
    });
    expect(result.hiddenCount).toBe(2);
    expect(result.voices).toEqual([{ id: 'c', name: 'Sam', origin: 'own' }]);
    expect(result.voices[0]?.gender).toBeUndefined();
  });

  test('elevenlabs-v2 stops on a repeated next_page_token', async () => {
    let calls = 0;
    const fetchFn = asMockFetch(async () => {
      calls += 1;
      return jsonResponse({
        voices: [{ voice_id: `v${calls}`, name: `V${calls}`, category: 'premade' }],
        has_more: true,
        next_page_token: 'same',
      });
    });
    const result = await listTtsVoices({
      providerConfig: EL_PROVIDER,
      apiKey: 'k',
      endpoint: 'elevenlabs-v2',
      fetchFn,
    });
    expect(calls).toBe(2);
    expect(result.voices).toHaveLength(2);
  });

  describe('nano-gpt-audio-models', () => {
    const catalogue = [
      { id: 'other/model', supported_parameters: { voices: ['Nope'] } },
      {
        id: 'elevenlabs/eleven-v4',
        name: 'ElevenLabs v4',
        supported_parameters: { max_chars: 10000, voices: ['Laura', 'Roger', 'Kid Voice'] },
      },
    ];

    test('requests the detailed tts catalogue and maps the matching entry', async () => {
      let captured: Request | null = null;
      const fetchFn = asMockFetch(async (input) => {
        captured = input as Request;
        return jsonResponse(catalogue);
      });
      const result = await listTtsVoices({
        providerConfig: NANO_PROVIDER,
        apiKey: 'k',
        endpoint: 'nano-gpt-audio-models',
        upstreamSlug: 'elevenlabs/eleven-v4',
        fetchFn,
      });
      const sent = captured as Request | null;
      expect(sent?.url).toBe('https://nano-gpt.com/api/v1/audio-models?type=tts&detailed=true');
      expect(result.voices).toEqual([
        { id: 'Laura', name: 'Laura' },
        { id: 'Roger', name: 'Roger' },
      ]);
      expect(result.hiddenCount).toBe(1);
    });

    test('accepts a {data: [...]} envelope', async () => {
      const fetchFn = asMockFetch(async () => jsonResponse({ data: catalogue }));
      const result = await listTtsVoices({
        providerConfig: NANO_PROVIDER,
        apiKey: 'k',
        endpoint: 'nano-gpt-audio-models',
        upstreamSlug: 'elevenlabs/eleven-v4',
        fetchFn,
      });
      expect(result.voices.map((v) => v.id)).toEqual(['Laura', 'Roger']);
    });

    test('a missing slug entry throws', async () => {
      const fetchFn = asMockFetch(async () => jsonResponse(catalogue));
      let thrown: unknown = null;
      try {
        await listTtsVoices({
          providerConfig: NANO_PROVIDER,
          apiKey: 'k',
          endpoint: 'nano-gpt-audio-models',
          upstreamSlug: 'elevenlabs/absent',
          fetchFn,
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SpeechSynthesisError);
      expect((thrown as SpeechSynthesisError).message).toBe('voices: model not in catalogue');
      expect((thrown as SpeechSynthesisError).status).toBeNull();
    });
  });
});
