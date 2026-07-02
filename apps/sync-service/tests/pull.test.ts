// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { toBase64Url } from '@chatsundere/crypto';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { registerChangesRoutes } from '../src/routes/changes.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

let t: TestDb;
let redis: Redis;
let epoch: string;
const A = '44444444-4444-4444-4444-444444444444';
const B = '55555555-5555-5555-5555-555555555555';

beforeAll(async () => {
  t = await withTestDb();
  redis = new Redis(process.env.REDIS_URL as string);
  epoch = await getInstanceEpoch(t.db);
});
afterEach(async () => {
  await t.reset();
  await redis.flushdb();
});
afterAll(async () => {
  await t.close();
  await redis.quit();
});

const verifyToken = async (token: string) => {
  const [sub, jti, iat] = token.split('|');
  return sub && jti && iat ? { sub, jti, iat: Number(iat) } : null;
};

function app() {
  const a = new Hono();
  const deps: SyncDeps = { env: loadEnv(), db: t.db, redis, verifyToken, allow: createLimiter(redis), epoch };
  registerChangesRoutes(a, deps);
  return a;
}
const b64 = (u: Uint8Array) => toBase64Url(u);
async function wire(fill: number, opts: { baseRev?: number; deleted?: boolean; size?: number } = {}) {
  const { baseRev = 0, deleted = false, size = 100 } = opts;
  const blindId = b64(new Uint8Array(16).fill(fill));
  if (deleted) return { blindId, collection: 'chats', envelopeVersion: 1, baseRev, deleted: true };
  const ciphertext = new Uint8Array(size).fill(fill);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
  return { blindId, collection: 'chats', envelopeVersion: 1, baseRev, deleted: false, nonce: b64(new Uint8Array(12)), ciphertext: b64(ciphertext), ciphertextHash: b64(hash) };
}
const tok = (sub: string) => `${sub}|s|1000`;
function push(a: Hono, sub: string, records: unknown[]) {
  return a.request('/api/v1/sync/changes', {
    method: 'POST',
    headers: { authorization: `Bearer ${tok(sub)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  });
}
function pull(a: Hono, sub: string, query: string) {
  return a.request(`/api/v1/sync/changes?${query}`, { headers: { authorization: `Bearer ${tok(sub)}` } });
}

describe('GET /api/v1/sync/changes', () => {
  test('returns ascending records with rev > since, plus head/epoch/more', async () => {
    const a = app();
    await push(a, A, [await wire(1), await wire(2), await wire(3)]);
    const res = await pull(a, A, 'since=0&limit=200');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { head: number; epoch: string; more: boolean; records: { rev: number }[] };
    expect(body.head).toBe(3);
    expect(body.epoch).toBe(epoch);
    expect(body.more).toBe(false);
    expect(body.records.map((r) => r.rev)).toEqual([1, 2, 3]);
  });

  test('over-max limit clamps rather than 400', async () => {
    const a = app();
    await push(a, A, [await wire(1)]);
    const res = await pull(a, A, 'since=0&limit=99999');
    expect(res.status).toBe(200);
  });

  test('negative/malformed since → 400', async () => {
    const a = app();
    expect((await pull(a, A, 'since=-1')).status).toBe(400);
    expect((await pull(a, A, 'since=abc')).status).toBe(400);
  });

  test('since > head → 400 bad_since', async () => {
    const a = app();
    await push(a, A, [await wire(1)]); // head 1
    const res = await pull(a, A, 'since=5');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_since');
  });

  test('tombstones ride the wire without crypto fields', async () => {
    const a = app();
    await push(a, A, [await wire(1)]); // rev 1
    await push(a, A, [await wire(1, { deleted: true, baseRev: 1 })]); // rev 2 tombstone
    const body = (await (await pull(a, A, 'since=1&limit=200')).json()) as {
      records: { rev: number; deleted: boolean; ciphertext?: string }[];
    };
    const tomb = body.records.find((r) => r.rev === 2);
    expect(tomb?.deleted).toBe(true);
    expect(tomb?.ciphertext).toBeUndefined();
  });

  test('account isolation: B never sees A records', async () => {
    const a = app();
    await push(a, A, [await wire(1)]);
    const body = (await (await pull(a, B, 'since=0')).json()) as { head: number; records: unknown[] };
    expect(body.head).toBe(0);
    expect(body.records).toHaveLength(0);
  });
});
