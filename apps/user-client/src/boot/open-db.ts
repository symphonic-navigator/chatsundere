// SPDX-License-Identifier: AGPL-3.0-only
import { openLocalDb } from '@chatsundere/crypto';
import { openClientDataDb } from './client-data-db.js';

let dbHandle: IDBDatabase | null = null;
let pending: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (pending) return pending;
  pending = (async () => {
    const [crypto, _client] = await Promise.all([openLocalDb(), openClientDataDb()]);
    dbHandle = crypto;
    pending = null;
    return crypto;
  })();
  return pending;
}

export function getDb(): IDBDatabase {
  if (!dbHandle) throw new Error('IDB not opened — call openDb() during boot first');
  return dbHandle;
}

/**
 * Release the boot-retained raw crypto `IDBDatabase` handle without deleting any
 * data. Used by the complete-wipe (`wipeDevice`) so the subsequent
 * `indexedDB.deleteDatabase(CRYPTO_DB_NAME)` sees no open connection and can run
 * to completion instead of tripping the browser's `onblocked` path — the same
 * close-before-delete guarantee `closeClientDataDb` provides for the Dexie DBs.
 * Clearing `pending` too prevents an in-flight `openDb()` from resurrecting the
 * handle after we have closed it.
 */
export function closeDb(): void {
  dbHandle?.close();
  dbHandle = null;
  pending = null;
}
