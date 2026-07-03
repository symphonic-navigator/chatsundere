// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { MasterKey, SealedRecord } from '@chatsundere/crypto';
import { toBase64Url } from '@chatsundere/crypto';
import type {
  SyncCollection,
  SyncPullResponse,
  SyncPulledRecord,
  SyncPushRecord,
  SyncPushResponse,
  SyncPushResult,
} from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import Dexie from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtefactRow, PersonaAvatarRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetApplyForTests,
  _setApplyBlobHooks,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
} from '../../src/sync/apply.js';
import {
  _resetBlobFetchForTests,
  _setBlobFetchDeps,
  fetchRowBlob,
  resolveBlobBytes,
} from '../../src/sync/blob-fetch.js';
import { _resetBlobRepairForTests } from '../../src/sync/blob-repair.js';
import { BlobCorruptBodyError, getBlob } from '../../src/sync/blob-transport.js';
import {
  _resetRecoveryForTests,
  _setRecoveryBlobDeps,
  _setRecoveryPull,
  _setRecoverySleep,
  isEnginePaused,
  runRecovery,
} from '../../src/sync/recovery.js';
import { getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setBlobTransport,
  _setCryptoDeps,
  _setOpenRecord,
  _setPullTransport,
  _setPushTransport,
  drainOutbox,
  runPullLoop,
} from '../../src/sync/worker.js';

/**
 * WS-D Task 9 — adversarial blob integration scenarios (spec §13). These drive
 * the BUILT blob engine (`blob-transport`, `blob-transform`, `worker` drain
 * phases, `apply`, `blob-repair`, `blob-fetch`, `recovery`) end-to-end against a
 * scripted in-memory server: a rev-numbered record log (record channel) plus a
 * blob store served through a mocked `fetch`, so the REAL `blob-transport`
 * (the §6 size gate, the `x-ciphertext-hash` header, the verdict mapping) runs
 * unaltered. The store MISBEHAVES via knobs — corrupt-body-on-GET, oversized
 * stream, dropped blob, lying inventory, 409/413/507 verdicts. A scenario failing
 * here is a real engine bug, fixed in the owning module (spec §13's rule).
 *
 * Node's global `Blob`/`Response` (this file runs in the node env) survive
 * fake-indexeddb's structuredClone with real bytes and expose `arrayBuffer()` /
 * a readable `body` — jsdom's do not, hence the env, mirroring blob-drain.test.ts.
 */

// ===== Fake record codec (shared by both devices; deterministic, key-free) =====

const enc = new TextEncoder();
const dec = new TextDecoder();
const MK = {} as MasterKey;

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
}

/** Deterministic blind id for a (collection, key) — matches every engine seam. */
function blindIdBytes(collection: string, key: string): Uint8Array {
  return enc.encode(`bid:${collection}:${key}`);
}

/** Seal a record: JSON ciphertext whose `ciphertextHash` is the true SHA-256 (§7.0). */
async function sealRecordFake(
  _mk: MasterKey,
  collection: string,
  key: string,
  row: unknown,
): Promise<SealedRecord> {
  const ciphertext = enc.encode(JSON.stringify(row));
  return {
    blindId: blindIdBytes(collection, key),
    envelopeVersion: 1,
    nonce: new Uint8Array([0]),
    ciphertext,
    ciphertextHash: await sha256Bytes(ciphertext),
  };
}

/** Open a sealed record: JSON-decode, then re-check the blind id via extractKey. */
async function openRecordFake(
  _mk: MasterKey,
  collection: string,
  blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  extractKey: (row: unknown) => string,
): Promise<unknown> {
  let row: unknown;
  try {
    row = JSON.parse(dec.decode(sealed.ciphertext));
  } catch {
    throw new Error('codec failure (undecryptable)');
  }
  const rederived = toBase64Url(blindIdBytes(collection, extractKey(row)));
  if (rederived !== toBase64Url(blindId)) throw new Error('blind-id re-check mismatch');
  return row;
}

// ===== Fake blob codec (deterministic seal/open; corruption is detectable) =====

/** Deterministic blob seal: body = `blob:<id>|` || plaintext; hash = SHA-256(body). */
async function sealBlobFake(
  _mk: MasterKey,
  blobId: string,
  bytes: Uint8Array,
): Promise<{ body: Uint8Array; hash: Uint8Array }> {
  const tag = enc.encode(`blob:${blobId}|`);
  const body = new Uint8Array(tag.length + bytes.length);
  body.set(tag, 0);
  body.set(bytes, tag.length);
  return { body, hash: await sha256Bytes(body) };
}

/** Deterministic blob open: verify the id tag; a foreign/garbage body throws (corrupt). */
async function openBlobFake(_mk: MasterKey, blobId: string, body: Uint8Array): Promise<Uint8Array> {
  const tag = enc.encode(`blob:${blobId}|`);
  const prefix = body.slice(0, tag.length);
  if (dec.decode(prefix) !== dec.decode(tag)) {
    throw new Error('blob AEAD verification failed (foreign/corrupt body)');
  }
  return body.slice(tag.length);
}

/** A 22-char base64url blob id (the transport's `BLOB_ID_RE`). */
function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

// ===== The scripted record log (a trimmed rev-numbered per-account log) =====

interface StoredRecord {
  blindId: string;
  collection: SyncCollection;
  rev: number;
  deleted: boolean;
  nonce?: string;
  ciphertext?: string;
  ciphertextHash?: string;
}

/** POST /changes (CAS per record, monotone revs) + GET /changes?since&limit. */
class RecordServer {
  private readonly log = new Map<string, StoredRecord>();
  private revCounter = 0;
  epoch = 'E1';

  push(records: SyncPushRecord[]): SyncPushResponse {
    const results: SyncPushResult[] = [];
    for (const rec of records) {
      const cur = this.log.get(rec.blindId);
      const curRev = cur?.rev ?? 0;
      if (rec.baseRev !== curRev) {
        const current = cur
          ? this.toPulled(cur)
          : { blindId: rec.blindId, collection: rec.collection, rev: curRev, deleted: true };
        results.push({ status: 'conflict', current });
        continue;
      }
      const rev = ++this.revCounter;
      this.log.set(rec.blindId, {
        blindId: rec.blindId,
        collection: rec.collection,
        rev,
        deleted: rec.deleted,
        nonce: rec.nonce,
        ciphertext: rec.ciphertext,
        ciphertextHash: rec.ciphertextHash,
      });
      results.push({ status: 'ok', rev });
    }
    return { head: this.revCounter, epoch: this.epoch, results };
  }

  pull(since: number, limit: number): SyncPullResponse {
    const live = [...this.log.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
    const more = live.length > limit;
    return {
      head: this.revCounter,
      epoch: this.epoch,
      more,
      records: live.slice(0, limit).map((r) => this.toPulled(r)),
    };
  }

  private toPulled(r: StoredRecord): SyncPulledRecord {
    if (r.deleted)
      return { blindId: r.blindId, collection: r.collection, rev: r.rev, deleted: true };
    return {
      blindId: r.blindId,
      collection: r.collection,
      envelopeVersion: 1,
      rev: r.rev,
      deleted: false,
      nonce: r.nonce,
      ciphertext: r.ciphertext,
      ciphertextHash: r.ciphertextHash,
    };
  }
}

// ===== The scripted blob store (served through a mocked `fetch`) =====

/** A typed blob error envelope in the shape `readBlobError` decodes. */
function errResponse(
  status: number,
  error: {
    code: string;
    message: string;
    maxBlobBytes?: number;
    usedBytes?: number;
    quotaBytes?: number;
  },
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function bodyToBytes(body: BodyInit | null | undefined): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(0);
}

/** A 200 response carrying raw bytes (wrapped in a `Blob` for a portable BodyInit). */
function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(new Blob([bytes as BlobPart]), { status });
}

/**
 * In-memory blob store backing `<syncUrl>/api/v1/sync/blobs`. Its `handle` is
 * installed as the global `fetch`, so the REAL `blob-transport` drives it. Knobs
 * make it misbehave: a chosen PUT verdict, corrupt/oversize/dropped GETs, and a
 * lying LIST. Every op is logged for assertions.
 */
class BlobServer {
  readonly store = new Map<string, { body: Uint8Array; hash: string }>();
  readonly ops: string[] = [];
  /** The PUT verdict per blobId (201 store, 200 idempotent, 409/413/507/501). */
  putStatusFor: (blobId: string) => number = () => 201;
  maxBlobBytes = 1024;
  usedBytes = 0;
  quotaBytes = 0;
  /** GET returns a body sealed under a FOREIGN id → `openBlob` fails (§7.2). */
  readonly corruptGetIds = new Set<string>();
  /** GET streams MORE bytes than the ref → the §6 size gate aborts. */
  readonly oversizeGetIds = new Set<string>();
  /** GET 404 (a dangling ref, §7.1). */
  readonly droppedIds = new Set<string>();
  /** LIST lies: returns no blobs though the store holds them (forces re-upload). */
  inventoryOmitsAll = false;

  seed(blobId: string, body: Uint8Array): void {
    this.store.set(blobId, { body, hash: 'seed' });
  }

  handle = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const blobId = path.match(/\/blobs\/([^/]+)$/)?.[1];

    if (method === 'PUT' && blobId) return Promise.resolve(this.put(blobId, init));
    if (method === 'DELETE' && blobId) return Promise.resolve(this.delete(blobId));
    if (method === 'GET' && blobId) return Promise.resolve(this.get(blobId));
    if (method === 'GET') return Promise.resolve(this.list());
    return Promise.resolve(new Response('unhandled', { status: 500 }));
  };

  private put(blobId: string, init: RequestInit | undefined): Response {
    this.ops.push(`put:${blobId}`);
    const status = this.putStatusFor(blobId);
    if (status === 409) return errResponse(409, { code: 'blob_exists', message: 'divergent body' });
    if (status === 413)
      return errResponse(413, {
        code: 'blob_too_large',
        message: 'too large',
        maxBlobBytes: this.maxBlobBytes,
      });
    if (status === 507)
      return errResponse(507, {
        code: 'quota_exceeded',
        message: 'full',
        usedBytes: this.usedBytes,
        quotaBytes: this.quotaBytes,
      });
    if (status === 501) return errResponse(501, { code: 'blobs_disabled', message: 'disabled' });
    // §11.2: the hash is the caller's LOCAL seal output on the wire header.
    const hash = headerOf(init, 'x-ciphertext-hash') ?? '';
    this.store.set(blobId, { body: bodyToBytes(init?.body), hash });
    return new Response(null, { status });
  }

  private get(blobId: string): Response {
    this.ops.push(`get:${blobId}`);
    const stored = this.store.get(blobId);
    if (this.droppedIds.has(blobId) || !stored) {
      return errResponse(404, { code: 'not_found', message: 'missing' });
    }
    if (this.corruptGetIds.has(blobId)) {
      // A body sealed under a foreign id — `openBlob` fails closed (§7.2).
      return bytesResponse(enc.encode(`blob:${id22('foreign')}|garbage bytes`));
    }
    if (this.oversizeGetIds.has(blobId)) {
      const padded = new Uint8Array(stored.body.length + 64);
      padded.set(stored.body, 0); // more bytes than the ref → the §6 gate aborts
      return bytesResponse(padded);
    }
    return bytesResponse(stored.body);
  }

  private delete(blobId: string): Response {
    this.ops.push(`delete:${blobId}`);
    this.store.delete(blobId);
    return new Response(null, { status: 204 });
  }

  private list(): Response {
    this.ops.push('list');
    const blobs = this.inventoryOmitsAll
      ? []
      : [...this.store.entries()].map(([blobId, v]) => ({ blobId, bytes: v.body.length }));
    const totalBytes = blobs.reduce((sum, b) => sum + b.bytes, 0);
    return new Response(JSON.stringify({ blobs, totalBytes, quotaBytes: this.quotaBytes }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  putCount(): number {
    return this.ops.filter((o) => o.startsWith('put:')).length;
  }
}

// ===== Device abstraction (a separate Dexie per logical device) =====

class Device {
  readonly factory = new IDBFactory();

  /** Make this device's Dexie the live one; re-seed the global WS-0 stores + MK. */
  async activate(): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: swap Dexie's fake factory to this device's.
    Dexie.dependencies.indexedDB = this.factory as any;
    // biome-ignore lint/suspicious/noExplicitAny: swap the global fake factory to match.
    (globalThis as any).indexedDB = this.factory;
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    seedLinkedOnline();
  }
}

// ===== Seeding + wiring =====

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial discovery-config shape for the test.
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: MK as never });
}

/** Point the record channel at the scripted log + the fake codec (blob channel is fetch). */
function wireRecordChannel(server: RecordServer): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, c, k) => blindIdBytes(c, k),
    sealRecord: sealRecordFake,
  });
  _setOpenRecord(openRecordFake);
  _setApplyOpenRecord(openRecordFake);
  _setApplyComputeBlindId(async (_mk, c, k) => blindIdBytes(c, k));
  _setPushTransport(async (records) => server.push(records));
  _setPullTransport(async (since, limit) => server.pull(since, limit));
  // Keep the pull-side blob hooks inert so a two-device pull cannot trip a real
  // crypto seal (proactive heal) — the scenarios drive fetch/repair explicitly.
  _setApplyBlobHooks({ proactiveHeal: async () => undefined });
}

/** Wire the drain's blob seal to the fake codec; put/delete stay REAL → mocked fetch. */
function wireBlobSeal(): void {
  _setBlobTransport({ sealBlob: sealBlobFake });
}

async function enqueueBlobPut(
  collection: SyncCollection,
  key: string,
  blobId: string,
): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    collection,
    key,
    op: 'blob-put',
    blobId,
    enqueuedAt: Date.now(),
  });
}
async function enqueueBlobDelete(
  collection: SyncCollection,
  key: string,
  blobId: string,
): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    collection,
    key,
    op: 'blob-delete',
    blobId,
    enqueuedAt: Date.now(),
  });
}
async function enqueueRecord(
  collection: SyncCollection,
  key: string,
  op: 'upsert' | 'delete',
): Promise<void> {
  await getClientDataDb().syncOutbox.add({ collection, key, op, enqueuedAt: Date.now() });
}

// ===== Lifecycle =====

const realFetch = globalThis.fetch;
let blobs: BlobServer;
let records: RecordServer;

beforeEach(async () => {
  blobs = new BlobServer();
  records = new RecordServer();
  globalThis.fetch = blobs.handle as typeof globalThis.fetch;
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _resetWorkerForTests();
  _resetApplyForTests();
  _resetRecoveryForTests();
  _resetBlobRepairForTests();
  _resetBlobFetchForTests();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  _resetWorkerForTests();
  _resetApplyForTests();
  _resetRecoveryForTests();
  _resetBlobRepairForTests();
  _resetBlobFetchForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== Scenario 1 — corrupt-body churn hits the repair cap and stops (§7.2/§13) =====

describe('Scenario 1 — a 409-churning server hits the repair cap and stops uploading', () => {
  it('reaches a permanent placeholder + persistent tamper without an unbounded upload loop', async () => {
    wireBlobSeal();
    const OLD = id22('churn');
    const db = getClientDataDb();
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blob: new Blob(['original image bytes']),
      blobRef: { blobId: OLD, bytes: 40 },
    } as never);
    await enqueueBlobPut('artefacts', 'a1', OLD);
    // Every PUT — the original id AND every fresh-id repair — is 409 blob_exists:
    // cryptographic evidence of a divergent stored body (a malicious server).
    blobs.putStatusFor = () => 409;

    // Drain repeatedly. The fresh-id repair mints + PUTs a new id each cycle under
    // the §7.2 cap; after 3 failed generations the logical blob goes terminal and
    // its outbox entry is dropped — the churn STOPS.
    for (let i = 0; i < 3; i++) await drainOutbox();
    const putsAfterCap = blobs.putCount();
    // Further cycles must not upload anything more (no infinite multi-MiB loop).
    for (let i = 0; i < 3; i++) await drainOutbox();

    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
    expect(await db.syncOutbox.count()).toBe(0); // entry dropped at the cap — no churn
    expect(blobs.putCount()).toBe(putsAfterCap); // upload count frozen after the cap
    // Bounded: the original id + at most one fresh-id PUT per generation.
    expect(putsAfterCap).toBeLessThanOrEqual(1 + 2 * 3);
  });
});

// ===== Scenario 2 — replace-vs-edit LWW race: old blob survives a conflict (M-2) =====

describe('Scenario 2 — a replaced avatar blob is NOT deleted when the record loses LWW', () => {
  it('suppresses the deferred old-id delete on a record conflict (never delete under a live ref)', async () => {
    wireBlobSeal();
    const OLD = id22('avOld');
    const NEW = id22('avNew');
    const db = getClientDataDb();
    // The old blob is live server-side; the persona already synced once (rev 1).
    blobs.seed(OLD, enc.encode('old avatar sealed body'));
    await db.personaAvatars.put({
      personaId: 'p1',
      blob: new Blob(['new avatar bytes']),
      mime: 'image/jpeg',
      width: 1,
      height: 1,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: 2000,
      blobRef: { blobId: NEW, bytes: 32 },
    } as never);
    await db.syncRows.put({ collection: 'personaAvatars', key: 'p1', rev: 1, ciphertextHash: 'h' });
    await enqueueBlobPut('personaAvatars', 'p1', NEW); // upload the replacement bytes
    await enqueueRecord('personaAvatars', 'p1', 'upsert');
    await enqueueBlobDelete('personaAvatars', 'p1', OLD); // deferred replaced-id delete

    wireRecordChannel(records);
    // The server rejects the record upsert: this device LOST last-writer-wins.
    _setOpenRecord(async () => ({ personaId: 'p1' })); // current decrypts → a real conflict
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [
        {
          status: 'conflict',
          current: {
            blindId: toBase64Url(blindIdBytes('personaAvatars', 'p1')),
            collection: 'personaAvatars',
            rev: 9,
            deleted: false,
            nonce: toBase64Url(new Uint8Array([1])),
            ciphertext: toBase64Url(new Uint8Array([2, 3])),
          },
        },
      ],
    }));

    await drainOutbox();

    // The NEW blob was uploaded (phase 1); the OLD blob survives — the deferred
    // delete is suppressed under a possibly-winning old ref (Larissa M-2).
    expect(blobs.store.has(NEW)).toBe(true);
    expect(blobs.store.has(OLD)).toBe(true);
    expect(blobs.ops).not.toContain(`delete:${OLD}`);
    // The blob-delete entry stays queued for a later cycle once the record acks ok.
    const rows = await db.syncOutbox.toArray();
    expect(rows.some((r) => r.op === 'blob-delete' && r.blobId === OLD)).toBe(true);
  });
});

// ===== Scenario 3 — an oversized stream is aborted at the §6 gate (M-3/§7.2) =====

describe('Scenario 3 — an over-ref-size GET is aborted at the size gate, never a partial write', () => {
  it('aborts in the transport and routes to capped repair without mutating the record', async () => {
    const SG = id22('sized');
    const db = getClientDataDb();
    // Seal honest bytes, seed them, and set the ref to the exact sealed size.
    const sealed = await sealBlobFake(MK, SG, enc.encode('the honest image'));
    blobs.seed(SG, sealed.body);
    blobs.oversizeGetIds.add(SG); // the server streams MORE than the ref promises
    const ref = { blobId: SG, bytes: sealed.body.length };
    await db.artefacts.put({ id: 'a1', title: 'Pic', blobRef: ref } as never);

    // The REAL transport gate counts the stream and aborts as a corrupt body (§6).
    await expect(getBlob(ref)).rejects.toBeInstanceOf(BlobCorruptBodyError);

    // Through the fetch layer: the abort routes to §7.2 (no local bytes → a
    // retriable placeholder), and NOTHING is written onto the row.
    _setBlobFetchDeps({ openBlob: openBlobFake, getMk: () => MK });
    const result = await fetchRowBlob('artefacts', 'a1', 'blob', ref);
    expect(result.state).toBe('placeholder');

    const row = await db.artefacts.get('a1');
    expect(row?.blob).toBeUndefined(); // no partial write
    expect(row?.blobRef).toEqual(ref); // the record was NOT mutated
    expect(row?.blobOversized).toBeUndefined();
    // A corrupt body is server misbehaviour → the tamper attention was raised.
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });
});

// ===== Scenario 4 — 413 sentinel round-trip: A sets, B suppresses fetch (§7.3/§4) =====

describe('Scenario 4 — a 413 oversize sentinel travels A→B and suppresses the remote fetch', () => {
  it('A sets the durable sentinel; B pulls it and renders terminal without ever fetching', async () => {
    const A = new Device();
    const B = new Device();
    const OV = id22('big');

    // Device A: an artefact whose original blob the server rejects as too large.
    await A.activate();
    wireBlobSeal();
    wireRecordChannel(records);
    blobs.putStatusFor = (id) => (id === OV ? 413 : 201);
    const dbA = getClientDataDb();
    await dbA.artefacts.put({
      id: 'a1',
      chatId: 'c1',
      title: 'Huge',
      blob: new Blob(['enormous original']),
      blobRef: { blobId: OV, bytes: 40 },
    } as never);
    await enqueueBlobPut('artefacts', 'a1', OV);

    // First drain: the 413 sets the sentinel + enqueues the record upsert; the
    // second carries that upsert (now sentinel-bearing) to the server.
    await drainOutbox();
    await drainOutbox();
    expect((await dbA.artefacts.get('a1'))?.blobOversized).toBe(true);
    expect(blobs.store.has(OV)).toBe(false); // no server bytes — the record synced alone

    // Device B pulls the record. The sentinel rides inside the sealed row.
    await B.activate();
    wireRecordChannel(records);
    await runPullLoop();
    const dbB = getClientDataDb();
    const rowB = await dbB.artefacts.get('a1');
    expect(rowB?.blobOversized).toBe(true);
    expect(rowB?.blob).toBeUndefined(); // terminal placeholder, not hydrated

    // B suppresses the fetch: the resolver is terminal and never issued a GET.
    const state = await resolveBlobBytes('artefacts', 'a1', 'blob');
    expect(state.kind).toBe('terminal');
    expect(blobs.ops.some((o) => o.startsWith(`get:${OV}`))).toBe(false);
  });
});

// ===== Scenario 5 — a lying inventory is bounded by the recovery rate limit (§8/L-5) =====

describe('Scenario 5 — a lying blob inventory cannot drive an unbounded re-upload loop', () => {
  it('re-uploads under the recovery rate limit, then the engine halts (M-4 flap-stop)', async () => {
    const db = getClientDataDb();
    await db.artefacts.put({
      id: 'a1',
      title: 'One',
      blob: new Blob(['image one bytes']),
      blobRef: { blobId: id22('inv1'), bytes: 24 },
    } as never);
    await db.artefacts.put({
      id: 'a2',
      title: 'Two',
      blob: new Blob(['image two bytes']),
      blobRef: { blobId: id22('inv2'), bytes: 24 },
    } as never);

    wireRecordChannel(records); // the drain's settings-singleton repush seals via the fake codec
    _setRecoveryPull(async () => ({ head: 0, epoch: 'E2', more: false, records: [] }));
    _setRecoverySleep(async () => undefined);
    // The inventory LIES on every recovery — it always claims to hold nothing,
    // forcing a full re-upload each cycle.
    const reuploads: string[] = [];
    _setRecoveryBlobDeps({
      listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 0 }),
      putBlob: async (blobId) => {
        reuploads.push(blobId);
        return { status: 'created' };
      },
      sealBlob: sealBlobFake,
    });

    await runRecovery(); // round 1 — re-uploads both
    await runRecovery(); // round 2 — re-uploads both again
    const afterTwo = reuploads.length;
    await runRecovery(); // round 3 within the hour — the flap-stop trips FIRST

    expect(afterTwo).toBe(4); // two full re-upload rounds, bounded — not unbounded
    expect(reuploads.length).toBe(afterTwo); // round 3 uploaded nothing (engine paused)
    expect(isEnginePaused()).toBe(true);
    expect((await getSyncState()).attention).toEqual({ kind: 'recovery_paused' });
  });

  it('asks before uploading above the per-recovery re-upload threshold (§8)', async () => {
    const db = getClientDataDb();
    await db.artefacts.put({
      id: 'a1',
      title: 'One',
      blob: new Blob(['some image bytes over the tiny threshold']),
      blobRef: { blobId: id22('thr1'), bytes: 60 },
    } as never);

    wireRecordChannel(records); // the drain's settings-singleton repush seals via the fake codec
    _setRecoveryPull(async () => ({ head: 0, epoch: 'E2', more: false, records: [] }));
    _setRecoverySleep(async () => undefined);
    const reuploads: string[] = [];
    _setRecoveryBlobDeps(
      {
        listBlobs: async () => ({ blobs: [], totalBytes: 0, quotaBytes: 0 }),
        putBlob: async (blobId) => {
          reuploads.push(blobId);
          return { status: 'created' };
        },
        sealBlob: sealBlobFake,
      },
      1, // a 1-byte threshold: any real image is "large" and must be confirmed first
    );

    await runRecovery();

    expect(reuploads).toHaveLength(0); // it asked first — uploaded nothing
    expect((await getSyncState()).attention).toMatchObject({ kind: 'blob_reupload_threshold' });
  });
});
