// SPDX-License-Identifier: LGPL-3.0-only

import { reqPromise, txDone } from './open.js';
import {
  type LinkedAccountRow,
  type LocalAccountRow,
  STORE_LINKED_ACCOUNT,
  STORE_LOCAL_ACCOUNT,
} from './schema.js';

const KEY = 'primary';

/**
 * Write both the `local_account` and `linked_account` rows in a single
 * multi-store IDB transaction. This prevents the partial-write state where
 * a `local_account` row exists but no `linked_account` row does, which would
 * leave the app with no recovery path.
 */
export async function putLocalAndLinkedAccount(
  db: IDBDatabase,
  localRow: LocalAccountRow,
  linkedRow: LinkedAccountRow,
): Promise<void> {
  const tx = db.transaction([STORE_LOCAL_ACCOUNT, STORE_LINKED_ACCOUNT], 'readwrite');
  tx.objectStore(STORE_LOCAL_ACCOUNT).put(localRow, KEY);
  tx.objectStore(STORE_LINKED_ACCOUNT).put(linkedRow, KEY);
  await txDone(tx);
}
