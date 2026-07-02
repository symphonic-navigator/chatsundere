// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { blobsEnabled, loadEnv } from '../src/env.js';

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
    // Blob spec §2.3/§14 raises the shared records+blobs quota default to 2 GiB.
    expect(env.ACCOUNT_QUOTA_BYTES).toBe(2147483648);
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

  describe('blob transport (spec §14)', () => {
    test('blob defaults match spec §14', () => {
      const env = loadEnv(base);
      expect(env.MAX_BLOB_BYTES).toBe(33554432);
      expect(env.BLOB_QUOTA_FLOOR_BYTES).toBe(65536);
      expect(env.BLOB_UPLOAD_IDLE_TIMEOUT_S).toBe(30);
      expect(env.S3_REGION).toBe('us-east-1');
      expect(env.S3_BUCKET).toBe('chatsundere-blobs');
      expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    });

    test('S3_ENDPOINT unset ⇒ blobs disabled, no credentials required', () => {
      const env = loadEnv(base);
      expect(env.S3_ENDPOINT).toBeUndefined();
      expect(blobsEnabled(env)).toBe(false);
    });

    test('S3_ENDPOINT set with credentials ⇒ blobs enabled', () => {
      const env = loadEnv({
        ...base,
        S3_ENDPOINT: 'http://minio:9000',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
      });
      expect(blobsEnabled(env)).toBe(true);
    });

    test('S3_ENDPOINT set but credentials missing ⇒ env load throws', () => {
      expect(() => loadEnv({ ...base, S3_ENDPOINT: 'http://minio:9000' })).toThrow();
      expect(() =>
        loadEnv({ ...base, S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY_ID: 'key' }),
      ).toThrow();
    });

    test('S3_FORCE_PATH_STYLE accepts a false string', () => {
      const env = loadEnv({ ...base, S3_FORCE_PATH_STYLE: 'false' });
      expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    });
  });
});
