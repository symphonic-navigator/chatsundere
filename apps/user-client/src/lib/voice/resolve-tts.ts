// SPDX-License-Identifier: AGPL-3.0-only

import {
  type Offering,
  SpeechSynthesisError,
  type TtsOfferingMeta,
  getProvider,
  synthesiseSpeech,
} from '@chatsundere/llm-unified';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { getClientDataDb } from '../../boot/client-data-db.js';
import type { SpeechSegment } from './segmentation.js';
import { selectTtsOffering } from './select-offering.js';
import { cacheGet, cachePut, voiceCacheKey } from './voice-cache.js';
import { resolveVoiceTransportMaterial } from './voice-transport.js';

export type TtsResolution =
  | {
      ok: true;
      /** VoiceDeps.fetchAudio implementation: cache-first, synthesise on miss, write-through. */
      fetchAudio: (segment: SpeechSegment, signal: AbortSignal) => Promise<Blob>;
      /** For UI labels, e.g. 'Voxtral Mini TTS via Mistral AI'. */
      voiceLabel: string;
      /** Cache-key inputs exposed so the playback layer can evict a poisoned entry. */
      cacheKeyFor: (segment: SpeechSegment) => string;
    }
  | { ok: false; reason: 'no-provider' | 'no-voice' };

/** The resolved transport material shared by resolveTts and the voice picker UI. */
export interface TtsTransport {
  providerConfig: { baseUrl: string; routing: { kind: 'direct' } | { kind: 'cors-proxy' } };
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  /** Full TTS metadata — always present when TtsTransport is returned. */
  ttsMeta: TtsOfferingMeta;
}

/**
 * Resolve the transport material for the active TTS offering (auth, proxy, offering).
 * The offering comes from the slot selector: the persisted explicit pick when
 * one exists, the curated auto-default order otherwise. Returns null when no
 * enabled offering resolves or when decryption fails. UI-free: no React imports.
 */
export async function resolveTtsTransport(): Promise<TtsTransport | null> {
  const db = getClientDataDb();
  const providerRows = await db.providers.toArray();
  const settings = await db.settings.get(1);

  const selected = selectTtsOffering(settings?.ttsOffering ?? null, providerRows);
  if (!selected) return null;
  const { offering } = selected;

  // Guard: malformed or missing TTS registration.
  const ttsMeta = offering.tts;
  if (!ttsMeta) return null;

  const material = await resolveVoiceTransportMaterial(
    selected,
    providerRows,
    settings,
    'resolveTts',
  );
  if (!material) return null;

  return { ...material, offering, ttsMeta };
}

/**
 * Resolve the TTS pipeline for a persona, or the constructive reason why it
 * cannot run. Resolves mk / apiKey / proxy material once — the returned
 * `fetchAudio` closure captures them for repeated use. UI-free: no React imports.
 */
export async function resolveTts(persona: PersonaRow): Promise<TtsResolution> {
  const transport = await resolveTtsTransport();

  if (!transport) {
    return { ok: false, reason: 'no-provider' };
  }

  const { providerConfig, apiKey, corsProxyUrl, corsProxyKey, offering, ttsMeta } = transport;

  // Check voice configuration AFTER provider resolution, so provider problems surface first.
  if (!persona.voice) {
    return { ok: false, reason: 'no-voice' };
  }

  // Snapshot the offering metadata used by both cacheKeyFor and fetchAudio.
  const { upstreamSlug } = offering;
  const { providerId } = offering;
  const providerDisplayName = getProvider(providerId)?.displayName ?? providerId;

  /** Resolve which voiceId to use for a given segment. */
  const voiceIdFor = (segment: SpeechSegment): string => {
    if (segment.voice === 'narrator') {
      return persona.narratorVoice ?? persona.voice ?? '';
    }
    // persona.voice is non-null here (guarded above).
    return persona.voice ?? '';
  };

  const cacheKeyFor = (segment: SpeechSegment): string =>
    voiceCacheKey(segment.spokenText, providerId, upstreamSlug, voiceIdFor(segment));

  const fetchAudio = async (segment: SpeechSegment, signal: AbortSignal): Promise<Blob> => {
    const key = cacheKeyFor(segment);

    // Cache hit — return immediately without a network call.
    const cached = await cacheGet(key);
    if (cached) return cached.blob;

    // Cache miss — synthesise from the upstream provider.
    const voiceId = voiceIdFor(segment);
    let result: Awaited<ReturnType<typeof synthesiseSpeech>>;
    try {
      result = await synthesiseSpeech({
        providerConfig,
        apiKey,
        corsProxyUrl,
        corsProxyKey,
        upstreamSlug,
        teal: ttsMeta.teal,
        transport: ttsMeta.transport,
        text: segment.spokenText,
        voiceId,
        signal,
      });
    } catch (err) {
      // Device finding 2026-06-12: a synthesis failure surfaced only as the
      // opaque "Couldn't read this part aloud" transport state — the cause was
      // swallowed. Log the provider boundary (HTTP status + the offending
      // segment) so the real reason is visible; error handling is unchanged.
      const status = err instanceof SpeechSynthesisError ? err.status : null;
      console.error('[voice-tts] synthesis failed', {
        status,
        segmentId: segment.segmentId,
        voice: segment.voice,
        voiceId,
        length: segment.spokenText.length,
        text: segment.spokenText.slice(0, 160),
      });
      throw err;
    }

    // Write-through: the just-synthesised blob lands in cache for replay.
    await cachePut({ key, blob: result.blob, mimeType: result.mimeType });
    return result.blob;
  };

  const voiceLabel = `${ttsMeta.displayName} via ${providerDisplayName}`;

  return { ok: true, fetchAudio, voiceLabel, cacheKeyFor };
}
