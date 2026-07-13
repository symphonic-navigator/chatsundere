// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { writeAudit } from '../audit/log.js';
import { requireStepUp } from '../auth/step-up.js';
import { buildJoinQrUrl } from '../codes/qr-url.js';
import { generateCode, hashCode } from '../codes/token.js';
import { createDb } from '../db/client.js';
import { pendingCodes } from '../db/schema.js';
import { loadEnv } from '../env.js';
import type { AccessClaims } from '../jwt/verify.js';
import { metrics } from '../metrics.js';
import { bearerAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-envelope.js';

/**
 * Pairing codes are short-lived (5 minutes) one-shot tokens the user issues
 * from an authenticated device to cross-device-join a new device into their
 * existing crypto domain. Storage is HMAC-only (codes/token.ts) — the
 * plaintext is returned to the user once at creation time and never again.
 */
const PAIRING_TTL_SECONDS = 5 * 60;

export function registerMePairingCodeRoutes(app: Hono): void {
  // Tier 1 step-up is required to mint a new code: the operation creates a
  // server-side capability that lets *any* holder of the resulting code
  // claim the user's account, so it ranks alongside auth-mutating endpoints
  // per ADR 0027.
  app.post('/api/v1/me/pairing-codes', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionId = c.get('sessionId') as string;
    await requireStepUp({ sessionId, tier: 1 });

    const code = generateCode();
    const codeHmac = await hashCode(code);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_SECONDS * 1000);

    const { db } = createDb();
    const rows = await db
      .insert(pendingCodes)
      .values({
        type: 'pairing',
        codeHmac,
        createdBy: claims.sub,
        expiresAt,
      })
      .returning({ id: pendingCodes.id, createdAt: pendingCodes.createdAt });
    const row = rows[0];
    if (!row) throw new ApiError(500, 'internal', 'pending_codes insert returned no row');

    const env = loadEnv();
    const qrUrl = buildJoinQrUrl(env, code);

    await writeAudit({
      db,
      eventType: 'pairing_code.created',
      userId: claims.sub,
      actorUserId: claims.sub,
      metadata: { pairing_code_id: row.id, expires_at: expiresAt.toISOString() },
    });
    metrics.authPairingCodesCreatedTotal.inc();

    return c.json(
      {
        id: row.id,
        code,
        qr_url: qrUrl,
        expires_at: expiresAt.toISOString(),
        created_at: row.createdAt.toISOString(),
        state: 'active' as const,
      },
      201,
    );
  });

  // GET returns code:null + qr_url:null — pairing codes are HMAC-stored so
  // the plaintext cannot be recovered after creation. The user must save
  // the code from the POST response or revoke+reissue. Documented as a
  // spec §4.5 deviation in obsidian/insights/follow-ups-index.md.
  app.get('/api/v1/me/pairing-codes', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const { db } = createDb();
    const rows = await db
      .select({
        id: pendingCodes.id,
        createdAt: pendingCodes.createdAt,
        expiresAt: pendingCodes.expiresAt,
      })
      .from(pendingCodes)
      .where(
        and(
          eq(pendingCodes.createdBy, claims.sub),
          eq(pendingCodes.type, 'pairing'),
          isNull(pendingCodes.redeemedAt),
          isNull(pendingCodes.revokedAt),
          gt(pendingCodes.expiresAt, new Date()),
        ),
      );

    return c.json({
      pairing_codes: rows.map((r) => ({
        id: r.id,
        code: null,
        qr_url: null,
        created_at: r.createdAt.toISOString(),
        expires_at: r.expiresAt.toISOString(),
        state: 'active' as const,
      })),
    });
  });

  app.delete('/api/v1/me/pairing-codes/:id', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const { db } = createDb();

    const row = (
      await db
        .select({
          id: pendingCodes.id,
          type: pendingCodes.type,
          revokedAt: pendingCodes.revokedAt,
          redeemedAt: pendingCodes.redeemedAt,
        })
        .from(pendingCodes)
        .where(and(eq(pendingCodes.id, id), eq(pendingCodes.createdBy, claims.sub)))
        .limit(1)
    )[0];
    // Note: we intentionally do not surface a distinct error when a row
    // exists but is owned by another user — the 404 keeps the existence of
    // foreign rows opaque.
    if (!row || row.type !== 'pairing') {
      throw new ApiError(404, 'not_found', 'Pairing code not found');
    }
    if (row.revokedAt) {
      throw new ApiError(409, 'already_revoked', 'Pairing code already revoked');
    }
    if (row.redeemedAt) {
      throw new ApiError(409, 'already_redeemed', 'Pairing code already redeemed');
    }

    await db.update(pendingCodes).set({ revokedAt: new Date() }).where(eq(pendingCodes.id, id));

    await writeAudit({
      db,
      eventType: 'pairing_code.revoked',
      userId: claims.sub,
      actorUserId: claims.sub,
      metadata: { pairing_code_id: id },
    });
    metrics.authPairingCodesRevokedTotal.inc();

    return c.json({ ok: true });
  });
}
