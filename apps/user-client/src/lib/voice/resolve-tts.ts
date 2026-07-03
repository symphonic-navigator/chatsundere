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
      /** The active offering's cleanup high-pass recommendation, for the 'auto' setting. */
      defaultHighpassHz: 50 | 100 | undefined;
    }
  | { ok: false; reason: 'no-provider' | 'no-voice' };

/** The resolved transport material shared by resolveTts and the voice picker UI. */
export interface TtsTransport {
  providerConfig: { baseUrl: string; routing: { kind: 'direct' } | { kind: 'cors-proxy' } };
  apiKey: string;
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

  const material = await resolveVoiceTransportMaterial(selected, providerRows, 'resolveTts');
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

  const { providerConfig, apiKey, offering, ttsMeta } = transport;

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

  // In-flight dedup (device finding 2026-06-12): the machine cancels the
  // prefetch actor whenever the current segment finishes playing before the
  // next one's synthesis completes, and playSegment then re-requested the SAME
  // synthesis from scratch — a doubled upstream call and up to the full
  // synthesis time of audible silence. Concurrent fetchAudio calls for one
  // cache key now share a single upstream request; the underlying fetch aborts
  // only when EVERY consumer has aborted (a real stop), never on a mere
  // segment advance.
  interface InFlightSynthesis {
    promise: Promise<Blob>;
    retain: (signal: AbortSignal) => void;
  }
  const inFlight = new Map<string, InFlightSynthesis>();

  const startSynthesis = (key: string, segment: SpeechSegment): InFlightSynthesis => {
    const controller = new AbortController();
    let consumers = 0;
    const releases: Array<() => void> = [];
    const retain = (signal: AbortSignal): void => {
      // An already-aborted consumer contributes nothing; the synthesis then
      // simply completes into the cache for the next read.
      if (signal.aborted) return;
      consumers += 1;
      const onAbort = (): void => {
        consumers -= 1;
        if (consumers === 0) controller.abort();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      releases.push(() => signal.removeEventListener('abort', onAbort));
    };
    const voiceId = voiceIdFor(segment);
    const promise = (async (): Promise<Blob> => {
      try {
        const result = await synthesiseSpeech({
          providerConfig,
          apiKey,
          upstreamSlug,
          teal: ttsMeta.teal,
          transport: ttsMeta.transport,
          text: segment.spokenText,
          voiceId,
          signal: controller.signal,
        });
        // Write-through: the just-synthesised blob lands in cache for replay.
        await cachePut({ key, blob: result.blob, mimeType: result.mimeType });
        return result.blob;
      } catch (err) {
        // Aborted because every consumer left (user stop / skip) — benign.
        if (controller.signal.aborted) {
          console.info('[voice-tts] synthesis aborted (no remaining consumer)', {
            segmentId: segment.segmentId,
            length: segment.spokenText.length,
          });
          throw err;
        }
        // Device finding 2026-06-12: a synthesis failure surfaced only as the
        // opaque "Couldn't read this part aloud" transport state — the cause
        // was swallowed. Log the provider boundary so the reason is visible;
        // error handling is unchanged.
        const status = err instanceof SpeechSynthesisError ? err.status : null;
        console.error('[voice-tts] synthesis failed', {
          status,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          segmentId: segment.segmentId,
          voice: segment.voice,
          voiceId,
          length: segment.spokenText.length,
          text: segment.spokenText.slice(0, 160),
        });
        throw err;
      } finally {
        inFlight.delete(key);
        for (const release of releases) release();
      }
    })();
    return { promise, retain };
  };

  const fetchAudio = async (segment: SpeechSegment, signal: AbortSignal): Promise<Blob> => {
    const key = cacheKeyFor(segment);

    // Cache hit — return immediately without a network call.
    const cached = await cacheGet(key);
    if (cached) return cached.blob;

    // Cache miss — join the in-flight synthesis for this key, or start one.
    let entry = inFlight.get(key);
    if (!entry) {
      entry = startSynthesis(key, segment);
      inFlight.set(key, entry);
    }
    entry.retain(signal);
    return entry.promise;
  };

  const voiceLabel = `${ttsMeta.displayName} via ${providerDisplayName}`;

  return {
    ok: true,
    fetchAudio,
    voiceLabel,
    cacheKeyFor,
    defaultHighpassHz: ttsMeta.defaultHighpassHz,
  };
}
