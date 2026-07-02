// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { asMasterKey, getRandomBytes, openBlob, sealBlob, toBase64Url } from '@chatsundere/crypto';
import { mintBlobId } from '@chatsundere/crypto';
import { revokedJtiKey } from '@chatsundere/shared-types';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import type { BlobBackend } from '../src/blobs/s3.js';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { registerBlobRoutes } from '../src/routes/blobs.js';
import { registerChangesRoutes } from '../src/routes/changes.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

// The blob spec §15 wire flow, end to end, tying the crypto envelope, the HTTP
// transport, the shared quota and the deny-list into one narrative. It runs the
// real Hono stack + real Postgres with an in-memory object backend (the
// BlobBackend seam) so it needs no MinIO — the true MinIO round-trip is Chris's
// §20 VPS dry-run. This proves sealBlob → PUT → GET → openBlob is byte-stable.

const mk = asMasterKey(getRandomBytes(32));
const ACC = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEVICE1 = `${ACC}|device-1|1000`;
const DEVICE2 = `${ACC}|device-2|1000`; // same account, different session

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

const verifyToken = async (token: string) => {
  const [sub, jti, iat] = token.split('|');
  return sub && jti && iat ? { sub, jti, iat: Number(iat), exp: Number(iat) + 900 } : null;
};

class MemBackend implements BlobBackend {
  store = new Map<string, Uint8Array>();
  async putStream(key: string, body: ReadableStream<Uint8Array>): Promise<void> {
    this.store.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
  }
  async getStream(key: string) {
    const b = this.store.get(key);
    return b
      ? { stream: new Blob([b]).stream() as ReadableStream<Uint8Array>, length: b.length }
      : null;
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async healthy(): Promise<boolean> {
    return true;
  }
}

function build(envOverrides: Partial<ReturnType<typeof loadEnv>> = {}): Hono {
  const env = { ...loadEnv(), ...envOverrides };
  const app = new Hono();
  const deps: SyncDeps = {
    env,
    db: t.db,
    redis,
    verifyToken,
    allow: createLimiter(redis),
    epoch,
    blobBackend: new MemBackend(),
  };
  registerChangesRoutes(app, deps);
  registerBlobRoutes(app, deps);
  return app;
}

function putBlob(app: Hono, blobId: string, body: Uint8Array, hashB64: string, token: string) {
  return app.request(`/api/v1/sync/blobs/${blobId}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-ciphertext-hash': hashB64,
      'content-length': String(body.length),
    },
    body,
  });
}

describe('blob transport — cross-channel e2e (§15)', () => {
  test('seal → PUT → re-PUT → GET (other device) → open → list → quota → delete', async () => {
    const app = build({ ACCOUNT_QUOTA_BYTES: 200_000, BLOB_QUOTA_FLOOR_BYTES: 65536 });
    // Device 1 seals a real PNG fixture and uploads it.
    const plaintext = new Uint8Array(
      await Bun.file(join(import.meta.dir, 'fixtures/pixel.png')).arrayBuffer(),
    );
    const blobId = mintBlobId();
    const { body, hash } = await sealBlob(mk, blobId, plaintext);
    const hashB64 = toBase64Url(hash);

    expect((await putBlob(app, blobId, body, hashB64, DEVICE1)).status).toBe(201);
    // Idempotent re-PUT (deterministic sealing → identical body/hash).
    const reput = await sealBlob(mk, blobId, plaintext);
    expect([...reput.body]).toEqual([...body]);
    expect((await putBlob(app, blobId, reput.body, toBase64Url(reput.hash), DEVICE1)).status).toBe(
      200,
    );

    // Device 2 (same account) downloads and opens → byte-identical plaintext.
    const get = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      headers: { authorization: `Bearer ${DEVICE2}` },
    });
    expect(get.status).toBe(200);
    const pulledBody = new Uint8Array(await get.arrayBuffer());
    const opened = await openBlob(mk, blobId, pulledBody);
    expect([...opened]).toEqual([...plaintext]);

    // Listing shows the blob and the shared totals (floored charge).
    const list = (await (
      await app.request('/api/v1/sync/blobs', { headers: { authorization: `Bearer ${DEVICE1}` } })
    ).json()) as { blobs: unknown[]; totalBytes: number; quotaBytes: number };
    expect(list.blobs.length).toBe(1);
    expect(list.totalBytes).toBe(65536);
    expect(list.quotaBytes).toBe(200_000);

    // Push records until the SHARED quota trips (65536 used by the blob; a
    // ~140 KiB record would exceed the 200 KiB quota).
    const blindId = toBase64Url(new Uint8Array(16).fill(5));
    const ct = new Uint8Array(140_000).fill(1);
    const ch = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', ct)));
    const push = await app.request('/api/v1/sync/changes', {
      method: 'POST',
      headers: { authorization: `Bearer ${DEVICE1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        records: [
          {
            blindId,
            collection: 'messages',
            envelopeVersion: 1,
            baseRev: 0,
            deleted: false,
            nonce: toBase64Url(new Uint8Array(12)),
            ciphertext: toBase64Url(ct),
            ciphertextHash: ch,
          },
        ],
      }),
    });
    const pushBody = (await push.json()) as { results: { status: string; code?: string }[] };
    expect(pushBody.results[0]?.code).toBe('quota_exceeded');

    // Delete the blob → 204, GET → 404, listing freed.
    const del = await app.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${DEVICE1}` },
    });
    expect(del.status).toBe(204);
    expect(
      (
        await app.request(`/api/v1/sync/blobs/${blobId}`, {
          headers: { authorization: `Bearer ${DEVICE1}` },
        })
      ).status,
    ).toBe(404);
    const freed = (await (
      await app.request('/api/v1/sync/blobs', { headers: { authorization: `Bearer ${DEVICE1}` } })
    ).json()) as { totalBytes: number };
    expect(freed.totalBytes).toBe(0);
  });

  test('a deny-listed session is refused on PUT and GET within the same second', async () => {
    const app = build();
    await redis.set(revokedJtiKey('device-1'), '1');
    const blobId = mintBlobId();
    const { body, hash } = await sealBlob(mk, blobId, new Uint8Array(64).fill(3));
    expect((await putBlob(app, blobId, body, toBase64Url(hash), DEVICE1)).status).toBe(401);
    expect(
      (
        await app.request(`/api/v1/sync/blobs/${blobId}`, {
          headers: { authorization: `Bearer ${DEVICE1}` },
        })
      ).status,
    ).toBe(401);
  });
});
