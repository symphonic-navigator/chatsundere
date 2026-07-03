// SPDX-License-Identifier: LGPL-3.0-only
import type { SttTransportKind } from '../catalogue/types.js';
import { fetchWithProxyAuth } from '../proxy-fetch.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

const POST_TIMEOUT_MS = 30_000;

/** Typed failure for STT calls (HTTP error, malformed body). */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** All inputs needed to transcribe one captured utterance. */
export interface TranscribeAudioArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  upstreamSlug: string;
  /** Wire shape of the transcription request (path, multipart fields). */
  transport: SttTransportKind;
  /** Declare webm uploads as Matroska — see the comment at the spoof site. */
  spoofWebmAsMatroska?: boolean;
  blob: Blob;
  mimeType: string;
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface TranscribeAudioResult {
  text: string;
}

/**
 * Keep aligned with the recording tiers in the user-client: the upstream uses
 * the filename extension as a format hint when Content-Type is generic.
 */
function filenameForMime(mimeType: string): string {
  if (mimeType.startsWith('audio/webm')) return 'recording.webm';
  if (mimeType.startsWith('audio/mp4')) return 'recording.m4a';
  return 'recording.wav';
}

/** Transcribe one captured utterance; returns the trimmed transcript text. */
export async function transcribeAudio(args: TranscribeAudioArgs): Promise<TranscribeAudioResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;
  // nano-gpt's whitelist 400s on audio/webm but accepts the identical bytes as
  // Matroska — webm is a restricted MKV profile (chatsune INS-054, re-proven
  // live 2026-06-12). Bytes are untouched; only the declared type and the
  // extension hint change.
  const spoof = args.spoofWebmAsMatroska === true && args.mimeType.startsWith('audio/webm');
  const fileType = spoof ? 'audio/x-matroska' : args.mimeType;
  const filename = spoof ? 'recording.mkv' : filenameForMime(args.mimeType);
  const form = new FormData();
  form.append('file', new File([args.blob], filename, { type: fileType }));
  // Both transport checks key on the same literal so a future third transport
  // coherently inherits the openai-style defaults (model field + path).
  // xAI's /stt endpoint takes no model field; the slug is internal-only there.
  if (args.transport !== 'xai-native') form.append('model', args.upstreamSlug);
  // `language` deliberately omitted on both transports — auto-detect.
  const proxied = args.providerConfig.routing.kind === 'cors-proxy';
  const response = await fetchWithProxyAuth(
    () =>
      buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        path: args.transport === 'xai-native' ? '/stt' : '/audio/transcriptions',
        method: 'POST',
        body: form,
      }),
    { proxied, signal, doFetch: fetchFn },
  );
  if (!response.ok) {
    throw new TranscriptionError(`STT upstream ${response.status}`, response.status);
  }
  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload.text !== 'string') {
    throw new TranscriptionError('STT response missing text', null);
  }
  return { text: payload.text.trim() };
}
