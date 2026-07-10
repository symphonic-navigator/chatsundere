// SPDX-License-Identifier: AGPL-3.0-only

import { createRedis } from '../redis/client.js';

const TTL_SECONDS = 60;

/**
 * Stores a recovery nonce in Redis for the given username.
 * The nonce is consumed on first use; a second call to consumeNonce will return false.
 */
export async function storeNonce(username: string, nonce: Uint8Array): Promise<void> {
  const redis = createRedis();
  await redis.set(
    `recovery:nonce:${username}`,
    Buffer.from(nonce).toString('base64url'),
    'EX',
    TTL_SECONDS,
  );
}

/**
 * Fetches and atomically deletes the stored nonce for the given username via
 * GETDEL — a single round-trip, so two concurrent consumers cannot both pass
 * the existence check before the delete lands — then compares it to the
 * presented nonce. Returns true only if a nonce existed and matched.
 */
export async function consumeNonce(username: string, nonce: Uint8Array): Promise<boolean> {
  const redis = createRedis();
  // GETDEL deletes unconditionally on any existing key — even on a mismatch
  // below — which is what prevents replay of a stale nonce.
  const stored = await redis.getdel(`recovery:nonce:${username}`);
  if (!stored) return false;
  const presentedB64 = Buffer.from(nonce).toString('base64url');
  return stored === presentedB64;
}
