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
import Dexie from 'dexie';
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

/**
 * Finding #4b (Medium) — `applyUpsert`/`applyTombstone` used to READ the local
 * row in one Dexie transaction (or no transaction at all) and WRITE in a
 * separate, later one. A concurrent Class-1 append or Class-2 `mutateSynced`
 * (neither holds the sync lock) landing in that gap could be silently
 * clobbered by the apply pipeline's later, stale-data-driven write. The fix
 * folds local-read → decide → write into ONE `db.transaction`, so IndexedDB's
 * own lock-ordering guarantee (overlapping `readwrite` transactions on the
 * same store never interleave — they queue in creation order) makes the race
 * structurally impossible.
 *
 * These tests force the race deterministically rather than hoping for lucky
 * scheduling: a spy on the table's `get()` fires the "concurrent" write via
 * `Dexie.ignoreTransaction` (escaping the ambient transaction zone) the moment
 * the read resolves.
 *  - When `Dexie.currentTransaction` is null at that point (the OLD, unfixed
 *    code — the read isn't inside any transaction that protects it), the spy
 *    AWAITS the concurrent write before returning, guaranteeing it lands
 *    fully committed in the gap — deterministic RED, no scheduling luck.
 *  - When a transaction IS active (the FIXED code), the spy does NOT await
 *    it (doing so would deadlock: the concurrent write is queued behind the
 *    still-open outer transaction, which itself is waiting on the spy to
 *    return) — it fires-and-forgets, and IndexedDB's queueing guarantees the
 *    concurrent write can only land strictly AFTER our transaction commits.
 */

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

async function localHash(ciphertext: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', ciphertext as BufferSource);
  return toBase64Url(new Uint8Array(digest));
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

function pulledTombstone(collection: string, key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: true,
  };
}

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
  vi.restoreAllMocks();
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

/**
 * Arm a table's `get()` to fire a "concurrent" write the moment the FIRST read
 * resolves — deterministically landing in the read-to-write gap for unfixed
 * code, and deterministically queued behind an active transaction for fixed
 * code (see the file banner). Returns the concurrent write's promise so the
 * test can await it once `applyRecord` has settled.
 */
function armConcurrentWriteOnFirstRead<T>(
  // biome-ignore lint/suspicious/noExplicitAny: Dexie's Table type is invariant-heavy here.
  table: any,
  concurrentWrite: () => Promise<T>,
): { concurrentPromise: Promise<T | undefined> } {
  let fired = false;
  let resolveConcurrent: (v: T | undefined) => void = () => undefined;
  const concurrentPromise = new Promise<T | undefined>((resolve) => {
    resolveConcurrent = resolve;
  });
  const realGet = table.get.bind(table);
  vi.spyOn(table, 'get').mockImplementation(async (...args: unknown[]) => {
    const result = await realGet(...args);
    if (!fired) {
      fired = true;
      const insideTx = Dexie.currentTransaction !== null;
      const write = Dexie.ignoreTransaction(concurrentWrite);
      if (insideTx) {
        // A transaction protects this read: awaiting here would deadlock (the
        // concurrent write is queued behind the still-open outer transaction).
        // Fire-and-forget; IndexedDB guarantees it can only land after commit.
        void write.then(resolveConcurrent);
      } else {
        // No transaction protects this read — the TOCTOU gap the old code
        // left open. Await so the concurrent write is FULLY committed before
        // the stale value is handed back, reproducing the race deterministically.
        const v = await write;
        resolveConcurrent(v);
      }
    }
    return result;
  });
  return { concurrentPromise };
}

// ===== applyUpsert — §7.5 conflict resolution race =====

describe('applyRecord — TOCTOU: applyUpsert folds local-read → resolve → write (#4b)', () => {
  it('does not lose a concurrent local edit landing between the read and the write', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', updatedAt: 1, name: 'old-base' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'stored' });
    // Pulled record beats the STALE base (9 > 1), so an unfixed resolver picks
    // 'pulled' and blindly overwrites whatever is currently in the table.
    openReturns({ id: 'p1', updatedAt: 9, name: 'pulled-new' });

    const { concurrentPromise } = armConcurrentWriteOnFirstRead(db.table('personas'), () =>
      db.personas.update('p1', { updatedAt: 50, name: 'concurrent-edit' }),
    );

    const outcome = await applyRecord(pulledUpsert('personas', 'p1', new Uint8Array([5, 5]), 7));
    const concurrentResult = await concurrentPromise; // number of rows the concurrent update touched

    const final = (await db.personas.get('p1')) as { updatedAt: number; name: string } | undefined;

    if (concurrentResult === 1) {
      // The concurrent edit actually applied at some point — it must never be
      // silently destroyed afterwards by our write.
      expect(final?.name).toBe('concurrent-edit');
      expect(final?.updatedAt).toBe(50);
    } else {
      // The concurrent edit was correctly forced to queue until AFTER our
      // transaction committed, applying cleanly on top of the pulled write.
      expect(concurrentResult).toBe(1);
    }

    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
  });
});

// ===== applyTombstone — trash-move race =====

describe('applyRecord — TOCTOU: applyTombstone folds local-read → trash-move (#4b)', () => {
  it('never silently discards a concurrent edit that reports having applied', async () => {
    const db = getClientDataDb();
    await db.chats.put({ id: 'c1', title: 'original', createdAt: 1, updatedAt: 1 } as never);
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 1, ciphertextHash: 'h' });

    const { concurrentPromise } = armConcurrentWriteOnFirstRead(db.table('chats'), () =>
      db.chats.update('c1', { title: 'concurrent-edit', updatedAt: 99 }),
    );

    const outcome = await applyRecord(pulledTombstone('chats', 'c1', 5));
    const concurrentResult = await concurrentPromise; // 1 = the update actually applied, 0 = no-op (row already gone)

    const finalLive = (await db.chats.get('c1')) as { title: string } | undefined;
    const trash = await db.trash.get('chats:c1');
    const trashedTitle = (trash?.row as { title?: string } | undefined)?.title;

    if (concurrentResult === 1) {
      // The update reported success — its content must be findable SOMEWHERE
      // (still live, or captured in the trash snapshot), never vanished.
      const preserved =
        finalLive?.title === 'concurrent-edit' || trashedTitle === 'concurrent-edit';
      expect(preserved).toBe(true);
    } else {
      // Correctly queued until after the row was already gone — a clean,
      // honest no-op: no resurrection, no phantom trash content.
      expect(finalLive).toBeUndefined();
    }

    expect(outcome).toEqual({ kind: 'tombstoned' });
  });
});
