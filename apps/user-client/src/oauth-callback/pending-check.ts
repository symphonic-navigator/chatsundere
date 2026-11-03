// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Whether this browser holds the pending sign-in a callback names. `unknown` whenever
 * the answer is not certain: storage partitioned (an iOS home-screen app), no database,
 * an older schema, or any error.
 */
export type PendingPresence = 'present' | 'absent' | 'unknown';

/**
 * The app's Dexie database name, copied rather than imported: the callback page stays
 * free of Dexie and of the app's modules. A test pins it to `DB_NAME`.
 */
export const CLIENT_DATA_DB_NAME = 'chatsundere_client_data';
const STORE = 'mcpOAuthPending';
/** Opening can stall behind an upgrade in another tab; the page must not wait on it. */
const CHECK_TIMEOUT_MS = 1000;

/**
 * Looks up `state` in the app's `mcpOAuthPending` table with the raw IndexedDB API.
 * Never creates or upgrades the database: an open that would do either is aborted.
 */
export function checkPendingState(
  idb: IDBFactory | undefined,
  state: string,
  opts: { dbName?: string; timeoutMs?: number } = {},
): Promise<PendingPresence> {
  if (!idb) return Promise.resolve('unknown');
  return new Promise<PendingPresence>((resolve) => {
    let settled = false;
    let db: IDBDatabase | null = null;
    const finish = (v: PendingPresence) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        db?.close();
      } catch {
        // Already closed.
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish('unknown'), opts.timeoutMs ?? CHECK_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(opts.dbName ?? CLIENT_DATA_DB_NAME);
    } catch {
      finish('unknown');
      return;
    }
    req.onupgradeneeded = () => {
      // The database did not exist; aborting the version change leaves nothing behind.
      try {
        req.transaction?.abort();
      } catch {
        // Nothing to abort.
      }
      finish('unknown');
    };
    req.onblocked = () => finish('unknown');
    req.onerror = (e) => {
      // An aborted upgrade lands here too; keep the error from reaching the console.
      e.preventDefault?.();
      finish('unknown');
    };
    req.onsuccess = () => {
      db = req.result;
      // The app may need to upgrade while this page is open; never stand in its way.
      db.onversionchange = () => db?.close();
      if (settled) {
        db.close();
        return;
      }
      if (!db.objectStoreNames.contains(STORE)) {
        finish('unknown');
        return;
      }
      try {
        const get = db.transaction(STORE, 'readonly').objectStore(STORE).getKey(state);
        get.onsuccess = () => finish(get.result === undefined ? 'absent' : 'present');
        get.onerror = (e) => {
          e.preventDefault?.();
          finish('unknown');
        };
      } catch {
        finish('unknown');
      }
    };
  });
}
