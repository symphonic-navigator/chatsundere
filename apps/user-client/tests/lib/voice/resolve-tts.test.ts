// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSegment } from '../../../src/lib/voice/segmentation.js';

// ─── Mock: llm-unified ───────────────────────────────────────────────────────
// We mock at the module boundary: synthesiseSpeech, listTtsOfferings, getProvider.
// The real registry (registerBuiltinProviders) is NOT called — we control the
// offering data entirely, so no provider-registration side-effects bleed in.

const synthesiseSpeechMock = vi.fn();
const listTtsOfferingsMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock('@chatsundere/llm-unified', () => ({
  synthesiseSpeech: (...args: unknown[]) => synthesiseSpeechMock(...args),
  listTtsOfferings: () => listTtsOfferingsMock(),
  getProvider: (id: string) => getProviderMock(id),
}));

// ─── Mock: openSecret / secrets layer ────────────────────────────────────────
const openSecretMock = vi.fn();

vi.mock('../../../src/lib/secrets.js', () => ({
  openSecret: (...args: unknown[]) => openSecretMock(...args),
}));

// ─── Mock: session store ─────────────────────────────────────────────────────
// getState().mk is read synchronously in resolveTts.
const mkStub = { _tag: 'MasterKey' } as unknown as CryptoKey;

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: {
    getState: () => ({ mk: mkStub }),
  },
}));

// Re-import the mocked module so tests can spy on it.
import { useSessionStore } from '@chatsundere/ui-shared';

// ─── Real voice cache + fake-indexeddb ───────────────────────────────────────
// The cache is real: we exercise the cache-hit branch by seeding it with cachePut,
// and the write-through branch by observing a second cacheGet hit.
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import { resolveTts } from '../../../src/lib/voice/resolve-tts.js';
import { cacheGet, cachePut, voiceCacheKey } from '../../../src/lib/voice/voice-cache.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROVIDER_ID = 'mistral';
const UPSTREAM_SLUG = 'voxtral-mini-tts-2603';
const MIME_TYPE = 'audio/mpeg';

/** Minimal TTS offering fixture matching the Mistral Voxtral registration. */
const OFFERING_FIXTURE = {
  providerId: PROVIDER_ID,
  upstreamSlug: UPSTREAM_SLUG,
  serviceKind: 'tts',
  tts: { displayName: 'Voxtral Mini TTS', teal: 'strip' as const },
};

/** Minimal ProviderDefinition fixture. */
const PROVIDER_DEF_FIXTURE = {
  id: PROVIDER_ID,
  displayName: 'Mistral AI',
  baseUrl: 'https://api.mistral.ai/v1',
  corsHint: 'direct' as const,
};

function seg(spokenText: string, voice: 'dialogue' | 'narrator' = 'dialogue'): SpeechSegment {
  return {
    segmentId: '0:0',
    spokenText,
    blockIndex: 0,
    paragraphIndex: 0,
    ordinalInParagraph: 0,
    charRange: [0, spokenText.length],
    voice,
  };
}

function minimalPersona(overrides: {
  voice?: string | null;
  narratorVoice?: string | null;
}) {
  // Use explicit `in` check so callers can pass `null` and have it respected
  // (the `??` operator treats null as nullish and would fall back to the default).
  const voice = 'voice' in overrides ? overrides.voice : 'fable-voice-v1';
  const narratorVoice = 'narratorVoice' in overrides ? overrides.narratorVoice : null;
  return {
    id: 'persona-1',
    name: 'Fable',
    tagline: '',
    colour: '#000',
    font: 'serif' as const,
    instructions: '',
    canonicalId: null,
    providerId: 'row-1',
    modelId: UPSTREAM_SLUG,
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first' as const,
    greetingEnabled: false,
    greetingInstructions: '',
    voice: voice ?? null,
    narratorVoice: narratorVoice ?? null,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** DB row id for the Mistral provider row seeded in tests. */
const PROVIDER_ROW_ID = 'provider-row-mistral';

/** Seed a minimal enabled Mistral provider row into the real fake-indexeddb. */
async function seedProvider(enabled = true): Promise<void> {
  const db = await openClientDataDb();
  await db.providers.put({
    id: PROVIDER_ROW_ID,
    templateId: PROVIDER_ID,
    displayName: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    // openSecret is mocked, so any non-null EncryptedBlob-shaped value is fine.
    apiKey: { version: 1, nonce: new Uint8Array(12), ciphertext: new Uint8Array(16) },
    routing: { kind: 'direct' },
    enabled,
    createdAt: 1,
    updatedAt: 1,
  });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();

  // Default happy-path mock state — each test overrides what it needs to.
  listTtsOfferingsMock.mockReturnValue([OFFERING_FIXTURE]);
  getProviderMock.mockReturnValue(PROVIDER_DEF_FIXTURE);
  openSecretMock.mockResolvedValue('test-api-key');
  synthesiseSpeechMock.mockResolvedValue({
    blob: new Blob(['audio'], { type: MIME_TYPE }),
    mimeType: MIME_TYPE,
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  await _resetClientDataDbForTests();
});

// ─── Test cases ──────────────────────────────────────────────────────────────

describe('resolveTts', () => {
  describe('(a) no enabled provider row → no-provider', () => {
    it('returns no-provider when no provider rows exist in the DB', async () => {
      // DB is empty — no providers seeded.
      const result = await resolveTts(minimalPersona({}));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });

    it('returns no-provider when the only matching row is disabled', async () => {
      await seedProvider(false); // disabled
      const result = await resolveTts(minimalPersona({}));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });

    it('returns no-provider when listTtsOfferings returns an empty array', async () => {
      listTtsOfferingsMock.mockReturnValue([]);
      await seedProvider();
      const result = await resolveTts(minimalPersona({}));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });

    it('returns no-provider when the offering has no tts metadata', async () => {
      listTtsOfferingsMock.mockReturnValue([{ ...OFFERING_FIXTURE, tts: undefined }]);
      await seedProvider();
      const result = await resolveTts(minimalPersona({}));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });
  });

  describe('(b) provider ok, persona.voice null → no-voice', () => {
    it('returns no-voice when persona.voice is null', async () => {
      await seedProvider();
      const result = await resolveTts(minimalPersona({ voice: null }));
      expect(result).toEqual({ ok: false, reason: 'no-voice' });
    });

    it('returns no-voice when persona.voice is an empty string', async () => {
      await seedProvider();
      const result = await resolveTts(minimalPersona({ voice: '' }));
      expect(result).toEqual({ ok: false, reason: 'no-voice' });
    });
  });

  describe('(c) happy path: cache hit → cached blob returned, synthesiseSpeech not called', () => {
    it('does not call synthesiseSpeech when the entry is already in cache', async () => {
      await seedProvider();

      const persona = minimalPersona({ voice: 'voice-alpha' });
      const segment = seg('Hello world');
      const cachedBlob = new Blob(['cached-audio'], { type: MIME_TYPE });

      // Pre-seed the cache with the expected key.
      const key = voiceCacheKey(segment.spokenText, PROVIDER_ID, UPSTREAM_SLUG, 'voice-alpha');
      await cachePut({ key, blob: cachedBlob, mimeType: MIME_TYPE });

      const resolution = await resolveTts(persona);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      // fetchAudio should return without going to the network.
      // Note: fake-indexeddb does not preserve Blob identity or type, so we
      // assert on behaviour (synthesiseSpeech silent) rather than blob identity.
      await resolution.fetchAudio(segment, new AbortController().signal);
      expect(synthesiseSpeechMock).not.toHaveBeenCalled();
    });
  });

  describe('(d) cache miss → synthesiseSpeech called, result written to cache', () => {
    it('calls synthesiseSpeech with correct args and writes-through to cache', async () => {
      await seedProvider();

      const persona = minimalPersona({ voice: 'voice-beta' });
      const segment = seg('Speak this sentence');
      const synthesisedBlob = new Blob(['synthesised'], { type: MIME_TYPE });
      synthesiseSpeechMock.mockResolvedValue({ blob: synthesisedBlob, mimeType: MIME_TYPE });

      const resolution = await resolveTts(persona);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      const signal = new AbortController().signal;
      const result = await resolution.fetchAudio(segment, signal);

      // Correct return value.
      expect(result).toBe(synthesisedBlob);

      // synthesiseSpeech called once with the right shape.
      expect(synthesiseSpeechMock).toHaveBeenCalledOnce();
      const callArgs = synthesiseSpeechMock.mock.calls[0]?.[0];
      expect(callArgs?.teal).toBe('strip');
      expect(callArgs?.text).toBe(segment.spokenText);
      expect(callArgs?.voiceId).toBe('voice-beta');
      expect(callArgs?.upstreamSlug).toBe(UPSTREAM_SLUG);
      expect(callArgs?.signal).toBe(signal);

      // Write-through: a second call must hit the cache (synthesiseSpeech NOT called again).
      // Note: fake-indexeddb does not preserve Blob type/identity, so we assert on
      // network silence rather than blob equality.
      await resolution.fetchAudio(segment, new AbortController().signal);
      expect(synthesiseSpeechMock).toHaveBeenCalledOnce(); // still once — came from cache

      // Cache entry is present with the correct key.
      const key = voiceCacheKey(segment.spokenText, PROVIDER_ID, UPSTREAM_SLUG, 'voice-beta');
      const cached = await cacheGet(key);
      expect(cached).toBeDefined();
    });
  });

  describe('(e) narrator voice routing', () => {
    it('uses narratorVoice for narrator segments', async () => {
      await seedProvider();

      const persona = minimalPersona({ voice: 'voice-dialogue', narratorVoice: 'voice-narrator' });
      const narratorSegment = seg('*whispers softly*', 'narrator');
      const dialogueSegment = seg('Hello there', 'dialogue');

      const resolution = await resolveTts(persona);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      const abortCtrl = new AbortController();

      // Narrator segment → uses narratorVoice.
      await resolution.fetchAudio(narratorSegment, abortCtrl.signal);
      const narratorCall = synthesiseSpeechMock.mock.calls[0]?.[0];
      expect(narratorCall?.voiceId).toBe('voice-narrator');

      synthesiseSpeechMock.mockClear();

      // Dialogue segment → uses voice.
      await resolution.fetchAudio(dialogueSegment, abortCtrl.signal);
      const dialogueCall = synthesiseSpeechMock.mock.calls[0]?.[0];
      expect(dialogueCall?.voiceId).toBe('voice-dialogue');

      // Cache keys must differ (different voices for different voices).
      const narratorKey = resolution.cacheKeyFor(narratorSegment);
      const dialogueKey = resolution.cacheKeyFor(dialogueSegment);
      expect(narratorKey).not.toBe(dialogueKey);
    });

    it('falls back to persona.voice for narrator when narratorVoice is null', async () => {
      await seedProvider();

      const persona = minimalPersona({ voice: 'voice-only', narratorVoice: null });
      const narratorSegment = seg('*with a sigh*', 'narrator');

      const resolution = await resolveTts(persona);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      await resolution.fetchAudio(narratorSegment, new AbortController().signal);
      const callArgs = synthesiseSpeechMock.mock.calls[0]?.[0];
      expect(callArgs?.voiceId).toBe('voice-only');
    });

    it('cacheKeyFor differs for different voice IDs', async () => {
      await seedProvider();

      const persona = minimalPersona({ voice: 'voice-dialogue', narratorVoice: 'voice-narrator' });
      const text = 'same spoken text';
      const narSeg = seg(text, 'narrator');
      const dlgSeg = seg(text, 'dialogue');

      const resolution = await resolveTts(persona);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      const narKey = resolution.cacheKeyFor(narSeg);
      const dlgKey = resolution.cacheKeyFor(dlgSeg);
      expect(narKey).not.toBe(dlgKey);

      // Matches the independently-computed key.
      expect(narKey).toBe(voiceCacheKey(text, PROVIDER_ID, UPSTREAM_SLUG, 'voice-narrator'));
      expect(dlgKey).toBe(voiceCacheKey(text, PROVIDER_ID, UPSTREAM_SLUG, 'voice-dialogue'));
    });
  });

  describe('(f) decrypt failure → no-provider, console.warn fired', () => {
    it('returns no-provider and warns when openSecret throws', async () => {
      await seedProvider();

      openSecretMock.mockRejectedValue(new DOMException('AES-GCM auth tag failure'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await resolveTts(minimalPersona({}));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/api-key/);

      warnSpy.mockRestore();
    });
  });

  describe('(g) null master key → no-provider', () => {
    it('returns no-provider when mk is null in the session store', async () => {
      await seedProvider();

      // Temporarily override the session store to simulate an unauthenticated session.
      vi.spyOn(useSessionStore, 'getState').mockReturnValueOnce({
        mk: null,
      } as ReturnType<typeof useSessionStore.getState>);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await resolveTts(minimalPersona({}));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/master key/);

      warnSpy.mockRestore();
    });
  });

  describe('(h) corrupt CORS proxy key → no-provider', () => {
    it('returns no-provider and warns when the cors-proxy/shared-key decrypt fails', async () => {
      await seedProvider();

      // Patch the existing settings row (seeded by openClientDataDb in beforeEach)
      // to add corsProxy, so the openSecret proxy-key call is reached.
      const db = await openClientDataDb();
      await db.settings.update(1, {
        corsProxy: {
          url: 'https://proxy.example.com',
          sharedKey: { version: 1, nonce: new Uint8Array(12), ciphertext: new Uint8Array(16) },
        },
      });

      // api-key succeeds; proxy-key fails.
      openSecretMock
        .mockResolvedValueOnce('test-api-key')
        .mockRejectedValueOnce(new DOMException('AES-GCM auth tag failure'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await resolveTts(minimalPersona({ voice: 'voice-x' }));
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/cors-proxy/);

      warnSpy.mockRestore();
    });
  });

  describe('voiceLabel', () => {
    it('returns the formatted label combining offering displayName and provider displayName', async () => {
      await seedProvider();

      const resolution = await resolveTts(minimalPersona({}));
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      expect(resolution.voiceLabel).toBe('Voxtral Mini TTS via Mistral AI');
    });
  });
});
