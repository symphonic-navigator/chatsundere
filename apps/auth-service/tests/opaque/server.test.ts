// SPDX-License-Identifier: AGPL-3.0-only
//
// Race test for fetchOpaqueState's single-use Redis state consumption.
// Requires a live Redis instance. Skipped when REDIS_URL is absent.

import { afterAll, describe, expect, it } from 'bun:test';
import { fetchOpaqueState, storeOpaqueState } from '../../src/opaque/server.js';
import { createRedis } from '../../src/redis/client.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('fetchOpaqueState', () => {
  const redis = createRedis();
  const sessionId = `race-test-${Math.random().toString(36).slice(2, 10)}`;

  afterAll(async () => {
    await redis.del(`opaque:login:${sessionId}`);
  });

  it('lets exactly one of two concurrent consumers win the race for the same key', async () => {
    await storeOpaqueState({ scope: 'login', sessionId, payload: { foo: 'bar' } });

    const [first, second] = await Promise.all([
      fetchOpaqueState('login', sessionId),
      fetchOpaqueState('login', sessionId),
    ]);

    const winners = [first, second].filter((result) => result !== null);
    const losers = [first, second].filter((result) => result === null);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]).toEqual({ foo: 'bar' });
  });
});
