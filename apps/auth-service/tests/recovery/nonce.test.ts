// SPDX-License-Identifier: AGPL-3.0-only
//
// Race test for consumeNonce's single-use Redis state consumption.
// Requires a live Redis instance. Skipped when REDIS_URL is absent.

import { afterAll, describe, expect, it } from 'bun:test';
import { consumeNonce, storeNonce } from '../../src/recovery/nonce.js';
import { createRedis } from '../../src/redis/client.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('consumeNonce', () => {
  const redis = createRedis();
  const username = `race-test-${Math.random().toString(36).slice(2, 10)}`;
  const nonce = crypto.getRandomValues(new Uint8Array(16));

  afterAll(async () => {
    await redis.del(`recovery:nonce:${username}`);
  });

  it('lets exactly one of two concurrent consumers succeed for the same nonce', async () => {
    await storeNonce(username, nonce);

    const [first, second] = await Promise.all([
      consumeNonce(username, nonce),
      consumeNonce(username, nonce),
    ]);

    const successes = [first, second].filter((result) => result === true);
    const failures = [first, second].filter((result) => result === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });
});
