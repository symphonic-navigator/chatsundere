// SPDX-License-Identifier: AGPL-3.0-only

import { type TtsVoiceList, listTtsVoices } from '@chatsundere/llm-unified';
import { type TtsTransport, resolveTtsTransport } from './resolve-tts.js';

// Module-level memo keyed by voiceListKey: one fetch per voice source per
// session, shared by every picker instance and the synthesis guard.
const memo = new Map<string, Promise<TtsVoiceList>>();

/** Reset the memo. Exposed for tests only. */
export function _resetVoiceListForTests(): void {
  memo.clear();
}

/**
 * Memo key for a transport's voice source. Static lists are per upstream
 * model; fetched lists are per provider endpoint, so every model of one
 * provider (e.g. v4 and v4 Turbo) shares a single list.
 */
export function voiceListKey(t: TtsTransport): string {
  const { providerId, upstreamSlug } = t.offering;
  const { voices } = t.ttsMeta;
  return voices.kind === 'static'
    ? `${providerId}:static:${upstreamSlug}`
    : `${providerId}:${voices.endpoint}`;
}

/**
 * Load the active TTS offering's voice list, reusing the memoised promise.
 * Resolves null when no TTS transport is configured. `fresh` drops the memo
 * for this source first, forcing a refetch (the picker does this on open).
 */
export async function loadVoiceList(
  opts: { fresh?: boolean } = {},
): Promise<{ key: string; list: TtsVoiceList } | null> {
  const transport = await resolveTtsTransport();
  if (!transport) return null;
  return loadVoiceListFor(transport, opts);
}

/**
 * As loadVoiceList, for a transport the caller already resolved (the
 * synthesis guard), so the provider key is not decrypted twice.
 */
export async function loadVoiceListFor(
  transport: TtsTransport,
  opts: { fresh?: boolean } = {},
): Promise<{ key: string; list: TtsVoiceList }> {
  const key = voiceListKey(transport);
  const { voices } = transport.ttsMeta;
  // Some providers expose no voice-list endpoint; their offering carries the list.
  if (voices.kind === 'static') {
    return { key, list: { voices: [...voices.list], hiddenCount: 0 } };
  }
  if (opts.fresh) memo.delete(key);
  let promise = memo.get(key);
  if (!promise) {
    promise = listTtsVoices({
      providerConfig: transport.providerConfig,
      apiKey: transport.apiKey,
      endpoint: voices.endpoint,
      signal: AbortSignal.timeout(15_000),
    });
    memo.set(key, promise);
    // On failure, clear the memo so the next call can retry, but only if this
    // promise still owns the slot; a stale rejection arriving after a retry has
    // replaced it must not evict the newer in-flight promise.
    const owned = promise;
    owned.catch(() => {
      if (memo.get(key) === owned) memo.delete(key);
    });
  }
  return { key, list: await promise };
}
