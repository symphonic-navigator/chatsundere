// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection, SyncPullResponse, SyncPulledRecord } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  getInertRejectionCount,
  resetTombstoneCounter,
  setInvalidator,
} from '../../src/sync/apply.js';
import { advanceWatermark, getSyncState, setAttention } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setPullTransport, runPullLoop } from '../../src/sync/worker.js';

// ===== Fixtures =====

/** Deterministic fake blind id — mirrors the fake crypto the worker tests use. */
function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

/** The apply pipeline's own local SHA-256 → base64url of ciphertext bytes (§7.0). */
async function localHash(ciphertext: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', ciphertext as BufferSource);
  return toBase64Url(new Uint8Array(digest));
}

function pulledUpsert(
  collection: string,
  key: string,
  ciphertext: Uint8Array,
  rev: number,
  serverHash?: string,
): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(ciphertext),
    ...(serverHash !== undefined ? { ciphertextHash: serverHash } : {}),
  };
}

function pulledTombstone(collection: string, key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: true,
  };
}

/** openRecord seam that returns the given plaintext row (its `id` = the sync key). */
function openReturns(row: unknown): void {
  _setApplyOpenRecord(async () => row);
}

function installFakeBlindId(): void {
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
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

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeBlindId();
});

afterEach(async () => {
  _resetApplyForTests();
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== §7.0 echo shortcut =====

describe('applyRecord — §7.0 echo shortcut (Larissa L-2)', () => {
  it('adopts the rev without a data change when the LOCAL ciphertext hash matches', async () => {
    const db = getClientDataDb();
    const ct = new Uint8Array([10, 20, 30]);
    await db.personas.put({ id: 'p1', name: 'orig' } as never);
    await db.syncRows.put({
      collection: 'personas',
      key: 'p1',
      rev: 4,
      ciphertextHash: await localHash(ct),
    });
    openReturns({ id: 'p1', name: 'orig' });

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', ct, 9));

    expect(outcome).toEqual({ kind: 'echo' });
    expect((await db.personas.get('p1')) as { name: string }).toMatchObject({ name: 'orig' });
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(9); // rev adopted
  });

  it('does NOT treat a record as echo when only the SERVER hash matches', async () => {
    const db = getClientDataDb();
    const stored = new Uint8Array([1, 1, 1]); // what we sealed before
    const different = new Uint8Array([2, 2, 2]); // what the server now delivers
    const storedHash = await localHash(stored);
    await db.personas.put({ id: 'p1', updatedAt: 1 } as never);
    await db.syncRows.put({
      collection: 'personas',
      key: 'p1',
      rev: 1,
      ciphertextHash: storedHash,
    });
    openReturns({ id: 'p1', updatedAt: 99 });

    // Server echoes our stored hash but the actual bytes differ → must NOT short-circuit.
    const outcome = await applyRecord(pulledUpsert('personas', 'p1', different, 5, storedHash));

    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
    expect((await db.personas.get('p1')) as { updatedAt: number }).toMatchObject({ updatedAt: 99 });
  });
});

// ===== stale-rev guard =====

describe('applyRecord — stale-rev guard (M-7)', () => {
  it('ignores a pulled rev at or below the stored rev', async () => {
    const db = getClientDataDb();
    const ct = new Uint8Array([7, 7]);
    await db.personas.put({ id: 'p1', updatedAt: 5 } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 5, ciphertextHash: 'other' });
    openReturns({ id: 'p1', updatedAt: 9 });

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', ct, 3));

    expect(outcome).toEqual({ kind: 'stale' });
    expect((await db.personas.get('p1')) as { updatedAt: number }).toMatchObject({ updatedAt: 5 });
  });
});

// ===== §7.1 inert rejection =====

describe('applyRecord — §7.1 inert rejection (§12.3)', () => {
  it('rejects a GCM/codec failure without mutating local state, counter increments', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', updatedAt: 1 } as never);
    _setApplyOpenRecord(async () => {
      throw new Error('AEAD failure');
    });
    const before = getInertRejectionCount();

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([9]), 5));

    expect(outcome).toEqual({ kind: 'rejected' });
    expect(getInertRejectionCount()).toBe(before + 1);
    expect((await db.personas.get('p1')) as { updatedAt: number }).toMatchObject({ updatedAt: 1 });
    expect(await db.syncRows.get(['personas', 'p1'])).toBeUndefined();
  });

  it('a page with a rejected record still advances the watermark', async () => {
    _setApplyOpenRecord(async () => {
      throw new Error('poison');
    });
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 12,
        epoch: 'E1',
        more: false,
        records: [pulledUpsert('personas', 'p1', new Uint8Array([9]), 12)],
      }),
    );

    await runPullLoop();

    expect((await getSyncState()).watermarkRev).toBe(12);
  });
});

// ===== WS-D §3 — blob collections join the handled set =====

describe('applyRecord — blob-bearing collections apply (WS-D §3)', () => {
  it('inserts an attachments row (no longer inertly skipped)', async () => {
    const db = getClientDataDb();
    // The blob-bearing collections joined the handled set in WS-D: they apply
    // through the §4 transform rather than being skipped.
    openReturns({
      id: 'att1',
      chatId: 'c1',
      messageId: 'm1',
      updatedAt: 1,
      blobRef: { blobId: 'attAAAAAAAAAAAAAAAAAAA', bytes: 40 },
    });
    const outcome = await applyRecord(pulledUpsert('attachments', 'att1', new Uint8Array([1]), 3));
    expect(outcome).toEqual({ kind: 'inserted' });
    // The row landed in the placeholder state: ref present, bytes absent (§4/§6).
    const row = await db.attachments.get('att1');
    expect(row?.blobRef).toMatchObject({ blobId: 'attAAAAAAAAAAAAAAAAAAA' });
    expect(row?.blob).toBeUndefined();
  });
});

// ===== §7.3 tombstone =====

describe('applyRecord — §7.3 tombstone', () => {
  it('routes the row to trash and drops outbox + syncRows in one transaction', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'c1', title: 'gone', createdAt: 1, updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 2, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'chats', key: 'c1', op: 'upsert', enqueuedAt: 1 });

    const outcome = await applyRecord(pulledTombstone('chats', 'c1', 5));

    expect(outcome).toEqual({ kind: 'tombstoned' });
    expect(await db.chats.get('c1')).toBeUndefined();
    const trash = await db.trash.get('chats:c1');
    expect(trash?.collection).toBe('chats');
    expect(trash?.purgeAt).toBeGreaterThan(Date.now());
    expect(await db.syncRows.get(['chats', 'c1'])).toBeUndefined();
    const remaining = await db.syncOutbox
      .where('[collection+key]')
      .equals(['chats', 'c1'])
      .toArray();
    expect(remaining).toHaveLength(0);
  });

  it('is a no-op when no known local row matches the blind id', async () => {
    const outcome = await applyRecord(pulledTombstone('chats', 'unknown', 5));
    expect(outcome).toEqual({ kind: 'tombstoned' });
  });
});

// ===== §7.4 H-1 trash-anchored terminality =====

describe('applyRecord — §7.4 H-1 trash-anchored terminality (Larissa H-1, NON-NEGOTIABLE)', () => {
  it('rejects an upsert onto a live tombstone anchor, keeps trash, raises tamper', async () => {
    const db = getClientDataDb();
    // Step 1: a pulled tombstone moves the chat to trash and clears its syncRows.
    await db.chats.put({ id: 'c1', title: 'real', createdAt: 1, updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 2, ciphertextHash: 'h' });
    await applyRecord(pulledTombstone('chats', 'c1', 5));
    expect(await db.trash.get('chats:c1')).toBeDefined();

    // Step 2: the malicious server replays an upsert for the SAME (tombstoned) key.
    openReturns({ id: 'c1', title: 'resurrected', createdAt: 1, updatedAt: 9 });
    const outcome = await applyRecord(pulledUpsert('chats', 'c1', new Uint8Array([4, 4]), 6));

    expect(outcome).toEqual({ kind: 'tamper' });
    // The anchor stands: trash intact, no row resurrected, tamper attention raised.
    expect(await db.trash.get('chats:c1')).toBeDefined();
    expect(await db.chats.get('c1')).toBeUndefined();
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });
});

// ===== §7.4 L-3 pending-delete suppression =====

describe('applyRecord — §7.4 L-3 pending-delete suppression', () => {
  it('suppresses an insert when the outbox holds a pending delete for the key', async () => {
    const db = getClientDataDb();
    await db.syncOutbox.add({ collection: 'personas', key: 'p1', op: 'delete', enqueuedAt: 1 });
    openReturns({ id: 'p1', updatedAt: 9 });

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([1]), 5));

    expect(outcome).toEqual({ kind: 'suppressed' });
    expect(await db.personas.get('p1')).toBeUndefined();
  });
});

// ===== §7.3a threshold + panic pause =====

describe('applyRecord — §7.3a tombstone threshold + panic pause (Larissa M-2)', () => {
  it('raises the calm notice at the threshold', async () => {
    resetTombstoneCounter();
    for (let i = 0; i < 20; i++) {
      await applyRecord(pulledTombstone('chats', `x${i}`, 1));
    }
    expect((await getSyncState()).attention).toEqual({ kind: 'tombstone_threshold', count: 20 });
  });

  it('pauses tombstone application at the panic threshold but still applies upserts', async () => {
    const db = getClientDataDb();
    resetTombstoneCounter();
    let last = await applyRecord(pulledTombstone('chats', 'first', 1));
    for (let i = 1; i < 200; i++) {
      last = await applyRecord(pulledTombstone('chats', `x${i}`, 1));
    }
    expect(last).toEqual({ kind: 'tombstone-paused' });
    expect((await getSyncState()).attention).toEqual({ kind: 'tombstone_paused', count: 200 });

    // Upserts continue to apply during the pause.
    openReturns({ id: 'p1', updatedAt: 5 });
    const upsert = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([1]), 5));
    expect(upsert).toEqual({ kind: 'inserted' });
    expect(await db.personas.get('p1')).toBeDefined();
  });
});

// ===== §7.5 conflict resolution =====

describe('applyRecord — §7.5 conflict resolution', () => {
  it('applies the pulled row when it wins LWW', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', updatedAt: 1, name: 'old' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'stored' });
    openReturns({ id: 'p1', updatedAt: 9, name: 'new' });

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([5, 5]), 7));

    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
    expect((await db.personas.get('p1')) as { name: string }).toMatchObject({ name: 'new' });
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(7);
  });

  it('keeps the local row and enqueues a re-push when local wins', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', updatedAt: 9, name: 'local' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'stored' });
    openReturns({ id: 'p1', updatedAt: 1, name: 'old-remote' });

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([5, 5]), 7));

    expect(outcome).toEqual({ kind: 'resolved', winner: 'local' });
    expect((await db.personas.get('p1')) as { name: string }).toMatchObject({ name: 'local' });
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(7); // CAS base adopted
    const repush = await db.syncOutbox
      .where('[collection+key]')
      .equals(['personas', 'p1'])
      .toArray();
    expect(repush).toHaveLength(1);
    expect(repush[0]?.op).toBe('upsert');
  });

  it('inserts a pulled record with no local row', async () => {
    const db = getClientDataDb();
    openReturns({ id: 'p1', updatedAt: 5, name: 'fresh' });

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([3]), 4));

    expect(outcome).toEqual({ kind: 'inserted' });
    expect((await db.personas.get('p1')) as { name: string }).toMatchObject({ name: 'fresh' });
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(4);
  });
});

// ===== Pull loop (spec §6 pull, §7 apply) =====

describe('runPullLoop — watermark + page cap (spec §6, M-7)', () => {
  it('does NOT regress the watermark on a maliciously ordered page', async () => {
    await advanceWatermark(100);
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 100,
        epoch: 'E1',
        more: false,
        records: [pulledTombstone('chats', 'old', 5)], // rev 5 < watermark 100
      }),
    );

    await runPullLoop();

    expect((await getSyncState()).watermarkRev).toBe(100);
  });

  it('caps at 64 pages per cycle and continues on the next call', async () => {
    // Every page reports more:true with a single rev = since+1 (unknown-key
    // tombstone → applied inertly). The watermark rises one per page.
    const pull = vi.fn(
      async (since: number): Promise<SyncPullResponse> => ({
        head: 10_000,
        epoch: 'E1',
        more: true,
        records: [pulledTombstone('chats', `t${since}`, since + 1)],
      }),
    );
    _setPullTransport(pull);

    await runPullLoop();
    expect(pull).toHaveBeenCalledTimes(64);
    expect((await getSyncState()).watermarkRev).toBe(64);
    expect((await getSyncState()).pulling).toBeNull();

    await runPullLoop();
    expect(pull).toHaveBeenCalledTimes(128); // continued from rev 64
    expect((await getSyncState()).watermarkRev).toBe(128);
  });
});

describe('runPullLoop — §7.3a tombstone notice retires on a calm cycle (auto-clear)', () => {
  it('clears a latched tombstone notice on the next cycle that stays below the threshold', async () => {
    // Cycle 1: one page of 20 tombstones → the calm notice latches.
    const heavy = Array.from({ length: 20 }, (_v, i) => pulledTombstone('chats', `d${i}`, i + 1));
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 20,
        epoch: 'E1',
        more: false,
        records: heavy,
      }),
    );
    await runPullLoop();
    expect((await getSyncState()).attention).toEqual({ kind: 'tombstone_threshold', count: 20 });

    // Cycle 2: a calm pull (no tombstones) → the stale notice retires.
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 21,
        epoch: 'E1',
        more: false,
        records: [],
      }),
    );
    await runPullLoop();
    expect((await getSyncState()).attention).toBeNull();
  });

  it('keeps the notice while consecutive cycles re-cross the threshold', async () => {
    _setPullTransport(
      async (since: number): Promise<SyncPullResponse> => ({
        head: 10_000,
        epoch: 'E1',
        more: false,
        records: Array.from({ length: 20 }, (_v, i) =>
          pulledTombstone('chats', `d${since}-${i}`, since + i + 1),
        ),
      }),
    );
    await runPullLoop();
    expect((await getSyncState()).attention).toEqual({ kind: 'tombstone_threshold', count: 20 });
    await runPullLoop(); // another 20 this cycle → still latched
    expect((await getSyncState()).attention).toEqual({ kind: 'tombstone_threshold', count: 20 });
  });

  it('keeps the panic-pause alarm sticky on a calm cycle (Larissa — pending acknowledgement)', async () => {
    await setAttention({ kind: 'tombstone_paused', count: 200 });
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 1,
        epoch: 'E1',
        more: false,
        records: [],
      }),
    );
    await runPullLoop();
    expect((await getSyncState()).attention).toEqual({ kind: 'tombstone_paused', count: 200 });
  });

  it('never clobbers a coexisting non-tombstone attention on a calm cycle', async () => {
    await setAttention({ kind: 'tamper' });
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 1,
        epoch: 'E1',
        more: false,
        records: [],
      }),
    );
    await runPullLoop();
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });
});

describe('runPullLoop — invalidation coalescing (§7.6, Laura soft)', () => {
  it('flushes the invalidator ONCE for a multi-record page', async () => {
    let n = 0;
    _setApplyOpenRecord(async () => ({ id: `p${n++}`, updatedAt: 1 }));
    const records = Array.from({ length: 5 }, (_v, i) =>
      pulledUpsert('personas', `p${i}`, new Uint8Array([i + 1]), i + 1),
    );
    _setPullTransport(
      async (): Promise<SyncPullResponse> => ({
        head: 5,
        epoch: 'E1',
        more: false,
        records,
      }),
    );
    const invalidate = vi.fn();
    setInvalidator(invalidate);

    await runPullLoop();

    expect(invalidate).toHaveBeenCalledTimes(1); // one flush per page, not per record
    const flushedKeys = invalidate.mock.calls[0]?.[0] as readonly unknown[][];
    expect(flushedKeys.length).toBeGreaterThan(1);
  });
});
