// SPDX-License-Identifier: AGPL-3.0-only

import { TranscriptionError, getProvider, transcribeAudio } from '@chatsundere/llm-unified';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { selectSttOffering } from '../select-offering.js';
import { resolveVoiceTransportMaterial } from '../voice-transport.js';

export type SttResolution =
  | {
      ok: true;
      /** Transcribe one captured utterance; throws TranscriptionError on failure. */
      transcribe: (blob: Blob, mimeType: string, signal: AbortSignal) => Promise<string>;
      /** For UI labels, e.g. 'Voxtral Mini STT via Mistral AI'. */
      sttLabel: string;
    }
  | { ok: false; reason: 'no-provider' };

/**
 * Resolve the transcription pipeline, or the constructive reason why it cannot
 * run. Mirrors resolveTts: mk / apiKey / proxy material resolved once, captured
 * by the returned closure. UI-free: no React imports.
 */
export async function resolveStt(): Promise<SttResolution> {
  const db = getClientDataDb();
  const providerRows = await db.providers.toArray();
  const settings = await db.settings.get(1);

  // The offering comes from the slot selector: the persisted explicit pick
  // when one exists, the curated auto-default order otherwise.
  const selected = selectSttOffering(settings?.sttOffering ?? null, providerRows);
  if (!selected) return { ok: false, reason: 'no-provider' };
  const { offering } = selected;

  const sttMeta = offering.stt;
  if (!sttMeta) return { ok: false, reason: 'no-provider' };

  const material = await resolveVoiceTransportMaterial(
    selected,
    providerRows,
    settings,
    'resolveStt',
  );
  if (!material) return { ok: false, reason: 'no-provider' };
  const { providerConfig, apiKey, corsProxyUrl, corsProxyKey } = material;

  const { upstreamSlug } = offering;
  // The helper already verified the provider definition exists.
  const providerDisplayName = getProvider(offering.providerId)?.displayName ?? offering.providerId;

  const transcribe = async (blob: Blob, mimeType: string, signal: AbortSignal): Promise<string> => {
    try {
      const result = await transcribeAudio({
        providerConfig,
        apiKey,
        corsProxyUrl,
        corsProxyKey,
        upstreamSlug,
        transport: sttMeta.transport,
        spoofWebmAsMatroska: sttMeta.spoofWebmAsMatroska,
        blob,
        mimeType,
        signal,
      });
      return result.text;
    } catch (err) {
      // Provider-boundary logging (the TTS hardening lesson): surface the real
      // cause instead of an opaque UI state; error handling is unchanged.
      const status = err instanceof TranscriptionError ? err.status : null;
      console.error('[voice-stt] transcription failed', { status, bytes: blob.size, mimeType });
      throw err;
    }
  };

  return { ok: true, transcribe, sttLabel: `${sttMeta.displayName} via ${providerDisplayName}` };
}
