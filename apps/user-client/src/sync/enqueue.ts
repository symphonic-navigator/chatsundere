// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import type { Transaction } from 'dexie';
import type { SyncOutboxRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { isClass2Allowed } from './gate.js';

/**
 * Outbox enqueue and the Class-2 synced write-through (spec §5). One outbox,
 * two call-site behaviours: Class-1 appends call `enqueueSync` inside their own
 * transaction; Class-2 mutations go through `mutateSynced`. Neither touches the
 * worker directly — the worker registers its immediate-drain via
 * `setImmediateDrain`, keeping this module import-cycle-free.
 */

/** Raised when a Class-2 mutation is attempted while sync is unavailable (§5). */
export class SyncOfflineError extends Error {
  constructor(message = 'This change needs a reachable server, which is currently unavailable.') {
    super(message);
    this.name = 'SyncOfflineError';
  }
}

/**
 * Enqueue an outbound change INSIDE the caller's Dexie transaction so the
 * outbox row commits atomically with the local write (spec §5). No payload is
 * stored — sealing reads the live row at drain time, so queued edits of one key
 * coalesce for free. Synchronous: the `add` is registered on `tx` and Dexie
 * flushes it when the transaction commits; the caller must not await it.
 */
export function enqueueSync(
  tx: Transaction,
  collection: SyncCollection,
  key: string,
  op: 'upsert' | 'delete',
): void {
  const row: SyncOutboxRow = { collection, key, op, enqueuedAt: Date.now() };
  void tx.table<SyncOutboxRow, number>('syncOutbox').add(row);
}

/**
 * Enqueue a `blob-put` for a freshly-minted blob (WS-D §5), INSIDE the caller's
 * transaction so the put queues atomically with the owning record's upsert. The
 * `key` is the owning record's sync key (so a later tombstone for that key drops
 * this pending put in the same transaction, Larissa L-1); `blobId` names the blob
 * whose bytes the drain seals from the live row and PUTs (phase 1, §5). Bytes are
 * never stored on the outbox row — the drain reads them from the live row.
 */
export function enqueueBlobPut(
  tx: Transaction,
  collection: SyncCollection,
  key: string,
  blobId: string,
): void {
  const row: SyncOutboxRow = { collection, key, op: 'blob-put', blobId, enqueuedAt: Date.now() };
  void tx.table<SyncOutboxRow, number>('syncOutbox').add(row);
}

/**
 * Enqueue a `blob-delete` for a replaced or cascade-deleted blob (WS-D §5),
 * INSIDE the caller's transaction. The drain runs deletes LAST (§5 phase order);
 * a replaced-id delete additionally waits for its record's `ok` ack and is
 * suppressed on a `conflict` (Larissa M-2). The `key` is the owning record's sync
 * key; `blobId` is the old blob to remove once the ref no longer points at it.
 */
export function enqueueBlobDelete(
  tx: Transaction,
  collection: SyncCollection,
  key: string,
  blobId: string,
): void {
  const row: SyncOutboxRow = { collection, key, op: 'blob-delete', blobId, enqueuedAt: Date.now() };
  void tx.table<SyncOutboxRow, number>('syncOutbox').add(row);
}

/**
 * Whether the sync engine exists for this account (spec §5): it does only for a
 * linked account. Class-1 write sites (Task 11) gate both their `enqueueSync`
 * and the debounced kick on this — `enqueueSync` is deliberately lower-level
 * than `mutateSynced` and does NOT check link status itself, so for a
 * local-only user the write must land with no outbox row.
 */
export function isLinkedForSync(): boolean {
  return useAccountLinkStore.getState().linkStatus === 'linked';
}

// ===== Immediate drain registration (avoids a worker import cycle) =====

type ImmediateDrain = (target: { collection: SyncCollection; key: string }) => Promise<void>;

let immediateDrain: ImmediateDrain | null = null;

/**
 * Register the worker's immediate-drain function (called at boot, Task 8).
 * Stored in module state so `enqueue.ts` never imports `worker.ts` — the outbox
 * is written here, the worker drains it, and neither imports the other.
 */
export function setImmediateDrain(fn: ImmediateDrain): void {
  immediateDrain = fn;
}

/**
 * Two-phase synced mutation for Class-2 write sites (spec §5):
 * gate → local write + outbox enqueue (one atomic transaction) → awaited
 * immediate drain for that key.
 *
 * For a local-only user (`linkStatus !== 'linked'`) the engine does not exist:
 * this is a plain local write with no outbox row and no drain. When linked it
 * throws `SyncOfflineError` if a Class-2 write is currently disallowed (offline,
 * locked, or mid-recovery — surfaces render this state as disabled first, the
 * throw is the programming-error backstop).
 *
 * A drain rejection propagates to a still-mounted caller; if the caller has
 * navigated away the failure lands on the attention state instead (written in
 * the drain path, Task 6). The outbox retains the entry either way.
 *
 * `tables` declares every Dexie table `write` touches (plus any derived table);
 * `syncOutbox` is added automatically for the enqueue. Dexie needs the table
 * set statically, and `mutateSynced` cannot infer it from the opaque `write`
 * callback — so the caller declares it (plan/spec left this unspecified; see the
 * task report).
 */
export async function mutateSynced(args: {
  collection: SyncCollection;
  key: string;
  op?: 'upsert' | 'delete';
  tables: readonly string[];
  write: (tx: Transaction) => Promise<void>;
  /**
   * Additional keys to enqueue as `delete` tombstones alongside the primary, in
   * the SAME transaction (spec §7.3a). Used by cascade deletes: the apply
   * pipeline does not cascade (`apply.ts` moves only the single tombstoned row
   * to trash), so a parent delete must carry its own synced children's
   * tombstones or they orphan on other devices. Only enqueued in the linked
   * path; ignored for a local-only user and when offline-deferred.
   */
  cascade?: readonly { collection: SyncCollection; key: string }[];
  /**
   * Offline-defer instead of throwing (spec §5 field dispositions): background
   * jobs (title generation, the memory pipeline) must never lose their local
   * write when the sync server is unreachable. When linked but a Class-2 write
   * is disallowed, the local write still commits (no outbox row, no drain) and
   * syncs later via a subsequent online edit or epoch recovery. User-facing
   * affordances leave this false so the disabled-UI backstop throws instead.
   */
  deferWhenOffline?: boolean;
}): Promise<void> {
  const { collection, key, write, tables, cascade, deferWhenOffline } = args;
  const op = args.op ?? 'upsert';
  const db = getClientDataDb();

  // Local-only passthrough: no gates, no outbox, no drain (spec §5).
  if (useAccountLinkStore.getState().linkStatus !== 'linked') {
    await db.transaction('rw', [...tables], async (tx) => {
      await write(tx);
    });
    return;
  }

  if (!isClass2Allowed()) {
    // Offline-defer site: commit the local write, skip sync, converge later (§5).
    if (deferWhenOffline) {
      await db.transaction('rw', [...tables], async (tx) => {
        await write(tx);
      });
      return;
    }
    // User-facing site: the gate is the programming-error backstop for the
    // disabled UI (the affordance should already be greyed out).
    throw new SyncOfflineError();
  }

  // Local write and outbox row(s) commit as one transaction (write-ahead staging).
  const scope = [...new Set([...tables, 'syncOutbox'])];
  await db.transaction('rw', scope, async (tx) => {
    await write(tx);
    enqueueSync(tx, collection, key, op);
    if (cascade)
      for (const child of cascade) enqueueSync(tx, child.collection, child.key, 'delete');
  });

  // After the commit, drain this key and await the server ack (§5). A crash
  // between the commit and here leaves the entry for the boot reconcile drain.
  if (immediateDrain) await immediateDrain({ collection, key });
}
