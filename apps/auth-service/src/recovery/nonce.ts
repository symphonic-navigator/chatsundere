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
 * Atomically fetches and deletes the stored nonce for the given username, then compares
 * it to the presented nonce. Returns true only if a nonce existed and matched.
 */
export async function consumeNonce(username: string, nonce: Uint8Array): Promise<boolean> {
  const redis = createRedis();
  const stored = await redis.get(`recovery:nonce:${username}`);
  // Delete unconditionally — even on mismatch, prevent replay.
  await redis.del(`recovery:nonce:${username}`);
  if (!stored) return false;
  const presentedB64 = Buffer.from(nonce).toString('base64url');
  return stored === presentedB64;
}
