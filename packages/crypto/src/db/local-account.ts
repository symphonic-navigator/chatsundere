// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';
import { reqPromise, txDone } from './open.js';
import { type LocalAccountRow, STORE_LOCAL_ACCOUNT } from './schema.js';

const KEY = 'primary';

export async function getLocalAccount(db: IDBDatabase): Promise<LocalAccountRow | null> {
  const tx = db.transaction(STORE_LOCAL_ACCOUNT, 'readonly');
  const store = tx.objectStore(STORE_LOCAL_ACCOUNT);
  const row = (await reqPromise(store.get(KEY))) as LocalAccountRow | undefined;
  await txDone(tx);
  return row ?? null;
}

export async function putLocalAccount(db: IDBDatabase, row: LocalAccountRow): Promise<void> {
  const tx = db.transaction(STORE_LOCAL_ACCOUNT, 'readwrite');
  const store = tx.objectStore(STORE_LOCAL_ACCOUNT);
  await reqPromise(store.put(row, KEY));
  await txDone(tx);
}

export async function deleteLocalAccount(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_LOCAL_ACCOUNT, 'readwrite');
  const store = tx.objectStore(STORE_LOCAL_ACCOUNT);
  await reqPromise(store.delete(KEY));
  await txDone(tx);
}

export function requireLocalAccount(row: LocalAccountRow | null): LocalAccountRow {
  if (!row) throw new CryptoError('not_found', 'no local account');
  return row;
}
