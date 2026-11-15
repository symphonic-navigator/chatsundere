// SPDX-License-Identifier: AGPL-3.0-only

import { type TtsVoiceList, listTtsVoices } from '@chatsundere/llm-unified';
import type { TtsTransport } from './resolve-tts.js';

// Module-level memo keyed by voiceListKey: one fetch per voice source per
// session, shared by every picker instance and the synthesis guard.
const memo = new Map<string, Promise<TtsVoiceList>>();

/** Reset the memo. Exposed for tests only. */
export function _resetVoiceListForTests(): void {
  memo.clear();
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/**
 * A short fingerprint of the API key, so the memo never outlives a key change
 * or an account switch. FNV-1a 64 over the UTF-8 bytes, as 16 hex characters:
 * synchronous (the memo key is computed on a sync path, which rules out
 * WebCrypto's SHA-256) and lossy, so the raw key is never stored. It is not a
 * cryptographic commitment; it lives only in this in-memory map.
 */
function keyFingerprint(apiKey: string): string {
  let hash = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(apiKey)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Memo key for a transport's voice source. Static lists are per upstream
 * model; fetched lists are per provider endpoint and API key fingerprint, so
 * every model of one provider (e.g. v4 and v4 Turbo) shares a single list while
 * a different key (another account) fetches its own.
 */
export function voiceListKey(t: TtsTransport): string {
  const { providerId, upstreamSlug } = t.offering;
  const { voices } = t.ttsMeta;
  return voices.kind === 'static'
    ? `${providerId}:static:${upstreamSlug}`
    : `${providerId}:${voices.endpoint}:${keyFingerprint(t.apiKey)}`;
}

/**
 * Load a transport's voice list, reusing the memoised promise. `fresh` drops
 * the memo for this source first, forcing a refetch. The synthesis guard calls
 * this with the transport it already resolved; loadVoiceList (in
 * voice-list-active.ts) resolves the active one first.
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
