// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createTokenVerifier } from '../src/auth/verify-token.js';
import type { Env } from '../src/env.js';

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'EdDSA', use: 'sig' };
  const env = { JWT_ISSUER: 'chatsundere-auth-v1', AUTH_JWKS_URL: 'https://unused' } as unknown as Env;
  // Verifier accepts an injected key set for testing (see impl note).
  const verify = createTokenVerifier(env, async () => ({ keys: [jwk] }));
  const sign = (claims: Record<string, unknown>, exp = '5m') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
      .setIssuer('chatsundere-auth-v1')
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  return { verify, sign };
}

describe('verifyToken', () => {
  test('valid token yields sub', async () => {
    const { verify, sign } = await fixture();
    const t = await sign({ sub: 'user-1', role: 'user' });
    expect((await verify(t)).sub).toBe('user-1');
  });
  test('wrong issuer rejected', async () => {
    const { verify } = await fixture();
    const bad = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
      .setIssuer('someone-else').setIssuedAt().setExpirationTime('5m')
      .sign((await generateKeyPair('EdDSA')).privateKey);
    await expect(verify(bad)).rejects.toThrow();
  });
  test('expired token rejected', async () => {
    const { verify, sign } = await fixture();
    const t = await sign({ sub: 'x' }, '-1m');
    await expect(verify(t)).rejects.toThrow();
  });
});
