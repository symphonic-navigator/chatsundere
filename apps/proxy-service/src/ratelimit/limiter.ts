// SPDX-License-Identifier: AGPL-3.0-only

/** The minimal Redis surface the limiter needs (satisfied by ioredis). */
export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Fixed-window rate limiter over Redis. Returns true when the call is allowed.
 * Fails CLOSED: any Redis error denies the request rather than becoming an
 * unlimited authenticated relay (spec §5.4).
 */
export function createLimiter(redis: RedisLike) {
  return async (key: string, limit: number, windowSec: number): Promise<boolean> => {
    try {
      const bucket = `ratelimit:${key}`;
      const n = await redis.incr(bucket);
      if (n === 1) await redis.expire(bucket, windowSec);
      return n <= limit;
    } catch {
      return false;
    }
  };
}
