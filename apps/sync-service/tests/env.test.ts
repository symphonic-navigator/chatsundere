// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { loadEnv } from '../src/env.js';

const base = {
  DATABASE_URL: 'postgres://chatsundere:dev@localhost:5432/sync_db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWKS_URL: 'https://auth.example/api/v1/jwks',
};

describe('sync env', () => {
  test('JWT_ISSUER defaults to chatsundere-auth-v1', () => {
    // The skeleton default (chatsundere-auth) was wrong — spec §9.
    expect(loadEnv(base).JWT_ISSUER).toBe('chatsundere-auth-v1');
  });
  test('quota and ceiling defaults match spec §14', () => {
    const env = loadEnv(base);
    expect(env.MAX_RECORD_BYTES).toBe(2097152);
    expect(env.ACCOUNT_QUOTA_BYTES).toBe(1073741824);
    expect(env.MAX_PUSH_RECORDS).toBe(100);
    expect(env.MAX_BODY_BYTES).toBe(25165824);
    expect(env.PULL_LIMIT_DEFAULT).toBe(200);
    expect(env.PULL_LIMIT_MAX).toBe(500);
    expect(env.PULL_BYTE_BUDGET).toBe(8388608);
    expect(env.RATE_LIMIT_DELETE_PER_MIN).toBe(60);
    expect(env.WS_PING_INTERVAL_S).toBe(30);
    expect(env.DOORBELL_TICKET_TTL_S).toBe(30);
    expect(env.MAX_SOCKETS_PER_ACCOUNT).toBe(8);
  });
  test('CORS_ALLOWED_ORIGINS parses a comma list, lowercased', () => {
    const env = loadEnv({ ...base, CORS_ALLOWED_ORIGINS: 'https://A.me, https://b.me' });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.me', 'https://b.me']);
  });
});
