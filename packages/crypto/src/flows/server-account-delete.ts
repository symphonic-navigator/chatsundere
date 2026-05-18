// SPDX-License-Identifier: LGPL-3.0-only

import { deleteLinkedAccount, getLinkedAccount } from '../db/linked-account.js';
import { CryptoError } from '../errors.js';
import type { ServerClient } from '../server-client.js';

export interface DeleteServerAccountArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  accessToken: string;
}

/**
 * Tells the server to delete the user account, then removes the
 * `linked_account` row locally. Does NOT touch `local_account` —
 * the user keeps their local data and can link to a different
 * operator.
 */
export async function deleteServerAccount(args: DeleteServerAccountArgs): Promise<void> {
  const linked = await getLinkedAccount(args.db);
  if (!linked) throw new CryptoError('not_found', 'no linked account on this device');
  await args.serverClient.deleteMe(linked.base_url, args.accessToken);
  await deleteLinkedAccount(args.db);
}
