// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createLimiter } from '../src/ratelimit/limiter.js';

/**
 * Faithful in-memory stand-in for the Redis `eval(INCR_WITH_TTL)` call: it
 * increments the counter and, on the first hit only, records the TTL — the same
 * atomic coupling the real Lua script guarantees. `ttl` is exposed so a test can
 * assert the bucket is never left without an expiry.
 */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttl = new Map<string, number>();
  return {
    ttl,
    eval: async (_script: string, _numKeys: number, key: string, windowSec: number) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      if (n === 1) ttl.set(key, Number(windowSec));
      return n;
    },
  };
}

describe('limiter', () => {
  test('allows up to the limit then blocks', async () => {
    const allow = createLimiter(fakeRedis());
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await allow('user:u', 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });

  test('fails closed on Redis error', async () => {
    const broken = {
      eval: async () => {
        throw new Error('down');
      },
    };
    expect(await createLimiter(broken)('user:u', 100, 60)).toBe(false);
  });

  test('attaches a TTL on the first increment of a fresh window (no immortal bucket)', async () => {
    const redis = fakeRedis();
    const allow = createLimiter(redis);
    await allow('user:u', 3, 60);
    await allow('user:u', 3, 60);
    // The TTL is attached atomically with the first INCR, so a mid-operation
    // fault can never leave the counter without an expiry.
    expect(redis.ttl.get('sync:rl:user:u')).toBe(60);
  });

  test('the delete window is independent of the user window', async () => {
    const allow = createLimiter(fakeRedis());
    // 59 tombstones + 100 ordinary writes: both pass (separate buckets).
    for (let i = 0; i < 59; i++) expect(await allow('del:u', 60, 60)).toBe(true);
    for (let i = 0; i < 100; i++) expect(await allow('user:u', 120, 60)).toBe(true);
    // 60th delete passes; 61st is limited while ordinary writes still pass.
    expect(await allow('del:u', 60, 60)).toBe(true); // 60th
    expect(await allow('del:u', 60, 60)).toBe(false); // 61st → limited
    expect(await allow('user:u', 120, 60)).toBe(true); // ordinary unaffected
  });
});
