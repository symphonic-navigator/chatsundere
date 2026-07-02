// SPDX-License-Identifier: AGPL-3.0-only

import { type JSONWebKeySet, createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../env.js';

/** The verified claims the sync-service needs: subject, session id, issued-at, expiry. */
export interface TokenClaims {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Builds a token verifier. Verifies EdDSA against the auth-service JWKS,
 * enforcing issuer + exp (5 s clock tolerance) and IGNORING aud (variant a).
 * Fails CLOSED: any verification or JWKS-fetch failure yields `null`, never a
 * throw the caller might forget to handle. `keySetLoader` is injectable for
 * tests; production uses the pinned remote set.
 */
export function createTokenVerifier(
  env: Env,
  keySetLoader?: () => Promise<JSONWebKeySet>,
): (token: string) => Promise<TokenClaims | null> {
  const jwks = keySetLoader
    ? undefined
    : createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });

  return async (token: string) => {
    try {
      const keySet =
        jwks ?? createLocalJWKSet(await (keySetLoader as () => Promise<JSONWebKeySet>)());
      const { payload } = await jwtVerify(token, keySet, {
        issuer: env.JWT_ISSUER,
        algorithms: ['EdDSA'],
        clockTolerance: 5,
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        return null;
      }
      return { sub: payload.sub, jti: payload.jti, iat: payload.iat, exp: payload.exp };
    } catch {
      return null;
    }
  };
}
