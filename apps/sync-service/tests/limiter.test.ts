// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createLimiter } from '../src/ratelimit/limiter.js';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    incr: async (k: string) => {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    },
    expire: async () => 1,
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
    const broken = { incr: async () => { throw new Error('down'); }, expire: async () => 1 };
    expect(await createLimiter(broken)('user:u', 100, 60)).toBe(false);
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
