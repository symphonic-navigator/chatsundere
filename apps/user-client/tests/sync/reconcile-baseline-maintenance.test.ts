// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
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
import {
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';
import { hashRow } from '../../src/sync/content-hash.js';
import { runReconciliationIfDue } from '../../src/sync/reconcile.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPushTransport,
  drainOutbox,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; these tests drive the drain/apply/reconcile machinery directly,
// not that guard, so it is stubbed inert (no account linked → never fires).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * Follow-up to the initial Task B9 (Finding #7) landing. `localContentHash` was
 * previously maintained EXCLUSIVELY by `reconcile.ts` itself: a normal push-ack
 * (`worker.ts`'s `applyOk`) or pull-apply (`apply.ts`) wrote `syncRows` via a
 * whole-record `.put()`/`.update()` that carried no `localContentHash`, wiping
 * the baseline back to `undefined`. The very next reconcile pass then treated
 * the row as a brand-new "first observation" (the BOOTSTRAP branch) and
 * re-established a fresh baseline WITHOUT enqueuing — so a `deferWhenOffline`
 * divergence landing in the window between a row's last normal sync and the
 * next coarse reconcile pass was silently absorbed as the new baseline and
 * NEVER pushed. This suite proves both convergence points now keep the
 * baseline fresh, closing that recurring window.
 */

const HASH_BYTES = new TextEncoder().encode('hash:personas:fixed');
const HASH_B64 = toBase64Url(HASH_BYTES);

function fakeSealed(collection: string, key: string): SealedRecord {
  return {
    blindId: new TextEncoder().encode(`bid:${collection}:${key}`),
    envelopeVersion: 1,
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([9, 9]),
    ciphertextHash: HASH_BYTES,
  };
}

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key) => fakeSealed(collection, key),
  });
}

/** Deterministic fake blind id — mirrors the fake crypto the worker tests use. */
function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

function installFakeBlindId(): void {
  _setApplyComputeBlindId(async (_mk, collection, key) => fakeBlindId(collection, key));
}

/** openRecord seam that returns the given plaintext row (its `id` = the sync key). */
function openReturns(row: unknown): void {
  _setApplyOpenRecord(async () => row);
}

function pulledUpsert(collection: string, key: string, ciphertext: Uint8Array, rev: number) {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(ciphertext),
  };
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

async function outboxEntriesFor(collection: string, key: string) {
  return getClientDataDb().syncOutbox.where('[collection+key]').equals([collection, key]).toArray();
}

/** A push response with one `ok` result per record. */
function okResponse(revs: number[], head: number, epoch = 'E1'): SyncPushResponse {
  return { head, epoch, results: revs.map((rev) => ({ status: 'ok', rev })) };
}

/** Force the coarse reconcile gate open: an absent (never-run) `lastReconcileAt`. */
async function armReconcileDue(): Promise<void> {
  const db = getClientDataDb();
  const existing = await db.syncState.get('state');
  await db.syncState.put({
    id: 'state',
    epoch: existing?.epoch ?? null,
    watermarkRev: existing?.watermarkRev ?? 0,
    lastSyncAt: existing?.lastSyncAt ?? null,
    pulling: existing?.pulling ?? null,
    attention: existing?.attention ?? null,
    lastReconcileAt: null,
  });
}

/** Seed a LEGACY already-synced row: a `syncRows` CAS base with no `localContentHash`
 *  yet (mirrors `reconnect-reconcile.test.ts`'s fixture for the bootstrap path). */
async function seedAlreadySynced(id: string, title: string): Promise<void> {
  const db = getClientDataDb();
  await db.chats.put({ id, title } as never);
  await db.syncRows.put({
    collection: 'chats',
    key: id,
    rev: 5,
    ciphertextHash: 'stale-wire-hash',
  });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
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

describe('applyOk stamps the reconnect-reconciliation baseline (guard/regression)', () => {
  it('stamps localContentHash to the hash of the pushed row on a successful ack', async () => {
    const db = getClientDataDb();
    const row = { id: 'p4', name: 'v1', updatedAt: 1 };
    await db.personas.put(row as never);
    await addOutbox('personas', 'p4', 'upsert');
    _setPushTransport(async (_records: SyncPushRecord[]) => okResponse([1], 1));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p4']);
    expect(meta?.localContentHash).toBe(await hashRow('personas', row));
  });

  it('does NOT stamp on a stale/dropped ack (the monotone guard skips the whole meta write)', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p4b', name: 'v1', updatedAt: 1 } as never);
    await db.syncRows.put({
      collection: 'personas',
      key: 'p4b',
      rev: 50,
      ciphertextHash: 'existing-hash-50',
      localContentHash: 'existing-baseline',
    });
    await addOutbox('personas', 'p4b', 'upsert');
    // A stale/low ack — never regresses the CAS base (#4c), and must never
    // touch the baseline either.
    _setPushTransport(async (_records: SyncPushRecord[]) => okResponse([3], 3));

    await drainOutbox();

    const meta = await db.syncRows.get(['personas', 'p4b']);
    expect(meta?.rev).toBe(50);
    expect(meta?.localContentHash).toBe('existing-baseline'); // untouched
  });
});

describe('pull-apply stamps the reconnect-reconciliation baseline (guard/regression)', () => {
  it('stamps localContentHash to the hash of the just-stored row on insert', async () => {
    const row = { id: 'p5', name: 'pulled-in' };
    openReturns(row);

    const outcome = await applyRecord(pulledUpsert('personas', 'p5', new Uint8Array([4, 5, 6]), 3));

    expect(outcome).toEqual({ kind: 'inserted' });
    const meta = await getClientDataDb().syncRows.get(['personas', 'p5']);
    expect(meta?.localContentHash).toBe(await hashRow('personas', row));
  });
});

describe('reconnect reconciliation — baseline stays fresh through normal sync (closes the recurring gap)', () => {
  it('enqueues a row edited via deferWhenOffline (no outbox) in the VERY NEXT reconcile pass after a normal push — no bootstrap pass needed', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await addOutbox('personas', 'p1', 'upsert');

    // Tracks every push, with a strictly increasing rev per call, so the
    // reconcile-triggered re-push below both fires (rev advances the monotone
    // guard) and is distinguishable from the first, ordinary push.
    const pushedBlindIds: string[] = [];
    let nextRev = 1;
    _setPushTransport(async (records: SyncPushRecord[]) => {
      pushedBlindIds.push(...records.map((r) => r.blindId));
      const rev = nextRev;
      nextRev += 1;
      return {
        head: rev,
        epoch: 'E1',
        results: records.map(() => ({ status: 'ok' as const, rev })),
      };
    });

    // A normal push — applyOk stamps the baseline to what was just sealed.
    await drainOutbox();
    expect(pushedBlindIds).toHaveLength(1);
    const stamped = await db.syncRows.get(['personas', 'p1']);
    expect(stamped?.localContentHash).toBeDefined();

    // The deferWhenOffline path (enqueue.ts's mutateSynced offline-defer
    // branch): a direct local write with NO outbox entry.
    await db.personas.update('p1', { name: 'v2 — changed while offline-deferred' });
    expect(await outboxEntriesFor('personas', 'p1')).toHaveLength(0);

    await armReconcileDue();
    await runReconciliationIfDue();

    // Reconcile detected the divergence, enqueued an upsert, and its own
    // follow-up drain pushed it through immediately — a SECOND push call for
    // this key is the proof (the outbox itself empties again on that
    // successful ack, so a call-count assertion is the stable signal here,
    // not queue length, which would misleadingly read back to zero either way).
    expect(pushedBlindIds).toHaveLength(2);
    const afterMeta = await db.syncRows.get(['personas', 'p1']);
    expect(afterMeta?.localContentHash).not.toBe(stamped?.localContentHash);
  });

  it('does NOT re-enqueue a normally-pushed UNCHANGED row on the very next reconcile pass (no false churn)', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p2', name: 'stable', updatedAt: 1 } as never);
    await addOutbox('personas', 'p2', 'upsert');
    const pushedBlindIds: string[] = [];
    _setPushTransport(async (records: SyncPushRecord[]) => {
      pushedBlindIds.push(...records.map((r) => r.blindId));
      return okResponse([1], 1);
    });

    await drainOutbox();
    expect(pushedBlindIds).toHaveLength(1);

    await armReconcileDue();
    await runReconciliationIfDue();

    // No divergence — no second push, and the outbox stays empty.
    expect(pushedBlindIds).toHaveLength(1);
    expect(await outboxEntriesFor('personas', 'p2')).toHaveLength(0);
  });

  it('enqueues a pulled row edited locally (no outbox) in the VERY NEXT reconcile pass — no bootstrap pass needed', async () => {
    const row = { id: 'p3', name: 'pulled-in' };
    openReturns(row);
    const outcome = await applyRecord(pulledUpsert('personas', 'p3', new Uint8Array([7, 8, 9]), 7));
    expect(outcome).toEqual({ kind: 'inserted' });

    const stamped = await getClientDataDb().syncRows.get(['personas', 'p3']);
    expect(stamped?.localContentHash).toBeDefined();

    await getClientDataDb().personas.update('p3', { name: 'locally changed, no outbox' });

    const pushedBlindIds: string[] = [];
    _setPushTransport(async (records: SyncPushRecord[]) => {
      pushedBlindIds.push(...records.map((r) => r.blindId));
      return {
        head: 1,
        epoch: 'E1',
        results: records.map(() => ({ status: 'ok' as const, rev: 1 })),
      };
    });

    await armReconcileDue();
    await runReconciliationIfDue();

    // Reconcile detected the divergence and pushed it through (a call for
    // this key proves the enqueue happened; the outbox itself empties again
    // on the successful ack, so queue length is not the signal here either).
    expect(pushedBlindIds).toHaveLength(1);
  });

  it('a legacy row (seeded with no localContentHash) still bootstraps without enqueuing on its first pass', async () => {
    // Regression guard: the pre-existing bootstrap branch (for a row that
    // predates this whole scheme) must still work unchanged.
    await seedAlreadySynced('legacy1', 'Legacy title');
    await armReconcileDue();
    await runReconciliationIfDue();

    expect(await outboxEntriesFor('chats', 'legacy1')).toHaveLength(0);
    const meta = await getClientDataDb().syncRows.get(['chats', 'legacy1']);
    expect(meta?.localContentHash).toBeDefined();
  });
});
