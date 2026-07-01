// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { loadEnv } from '../src/env.js';

const base = {
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWKS_URL: 'https://auth.example/api/v1/jwks',
};

describe('proxy env', () => {
  test('JWT_ISSUER defaults to chatsundere-auth-v1', () => {
    expect(loadEnv(base).JWT_ISSUER).toBe('chatsundere-auth-v1');
  });
  test('CORS_ALLOWED_ORIGINS parses a comma list into an array', () => {
    const env = loadEnv({ ...base, CORS_ALLOWED_ORIGINS: 'https://a.me, https://b.me' });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.me', 'https://b.me']);
  });
  test('numeric envs coerce and default', () => {
    const env = loadEnv(base);
    expect(env.RATE_LIMIT_USER_PER_MIN).toBe(120);
    expect(env.RATE_LIMIT_IP_PER_MIN).toBe(600);
    expect(env.MAX_BODY_BYTES).toBe(52428800);
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });
  test('no DATABASE_URL is required', () => {
    expect(() => loadEnv(base)).not.toThrow();
  });
});
