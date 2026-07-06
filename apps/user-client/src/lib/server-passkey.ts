// SPDX-License-Identifier: AGPL-3.0-only

import {
  PRF_INPUT_SALT,
  addPasskeyPostLink,
  fromBase64Url,
  getLinkedAccount,
  toBase64Url,
} from '@chatsundere/crypto';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getDb } from '../boot/open-db.js';
import { httpServerClient } from './server-client.js';
import { PrfRequiredError, extractCosePublicKey, parseAaguid } from './webauthn.js';

/** linkPasskeyStart failed — no credential was minted; safe to retry any time. */
export class StartUnreachableError extends Error {
  constructor() {
    super('Could not reach the server to begin passkey registration.');
    this.name = 'StartUnreachableError';
  }
}

/**
 * Registers a new passkey against the linked server (spec §11): server
 * challenge → credentials.create with PRF → addPasskeyPostLink. On a
 * failure AFTER the credential was created, degrades to a local-only row so
 * the credential is never an orphan and a retry never mints a second one
 * (spec §11.1, Laura hard finding). Tier-1 gated server-side — the apiFetch
 * step-up gate rides along on linkPasskeyStart.
 */
export async function registerServerSyncedPasskey(
  label: string,
): Promise<'synced' | 'local-fallback'> {
  const session = useSessionStore.getState().session;
  const mk = useSessionStore.getState().mk;
  if (!session?.accessToken || !mk) throw new Error('no linked session');
  const db = getDb();
  const linked = await getLinkedAccount(db);
  if (!linked) throw new Error('no linked account');

  let start: Awaited<ReturnType<typeof httpServerClient.linkPasskeyStart>>;
  try {
    start = await httpServerClient.linkPasskeyStart({}, linked.base_url, session.accessToken);
  } catch {
    throw new StartUnreachableError();
  }

  const prfSalt = await PRF_INPUT_SALT;
  const credential = (await navigator.credentials.create({
    publicKey: creationOptionsFromJSON(start.options, prfSalt),
  })) as PublicKeyCredential | null;
  if (!credential) throw new PrfRequiredError();

  const extResults = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfFirst = extResults.prf?.results?.first;
  if (!prfFirst) throw new PrfRequiredError();

  const response = credential.response as AuthenticatorAttestationResponse;
  const authData = new Uint8Array(response.getAuthenticatorData());
  const credentialId = new Uint8Array(credential.rawId);
  const publicKey = extractCosePublicKey(authData);
  const aaguid = parseAaguid(authData);
  const prfOutput = new Uint8Array(prfFirst);

  try {
    await addPasskeyPostLink({
      db,
      serverClient: httpServerClient,
      accessToken: session.accessToken,
      mk,
      credentialJson: serialiseRegistrationResponse(credential),
      credentialId,
      publicKey,
      aaguid,
      prfOutput,
      label,
      sessionId: start.session_id,
    });
    return 'synced';
  } catch {
    // Fall back to a local-only row from the material in hand — never an
    // orphan credential, never a dead prompt (spec §11.1).
    await session.registerLocalBiometric({ db, credentialId, publicKey, aaguid, prfOutput, label });
    return 'local-fallback';
  }
}

/** Converts the server's creation-options JSON to binary form and injects the PRF eval. */
export function creationOptionsFromJSON(
  json: PublicKeyCredentialCreationOptionsJSON,
  prfSalt: Uint8Array,
): PublicKeyCredentialCreationOptions {
  return {
    challenge: bufferSource(fromBase64Url(json.challenge)),
    rp: json.rp,
    user: {
      id: bufferSource(fromBase64Url(json.user.id)),
      name: json.user.name,
      displayName: json.user.displayName,
    },
    pubKeyCredParams: json.pubKeyCredParams,
    timeout: json.timeout,
    attestation: json.attestation,
    authenticatorSelection: json.authenticatorSelection,
    excludeCredentials: (json.excludeCredentials ?? []).map((c) => ({
      type: 'public-key' as const,
      id: bufferSource(fromBase64Url(c.id)),
    })),
    extensions: {
      prf: { eval: { first: bufferSource(prfSalt) } },
    },
  };
}

/** Serialises a created PublicKeyCredential into the @simplewebauthn JSON envelope. */
export function serialiseRegistrationResponse(
  credential: PublicKeyCredential,
): RegistrationResponseJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      attestationObject: toBase64Url(new Uint8Array(response.attestationObject)),
      transports: (response.getTransports?.() ??
        []) as RegistrationResponseJSON['response']['transports'],
    },
    clientExtensionResults:
      credential.getClientExtensionResults() as RegistrationResponseJSON['clientExtensionResults'],
    authenticatorAttachment: (credential.authenticatorAttachment ??
      undefined) as RegistrationResponseJSON['authenticatorAttachment'],
  };
}

function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.slice() as Uint8Array<ArrayBuffer>;
}
