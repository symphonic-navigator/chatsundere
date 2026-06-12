// SPDX-License-Identifier: AGPL-3.0-only

import {
  type Offering,
  SpeechSynthesisError,
  getProvider,
  listTtsOfferings,
  synthesiseSpeech,
} from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { openSecret } from '../secrets.js';
import type { SpeechSegment } from './segmentation.js';
import { cacheGet, cachePut, voiceCacheKey } from './voice-cache.js';

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

/** The TTS display metadata (narrowed from Offering.tts, which is optional). */
interface TtsMeta {
  displayName: string;
  teal: 'strip' | 'passthrough';
}

/** The resolved transport material shared by resolveTts and the voice picker UI. */
export interface TtsTransport {
  providerConfig: { baseUrl: string; routing: { kind: 'direct' } | { kind: 'cors-proxy' } };
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  /** Narrowed TTS metadata — always present when TtsTransport is returned. */
  ttsMeta: TtsMeta;
}

/**
 * Resolve the transport material for the active TTS provider (auth, proxy, offering).
 * Returns null when no enabled TTS provider row exists or when decryption fails.
 * UI-free: no React imports.
 */
export async function resolveTtsTransport(): Promise<TtsTransport | null> {
  // Pick the first TTS offering (v1 has exactly one — Mistral Voxtral).
  const offerings = listTtsOfferings();
  const offering = offerings[0];

  // Guard: malformed or missing TTS registration.
  const ttsMeta = offering?.tts;
  if (!ttsMeta) return null;

  const providerDef = getProvider(offering.providerId);
  if (!providerDef) return null;

  // Locate an enabled provider row whose templateId matches the offering.
  const db = getClientDataDb();
  const providerRow = (
    await db.providers.where('templateId').equals(offering.providerId).toArray()
  ).find((p) => p.enabled);

  if (!providerRow) return null;

  // Resolve mk from the session store — same pattern as send-message.ts.
  const mk = useSessionStore.getState().mk;

  let apiKey: string;
  try {
    if (!mk) {
      console.warn('resolveTts: no master key in session — falling back to no-provider');
      return null;
    }
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn('resolveTts: failed to decrypt api-key — falling back to no-provider');
    return null;
  }

  // Resolve the optional CORS proxy.
  const settings = await db.settings.get(1);
  const corsProxyUrl = settings?.corsProxy?.url ?? null;
  let corsProxyKey: string | null = null;
  if (settings?.corsProxy && mk) {
    try {
      corsProxyKey = await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key');
    } catch {
      console.warn(
        'resolveTts: failed to decrypt cors-proxy/shared-key — falling back to no-provider',
      );
      return null;
    }
  }

  const providerConfig = {
    baseUrl: providerDef.baseUrl,
    routing:
      providerDef.corsHint === 'requires-proxy'
        ? ({ kind: 'cors-proxy' } as const)
        : ({ kind: 'direct' } as const),
  };

  return { providerConfig, apiKey, corsProxyUrl, corsProxyKey, offering, ttsMeta };
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
