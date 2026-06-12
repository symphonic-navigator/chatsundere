// SPDX-License-Identifier: LGPL-3.0-only
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
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  upstreamSlug: string;
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
  const form = new FormData();
  form.append(
    'file',
    new File([args.blob], filenameForMime(args.mimeType), { type: args.mimeType }),
  );
  form.append('model', args.upstreamSlug);
  // `language` deliberately omitted — Voxtral auto-detects (spec D8).
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/audio/transcriptions',
    method: 'POST',
    body: form,
  });
  const response = await fetchFn(request, { signal });
  if (!response.ok) {
    throw new TranscriptionError(`STT upstream ${response.status}`, response.status);
  }
  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload.text !== 'string') {
    throw new TranscriptionError('STT response missing text', null);
  }
  return { text: payload.text.trim() };
}
