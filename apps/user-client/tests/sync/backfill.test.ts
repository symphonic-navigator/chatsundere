// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncOutboxRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetBackfillForTests,
  _setBackfillDrain,
  _setVectorKeysSource,
  runBackfillIfPending,
} from '../../src/sync/backfill.js';
import { getSyncState } from '../../src/sync/watermark.js';

// Node's global `Blob` survives fake-indexeddb's structuredClone with real bytes
// (unlike jsdom's), so the artefact blob round-trips with a non-zero size — the
// node-env discipline mirrored from blob-drain.test.ts.

/** One entry the fake drain observed on a given call (collection + key + op). */
interface SeenEntry {
  collection: SyncCollection;
  key: string;
  op: SyncOutboxRow['op'];
  blobId?: string;
}
/** What one invocation of the fake drain saw and the backfill total at that moment. */
interface DrainCall {
  entries: SeenEntry[];
  total: number | null | undefined;
}

let drainCalls: DrainCall[] = [];
let drainInvocations = 0;

/**
 * Build a fake drain seam that mirrors the real `applyOk` contract: it reads the
 * live non-terminal outbox, records what it saw, then moves every `upsert` into
 * `syncRows` and deletes each covered entry. `throwOnCall` makes the Nth
 * invocation fail BEFORE recording or applying anything (a failed push);
 * `beforeApply` runs at the top of each call so a test can mutate local state
 * mid-pump.
 */
function makeDrainSeam(
  opts: { throwOnCall?: number; beforeApply?: (call: number) => Promise<void> } = {},
): () => Promise<void> {
  return async () => {
    drainInvocations += 1;
    const call = drainInvocations;
    if (opts.beforeApply) await opts.beforeApply(call);
    if (opts.throwOnCall === call) throw new Error('drain failed');

    const db = getClientDataDb();
    const rows = (await db.syncOutbox.toArray()).filter((r) => r.terminal !== true);
    drainCalls.push({
      entries: rows.map((r) => ({
        collection: r.collection,
        key: r.key,
        op: r.op,
        blobId: r.blobId,
      })),
      total: (await getSyncState()).backfillTotal,
    });
    await db.transaction('rw', db.syncRows, db.syncOutbox, async () => {
      for (const r of rows) {
        if (r.op === 'upsert') {
          await db.syncRows.put({
            collection: r.collection,
            key: r.key,
            rev: 1,
            ciphertextHash: 'h',
          });
        }
        if (r.seq !== undefined) await db.syncOutbox.delete(r.seq);
      }
    });
  };
}

/** Every key the fake drain ever applied, across all calls (flat). */
function appliedKeys(): string[] {
  return drainCalls.flatMap((c) => c.entries.map((e) => e.key));
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

/** Arm the sync-state singleton with the backfill flag set, counters unstarted. */
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

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  drainCalls = [];
  drainInvocations = 0;
  // The knowledge vector store is never touched unless a test opts in.
  _setVectorKeysSource(async () => []);
});

afterEach(async () => {
  _resetBackfillForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('runBackfillIfPending — enqueue + chunking (spec §3.3/§3.4)', () => {
  it('enqueues only un-synced rows, chunked at 100, and clears the flag when done', async () => {
    const db = getClientDataDb();
    // Only chats should be candidates — drop the seeded settings singleton.
    await db.settings.delete(1);

    const unsynced: string[] = [];
    for (let i = 0; i < 130; i++) {
      const id = `u${i}`;
      unsynced.push(id);
      await db.chats.put({ id } as never);
    }
    const preSynced: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `s${i}`;
      preSynced.push(id);
      await db.chats.put({ id } as never);
      await db.syncRows.put({ collection: 'chats', key: id, rev: 1, ciphertextHash: 'h' });
    }

    _setBackfillDrain(makeDrainSeam());
    await armBackfillPending();
    await runBackfillIfPending();

    // 130 un-synced → two chunks (100 + 30) → two drains.
    expect(drainInvocations).toBe(2);
    // Every un-synced chat now carries a CAS base; the pre-synced ones were skipped.
    for (const id of unsynced) expect(await db.syncRows.get(['chats', id])).toBeDefined();
    for (const id of preSynced) expect(appliedKeys()).not.toContain(id);
    expect(appliedKeys()).toHaveLength(130);

    const state = await getSyncState();
    expect(state.backfillPending).toBe(false);
    expect(state.backfillTotal).toBeNull();
    expect(state.backfillDone).toBeNull();
  });
});

describe('runBackfillIfPending — skip rules (spec §3.4)', () => {
  it('skips built-in mindspaces and keys with a pending outbox entry', async () => {
    const db = getClientDataDb();
    // A normal (syncable) mindspace, plus the seven seeded built-ins (skipped).
    await db.mindspaces.put({ id: 'm-normal', builtIn: false } as never);
    const builtInIds = (await db.mindspaces.toArray())
      .filter((m) => m.builtIn === true)
      .map((m) => m.id);
    expect(builtInIds.length).toBeGreaterThan(0);

    // c1 already has a pending outbox entry → not a backfill candidate.
    await db.chats.put({ id: 'c1' } as never);
    await db.syncOutbox.add({ collection: 'chats', key: 'c1', op: 'upsert', enqueuedAt: 1 });
    await db.chats.put({ id: 'c2' } as never);

    _setBackfillDrain(makeDrainSeam());
    await armBackfillPending();
    await runBackfillIfPending();

    // Built-ins were never enqueued: no CAS base, never seen by a drain.
    for (const id of builtInIds) {
      expect(appliedKeys()).not.toContain(id);
      expect(await db.syncRows.get(['mindspaces', id])).toBeUndefined();
    }
    // The normal mindspace and the fresh chat were enqueued.
    expect(appliedKeys()).toContain('m-normal');
    expect(appliedKeys()).toContain('c2');
    // c1 was not re-enqueued: its single pre-existing entry drained exactly once.
    expect(appliedKeys().filter((k) => k === 'c1')).toHaveLength(1);
  });
});

describe('runBackfillIfPending — abort + idempotent resume (spec §3.4/L-2)', () => {
  it('aborts on a drain failure, resumes without enqueuing any key twice', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);

    const ids: string[] = [];
    for (let i = 0; i < 150; i++) {
      const id = `k${i}`;
      ids.push(id);
      await db.chats.put({ id } as never);
    }

    // First pass: the 2nd drain (the 50-key remainder) throws.
    _setBackfillDrain(makeDrainSeam({ throwOnCall: 2 }));
    await armBackfillPending();
    await runBackfillIfPending();

    let state = await getSyncState();
    expect(state.backfillPending).toBe(true); // survived the abort
    expect(state.backfillDone).toBe(100); // only the first chunk counted
    expect(drainInvocations).toBe(2);

    // Second pass: re-arm the drain to succeed; the pump resumes and completes.
    _setBackfillDrain(makeDrainSeam());
    await runBackfillIfPending();

    state = await getSyncState();
    expect(state.backfillPending).toBe(false);
    expect(state.backfillTotal).toBeNull();
    expect(state.backfillDone).toBeNull();

    // No key was enqueued (and thus drained) twice across the two passes.
    const seen = appliedKeys();
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(ids));
  });
});

describe('runBackfillIfPending — blob channel (spec §3.4)', () => {
  it('enqueues a blob-put atomically with its record, in the same drain', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);

    await db.artefacts.put({
      id: 'a1',
      blob: new Blob([new Uint8Array([1, 2, 3, 4])]),
      blobRef: { blobId: 'blob-a1', bytes: 32 },
    } as never);

    _setBackfillDrain(makeDrainSeam());
    await armBackfillPending();
    await runBackfillIfPending();

    // Find the drain call that carried the artefact's record upsert.
    const call = drainCalls.find((c) =>
      c.entries.some((e) => e.collection === 'artefacts' && e.key === 'a1' && e.op === 'upsert'),
    );
    expect(call).toBeDefined();
    // The blob-put for the same key rode the SAME drain (one atomic transaction).
    expect(
      call?.entries.some(
        (e) =>
          e.collection === 'artefacts' &&
          e.key === 'a1' &&
          e.op === 'blob-put' &&
          e.blobId === 'blob-a1',
      ),
    ).toBe(true);
  });
});

describe('runBackfillIfPending — stable one-off total (spec §3.7/U-8)', () => {
  it('counts the total once and holds it while rows are added mid-pump', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);

    for (let i = 0; i < 120; i++) await db.messages.put({ id: `m${i}` } as never);

    // The first drain adds 50 NEW local messages before succeeding — the total
    // snapshot must NOT grow to absorb them.
    _setBackfillDrain(
      makeDrainSeam({
        beforeApply: async (call) => {
          if (call === 1) {
            for (let i = 0; i < 50; i++) await db.messages.put({ id: `n${i}` } as never);
          }
        },
      }),
    );
    await armBackfillPending();
    await runBackfillIfPending();

    // The total was 120 at every drain, even after the 50 arrivals.
    expect(drainCalls.length).toBeGreaterThan(0);
    for (const c of drainCalls) expect(c.total).toBe(120);
  });
});
