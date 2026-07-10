// SPDX-License-Identifier: LGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { deriveLocalAmk, deriveOpaqueAmk, deriveRecoveryAmk } from '../amk.js';
import { putLocalAndLinkedAccount } from '../db/account-pair.js';
import { getLocalAccount } from '../db/local-account.js';
import type { LinkedAccountRow, LocalAccountRow } from '../db/schema.js';
import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { opaqueLoginFinish, opaqueLoginStart } from '../opaque/client.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadDecrypt, aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import { deriveVerifierKey } from '../recovery.js';
import type { ServerClient } from '../server-client.js';
import { type MasterKeySession, createMasterKeySession } from '../session.js';
import {
  ARGON2ID_PARAMS,
  type MasterKey,
  WRAP_ALGO,
  asMasterKey,
  asRecoveryKey,
} from '../types.js';

// ---------------------------------------------------------------------------
// Public argument / result types
// ---------------------------------------------------------------------------

export interface StartJoinByPairingArgs {
  serverClient: ServerClient;
  baseUrl: string;
  /** The raw pairing code generated on Device A (e.g. `AB7K3-MN9PX`). */
  code: string;
  /**
   * The passphrase the user entered. Used to start the OPAQUE login round —
   * it must match the passphrase registered on the server.
   */
  passphrase: string;
}

/**
 * State returned by `startJoinByPairing` and threaded into
 * `finishJoinByPairing`. The shape is intentionally opaque to callers —
 * the only guarantee is that it must be passed back unchanged.
 */
export interface JoinByPairingState {
  /** The server-assigned session identifier for this pairing attempt. */
  sessionId: string;
  /** The live username as registered on the server, returned in the start response. */
  username: string;
  /**
   * The frozen OPAQUE client identifier this account registered under
   * (`auth_methods.opaque_client_identifier`), returned in the start
   * response. Distinct from `username` once the account has been renamed —
   * this is the value that must be presented in the OPAQUE login finish and
   * stamped into `linked_account.opaque_client_identifier`, never `username`.
   * Falls back to `username` when talking to an older server that predates
   * this field.
   */
  opaqueClientIdentifier: string;
  /**
   * The OPAQUE `login_response` (KE2) returned by the server at `/join/start`.
   * Required to complete the OPAQUE round in `finishJoinByPairing`.
   * @internal
   */
  loginResponse: string;
  /**
   * Opaque OPAQUE client login state. Do NOT inspect or serialise — its format
   * is an implementation detail of `@serenity-kit/opaque`.
   * @internal
   */
  clientLoginState: unknown;
}

export interface FinishJoinByPairingArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  baseUrl: string;
  /** State produced by `startJoinByPairing`. */
  joinState: JoinByPairingState;
  /**
   * The passphrase the user entered. Must match the value passed to
   * `startJoinByPairing` so the OPAQUE login round and the local AMK wrap
   * are consistent.
   */
  passphrase: string;
  /** Optional label shown in the server list (e.g. "My Chatsundere"). */
  issuerLabel?: string | null;
}

export interface FinishJoinByPairingResult {
  session: MasterKeySession;
  /**
   * The raw master key unwrapped from the server's OPAQUE wrapping material.
   * Borrowed — the same buffer is captured by the session closure. `session.close()`
   * zeroes this buffer, so do not store a copy.
   */
  mk: MasterKey;
  // No recoveryKeyString — recovery already exists for this user on the server.
}

// ---------------------------------------------------------------------------
// Round 1 — start
// ---------------------------------------------------------------------------

/**
 * Begin the pairing join flow on Device B. Generates a fresh OPAQUE login
 * request and sends it to `POST /api/v1/join/start` with `kind: 'pairing'`.
 *
 * Returns the server-assigned session-id, the username from the server record,
 * and opaque OPAQUE state to thread into `finishJoinByPairing`.
 */
export async function startJoinByPairing(
  args: StartJoinByPairingArgs,
): Promise<JoinByPairingState> {
  const { clientLoginState, startLoginRequest } = await opaqueLoginStart(args.passphrase);

  const response = await args.serverClient.joinStart(
    { kind: 'pairing', code: args.code, login_request: startLoginRequest },
    args.baseUrl,
  );

  if (response.kind !== 'pairing') {
    throw new CryptoError(
      'opaque_protocol_error',
      'Server returned invitation response for pairing start',
    );
  }

  return {
    sessionId: response.session_id,
    username: response.username,
    // Legacy-server fallback: an older server without this field leaves the
    // client identity as the live username, matching pre-fix behaviour.
    opaqueClientIdentifier: response.opaque_client_identifier ?? response.username,
    loginResponse: response.login_response,
    clientLoginState,
  };
}

// ---------------------------------------------------------------------------
// Round 2 — finish
// ---------------------------------------------------------------------------

/**
 * Complete the pairing join flow on Device B. Finishes the OPAQUE login round
 * to obtain the export-key, then uses it to unwrap the master key returned by
 * the server. Persists both `local_account` and `linked_account` IndexedDB rows
 * atomically so that subsequent `loginOnlineLinked` calls can authenticate
 * against both the local passphrase and the server.
 *
 * Contract: this flow is for fresh PWA instances only. Throws
 * `CryptoError('conflict', ...)` when a `local_account` row already exists —
 * callers must wipe the origin before re-pairing.
 *
 * Throws `CryptoError('opaque_protocol_error', ...)` when:
 *  - The server returns the wrong response kind.
 *  - The server returns 401 `opaque_evidence_invalid` (passphrase mismatch).
 */
export async function finishJoinByPairing(
  args: FinishJoinByPairingArgs,
): Promise<FinishJoinByPairingResult> {
  // Fresh-device guard — this flow must not silently overwrite an existing account.
  if (await getLocalAccount(args.db)) {
    throw new CryptoError(
      'conflict',
      'a local account already exists on this origin; wipe the device before pairing',
    );
  }

  const serverId = opaqueServerIdentity(args.baseUrl);
  const { username, opaqueClientIdentifier } = args.joinState;

  // --- Finish OPAQUE login to obtain the export-key ----------------------------
  //
  // Present the frozen `opaqueClientIdentifier`, not the live `username` — the
  // server bound this round's AKE evidence to the identifier the OPAQUE record
  // was registered under (`/join/start`), which desynchronises from `username`
  // once the account has been renamed.
  const loginResult = await opaqueLoginFinish({
    clientLoginState: args.joinState.clientLoginState as string,
    loginResponse: args.joinState.loginResponse,
    passphrase: args.passphrase,
    username: opaqueClientIdentifier,
    serverIdentity: serverId,
  });

  // --- POST /api/v1/join/finish ------------------------------------------------
  let finish: Awaited<ReturnType<ServerClient['joinFinish']>>;
  try {
    finish = await args.serverClient.joinFinish(
      {
        kind: 'pairing',
        session_id: args.joinState.sessionId,
        login_evidence: toBase64Url(loginResult.finishLoginRequest),
      },
      args.baseUrl,
    );
  } catch (err) {
    if (isEvidenceInvalidError(err)) {
      throw new CryptoError(
        'opaque_protocol_error',
        'Server rejected the OPAQUE login evidence; passphrase may have changed',
      );
    }
    throw err;
  }

  if (finish.kind !== 'pairing') {
    throw new CryptoError(
      'opaque_protocol_error',
      'Server returned invitation response for pairing finish',
    );
  }

  // --- Unwrap the master key from the server-supplied OPAQUE wrapping material -
  //
  // The server stores the MK wrapped under the OPAQUE export-key (derived from
  // the same passphrase used during registration on Device A). The wrap is:
  //   opaqueAmk = deriveOpaqueAmk(exportKey)
  //   ciphertext = aeadEncrypt(opaqueAmk, mk, aad)
  // We reverse this here. The server copy carries no client-side integrity HMAC
  // (that invariant is only enforced in IndexedDB), so we skip verifyIntegrityHmac.
  const opaqueAmk = await deriveOpaqueAmk(loginResult.exportKey);
  const serverWrapped = {
    ciphertext: fromBase64Url(finish.wrapped_mk_opaque),
    nonce: fromBase64Url(finish.wrap_nonce_opaque),
    aad: fromBase64Url(finish.wrap_aad_opaque),
    algo: WRAP_ALGO as typeof WRAP_ALGO,
    integrity_hmac: new Uint8Array(),
  };

  let mkBytes: Uint8Array;
  try {
    mkBytes = await aeadDecrypt(opaqueAmk, serverWrapped, serverWrapped.aad);
  } catch {
    throw new CryptoError(
      'corrupted_data',
      'MK unwrap with OPAQUE export-key failed; server-side wrapping material may be corrupt',
    );
  }

  // TODO(phase-1): when sync-service ships, this flow will need to detect
  // existing local data on this device and merge via UUIDv7 (see spec § 9
  // + ADR 0025). For Phase 0, any pre-existing local MK is replaced —
  // accepted data loss for a test audience of two.
  const mk = asMasterKey(mkBytes);

  // --- Build local wrapping material under the passphrase ----------------------
  //
  // Device B needs its own Argon2id-derived local wrap so that `loginOnlineLinked`
  // can unlock the MK locally without a server round-trip. We also carry over
  // the recovery wrap from the server response, but pairing does not touch the
  // recovery slot — we generate a placeholder local recovery wrap here and do
  // NOT upload it. Recovery is the user's existing key on the server.
  const localSalt = getRandomBytes(ARGON2ID_PARAMS.saltLength);
  const localAmk = await deriveLocalAmk(args.passphrase, localSalt);

  const localAad = makeLocalAccountAad(username, 'local');
  const wrappedLocal = await aeadEncrypt(localAmk, mk, localAad);
  const localIk = await deriveIntegrityKey(localAmk);
  const localTagged = await addIntegrityHmac(wrappedLocal, localIk);

  // Recovery wrap: derive from a random recovery key so the DB row is structurally
  // valid. The user's actual recovery key is held server-side and is not returned
  // by the pairing flow (by design — the recovery slot is unaffected).
  const placeholderRecoveryKey = asRecoveryKey(getRandomBytes(32));
  const recoveryAmk = await deriveRecoveryAmk(placeholderRecoveryKey);
  const recoveryAad = makeLocalAccountAad(username, 'recovery');
  const wrappedRecovery = await aeadEncrypt(recoveryAmk, mk, recoveryAad);
  const recoveryIk = await deriveIntegrityKey(recoveryAmk);
  const recoveryTagged = await addIntegrityHmac(wrappedRecovery, recoveryIk);
  const verifierKey = await deriveVerifierKey(placeholderRecoveryKey);

  // --- Also build the OPAQUE wrap for the linked_account row -------------------
  //
  // Store the OPAQUE wrap derived from this login's export-key in linked_account
  // so that future online logins via `loginOnlineLinked` can re-derive this device's
  // OPAQUE AMK. The AAD must match what the server stored.
  const opaqueAad = serverWrapped.aad;
  const wrappedOpaque = await aeadEncrypt(opaqueAmk, mk, opaqueAad);
  const opaqueIk = await deriveIntegrityKey(opaqueAmk);
  const opaqueTagged = await addIntegrityHmac(wrappedOpaque, opaqueIk);

  // --- Persist both rows atomically (single IDB transaction) -------------------
  const localRow: LocalAccountRow = {
    schema_version: 1,
    username,
    local_salt: localSalt,
    wrapped_mk_local_ciphertext: localTagged.ciphertext,
    wrapped_mk_local_nonce: localTagged.nonce,
    wrapped_mk_local_aad: localTagged.aad,
    wrapped_mk_local_integrity: localTagged.integrity_hmac,
    wrapped_mk_recovery_ciphertext: recoveryTagged.ciphertext,
    wrapped_mk_recovery_nonce: recoveryTagged.nonce,
    wrapped_mk_recovery_aad: recoveryTagged.aad,
    wrapped_mk_recovery_integrity: recoveryTagged.integrity_hmac,
    // Placeholder verifier — pairs with the placeholder recovery key above (not
    // the user's real one). `loginLocalWithRecoveryKey` will reject the user's
    // actual recovery key on this device; offline recovery here is
    // intentionally unavailable. Use `recoveryOnline` instead, which derives
    // the real verifier from the recovery key string before any DB lookup.
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
    // `opaqueClientIdentifier` is the value this OPAQUE login round just
    // authenticated under (bound into the KE3 evidence server-side), so it is
    // provably the account's frozen OPAQUE client identifier for this
    // device's future logins/step-ups — a login under a stale value could
    // not have succeeded.
    opaque_client_identifier: opaqueClientIdentifier,
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
  });

  return { session, mk };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the thrown value looks like an HTTP 401 with error code
 * `opaque_evidence_invalid` — the server's signal that the KE3 message did
 * not pass mutual authentication.
 */
function isEvidenceInvalidError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; code?: string };
  return e.status === 401 && e.code === 'opaque_evidence_invalid';
}
