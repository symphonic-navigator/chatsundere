// SPDX-License-Identifier: AGPL-3.0-only
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationExtensionsClientInputs,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import { loadEnv } from '../env.js';

function rpFromBaseUrl(baseUrl: string): { rpID: string; expectedOrigin: string } {
  const url = new URL(baseUrl);
  return {
    rpID: url.hostname,
    expectedOrigin: `${url.protocol}//${url.host}`,
  };
}

/** Generates WebAuthn registration options for a new passkey. */
export async function generateRegistration(args: {
  userId: string;
  username: string;
}): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>>> {
  const env = loadEnv();
  const { rpID } = rpFromBaseUrl(env.API_BASE_URL);
  return generateRegistrationOptions({
    rpName: 'Chatsundere',
    rpID,
    userID: new TextEncoder().encode(args.userId),
    userName: args.username,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      // ADR 0022: 'preferred' to match the user-client policy.
      // Cross-platform passkeys (Bitwarden Desktop, Yubikey-no-PIN) are
      // accepted; the authenticator's intrinsic behaviour decides whether
      // UV actually happens. PRF (ADR 0005) is enforced elsewhere.
      userVerification: 'preferred',
    },
    // Request PRF extension for master-key wrapping (ADR 0005).
    // `prf` is not yet in AuthenticationExtensionsClientInputs; cast through unknown.
    extensions: {
      prf: { eval: { first: new Uint8Array(32) } },
    } as unknown as AuthenticationExtensionsClientInputs,
  });
}

/**
 * Generates WebAuthn authentication options.
 * When allowCredentialIds is provided the ceremony is bound to those credentials only.
 *
 * The userVerification default of 'preferred' matches ADR 0022 (cross-platform
 * passkeys without intrinsic UV are accepted for ordinary login). Step-up
 * Mechanism A per ADR 0027 overrides to 'required' so the user reconfirms
 * presence before privileged operations.
 */
export async function generateAuthentication(args: {
  allowCredentialIds?: string[];
  userVerification?: 'preferred' | 'required' | 'discouraged';
}): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
  const env = loadEnv();
  const { rpID } = rpFromBaseUrl(env.API_BASE_URL);
  return generateAuthenticationOptions({
    rpID,
    userVerification: args.userVerification ?? 'preferred',
    allowCredentials: args.allowCredentialIds?.map((id) => ({ id })),
  });
}

/** Verifies a WebAuthn registration response against the stored challenge. */
export async function verifyRegistration(args: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}) {
  const env = loadEnv();
  const { rpID, expectedOrigin } = rpFromBaseUrl(env.API_BASE_URL);
  return verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
}

/** Verifies a WebAuthn authentication response against the stored challenge and public key. */
export async function verifyAuthentication(args: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  publicKey: Uint8Array;
  signCount: number;
}) {
  const env = loadEnv();
  const { rpID, expectedOrigin } = rpFromBaseUrl(env.API_BASE_URL);
  return verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: args.response.id,
      publicKey: args.publicKey,
      counter: args.signCount,
    },
    requireUserVerification: false,
  });
}
