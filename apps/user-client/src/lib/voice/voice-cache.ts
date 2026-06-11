// SPDX-License-Identifier: AGPL-3.0-only

import { type VoiceAudioRow, getClientDataDb } from '../../boot/client-data-db.js';

const DEFAULT_OPTS = { maxBytes: 64 * 1024 * 1024 }; // device-tunable
let opts = DEFAULT_OPTS;

/** Test seam: override (or reset, when called without arguments) the cache budget and
 *  monotonic counter so successive test cases start from a clean timestamp baseline. */
export function _voiceCacheOptsForTests(next?: { maxBytes: number }): void {
  opts = next ?? DEFAULT_OPTS;
  lastTs = 0;
}

/** djb2 over the canonical inputs — deterministic, sync, collision-safe at cache scale. */
export function voiceCacheKey(
  spokenText: string,
  providerId: string,
  modelSlug: string,
  voiceId: string,
): string {
  const input = `${providerId} ${modelSlug} ${voiceId} ${spokenText}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}:${input.length}`;
}

// Monotonic timestamp so same-millisecond operations preserve insertion order.
let lastTs = 0;
function touch(): number {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return lastTs;
}

/** Retrieve a cached audio entry by key and update its lastUsedAt timestamp. */
export async function cacheGet(key: string): Promise<VoiceAudioRow | undefined> {
  const db = getClientDataDb();
  const row = await db.voiceAudio.get(key);
  if (!row) return undefined;
  const ts = touch();
  await db.voiceAudio.update(key, { lastUsedAt: ts });
  return { ...row, lastUsedAt: ts };
}

/** Store an audio blob and evict least-recently-used entries when over budget.
 *  The just-written entry is never evicted, even if it alone exceeds the budget. */
export async function cachePut(entry: {
  key: string;
  blob: Blob;
  mimeType: string;
}): Promise<void> {
  const db = getClientDataDb();
  const ts = touch();
  await db.voiceAudio.put({
    key: entry.key,
    blob: entry.blob,
    mimeType: entry.mimeType,
    bytes: entry.blob.size,
    lastUsedAt: ts,
  });

  // Evict LRU entries until total bytes fits within the budget, but never
  // evict the entry we just wrote.
  const all = await db.voiceAudio.orderBy('lastUsedAt').toArray();
  let total = all.reduce((sum, r) => sum + r.bytes, 0);
  for (const row of all) {
    if (total <= opts.maxBytes) break;
    if (row.key === entry.key) continue; // never evict the just-written entry
    await db.voiceAudio.delete(row.key);
    total -= row.bytes;
  }
}

/** Remove a cached audio entry by key. */
export async function cacheDelete(key: string): Promise<void> {
  await getClientDataDb().voiceAudio.delete(key);
}
