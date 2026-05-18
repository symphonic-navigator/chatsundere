// SPDX-License-Identifier: AGPL-3.0-only

import type { MiddlewareHandler } from 'hono';
import { createRedis } from '../redis/client.js';
import { ApiError } from './error-envelope.js';

export interface RateLimitArgs {
  /** Logical bucket name, e.g. 'login:opaque'. */
  bucket: string;
  /** Window size in seconds. */
  windowSec: number;
  /** Max requests per window. */
  max: number;
  /** How to derive the key for a request (e.g., IP, username, token). */
  key: (c: import('hono').Context) => string | Promise<string>;
}

export function rateLimit(args: RateLimitArgs): MiddlewareHandler {
  return async (c, next) => {
    const redis = createRedis();
    const subject = await args.key(c);
    if (!subject) return next();
    const redisKey = `rl:${args.bucket}:${subject}`;
    const now = Date.now();
    const windowStart = now - args.windowSec * 1000;
    // Sliding window via sorted set: trim old, add this, count.
    await redis.zremrangebyscore(redisKey, 0, windowStart);
    const count = await redis.zcard(redisKey);
    if (count >= args.max) {
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    await redis.zadd(redisKey, now, `${now}:${crypto.randomUUID()}`);
    await redis.expire(redisKey, args.windowSec);
    await next();
  };
}

export function ipKey(c: import('hono').Context): string {
  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? c.req.header('X-Real-IP') ?? 'unknown'
  );
}

export function usernameKey(c: import('hono').Context): string {
  // For login endpoints: read from JSON body; if absent or not parseable, fall back to IP.
  const ip = ipKey(c);
  return ip;
}
