// SPDX-License-Identifier: LGPL-3.0-only
import { fetchWithProxyAuth } from '../proxy-fetch.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';
import { isJuvenileVoice } from './juvenile-filter.js';
import { SpeechSynthesisError } from './synthesise-speech.js';

const PAGE_LIMIT = 100;

/** A single voice entry returned by the provider's voice catalogue. */
export interface TtsVoice {
  id: string;
  name: string;
  /** 'own' for cloned/professional/generated voices, 'predefined' for premade ones. */
  origin?: 'own' | 'predefined';
  gender?: 'female' | 'male' | 'neutral';
  /** ISO 639-1 code. */
  language?: string;
  description?: string;
}

/** The voices to offer, plus how many the juvenile filter dropped. */
export interface TtsVoiceList {
  voices: TtsVoice[];
  hiddenCount: number;
}

/** All inputs needed to fetch the provider's voice catalogue. */
export interface ListTtsVoicesArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  /** Wire shape of the voice catalogue; mirrors `TtsVoiceSource`'s fetch endpoint. */
  endpoint: 'mistral-paginated' | 'xai-flat' | 'elevenlabs-v2';
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Fetch all available TTS voices from the provider: `mistral-paginated` pages
 * through `/audio/voices`, `xai-flat` reads `/tts/voices` in one shot, and
 * `elevenlabs-v2` pages through the account's `/v2/voices` with metadata.
 * Every source applies the juvenile filter (ADR 0040): matching voices are
 * dropped and counted in `hiddenCount`.
 */
export async function listTtsVoices(args: ListTtsVoicesArgs): Promise<TtsVoiceList> {
  const fetchFn = args.fetchFn ?? fetch;

  if (args.endpoint === 'elevenlabs-v2') {
    return listElevenLabsVoices(args, fetchFn);
  }

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
    let hiddenCount = 0;
    for (const item of payload.voices) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { voice_id?: unknown }).voice_id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string'
      ) {
        const voice: TtsVoice = {
          id: (item as { voice_id: string }).voice_id,
          name: (item as { name: string }).name,
        };
        if (isJuvenileVoice(voice)) hiddenCount += 1;
        else voices.push(voice);
      }
    }
    return { voices, hiddenCount };
  }

  const voices: TtsVoice[] = [];
  let hiddenCount = 0;
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
        const voice: TtsVoice = {
          id: (item as { id: string }).id,
          name: (item as { name: string }).name,
        };
        if (isJuvenileVoice(voice)) hiddenCount += 1;
        else voices.push(voice);
      }
    }
    if (typeof payload.page === 'number') page = payload.page;
    if (typeof payload.total_pages === 'number') totalPages = payload.total_pages;
    offset += PAGE_LIMIT;
  } while (page < totalPages);

  return { voices, hiddenCount };
}

const MAX_ELEVENLABS_PAGES = 50;

const GENDERS = ['female', 'male', 'neutral'] as const;

/** Pages through the account's ElevenLabs voices, mapping metadata and dropping juveniles. */
async function listElevenLabsVoices(
  args: ListTtsVoicesArgs,
  fetchFn: typeof fetch,
): Promise<TtsVoiceList> {
  const proxied = args.providerConfig.routing.kind === 'cors-proxy';
  const voices: TtsVoice[] = [];
  let hiddenCount = 0;
  let pageToken: string | null = null;
  const seenTokens = new Set<string>();
  let pages = 0;

  do {
    // baseUrl ends in /v1; the dot segment is normalised by URL parsing to /v2/voices.
    let path = `../v2/voices?page_size=${PAGE_LIMIT}`;
    if (pageToken !== null) path += `&next_page_token=${encodeURIComponent(pageToken)}`;
    pages += 1;
    const response = await fetchWithProxyAuth(
      () =>
        buildRequest({
          provider: args.providerConfig,
          apiKey: args.apiKey,
          path,
          method: 'GET',
        }),
      { proxied, signal: args.signal, doFetch: fetchFn },
    );
    if (!response.ok) {
      throw new SpeechSynthesisError(`voices upstream ${response.status}`, response.status);
    }
    const payload = (await response.json()) as {
      voices?: unknown;
      has_more?: unknown;
      next_page_token?: unknown;
    };
    if (!Array.isArray(payload.voices)) {
      throw new SpeechSynthesisError('voices response missing voices array', null);
    }
    for (const item of payload.voices) {
      if (typeof item !== 'object' || item === null) continue;
      const raw = item as {
        voice_id?: unknown;
        name?: unknown;
        category?: unknown;
        description?: unknown;
        labels?: { gender?: unknown; language?: unknown; descriptive?: unknown } | null;
      };
      if (typeof raw.voice_id !== 'string' || typeof raw.name !== 'string') continue;
      const voice: TtsVoice = {
        id: raw.voice_id,
        name: raw.name,
        origin: raw.category === 'premade' ? 'predefined' : 'own',
      };
      const gender = raw.labels?.gender;
      if (typeof gender === 'string' && (GENDERS as readonly string[]).includes(gender)) {
        voice.gender = gender as (typeof GENDERS)[number];
      }
      if (typeof raw.labels?.language === 'string') voice.language = raw.labels.language;
      if (typeof raw.description === 'string' && raw.description !== '') {
        voice.description = raw.description;
      }
      const descriptive =
        typeof raw.labels?.descriptive === 'string' ? raw.labels.descriptive : undefined;
      if (isJuvenileVoice({ ...voice, descriptive })) {
        hiddenCount += 1;
      } else {
        voices.push(voice);
      }
    }
    const next =
      payload.has_more === true && typeof payload.next_page_token === 'string'
        ? payload.next_page_token
        : null;
    // Stop on a repeated token or after the page cap rather than loop forever.
    pageToken =
      next !== null && !seenTokens.has(next) && pages < MAX_ELEVENLABS_PAGES ? next : null;
    if (next !== null) seenTokens.add(next);
  } while (pageToken !== null);

  return { voices, hiddenCount };
}
