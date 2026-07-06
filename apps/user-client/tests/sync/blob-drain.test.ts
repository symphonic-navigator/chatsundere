// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import { toBase64Url } from '@chatsundere/crypto';
import type { BlobRef, SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOutboxRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { _resetApplyForTests, _setApplyComputeBlindId, applyRecord } from '../../src/sync/apply.js';
import { _resetBlobRepairForTests } from '../../src/sync/blob-repair.js';
import type { PutBlobResult } from '../../src/sync/blob-transport.js';
import { getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setBlobTransport,
  _setCryptoDeps,
  _setOpenRecord,
  _setPushTransport,
  drainOutbox,
} from '../../src/sync/worker.js';

// Node's global `Blob` (this file runs in the node env) has a working
// `arrayBuffer()` and survives fake-indexeddb's structuredClone, so a stored
// blob round-trips with real bytes — unlike jsdom's Blob (mirrors the node-env
// discipline in tests/data/chatsundere-export.test.ts).

/** A 22-char base64url blob id (the transport's `BLOB_ID_RE`). */
function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

function fakeSealed(collection: string, key: string): SealedRecord {
  return {
    blindId: new TextEncoder().encode(`bid:${collection}:${key}`),
    envelopeVersion: 1,
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([9, 9]),
    ciphertextHash: new TextEncoder().encode(`hash:${collection}:${key}`),
  };
}

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key) => fakeSealed(collection, key),
  });
}

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

/** Call-order log shared by the seal/push/put/delete seams. */
let calls: string[] = [];

function installBlobTransport(overrides?: {
  putBlob?: (blobId: string) => Promise<PutBlobResult>;
  deleteBlob?: (blobId: string) => Promise<void>;
}): void {
  _setBlobTransport({
    sealBlob: async () => ({ body: new Uint8Array([1, 2, 3, 4]), hash: new Uint8Array([9]) }),
    putBlob: async (blobId) => {
      calls.push('put');
      return overrides?.putBlob ? overrides.putBlob(blobId) : { status: 'created' };
    },
    deleteBlob: async (blobId) => {
      calls.push('delete');
      if (overrides?.deleteBlob) await overrides.deleteBlob(blobId);
    },
  });
}

function pushLogging(
  response: SyncPushResponse,
): (r: SyncPushRecord[]) => Promise<SyncPushResponse> {
  return async () => {
    calls.push('push');
    return response;
  };
}

async function addBlobPut(collection: string, key: string, blobId: string): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed by callers
    collection: collection as any,
    key,
    op: 'blob-put',
    blobId,
    enqueuedAt: Date.now(),
  });
}

async function addBlobDelete(collection: string, key: string, blobId: string): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed by callers
    collection: collection as any,
    key,
    op: 'blob-delete',
    blobId,
    enqueuedAt: Date.now(),
  });
}

async function addRecord(collection: string, key: string, op: 'upsert' | 'delete'): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed by callers
    collection: collection as any,
    key,
    op,
    enqueuedAt: Date.now(),
  });
}

async function outbox(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}

function okResponse(revs: number[], head: number): SyncPushResponse {
  return { head, epoch: 'E1', results: revs.map((rev) => ({ status: 'ok', rev })) };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
  installBlobTransport();
  _resetBlobRepairForTests();
  calls = [];
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetApplyForTests();
  _resetBlobRepairForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('drain phase order (WS-D §5)', () => {
  it('runs blob-puts BEFORE the record push (a puller never sees an unseen blob)', async () => {
    const db = getClientDataDb();
    const B1 = id22('put1');
    const ref: BlobRef = { blobId: B1, bytes: 100 };
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blob: new Blob(['x']),
      blobRef: ref,
    } as never);
    await addBlobPut('artefacts', 'a1', B1);
    await addRecord('artefacts', 'a1', 'upsert');
    _setPushTransport(pushLogging(okResponse([5], 5)));

    await drainOutbox();

    expect(calls[0]).toBe('put');
    expect(calls).toContain('push');
    expect(calls.indexOf('put')).toBeLessThan(calls.indexOf('push'));
    expect(await outbox()).toHaveLength(0);
  });

  it('runs a cascade blob-delete AFTER the record tombstone push (delete last)', async () => {
    const db = getClientDataDb();
    const B1 = id22('del1');
    await db.syncRows.put({ collection: 'attachments', key: 'att1', rev: 2, ciphertextHash: 'h' });
    await addRecord('attachments', 'att1', 'delete');
    await addBlobDelete('attachments', 'att1', B1);
    _setPushTransport(pushLogging(okResponse([3], 3)));

    await drainOutbox();

    expect(calls).toEqual(['push', 'delete']);
    expect(await outbox()).toHaveLength(0);
  });
});

describe('replaced-id delete gating (Larissa M-2)', () => {
  it('performs the delete once the record upsert is acked ok', async () => {
    const db = getClientDataDb();
    const OLD = id22('old1');
    const NEW = id22('new1');
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blob: new Blob(['y']),
      blobRef: { blobId: NEW, bytes: 12 },
    } as never);
    await addRecord('artefacts', 'a1', 'upsert');
    await addBlobDelete('artefacts', 'a1', OLD);
    _setPushTransport(pushLogging(okResponse([7], 7)));

    await drainOutbox();

    expect(calls).toContain('delete');
    expect(await outbox()).toHaveLength(0);
  });

  it('SUPPRESSES the delete on a conflict ack (the old ref may still be live)', async () => {
    const db = getClientDataDb();
    const OLD = id22('old2');
    const NEW = id22('new2');
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blob: new Blob(['z']),
      blobRef: { blobId: NEW, bytes: 12 },
    } as never);
    await db.syncRows.put({ collection: 'artefacts', key: 'a1', rev: 1, ciphertextHash: 'old' });
    await addRecord('artefacts', 'a1', 'upsert');
    await addBlobDelete('artefacts', 'a1', OLD);
    _setOpenRecord(async () => ({ id: 'a1' })); // decryptable current → real conflict
    _setPushTransport(
      pushLogging({
        head: 0,
        epoch: 'E1',
        results: [
          {
            status: 'conflict',
            current: {
              blindId: toBase64Url(new TextEncoder().encode('bid:artefacts:a1')),
              collection: 'artefacts',
              rev: 9,
              deleted: false,
              nonce: toBase64Url(new Uint8Array([1])),
              ciphertext: toBase64Url(new Uint8Array([2, 3])),
            },
          },
        ],
      }),
    );

    await drainOutbox();

    expect(calls).not.toContain('delete'); // deferred — never delete under a losing ref
    const rows = await outbox();
    expect(rows.some((r) => r.op === 'blob-delete' && r.blobId === OLD)).toBe(true);
  });
});

describe('failed put blocks only its own record (WS-D §5)', () => {
  it('holds back the failing record but pushes the rest of the queue', async () => {
    const db = getClientDataDb();
    const B1 = id22('quo1');
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blob: new Blob(['q']),
      blobRef: { blobId: B1, bytes: 50 },
    } as never);
    await db.personas.put({ id: 'p2', name: 'Other', updatedAt: 1 } as never);
    await addBlobPut('artefacts', 'a1', B1);
    await addRecord('artefacts', 'a1', 'upsert');
    await addRecord('personas', 'p2', 'upsert');
    installBlobTransport({
      putBlob: async () => ({ status: 'quota_exceeded', usedBytes: 9, quotaBytes: 10 }),
    });

    const push = vi.fn(async (records: SyncPushRecord[]) =>
      okResponse(
        records.map(() => 3),
        3,
      ),
    );
    _setPushTransport(push);

    await drainOutbox();

    // Only p2 was pushed; a1 was blocked by its failed put.
    const sent = push.mock.calls[0]?.[0] as SyncPushRecord[];
    expect(sent).toHaveLength(1);
    expect(await db.syncRows.get(['personas', 'p2'])).toBeDefined();
    expect(await db.syncRows.get(['artefacts', 'a1'])).toBeUndefined();
    // a1's blob-put + record upsert both remain queued for a later cycle.
    const rows = await outbox();
    expect(rows.filter((r) => r.key === 'a1')).toHaveLength(2);
    expect((await getSyncState()).attention).toMatchObject({ kind: 'quota_exceeded' });
  });
});

describe('seal-time-minted blobs are healed + uploaded, not dropped (WS-D §5 Option A)', () => {
  it('holds the record back cycle 1 (heal + enqueue put), pushes it with a stable ref cycle 2', async () => {
    const db = getClientDataDb();
    // A local-only-era attachment restored after linking: bytes present, but NO
    // blobRef — the seal-time mint fallback fires (blob-transform.ts:211-216).
    await db.attachments.put({
      id: 'att1',
      chatId: 'c1',
      messageId: 'm1',
      blob: new Blob(['hello']),
    } as never);
    await db.syncRows.put({ collection: 'attachments', key: 'att1', rev: 4, ciphertextHash: 'h' });
    await addRecord('attachments', 'att1', 'upsert');

    const uploaded: string[] = [];
    installBlobTransport({
      putBlob: async (blobId) => {
        uploaded.push(blobId);
        return { status: 'created' };
      },
    });
    const push = vi.fn(async (records: SyncPushRecord[]) =>
      okResponse(
        records.map(() => 6),
        6,
      ),
    );
    _setPushTransport(push);

    // ===== Cycle 1: heal the live row + enqueue the put, DO NOT push =====
    await drainOutbox();

    expect(push).not.toHaveBeenCalled(); // record held back — its bytes are not up yet
    const healed = await db.attachments.get('att1');
    const ref = (healed as unknown as { blobRef?: BlobRef }).blobRef;
    expect(ref).toBeDefined();
    if (!ref) throw new Error('expected the heal to write a blobRef onto the live row');
    const mintedId = ref.blobId;
    const rows1 = await outbox();
    // The blob-put was enqueued for the minted id...
    expect(rows1.some((r) => r.op === 'blob-put' && r.blobId === mintedId)).toBe(true);
    // ...and the record upsert is still queued (it re-seals next cycle).
    expect(rows1.some((r) => r.op === 'upsert' && r.key === 'att1')).toBe(true);

    // ===== Cycle 2: upload the blob (phase 1) THEN push the record =====
    await drainOutbox();

    expect(uploaded).toContain(mintedId); // bytes uploaded BEFORE the record push (§11.5)
    expect(push).toHaveBeenCalledTimes(1);
    // The id is stable across cycles — no re-mint churn.
    const after = await db.attachments.get('att1');
    expect((after as unknown as { blobRef?: BlobRef }).blobRef?.blobId).toBe(mintedId);
    expect(await outbox()).toHaveLength(0);
  });
});

describe('coalescing + live-row-only reads (WS-D §5, Larissa L-1)', () => {
  it('cancels a blob-put + blob-delete for the same never-pushed blobId to nothing', async () => {
    const B1 = id22('coa1');
    await addBlobPut('artefacts', 'a1', B1);
    await addBlobDelete('artefacts', 'a1', B1);

    await drainOutbox();

    expect(calls).not.toContain('put');
    expect(calls).not.toContain('delete');
    expect(await outbox()).toHaveLength(0);
  });

  it('drops a blob-put whose bytes are gone locally (no trash-read upload path)', async () => {
    const B1 = id22('gone1');
    await addBlobPut('artefacts', 'missing', B1); // no live artefacts row

    await drainOutbox();

    expect(calls).not.toContain('put');
    expect(await outbox()).toHaveLength(0);
  });

  it('a pulled tombstone drops pending blob-puts transactionally with trash routing', async () => {
    const db = getClientDataDb();
    const B1 = id22('tomb1');
    _setApplyComputeBlindId(async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    );
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blob: new Blob(['t']),
      blobRef: { blobId: B1, bytes: 12 },
    } as never);
    await db.syncRows.put({ collection: 'artefacts', key: 'a1', rev: 1, ciphertextHash: 'h' });
    await addBlobPut('artefacts', 'a1', B1);

    await applyRecord({
      blindId: toBase64Url(new TextEncoder().encode('bid:artefacts:a1')),
      collection: 'artefacts',
      rev: 5,
      deleted: true,
    });

    // The blob-put is gone, the row is in trash WITH its bytes, syncRows cleared.
    expect(await outbox()).toHaveLength(0);
    expect(await db.artefacts.get('a1')).toBeUndefined();
    const trash = await db.trash.get('artefacts:a1');
    expect(trash).toBeDefined();
    expect(await db.syncRows.get(['artefacts', 'a1'])).toBeUndefined();
  });
});
