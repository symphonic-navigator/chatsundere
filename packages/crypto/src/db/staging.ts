// SPDX-License-Identifier: LGPL-3.0-only

import { reqPromise, txDone } from './open.js';
import { STORE_STAGING, type StagingRow, type StagingState } from './schema.js';

const KEY = 'pending_passphrase_change';

export async function getStaging(db: IDBDatabase): Promise<StagingRow | null> {
  const tx = db.transaction(STORE_STAGING, 'readonly');
  const row = (await reqPromise(tx.objectStore(STORE_STAGING).get(KEY))) as StagingRow | undefined;
  await txDone(tx);
  return row ?? null;
}

export async function putStaging(db: IDBDatabase, row: StagingRow): Promise<void> {
  const tx = db.transaction(STORE_STAGING, 'readwrite');
  await reqPromise(tx.objectStore(STORE_STAGING).put(row));
  await txDone(tx);
}

export async function deleteStaging(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_STAGING, 'readwrite');
  await reqPromise(tx.objectStore(STORE_STAGING).delete(KEY));
  await txDone(tx);
}

export async function setStagingState(db: IDBDatabase, state: StagingState): Promise<void> {
  const tx = db.transaction(STORE_STAGING, 'readwrite');
  const store = tx.objectStore(STORE_STAGING);
  const row = (await reqPromise(store.get(KEY))) as StagingRow | undefined;
  if (!row) {
    await txDone(tx);
    return;
  }
  row.server_state = state;
  await reqPromise(store.put(row));
  await txDone(tx);
}
