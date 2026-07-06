// SPDX-License-Identifier: AGPL-3.0-only

/** The minimal Redis surface the limiter needs (satisfied by ioredis). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

// Increment the bucket and, only on the first hit of a fresh window, attach the
// TTL — atomically, so a crash or network fault between the two commands can
// never leave the bucket without an expiry (an "immortal" counter that would
// permanently rate-limit the key). Returns the post-increment count.
//
// This is a fixed server-side Redis Lua script — a compile-time constant with
// no interpolation and no caller input in its body (the key and window arrive
// as KEYS[1]/ARGV[1]), so it carries no code-injection surface.
const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/**
 * Fixed-window rate limiter over Redis. Returns true when the call is allowed.
 * Fails CLOSED: any Redis error denies the request rather than becoming an
 * unlimited authenticated relay (spec §5.4).
 */
export function createLimiter(redis: RedisLike) {
  return async (key: string, limit: number, windowSec: number): Promise<boolean> => {
    try {
      const bucket = `ratelimit:${key}`;
      const n = (await redis.eval(INCR_WITH_TTL, 1, bucket, windowSec)) as number;
      return n <= limit;
    } catch {
      return false;
    }
  };
}
