// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { errorEnvelope } from '../../src/middleware/error-envelope.js';
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
