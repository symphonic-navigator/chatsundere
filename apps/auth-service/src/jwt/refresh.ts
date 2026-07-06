// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull } from 'drizzle-orm';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import { metrics } from '../metrics.js';
import { invalidateUserExistsCache } from '../middleware/auth.js';
import { type IssuedTokens, issueTokens, sha256ForCookie } from './issue.js';

export interface RotateResult {
  outcome: 'ok' | 'invalid' | 'reuse_detected' | 'user_gone';
  tokens?: IssuedTokens;
}

/**
 * Rotates a refresh token, implementing RFC-style token rotation with re-use detection.
 *
 * Happy path: presented token is valid and not revoked → atomically claim
 * (revoke) the presented row, then issue new tokens and link rotated_to_id to
 * the successor. The claim is conditional on the row still being unrevoked, so
 * two requests racing with the same still-valid token cannot both succeed —
 * the family never ends up with two live successor tokens.
 *
 * Re-use signal: presented token's row is already revoked *and* has rotated_to_id set,
 * meaning it was previously rotated legitimately. This indicates a stolen token;
 * the entire family is immediately revoked and an audit event is written.
 */
export async function rotateRefreshToken(args: {
  presentedToken: string;
  userAgent?: string;
}): Promise<RotateResult> {
  const { db } = createDb();
  const hash = await sha256ForCookie(args.presentedToken);

  const matching = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);
  const row = matching[0];
  if (!row) return { outcome: 'invalid' };

  if (row.revokedAt !== null) {
    if (row.rotatedToId !== null) {
      // Token was previously rotated — presenting it again is a re-use attack.
      // Revoke all non-revoked tokens in this family immediately.
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      await writeAudit({
        db,
        eventType: 'refresh_token.reuse_detected',
        userId: row.userId,
        metadata: { family_id: row.familyId },
      });
      metrics.authRefreshReuseDetectedTotal.inc();
    }
    return { outcome: 'reuse_detected' };
  }

  if (row.expiresAt < new Date()) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, row.id));
    return { outcome: 'invalid' };
  }

  const userRow = await db
    .select({ id: users.id, role: users.role, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  const user = userRow[0];
  if (!user || user.suspendedAt !== null) {
    return { outcome: 'user_gone' };
  }

  // Atomically claim the presented token before issuing its successor. The
  // conditional `revoked_at IS NULL` guard means that when two requests race
  // with the same still-valid token, exactly one UPDATE matches a row; the
  // loser matches zero and is denied below, so the family can never end up with
  // two live successor tokens (which would silently defeat re-use detection).
  // Revoking before issuing is also fail-safe: a crash between the two steps
  // leaves the old token dead rather than leaving both tokens live.
  const claimed = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (claimed.length !== 1) {
    // A concurrent request already rotated this exact token. Deny the duplicate
    // without revoking the family: we cannot distinguish a benign client race
    // (multi-tab / retry) from theft here, and the winning rotation is intact.
    return { outcome: 'reuse_detected' };
  }

  const tokens = await issueTokens({
    userId: user.id,
    role: user.role,
    familyId: row.familyId,
    userAgent: args.userAgent,
  });

  // Link the now-revoked row to its successor so that a later re-present of the
  // old token trips the family-wide re-use revocation above.
  await db
    .update(refreshTokens)
    .set({ rotatedToId: tokens.refreshTokenId })
    .where(eq(refreshTokens.id, row.id));

  return { outcome: 'ok', tokens };
}

/** Revokes all non-revoked tokens belonging to a specific refresh-token family. */
export async function revokeFamily(familyId: string): Promise<void> {
  const { db } = createDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/**
 * Revokes all non-revoked refresh tokens for a user (sign out all devices).
 * Also invalidates the Redis user-exists cache so that a suspended user's access
 * tokens are rejected immediately rather than waiting for the 30 s TTL.
 */
export async function revokeAllForUser(userId: string): Promise<void> {
  const { db } = createDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  await invalidateUserExistsCache(userId);
}
