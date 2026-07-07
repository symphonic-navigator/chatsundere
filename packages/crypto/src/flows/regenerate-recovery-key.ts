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

export interface RegenerateRecoveryKeyResult {
  recoveryKeyString: string;
  /**
   * True only on the linked-path tail failure: the server accepted the new
   * material but the local IndexedDB write then failed. Deviceless recovery
   * now accepts ONLY the returned key, while local recovery-key sign-in on
   * this device still uses the old one until a later successful rotation.
   * Callers MUST still reveal the key to the user in this state — discarding
   * it would leave deviceless recovery demanding a key nobody holds.
   */
  localWriteFailed: boolean;
}

/**
 * Rotate the recovery key. Ordering is load-bearing on the linked path:
 * the server is updated FIRST, so the common failure (server unreachable)
 * changes nothing anywhere and the old key stays fully valid. A failure of
 * the subsequent local write does NOT throw — see
 * {@link RegenerateRecoveryKeyResult.localWriteFailed}.
 */
export async function regenerateRecoveryKey(
  args: RegenerateRecoveryKeyArgs,
): Promise<RegenerateRecoveryKeyResult> {
  const row = requireLocalAccount(await getLocalAccount(args.db));
  const newRk = asRecoveryKey(getRandomBytes(32));
  const newAmk = await deriveRecoveryAmk(newRk);
  const newVerifier = await deriveVerifierKey(newRk);
  const aad = makeLocalAccountAad(row.username, 'recovery');
  const wrapped = await aeadEncrypt(newAmk, args.mk, aad);
  const ik = await deriveIntegrityKey(newAmk);
  const tagged = await addIntegrityHmac(wrapped, ik);

  // Server first: if this throws, nothing has changed anywhere.
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
  try {
    await putLocalAccount(args.db, row);
  } catch (e) {
    if (args.serverUpdate) {
      // The server already holds the new material: the returned key is now
      // the ONLY one deviceless recovery accepts. Swallowing it behind a
      // "nothing changed" error would strand the user with a key nobody
      // holds — a permanent-lockout class defect on a no-recovery platform.
      return { recoveryKeyString: encodeRecoveryKey(newRk), localWriteFailed: true };
    }
    // Local-only path: the failed write IS the rotation, so nothing changed
    // and the old key remains valid. Propagate honestly.
    throw e;
  }
  return { recoveryKeyString: encodeRecoveryKey(newRk), localWriteFailed: false };
}
