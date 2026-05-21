// SPDX-License-Identifier: LGPL-3.0-only

import { deriveLocalAmk, deriveRecoveryAmk } from '../amk.js';
import { getLocalAccount, putLocalAccount } from '../db/local-account.js';
import type { LocalAccountRow } from '../db/schema.js';
import { deleteStaging } from '../db/staging.js';
import { encodeRecoveryKey } from '../encoding/recovery-key.js';
import { CryptoError } from '../errors.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import { deriveVerifierKey } from '../recovery.js';
import { type MasterKeySession, createMasterKeySession } from '../session.js';
import { ARGON2ID_PARAMS, type MasterKey, asMasterKey, asRecoveryKey } from '../types.js';

export interface CreateLocalAccountArgs {
  db: IDBDatabase;
  username: string;
  passphrase: string;
}

export interface CreateLocalAccountResult {
  session: MasterKeySession;
  /**
   * The raw master key bytes. Exposed so callers can pass it to the session
   * store as the dedicated `mk` slice (Task 7) and to operations that
   * require the raw key bytes (e.g. recovery-key regeneration). Never
   * persisted; lives in memory only.
   *
   * IMPORTANT: this is the SAME `Uint8Array` instance that is captured by
   * the session closure. Do NOT `.slice()` it expecting a private copy —
   * `session.close()` zeros this shared buffer, so any caller-held copy
   * would silently turn to zeros at logout time. Treat it as borrowed.
   */
  mk: MasterKey;
  recoveryKeyString: string;
}

/**
 * Build the AAD bytes for a wrapped MK bundle. The scope distinguishes
 * local-passphrase wrapping from recovery-key wrapping. Exported so that
 * login-local can reproduce the same bytes without re-encoding.
 */
export function makeLocalAccountAad(username: string, scope: 'local' | 'recovery'): Uint8Array {
  return new TextEncoder().encode(`${username}::${scope}::v1`);
}

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

/**
 * Validates a candidate username against the platform rules: must match
 * `^[a-z][a-z0-9_-]{2,31}$` and must not be a reserved word.
 * Throws `CryptoError('invalid_input', ...)` on rejection.
 */
export function validateUsername(u: string): void {
  if (!USERNAME_RE.test(u) || RESERVED.has(u)) {
    throw new CryptoError('invalid_input', 'invalid username');
  }
}

/**
 * Create a brand-new local account. Generates the Master Key, the
 * recovery key, and the local salt; derives the AMKs; wraps the MK twice
 * (local + recovery); tags both bundles with integrity HMACs; persists
 * everything to IndexedDB; then returns an open `MasterKeySession`.
 *
 * Throws `CryptoError('conflict', ...)` if a `local_account` already
 * exists (single account per origin). Throws `CryptoError('invalid_input', ...)`
 * for an invalid or reserved username.
 */
export async function createLocalAccount(
  args: CreateLocalAccountArgs,
): Promise<CreateLocalAccountResult> {
  if (await getLocalAccount(args.db)) {
    throw new CryptoError('conflict', 'local account already exists on this origin');
  }
  validateUsername(args.username);

  const mk = asMasterKey(getRandomBytes(32));
  const recoveryKey = asRecoveryKey(getRandomBytes(32));
  const localSalt = getRandomBytes(ARGON2ID_PARAMS.saltLength);

  const localAmk = await deriveLocalAmk(args.passphrase, localSalt);
  const recoveryAmk = await deriveRecoveryAmk(recoveryKey);
  const verifierKey = await deriveVerifierKey(recoveryKey);

  const localAad = makeLocalAccountAad(args.username, 'local');
  const recoveryAad = makeLocalAccountAad(args.username, 'recovery');

  const wrappedLocal = await aeadEncrypt(localAmk, mk, localAad);
  const wrappedRecovery = await aeadEncrypt(recoveryAmk, mk, recoveryAad);

  const localIk = await deriveIntegrityKey(localAmk);
  const recoveryIk = await deriveIntegrityKey(recoveryAmk);
  const localTagged = await addIntegrityHmac(wrappedLocal, localIk);
  const recoveryTagged = await addIntegrityHmac(wrappedRecovery, recoveryIk);

  const row: LocalAccountRow = {
    schema_version: 1,
    username: args.username,
    local_salt: localSalt,
    wrapped_mk_local_ciphertext: localTagged.ciphertext,
    wrapped_mk_local_nonce: localTagged.nonce,
    wrapped_mk_local_aad: localTagged.aad,
    wrapped_mk_local_integrity: localTagged.integrity_hmac,
    wrapped_mk_recovery_ciphertext: recoveryTagged.ciphertext,
    wrapped_mk_recovery_nonce: recoveryTagged.nonce,
    wrapped_mk_recovery_aad: recoveryTagged.aad,
    wrapped_mk_recovery_integrity: recoveryTagged.integrity_hmac,
    recovery_verifier_key: verifierKey,
    created_at: new Date(),
  };
  await putLocalAccount(args.db, row);
  await deleteStaging(args.db);

  const session = createMasterKeySession({
    mk,
    userId: `local-${row.created_at.getTime()}`,
    username: args.username,
    mode: 'local',
    online: false,
    recoveryKey,
  });
  return { session, mk, recoveryKeyString: encodeRecoveryKey(recoveryKey) };
}
