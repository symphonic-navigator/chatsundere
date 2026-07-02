// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createLimiter } from '../src/ratelimit/limiter.js';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    incr: async (k: string) => { const n = (store.get(k) ?? 0) + 1; store.set(k, n); return n; },
    expire: async () => 1,
  };
}

describe('limiter', () => {
  test('allows up to the limit then blocks', async () => {
    const allow = createLimiter(fakeRedis());
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await allow('k', 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });
  test('fails closed on Redis error', async () => {
    const broken = { incr: async () => { throw new Error('down'); }, expire: async () => 1 };
    expect(await createLimiter(broken)('k', 100, 60)).toBe(false);
  });
});
