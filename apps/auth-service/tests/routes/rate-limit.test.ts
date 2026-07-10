// SPDX-License-Identifier: AGPL-3.0-only
//
// Concurrency + IP-backstop tests for applyLoginRateLimit. The four-command
// (zremrangebyscore -> zcard -> check -> zadd) sequence it used to run is not
// atomic: N concurrent requests can all read the same sub-threshold zcard
// before any zadd lands, letting all of them through (Finding #8). Requires a
// live Redis instance — skipped when REDIS_URL is absent (tests/setup.ts
// defaults it to redis://localhost:6379/15, matching the other Redis-backed
// integration tests in this suite).
//
// Since TRUST_PROXY_HOPS landed, the IP handed to applyLoginRateLimit is the
// spoof-resistant address derived by ipKey() (the socket peer or the trusted
// front-proxy hop), so the per-IP backstop is now UNCONDITIONALLY on for a real
// address — the old RATE_LIMIT_TRUST_FORWARDED_IP gate is gone. The one guard
// that remains is the 'unknown' sentinel (no derivable address): it must never
// drive the IP bucket, or a deployment without a socket peer would funnel every
// login into one global bucket and cap all users at once (Finding M2, harm 1).

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { closeRedis, createRedis } from '../../src/redis/client.js';
import { applyLoginRateLimit } from '../../src/routes/_rate-limit-helpers.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('applyLoginRateLimit', () => {
  beforeEach(async () => {
    const redis = createRedis();
    const keys = await redis.keys('rl:login:*');
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await closeRedis();
  });

  it('lets at most LOGIN_MAX_ATTEMPTS of 20 concurrent requests for the same username succeed', async () => {
    const username = `concurrent-bob-${Math.random().toString(36).slice(2, 8)}`;

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => applyLoginRateLimit(username)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBeLessThanOrEqual(10);
    expect(rejected.length).toBeGreaterThanOrEqual(10);
    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason as { status?: number; code?: string };
      expect(reason.status).toBe(429);
      expect(reason.code).toBe('rate_limited');
    }
  });

  it('still throttles a single username by the per-username limit', async () => {
    const username = `single-user-${Math.random().toString(36).slice(2, 8)}`;
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () => applyLoginRateLimit(username, ip)),
    );
    // 15 attempts for one username trip the per-username ceiling (10) well
    // before the per-IP one (40).
    expect(results.filter((r) => r.status === 'rejected').length).toBeGreaterThanOrEqual(5);
  });

  it('throttles the shared IP bucket unconditionally: many distinct usernames spraying one real IP trip the backstop', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    // Each username is distinct, so the per-username bucket never trips; only
    // the IP backstop can reject here. A small burst stays under the ceiling...
    const firstBurst = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        applyLoginRateLimit(`ip-spray-a-${i}-${Math.random().toString(36).slice(2, 6)}`, ip),
      ),
    );
    expect(firstBurst.filter((r) => r.status === 'rejected').length).toBe(0);

    // ...but a burst past LOGIN_IP_MAX_ATTEMPTS (40) from the same IP must trip
    // the backstop — with no flag to enable, purely because the derived IP is
    // now trustworthy.
    const secondBurst = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        applyLoginRateLimit(`ip-spray-b-${i}-${Math.random().toString(36).slice(2, 6)}`, ip),
      ),
    );
    const secondRejected = secondBurst.filter((r) => r.status === 'rejected');
    expect(secondRejected.length).toBeGreaterThan(0);
    for (const r of secondRejected) {
      const reason = (r as PromiseRejectedResult).reason as { status?: number; code?: string };
      expect(reason.status).toBe(429);
      expect(reason.code).toBe('rate_limited');
    }
  });

  it("never throttles by IP when ip is the 'unknown' sentinel", async () => {
    // 'unknown' is not a real address; it must never collapse every caller into
    // one shared bucket, even for a burst far past the IP ceiling.
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        applyLoginRateLimit(`unknown-ip-${i}-${Math.random().toString(36).slice(2, 6)}`, 'unknown'),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected').length).toBe(0);
  });
});
