// SPDX-License-Identifier: LGPL-3.0-only
import { b64ToBlob } from '../b64.js';
import type { TtsTransportKind } from '../catalogue/types.js';
import { fetchWithProxyAuth } from '../proxy-fetch.js';
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

/** Maps an offering's TEAL level to the numeric ceiling `stripTeal` takes. */
const TEAL_LEVEL = { none: 0, v1: 1, v2: 2 } as const;

/** All inputs needed to synthesise one speech segment. */
export interface SynthesiseSpeechArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  upstreamSlug: string;
  /** The offering's TEAL level; tags above it are stripped before synthesis. */
  teal: 'none' | 'v1' | 'v2';
  /** Wire shape of the synthesis request (path, body, response encoding). */
  transport: TtsTransportKind;
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

interface TtsWire {
  path: string;
  body: Record<string, unknown>;
  /** How the upstream encodes the audio in a 2xx response. */
  decode: 'base64-json' | 'raw-audio';
}

/**
 * The ElevenLabs voice id becomes a path segment. Percent-encoding alone does
 * not stop a dot segment (`.`/`..`) from being normalised by URL parsing, so
 * anything that could leave the `/text-to-speech/` segment is refused outright.
 */
function assertPathSafeVoiceId(voiceId: string): void {
  if (voiceId === '' || voiceId === '.' || voiceId === '..' || /[/\\?#]/.test(voiceId)) {
    throw new SpeechSynthesisError('invalid voice id', null);
  }
}

/**
 * One exhaustive dispatch per transport: the explicit return type makes a new
 * `TtsTransportKind` member a compile error here instead of silently
 * inheriting another transport's wire shape.
 */
function wireFor(args: SynthesiseSpeechArgs, input: string): TtsWire {
  switch (args.transport) {
    case 'mistral-speech':
      return {
        path: '/audio/speech',
        body: { model: args.upstreamSlug, input, voice_id: args.voiceId, stream: false },
        decode: 'base64-json',
      };
    case 'xai-native':
      return {
        path: '/tts',
        body: { text: input, voice_id: args.voiceId, language: 'auto' },
        decode: 'raw-audio',
      };
    case 'openai-speech':
      return {
        path: '/audio/speech',
        body: { model: args.upstreamSlug, input, voice: args.voiceId },
        decode: 'raw-audio',
      };
    case 'elevenlabs':
      assertPathSafeVoiceId(args.voiceId);
      return {
        // The voice id is user-visible data from the upstream catalogue; encode it.
        path: `/text-to-speech/${encodeURIComponent(args.voiceId)}?output_format=mp3_44100_128`,
        body: { text: input, model_id: args.upstreamSlug },
        decode: 'raw-audio',
      };
  }
}

/**
 * Synthesise one speech segment; returns the provider's encoded audio blob (never PCM).
 * The request path, body shape, and response encoding branch on `transport`:
 * Mistral speaks base64 JSON, the raw-audio transports return encoded bytes.
 */
export async function synthesiseSpeech(
  args: SynthesiseSpeechArgs,
): Promise<SynthesiseSpeechResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const input = stripTeal(args.text, TEAL_LEVEL[args.teal]);
  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;
  const wire = wireFor(args, input);
  const proxied = args.providerConfig.routing.kind === 'cors-proxy';
  const response = await fetchWithProxyAuth(
    () =>
      buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        path: wire.path,
        method: 'POST',
        body: wire.body,
      }),
    { proxied, signal, doFetch: fetchFn },
  );
  if (!response.ok) {
    throw new SpeechSynthesisError(`TTS upstream ${response.status}`, response.status);
  }
  if (wire.decode === 'raw-audio') {
    const blob = await response.blob();
    const contentType = response.headers.get('content-type');
    const mimeType = (contentType ? contentType.split(';')[0] : null) ?? 'audio/mpeg';
    // A 2xx with a non-audio body (e.g. an HTML error page) must not reach the
    // client-side voice cache, where it would poison playback permanently.
    // All probed providers send audio/*; a future provider serving audio as
    // application/octet-stream would need an explicit allowance here.
    if (!mimeType.startsWith('audio/')) {
      throw new SpeechSynthesisError('TTS response is not audio', null);
    }
    return { blob, mimeType };
  }
  const payload = (await response.json()) as { audio_data?: unknown };
  if (typeof payload.audio_data !== 'string') {
    throw new SpeechSynthesisError('TTS response missing audio_data', null);
  }
  return { blob: b64ToBlob(payload.audio_data, 'audio/mpeg'), mimeType: 'audio/mpeg' };
}
