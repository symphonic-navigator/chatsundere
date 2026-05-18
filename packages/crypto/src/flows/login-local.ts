// SPDX-License-Identifier: LGPL-3.0-only

import { deriveLocalAmk, deriveRecoveryAmk } from '../amk.js';
import { getLocalAccount, requireLocalAccount } from '../db/local-account.js';
import { listPasskeyCredentials } from '../db/passkey-credentials.js';
import type { PasskeyCredentialRow } from '../db/schema.js';
import { decodeRecoveryKey } from '../encoding/recovery-key.js';
import { CryptoError } from '../errors.js';
import { aeadDecrypt } from '../primitives/aead.js';
import { deriveIntegrityKey, verifyIntegrityHmac } from '../primitives/integrity.js';
import { type MasterKeySession, createMasterKeySession } from '../session.js';
import { type AMK, type MasterKey, WRAP_ALGO, asMasterKey } from '../types.js';

export interface LoginLocalWithPassphraseArgs {
  db: IDBDatabase;
  passphrase: string;
}

export interface LoginLocalResult {
  session: MasterKeySession;
  /** The raw MK bytes, available for callers that need to re-wrap under a new credential. */
  mk: MasterKey;
}

/**
 * Unwrap the local MK using the passphrase. Re-derives the local AMK from
 * the stored salt, verifies the integrity HMAC, then AES-256-GCM-decrypts
 * the wrapped MK. Returns an open `MasterKeySession` and the MK on success.
 *
 * Throws `CryptoError('integrity_check_failed', ...)` if the IndexedDB
 * bundle has been tampered with. Throws `CryptoError('wrong_passphrase', ...)`
 * if the derived AMK does not authenticate the ciphertext.
 */
export async function loginLocalWithPassphrase(
  args: LoginLocalWithPassphraseArgs,
): Promise<LoginLocalResult> {
  const row = requireLocalAccount(await getLocalAccount(args.db));
  const amk = await deriveLocalAmk(args.passphrase, row.local_salt);
  return unwrapAndOpenSession(row, amk, {
    ciphertext: row.wrapped_mk_local_ciphertext,
    nonce: row.wrapped_mk_local_nonce,
    aad: row.wrapped_mk_local_aad,
    integrity: row.wrapped_mk_local_integrity,
  });
}

export interface LoginLocalWithRecoveryKeyArgs {
  db: IDBDatabase;
  recoveryKeyString: string;
}

/**
 * Unwrap the local MK using the printed recovery key string. Decodes and
 * verifies the recovery key's checksum, derives the recovery AMK, verifies
 * the integrity HMAC, then AES-256-GCM-decrypts the wrapped MK.
 *
 * Throws `CryptoError('invalid_recovery_key_format', ...)` for a malformed
 * or checksum-failed key string. Throws `CryptoError('integrity_check_failed', ...)`
 * if the bundle has been tampered with. Throws `CryptoError('wrong_passphrase', ...)`
 * if the AMK does not authenticate the ciphertext.
 */
export async function loginLocalWithRecoveryKey(
  args: LoginLocalWithRecoveryKeyArgs,
): Promise<LoginLocalResult> {
  const row = requireLocalAccount(await getLocalAccount(args.db));
  // decodeRecoveryKey throws CryptoError('invalid_recovery_key_format', ...) on bad checksum.
  const rk = decodeRecoveryKey(args.recoveryKeyString);
  const amk = await deriveRecoveryAmk(rk);
  return unwrapAndOpenSession(row, amk, {
    ciphertext: row.wrapped_mk_recovery_ciphertext,
    nonce: row.wrapped_mk_recovery_nonce,
    aad: row.wrapped_mk_recovery_aad,
    integrity: row.wrapped_mk_recovery_integrity,
  });
}

/** Returns the list of locally-registered biometric credentials, or [] when none. */
export async function listLocalBiometric(db: IDBDatabase): Promise<PasskeyCredentialRow[]> {
  return listPasskeyCredentials(db);
}

interface WrappedBundle {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  /** AAD as stored in IndexedDB — must match the wrap-time value exactly. */
  aad: Uint8Array;
  integrity: Uint8Array;
}

async function unwrapAndOpenSession(
  row: Awaited<ReturnType<typeof getLocalAccount>>,
  amk: AMK,
  bundle: WrappedBundle,
): Promise<LoginLocalResult> {
  // requireLocalAccount already guards null, but the type signature of
  // getLocalAccount returns LocalAccountRow | null, so the helper narrows it.
  if (!row) throw new CryptoError('not_found', 'no local account');

  const wrapped = {
    ciphertext: bundle.ciphertext,
    nonce: bundle.nonce,
    aad: bundle.aad,
    algo: WRAP_ALGO as typeof WRAP_ALGO,
    integrity_hmac: bundle.integrity,
  };

  const ik = await deriveIntegrityKey(amk);
  const ok = await verifyIntegrityHmac(wrapped, ik);
  if (!ok) {
    throw new CryptoError('integrity_check_failed', 'IndexedDB bundle integrity mismatch');
  }

  let mkBytes: Uint8Array;
  try {
    // bundle.aad was stored alongside the ciphertext; it equals the wrap-time AAD verbatim.
    mkBytes = await aeadDecrypt(amk, wrapped, bundle.aad);
  } catch {
    throw new CryptoError(
      'wrong_passphrase',
      'MK unwrap failed — wrong passphrase or recovery key',
    );
  }

  const mk = asMasterKey(mkBytes);
  return {
    mk,
    session: createMasterKeySession({
      mk,
      userId: `local-${row.created_at.getTime()}`,
      username: row.username,
      mode: 'local',
      online: false,
    }),
  };
}
