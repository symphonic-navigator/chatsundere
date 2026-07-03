// SPDX-License-Identifier: LGPL-3.0-only
import { fetchWithProxyAuth } from '../proxy-fetch.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';
import { SpeechSynthesisError } from './synthesise-speech.js';

const PAGE_LIMIT = 100;

/** A single voice entry returned by the provider's voice catalogue. */
export interface TtsVoice {
  id: string;
  name: string;
}

/** All inputs needed to fetch the provider's voice catalogue. */
export interface ListTtsVoicesArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  /** Wire shape of the voice catalogue; mirrors `TtsVoiceSource`'s fetch endpoint. */
  endpoint: 'mistral-paginated' | 'xai-flat';
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Fetch all available TTS voices from the provider: `mistral-paginated` pages
 * through `/audio/voices`, `xai-flat` reads `/tts/voices` in one shot.
 */
export async function listTtsVoices(args: ListTtsVoicesArgs): Promise<TtsVoice[]> {
  const fetchFn = args.fetchFn ?? fetch;

  if (args.endpoint === 'xai-flat') {
    // xAI returns the whole catalogue in one unpaginated response (probed
    // 2026-06-12) with `voice_id` rather than `id`.
    const proxied = args.providerConfig.routing.kind === 'cors-proxy';
    const response = await fetchWithProxyAuth(
      () =>
        buildRequest({
          provider: args.providerConfig,
          apiKey: args.apiKey,
          path: '/tts/voices',
          method: 'GET',
        }),
      { proxied, signal: args.signal, doFetch: fetchFn },
    );
    if (!response.ok) {
      throw new SpeechSynthesisError(`voices upstream ${response.status}`, response.status);
    }
    const payload = (await response.json()) as { voices?: unknown };
    if (!Array.isArray(payload.voices)) {
      throw new SpeechSynthesisError('voices response missing voices array', null);
    }
    const voices: TtsVoice[] = [];
    for (const item of payload.voices) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { voice_id?: unknown }).voice_id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string'
      ) {
        voices.push({
          id: (item as { voice_id: string }).voice_id,
          name: (item as { name: string }).name,
        });
      }
    }
    return voices;
  }

  const voices: TtsVoice[] = [];
  let page = 1;
  let totalPages = 1;
  let offset = 0;

  do {
    const proxied = args.providerConfig.routing.kind === 'cors-proxy';
    const response = await fetchWithProxyAuth(
      () =>
        buildRequest({
          provider: args.providerConfig,
          apiKey: args.apiKey,
          path: `/audio/voices?limit=${PAGE_LIMIT}&offset=${offset}`,
          method: 'GET',
        }),
      { proxied, signal: args.signal, doFetch: fetchFn },
    );
    if (!response.ok) {
      throw new SpeechSynthesisError(`voices upstream ${response.status}`, response.status);
    }
    const payload = (await response.json()) as {
      items?: unknown;
      page?: unknown;
      total_pages?: unknown;
    };
    if (!Array.isArray(payload.items)) {
      throw new SpeechSynthesisError('voices response missing items array', null);
    }
    for (const item of payload.items) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string'
      ) {
        voices.push({
          id: (item as { id: string }).id,
          name: (item as { name: string }).name,
        });
      }
    }
    if (typeof payload.page === 'number') page = payload.page;
    if (typeof payload.total_pages === 'number') totalPages = payload.total_pages;
    offset += PAGE_LIMIT;
  } while (page < totalPages);

  return voices;
}
