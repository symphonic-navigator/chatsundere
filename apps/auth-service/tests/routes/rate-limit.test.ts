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
// The IP-backstop tests also cover Finding M2 (Larissa, Medium): the IP
// bucket must be gated behind RATE_LIMIT_TRUST_FORWARDED_IP (default off) and
// must never fire for the 'unknown' sentinel, regardless of the flag —
// otherwise a naive self-host without a trusted reverse proxy funnels every
// login into one global bucket, and pre-TRUST_PROXY_HOPS an attacker can
// spoof a victim's IP to lock them out.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { closeRedis, createRedis } from '../../src/redis/client.js';
import { applyLoginRateLimit } from '../../src/routes/_rate-limit-helpers.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('applyLoginRateLimit', () => {
  beforeEach(async () => {
    const redis = createRedis();
    const keys = await redis.keys('rl:login:*');
    if (keys.length) await redis.del(...keys);
  });

  afterEach(() => {
    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = undefined;
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

  it('still throttles a single username by the per-username limit regardless of the IP-trust flag', async () => {
    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = 'false';
    const usernameOff = `single-user-off-${Math.random().toString(36).slice(2, 8)}`;
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    const resultsOff = await Promise.allSettled(
      Array.from({ length: 15 }, () => applyLoginRateLimit(usernameOff, ip)),
    );
    expect(resultsOff.filter((r) => r.status === 'rejected').length).toBeGreaterThanOrEqual(5);

    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = 'true';
    const usernameOn = `single-user-on-${Math.random().toString(36).slice(2, 8)}`;

    const resultsOn = await Promise.allSettled(
      Array.from({ length: 15 }, () => applyLoginRateLimit(usernameOn, ip)),
    );
    expect(resultsOn.filter((r) => r.status === 'rejected').length).toBeGreaterThanOrEqual(5);
  });

  it('does NOT throttle by IP when RATE_LIMIT_TRUST_FORWARDED_IP is off (default) — IP spraying with distinct usernames succeeds', async () => {
    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = undefined;
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    const results = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        applyLoginRateLimit(`ip-spray-off-${i}-${Math.random().toString(36).slice(2, 6)}`, ip),
      ),
    );

    // Every username is distinct and under its own per-username ceiling, so
    // with the IP bucket gated off, nothing should be rejected — even though
    // 60 requests would trip LOGIN_IP_MAX_ATTEMPTS (40) if the IP bucket ran.
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(0);
  });

  it('throttles the shared IP bucket when RATE_LIMIT_TRUST_FORWARDED_IP is on and many distinct usernames log in from one IP', async () => {
    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = 'true';
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        applyLoginRateLimit(`ip-spray-user-${i}-${Math.random().toString(36).slice(2, 6)}`, ip),
      ),
    );

    // Each username is distinct, so the per-username bucket never trips; only
    // an IP backstop can be responsible for any rejection here.
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(0); // 12 is comfortably under the IP ceiling in one burst...

    // ...but a much larger burst from the same IP must trip the backstop.
    const secondBurst = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        applyLoginRateLimit(`ip-spray-user-b-${i}-${Math.random().toString(36).slice(2, 6)}`, ip),
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

  it("never throttles by IP when ip is the 'unknown' sentinel, flag on or off", async () => {
    // Flag off (default): 'unknown' must not collapse everyone into one bucket.
    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = undefined;
    const resultsOff = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        applyLoginRateLimit(
          `unknown-ip-off-${i}-${Math.random().toString(36).slice(2, 6)}`,
          'unknown',
        ),
      ),
    );
    expect(resultsOff.filter((r) => r.status === 'rejected').length).toBe(0);

    // Flag on: 'unknown' must STILL never drive the IP bucket — it is a
    // sentinel for "no header present", never a real address.
    process.env.RATE_LIMIT_TRUST_FORWARDED_IP = 'true';
    const resultsOn = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        applyLoginRateLimit(
          `unknown-ip-on-${i}-${Math.random().toString(36).slice(2, 6)}`,
          'unknown',
        ),
      ),
    );
    expect(resultsOn.filter((r) => r.status === 'rejected').length).toBe(0);
  });
});
