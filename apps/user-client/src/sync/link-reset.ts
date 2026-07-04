// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
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
    });
  });
}
