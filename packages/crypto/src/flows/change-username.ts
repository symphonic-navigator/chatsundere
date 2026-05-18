// SPDX-License-Identifier: LGPL-3.0-only

import { getLocalAccount, putLocalAccount, requireLocalAccount } from '../db/local-account.js';
import { reqPromise, txDone } from '../db/open.js';
import { STORE_LOCAL_ACCOUNT } from '../db/schema.js';
import { validateUsername } from './create-local-account.js';

export interface ChangeUsernameArgs {
  db: IDBDatabase;
  newUsername: string;
  /** Required when linked. Should call PATCH /v1/me; throw on 409. */
  serverPatch?: (newUsername: string) => Promise<void>;
}

/**
 * Change the local account username. Validates the new name against the
 * platform rules (same regex and reserved-word set as `createLocalAccount`),
 * calls `serverPatch` before writing locally so that a server-side 409 aborts
 * without touching IndexedDB, then writes the updated row in a single
 * transaction.
 *
 * The `linked_account` row has no `username` field; the single source of truth
 * for the username after this call is `local_account.username`.
 */
export async function changeUsername(args: ChangeUsernameArgs): Promise<void> {
  validateUsername(args.newUsername);

  const row = requireLocalAccount(await getLocalAccount(args.db));

  // Call the server first: if it throws (e.g. 409 conflict), local state
  // is unchanged.
  if (args.serverPatch) {
    await args.serverPatch(args.newUsername);
  }

  // Single-transaction write: avoids a torn state if the JS thread is
  // interrupted between two separate `put` calls.
  row.username = args.newUsername;
  const tx = args.db.transaction(STORE_LOCAL_ACCOUNT, 'readwrite');
  await reqPromise(tx.objectStore(STORE_LOCAL_ACCOUNT).put(row, 'primary'));
  await txDone(tx);
}
