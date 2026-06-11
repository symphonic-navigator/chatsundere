// SPDX-License-Identifier: LGPL-3.0-only
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
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** Fetch all available TTS voices from the provider, paging through the full catalogue. */
export async function listTtsVoices(args: ListTtsVoicesArgs): Promise<TtsVoice[]> {
  const fetchFn = args.fetchFn ?? fetch;
  const voices: TtsVoice[] = [];
  let page = 1;
  let totalPages = 1;
  let offset = 0;

  do {
    const request = buildRequest({
      provider: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      path: `/audio/voices?limit=${PAGE_LIMIT}&offset=${offset}`,
      method: 'GET',
    });
    const response = await fetchFn(request, { signal: args.signal });
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
