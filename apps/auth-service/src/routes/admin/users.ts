// SPDX-License-Identifier: AGPL-3.0-only

import { and, asc, count, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, picklist, string } from 'valibot';
import { writeAudit } from '../../audit/log.js';
import { denySub, nowSeconds } from '../../auth/deny-list.js';
import { createDb } from '../../db/client.js';
import { authMethods, pendingCodes, users } from '../../db/schema.js';
import { revokeAllForUser } from '../../jwt/refresh.js';
import type { AccessClaims } from '../../jwt/verify.js';
import { metrics } from '../../metrics.js';
import { bearerAuth, invalidateUserExistsCache } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-envelope.js';
import { createRedis } from '../../redis/client.js';

const roleChangeReq = object({ role: picklist(['admin', 'user']) });
const transferPrimaryReq = object({ target_user_id: string() });

export function registerAdminUserRoutes(app: Hono): void {
  /**
   * GET /api/v1/admin/users[?q=&role=&status=&limit=&offset=]
   *
   * Lists all users, optionally filtered by username substring (`q=`), role
   * (`role=user|admin|primary_admin`), and suspension status
   * (`status=suspended|active`). Paginated; `total` is the filtered row count,
   * not the length of the returned page.
   */
  app.get('/api/v1/admin/users', bearerAuth({ minRole: 'admin' }), async (c) => {
    const q = c.req.query('q');
    const role = c.req.query('role');
    const status = c.req.query('status');
    const limit = Math.min(100, Number.parseInt(c.req.query('limit') ?? '20', 10) || 20);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const { db } = createDb();

    const conditions = [];
    if (q) conditions.push(ilike(users.username, `%${q}%`));
    if (role === 'user' || role === 'admin' || role === 'primary_admin') {
      conditions.push(eq(users.role, role));
    }
    if (status === 'suspended') conditions.push(isNotNull(users.suspendedAt));
    if (status === 'active') conditions.push(isNull(users.suspendedAt));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      db.select({ total: count() }).from(users).where(where),
      db.select().from(users).where(where).limit(limit).offset(offset).orderBy(asc(users.username)),
    ]);

    return c.json({
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        role: r.role,
        suspended_at: r.suspendedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
        last_login_at: r.lastLoginAt?.toISOString() ?? null,
      })),
      total: countResult[0]?.total ?? 0,
    });
  });

  /**
   * GET /api/v1/admin/users/:id
   *
   * Returns a single user's profile including their auth methods.
   */
  app.get('/api/v1/admin/users/:id', bearerAuth({ minRole: 'admin' }), async (c) => {
    const id = c.req.param('id');
    const { db } = createDb();
    const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!row) throw new ApiError(404, 'not_found', 'User not found');
    const methods = await db.select().from(authMethods).where(eq(authMethods.userId, id));
    return c.json({
      id: row.id,
      username: row.username,
      role: row.role,
      suspended_at: row.suspendedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      last_login_at: row.lastLoginAt?.toISOString() ?? null,
      auth_methods: methods.map((m) => ({
        id: m.id,
        method_type: m.methodType,
        label: m.label,
        created_at: m.createdAt.toISOString(),
        last_used_at: m.lastUsedAt?.toISOString() ?? null,
      })),
    });
  });

  /**
   * POST /api/v1/admin/users/:id/suspend
   *
   * Suspends a user: sets suspended_at and revokes all refresh token families.
   * Audit H5: rejects self-suspension.
   */
  app.post('/api/v1/admin/users/:id/suspend', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    if (id === claims.sub) throw new ApiError(403, 'forbidden', 'Cannot self-suspend');
    const { db } = createDb();
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw new ApiError(404, 'not_found', 'User not found');
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, id));
    await revokeAllForUser(id);
    // Deny every current access token for the suspended user (spec §9).
    await denySub(createRedis(), id, nowSeconds());
    await invalidateUserExistsCache(id);
    await writeAudit({ db, eventType: 'user.suspended', userId: id, actorUserId: claims.sub });
    metrics.authAdminActionsTotal.inc({ action: 'suspend' });
    return c.json({ ok: true });
  });

  /**
   * POST /api/v1/admin/users/:id/unsuspend
   *
   * Clears the suspended_at timestamp, re-enabling the user's ability to log in.
   */
  app.post('/api/v1/admin/users/:id/unsuspend', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const { db } = createDb();
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw new ApiError(404, 'not_found', 'User not found');
    await db.update(users).set({ suspendedAt: null }).where(eq(users.id, id));
    await invalidateUserExistsCache(id);
    await writeAudit({ db, eventType: 'user.unsuspended', userId: id, actorUserId: claims.sub });
    metrics.authAdminActionsTotal.inc({ action: 'unsuspend' });
    return c.json({ ok: true });
  });

  /**
   * DELETE /api/v1/admin/users/:id
   *
   * Deletes a user and all their associated data. Uses the same NULL-out-then-delete
   * transaction pattern as DELETE /api/v1/me to handle pending_codes.redeemed_by_user_id.
   * Audit H5: primary_admin cannot delete themselves without transferring the role first.
   */
  app.delete('/api/v1/admin/users/:id', bearerAuth({ minRole: 'admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const { db } = createDb();
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw new ApiError(404, 'not_found', 'User not found');
    if (id === claims.sub && target.role === 'primary_admin') {
      throw new ApiError(
        403,
        'forbidden',
        'Cannot delete the primary admin without transferring the role first',
      );
    }
    await db.transaction(async (tx) => {
      // pending_codes.redeemed_by_user_id has no ON DELETE CASCADE, so NULL it out first.
      await tx
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
    await invalidateUserExistsCache(id);
    await writeAudit({
      db,
      eventType: 'user.deleted_by_admin',
      userId: id,
      actorUserId: claims.sub,
    });
    metrics.authAdminActionsTotal.inc({ action: 'delete' });
    return c.json({ ok: true });
  });

  /**
   * POST /api/v1/admin/users/:id/role
   *
   * Changes a user's role. Primary admin only.
   * Audit H5: the primary_admin cannot demote themselves; they must use transfer-primary first.
   */
  app.post('/api/v1/admin/users/:id/role', bearerAuth({ minRole: 'primary_admin' }), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const id = c.req.param('id');
    const body = parse(roleChangeReq, await c.req.json());
    const { db } = createDb();
    const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    if (!target) throw new ApiError(404, 'not_found', 'User not found');
    // Prevent self-demotion: the primary_admin cannot assign themselves a lower role.
    if (id === claims.sub) {
      throw new ApiError(403, 'forbidden', 'Cannot change your own role; use transfer-primary');
    }
    await db.update(users).set({ role: body.role }).where(eq(users.id, id));
    // A role change must not leave stale-role tokens alive: a demoted admin
    // would keep admin access for the remaining access-token TTL (~15 min).
    // Revoke exactly as suspend does; the subject re-authenticates and their
    // fresh tokens carry the new role.
    await revokeAllForUser(id);
    await denySub(createRedis(), id, nowSeconds());
    await invalidateUserExistsCache(id);
    await writeAudit({
      db,
      eventType: 'user.role_changed',
      userId: id,
      actorUserId: claims.sub,
      metadata: { from_role: target.role, to_role: body.role },
    });
    metrics.authAdminActionsTotal.inc({ action: 'role_change' });
    return c.json({ ok: true });
  });

  /**
   * POST /api/v1/admin/transfer-primary
   *
   * Atomically transfers the primary_admin role to another admin.
   * Runs in a SERIALIZABLE transaction; demotes self first, then promotes target
   * to satisfy the partial unique index constraint (only one primary_admin at a time).
   * Target-self is a no-op success per spec.
   */
  app.post(
    '/api/v1/admin/transfer-primary',
    bearerAuth({ minRole: 'primary_admin' }),
    async (c) => {
      const claims = c.get('claims') as AccessClaims;
      const body = parse(transferPrimaryReq, await c.req.json());
      // Target-self is an explicit no-op per spec.
      if (body.target_user_id === claims.sub) {
        return c.json({ ok: true });
      }
      const { db } = createDb();
      await db.transaction(async (tx) => {
        // SERIALIZABLE prevents concurrent transfers from racing.
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        const target = (
          await tx.select().from(users).where(eq(users.id, body.target_user_id)).limit(1)
        )[0];
        if (!target) throw new ApiError(404, 'not_found', 'Target user not found');
        if (target.role !== 'admin') {
          throw new ApiError(400, 'invalid_input', 'Target must be an admin');
        }
        // Demote self first so the partial unique index is momentarily free, then
        // promote the target. Both constraints are checked at statement-end in PostgreSQL.
        await tx.update(users).set({ role: 'admin' }).where(eq(users.id, claims.sub));
        await tx
          .update(users)
          .set({ role: 'primary_admin' })
          .where(eq(users.id, body.target_user_id));
      });
      // Both sides change role, so both sides' tokens are stale: the demoted
      // actor's tokens still claim primary_admin (an escalation window), and
      // the promoted target's tokens still claim admin. Revoke both; each
      // re-authenticates into their new role (the admin console already
      // forces the actor's sign-out after a transfer).
      const redis = createRedis();
      await revokeAllForUser(claims.sub);
      await denySub(redis, claims.sub, nowSeconds());
      await revokeAllForUser(body.target_user_id);
      await denySub(redis, body.target_user_id, nowSeconds());
      await writeAudit({
        db,
        eventType: 'primary_admin.transferred',
        userId: body.target_user_id,
        actorUserId: claims.sub,
        metadata: { previous_primary_admin_id: claims.sub },
      });
      metrics.authAdminActionsTotal.inc({ action: 'transfer_primary' });
      return c.json({ ok: true });
    },
  );
}
