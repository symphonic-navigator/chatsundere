// SPDX-License-Identifier: AGPL-3.0-only

/** The minimal Redis surface the limiter needs (satisfied by ioredis). */
export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Fixed-window rate limiter over Redis. Returns true when the call is allowed.
 * Fails CLOSED: any Redis error denies the request rather than becoming an
 * unlimited store (spec §10.1). Callers pass distinct key namespaces
 * (`user:<sub>`, `ip:<ip>`, `del:<sub>`) so the windows are independent.
 */
export function createLimiter(redis: RedisLike) {
  return async (key: string, limit: number, windowSec: number): Promise<boolean> => {
    try {
      const bucket = `sync:rl:${key}`;
      const n = await redis.incr(bucket);
      if (n === 1) await redis.expire(bucket, windowSec);
      return n <= limit;
    } catch {
      return false;
    }
  };
}
