// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { toBase64Url } from '@chatsundere/crypto';
import { revokedJtiKey } from '@chatsundere/shared-types';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { pullSince } from '../src/records/store.js';
import { registerChangesRoutes } from '../src/routes/changes.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

let t: TestDb;
let redis: Redis;
let epoch: string;

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

// Fake verifier: the token encodes sub|jti|iat; 'BAD' is rejected.
const verifyToken = async (token: string) => {
  if (token === 'BAD') return null;
  const [sub, jti, iat] = token.split('|');
  return sub && jti && iat ? { sub, jti, iat: Number(iat), exp: Number(iat) + 900 } : null;
};

function build(
  envOverrides: Partial<ReturnType<typeof loadEnv>> = {},
  allowOverride?: SyncDeps['allow'],
) {
  const env = { ...loadEnv(), ...envOverrides };
  const app = new Hono();
  const deps: SyncDeps = {
    env,
    db: t.db,
    redis,
    verifyToken,
    allow: allowOverride ?? createLimiter(redis),
    epoch,
  };
  registerChangesRoutes(app, deps);
  return app;
}

const b64 = (u: Uint8Array) => toBase64Url(u);
async function wire(
  fill: number,
  opts: { collection?: string; baseRev?: number; deleted?: boolean; size?: number } = {},
) {
  const { collection = 'chats', baseRev = 0, deleted = false, size = 100 } = opts;
  const blindId = b64(new Uint8Array(16).fill(fill));
  if (deleted) return { blindId, collection, envelopeVersion: 1, baseRev, deleted: true };
  const ciphertext = new Uint8Array(size).fill(fill);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
  return {
    blindId,
    collection,
    envelopeVersion: 1,
    baseRev,
    deleted: false,
    nonce: b64(new Uint8Array(12)),
    ciphertext: b64(ciphertext),
    ciphertextHash: b64(hash),
  };
}

function post(app: Hono, body: unknown, token = '33333333-3333-3333-3333-333333333333|sess1|1000') {
  return app.request('/api/v1/sync/changes', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/sync/changes', () => {
  test('401 without a valid token', async () => {
    const res = await build().request('/api/v1/sync/changes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records: [] }),
    });
    expect(res.status).toBe(401);
  });

  test('401 for a revoked jti', async () => {
    await redis.set(revokedJtiKey('sess1'), '1');
    const res = await post(build(), { records: [await wire(1)] });
    expect(res.status).toBe(401);
  });

  test('400 for malformed JSON, unknown field, and wrong decoded lengths', async () => {
    const bad = await build();
    const malformed = await bad.request('/api/v1/sync/changes', {
      method: 'POST',
      headers: {
        authorization: 'Bearer 33333333-3333-3333-3333-333333333333|sess1|1000',
        'content-type': 'application/json',
      },
      body: '{not json',
    });
    expect(malformed.status).toBe(400);
    expect((await post(bad, { records: [], extra: 1 })).status).toBe(400);
    const shortBlind = { ...(await wire(1)), blindId: b64(new Uint8Array(15)) };
    expect((await post(bad, { records: [shortBlind] })).status).toBe(400);
  });

  test('400 when records exceed MAX_PUSH_RECORDS', async () => {
    const app = build({ MAX_PUSH_RECORDS: 1 });
    const res = await post(app, { records: [await wire(1), await wire(2)] });
    expect(res.status).toBe(400);
  });

  test('413 when the body exceeds MAX_BODY_BYTES', async () => {
    const app = build({ MAX_BODY_BYTES: 50 });
    const res = await post(app, { records: [await wire(1, { size: 500 })] });
    expect(res.status).toBe(413);
  });

  test('accepts the blob-bearing collections on the record channel (§5.2)', async () => {
    const app = build();
    const collections = ['artefacts', 'personaAvatars', 'attachments'] as const;
    for (let i = 0; i < collections.length; i++) {
      const res = await post(app, { records: [await wire(i + 1, { collection: collections[i] })] });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: { status: string; code?: string }[] };
      expect(body.results[0]?.status).toBe('ok');
    }
  });

  test('happy path returns ok + head + epoch', async () => {
    const res = await post(build(), { records: [await wire(1)] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      head: number;
      epoch: string;
      results: { status: string }[];
    };
    expect(body.results[0]?.status).toBe('ok');
    expect(body.head).toBe(1);
    expect(body.epoch).toBe(epoch);
  });

  test('per-record semantics surface (one ok, one conflict)', async () => {
    const app = build();
    await post(app, { records: [await wire(2)] }); // rev 1
    const res = await post(app, { records: [await wire(1), await wire(2)] });
    const body = (await res.json()) as { results: { status: string }[] };
    expect(body.results.map((r) => r.status)).toEqual(['ok', 'conflict']);
  });

  test('doorbell publishes once post-commit for an accepted batch; the pull sees the records', async () => {
    const app = build();
    const listener = new Redis(process.env.REDIS_URL as string);
    const pokes: { rev: number; epoch: string }[] = [];
    let seenAtPoke = 0;
    await listener.subscribe('sync:33333333-3333-3333-3333-333333333333');
    listener.on('message', async (_ch, msg) => {
      pokes.push(JSON.parse(msg));
      const page = await pullSince(t.db, '33333333-3333-3333-3333-333333333333', 0, 200, 8_388_608);
      seenAtPoke = page.records.length; // commit-before-publish
    });

    const res = await post(app, { records: [await wire(1), await wire(2), await wire(3)] });
    const body = (await res.json()) as { head: number };
    await new Promise((r) => setTimeout(r, 150));
    expect(pokes).toHaveLength(1);
    expect(pokes[0]?.rev).toBe(body.head);
    expect(seenAtPoke).toBe(3);
    await listener.quit();
  });

  test('an all-idempotent batch fires no poke', async () => {
    const app = build();
    await post(app, { records: [await wire(5, { deleted: true })] }); // create tombstone (accepted)
    const listener = new Redis(process.env.REDIS_URL as string);
    const pokes: unknown[] = [];
    await listener.subscribe('sync:33333333-3333-3333-3333-333333333333');
    listener.on('message', (_ch, msg) => pokes.push(JSON.parse(msg)));
    await post(app, { records: [await wire(5, { deleted: true })] }); // idempotent → accepted: false
    await new Promise((r) => setTimeout(r, 150));
    expect(pokes).toHaveLength(0);
    await listener.quit();
  });

  test('429 with Retry-After when the limiter denies', async () => {
    const res = await post(
      build({}, async () => false),
      { records: [await wire(1)] },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});
