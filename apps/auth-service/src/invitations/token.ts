// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from '../env.js';

let keyCache: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (keyCache) return keyCache;
  const env = loadEnv();
  const raw = Buffer.from(env.INVITATION_HMAC_KEY, 'base64url');
  keyCache = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return keyCache;
}

/** Returns a 32-byte HMAC-SHA-256 digest of the invitation token, keyed by INVITATION_HMAC_KEY. */
export async function hashInvitationToken(token: string): Promise<Uint8Array> {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return new Uint8Array(sig);
}

/** Generates a cryptographically random 32-byte invitation token as a base64url string. */
export function generateInvitationToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}
