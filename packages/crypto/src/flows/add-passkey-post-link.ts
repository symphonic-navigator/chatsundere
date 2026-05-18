// SPDX-License-Identifier: LGPL-3.0-only

import type { RegistrationResponseJSON } from '@chatsundere/shared-types';
import { derivePrfAmk } from '../amk.js';
import { getLinkedAccount } from '../db/linked-account.js';
import { getPasskeyCredential, putPasskeyCredential } from '../db/passkey-credentials.js';
import { toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import type { ServerClient } from '../server-client.js';
import type { MasterKey } from '../types.js';
import { credentialIdPrefix } from '../webauthn/prf.js';

export interface AddPasskeyPostLinkArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  accessToken: string;
  mk: MasterKey;
  /** Output of navigator.credentials.create(), pre-serialised by simplewebauthn/browser. */
  credentialJson: RegistrationResponseJSON;
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  aaguid: string | null;
  prfOutput: Uint8Array;
  label: string;
  sessionId: string;
}

export async function addPasskeyPostLink(args: AddPasskeyPostLinkArgs): Promise<void> {
  const linked = await getLinkedAccount(args.db);
  if (!linked) throw new CryptoError('not_found', 'no linked account');

  const existing = await getPasskeyCredential(args.db, args.credentialId);
  if (existing?.is_synced_with_server) {
    throw new CryptoError('conflict', 'credential already synced');
  }

  const prefix = credentialIdPrefix(args.credentialId);
  const amk = await derivePrfAmk(args.prfOutput, prefix);
  const aad = new TextEncoder().encode(`${linked.server_user_id}::prf::${prefix}::v1`);
  const wrapped = await aeadEncrypt(amk, args.mk, aad);
  const ik = await deriveIntegrityKey(amk);
  const tagged = await addIntegrityHmac(wrapped, ik);

  await args.serverClient.linkPasskeyFinish(
    {
      session_id: args.sessionId,
      credential: args.credentialJson,
      label: args.label,
      wrapped_mk_passkey: toBase64Url(tagged.ciphertext),
      wrap_nonce_passkey: toBase64Url(tagged.nonce),
      wrap_aad_passkey: toBase64Url(tagged.aad),
    },
    linked.base_url,
    args.accessToken,
  );

  await putPasskeyCredential(args.db, {
    credential_id: args.credentialId,
    public_key: args.publicKey,
    // Preserve the existing sign counter if the credential was already known
    // locally (e.g. registered via setup-biometric). Resetting to 0 would
    // defeat rollback detection on the next assertion.
    sign_counter: existing?.sign_counter ?? 0,
    // Keep the authoritative AAGUID from the existing row when the new call
    // does not supply one.
    aaguid: args.aaguid ?? existing?.aaguid ?? null,
    label: args.label,
    wrapped_mk_prf_ciphertext: tagged.ciphertext,
    wrapped_mk_prf_nonce: tagged.nonce,
    wrapped_mk_prf_aad: tagged.aad,
    wrapped_mk_prf_integrity: tagged.integrity_hmac,
    is_synced_with_server: true,
    // Preserve the original creation timestamp if the row already exists.
    created_at: existing?.created_at ?? new Date(),
  });
}
