// SPDX-License-Identifier: AGPL-3.0-only
import { getLinkedAccount } from '@chatsundere/crypto';
import { getClientDataDb } from '../boot/client-data-db.js';
import { getDb } from '../boot/open-db.js';
import { setAuthDegraded } from '../lib/auth-degrade.js';
import { getSyncState } from './watermark.js';

/**
 * Per-link engine-state reset (spec §3.2, Larissa L-1). An invitation join
 * ALWAYS binds to a fresh, empty server account, so on every link success the
 * per-account engine state must be discarded: stale `syncRows` would make the
 * backfill predicate skip rows the OLD account had synced (silent data
 * stranding), a stale watermark draws 400 `bad_since` on the first pull, and
 * stale CAS bases are meaningless against the new account. Also arms the
 * backfill flag — the two always travel together.
 */
export async function resetEngineStateForNewLink(): Promise<void> {
  const db = getClientDataDb();
  await getSyncState(); // ensure the singleton exists before update()
  // Read the crypto IDB's linked-account identity BEFORE opening the Dexie
  // transaction below: awaiting the unrelated crypto-DB connection from inside
  // a Dexie transaction callback would let Dexie auto-commit it early (no
  // Dexie op pending on that microtask tick).
  const linked = await getLinkedAccount(getDb());
  await db.transaction('rw', db.syncRows, db.syncOutbox, db.syncState, async () => {
    await db.syncRows.clear();
    await db.syncOutbox.clear();
    await db.syncState.update('state', {
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: true,
      backfillTotal: null,
      backfillDone: null,
      linkedServerUserId: linked?.server_user_id,
    });
  });
  // Clear the in-memory auth-degraded latch too: this fresh account holds valid
  // tokens, so a stale latch from a prior account would otherwise keep the engine
  // gated off (`canRunCycle` returns false) until a full reload. The relink
  // affordance routes here, so without this the offered recovery never actually
  // resumes the engine. The transaction above already nulled the persisted
  // attention, so this only resets the process-local boolean.
  await setAuthDegraded(false);
}

/**
 * Decouple/local-only reset (spec §3.2). When a device drops its server link —
 * deliberate decouple or backend unreachable at registration — all sync
 * bookkeeping is discarded exactly as on a fresh link, EXCEPT the backfill
 * flag stays false: local-only mode has no engine to run a backfill, so
 * arming it would just leave a dangling `backfillPending: true` for the next
 * link to trip over.
 */
export async function resetEngineStateForLocalOnly(): Promise<void> {
  const db = getClientDataDb();
  await getSyncState(); // ensure the singleton exists before update()
  await db.transaction('rw', db.syncRows, db.syncOutbox, db.syncState, async () => {
    await db.syncRows.clear();
    await db.syncOutbox.clear();
    await db.syncState.update('state', {
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
      linkedServerUserId: undefined,
    });
  });
}
