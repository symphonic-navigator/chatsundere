// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { openRecord, sealRecord, toBase64Url } from '@chatsundere/crypto';
import { asMasterKey } from '@chatsundere/crypto';
import type { SealedRecord } from '@chatsundere/crypto';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { getInstanceEpoch } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';
import type { SyncDeps } from '../src/http/deps.js';
import { createLimiter } from '../src/ratelimit/limiter.js';
import { registerChangesRoutes } from '../src/routes/changes.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

// Pins the record-channel behaviour of the three blob-bearing collections (blob
// spec §5.1/§11/§18). No production code — Task 2 admitted the collections; this
// asserts sealed rows carrying BlobRefs round-trip and the avatar cleared-state
// lifecycle never tombstones.

const mk = asMasterKey(new Uint8Array(32).fill(42));
const SUB = '99999999-9999-9999-9999-999999999999';
const byId = (row: unknown) =>
  (row as { id?: string; personaId?: string }).id ?? (row as { personaId: string }).personaId;

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

function app(): Hono {
  const a = new Hono();
  const deps: SyncDeps = {
    env: loadEnv(),
    db: t.db,
    redis,
    verifyToken,
    allow: createLimiter(redis),
    epoch,
    blobBackend: null,
  };
  registerChangesRoutes(a, deps);
  return a;
}

const b64 = (u: Uint8Array) => toBase64Url(u);
function toWire(sealed: SealedRecord, collection: string, baseRev: number) {
  return {
    blindId: b64(sealed.blindId),
    collection,
    envelopeVersion: 1,
    baseRev,
    deleted: false,
    nonce: b64(sealed.nonce),
    ciphertext: b64(sealed.ciphertext),
    ciphertextHash: b64(sealed.ciphertextHash),
  };
}

function post(a: Hono, records: unknown[]) {
  return a.request('/api/v1/sync/changes', {
    method: 'POST',
    headers: { authorization: `Bearer ${SUB}|s|1000`, 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  });
}

async function pullAll(a: Hono) {
  const res = await a.request('/api/v1/sync/changes?since=0&limit=200', {
    headers: { authorization: `Bearer ${SUB}|s|1000` },
  });
  return (await res.json()) as {
    records: {
      blindId: string;
      collection: string;
      rev: number;
      deleted: boolean;
      nonce?: string;
      ciphertext?: string;
    }[];
  };
}

describe('blob-collection record semantics', () => {
  test('an artefacts row with blobRef + thumbBlobRef round-trips, wire stays tiny', async () => {
    // A nominal 5 MiB original + 40 KiB thumbnail — but only the REFS travel.
    const row = {
      id: 'art-1',
      title: 'sunset',
      kind: 'image',
      mime: 'image/png',
      width: 2048,
      height: 1536,
      blobRef: { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 5 * 1024 * 1024 },
      thumbBlobRef: { blobId: 'BBBBBBBBBBBBBBBBBBBBBB', bytes: 40 * 1024 },
    };
    const sealed = await sealRecord(mk, 'artefacts', row.id, row);
    // The sealed ciphertext carries refs, not image bytes.
    expect(sealed.ciphertext.length).toBeLessThan(4096);
    const a = app();
    expect((await post(a, [toWire(sealed, 'artefacts', 0)])).status).toBe(200);
    const pulled = await pullAll(a);
    const rec = pulled.records.find((r) => r.collection === 'artefacts');
    expect(rec).toBeDefined();
    const opened = (await openRecord(
      mk,
      'artefacts',
      sealed.blindId,
      {
        nonce: Buffer.from(rec?.nonce ?? '', 'base64url'),
        ciphertext: Buffer.from(rec?.ciphertext ?? '', 'base64url'),
      },
      byId,
    )) as typeof row;
    expect(opened.blobRef.blobId).toBe(row.blobRef.blobId);
    expect(opened.thumbBlobRef.blobId).toBe(row.thumbBlobRef.blobId);
    expect(opened.blobRef.bytes).toBe(row.blobRef.bytes);
  });

  test('an attachments row keyed by id round-trips', async () => {
    const row = {
      id: 'att-1',
      messageId: 'm-1',
      mime: 'image/jpeg',
      blobRef: { blobId: 'CCCCCCCCCCCCCCCCCCCCCC', bytes: 1234 },
    };
    const sealed = await sealRecord(mk, 'attachments', row.id, row);
    const a = app();
    expect((await post(a, [toWire(sealed, 'attachments', 0)])).status).toBe(200);
    const pulled = await pullAll(a);
    expect(pulled.records.some((r) => r.collection === 'attachments')).toBe(true);
  });

  test('avatar lifecycle: set → cleared (blobRef: null, Class-2, NO tombstone) → set again', async () => {
    const a = app();
    const personaId = 'persona-xyz';
    // Insert with an avatar.
    const s1 = await sealRecord(mk, 'personaAvatars', personaId, {
      personaId,
      blobRef: { blobId: 'D1111111111111111111AA', bytes: 8192 },
      crop: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect((await post(a, [toWire(s1, 'personaAvatars', 0)])).status).toBe(200);

    // Cleared state: blobRef null — a plain Class-2 CAS update, NOT a tombstone.
    const s2 = await sealRecord(mk, 'personaAvatars', personaId, { personaId, blobRef: null });
    const r2 = await post(a, [toWire(s2, 'personaAvatars', 1)]);
    const b2 = (await r2.json()) as { results: { status: string; rev?: number }[] };
    expect(b2.results[0]?.status).toBe('ok');

    // The row is still live (not tombstoned): open it and see blobRef null.
    let pulled = await pullAll(a);
    let rec = pulled.records.find((r) => r.collection === 'personaAvatars');
    expect(rec?.deleted).toBe(false);
    const cleared = (await openRecord(
      mk,
      'personaAvatars',
      s2.blindId,
      {
        nonce: Buffer.from(rec?.nonce ?? '', 'base64url'),
        ciphertext: Buffer.from(rec?.ciphertext ?? '', 'base64url'),
      },
      byId,
    )) as { blobRef: unknown };
    expect(cleared.blobRef).toBeNull();

    // Set a new avatar — the key still works (no terminality trap).
    const s3 = await sealRecord(mk, 'personaAvatars', personaId, {
      personaId,
      blobRef: { blobId: 'D2222222222222222222AA', bytes: 9000 },
    });
    const r3 = await post(a, [toWire(s3, 'personaAvatars', 2)]);
    expect(((await r3.json()) as { results: { status: string }[] }).results[0]?.status).toBe('ok');
    pulled = await pullAll(a);
    rec = pulled.records.find((r) => r.collection === 'personaAvatars');
    expect(rec?.deleted).toBe(false);
    expect(rec?.rev).toBe(3);
  });

  test('a genuine tombstone (persona deletion) stays terminal for that blind_id', async () => {
    const a = app();
    const personaId = 'persona-doomed';
    const s1 = await sealRecord(mk, 'personaAvatars', personaId, {
      personaId,
      blobRef: { blobId: 'E1111111111111111111AA', bytes: 8192 },
    });
    await post(a, [toWire(s1, 'personaAvatars', 0)]);
    // Persona-deletion cascade: a real tombstone on the avatar's blind_id.
    const tombstone = {
      blindId: b64(s1.blindId),
      collection: 'personaAvatars',
      envelopeVersion: 1,
      baseRev: 1,
      deleted: true,
    };
    expect((await post(a, [tombstone])).status).toBe(200);
    // Any later non-delete write to the same blind_id is refused as tombstoned.
    const s2 = await sealRecord(mk, 'personaAvatars', personaId, {
      personaId,
      blobRef: { blobId: 'E2222222222222222222AA', bytes: 9000 },
    });
    const res = await post(a, [toWire(s2, 'personaAvatars', 0)]);
    const body = (await res.json()) as { results: { status: string }[] };
    expect(body.results[0]?.status).toBe('tombstoned');
  });
});
