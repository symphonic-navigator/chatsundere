// SPDX-License-Identifier: LGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { deriveOpaqueAmk } from '../amk.js';
import { putLinkedAccount } from '../db/linked-account.js';
import { getLocalAccount, requireLocalAccount } from '../db/local-account.js';
import type { LinkedAccountRow } from '../db/schema.js';
import { toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../opaque/client.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import type { ServerClient } from '../server-client.js';
import type { MasterKey } from '../types.js';

export interface LinkToServerArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  invitationToken: string;
  baseUrl: string;
  issuerLabel: string | null;
  passphrase: string;
  mk: MasterKey;
}

/**
 * Run a full OPAQUE registration against the server using the invitation token,
 * upload the wrapped MK and recovery materials, and persist the resulting
 * `linked_account` row in IndexedDB.
 *
 * Throws `CryptoError('conflict', ...)` when the server responds 409 with
 * `code: 'username_taken'`.
 */
export async function linkToServer(args: LinkToServerArgs): Promise<void> {
  const local = requireLocalAccount(await getLocalAccount(args.db));
  const username = local.username;
  const serverId = opaqueServerIdentity(args.baseUrl);

  const { clientRegistrationState, registrationRequest } = await opaqueRegistrationStart(
    args.passphrase,
  );

  const startResp = await args.serverClient.joinStart(
    { kind: 'invitation', code: args.invitationToken, registration_request: registrationRequest },
    args.baseUrl,
  );
  if (startResp.kind !== 'invitation')
    throw new CryptoError('opaque_protocol_error', 'unexpected join/start kind');
  const start = startResp;

  const { registrationRecord, exportKey } = await opaqueRegistrationFinish({
    clientRegistrationState,
    registrationResponse: start.registration_response,
    passphrase: args.passphrase,
    username,
    serverIdentity: serverId,
  });

  const opaqueAmk = await deriveOpaqueAmk(exportKey);
  const aad = makeLocalAccountAad(username, 'opaque');
  const wrapped = await aeadEncrypt(opaqueAmk, args.mk, aad);
  const ik = await deriveIntegrityKey(opaqueAmk);
  const tagged = await addIntegrityHmac(wrapped, ik);

  let finishResp: Awaited<ReturnType<ServerClient['joinFinish']>>;
  try {
    finishResp = await args.serverClient.joinFinish(
      {
        kind: 'invitation',
        session_id: start.session_id,
        username,
        registration_record: toBase64Url(registrationRecord),
        wrapped_mk_opaque: toBase64Url(tagged.ciphertext),
        wrap_nonce_opaque: toBase64Url(tagged.nonce),
        wrap_aad_opaque: toBase64Url(tagged.aad),
        wrapped_mk_recovery: toBase64Url(local.wrapped_mk_recovery_ciphertext),
        wrap_nonce_recovery: toBase64Url(local.wrapped_mk_recovery_nonce),
        wrap_aad_recovery: toBase64Url(local.wrapped_mk_recovery_aad),
        recovery_verifier_key: toBase64Url(local.recovery_verifier_key),
      },
      args.baseUrl,
    );
  } catch (err) {
    // Surface username conflicts as a typed CryptoError so callers can
    // distinguish "taken" from transient network failures.
    if (isConflictError(err)) {
      throw new CryptoError('conflict', 'username already registered on this server');
    }
    throw err;
  }
  if (finishResp.kind !== 'invitation')
    throw new CryptoError('opaque_protocol_error', 'unexpected join/finish kind');
  const finish = finishResp;

  const row: LinkedAccountRow = {
    server_user_id: finish.user_id,
    base_url: args.baseUrl,
    issuer_label: args.issuerLabel,
    role: finish.role,
    wrapped_mk_opaque_ciphertext: tagged.ciphertext,
    wrapped_mk_opaque_nonce: tagged.nonce,
    wrapped_mk_opaque_aad: tagged.aad,
    wrapped_mk_opaque_integrity: tagged.integrity_hmac,
    linked_at: new Date(),
    // Freeze the identifier baked into the OPAQUE registration envelope so
    // later logins/step-ups keep matching it even after a username change.
    opaque_client_identifier: username,
  };
  await putLinkedAccount(args.db, row);
}

/**
 * Returns true when the thrown value looks like an HTTP 409 with
 * `code: 'username_taken'`. The exact shape depends on the fetch adapter
 * used by the injected `ServerClient`; the crypto package can only pattern-
 * match on what callers choose to surface.
 */
function isConflictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Adapters are expected to expose `.status` (HTTP status code) and
  // optionally `.code` (the API ErrorCode string) on thrown errors.
  const e = err as Error & { status?: number; code?: string };
  return e.status === 409 && e.code === 'username_taken';
}
