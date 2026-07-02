// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mintBlobId, toBase64Url } from '@chatsundere/crypto';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import type { BlobBackend } from '../src/blobs/s3.js';
import { bootstrapBucket } from '../src/blobs/s3.js';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { renderMetrics } from '../src/metrics.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { createServer } from '../src/server.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

/** In-memory backend for the blob-cycle anonymity drive (no MinIO needed). */
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

// Distinctive identity tokens that must NOT appear in metrics or logs.
const ACCOUNT = '88888888-8888-8888-8888-888888888888';
const JTI = 'anon-session-marker';
const BLIND_FILL = 123;

let t: TestDb;
let redis: Redis;

beforeAll(async () => {
  t = await withTestDb();
  redis = new Redis(process.env.REDIS_URL as string);
  await redis.flushdb();
});
afterAll(async () => {
  await t.close();
  await redis.quit();
});

const verifyToken = async (token: string) => {
  if (token === 'BAD') return null;
  const [sub, jti] = token.split('|');
  return sub && jti ? { sub, jti, iat: 1000, exp: 9_999_999_999 } : null;
};

function app(allow: SyncDeps['allow']) {
  const a = new Hono();
  const deps: SyncDeps = {
    env: loadEnv(),
    db: t.db,
    redis,
    verifyToken,
    allow,
    epoch: 'epoch-anon',
    blobBackend: null,
  };
  registerServer(a, deps);
  return a;
}
function registerServer(a: Hono, deps: SyncDeps) {
  // Mirror createServer's wiring on a provided app for a focused test.
  const built = createServer(deps);
  a.route('/', built);
}

async function wire() {
  const blindId = toBase64Url(new Uint8Array(16).fill(BLIND_FILL));
  const ciphertext = new Uint8Array(64).fill(1);
  const hash = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext)));
  return {
    blindId,
    collection: 'chats',
    envelopeVersion: 1,
    baseRev: 0,
    deleted: false,
    nonce: toBase64Url(new Uint8Array(12)),
    ciphertext: toBase64Url(ciphertext),
    ciphertextHash: hash,
  };
}

describe('anonymity invariant', () => {
  test('no account/jti/blindId in metrics, no collection label', async () => {
    const allowing = app(createLimiter(redis));
    const token = `${ACCOUNT}|${JTI}`;
    // one full push
    await allowing.request('/api/v1/sync/changes', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ records: [await wire()] }),
    });
    // one pull
    await allowing.request('/api/v1/sync/changes?since=0', {
      headers: { authorization: `Bearer ${token}` },
    });
    // a 401
    await allowing.request('/api/v1/sync/changes?since=0', {
      headers: { authorization: 'Bearer BAD' },
    });
    // a 429
    await app(async () => false).request('/api/v1/sync/changes?since=0', {
      headers: { authorization: `Bearer ${token}` },
    });

    const { body } = await renderMetrics();
    expect(body).toContain('sync_push_records_total');
    expect(body).not.toContain(ACCOUNT);
    expect(body).not.toContain(JTI);
    expect(body).not.toContain(toBase64Url(new Uint8Array(16).fill(BLIND_FILL)));
    expect(body).not.toContain('collection="');
  });

  test('a full blob PUT/GET/DELETE cycle leaks no account or blob id into metrics', async () => {
    const backend = new MemBackend();
    const a = new Hono();
    const deps: SyncDeps = {
      env: loadEnv(),
      db: t.db,
      redis,
      verifyToken,
      allow: createLimiter(redis),
      epoch: 'epoch-anon',
      blobBackend: backend,
    };
    a.route('/', createServer(deps));
    const token = `${ACCOUNT}|${JTI}`;
    const blobId = mintBlobId();
    const bytes = new Uint8Array(64).fill(2);
    const hash = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    const auth = { authorization: `Bearer ${token}` };
    await a.request(`/api/v1/sync/blobs/${blobId}`, {
      method: 'PUT',
      headers: { ...auth, 'x-ciphertext-hash': hash, 'content-length': '64' },
      body: bytes,
    });
    await a.request(`/api/v1/sync/blobs/${blobId}`, { headers: auth });
    await a.request(`/api/v1/sync/blobs/${blobId}`, { method: 'DELETE', headers: auth });

    const { body } = await renderMetrics();
    expect(body).toContain('sync_blob_uploads_total');
    expect(body).toContain('sync_blob_downloads_total');
    expect(body).toContain('sync_blob_deletes_total');
    expect(body).not.toContain(ACCOUNT);
    expect(body).not.toContain(JTI);
    expect(body).not.toContain(blobId);
  });

  test('a failing S3 call logs neither the endpoint credentials nor the access-key id', async () => {
    // Point the backend at a closed port with distinctive credentials, trigger a
    // failure, capture every log string the bootstrap emits, and scan (spec §18 [L]).
    const SECRET = 'ANON-SECRET-KEY-MARKER';
    const KEYID = 'ANON-ACCESS-KEY-ID-MARKER';
    const env = loadEnv({
      DATABASE_URL: 'postgres://x/y',
      REDIS_URL: 'redis://x',
      AUTH_JWKS_URL: 'https://x/jwks',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_ACCESS_KEY_ID: KEYID,
      S3_SECRET_ACCESS_KEY: SECRET,
    });
    const logs: string[] = [];
    const ok = await bootstrapBucket(env, (_level, msg) => logs.push(msg));
    expect(ok).toBe(false);
    const joined = logs.join('\n');
    expect(joined).not.toContain(SECRET);
    expect(joined).not.toContain(KEYID);
  });
});
