// SPDX-License-Identifier: LGPL-3.0-only

import { deriveRecoveryAmk } from '../amk.js';
import { getLocalAccount, putLocalAccount, requireLocalAccount } from '../db/local-account.js';
import { encodeRecoveryKey } from '../encoding/recovery-key.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import { deriveVerifierKey } from '../recovery.js';
import { type MasterKey, asRecoveryKey } from '../types.js';

export interface RegenerateRecoveryKeyArgs {
  db: IDBDatabase;
  mk: MasterKey;
  /**
   * For linked accounts: a callback that pushes the new verifier_key and
   * new wrapped_mk_recovery to the server. Omit for local-only accounts.
   */
  serverUpdate?: (args: {
    new_recovery_verifier_key: Uint8Array;
    new_wrapped_mk_recovery_ciphertext: Uint8Array;
    new_wrapped_mk_recovery_nonce: Uint8Array;
    new_wrapped_mk_recovery_aad: Uint8Array;
  }) => Promise<void>;
}

export async function regenerateRecoveryKey(
  args: RegenerateRecoveryKeyArgs,
): Promise<{ recoveryKeyString: string }> {
  const row = requireLocalAccount(await getLocalAccount(args.db));
  const newRk = asRecoveryKey(getRandomBytes(32));
  const newAmk = await deriveRecoveryAmk(newRk);
  const newVerifier = await deriveVerifierKey(newRk);
  const aad = makeLocalAccountAad(row.username, 'recovery');
  const wrapped = await aeadEncrypt(newAmk, args.mk, aad);
  const ik = await deriveIntegrityKey(newAmk);
  const tagged = await addIntegrityHmac(wrapped, ik);

  if (args.serverUpdate) {
    await args.serverUpdate({
      new_recovery_verifier_key: newVerifier,
      new_wrapped_mk_recovery_ciphertext: tagged.ciphertext,
      new_wrapped_mk_recovery_nonce: tagged.nonce,
      new_wrapped_mk_recovery_aad: tagged.aad,
    });
  }

  row.wrapped_mk_recovery_ciphertext = tagged.ciphertext;
  row.wrapped_mk_recovery_nonce = tagged.nonce;
  row.wrapped_mk_recovery_aad = tagged.aad;
  row.wrapped_mk_recovery_integrity = tagged.integrity_hmac;
  row.recovery_verifier_key = newVerifier;
  await putLocalAccount(args.db, row);
  return { recoveryKeyString: encodeRecoveryKey(newRk) };
}
