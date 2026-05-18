// SPDX-License-Identifier: LGPL-3.0-only

import { derivePrfAmk } from '../amk.js';
import { putPasskeyCredential } from '../db/passkey-credentials.js';
import type { PasskeyCredentialRow } from '../db/schema.js';
import { CryptoError } from '../errors.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import type { MasterKeySession } from '../session.js';
import type { MasterKey } from '../types.js';
import { credentialIdPrefix } from '../webauthn/prf.js';

export interface CompleteLocalBiometricRegistrationArgs {
  db: IDBDatabase;
  session: MasterKeySession;
  /** The MK from the session, exposed for the wrap operation. */
  mk: MasterKey;
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  aaguid: string | null;
  prfOutput: Uint8Array;
  label: string;
}

/**
 * After the UI has invoked navigator.credentials.create() with PRF and
 * obtained credentialId + publicKey + prfOutput, persist a new biometric
 * credential row that wraps the session's MK.
 */
export async function completeLocalBiometricRegistration(
  args: CompleteLocalBiometricRegistrationArgs,
): Promise<void> {
  if (args.prfOutput.length !== 32) {
    throw new CryptoError('prf_not_supported', 'PRF output must be 32 bytes');
  }
  const prefix = credentialIdPrefix(args.credentialId);
  const amk = await derivePrfAmk(args.prfOutput, prefix);
  const aad = new TextEncoder().encode(`${args.session.userId}::prf::${prefix}::v1`);
  const wrapped = await aeadEncrypt(amk, args.mk, aad);
  const ik = await deriveIntegrityKey(amk);
  const tagged = await addIntegrityHmac(wrapped, ik);

  const row: PasskeyCredentialRow = {
    credential_id: args.credentialId,
    public_key: args.publicKey,
    sign_counter: 0,
    aaguid: args.aaguid,
    label: args.label,
    wrapped_mk_prf_ciphertext: tagged.ciphertext,
    wrapped_mk_prf_nonce: tagged.nonce,
    wrapped_mk_prf_aad: tagged.aad,
    wrapped_mk_prf_integrity: tagged.integrity_hmac,
    is_synced_with_server: false,
    created_at: new Date(),
  };
  await putPasskeyCredential(args.db, row);
}
