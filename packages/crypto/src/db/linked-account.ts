// SPDX-License-Identifier: LGPL-3.0-only

import { reqPromise, txDone } from './open.js';
import { type LinkedAccountRow, STORE_LINKED_ACCOUNT } from './schema.js';

const KEY = 'primary';

export async function getLinkedAccount(db: IDBDatabase): Promise<LinkedAccountRow | null> {
  const tx = db.transaction(STORE_LINKED_ACCOUNT, 'readonly');
  const row = (await reqPromise(tx.objectStore(STORE_LINKED_ACCOUNT).get(KEY))) as
    | LinkedAccountRow
    | undefined;
  await txDone(tx);
  return row ?? null;
}

export async function putLinkedAccount(db: IDBDatabase, row: LinkedAccountRow): Promise<void> {
  const tx = db.transaction(STORE_LINKED_ACCOUNT, 'readwrite');
  await reqPromise(tx.objectStore(STORE_LINKED_ACCOUNT).put(row, KEY));
  await txDone(tx);
}

export async function deleteLinkedAccount(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_LINKED_ACCOUNT, 'readwrite');
  await reqPromise(tx.objectStore(STORE_LINKED_ACCOUNT).delete(KEY));
  await txDone(tx);
}
