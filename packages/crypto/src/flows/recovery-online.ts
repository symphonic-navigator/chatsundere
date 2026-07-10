// SPDX-License-Identifier: LGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { deriveOpaqueAmk, deriveRecoveryAmk } from '../amk.js';
import { putLinkedAccount } from '../db/linked-account.js';
import { getLocalAccount, putLocalAccount, requireLocalAccount } from '../db/local-account.js';
import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { decodeRecoveryKey } from '../encoding/recovery-key.js';
import { CryptoError } from '../errors.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../opaque/client.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadDecrypt, aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { computeRecoveryProof, deriveVerifierKey } from '../recovery.js';
import type { ServerClient } from '../server-client.js';
import { createMasterKeySession } from '../session.js';
import type { MasterKeySession } from '../session.js';
import { type MasterKey, WRAP_ALGO, asMasterKey } from '../types.js';

export interface RecoveryOnlineArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  baseUrl: string;
  /** The username claimed by the user — server validates against the stored record. */
  username: string;
  /** The printed recovery key string (e.g. "ABCD-EFGH-…"). */
  recoveryKeyString: string;
  /** New passphrase to install for the fresh OPAQUE registration. */
  newPassphrase: string;
}

export interface RecoveryOnlineResult {
  session: MasterKeySession;
  /**
   * The recovered master key. Borrowed — the same buffer is captured by the
   * session closure. `session.close()` zeroes this buffer; do not store a copy.
   */
  mk: MasterKey;
}

/**
 * Server-assisted recovery flow. Proves possession of the recovery key via an
 * HMAC proof, re-registers OPAQUE under the new passphrase, and rotates all
 * server-side wraps to match. The recovery key itself is not rotated here —
 * callers may follow up with `regenerateRecoveryKey` if desired.
 *
 * On success the `linked_account` row is updated with new opaque wraps and
 * the `local_account` row is updated with the new recovery wrap matching the
 * server's copy. Returns `{ session, mk }` — a fresh linked+online session
 * carrying the server-issued access token, so the caller can adopt it
 * directly and present the main UI already authenticated for sync.
 *
 * Protocol summary (two server round-trips):
 *
 *   1. Client starts fresh OPAQUE registration with `newPassphrase` →
 *      `registration_request`.
 *   2. POST /recovery/start { username, registration_request } →
 *      { nonce, wrapped_mk_recovery, wrap_nonce_recovery, wrap_aad_recovery,
 *        registration_response }.
 *   3. Client unwraps MK using the recovery key.
 *   4. Client computes HMAC proof over (nonce, username, server_id).
 *   5. Client finishes OPAQUE registration with server's `registration_response`
 *      → { registrationRecord, exportKey } → new opaque_amk.
 *   6. Client wraps MK under new opaque_amk and re-wraps MK under recovery_amk
 *      (re-using the existing recovery key so local_account wraps stay consistent).
 *   7. POST /recovery/finish { username, nonce, proof, registration_record,
 *        new_wrapped_mk_opaque, new_wrapped_mk_recovery, … } →
 *      { user_id, role, access_token, expires_in }.
 *   8. Client persists updated linked_account and local_account rows.
 *   9. Returns `{ session, mk }`.
 */
export async function recoveryOnline(args: RecoveryOnlineArgs): Promise<RecoveryOnlineResult> {
  const serverId = opaqueServerIdentity(args.baseUrl);
  const rk = decodeRecoveryKey(args.recoveryKeyString);

  // Step 1 — start fresh OPAQUE registration for the new passphrase.
  const { clientRegistrationState, registrationRequest } = await opaqueRegistrationStart(
    args.newPassphrase,
  );

  // Step 2 — POST /recovery/start. Server issues the wrapped MK and the
  // OPAQUE registration_response in a single call so the client can finish
  // registration without an extra round-trip.
  const start = await args.serverClient.recoveryStart(
    { username: args.username, registration_request: registrationRequest },
    args.baseUrl,
  );

  // Step 3 — Unwrap MK with recovery key. Server stores the wrap without
  // an integrity HMAC (that is a client-side IndexedDB invariant only),
  // so we skip verifyIntegrityHmac here.
  const recoveryAmk = await deriveRecoveryAmk(rk);
  const serverWrapped = {
    ciphertext: fromBase64Url(start.wrapped_mk_recovery),
    nonce: fromBase64Url(start.wrap_nonce_recovery),
    aad: fromBase64Url(start.wrap_aad_recovery),
    algo: WRAP_ALGO as typeof WRAP_ALGO,
    integrity_hmac: new Uint8Array(),
  };

  let mkBytes: Uint8Array;
  try {
    mkBytes = await aeadDecrypt(recoveryAmk, serverWrapped, serverWrapped.aad);
  } catch {
    throw new CryptoError('wrong_recovery_key', 'MK unwrap with recovery key failed');
  }
  const mk = asMasterKey(mkBytes);

  // Step 4 — Compute HMAC proof over the server-issued nonce.
  const proofBytes = await computeRecoveryProof(
    rk,
    fromBase64Url(start.nonce),
    args.username,
    serverId,
  );

  // Step 5 — Finish OPAQUE registration against the server's response.
  const { registrationRecord, exportKey } = await opaqueRegistrationFinish({
    clientRegistrationState,
    registrationResponse: start.registration_response,
    passphrase: args.newPassphrase,
    username: args.username,
    serverIdentity: serverId,
  });
  const newOpaqueAmk = await deriveOpaqueAmk(exportKey);

  // Step 6 — Wrap MK under the new opaque_amk.
  const opaqueAad = makeLocalAccountAad(args.username, 'opaque');
  const newOpaqueWrap = await aeadEncrypt(newOpaqueAmk, mk, opaqueAad);
  const opaqueIk = await deriveIntegrityKey(newOpaqueAmk);
  const newOpaqueTagged = await addIntegrityHmac(newOpaqueWrap, opaqueIk);

  // Re-wrap MK under the existing recovery_amk so local_account and server
  // copies remain consistent. Recovery key itself is not rotated here.
  const recoveryAad = makeLocalAccountAad(args.username, 'recovery');
  const newRecoveryWrap = await aeadEncrypt(recoveryAmk, mk, recoveryAad);
  // No integrity HMAC needed for the server copy; we compute one for IndexedDB.
  const recoveryIk = await deriveIntegrityKey(recoveryAmk);
  const newRecoveryTagged = await addIntegrityHmac(newRecoveryWrap, recoveryIk);

  // Re-derive verifier key (unchanged, since recovery key is unchanged).
  const verifierKey = await deriveVerifierKey(rk);

  // Step 7 — POST /recovery/finish.
  const finish = await args.serverClient.recoveryFinish(
    {
      username: args.username,
      nonce: start.nonce,
      proof: toBase64Url(proofBytes),
      registration_record: toBase64Url(registrationRecord),
      new_wrapped_mk_opaque: toBase64Url(newOpaqueTagged.ciphertext),
      new_wrap_nonce_opaque: toBase64Url(newOpaqueTagged.nonce),
      new_wrap_aad_opaque: toBase64Url(newOpaqueTagged.aad),
      new_recovery_verifier_key: toBase64Url(verifierKey),
      new_wrapped_mk_recovery: toBase64Url(newRecoveryTagged.ciphertext),
      new_wrap_nonce_recovery: toBase64Url(newRecoveryTagged.nonce),
      new_wrap_aad_recovery: toBase64Url(newRecoveryTagged.aad),
    },
    args.baseUrl,
  );

  // Step 8 — Persist updated rows.
  // Update linked_account with new opaque wraps. This re-registration freezes
  // `args.username` as the new OPAQUE client identifier — re-stamp it here so
  // later logins/step-ups keep matching the fresh registration envelope.
  await putLinkedAccount(args.db, {
    server_user_id: finish.user_id,
    base_url: args.baseUrl,
    issuer_label: null,
    role: finish.role,
    wrapped_mk_opaque_ciphertext: newOpaqueTagged.ciphertext,
    wrapped_mk_opaque_nonce: newOpaqueTagged.nonce,
    wrapped_mk_opaque_aad: newOpaqueTagged.aad,
    wrapped_mk_opaque_integrity: newOpaqueTagged.integrity_hmac,
    linked_at: new Date(),
    opaque_client_identifier: args.username,
  });

  // Update local_account recovery wraps so local recovery login still works.
  const localRow = requireLocalAccount(await getLocalAccount(args.db));
  localRow.wrapped_mk_recovery_ciphertext = newRecoveryTagged.ciphertext;
  localRow.wrapped_mk_recovery_nonce = newRecoveryTagged.nonce;
  localRow.wrapped_mk_recovery_aad = newRecoveryTagged.aad;
  localRow.wrapped_mk_recovery_integrity = newRecoveryTagged.integrity_hmac;
  localRow.recovery_verifier_key = verifierKey;
  await putLocalAccount(args.db, localRow);

  // Step 9 — Build the linked+online session carrying the server-issued
  // access token, mirroring `recoverFromScratch`.
  const session = createMasterKeySession({
    mk,
    userId: finish.user_id,
    username: args.username,
    mode: 'linked',
    online: true,
    role: finish.role,
    accessToken: finish.access_token,
  });

  return { session, mk };
}
