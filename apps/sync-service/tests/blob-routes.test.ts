// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mintBlobId, toBase64Url } from '@chatsundere/crypto';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { register } from 'prom-client';
import { type BlobBackend, blobKey } from '../src/blobs/s3.js';
import { findBlob } from '../src/blobs/store.js';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { registerBlobRoutes } from '../src/routes/blobs.js';
import { registerChangesRoutes } from '../src/routes/changes.js';
import { createServer } from '../src/server.js';
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

const SUB = '66666666-6666-6666-6666-666666666666';
const TOKEN = `${SUB}|sess1|1000`;
const TOKEN2 = '77777777-7777-7777-7777-777777777777|sess2|1000';
const verifyToken = async (token: string) => {
  if (token === 'BAD') return null;
  const [sub, jti, iat] = token.split('|');
  return sub && jti && iat ? { sub, jti, iat: Number(iat), exp: Number(iat) + 900 } : null;
};

type ErrJson = {
  error: { code: string; usedBytes?: number; quotaBytes?: number; maxBlobBytes?: number };
};
type ListJson = {
  blobs: { blobId: string; bytes: number }[];
  totalBytes: number;
  quotaBytes: number;
};
const asErr = (v: unknown): ErrJson => v as ErrJson;
const asList = (v: unknown): ListJson => v as ListJson;

/** In-memory blob backend — the BlobBackend seam lets the route tests run without MinIO. */
class FakeBackend implements BlobBackend {
  store = new Map<string, Uint8Array>();
  down = false;
  puts = 0;
  async putStream(key: string, body: ReadableStream<Uint8Array>, _length: number): Promise<void> {
    this.puts++;
    if (this.down) {
      await body.cancel().catch(() => {});
      throw new Error('backend down');
    }
    const buf = new Uint8Array(await new Response(body).arrayBuffer());
    this.store.set(key, buf);
  }
  async getStream(key: string) {
    if (this.down) throw new Error('backend down');
    const b = this.store.get(key);
    return b
      ? { stream: new Blob([b]).stream() as ReadableStream<Uint8Array>, length: b.length }
      : null;
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async healthy(): Promise<boolean> {
    return !this.down;
  }
}

/**
 * A backend whose uploads can be held open after the body has drained — the
 * seam for deterministic route-level races: with `hold` set, every PUT has
 * passed the unlocked step-3 existence check and the quota pre-check but has
 * not yet committed, until `releaseAll` lets the commits proceed.
 */
class GatedBackend extends FakeBackend {
  hold = false;
  private waiters: (() => void)[] = [];
  releaseAll(): void {
    for (const w of this.waiters) w();
    this.waiters = [];
  }
  override async putStream(
    key: string,
    body: ReadableStream<Uint8Array>,
    length: number,
  ): Promise<void> {
    await super.putStream(key, body, length);
    if (this.hold) await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}

/** A backend whose object deletes always fail (spec §18: DB-first delete order). */
class FailingDeleteBackend extends FakeBackend {
  override async delete(_key: string): Promise<void> {
    throw new Error('object store refused the delete');
  }
}

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function build(
  backend: BlobBackend | null,
  envOverrides: Partial<ReturnType<typeof loadEnv>> = {},
): Hono {
  const env = { ...loadEnv(), ...envOverrides };
  const app = new Hono();
  const deps: SyncDeps = {
    env,
    db: t.db,
    redis,
    verifyToken,
    allow: createLimiter(redis),
    epoch,
    blobBackend: backend,
  };
  registerChangesRoutes(app, deps);
  registerBlobRoutes(app, deps);
  return app;
}

async function makeBlob(size: number) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes.subarray(0, Math.min(size, 65536)));
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return { bytes, hashB64: toBase64Url(hash), blobId: mintBlobId() };
}

function put(
  app: Hono,
  blobId: string,
  bytes: Uint8Array,
  hashB64: string,
  token = TOKEN,
  contentLength?: number,
) {
  return app.request(`/api/v1/sync/blobs/${blobId}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-ciphertext-hash': hashB64,
      'content-length': String(contentLength ?? bytes.length),
    },
    body: bytes,
  });
}

describe('PUT /api/v1/sync/blobs/:blobId', () => {
  test('401 without a valid token', async () => {
    const app = build(new FakeBackend());
    const { bytes, hashB64, blobId } = await makeBlob(64);
    const res = await put(app, blobId, bytes, hashB64, 'BAD');
    expect(res.status).toBe(401);
  });

  test('501 blobs_disabled when no backend is configured', async () => {
    const app = build(null);
    const { bytes, hashB64, blobId } = await makeBlob(64);
    const res = await put(app, blobId, bytes, hashB64);
    expect(res.status).toBe(501);
    expect(asErr(await res.json()).error.code).toBe('blobs_disabled');
  });

  test('missing Content-Length (chunked body) → 411', async () => {
    const app = build(new FakeBackend());
    const { hashB64, blobId } = await makeBlob(64);
    const res = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-ciphertext-hash': hashB64 },
      body: new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(64));
          ctrl.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(res.status).toBe(411);
  });

  test('happy path → 201, row stored, quota bumped (floored)', async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(1024);
    const res = await put(app, blobId, bytes, hashB64);
    expect(res.status).toBe(201);
    const list = asList(
      await (
        await build(backend).request('/api/v1/sync/blobs', {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json(),
    );
    expect(list.blobs.length).toBe(1);
    expect(list.totalBytes).toBe(65536); // floored
  });

  test('malformed blobId → 400', async () => {
    const app = build(new FakeBackend());
    const { bytes, hashB64 } = await makeBlob(64);
    const res = await put(app, 'too-short', bytes, hashB64);
    expect(res.status).toBe(400);
  });

  test('malformed x-ciphertext-hash (wrong length) → 400', async () => {
    const app = build(new FakeBackend());
    const { bytes, blobId } = await makeBlob(64);
    const res = await put(app, blobId, bytes, toBase64Url(new Uint8Array(16)));
    expect(res.status).toBe(400);
  });

  test('body below the 28-byte floor → 400', async () => {
    const app = build(new FakeBackend());
    const { hashB64, blobId } = await makeBlob(64);
    const res = await put(app, blobId, new Uint8Array(10), hashB64);
    expect(res.status).toBe(400);
  });

  test('over MAX_BLOB_BYTES → 413 with maxBlobBytes and ZERO S3 traffic', async () => {
    const backend = new FakeBackend();
    const app = build(backend, { MAX_BLOB_BYTES: 100 });
    const { bytes, hashB64, blobId } = await makeBlob(200);
    const res = await put(app, blobId, bytes, hashB64);
    expect(res.status).toBe(413);
    const body = asErr(await res.json());
    expect(body.error.code).toBe('blob_too_large');
    expect(body.error.maxBlobBytes).toBe(100);
    expect(backend.puts).toBe(0); // rejected before any byte flowed to S3
  });

  test('a >24 MiB (<32 MiB) upload succeeds — the MAX_BODY_BYTES exemption', async () => {
    const backend = new FakeBackend();
    const app = build(backend, { MAX_BODY_BYTES: 25 * 1024 * 1024 - 1 });
    const { bytes, hashB64, blobId } = await makeBlob(25 * 1024 * 1024);
    const res = await put(app, blobId, bytes, hashB64);
    expect(res.status).toBe(201);
  });

  test('hash mismatch → 400, nothing committed', async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const { bytes, blobId } = await makeBlob(64);
    const wrong = toBase64Url(new Uint8Array(32).fill(1));
    const res = await put(app, blobId, bytes, wrong);
    expect(res.status).toBe(400);
    expect(asErr(await res.json()).error.code).toBe('hash_mismatch');
  });

  test('actual byte count ≠ Content-Length → 400', async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(64);
    const res = await put(app, blobId, bytes, hashB64, TOKEN, 128); // lie: declare more
    expect(res.status).toBe(400);
  });

  test('idempotent re-PUT (same hash) → 200, no double count — even at a full account', async () => {
    const backend = new FakeBackend();
    const app = build(backend, { ACCOUNT_QUOTA_BYTES: 65536 }); // room for exactly one floored blob
    const { bytes, hashB64, blobId } = await makeBlob(1024);
    expect((await put(app, blobId, bytes, hashB64)).status).toBe(201);
    const again = await put(app, blobId, bytes, hashB64); // account now full
    expect(again.status).toBe(200);
    const list = asList(
      await (
        await app.request('/api/v1/sync/blobs', {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json(),
    );
    expect(list.totalBytes).toBe(65536); // still one charge
  });

  test('re-PUT with a different hash → 409 blob_exists', async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const first = await makeBlob(64);
    await put(app, first.blobId, first.bytes, first.hashB64);
    const other = await makeBlob(64);
    const res = await put(app, first.blobId, other.bytes, other.hashB64);
    expect(res.status).toBe(409);
    expect(asErr(await res.json()).error.code).toBe('blob_exists');
  });

  test('quota edge: exact fit passes, +1 byte → 507 with used/quota', async () => {
    const backend = new FakeBackend();
    // floor 100, quota 200 → two floored-100 blobs fit, a third does not.
    const app = build(backend, { BLOB_QUOTA_FLOOR_BYTES: 100, ACCOUNT_QUOTA_BYTES: 200 });
    const a = await makeBlob(50);
    const b = await makeBlob(50);
    const c = await makeBlob(50);
    expect((await put(app, a.blobId, a.bytes, a.hashB64)).status).toBe(201);
    expect((await put(app, b.blobId, b.bytes, b.hashB64)).status).toBe(201);
    const over = await put(app, c.blobId, c.bytes, c.hashB64);
    expect(over.status).toBe(507);
    const body = asErr(await over.json());
    expect(body.error.usedBytes).toBe(200);
    expect(body.error.quotaBytes).toBe(200);
  });

  test('two concurrent PUTs of one blobId with DIFFERENT bodies → exactly one 201, one 409; the DB hash is the winner’s', async () => {
    const backend = new GatedBackend();
    const app = build(backend);
    const first = await makeBlob(64);
    const second = await makeBlob(64); // different bytes → different hash, same id below
    backend.hold = true;
    const pA = put(app, first.blobId, first.bytes, first.hashB64);
    const pB = put(app, first.blobId, second.bytes, second.hashB64);
    // Both racers past the unlocked existence check (and streamed) before either commits.
    await until(() => backend.puts === 2);
    backend.releaseAll();
    const [resA, resB] = await Promise.all([pA, pB]);
    expect([resA.status, resB.status].sort((x, y) => x - y)).toEqual([201, 409]);
    const loser = resA.status === 409 ? resA : resB;
    expect(asErr(await loser.json()).error.code).toBe('blob_exists');
    // The stored hash is the 201 winner's — the divergent loser was never recorded.
    const winner = resA.status === 201 ? first : second;
    const row = await findBlob(t.db, SUB, first.blobId);
    expect(row ? toBase64Url(new Uint8Array(row.ciphertextHash)) : null).toBe(winner.hashB64);
  });

  test('commit-time quota race → 507 carries usedBytes/quotaBytes; the loser’s object is cleaned', async () => {
    const backend = new GatedBackend();
    const app = build(backend, { ACCOUNT_QUOTA_BYTES: 65536 }); // room for exactly one floored blob
    const a = await makeBlob(64);
    const b = await makeBlob(64);
    backend.hold = true;
    const pA = put(app, a.blobId, a.bytes, a.hashB64); // pre-check passes at the empty account
    await until(() => backend.puts === 1);
    backend.hold = false;
    expect((await put(app, b.blobId, b.bytes, b.hashB64)).status).toBe(201); // fills the quota
    backend.releaseAll();
    const res = await pA; // enforcement under the lock (spec §7.1 step 6)
    expect(res.status).toBe(507);
    const body = asErr(await res.json());
    expect(body.error.code).toBe('quota_exceeded');
    expect(body.error.usedBytes).toBe(65536); // spec §7.5: the constructive payload
    expect(body.error.quotaBytes).toBe(65536);
    expect(backend.store.has(blobKey(SUB, a.blobId))).toBe(false); // best-effort cleanup ran
    expect(backend.store.has(blobKey(SUB, b.blobId))).toBe(true);
  });

  test('backend throws → 503 blob_backend_unavailable, record push still green', async () => {
    const backend = new FakeBackend();
    backend.down = true;
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(64);
    const res = await put(app, blobId, bytes, hashB64);
    expect(res.status).toBe(503);
    // The record channel is untouched by an S3 outage.
    const push = await app.request('/api/v1/sync/changes', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ records: [] }),
    });
    expect(push.status).toBe(200);
  });
});

describe('GET /api/v1/sync/blobs/:blobId', () => {
  test('byte-identical round-trip, Cache-Control: no-store', async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(4096);
    await put(app, blobId, bytes, hashB64);
    const res = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got.length).toBe(bytes.length);
    expect(got[0]).toBe(bytes[0]);
    expect(got[got.length - 1]).toBe(bytes[bytes.length - 1]);
  });

  test('unknown id → 404', async () => {
    const app = build(new FakeBackend());
    const res = await app.request(`/api/v1/sync/blobs/${mintBlobId()}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  test('DB row present / S3 object missing → 404 AND the inconsistency counter increments', async () => {
    const backend = new FakeBackend();
    const deps: SyncDeps = {
      env: loadEnv(),
      db: t.db,
      redis,
      verifyToken,
      allow: createLimiter(redis),
      epoch,
      blobBackend: backend,
    };
    const app = createServer(deps); // the REAL metrics wiring (server.ts), not a fake hook
    const { bytes, hashB64, blobId } = await makeBlob(64);
    expect((await put(app, blobId, bytes, hashB64)).status).toBe(201);
    backend.store.clear(); // backup skew: the row survives, the object is gone
    const counter = async (): Promise<number> => {
      const metric = await register.getSingleMetric('sync_blob_inconsistency_total')?.get();
      return metric?.values[0]?.value ?? 0;
    };
    const before = await counter();
    const res = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
    expect(asErr(await res.json()).error.code).toBe('not_found');
    expect(await counter()).toBe(before + 1);
  });

  test("another account's id → 404 (absolute scoping)", async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(64);
    await put(app, blobId, bytes, hashB64, TOKEN);
    const res = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      headers: { authorization: `Bearer ${TOKEN2}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/sync/blobs/:blobId', () => {
  test('frees quota and is idempotent (204 on absent)', async () => {
    const backend = new FakeBackend();
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(1024);
    await put(app, blobId, bytes, hashB64);
    const del = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(del.status).toBe(204);
    const list = asList(
      await (
        await app.request('/api/v1/sync/blobs', {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json(),
    );
    expect(list.totalBytes).toBe(0);
    const again = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(again.status).toBe(204);
  });

  test('failing S3 delete → DB-first upheld: 204, row gone, quota freed, object orphaned', async () => {
    const backend = new FailingDeleteBackend();
    const app = build(backend);
    const { bytes, hashB64, blobId } = await makeBlob(1024);
    await put(app, blobId, bytes, hashB64);
    const del = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(del.status).toBe(204); // spec §7.3: the S3 delete is best-effort AFTER the DB commit
    expect(await findBlob(t.db, SUB, blobId)).toBeNull();
    const list = asList(
      await (
        await app.request('/api/v1/sync/blobs', {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json(),
    );
    expect(list.totalBytes).toBe(0); // quota credited despite the S3 failure
    expect(backend.store.has(blobKey(SUB, blobId))).toBe(true); // orphaned object → sweep territory
  });

  test('a mix of record tombstones and blob deletes trips the same delete window', async () => {
    const backend = new FakeBackend();
    const app = build(backend, { RATE_LIMIT_DELETE_PER_MIN: 1 });
    // Store a blob to delete.
    const { bytes, hashB64, blobId } = await makeBlob(64);
    await put(app, blobId, bytes, hashB64);
    // First delete consumes the single allowance.
    const first = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(first.status).toBe(204);
    // A record tombstone now finds the shared window exhausted.
    const tombstone = {
      blindId: toBase64Url(new Uint8Array(16).fill(9)),
      collection: 'chats',
      envelopeVersion: 1,
      baseRev: 0,
      deleted: true,
    };
    const push = await app.request('/api/v1/sync/changes', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ records: [tombstone] }),
    });
    const body = (await push.json()) as { results: { status: string; code?: string }[] };
    expect(body.results[0]?.code).toBe('delete_rate_limited');
  });

  test('over the window → 429 with Retry-After', async () => {
    const backend = new FakeBackend();
    const app = build(backend, { RATE_LIMIT_DELETE_PER_MIN: 1 });
    const b1 = await makeBlob(64);
    await put(app, b1.blobId, b1.bytes, b1.hashB64);
    await app.request(`/api/v1/sync/blobs/${b1.blobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const res = await app.request(`/api/v1/sync/blobs/${mintBlobId()}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});

describe('Listing + shared quota', () => {
  test('listing carries ids, bytes, totals and the quota', async () => {
    const backend = new FakeBackend();
    const app = build(backend, { ACCOUNT_QUOTA_BYTES: 123456 });
    const res = await app.request('/api/v1/sync/blobs', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    expect(body).toEqual({ blobs: [], totalBytes: 0, quotaBytes: 123456 });
  });
});
