// SPDX-License-Identifier: LGPL-3.0-only

import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { getRandomBytes } from '../primitives/random.js';
import { isSyncedAuthenticator } from './aaguid-allowlist.js';

/** Generate a fresh 32-byte challenge for a local WebAuthn ceremony. */
export function generateLocalChallenge(): Uint8Array {
  return getRandomBytes(32);
}

export interface LocalAssertionArgs {
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  storedSignCounter: number;
  receivedSignCounter: number;
  aaguid: string | null;
  challenge: Uint8Array;
  clientDataJson: string;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  origin: string;
}

export interface LocalAssertionResult {
  newSignCounter: number;
}

/**
 * Verify a WebAuthn assertion locally (no server). Enforces:
 * - sign-counter monotonicity, except for AAGUIDs on the synced list
 * - public-key signature validity via @simplewebauthn/server
 * - origin match
 * Returns the new sign counter to persist.
 */
export async function verifyLocalAssertion(
  args: LocalAssertionArgs,
): Promise<LocalAssertionResult> {
  const synced = isSyncedAuthenticator(args.aaguid);
  if (!synced && args.receivedSignCounter <= args.storedSignCounter) {
    throw new CryptoError(
      'webauthn_sign_counter_rollback',
      'authenticator returned a non-monotonic sign counter',
    );
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: {
        id: toBase64Url(args.credentialId),
        rawId: toBase64Url(args.credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(new TextEncoder().encode(args.clientDataJson)),
          authenticatorData: toBase64Url(args.authenticatorData),
          signature: toBase64Url(args.signature),
          userHandle: '',
        },
      },
      expectedChallenge: toBase64Url(args.challenge),
      expectedOrigin: args.origin,
      expectedRPID: new URL(args.origin).hostname,
      credential: {
        id: toBase64Url(args.credentialId),
        publicKey: args.publicKey,
        counter: args.storedSignCounter,
      },
      requireUserVerification: false,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new CryptoError('webauthn_verification_failed', message);
  }

  if (!verification.verified) {
    throw new CryptoError('webauthn_verification_failed', 'assertion did not verify');
  }
  return { newSignCounter: verification.authenticationInfo.newCounter };
}
