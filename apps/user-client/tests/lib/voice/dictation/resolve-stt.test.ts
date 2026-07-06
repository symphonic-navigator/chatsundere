// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock: llm-unified ───────────────────────────────────────────────────────
// We mock at the module boundary: transcribeAudio, listSttOfferings, getProvider.
// The real registry is NOT called — we control offering data entirely.

const transcribeAudioMock = vi.fn();
const listSttOfferingsMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock('@chatsundere/llm-unified', () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudioMock(...args),
  listSttOfferings: () => listSttOfferingsMock(),
  // select-offering.ts imports this too; STT resolution never calls it.
  listTtsOfferings: () => [],
  getProvider: (id: string) => getProviderMock(id),
  TranscriptionError: class TranscriptionError extends Error {
    status: number | null;
    constructor(message: string, status: number | null) {
      super(message);
      this.name = 'TranscriptionError';
      this.status = status;
    }
  },
}));

// ─── Mock: openSecret / secrets layer ────────────────────────────────────────
const openSecretMock = vi.fn();

vi.mock('../../../../src/lib/secrets.js', () => ({
  openSecret: (...args: unknown[]) => openSecretMock(...args),
}));

// ─── Mock: session store ─────────────────────────────────────────────────────
// getState().mk is read synchronously in resolveStt.
const mkStub = { _tag: 'MasterKey' } as unknown as CryptoKey;

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: {
    getState: () => ({ mk: mkStub }),
  },
}));

// Re-import the mocked module so tests can spy on it.
import { useSessionStore } from '@chatsundere/ui-shared';

// ─── DB helpers ──────────────────────────────────────────────────────────────
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../../src/boot/client-data-db.js';
import { resolveStt } from '../../../../src/lib/voice/dictation/resolve-stt.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROVIDER_ID = 'mistral';
const UPSTREAM_SLUG = 'voxtral-mini-latest';

/** Minimal STT offering fixture matching the Mistral Voxtral STT registration. */
const OFFERING_FIXTURE = {
  providerId: PROVIDER_ID,
  upstreamSlug: UPSTREAM_SLUG,
  serviceKind: 'stt',
  stt: {
    displayName: 'Voxtral Mini STT',
    contentModerated: false,
    transport: 'openai-transcriptions' as const,
  },
};

/** xAI Grok STT fixture — second in the curated auto-default order. */
const XAI_OFFERING = {
  providerId: 'xai',
  upstreamSlug: 'grok-stt',
  serviceKind: 'stt',
  // Voice endpoints are CORS-open even though xAI chat requires the proxy.
  corsOverride: 'direct' as const,
  stt: { displayName: 'Grok STT', contentModerated: false, transport: 'xai-native' as const },
};

/** nano-gpt Grok STT fixture — third in the auto-default order. */
const NANO_OFFERING = {
  providerId: 'nano-gpt',
  upstreamSlug: 'xai/speech-to-text/v1',
  serviceKind: 'stt',
  stt: {
    displayName: 'Grok STT',
    contentModerated: false,
    transport: 'openai-transcriptions' as const,
    spoofWebmAsMatroska: true,
  },
};

/** Minimal ProviderDefinition fixtures keyed by provider id. */
const PROVIDER_DEFS: Record<string, unknown> = {
  mistral: {
    id: PROVIDER_ID,
    displayName: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    corsHint: 'direct' as const,
  },
  xai: {
    id: 'xai',
    displayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    corsHint: 'requires-proxy' as const,
  },
  'nano-gpt': {
    id: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: 'https://nano-gpt.com/api/v1',
    corsHint: 'inofficial' as const,
  },
};

/** Seed a minimal enabled provider row into the real fake-indexeddb. */
async function seedProvider(templateId = PROVIDER_ID, enabled = true): Promise<void> {
  const db = await openClientDataDb();
  await db.providers.put({
    id: `provider-row-${templateId}`,
    templateId,
    displayName: templateId,
    baseUrl: 'https://example.com/v1',
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
  listSttOfferingsMock.mockReturnValue([OFFERING_FIXTURE, XAI_OFFERING, NANO_OFFERING]);
  getProviderMock.mockImplementation((id: string) => PROVIDER_DEFS[id]);
  openSecretMock.mockResolvedValue('test-api-key');
  transcribeAudioMock.mockResolvedValue({ text: 'Hello world' });
});

afterEach(async () => {
  vi.clearAllMocks();
  await _resetClientDataDbForTests();
});

// ─── Test cases ──────────────────────────────────────────────────────────────

describe('resolveStt', () => {
  describe('(a) no enabled provider row → no-provider', () => {
    it('returns no-provider when no provider rows exist in the DB', async () => {
      // DB is empty — no providers seeded.
      const result = await resolveStt();
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });

    it('returns no-provider when the only matching row is disabled', async () => {
      await seedProvider(PROVIDER_ID, false); // disabled
      const result = await resolveStt();
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });

    it('returns no-provider when listSttOfferings returns an empty array', async () => {
      listSttOfferingsMock.mockReturnValue([]);
      await seedProvider();
      const result = await resolveStt();
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });

    it('returns no-provider when the offering has no stt metadata', async () => {
      listSttOfferingsMock.mockReturnValue([{ ...OFFERING_FIXTURE, stt: undefined }]);
      await seedProvider();
      const result = await resolveStt();
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
    });
  });

  describe('(b) happy path', () => {
    it('resolves ok:true with correct sttLabel', async () => {
      await seedProvider();

      const resolution = await resolveStt();
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      expect(resolution.sttLabel).toBe('Voxtral Mini STT via Mistral AI');
    });

    it('transcribe delegates to transcribeAudio with decrypted key, slug, blob, mime, signal', async () => {
      await seedProvider();

      openSecretMock.mockResolvedValue('decrypted-api-key');
      transcribeAudioMock.mockResolvedValue({ text: 'The transcript result' });

      const resolution = await resolveStt();
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      const blob = new Blob(['audio-data'], { type: 'audio/webm' });
      const mimeType = 'audio/webm;codecs=opus';
      const signal = new AbortController().signal;

      const text = await resolution.transcribe(blob, mimeType, signal);

      expect(text).toBe('The transcript result');
      expect(transcribeAudioMock).toHaveBeenCalledOnce();
      const callArgs = transcribeAudioMock.mock.calls[0]?.[0];
      expect(callArgs?.apiKey).toBe('decrypted-api-key');
      expect(callArgs?.upstreamSlug).toBe(UPSTREAM_SLUG);
      expect(callArgs?.blob).toBe(blob);
      expect(callArgs?.mimeType).toBe(mimeType);
      expect(callArgs?.signal).toBe(signal);
      // Per-offering wire metadata travels with the call.
      expect(callArgs?.transport).toBe('openai-transcriptions');
      expect(callArgs?.spoofWebmAsMatroska).toBeUndefined();
    });
  });

  describe('(e) offering selection (slot picker)', () => {
    it('auto-defaults to Mistral when mistral and xai are both enabled', async () => {
      await seedProvider('mistral');
      await seedProvider('xai');

      const resolution = await resolveStt();
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      expect(resolution.sttLabel).toBe('Voxtral Mini STT via Mistral AI');
    });

    it('respects an explicit xai:grok-stt pick and routes direct via corsOverride', async () => {
      await seedProvider('mistral');
      await seedProvider('xai');
      const db = await openClientDataDb();
      await db.settings.update(1, { sttOffering: 'xai:grok-stt' });

      const resolution = await resolveStt();
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      await resolution.transcribe(
        new Blob(['audio'], { type: 'audio/webm' }),
        'audio/webm',
        new AbortController().signal,
      );
      const callArgs = transcribeAudioMock.mock.calls[0]?.[0];
      expect(callArgs?.upstreamSlug).toBe('grok-stt');
      expect(callArgs?.transport).toBe('xai-native');
      // xAI chat needs the proxy; the voice offerings override to direct.
      expect(callArgs?.providerConfig?.routing).toEqual({ kind: 'direct' });
    });

    it('forwards spoofWebmAsMatroska for the nano-gpt offering', async () => {
      await seedProvider('nano-gpt');
      const db = await openClientDataDb();
      await db.settings.update(1, { sttOffering: 'nano-gpt:xai/speech-to-text/v1' });

      const resolution = await resolveStt();
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;

      await resolution.transcribe(
        new Blob(['audio'], { type: 'audio/webm' }),
        'audio/webm',
        new AbortController().signal,
      );
      const callArgs = transcribeAudioMock.mock.calls[0]?.[0];
      expect(callArgs?.upstreamSlug).toBe('xai/speech-to-text/v1');
      expect(callArgs?.spoofWebmAsMatroska).toBe(true);
    });
  });

  describe('(c) decrypt failure → no-provider', () => {
    it('returns no-provider and warns when openSecret throws', async () => {
      await seedProvider();

      openSecretMock.mockRejectedValue(new DOMException('AES-GCM auth tag failure'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await resolveStt();
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/api-key/);

      warnSpy.mockRestore();
    });
  });

  describe('(d) null master key → no-provider', () => {
    it('returns no-provider when mk is null in the session store', async () => {
      await seedProvider();

      // Temporarily override the session store to simulate an unauthenticated session.
      vi.spyOn(useSessionStore, 'getState').mockReturnValueOnce({
        mk: null,
      } as ReturnType<typeof useSessionStore.getState>);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await resolveStt();
      expect(result).toEqual({ ok: false, reason: 'no-provider' });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/master key/);

      warnSpy.mockRestore();
    });
  });
});
