// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';

/**
 * Fails a stranded tab closed once another tab's update took over its service
 * worker: this page's code is now older than the worker serving it, so it must
 * stop writing. Streams are aborted first so their partial output is kept as
 * incomplete; then the data DB is closed so background writers (sync loop,
 * memory, title jobs) cannot persist rows shaped by old code (spec §2.5).
 */
export async function quiesceStrandedTab(): Promise<void> {
  try {
    await useStreamManagerStore.getState().abortAll();
  } catch (err) {
    console.error('[app-update] aborting streams while quiescing failed', err);
  }
  try {
    getClientDataDb().close();
  } catch (err) {
    // Expected before unlock, when no data DB has been opened yet.
    console.warn('[app-update] closing the data DB while quiescing failed', err);
  }
}
