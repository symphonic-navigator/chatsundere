// SPDX-License-Identifier: AGPL-3.0-only

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { type JWK, importJWK } from 'jose';
import { loadEnv } from '../env.js';

let cached: { privateKey: CryptoKey; publicJwk: JWK; kid: string } | null = null;

/**
 * Loads or returns the cached Ed25519 key material derived from AUTH_JWT_PRIVATE_KEY.
 *
 * The env var is a 32-byte seed encoded as base64url. Node's crypto module derives
 * the correct Ed25519 public point from that seed; jose then uses the full JWK for
 * signing and verification. Bun's WebCrypto does not support exportKey on an
 * Ed25519 key imported with only the `d` field, so node:crypto is used for the
 * public-point derivation step.
 */
export async function getKeyMaterial(): Promise<{
  privateKey: CryptoKey;
  publicJwk: JWK;
  kid: string;
}> {
  if (cached) return cached;

  const env = loadEnv();
  const seedBytes = Buffer.from(env.AUTH_JWT_PRIVATE_KEY, 'base64url');
  if (seedBytes.length !== 32) {
    throw new Error('AUTH_JWT_PRIVATE_KEY must decode to exactly 32 bytes (Ed25519 seed)');
  }

  // node:crypto derives the correct public point from the seed when the dummy `x`
  // placeholder is supplied. The returned public JWK contains the real `x`.
  const nodePrivateKey = createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      d: env.AUTH_JWT_PRIVATE_KEY,
      // A well-formed but ignored placeholder; node replaces it with the real value.
      x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    },
    format: 'jwk',
  });
  const nodePublicKey = createPublicKey(nodePrivateKey);
  const derivedPublicJwk = nodePublicKey.export({ format: 'jwk' }) as {
    x: string;
    crv: string;
    kty: string;
  };

  // Build the full private JWK with the correctly derived public point for jose.
  const fullPrivateJwk: JWK = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: env.AUTH_JWT_PRIVATE_KEY,
    x: derivedPublicJwk.x,
  };

  const privateKey = (await importJWK(fullPrivateJwk, 'EdDSA')) as CryptoKey;

  const publicJwk: JWK = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: derivedPublicJwk.x,
    alg: 'EdDSA',
    use: 'sig',
  };

  // Derive a stable kid from the public key bytes (first 16 chars of SHA-256 in base64url).
  const xBytes = Buffer.from(derivedPublicJwk.x, 'base64url');
  const hash = await crypto.subtle.digest('SHA-256', xBytes);
  const kid = Buffer.from(hash).toString('base64url').slice(0, 16);
  publicJwk.kid = kid;

  cached = { privateKey, publicJwk, kid };
  return cached;
}
