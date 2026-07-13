// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { ApiError, errorEnvelope } from '../../src/middleware/error-envelope.js';
import { rateLimit } from '../../src/middleware/rate-limit.js';
import { closeRedis, createRedis } from '../../src/redis/client.js';

const BUCKET = 'test-bucket';

beforeEach(async () => {
  const redis = createRedis();
  const keys = await redis.keys(`rl:${BUCKET}:*`);
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await closeRedis();
});

describe('rateLimit', () => {
  it('lets the first N requests through and rejects N+1', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.use('*', rateLimit({ bucket: BUCKET, windowSec: 60, max: 3, key: () => 'k1' }));
    app.get('/x', (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/x');
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('/x');
    expect(blocked.status).toBe(429);
  });
});

describe('errorEnvelope — Retry-After header', () => {
  it('emits Retry-After (whole seconds) for a 429 carrying retryAfterSeconds', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.get('/x', () => {
      throw new ApiError(429, 'rate_limited', 'Too many', { retryAfterSeconds: 42 });
    });

    const res = await app.request('/x');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    // Still carried in the envelope body as a fallback for readers that prefer it.
    const body = (await res.json()) as { error: { retryAfterSeconds?: number } };
    expect(body.error.retryAfterSeconds).toBe(42);
  });

  it('omits Retry-After for a 429 without the hint, and for non-429 errors', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.get('/plain429', () => {
      throw new ApiError(429, 'rate_limited', 'Too many');
    });
    app.get('/e403', () => {
      throw new ApiError(403, 'forbidden', 'No', { retryAfterSeconds: 42 });
    });

    const r1 = await app.request('/plain429');
    expect(r1.headers.get('Retry-After')).toBeNull();
    const r2 = await app.request('/e403');
    expect(r2.headers.get('Retry-After')).toBeNull();
  });
});
