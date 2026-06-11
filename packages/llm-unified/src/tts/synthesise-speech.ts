// SPDX-License-Identifier: LGPL-3.0-only
import { b64ToBlob } from '../b64.js';
import { stripTeal } from '../teal/teal.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

const POST_TIMEOUT_MS = 120_000;

/** Typed failure for TTS calls (HTTP error, malformed body). */
export class SpeechSynthesisError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'SpeechSynthesisError';
  }
}

/** All inputs needed to synthesise one speech segment. */
export interface SynthesiseSpeechArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  upstreamSlug: string;
  teal: 'strip' | 'passthrough';
  text: string;
  voiceId: string;
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** The synthesised audio returned by a successful TTS call. */
export interface SynthesiseSpeechResult {
  blob: Blob;
  mimeType: string;
}

/** Synthesise one speech segment; returns the provider's encoded audio blob (never PCM). */
export async function synthesiseSpeech(
  args: SynthesiseSpeechArgs,
): Promise<SynthesiseSpeechResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const input = args.teal === 'strip' ? stripTeal(args.text) : args.text;
  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/audio/speech',
    method: 'POST',
    body: { model: args.upstreamSlug, input, voice_id: args.voiceId, stream: false },
  });
  const response = await fetchFn(request, { signal });
  if (!response.ok) {
    throw new SpeechSynthesisError(`TTS upstream ${response.status}`, response.status);
  }
  const payload = (await response.json()) as { audio_data?: unknown };
  if (typeof payload.audio_data !== 'string') {
    throw new SpeechSynthesisError('TTS response missing audio_data', null);
  }
  return { blob: b64ToBlob(payload.audio_data, 'audio/mpeg'), mimeType: 'audio/mpeg' };
}
