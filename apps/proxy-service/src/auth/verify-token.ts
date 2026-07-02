// SPDX-License-Identifier: AGPL-3.0-only

import { type JSONWebKeySet, createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../env.js';

/**
 * Builds a token verifier. Verifies EdDSA against the auth-service JWKS,
 * enforcing issuer + exp (5 s clock tolerance) and IGNORING aud (variant a).
 * `keySetLoader` is injectable for tests; production uses the pinned remote set.
 */
export function createTokenVerifier(
  env: Env,
  keySetLoader?: () => Promise<JSONWebKeySet>,
): (token: string) => Promise<{ sub: string }> {
  // Pinned fetch options so a bogus-kid flood can't hammer the auth JWKS and a
  // hung fetch can't stall the proxy (spec §4).
  const jwks = keySetLoader
    ? undefined
    : createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });

  return async (token: string) => {
    const keySet =
      jwks ?? createLocalJWKSet(await (keySetLoader as () => Promise<JSONWebKeySet>)());
    const { payload } = await jwtVerify(token, keySet, {
      issuer: env.JWT_ISSUER,
      algorithms: ['EdDSA'],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== 'string') throw new Error('Token missing sub');
    return { sub: payload.sub };
  };
}
