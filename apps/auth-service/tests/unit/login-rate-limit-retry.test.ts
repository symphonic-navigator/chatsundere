// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { ApiError } from '../../src/middleware/error-envelope.js';
import { closeRedis, createRedis } from '../../src/redis/client.js';
import { applyLoginRateLimit } from '../../src/routes/_rate-limit-helpers.js';

const USERNAME = 'ratewait_user';

beforeEach(async () => {
  const redis = createRedis();
  const keys = await redis.keys('rl:login:*ratewait_user*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await closeRedis();
});

describe('applyLoginRateLimit — retry-after', () => {
  it('throws a 429 carrying a concrete retryAfterSeconds once the window is full', async () => {
    // 10 attempts per 15 min per username: the first ten pass, the 11th trips.
    for (let i = 0; i < 10; i++) {
      await applyLoginRateLimit(USERNAME);
    }

    let thrown: unknown;
    try {
      await applyLoginRateLimit(USERNAME);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    const retry = err.metadata?.retryAfterSeconds as number | undefined;
    expect(typeof retry).toBe('number');
    // All ten attempts landed just now, so the oldest frees a slot in ~15 min.
    // Allow slack for test-execution time; it must be a real, near-full window.
    expect(retry).toBeGreaterThan(890);
    expect(retry).toBeLessThanOrEqual(900);
  });
});
