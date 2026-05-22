// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';
import { sha256ForCookie } from '../jwt/issue.js';
import { revokeAllForUser, revokeFamily } from '../jwt/refresh.js';
import type { AccessClaims } from '../jwt/verify.js';
import { bearerAuth } from '../middleware/auth.js';
import { createRedis } from '../redis/client.js';

const CLEAR_COOKIE =
  'refresh_token=; HttpOnly; SameSite=Lax; Path=/api/v1/token/refresh; Max-Age=0';

/** Registers POST /api/v1/auth/logout. */
export function registerAuthRoutes(app: Hono): void {
  app.post('/api/v1/auth/logout', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const all = c.req.query('revoke_all') === 'true';

    if (all) {
      await revokeAllForUser(claims.sub);
      await writeAudit({
        db: createDb().db,
        eventType: 'auth.logout',
        userId: claims.sub,
        actorUserId: claims.sub,
        metadata: { scope: 'all' },
      });
    } else {
      // "This device" logout: hash the current refresh cookie, find its family,
      // and revoke only that family. Falls back to revokeAllForUser when no
      // cookie is present (e.g. cookie already cleared or non-cookie client).
      const cookieHeader = c.req.header('Cookie') ?? '';
      const match = cookieHeader.match(/(?:^|;\s*)refresh_token=([^;]+)/);
      const presented = match?.[1];

      if (presented) {
        const hash = await sha256ForCookie(presented);
        const { db } = createDb();
        const rows = await db
          .select({ familyId: refreshTokens.familyId })
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, hash))
          .limit(1);
        const familyId = rows[0]?.familyId;
        if (familyId) {
          await revokeFamily(familyId);
        } else {
          // Token unknown (already expired/revoked) — revoke all to be safe.
          await revokeAllForUser(claims.sub);
        }
      } else {
        // No cookie on this request — revoke all tokens for the user.
        await revokeAllForUser(claims.sub);
      }

      await writeAudit({
        db: createDb().db,
        eventType: 'auth.logout',
        userId: claims.sub,
        actorUserId: claims.sub,
        metadata: { scope: 'this_device' },
      });
    }

    // Step-up cascade per ADR 0027: invalidate all per-session grace windows
    // so a stolen bearer cannot ride the residual confirmation past logout.
    await clearStepUpKeys(claims.jti);

    c.header('Set-Cookie', CLEAR_COOKIE);
    return c.json({ ok: true });
  });
}

/**
 * Deletes every `step_up:<sessionId>:*` key using SCAN — avoids the O(n)
 * keyspace scan that `KEYS` would do. Phase 0 Redis is small either way,
 * but SCAN keeps the same code shape when the keyspace grows.
 */
async function clearStepUpKeys(sessionId: string): Promise<void> {
  const redis = createRedis();
  const pattern = `step_up:${sessionId}:*`;
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (batch.length > 0) {
      await redis.del(...batch);
    }
  } while (cursor !== '0');
}
