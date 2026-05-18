// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for JWT issuance and refresh-token rotation.
// These tests require a live PostgreSQL instance. They are skipped when
// DATABASE_URL is not set, so `bun test` (unit-only) remains self-contained.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { rotateRefreshToken } from '../../src/jwt/refresh.js';
import { verifyAccessToken } from '../../src/jwt/verify.js';

const skip = !process.env.DATABASE_URL;

describe.skipIf(skip)('JWT issue / verify', () => {
  let userId: string;

  beforeAll(async () => {
    const { db } = createDb();
    const inserted = await db
      .insert(users)
      .values({
        username: `jwt-test-${Date.now()}`,
        role: 'user',
        recoveryVerifierKey: new Uint8Array(32),
      })
      .returning({ id: users.id });
    userId = inserted[0]?.id ?? '';
  });

  afterAll(async () => {
    const { db } = createDb();
    await db.delete(users).where(eq(users.id, userId));
    await closeDb();
  });

  it('issues an access token that verifies correctly', async () => {
    const tokens = await issueTokens({ userId, role: 'user' });
    const claims = await verifyAccessToken(tokens.accessToken);
    expect(claims.sub).toBe(userId);
    expect(claims.role).toBe('user');
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
  });

  it('issues tokens for every role without throwing', async () => {
    for (const role of ['primary_admin', 'admin', 'user'] as const) {
      const tokens = await issueTokens({ userId, role });
      const claims = await verifyAccessToken(tokens.accessToken);
      expect(claims.role).toBe(role);
    }
  });
});

describe.skipIf(skip)('Refresh-token rotation + re-use detection', () => {
  let userId: string;

  beforeAll(async () => {
    const { db } = createDb();
    const inserted = await db
      .insert(users)
      .values({
        username: `reuse-test-${Date.now()}`,
        role: 'user',
        recoveryVerifierKey: new Uint8Array(32),
      })
      .returning({ id: users.id });
    userId = inserted[0]?.id ?? '';
  });

  afterAll(async () => {
    const { db } = createDb();
    await db.delete(users).where(eq(users.id, userId));
    await closeDb();
  });

  it('rotates a refresh token and returns a new access token', async () => {
    const t1 = await issueTokens({ userId, role: 'user' });
    const r1 = await rotateRefreshToken({ presentedToken: t1.refreshToken });
    expect(r1.outcome).toBe('ok');
    expect(r1.tokens).toBeDefined();
    const claims = await verifyAccessToken(r1.tokens?.accessToken ?? '');
    expect(claims.sub).toBe(userId);
  });

  it('detects re-use of a rotated refresh token and revokes the family', async () => {
    const t1 = await issueTokens({ userId, role: 'user' });

    // First rotation — legitimate.
    const r1 = await rotateRefreshToken({ presentedToken: t1.refreshToken });
    expect(r1.outcome).toBe('ok');

    // Second rotation using the original (already-rotated) token — re-use.
    const r2 = await rotateRefreshToken({ presentedToken: t1.refreshToken });
    expect(r2.outcome).toBe('reuse_detected');

    // The newly issued token from r1 should also be revoked (family revoked).
    const r3 = await rotateRefreshToken({ presentedToken: r1.tokens?.refreshToken ?? '' });
    expect(r3.outcome).toBe('reuse_detected');
  });

  it('returns invalid for an unknown token', async () => {
    const result = await rotateRefreshToken({ presentedToken: 'not-a-real-token' });
    expect(result.outcome).toBe('invalid');
  });
});
