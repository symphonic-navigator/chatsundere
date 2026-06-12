// SPDX-License-Identifier: AGPL-3.0-only

import {
  TranscriptionError,
  getProvider,
  listSttOfferings,
  transcribeAudio,
} from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { openSecret } from '../../secrets.js';

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
  const offering = listSttOfferings()[0];
  const sttMeta = offering?.stt;
  if (!offering || !sttMeta) return { ok: false, reason: 'no-provider' };

  const providerDef = getProvider(offering.providerId);
  if (!providerDef) return { ok: false, reason: 'no-provider' };

  const db = getClientDataDb();
  const providerRow = (
    await db.providers.where('templateId').equals(offering.providerId).toArray()
  ).find((p) => p.enabled);
  if (!providerRow) return { ok: false, reason: 'no-provider' };

  const mk = useSessionStore.getState().mk;
  if (!mk) {
    console.warn('resolveStt: no master key in session — falling back to no-provider');
    return { ok: false, reason: 'no-provider' };
  }
  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn('resolveStt: failed to decrypt api-key — falling back to no-provider');
    return { ok: false, reason: 'no-provider' };
  }

  const settings = await db.settings.get(1);
  const corsProxyUrl = settings?.corsProxy?.url ?? null;
  let corsProxyKey: string | null = null;
  if (settings?.corsProxy) {
    try {
      corsProxyKey = await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key');
    } catch {
      console.warn('resolveStt: failed to decrypt cors-proxy key — falling back to no-provider');
      return { ok: false, reason: 'no-provider' };
    }
  }

  const providerConfig = {
    baseUrl: providerDef.baseUrl,
    routing:
      providerDef.corsHint === 'requires-proxy'
        ? ({ kind: 'cors-proxy' } as const)
        : ({ kind: 'direct' } as const),
  };
  const { upstreamSlug } = offering;
  const providerDisplayName = providerDef.displayName;

  const transcribe = async (blob: Blob, mimeType: string, signal: AbortSignal): Promise<string> => {
    try {
      const result = await transcribeAudio({
        providerConfig,
        apiKey,
        corsProxyUrl,
        corsProxyKey,
        upstreamSlug,
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
