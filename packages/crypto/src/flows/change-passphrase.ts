// SPDX-License-Identifier: LGPL-3.0-only

import { deriveLocalAmk } from '../amk.js';
import { getLocalAccount, putLocalAccount, requireLocalAccount } from '../db/local-account.js';
import type { StagingRow } from '../db/schema.js';
import { deleteStaging, getStaging, putStaging, setStagingState } from '../db/staging.js';
import { CryptoError } from '../errors.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import type { MasterKeySession } from '../session.js';
import { ARGON2ID_PARAMS, type MasterKey } from '../types.js';

export interface ChangePassphraseArgs {
  db: IDBDatabase;
  session: MasterKeySession;
  mk: MasterKey;
  newPassphrase: string;
  /**
   * For linked-online mode: a callback that performs the server-side
   * OPAQUE re-registration. Returns when the server has committed.
   * Throws to abort with rollback.
   */
  serverCommit?: () => Promise<void>;
}

export async function changePassphraseLocalOnly(args: ChangePassphraseArgs): Promise<void> {
  if (args.serverCommit) {
    throw new CryptoError('internal', 'use changePassphraseLinkedOnline for linked sessions');
  }
  const row = requireLocalAccount(await getLocalAccount(args.db));
  const { staged } = await prepareStaging(args.db, row.username, args.newPassphrase, args.mk);
  await commitStagingToPrimary(args.db, staged);
  await deleteStaging(args.db);
}

export async function changePassphraseLinkedOnline(args: ChangePassphraseArgs): Promise<void> {
  if (!args.serverCommit) {
    throw new CryptoError('internal', 'serverCommit required for linked-online change');
  }
  const row = requireLocalAccount(await getLocalAccount(args.db));
  const { staged } = await prepareStaging(args.db, row.username, args.newPassphrase, args.mk);
  try {
    await args.serverCommit();
  } catch (err) {
    await setStagingState(args.db, 'rolled_back');
    await deleteStaging(args.db);
    throw err;
  }
  await setStagingState(args.db, 'committed');
  await commitStagingToPrimary(args.db, staged);
  await deleteStaging(args.db);
}

/**
 * On boot, inspect the staging slot. If `pending`: rollback (the server
 * commit never confirmed). If `committed`: finish the swap. If absent:
 * nothing to do.
 */
export async function reconcileStagingOnBoot(db: IDBDatabase): Promise<void> {
  const staging = await getStaging(db);
  if (!staging) return;
  if (staging.server_state === 'pending' || staging.server_state === 'rolled_back') {
    await deleteStaging(db);
    return;
  }
  await commitStagingToPrimary(db, staging);
  await deleteStaging(db);
}

async function prepareStaging(
  db: IDBDatabase,
  username: string,
  newPassphrase: string,
  mk: MasterKey,
): Promise<{ staged: StagingRow }> {
  const newSalt = getRandomBytes(ARGON2ID_PARAMS.saltLength);
  const newAmk = await deriveLocalAmk(newPassphrase, newSalt);
  const aad = new TextEncoder().encode(`${username}::local::v1`);
  const wrapped = await aeadEncrypt(newAmk, mk, aad);
  const ik = await deriveIntegrityKey(newAmk);
  const tagged = await addIntegrityHmac(wrapped, ik);
  const staged: StagingRow = {
    key: 'pending_passphrase_change',
    new_local_salt: newSalt,
    new_wrapped_mk_local_ciphertext: tagged.ciphertext,
    new_wrapped_mk_local_nonce: tagged.nonce,
    new_wrapped_mk_local_aad: tagged.aad,
    new_wrapped_mk_local_integrity: tagged.integrity_hmac,
    server_state: 'pending',
    created_at: new Date(),
  };
  await putStaging(db, staged);
  return { staged };
}

async function commitStagingToPrimary(db: IDBDatabase, staged: StagingRow): Promise<void> {
  const row = requireLocalAccount(await getLocalAccount(db));
  row.local_salt = staged.new_local_salt;
  row.wrapped_mk_local_ciphertext = staged.new_wrapped_mk_local_ciphertext;
  row.wrapped_mk_local_nonce = staged.new_wrapped_mk_local_nonce;
  row.wrapped_mk_local_aad = staged.new_wrapped_mk_local_aad;
  row.wrapped_mk_local_integrity = staged.new_wrapped_mk_local_integrity;
  await putLocalAccount(db, row);
}
