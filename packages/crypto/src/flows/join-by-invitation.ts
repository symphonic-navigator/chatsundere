// SPDX-License-Identifier: LGPL-3.0-only

import { deriveLocalAmk, deriveOpaqueAmk, deriveRecoveryAmk } from '../amk.js';
import { putLocalAndLinkedAccount } from '../db/account-pair.js';
import type { LinkedAccountRow, LocalAccountRow } from '../db/schema.js';
import { toBase64Url } from '../encoding/base64url.js';
import { encodeRecoveryKey } from '../encoding/recovery-key.js';
import { CryptoError } from '../errors.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../opaque/client.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import { deriveVerifierKey } from '../recovery.js';
import type { ServerClient } from '../server-client.js';
import { createMasterKeySession } from '../session.js';
import type { MasterKeySession } from '../session.js';
import { ARGON2ID_PARAMS, type MasterKey, asMasterKey, asRecoveryKey } from '../types.js';

// ---------------------------------------------------------------------------
// Public argument / result types
// ---------------------------------------------------------------------------

export interface StartJoinByInvitationArgs {
  serverClient: ServerClient;
  baseUrl: string;
  /** The raw invitation code (e.g. `AB7K3-MN9PX`). */
  code: string;
  /**
   * The passphrase the user entered on the confirm screen.
   * Consumed only by the OPAQUE registration; never sent to the server in
   * plaintext.
   */
  passphrase: string;
}

/**
 * State returned by `startJoinByInvitation` and threaded into
 * `finishJoinByInvitation`. The shape is intentionally opaque to callers —
 * the only guarantee is that it must be passed back unchanged.
 */
export interface JoinByInvitationState {
  /** The server-assigned session identifier for this join attempt. */
  sessionId: string;
  /** Username suggested by the operator, or `null`. */
  suggestedUsername: string | null;
  /**
   * The OPAQUE `registration_response` returned by the server at `/join/start`.
   * Required to complete the OPAQUE round in `finishJoinByInvitation`.
   * @internal
   */
  registrationResponse: string;
  /**
   * Opaque OPAQUE client state. Do NOT inspect or serialise — its format is
   * an implementation detail of `@serenity-kit/opaque`.
   * @internal
   */
  clientRegistrationState: unknown;
}

export interface FinishJoinByInvitationArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  baseUrl: string;
  /** State produced by `startJoinByInvitation`. */
  joinState: JoinByInvitationState;
  /** The username the user entered (or accepted from `suggestedUsername`). */
  username: string;
  /**
   * The passphrase the user entered. Must be the same value that was passed
   * to `startJoinByInvitation` so that the OPAQUE registration record and
   * the local AMK wrap are consistent.
   */
  passphrase: string;
  /** Optional label shown in the server list (e.g. "My Chatsundere"). */
  issuerLabel?: string | null;
}

export interface FinishJoinByInvitationResult {
  session: MasterKeySession;
  /**
   * The raw master key. Borrowed — the same buffer is captured by the session
   * closure. `session.close()` zeroes this buffer, so do not store a copy.
   */
  mk: MasterKey;
  /** The printed recovery key string (Crockford-base32, grouped in fours). */
  recoveryKeyString: string;
}

// ---------------------------------------------------------------------------
// Round 1 — start
// ---------------------------------------------------------------------------

/**
 * Begin the invitation join flow. Generates a fresh OPAQUE registration
 * request and sends it to `POST /api/v1/join/start` with `kind: 'invitation'`.
 *
 * Returns the server-assigned session-id, the operator's suggested username
 * (may be `null`), and opaque OPAQUE state to thread into
 * `finishJoinByInvitation`.
 */
export async function startJoinByInvitation(
  args: StartJoinByInvitationArgs,
): Promise<JoinByInvitationState> {
  const { clientRegistrationState, registrationRequest } = await opaqueRegistrationStart(
    args.passphrase,
  );

  const response = await args.serverClient.joinStart(
    { kind: 'invitation', code: args.code, registration_request: registrationRequest },
    args.baseUrl,
  );

  if (response.kind !== 'invitation') {
    throw new CryptoError(
      'opaque_protocol_error',
      'Server returned pairing response for invitation start',
    );
  }

  return {
    sessionId: response.session_id,
    suggestedUsername: response.suggested_username,
    registrationResponse: response.registration_response,
    clientRegistrationState,
  };
}

// ---------------------------------------------------------------------------
// Round 2 — finish
// ---------------------------------------------------------------------------

/**
 * Complete the invitation join flow. Generates a fresh master key and
 * recovery key, wraps the MK under three key-derivation paths (OPAQUE
 * export-key, local passphrase AMK, and recovery AMK), then uploads the
 * OPAQUE + recovery wrapping material via `POST /api/v1/join/finish`.
 *
 * Persists both the `local_account` and `linked_account` IndexedDB rows so
 * that subsequent `loginOnlineLinked` calls can authenticate against both
 * the local passphrase and the server.
 *
 * Throws `CryptoError('conflict', ...)` when the server returns 409
 * `username_taken` — callers should surface an inline error under the
 * username field and allow the user to choose a different name.
 */
export async function finishJoinByInvitation(
  args: FinishJoinByInvitationArgs,
): Promise<FinishJoinByInvitationResult> {
  const serverId = `${args.baseUrl}/auth/v1`;

  // --- Generate fresh key material -------------------------------------------
  const mk = asMasterKey(getRandomBytes(32));
  const recoveryKey = asRecoveryKey(getRandomBytes(32));
  const localSalt = getRandomBytes(ARGON2ID_PARAMS.saltLength);

  // --- Derive all AMKs ---------------------------------------------------------
  const localAmk = await deriveLocalAmk(args.passphrase, localSalt);
  const recoveryAmk = await deriveRecoveryAmk(recoveryKey);

  // --- Wrap MK under local passphrase (for local_account / loginOnlineLinked) --
  const localAad = makeLocalAccountAad(args.username, 'local');
  const recoveryAad = makeLocalAccountAad(args.username, 'recovery');

  const wrappedLocal = await aeadEncrypt(localAmk, mk, localAad);
  const wrappedRecovery = await aeadEncrypt(recoveryAmk, mk, recoveryAad);

  const localIk = await deriveIntegrityKey(localAmk);
  const recoveryIk = await deriveIntegrityKey(recoveryAmk);
  const localTagged = await addIntegrityHmac(wrappedLocal, localIk);
  const recoveryTagged = await addIntegrityHmac(wrappedRecovery, recoveryIk);

  const verifierKey = await deriveVerifierKey(recoveryKey);

  // --- Finish OPAQUE registration against the server's registration_response ---
  const { registrationRecord, exportKey } = await opaqueRegistrationFinish({
    clientRegistrationState: args.joinState.clientRegistrationState as string,
    registrationResponse: args.joinState.registrationResponse,
    passphrase: args.passphrase,
    username: args.username,
    serverIdentity: serverId,
  });

  // --- Wrap MK under OPAQUE export-key ----------------------------------------
  const opaqueAmk = await deriveOpaqueAmk(exportKey);
  const opaqueAad = makeLocalAccountAad(args.username, 'opaque');
  const wrappedOpaque = await aeadEncrypt(opaqueAmk, mk, opaqueAad);
  const opaqueIk = await deriveIntegrityKey(opaqueAmk);
  const opaqueTagged = await addIntegrityHmac(wrappedOpaque, opaqueIk);

  // --- POST /api/v1/join/finish ------------------------------------------------
  let finish: Awaited<ReturnType<ServerClient['joinFinish']>>;
  try {
    finish = await args.serverClient.joinFinish(
      {
        kind: 'invitation',
        session_id: args.joinState.sessionId,
        username: args.username,
        registration_record: toBase64Url(registrationRecord),
        wrapped_mk_opaque: toBase64Url(opaqueTagged.ciphertext),
        wrap_nonce_opaque: toBase64Url(opaqueTagged.nonce),
        wrap_aad_opaque: toBase64Url(opaqueTagged.aad),
        wrapped_mk_recovery: toBase64Url(recoveryTagged.ciphertext),
        wrap_nonce_recovery: toBase64Url(recoveryTagged.nonce),
        wrap_aad_recovery: toBase64Url(recoveryTagged.aad),
        recovery_verifier_key: toBase64Url(verifierKey),
      },
      args.baseUrl,
    );
  } catch (err) {
    if (isConflictError(err)) {
      throw new CryptoError('conflict', 'username already registered on this server');
    }
    throw err;
  }

  if (finish.kind !== 'invitation') {
    throw new CryptoError(
      'opaque_protocol_error',
      'Server returned pairing response for invitation finish',
    );
  }

  // --- Persist IndexedDB rows (single transaction for atomicity) ---------------
  const localRow: LocalAccountRow = {
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

  const linkedRow: LinkedAccountRow = {
    server_user_id: finish.user_id,
    base_url: args.baseUrl,
    issuer_label: args.issuerLabel ?? null,
    role: finish.role,
    wrapped_mk_opaque_ciphertext: opaqueTagged.ciphertext,
    wrapped_mk_opaque_nonce: opaqueTagged.nonce,
    wrapped_mk_opaque_aad: opaqueTagged.aad,
    wrapped_mk_opaque_integrity: opaqueTagged.integrity_hmac,
    linked_at: new Date(),
  };

  await putLocalAndLinkedAccount(args.db, localRow, linkedRow);

  // --- Build session -----------------------------------------------------------
  const session = createMasterKeySession({
    mk,
    userId: finish.user_id,
    username: finish.username,
    mode: 'linked',
    online: true,
    role: finish.role,
    accessToken: finish.access_token,
    recoveryKey,
  });

  return {
    session,
    mk,
    recoveryKeyString: encodeRecoveryKey(recoveryKey),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns true when the thrown value looks like an HTTP 409 `username_taken`. */
function isConflictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; code?: string };
  return e.status === 409 && e.code === 'username_taken';
}
