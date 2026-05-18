// SPDX-License-Identifier: AGPL-3.0-only

import { importJWK, jwtVerify } from 'jose';
import { loadEnv } from '../env.js';
import { getKeyMaterial } from './keys.js';

export interface AccessClaims {
  sub: string;
  role: 'primary_admin' | 'admin' | 'user';
  iat: number;
  exp: number;
}

/** Verifies an Ed25519-signed access token and returns the typed claims. */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const env = loadEnv();
  const { publicJwk } = await getKeyMaterial();
  const verifyKey = await importJWK(publicJwk, 'EdDSA');
  const { payload } = await jwtVerify(token, verifyKey, {
    issuer: 'chatsundere-auth-v1',
    audience: `${env.API_BASE_URL}/v1`,
    algorithms: ['EdDSA'],
  });

  const sub = payload.sub;
  const role = (payload as { role?: unknown }).role;
  if (
    typeof sub !== 'string' ||
    (role !== 'primary_admin' && role !== 'admin' && role !== 'user')
  ) {
    throw new Error('Invalid JWT payload: missing or unknown sub/role');
  }

  return {
    sub,
    role,
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}
