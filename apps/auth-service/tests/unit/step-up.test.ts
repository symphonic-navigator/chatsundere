// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { requireStepUp, tierGraceMs } from '../../src/auth/step-up.js';
import { createRedis } from '../../src/redis/client.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('requireStepUp', () => {
  const sessionId = `step-up-test-${Math.random().toString(36).slice(2, 10)}`;
  const redis = createRedis();

  beforeAll(async () => {
    await redis.del(`step_up:${sessionId}:t1`, `step_up:${sessionId}:t4`);
  });

  beforeEach(async () => {
    await redis.del(`step_up:${sessionId}:t1`, `step_up:${sessionId}:t4`);
  });

  afterAll(async () => {
    await redis.del(`step_up:${sessionId}:t1`, `step_up:${sessionId}:t4`);
  });

  it('throws 403 step_up_required when no key exists for the tier', async () => {
    await expect(requireStepUp({ sessionId, tier: 1 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('passes when a fresh key exists within the Tier 1 grace window', async () => {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 120);
    await expect(requireStepUp({ sessionId, tier: 1 })).resolves.toBeUndefined();
  });

  it('throws 403 when the value timestamp is older than the Tier 1 grace window', async () => {
    // Stored timestamp is 130 seconds old; Tier 1 grace is 120 seconds.
    // Use a large enough TTL on the key itself so the key has not expired
    // — we want to exercise the timestamp-based validation, not the Redis TTL.
    const oldTs = String(Date.now() - 130_000);
    await redis.set(`step_up:${sessionId}:t1`, oldTs, 'EX', 200);
    await expect(requireStepUp({ sessionId, tier: 1 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('honours the Tier 4 grace window of 5 minutes', async () => {
    // 250 seconds old; well within Tier 4's 300-second grace.
    const ts = String(Date.now() - 250_000);
    await redis.set(`step_up:${sessionId}:t4`, ts, 'EX', 400);
    await expect(requireStepUp({ sessionId, tier: 4 })).resolves.toBeUndefined();
  });

  it('throws 403 when the Tier 4 timestamp is older than 5 minutes', async () => {
    const ts = String(Date.now() - 310_000);
    await redis.set(`step_up:${sessionId}:t4`, ts, 'EX', 400);
    await expect(requireStepUp({ sessionId, tier: 4 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('throws 403 when the stored value is not a parseable number', async () => {
    await redis.set(`step_up:${sessionId}:t1`, 'not-a-number', 'EX', 60);
    await expect(requireStepUp({ sessionId, tier: 1 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('attaches the tier in the error metadata for client rendering', async () => {
    try {
      await requireStepUp({ sessionId, tier: 1 });
      throw new Error('requireStepUp should have thrown');
    } catch (err) {
      expect(err).toMatchObject({
        status: 403,
        code: 'step_up_required',
        metadata: { tier: 1 },
      });
    }
  });
});

describe('tierGraceMs', () => {
  it('returns 120_000 for Tier 1', () => {
    expect(tierGraceMs(1)).toBe(120_000);
  });

  it('returns 300_000 for Tier 4', () => {
    expect(tierGraceMs(4)).toBe(300_000);
  });
});
