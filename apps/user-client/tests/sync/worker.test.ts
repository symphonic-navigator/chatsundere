// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
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
import { batchByBytes } from '../../src/sync/seal-batch.js';
import {
  advanceWatermark,
  checkEpoch,
  getSyncState,
  setAttention,
} from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setMaxBatchBytes,
  _setOpenRecord,
  _setPullLoop,
  _setPushTransport,
  _setRecovery,
  drainOutbox,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; these tests exercise the drain/pull machinery, not that guard, so
// it is stubbed inert (no account linked → the guard never fires).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/** Deterministic fake crypto — no key material, no real WebCrypto needed. */
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

async function addOutbox(collection: string, key: string, op: 'upsert' | 'delete'): Promise<void> {
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

/** A push response with one `ok` result per record unless overridden. */
function okResponse(revs: number[], head: number, epoch = 'E1'): SyncPushResponse {
  return { head, epoch, results: revs.map((rev) => ({ status: 'ok', rev })) };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
});

afterEach(async () => {
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('drainOutbox — coalescing (spec §6.1)', () => {
  it('edit+edit coalesce to one seal of the live row', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v2', updatedAt: 2 } as never);
    await addOutbox('personas', 'p1', 'upsert');
    await addOutbox('personas', 'p1', 'upsert');

    const push = vi.fn(async (_records: SyncPushRecord[]) => okResponse([5], 5));
    _setPushTransport(push);

    await drainOutbox();

    expect(push).toHaveBeenCalledTimes(1);
    const sent = push.mock.calls[0]?.[0] as SyncPushRecord[];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.deleted).toBe(false);
    expect(await outbox()).toHaveLength(0);
    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(5);
  });

  it('edit+delete coalesce to a tombstone when the server knew the row', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 3, ciphertextHash: 'h' });
    await addOutbox('chats', 'c1', 'upsert');
    await addOutbox('chats', 'c1', 'delete');

    const push = vi.fn(async (_records: SyncPushRecord[]) => okResponse([4], 4));
    _setPushTransport(push);

    await drainOutbox();

    const sent = push.mock.calls[0]?.[0] as SyncPushRecord[];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.deleted).toBe(true);
    expect(sent[0]?.ciphertext).toBeUndefined();
    expect(sent[0]?.baseRev).toBe(3);
    expect(await db.syncRows.get(['chats', 'c1'])).toBeUndefined();
    expect(await outbox()).toHaveLength(0);
  });

  it('create+delete with no syncRows coalesces to nothing (L-4)', async () => {
    await addOutbox('personas', 'p9', 'upsert');
    await addOutbox('personas', 'p9', 'delete');

    const push = vi.fn(async () => okResponse([], 0));
    _setPushTransport(push);

    const result = await drainOutbox();

    expect(push).not.toHaveBeenCalled();
    expect(await outbox()).toHaveLength(0);
    expect(result.needsPull).toBe(false);
  });
});

describe('batchByBytes — boundary (spec §6.3)', () => {
  it('splits records summing past the ceiling into separate batches', () => {
    const mib = 1024 * 1024;
    const two = batchByBytes([{ encodedBytes: 3 * mib }, { encodedBytes: 3 * mib }], 4 * mib);
    expect(two).toHaveLength(2);

    const one = batchByBytes([{ encodedBytes: 2 * mib }, { encodedBytes: 1 * mib }], 4 * mib);
    expect(one).toHaveLength(1);

    const oversize = batchByBytes([{ encodedBytes: 9 * mib }], 4 * mib);
    expect(oversize).toHaveLength(1); // a lone oversize record still gets its own request
  });

  it('splits by record count even when bytes fit — the server rejects >100 records wholesale', () => {
    // 250 tiny records, all fitting one byte budget.
    const prepared = Array.from({ length: 250 }, () => ({ encodedBytes: 10 }));
    const batches = batchByBytes(prepared, 4 * 1024 * 1024);
    expect(batches.length).toBe(3);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(100);
    expect(batches.flat().length).toBe(250);
  });

  it('drain splits a two-record push into two requests under a small ceiling', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await db.personas.put({ id: 'p2' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    await addOutbox('personas', 'p2', 'upsert');
    _setMaxBatchBytes(1); // every record exceeds the ceiling → its own request

    const push = vi.fn(async () => okResponse([1], 1));
    _setPushTransport(push);

    await drainOutbox();
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe('drainOutbox — ok (spec §6.4)', () => {
  it('records the locally-computed hash and rev, clears the outbox', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([7], 7));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(7);
    expect(meta?.ciphertextHash).toBe(toBase64Url(new TextEncoder().encode('hash:personas:p1')));
    expect(await outbox()).toHaveLength(0);
  });
});

describe('drainOutbox — conflict (spec §6.4, M-1)', () => {
  it('poison (undecryptable current) adopts the rev and keeps the entry', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'old' });
    await addOutbox('personas', 'p1', 'upsert');
    _setOpenRecord(async () => {
      throw new Error('AEAD failure');
    });
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [
        {
          status: 'conflict',
          current: {
            blindId: toBase64Url(new TextEncoder().encode('bid:personas:p1')),
            collection: 'personas',
            rev: 12,
            deleted: false,
            nonce: toBase64Url(new Uint8Array([1])),
            ciphertext: toBase64Url(new Uint8Array([2, 3])),
          },
        },
      ],
    }));

    const result = await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(12); // adopted the server's CAS base
    expect(await outbox()).toHaveLength(1); // kept for re-push
    expect(result.needsPull).toBe(false);
  });

  it('decryptable current marks a pull and keeps the entry', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'old' });
    await addOutbox('personas', 'p1', 'upsert');
    _setOpenRecord(async () => ({ id: 'p1' }));
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [
        {
          status: 'conflict',
          current: {
            blindId: toBase64Url(new TextEncoder().encode('bid:personas:p1')),
            collection: 'personas',
            rev: 12,
            deleted: false,
            nonce: toBase64Url(new Uint8Array([1])),
            ciphertext: toBase64Url(new Uint8Array([2, 3])),
          },
        },
      ],
    }));

    const result = await drainOutbox();

    expect(result.needsPull).toBe(true);
    expect(await outbox()).toHaveLength(1); // kept; Task 7 resolves
    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBe(1); // unchanged — no CAS adoption on a decryptable conflict
  });
});

describe('drainOutbox — tombstoned (spec §6.4, I-1)', () => {
  it('routes the local row to trash and removes syncRows', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'c1', title: 'gone', updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 2, ciphertextHash: 'h' });
    await addOutbox('chats', 'c1', 'upsert');
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [
        {
          status: 'tombstoned',
          current: {
            blindId: toBase64Url(new TextEncoder().encode('bid:chats:c1')),
            collection: 'chats',
            rev: 5,
            deleted: true,
          },
        },
      ],
    }));

    await drainOutbox();

    expect(await db.chats.get('c1')).toBeUndefined();
    const trash = await db.trash.get('chats:c1');
    expect(trash?.collection).toBe('chats');
    expect(trash?.purgeAt).toBeGreaterThan(Date.now());
    expect(await db.syncRows.get(['chats', 'c1'])).toBeUndefined();
    expect(await outbox()).toHaveLength(0);
  });
});

describe('drainOutbox — error (spec §6.4)', () => {
  it('sets the quota attention, keeps the failing entry, does not block the queue', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await db.personas.put({ id: 'p2' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    await addOutbox('personas', 'p2', 'upsert');
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [
        { status: 'error', code: 'quota_exceeded', usedBytes: 900, quotaBytes: 1000 },
        { status: 'ok', rev: 8 },
      ],
    }));

    await drainOutbox();

    const state = await getSyncState();
    expect(state.attention).toEqual({ kind: 'quota_exceeded', usedBytes: 900, quotaBytes: 1000 });
    // p1 failed → still queued; p2 succeeded → cleared and recorded (not blocked).
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('p1');
    expect(await db.syncRows.get(['personas', 'p2'])).toBeDefined();
  });
});

describe('drainOutbox — piggyback inequality (spec §6.5, L-1)', () => {
  it('does NOT pull when the head equals our own acked rev', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([5], 5)); // head === our own rev

    const result = await drainOutbox();
    expect(result.needsPull).toBe(false);
  });

  it('pulls when the head outruns our own acked revs', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([5], 9)); // head 9 > our rev 5

    const result = await drainOutbox();
    expect(result.needsPull).toBe(true);
  });
});

describe('drainOutbox — epoch + watermark (spec §6.5, §6.6)', () => {
  it('flags recovery on an authenticated epoch mismatch', async () => {
    const db = getClientDataDb();
    await checkEpoch('E1'); // persist the first-synced epoch
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([2], 2, 'E2')); // different epoch

    const result = await drainOutbox();
    expect(result.needsRecovery).toBe(true);
  });

  it('never advances the watermark during a drain', async () => {
    const db = getClientDataDb();
    await advanceWatermark(10);
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([20], 20));

    await drainOutbox();
    expect((await getSyncState()).watermarkRev).toBe(10);
  });
});

describe('runSyncCycle (spec §6)', () => {
  it('no-ops when the account is not linked', async () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    const push = vi.fn(async () => okResponse([], 0));
    _setPushTransport(push);
    await addOutbox('personas', 'p1', 'upsert');

    await runSyncCycle();
    expect(push).not.toHaveBeenCalled();
  });

  it('purges expired trash at the start of the cycle', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.trash.put({
      id: 'chats:old',
      collection: 'chats',
      key: 'old',
      row: {},
      deletedAt: now - 1,
      purgeAt: now - 1,
    });
    await db.trash.put({
      id: 'chats:fresh',
      collection: 'chats',
      key: 'fresh',
      row: {},
      deletedAt: now,
      purgeAt: now + 1_000_000,
    });
    _setPushTransport(async () => okResponse([], 0));

    await runSyncCycle();

    expect(await db.trash.get('chats:old')).toBeUndefined();
    expect(await db.trash.get('chats:fresh')).toBeDefined();
  });

  it('runs the pull loop when the drain reports a piggyback pull', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([5], 9)); // head 9 > rev 5 → pull
    const pull = vi.fn(async () => undefined);
    _setPullLoop(pull);

    await runSyncCycle();
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('runs recovery (not the pull loop) on an epoch mismatch', async () => {
    const db = getClientDataDb();
    await checkEpoch('E1');
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([2], 2, 'E2'));
    const pull = vi.fn(async () => undefined);
    const recover = vi.fn(async () => undefined);
    _setPullLoop(pull);
    _setRecovery(recover);

    await runSyncCycle();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(pull).not.toHaveBeenCalled();
  });

  it('is single-flight — a concurrent second cycle no-ops', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const push = vi.fn(async () => {
      await gate;
      return okResponse([5], 5);
    });
    _setPushTransport(push);

    const first = runSyncCycle();
    const second = runSyncCycle(); // should skip — the lock/mutex is held
    release();
    await Promise.all([first, second]);

    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('runSyncCycle — §11.3 transient attention auto-clear', () => {
  it('retires a stale delete_rate_limited banner on a cycle that does not re-raise it', async () => {
    _setPullLoop(vi.fn(async () => undefined));
    await setAttention({ kind: 'delete_rate_limited' });

    // A clean cycle (empty outbox → nothing re-raised) retires the stale banner.
    await runSyncCycle();

    expect((await getSyncState()).attention).toBeNull();
  });

  it('does NOT clear a persisted quota banner on an empty-outbox cycle (still over quota)', async () => {
    // Larissa round 2: quota is an account-global fact persisted across reload, not
    // a per-drain transient. An empty-outbox boot cycle raises nothing, but the
    // account may still be full — the banner must survive on absence of a re-raise.
    _setPullLoop(vi.fn(async () => undefined));
    await setAttention({ kind: 'quota_exceeded', usedBytes: 900, quotaBytes: 1000 });

    await runSyncCycle();

    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 900,
      quotaBytes: 1000,
    });
  });

  it('keeps the quota banner while the condition persists, clears it once a write is accepted', async () => {
    const db = getClientDataDb();
    _setPullLoop(vi.fn(async () => undefined));
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');

    // Cycle 1: quota still full → banner raised, entry kept.
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [{ status: 'error', code: 'quota_exceeded', usedBytes: 900, quotaBytes: 1000 }],
    }));
    await runSyncCycle();
    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 900,
      quotaBytes: 1000,
    });

    // Cycle 2: still full → re-raised, so the banner MUST stay (not auto-cleared).
    await runSyncCycle();
    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 900,
      quotaBytes: 1000,
    });

    // Cycle 3: space freed → the push acks → the banner retires.
    _setPushTransport(async () => okResponse([7], 7));
    await runSyncCycle();
    expect((await getSyncState()).attention).toBeNull();
  });

  it('does NOT clear a sticky non-transient banner (tamper) on a clean cycle', async () => {
    _setPullLoop(vi.fn(async () => undefined));
    await setAttention({ kind: 'tamper' });

    await runSyncCycle();

    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });

  it('does NOT clear record_too_large on a clean cycle — only on a terminal-sentinel sweep', async () => {
    const db = getClientDataDb();
    _setPullLoop(vi.fn(async () => undefined));
    await db.personas.put({ id: 'p1' } as never);
    await addOutbox('personas', 'p1', 'upsert');

    // Cycle 1: the record is too large → banner raised, its outbox entry marked terminal.
    _setPushTransport(async () => ({
      head: 0,
      epoch: 'E1',
      results: [{ status: 'error', code: 'record_too_large' }],
    }));
    await runSyncCycle();
    expect((await getSyncState()).attention).toEqual({ kind: 'record_too_large' });
    expect((await outbox())[0]?.terminal).toBe(true);

    // Cycle 2: an unrelated clean cycle does NOT retire the sticky banner.
    _setPushTransport(async () => okResponse([], 0));
    await runSyncCycle();
    expect((await getSyncState()).attention).toEqual({ kind: 'record_too_large' });

    // Cycle 3: a fresh (smaller) edit for the same key acks → the terminal sentinel
    // is swept and the banner retires.
    await addOutbox('personas', 'p1', 'upsert');
    _setPushTransport(async () => okResponse([9], 9));
    await runSyncCycle();
    expect((await getSyncState()).attention).toBeNull();
  });
});
