// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createTokenVerifier } from '../src/auth/verify-token.js';
import type { Env } from '../src/env.js';

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'EdDSA', use: 'sig' };
  const env = { JWT_ISSUER: 'chatsundere-auth-v1', AUTH_JWKS_URL: 'https://unused' } as unknown as Env;
  const verify = createTokenVerifier(env, async () => ({ keys: [jwk] }));
  const sign = (claims: Record<string, unknown>, exp = '5m') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
      .setIssuer('chatsundere-auth-v1')
      .setJti((claims.jti as string) ?? 'j1')
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  return { verify, sign, privateKey };
}

describe('verifyToken', () => {
  test('valid token yields sub, jti, iat', async () => {
    const { verify, sign } = await fixture();
    const claims = await verify(await sign({ sub: 'user-1', jti: 'sess-1' }));
    expect(claims?.sub).toBe('user-1');
    expect(claims?.jti).toBe('sess-1');
    expect(typeof claims?.iat).toBe('number');
  });
  test('wrong issuer → null', async () => {
    const { verify, privateKey } = await fixture();
    const bad = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test' })
      .setIssuer('someone-else').setJti('j').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey);
    expect(await verify(bad)).toBeNull();
  });
  test('expired token → null', async () => {
    const { verify, sign } = await fixture();
    expect(await verify(await sign({ sub: 'x', jti: 'j' }, '-1m'))).toBeNull();
  });
  test('tampered / garbage token → null', async () => {
    const { verify } = await fixture();
    expect(await verify('not.a.jwt')).toBeNull();
  });
  test('wrong-algorithm (RS256) token → null', async () => {
    const { verify } = await fixture();
    const { privateKey } = await generateKeyPair('RS256');
    const rs = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('chatsundere-auth-v1').setJti('j').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey);
    expect(await verify(rs)).toBeNull();
  });
});
