// SPDX-License-Identifier: AGPL-3.0-only

import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Hono } from 'hono';
import { createDb } from '../../db/client.js';
import { auditLog, users } from '../../db/schema.js';
import { bearerAuth } from '../../middleware/auth.js';

export function registerAdminAuditRoutes(app: Hono): void {
  /**
   * GET /api/v1/admin/audit-log[?event_type=&user_id=&since=&until=&limit=&offset=]
   *
   * Returns paginated audit log entries. All filters are optional and may be combined.
   * Returns { entries, total } where total reflects the filtered count before pagination.
   * Each entry is enriched with `user_username` and `actor_username` (resolved via left
   * joins, null when the referenced account no longer exists). Entries are ordered newest
   * first (createdAt DESC).
   */
  app.get('/api/v1/admin/audit-log', bearerAuth({ minRole: 'admin' }), async (c) => {
    const eventType = c.req.query('event_type');
    const userId = c.req.query('user_id');
    const since = c.req.query('since');
    const until = c.req.query('until');
    const limit = Math.min(100, Number.parseInt(c.req.query('limit') ?? '20', 10) || 20);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const { db } = createDb();

    // Build the filter conditions incrementally.
    const conditions = [];
    if (eventType) conditions.push(eq(auditLog.eventType, eventType));
    if (userId) conditions.push(eq(auditLog.userId, userId));
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        conditions.push(gte(auditLog.createdAt, sinceDate));
      }
    }
    if (until) {
      const untilDate = new Date(until);
      if (!Number.isNaN(untilDate.getTime())) {
        conditions.push(lte(auditLog.createdAt, untilDate));
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Run count and paginated fetch in parallel.
    const actorUsers = alias(users, 'actor_users');
    const [countResult, rows] = await Promise.all([
      db.select({ total: count() }).from(auditLog).where(where),
      db
        .select({
          entry: auditLog,
          userUsername: users.username,
          actorUsername: actorUsers.username,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .leftJoin(actorUsers, eq(auditLog.actorUserId, actorUsers.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.total ?? 0;

    return c.json({
      entries: rows.map((r) => ({
        id: r.entry.id,
        user_id: r.entry.userId,
        actor_user_id: r.entry.actorUserId,
        user_username: r.userUsername,
        actor_username: r.actorUsername,
        event_type: r.entry.eventType,
        metadata: r.entry.metadata as Record<string, unknown>,
        created_at: r.entry.createdAt.toISOString(),
      })),
      total,
    });
  });
}
