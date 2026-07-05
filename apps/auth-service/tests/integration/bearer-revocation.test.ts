// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for bearerAuth's deny-list enforcement: a valid, correctly
// signed access token must be refused once its session (`jti`) or subject (`sub`,
// iat-aware) has been revoked — mirroring the sync-service check so both services
// enforce the same deny-list. Without this, a stolen access token survived
// recovery/logout on auth-service endpoints until it expired (~15 min).
//
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL or
// REDIS_URL is absent. The revocation check itself is pure-Redis, but reaching a
// 200 (the backward-compatible legs) needs the user row, so the whole suite is
// DB-gated.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { revokedJtiKey, revokedSubKey } from '@chatsundere/shared-types';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

/** Decodes a JWT's `iat` and `jti` claims without verifying the signature. */
function claimsOf(accessToken: string): { iat: number; jti: string } {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) throw new Error('access token has no payload segment');
  return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
    iat: number;
    jti: string;
  };
}

describe.skipIf(skip)('bearerAuth deny-list enforcement', () => {
  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  let jti: string;
  let iat: number;
  const username = `bearerrevoke${Date.now()}`.slice(0, 32).replace(/-/g, '');

  beforeAll(async () => {
    app = createServer();
    const { db } = createDb();
    const zero32 = Buffer.alloc(32);
    const inserted = await db
      .insert(users)
      .values({ username, role: 'user', recoveryVerifierKey: zero32 })
      .returning({ id: users.id });
    const insertedId = inserted[0]?.id;
    if (!insertedId) throw new Error('user insert returned no row');
    userId = insertedId;

    const tokens = await issueTokens({ userId, role: 'user' });
    accessToken = tokens.accessToken;
    ({ iat, jti } = claimsOf(accessToken));
  });

  afterAll(async () => {
    const redis = createRedis();
    await redis.del(revokedJtiKey(jti), revokedSubKey(userId));
    if (userId) {
      const { db } = createDb();
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  async function getMe(): Promise<number> {
    const res = await app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
    });
    return res.status;
  }

  it('passes a token with no deny entries (backward-compatible)', async () => {
    const redis = createRedis();
    await redis.del(revokedJtiKey(jti), revokedSubKey(userId));
    expect(await getMe()).toBe(200);
  });

  it('rejects a token whose jti is denied (denyJti hit)', async () => {
    const redis = createRedis();
    await redis.set(revokedJtiKey(jti), '1');
    try {
      expect(await getMe()).toBe(401);
    } finally {
      await redis.del(revokedJtiKey(jti));
    }
  });

  it('rejects a token whose iat predates the subject cutoff (denySub, iat < cutoff)', async () => {
    const redis = createRedis();
    await redis.set(revokedSubKey(userId), String(iat + 1));
    try {
      expect(await getMe()).toBe(401);
    } finally {
      await redis.del(revokedSubKey(userId));
    }
  });

  it('passes a token whose iat is at or after the subject cutoff (denySub, iat >= cutoff)', async () => {
    // Strict `<`: a user who logs out everywhere and immediately logs back in
    // must not be locked out by their own deny entry. Cutoff == iat → not revoked.
    const redis = createRedis();
    await redis.set(revokedSubKey(userId), String(iat));
    try {
      expect(await getMe()).toBe(200);
    } finally {
      await redis.del(revokedSubKey(userId));
    }
  });
});
