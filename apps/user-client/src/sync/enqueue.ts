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
}): Promise<void> {
  const { collection, key, write, tables } = args;
  const op = args.op ?? 'upsert';
  const db = getClientDataDb();

  // Local-only passthrough: no gates, no outbox, no drain (spec §5).
  if (useAccountLinkStore.getState().linkStatus !== 'linked') {
    await db.transaction('rw', [...tables], async (tx) => {
      await write(tx);
    });
    return;
  }

  // Linked: the gate is the programming-error backstop for the disabled UI.
  if (!isClass2Allowed()) throw new SyncOfflineError();

  // Local write and outbox row commit as one transaction (write-ahead staging).
  const scope = [...new Set([...tables, 'syncOutbox'])];
  await db.transaction('rw', scope, async (tx) => {
    await write(tx);
    enqueueSync(tx, collection, key, op);
  });

  // After the commit, drain this key and await the server ack (§5). A crash
  // between the commit and here leaves the entry for the boot reconcile drain.
  if (immediateDrain) await immediateDrain({ collection, key });
}
