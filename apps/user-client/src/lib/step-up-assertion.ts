// SPDX-License-Identifier: AGPL-3.0-only

import { fromBase64Url, toBase64Url } from '@chatsundere/crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@chatsundere/shared-types';

/**
 * Drives navigator.credentials.get() for a step-up assertion (Mechanism A).
 * Converts the server's JSON options to binary form and serialises the
 * result back to the @simplewebauthn JSON envelope the server verifies.
 * UV comes as 'required' in the server options (ADR 0027) — passed through
 * unchanged.
 */
export async function getStepUpAssertion(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: toBuffer(fromBase64Url(options.challenge)),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: (options.allowCredentials ?? []).map((c) => ({
      type: 'public-key' as const,
      id: toBuffer(fromBase64Url(c.id)),
    })),
  };

  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('assertion returned no credential');
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      signature: toBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle
        ? toBase64Url(new Uint8Array(response.userHandle))
        : undefined,
    },
    clientExtensionResults:
      credential.getClientExtensionResults() as AuthenticationResponseJSON['clientExtensionResults'],
    authenticatorAttachment: (credential.authenticatorAttachment ??
      undefined) as AuthenticationResponseJSON['authenticatorAttachment'],
  };
}

/** Copies into a fresh ArrayBuffer-backed view (BufferSource wants Uint8Array<ArrayBuffer>). */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.slice() as Uint8Array<ArrayBuffer>;
}
