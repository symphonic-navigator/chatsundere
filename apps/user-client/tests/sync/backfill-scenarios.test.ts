// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { fromBase64Url } from '@chatsundere/crypto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncCollection, SyncPushRecord, SyncPushResponse } from '@chatsundere/shared-types';
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
import { deriveSyncStatus } from '../../src/components/SyncStatusLine.js';
import {
  _resetBackfillForTests,
  _setVectorKeysSource,
  runBackfillIfPending,
} from '../../src/sync/backfill.js';
import { resetEngineStateForNewLink } from '../../src/sync/link-reset.js';
import { getSyncState } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setCryptoDeps, _setPushTransport } from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) and `resetEngineStateForNewLink`'s
// stamp both read the crypto DB's linked account; these scenarios drive the
// backfill pipeline, not that identity, so it is stubbed inert.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * Integration scenarios for the late-link backfill (spec §3). Unlike
 * `backfill.test.ts`, which stubs the per-chunk drain, these drive the REAL
 * `drainOutbox` through a stubbed push transport that acks `ok` with incrementing
 * revs — so production `applyOk` writes real `syncRows`, and the whole
 * enqueue → seal → push → apply pipeline is exercised end to end. The three
 * scenarios cover a relink re-upload (L-1), crash-resumption idempotence, and the
 * U-5 attention-masking guarantee under a quota refusal.
 */

/** The single server epoch every push in this suite reports (no mismatch → no recovery). */
const EPOCH = 'epoch-new';

// ===== Fake crypto (mirrored from worker.test.ts) =====

/** Deterministic fake sealed record — the blind id encodes `collection:key`. */
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

/** Recover the sync key from a fake-sealed blind id (`bid:collection:key`). */
function keyOfBlindId(blindId: string): string {
  const decoded = new TextDecoder().decode(fromBase64Url(blindId));
  return decoded.split(':').slice(2).join(':');
}

// ===== Push transports =====

/** Every record the push transport acked `ok`, across every drain in a test. */
let pushedOk: { collection: SyncCollection; key: string }[] = [];
/** Monotone server rev — each acked record gets the next one. */
let serverRev = 0;
/** How many times the push transport has been invoked (for a mid-run crash). */
let pushCalls = 0;

/**
 * A push transport that acks every record `ok` with an incrementing rev, so the
 * real `applyOk` records fresh `syncRows`. `throwOnCall` makes the Nth push throw
 * BEFORE acking anything — a crash mid-push: the pump aborts and the batch's
 * records are never counted as pushed (the client never saw the ack), matching
 * how a resumed backfill re-pushes an un-acked chunk exactly once.
 */
function installAckingPush(opts: { throwOnCall?: number } = {}): void {
  _setPushTransport(async (records: SyncPushRecord[]): Promise<SyncPushResponse> => {
    pushCalls += 1;
    if (opts.throwOnCall === pushCalls) throw new Error('push crashed mid-backfill');
    const results = records.map((r) => {
      serverRev += 1;
      pushedOk.push({ collection: r.collection, key: keyOfBlindId(r.blindId) });
      return { status: 'ok' as const, rev: serverRev };
    });
    return { head: serverRev, epoch: EPOCH, results };
  });
}

/** A push transport that refuses every record with a `quota_exceeded` error. */
function installQuotaPush(): void {
  _setPushTransport(async (records: SyncPushRecord[]): Promise<SyncPushResponse> => {
    pushCalls += 1;
    return {
      head: 0,
      epoch: EPOCH,
      results: records.map(() => ({
        status: 'error' as const,
        code: 'quota_exceeded' as const,
        usedBytes: 900,
        quotaBytes: 1000,
      })),
    };
  });
}

// ===== Shared harness =====

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

/** Arm the backfill flag with the counters unstarted (mirrors backfill.test.ts). */
async function armBackfillPending(): Promise<void> {
  await getClientDataDb().syncState.put({
    id: 'state',
    epoch: null,
    watermarkRev: 0,
    lastSyncAt: null,
    pulling: null,
    attention: null,
    backfillPending: true,
    backfillTotal: null,
    backfillDone: null,
  });
}

/** Pump the backfill to completion, bounded so a stuck flag never hangs the test. */
async function pumpUntilSettled(maxCycles = 20): Promise<void> {
  for (let i = 0; i < maxCycles; i++) {
    if ((await getSyncState()).backfillPending !== true) return;
    await runBackfillIfPending();
  }
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
  // The knowledge vector store is never touched unless a test opts in.
  _setVectorKeysSource(async () => []);
  pushedOk = [];
  serverRev = 0;
  pushCalls = 0;
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetBackfillForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('backfill integration — relink after server account loss (spec §3.2, L-1)', () => {
  it('re-uploads EVERYTHING despite the old account having synced it all', async () => {
    const db = getClientDataDb();
    // Only chats should be candidates — drop the seeded settings singleton.
    await db.settings.delete(1);

    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `c${i}`;
      ids.push(id);
      await db.chats.put({ id } as never);
      // The OLD account had synced every chat: a stale CAS base for each.
      await db.syncRows.put({ collection: 'chats', key: id, rev: 99, ciphertextHash: 'stale' });
    }
    // A stale watermark and epoch from the old account, both meaningless now.
    await db.syncState.put({
      id: 'state',
      epoch: 'a',
      watermarkRev: 500,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
    });

    // The invitation join binds a fresh, empty server account: reset the engine
    // state and arm the backfill (the two always travel together).
    await resetEngineStateForNewLink();

    installAckingPush();
    await pumpUntilSettled();

    // Every one of the 20 chats climbed up — the stale `syncRows` was cleared by
    // the reset, so none was skipped as "already synced".
    const pushedChats = pushedOk.filter((p) => p.collection === 'chats').map((p) => p.key);
    expect(new Set(pushedChats)).toEqual(new Set(ids));
    expect(pushedChats).toHaveLength(20);

    // `syncRows` is repopulated with the NEW account's revs (1..20), not the 99s.
    for (const id of ids) {
      const meta = await db.syncRows.get(['chats', id]);
      expect(meta).toBeDefined();
      expect(meta?.rev).toBeGreaterThanOrEqual(1);
      expect(meta?.rev).toBeLessThanOrEqual(20);
    }

    const state = await getSyncState();
    expect(state.backfillPending).toBe(false);
    // The stale watermark was reset to 0 by the relink.
    expect(state.watermarkRev).toBe(0);
  });
});

describe('backfill integration — resumes across a crash between chunks (spec §3.4, L-2)', () => {
  it('pushes every message EXACTLY once across a mid-run crash and resume', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);

    const ids: string[] = [];
    for (let i = 0; i < 250; i++) {
      const id = `m${i}`;
      ids.push(id);
      await db.messages.put({ id } as never);
    }

    // First run crashes on the SECOND push (the second 100-key chunk): the first
    // chunk acked and settled, the pump aborts with everything else still in Dexie.
    installAckingPush({ throwOnCall: 2 });
    await armBackfillPending();
    await runBackfillIfPending();

    let state = await getSyncState();
    expect(state.backfillPending).toBe(true); // survived the crash
    expect(pushedOk.filter((p) => p.collection === 'messages')).toHaveLength(100); // only chunk 1

    // Second run (as the boot cycle would): re-arm a healthy push and resume.
    installAckingPush();
    await pumpUntilSettled();

    state = await getSyncState();
    expect(state.backfillPending).toBe(false);

    // Every message pushed EXACTLY once across BOTH runs — the un-acked chunk was
    // re-pushed on resume, never the acked one.
    const pushedMessages = pushedOk.filter((p) => p.collection === 'messages').map((p) => p.key);
    expect(pushedMessages).toHaveLength(250);
    expect(new Set(pushedMessages).size).toBe(250); // no duplicates
    expect(new Set(pushedMessages)).toEqual(new Set(ids));
    // And each carries a fresh CAS base.
    expect(await db.syncRows.count()).toBe(250);
  });
});

describe('backfill integration — quota attention masks progress (spec §3.7, U-5)', () => {
  it('surfaces the quota attention, holds the flag, and outranks the backfill line', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);

    for (let i = 0; i < 5; i++) await db.chats.put({ id: `c${i}` } as never);

    // The server refuses every record — the real `applyError` raises the attention.
    installQuotaPush();
    await armBackfillPending();
    await pumpUntilSettled();

    const state = await getSyncState();
    // Attention set by production code, from the exact worker error shape.
    expect(state.attention).toEqual({ kind: 'quota_exceeded', usedBytes: 900, quotaBytes: 1000 });
    // Nothing acked → the flag stays armed for the next online cycle.
    expect(state.backfillPending).toBe(true);
    // Kept, un-acked outbox entries remain (the drain never dropped them).
    expect(await db.syncOutbox.count()).toBeGreaterThan(0);

    // U-5 at integration level: a linked, online, non-recovering context resolves
    // to 'attention', NOT 'backfill' — a quota error is never masked by progress.
    const view = deriveSyncStatus({
      state,
      outboxCount: await db.syncOutbox.count(),
      online: true,
      recovering: false,
    });
    expect(view.kind).toBe('attention');
  });
});
