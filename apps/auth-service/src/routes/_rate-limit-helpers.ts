// SPDX-License-Identifier: AGPL-3.0-only

import { ApiError } from '../middleware/error-envelope.js';
import { createRedis } from '../redis/client.js';

const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 10;

/**
 * Applies a per-username sliding-window rate limit.
 *
 * Normalises the username to lowercase before building the Redis key so that
 * `Alice` and `alice` share the same counter (the DB uses citext for usernames).
 *
 * Used by both /api/v1/opaque/login/start, /api/v1/passkey/login/start, and
 * /api/v1/recovery/start to maintain consistent 10 attempts / 15 min throttling
 * per spec §8.4.
 */
export async function applyLoginRateLimit(username: string): Promise<void> {
  const redis = createRedis();
  const now = Date.now();
  const windowStart = now - LOGIN_WINDOW_SEC * 1000;
  // Normalise to lowercase so casing variants do not bypass the limit.
  const redisKey = `rl:login:username:${username.toLowerCase()}`;
  await redis.zremrangebyscore(redisKey, 0, windowStart);
  const count = await redis.zcard(redisKey);
  if (count >= LOGIN_MAX_ATTEMPTS) {
    throw new ApiError(429, 'rate_limited', 'Too many login attempts for this username');
  }
  await redis.zadd(redisKey, now, `${now}:${crypto.randomUUID()}`);
  await redis.expire(redisKey, LOGIN_WINDOW_SEC);
}
