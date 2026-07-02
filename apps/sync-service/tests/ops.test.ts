// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Redis } from 'ioredis';
import { createDb } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createOpsApp } from '../src/ops.js';
import { createServer } from '../src/server.js';

let redis: Redis;
let deps: SyncDeps;

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL as string);
  deps = {
    env: loadEnv(),
    db: createDb().db,
    redis,
    verifyToken: async () => null,
    allow: async () => true,
    epoch: 'e',
  };
});
afterAll(async () => {
  await redis.quit();
});

const okCheck = async () => ({ database: 'ok' as const, redis: 'ok' as const });

describe('ops app', () => {
  test('serves /metrics, /healthz, /readyz', async () => {
    const app = createOpsApp(okCheck);
    expect((await app.request('/healthz')).status).toBe(200);
    const metrics = await app.request('/metrics');
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain('# TYPE');
    expect((await app.request('/readyz')).status).toBe(200);
  });

  test('readyz degrades to 503 when a dependency is down', async () => {
    const dbDown = createOpsApp(async () => ({ database: 'down', redis: 'ok' }));
    expect((await dbDown.request('/readyz')).status).toBe(503);
    const redisDown = createOpsApp(async () => ({ database: 'ok', redis: 'down' }));
    expect((await redisDown.request('/readyz')).status).toBe(503);
  });
});

describe('public app', () => {
  test('does not serve the ops endpoints', async () => {
    const app = createServer(deps);
    expect((await app.request('/metrics')).status).toBe(404);
    expect((await app.request('/healthz')).status).toBe(404);
  });

  test('CORS: allowed origin reflected + Vary, no credentials', async () => {
    const app = createServer(deps);
    const res = await app.request('/api/v1/sync/changes', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.chatsundere.me' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.chatsundere.me');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  test('CORS: evil.com and Origin null get no CORS headers', async () => {
    const app = createServer(deps);
    const evil = await app.request('/api/v1/sync/changes', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.chatsundere.me.evil.com' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const nul = await app.request('/api/v1/sync/changes', { method: 'OPTIONS', headers: { origin: 'null' } });
    expect(nul.headers.get('access-control-allow-origin')).toBeNull();
  });
});
