// SPDX-License-Identifier: AGPL-3.0-only

// Temporary front-end helper until packages/crypto exposes a proper
// renamePasskey flow. Reads the existing credential row, replaces the label,
// and upserts via putPasskeyCredential.

import { getPasskeyCredential, putPasskeyCredential } from '@chatsundere/crypto';

export interface RenamePasskeyArgs {
  db: IDBDatabase;
  credentialId: Uint8Array;
  newLabel: string;
}

/**
 * Renames a locally-stored passkey credential by updating its `label` field.
 * All other fields on the row are preserved unchanged.
 *
 * Throws if no credential with the given `credentialId` exists in IDB.
 */
export async function renamePasskey(args: RenamePasskeyArgs): Promise<void> {
  const row = await getPasskeyCredential(args.db, args.credentialId);
  if (!row) {
    throw new Error(`Passkey credential not found: ${args.credentialId.toString()}`);
  }
  await putPasskeyCredential(args.db, { ...row, label: args.newLabel });
}
