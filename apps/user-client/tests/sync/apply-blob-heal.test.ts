// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection, SyncPulledRecord } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';

/**
 * HIGH-1 regression — irreversible blob-byte loss on a cross-device restore
 * de-dup. Runs in the NODE environment (like `blob-drain.test.ts`): jsdom's
 * `Blob` does not survive an IndexedDB structured-clone round-trip, which the
 * heal path reads across, so the byte assertions need Node's real `Blob`.
 */

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

function pulledUpsert(
  collection: string,
  key: string,
  ciphertext: Uint8Array,
  rev: number,
): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(ciphertext),
  };
}

/** openRecord seam returning the given plaintext row (its `id` is the sync key). */
function openReturns(row: unknown): void {
  _setApplyOpenRecord(async () => row);
}

/** A trash snapshot for a blob-bearing row that still holds its full-res bytes. */
function blobTrashSnapshot(
  collection: SyncCollection,
  key: string,
  blobId: string,
  bytes: Blob,
): Record<string, unknown> {
  const now = Date.now();
  return {
    id: `${collection}:${key}`,
    collection,
    key,
    row: {
      id: key,
      blob: bytes,
      blobRef: { blobId, bytes: bytes.size + 28 },
      updatedAt: 1,
    },
    deletedAt: now,
    purgeAt: now + 1000,
    entityKind: 'chatChild',
    rootGroup: `${collection}:${key}`,
    parentRef: null,
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
});

afterEach(async () => {
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('applyUpsert — HIGH-1 blob-byte preservation on cross-device restore', () => {
  it('heals the placeholder live row from the snapshot and enqueues a repair blob-put before retiring', async () => {
    const db = getClientDataDb();
    const originals = new Blob([new Uint8Array([9, 8, 7, 6, 5])]);
    // Device A's trash snapshot is the LAST copy of the full-res bytes (its live
    // row is gone, its drain deleted the server blob, peer B holds only thumbs).
    await db.trash.put(blobTrashSnapshot('attachments', 'a1', 'X', originals) as never);
    // B's restore lands under a fresh id, carries the SAME blobId X, no bytes.
    openReturns({
      id: 'a2',
      blobRef: { blobId: 'X', bytes: originals.size + 28 },
      updatedAt: 9,
      restoredFrom: 'a1',
    });

    const outcome = await applyRecord(pulledUpsert('attachments', 'a2', new Uint8Array([2]), 5));

    expect(outcome).toEqual({ kind: 'inserted' });
    // The live row now holds the healed bytes (not a bytes-less placeholder).
    const live = (await db.attachments.get('a2')) as { blob?: Blob };
    expect(live.blob).toBeInstanceOf(Blob);
    expect(live.blob?.size).toBe(originals.size);
    // A repair blob-put is enqueued under the SAME blobId for the new row key.
    const outbox = await db.syncOutbox
      .where('[collection+key]')
      .equals(['attachments', 'a2'])
      .toArray();
    const put = outbox.find((e) => e.op === 'blob-put');
    expect(put?.blobId).toBe('X');
    // The retire still happens — the stale snapshot is gone.
    expect(await db.trash.get('attachments:a1')).toBeUndefined();
  });

  it('does not clobber or re-put when the live row already holds bytes (single-device restore)', async () => {
    const db = getClientDataDb();
    const liveBytes = new Blob([new Uint8Array([1, 1, 1])]);
    const snapshotBytes = new Blob([new Uint8Array([2, 2, 2, 2])]);
    // A already holds the live row (with bytes) AND a stale snapshot from a prior
    // local delete — the guard must leave the live bytes untouched.
    await db.attachments.put({
      id: 'a2',
      blob: liveBytes,
      blobRef: { blobId: 'X', bytes: liveBytes.size + 28 },
      updatedAt: 5,
    } as never);
    await db.trash.put(blobTrashSnapshot('attachments', 'a1', 'X', snapshotBytes) as never);
    openReturns({
      id: 'a2',
      blobRef: { blobId: 'X', bytes: liveBytes.size + 28 },
      updatedAt: 9,
      restoredFrom: 'a1',
    });

    const outcome = await applyRecord(pulledUpsert('attachments', 'a2', new Uint8Array([4]), 5));

    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
    // The live bytes are unchanged — never overwritten by the (larger) snapshot bytes.
    const live = (await db.attachments.get('a2')) as { blob?: Blob };
    expect(live.blob).toBeInstanceOf(Blob);
    expect(live.blob?.size).toBe(liveBytes.size);
    // No repair blob-put — the live row already had bytes.
    const outbox = await db.syncOutbox
      .where('[collection+key]')
      .equals(['attachments', 'a2'])
      .toArray();
    expect(outbox.some((e) => e.op === 'blob-put')).toBe(false);
    // The retire still happens.
    expect(await db.trash.get('attachments:a1')).toBeUndefined();
  });
});
