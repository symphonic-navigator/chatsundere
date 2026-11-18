// SPDX-License-Identifier: LGPL-3.0-only

import { derivePrfAmk } from '../amk.js';
import { getLocalAccount, requireLocalAccount } from '../db/local-account.js';
import { getPasskeyCredential, putPasskeyCredential } from '../db/passkey-credentials.js';
import { CryptoError } from '../errors.js';
import { aeadDecrypt } from '../primitives/aead.js';
import { deriveIntegrityKey, verifyIntegrityHmac } from '../primitives/integrity.js';
import { createMasterKeySession } from '../session.js';
import { WRAP_ALGO, asMasterKey } from '../types.js';
import { verifyLocalAssertion } from '../webauthn/local-verify.js';
import { credentialIdPrefix } from '../webauthn/prf.js';
import type { LoginLocalResult } from './login-local.js';

export interface LoginWithLocalBiometricArgs {
  db: IDBDatabase;
  credentialId: Uint8Array;
  challenge: Uint8Array;
  clientDataJson: string;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  prfOutput: Uint8Array;
  origin: string;
}

/**
 * Unwrap the local MK with a passkey. Verifies the WebAuthn assertion against
 * the stored credential (signature, origin, sign counter), derives the PRF AMK,
 * verifies the integrity HMAC, AES-256-GCM-decrypts the PRF-wrapped MK and
 * persists the new sign counter. Returns an open `MasterKeySession` and the MK.
 *
 * The returned `mk` is the very buffer the session captures, not a copy, so
 * `session.close()` zeroes both at once.
 *
 * Throws `CryptoError('not_found', ...)` for an unknown credential,
 * `CryptoError('webauthn_verification_failed', ...)` or
 * `CryptoError('webauthn_sign_counter_rollback', ...)` for a rejected
 * assertion, and `CryptoError('integrity_check_failed', ...)` for a wrong PRF
 * output or a tampered bundle. The sign counter is persisted only on success.
 */
export async function loginWithLocalBiometric(
  args: LoginWithLocalBiometricArgs,
): Promise<LoginLocalResult> {
  const local = requireLocalAccount(await getLocalAccount(args.db));
  const cred = await getPasskeyCredential(args.db, args.credentialId);
  if (!cred) throw new CryptoError('not_found', 'unknown credential');

  const { newSignCounter } = await verifyLocalAssertion({
    credentialId: cred.credential_id,
    publicKey: cred.public_key,
    storedSignCounter: cred.sign_counter,
    receivedSignCounter: parseSignCounterFromAuthData(args.authenticatorData),
    aaguid: cred.aaguid,
    challenge: args.challenge,
    clientDataJson: args.clientDataJson,
    authenticatorData: args.authenticatorData,
    signature: args.signature,
    origin: args.origin,
  });

  const prefix = credentialIdPrefix(cred.credential_id);
  const amk = await derivePrfAmk(args.prfOutput, prefix);

  const wrapped = {
    ciphertext: cred.wrapped_mk_prf_ciphertext,
    nonce: cred.wrapped_mk_prf_nonce,
    aad: cred.wrapped_mk_prf_aad,
    algo: WRAP_ALGO as typeof WRAP_ALGO,
    integrity_hmac: cred.wrapped_mk_prf_integrity,
  };
  const ik = await deriveIntegrityKey(amk);
  if (!(await verifyIntegrityHmac(wrapped, ik))) {
    throw new CryptoError('integrity_check_failed', 'biometric bundle integrity mismatch');
  }
  const mkBytes = await aeadDecrypt(amk, wrapped, wrapped.aad);

  // Persist updated sign counter.
  cred.sign_counter = newSignCounter;
  await putPasskeyCredential(args.db, cred);

  const mk = asMasterKey(mkBytes);
  const session = createMasterKeySession({
    mk,
    userId: `local-${local.created_at.getTime()}`,
    username: local.username,
    mode: 'local',
    online: false,
  });
  return { session, mk };
}

function parseSignCounterFromAuthData(authData: Uint8Array): number {
  // authData layout: rpIdHash(32) || flags(1) || signCount(4 BE) || ...
  if (authData.length < 37) return 0;
  const dv = new DataView(authData.buffer, authData.byteOffset + 33, 4);
  return dv.getUint32(0, false);
}
