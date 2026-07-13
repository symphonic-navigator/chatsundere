// SPDX-License-Identifier: AGPL-3.0-only

import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { number, object, optional, parse, picklist, pipe, string, transform } from 'valibot';
import { writeAudit } from '../../audit/log.js';
import { requireStepUp } from '../../auth/step-up.js';
import { buildJoinQrUrl } from '../../codes/qr-url.js';
import { generateCode, hashCode } from '../../codes/token.js';
import { createDb } from '../../db/client.js';
import { pendingCodes } from '../../db/schema.js';
import { loadEnv } from '../../env.js';
import type { AccessClaims } from '../../jwt/verify.js';
import { metrics } from '../../metrics.js';
import { bearerAuth } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-envelope.js';

const createInvitationReq = object({
  role: picklist(['admin', 'user']),
  expires_in_seconds: pipe(
    number(),
    transform((n) => Math.floor(n)),
  ),
  issuer_label: optional(string()),
  suggested_username: optional(string()),
  note: optional(string()),
});

/** Computes the human-readable status of an invitation row. */
function invitationStatus(row: {
  revokedAt: Date | null;
  redeemedAt: Date | null;
  expiresAt: Date;
}): 'pending' | 'redeemed' | 'revoked' | 'expired' {
  if (row.revokedAt) return 'revoked';
  if (row.redeemedAt) return 'redeemed';
  if (row.expiresAt < new Date()) return 'expired';
  return 'pending';
}

export function registerAdminInvitationRoutes(app: Hono): void {
  /**
   * GET /api/v1/admin/invitations[?status=pending|redeemed|revoked|expired&limit=&offset=]
   *
   * Lists all invitations. Status is computed from row fields and optionally filtered.
   * The one-time token is intentionally absent from list responses.
   */
  app.get('/api/v1/admin/invitations', bearerAuth({ minRole: 'admin' }), async (c) => {
    const statusFilter = c.req.query('status');
    const limit = Math.min(100, Number.parseInt(c.req.query('limit') ?? '20', 10) || 20);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const { db } = createDb();
    // Fetch all rows and compute status in JS — small N is fine for phase 0.
    const rows = await db.select().from(pendingCodes).orderBy(sql`${pendingCodes.createdAt} DESC`);
    const mapped = rows.map((r) => ({
      id: r.id,
      role: r.role,
      issuer_label: r.issuerLabel,
      suggested_username: r.suggestedUsername,
      note: r.note,
      created_by: r.createdBy,
      created_at: r.createdAt.toISOString(),
      expires_at: r.expiresAt.toISOString(),
      redeemed_at: r.redeemedAt?.toISOString() ?? null,
      redeemed_by_user_id: r.redeemedByUserId,
      revoked_at: r.revokedAt?.toISOString() ?? null,
      attempt_count: r.attemptCount,
      status: invitationStatus(r),
    }));
    const filtered = statusFilter ? mapped.filter((r) => r.status === statusFilter) : mapped;
    const page = filtered.slice(offset, offset + limit);
    return c.json({ invitations: page, total: filtered.length });
  });

  /**
   * POST /api/v1/admin/invitations
   *
   * Creates a new invitation. Returns the one-time 10-character code and a
   * deep-link QR URL. The code and qr_url are never returned again after
   * this response — operators who lose them must revoke + reissue.
   */
  app.post('/api/v1/admin/invitations', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionId = c.get('sessionId');
    await requireStepUp({ sessionId, tier: 4 });
    const body = parse(createInvitationReq, await c.req.json());
    const code = generateCode();
    const codeHmac = await hashCode(code);
    const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000);
    const { db } = createDb();
    const [newInvitation] = await db
      .insert(pendingCodes)
      .values({
        type: 'invitation',
        codeHmac,
        role: body.role,
        issuerLabel: body.issuer_label ?? null,
        suggestedUsername: body.suggested_username ?? null,
        note: body.note ?? null,
        createdBy: claims.sub,
        expiresAt,
      })
      .returning({ id: pendingCodes.id });
    if (!newInvitation) throw new ApiError(500, 'internal', 'Failed to create invitation');
    const env = loadEnv();
    const qrUrl = buildJoinQrUrl(env, code, body.suggested_username);
    await writeAudit({
      db,
      eventType: 'invitation.created',
      actorUserId: claims.sub,
      metadata: {
        invitation_id: newInvitation.id,
        role: body.role,
        expires_at: expiresAt.toISOString(),
      },
    });
    metrics.authInvitationsCreatedTotal.inc({ role: body.role });
    metrics.authAdminActionsTotal.inc({ action: 'invite_create' });
    return c.json(
      {
        invitation_id: newInvitation.id,
        code,
        qr_url: qrUrl,
        expires_at: expiresAt.toISOString(),
        state: 'active' as const,
      },
      201,
    );
  });

  /**
   * DELETE /api/v1/admin/invitations/:id
   *
   * Revokes a pending invitation. Already-redeemed invitations cannot be revoked.
   */
  app.delete('/api/v1/admin/invitations/:id', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const { db } = createDb();
    const row = (await db.select().from(pendingCodes).where(eq(pendingCodes.id, id)).limit(1))[0];
    if (!row) throw new ApiError(404, 'not_found', 'Invitation not found');
    if (row.revokedAt) throw new ApiError(409, 'conflict', 'Invitation already revoked');
    if (row.redeemedAt) throw new ApiError(409, 'conflict', 'Invitation already redeemed');
    await db.update(pendingCodes).set({ revokedAt: new Date() }).where(eq(pendingCodes.id, id));
    await writeAudit({
      db,
      eventType: 'invitation.revoked',
      actorUserId: claims.sub,
      metadata: { invitation_id: id },
    });
    metrics.authAdminActionsTotal.inc({ action: 'invite_revoke' });
    return c.json({ ok: true });
  });
}
