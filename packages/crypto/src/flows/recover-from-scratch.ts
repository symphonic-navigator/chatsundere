// SPDX-License-Identifier: LGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { deriveLocalAmk, deriveOpaqueAmk, deriveRecoveryAmk } from '../amk.js';
import { putLocalAndLinkedAccount } from '../db/account-pair.js';
import { getLocalAccount } from '../db/local-account.js';
import type { LinkedAccountRow, LocalAccountRow } from '../db/schema.js';
import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { decodeRecoveryKey } from '../encoding/recovery-key.js';
import { CryptoError } from '../errors.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../opaque/client.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadDecrypt, aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import { computeRecoveryProof, deriveVerifierKey } from '../recovery.js';
import type { ServerClient } from '../server-client.js';
import { createMasterKeySession } from '../session.js';
import type { MasterKeySession } from '../session.js';
import { ARGON2ID_PARAMS, type MasterKey, WRAP_ALGO, asMasterKey } from '../types.js';

// ---------------------------------------------------------------------------
// Public argument / result types
// ---------------------------------------------------------------------------

export interface RecoverFromScratchArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  baseUrl: string;
  /** The username of the account to recover. */
  username: string;
  /** The printed recovery key string (e.g. "ABCD-EFGH-…"). */
  recoveryKeyString: string;
  /** New passphrase to register under the fresh OPAQUE record. */
  newPassphrase: string;
  /** Optional label shown in the server list (e.g. "My Chatsundere"). */
  issuerLabel?: string | null;
}

export interface RecoverFromScratchResult {
  session: MasterKeySession;
  /**
   * The recovered master key. Borrowed — the same buffer is captured by the
   * session closure. `session.close()` zeroes this buffer; do not store a copy.
   */
  mk: MasterKey;
}

// ---------------------------------------------------------------------------
// recoverFromScratch
// ---------------------------------------------------------------------------

/**
 * Recovery flow for a user who arrives on a fresh PWA with no local account
 * and needs to regain access using their recovery key.
 *
 * The user provides: server URL, username, recovery key string, and a new
 * passphrase. The flow:
 *
 *   1. Client starts fresh OPAQUE registration with `newPassphrase` →
 *      `registration_request`.
 *   2. POST /recovery/start { username, registration_request } →
 *      server returns wrapped MK (recovery slot) + OPAQUE registration_response.
 *   3. Client derives the recovery AMK from the recovery key string and
 *      unwraps the MK. Failure → `CryptoError('wrong_recovery_key', …)`.
 *   4. Client computes HMAC proof over (nonce, username, server_id).
 *   5. Client finishes OPAQUE registration → new opaque export-key.
 *   6. Client wraps the recovered MK under:
 *        - new OPAQUE AMK  (for linked_account / online login)
 *        - new local AMK   (Argon2id, for local_account / offline unlock)
 *        - existing recovery AMK (so recovery slot stays consistent)
 *   7. POST /recovery/finish { username, nonce, proof, registration_record,
 *        new_wrapped_mk_opaque, new_wrapped_mk_recovery, … } →
 *      server replaces the OPAQUE auth-method row and recovery wrap.
 *   8. Client persists fresh `local_account` and `linked_account` IDB rows.
 *   9. Returns `{ session, mk }`.
 *
 * Throws `CryptoError('conflict', …)` when a `local_account` row already
 * exists — callers must wipe the origin before attempting recovery.
 *
 * Throws `CryptoError('not_found', …)` when the server does not recognise
 * the username (HTTP 404).
 *
 * Throws `CryptoError('wrong_recovery_key', …)` when the recovery key
 * does not decrypt the server-side wrapped MK.
 */
export async function recoverFromScratch(
  args: RecoverFromScratchArgs,
): Promise<RecoverFromScratchResult> {
  // Fresh-device guard — this flow must not overwrite an existing account.
  if (await getLocalAccount(args.db)) {
    throw new CryptoError(
      'conflict',
      'a local account already exists on this origin; wipe the device before recovering',
    );
  }

  const serverId = opaqueServerIdentity(args.baseUrl);
  const rk = decodeRecoveryKey(args.recoveryKeyString);

  // Step 1 — Start fresh OPAQUE registration for the new passphrase.
  const { clientRegistrationState, registrationRequest } = await opaqueRegistrationStart(
    args.newPassphrase,
  );

  // Step 2 — POST /recovery/start.
  let start: Awaited<ReturnType<ServerClient['recoveryStart']>>;
  try {
    start = await args.serverClient.recoveryStart(
      { username: args.username, registration_request: registrationRequest },
      args.baseUrl,
    );
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new CryptoError('not_found', `no account found for username "${args.username}"`);
    }
    throw err;
  }

  // Step 3 — Unwrap MK using the recovery key. The server copy carries no
  // client-side integrity HMAC (IDB-only invariant), so we skip verifyIntegrityHmac.
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

  // Step 6 — Wrap the recovered MK under three key paths.

  // OPAQUE wrap (for linked_account / online login).
  const opaqueAad = makeLocalAccountAad(args.username, 'opaque');
  const newOpaqueWrap = await aeadEncrypt(newOpaqueAmk, mk, opaqueAad);
  const opaqueIk = await deriveIntegrityKey(newOpaqueAmk);
  const newOpaqueTagged = await addIntegrityHmac(newOpaqueWrap, opaqueIk);

  // Local passphrase wrap (Argon2id — for local_account / offline unlock).
  const localSalt = getRandomBytes(ARGON2ID_PARAMS.saltLength);
  const newLocalAmk = await deriveLocalAmk(args.newPassphrase, localSalt);
  const localAad = makeLocalAccountAad(args.username, 'local');
  const newLocalWrap = await aeadEncrypt(newLocalAmk, mk, localAad);
  const localIk = await deriveIntegrityKey(newLocalAmk);
  const newLocalTagged = await addIntegrityHmac(newLocalWrap, localIk);

  // Recovery wrap — re-wrap under the same recovery key so the server copy and
  // the local copy remain consistent. The recovery key is NOT rotated here.
  const recoveryAad = makeLocalAccountAad(args.username, 'recovery');
  const newRecoveryWrap = await aeadEncrypt(recoveryAmk, mk, recoveryAad);
  const recoveryIk = await deriveIntegrityKey(recoveryAmk);
  const newRecoveryTagged = await addIntegrityHmac(newRecoveryWrap, recoveryIk);

  // Re-derive the verifier key (unchanged, recovery key is unchanged).
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

  // Step 8 — Persist fresh IDB rows (single transaction for atomicity).
  const localRow: LocalAccountRow = {
    schema_version: 1,
    username: args.username,
    local_salt: localSalt,
    wrapped_mk_local_ciphertext: newLocalTagged.ciphertext,
    wrapped_mk_local_nonce: newLocalTagged.nonce,
    wrapped_mk_local_aad: newLocalTagged.aad,
    wrapped_mk_local_integrity: newLocalTagged.integrity_hmac,
    wrapped_mk_recovery_ciphertext: newRecoveryTagged.ciphertext,
    wrapped_mk_recovery_nonce: newRecoveryTagged.nonce,
    wrapped_mk_recovery_aad: newRecoveryTagged.aad,
    wrapped_mk_recovery_integrity: newRecoveryTagged.integrity_hmac,
    recovery_verifier_key: verifierKey,
    created_at: new Date(),
  };

  const linkedRow: LinkedAccountRow = {
    server_user_id: finish.user_id,
    base_url: args.baseUrl,
    issuer_label: args.issuerLabel ?? null,
    role: finish.role,
    wrapped_mk_opaque_ciphertext: newOpaqueTagged.ciphertext,
    wrapped_mk_opaque_nonce: newOpaqueTagged.nonce,
    wrapped_mk_opaque_aad: newOpaqueTagged.aad,
    wrapped_mk_opaque_integrity: newOpaqueTagged.integrity_hmac,
    linked_at: new Date(),
  };

  await putLocalAndLinkedAccount(args.db, localRow, linkedRow);

  // Step 9 — Build session.
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns true when the thrown value looks like an HTTP 404 `not_found`. */
function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; code?: string };
  return e.status === 404;
}
