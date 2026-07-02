// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Hono } from 'hono';
import { Redis } from 'ioredis';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { createServer } from '../src/server.js';
import { mintMk, openFromWire, sealToWire } from '../tools/seal-cli.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

// Two devices of ONE account (same sub, different session).
const ACC = '99999999-9999-9999-9999-999999999999';
const D1 = `${ACC}|dev1|9999999999`;
const D2 = `${ACC}|dev2|9999999999`;

let t: TestDb;
let redis: Redis;
let app: Hono;

beforeAll(async () => {
  t = await withTestDb();
  redis = new Redis(process.env.REDIS_URL as string);
  await redis.flushdb();
  const verifyToken = async (token: string) => {
    const [sub, jti, iat] = token.split('|');
    return sub && jti && iat ? { sub, jti, iat: Number(iat), exp: Number(iat) } : null;
  };
  const deps: SyncDeps = {
    env: loadEnv(),
    db: t.db,
    redis,
    verifyToken,
    allow: createLimiter(redis),
    epoch: await getInstanceEpoch(t.db),
    blobBackend: null,
  };
  app = createServer(deps);
});
afterAll(async () => {
  await t.close();
  await redis.quit();
});

function push(token: string, records: unknown[]) {
  return app.request('/api/v1/sync/changes', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  });
}
function pull(token: string) {
  return app.request('/api/v1/sync/changes?since=0&limit=200', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('end-to-end sync round-trip (spec §15)', () => {
  test('device 1 seals+pushes; device 2 pulls+opens; a tombstone race returns tombstoned', async () => {
    const mk = mintMk();
    const row = { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Wafer', adultPersona: true };

    // Device 1 seals a persona and pushes it.
    const sealed = await sealToWire(mk, 'personas', row.id, row);
    const pushRes = await push(D1, [sealed]);
    expect(pushRes.status).toBe(200);
    const pushBody = (await pushRes.json()) as { results: { status: string; rev: number }[] };
    expect(pushBody.results[0]?.status).toBe('ok');

    // Device 2 pulls and opens the blob → identical to the input.
    const pullBody = (await (await pull(D2)).json()) as {
      records: { blindId: string; nonce: string; ciphertext: string }[];
    };
    expect(pullBody.records).toHaveLength(1);
    const pulled = pullBody.records[0];
    if (!pulled) throw new Error('no record pulled');
    const opened = await openFromWire(mk, 'personas', pulled.blindId, {
      nonce: pulled.nonce,
      ciphertext: pulled.ciphertext,
    });
    expect(opened).toEqual(row);

    // Device 2 deletes; device 1's edit push to the same blindId → tombstoned.
    const del = await push(D2, [
      {
        blindId: sealed.blindId,
        collection: 'personas',
        envelopeVersion: 1,
        baseRev: 1,
        deleted: true,
      },
    ]);
    expect(((await del.json()) as { results: { status: string }[] }).results[0]?.status).toBe('ok');

    const edited = await sealToWire(mk, 'personas', row.id, { ...row, name: 'Wafer 2' });
    const editRes = await push(D1, [{ ...edited, baseRev: 1 }]);
    const editBody = (await editRes.json()) as { results: { status: string }[] };
    expect(editBody.results[0]?.status).toBe('tombstoned');
  });
});
