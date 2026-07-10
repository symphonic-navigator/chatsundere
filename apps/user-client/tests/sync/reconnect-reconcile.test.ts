// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
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
import { RECONCILE_INTERVAL_MS, runReconciliationIfDue } from '../../src/sync/reconcile.js';
import {
  _resetWorkerForTests,
  _setBackfill,
  _setPullLoop,
  _setReconcile,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (`enforceServerIdentity`) reads the
// crypto IDB's linked account; the wiring test below drives `runSyncCycle`
// only to prove call ORDER, not that identity, so it is stubbed inert
// (mirrors backfill-scenarios.test.ts).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * Task B9 (Workstream B, Finding #7): a row committed via `enqueue.ts`'s
 * `deferWhenOffline` path (an already-synced row, no `syncOutbox` entry) whose
 * live content has drifted from the last-observed baseline must be enqueued
 * for push by the reconnect reconciliation pass — and an unchanged
 * already-synced row must NOT be re-enqueued (no false churn).
 */

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

/** Force the coarse gate open: an absent (never-run) `lastReconcileAt`. */
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

/** Seed an already-synced row (a `syncRows` CAS base, no `syncOutbox` entry). */
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

async function outboxEntriesFor(collection: string, key: string) {
  return getClientDataDb().syncOutbox.where('[collection+key]').equals([collection, key]).toArray();
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
});

afterEach(async () => {
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('reconnect reconciliation (Task B9, Finding #7)', () => {
  it('enqueues a divergent already-synced row committed via the deferWhenOffline path', async () => {
    const db = getClientDataDb();
    await seedAlreadySynced('c1', 'Old title');

    // Pass 1: establishes the local content baseline for the pre-existing
    // syncRows entry (no historical reference point yet — must not enqueue).
    await armReconcileDue();
    await runReconciliationIfDue();
    expect(await db.syncOutbox.count()).toBe(0);
    const baselineMeta = await db.syncRows.get(['chats', 'c1']);
    expect(baselineMeta?.localContentHash).toBeDefined();

    // The deferWhenOffline path (enqueue.ts `mutateSynced`, offline-deferred):
    // a background job (title generation) commits a local write with NO
    // outbox entry — exactly the scenario that never converges without B9.
    await db.chats.update('c1', { title: 'New title set by a background job' });
    expect(await outboxEntriesFor('chats', 'c1')).toHaveLength(0);

    // Pass 2 (the "next reconnect cycle"): the row's content has diverged from
    // the recorded baseline — must be enqueued for push.
    await armReconcileDue();
    await runReconciliationIfDue();

    const entries = await outboxEntriesFor('chats', 'c1');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.op).toBe('upsert');
  });

  it('does NOT re-enqueue an unchanged already-synced row across passes (no false churn)', async () => {
    const db = getClientDataDb();
    await seedAlreadySynced('c2', 'Stable title');

    await armReconcileDue();
    await runReconciliationIfDue(); // establishes the baseline

    await armReconcileDue();
    await runReconciliationIfDue(); // row is unchanged — must stay silent

    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('does not re-scan before the coarse interval elapses (throttled, not on every trigger)', async () => {
    const db = getClientDataDb();
    await seedAlreadySynced('c3', 'Old title');

    await armReconcileDue();
    await runReconciliationIfDue(); // establishes the baseline, stamps lastReconcileAt
    const firstBaseline = (await db.syncRows.get(['chats', 'c3']))?.localContentHash;
    expect(firstBaseline).toBeDefined();

    // A genuinely divergent edit, but well within the coarse interval — the
    // gate (not a connectivity signal) must throttle this, not the content.
    await db.chats.update('c3', { title: 'Changed within the interval' });
    await runReconciliationIfDue(); // NOT due — must no-op entirely

    expect(await db.syncOutbox.count()).toBe(0);
    const meta = await db.syncRows.get(['chats', 'c3']);
    expect(meta?.localContentHash).toBe(firstBaseline); // untouched: the pass truly did not run
  });

  it('never scans a row with a pending outbox entry (avoids duplicate/racing enqueue)', async () => {
    const db = getClientDataDb();
    await seedAlreadySynced('c4', 'Old title');
    await armReconcileDue();
    await runReconciliationIfDue(); // establish baseline

    await db.chats.update('c4', { title: 'Edited via a normal write' });
    await db.syncOutbox.add({
      collection: 'chats',
      key: 'c4',
      op: 'upsert',
      enqueuedAt: Date.now(),
    });

    await armReconcileDue();
    await runReconciliationIfDue();

    // Still exactly the one legitimate entry — reconciliation did not add a second.
    expect(await outboxEntriesFor('chats', 'c4')).toHaveLength(1);
  });

  it('exposes a coarse (not per-tick) interval', () => {
    // Sanity guard against an accidental regression to a thrash-prone interval
    // (the task's explicit "do NOT thrash on every 30s tick" constraint).
    expect(RECONCILE_INTERVAL_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });
});

describe('cycle wiring — reconciliation runs at the tail, after backfill', () => {
  it('runs the registered reconciliation after backfill within the same cycle', async () => {
    const calls: string[] = [];
    // A pure-reader cycle (empty outbox → head === null) hands off to the pull loop.
    _setPullLoop(async () => {
      calls.push('pull');
    });
    _setBackfill(async () => {
      calls.push('backfill');
    });
    _setReconcile(async () => {
      calls.push('reconcile');
    });

    await runSyncCycle();

    expect(calls).toEqual(['pull', 'backfill', 'reconcile']);
  });
});
