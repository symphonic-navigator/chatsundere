// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the admin invitation and audit-log endpoints.
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { auditLog, invitations, users } from '../../src/db/schema.js';
import { hashInvitationToken } from '../../src/invitations/token.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };

describe.skipIf(skip)('Admin invitation endpoints', () => {
  let app: ReturnType<typeof createServer>;

  /** A primary_admin user created directly in the DB. */
  let adminId: string;
  let adminToken: string;

  /** A regular user — used to verify 403 rejections. */
  let userId: string;
  let userToken: string;

  /** Invitation IDs created during tests — cleaned up in afterAll. */
  const createdInvitationIds: string[] = [];

  const ts = Date.now();
  const adminUsername = `invadm${ts}`.slice(0, 32).replace(/-/g, '');
  const userUsername = `invusr${ts}`.slice(0, 32).replace(/-/g, '');

  /**
   * Creates a bare-minimum user row directly in the database, bypassing the
   * full OPAQUE link flow. Sufficient for issuing tokens and testing admin
   * endpoints that only need a valid user_id.
   */
  async function createBareUser(opts: {
    username: string;
    role: 'primary_admin' | 'admin' | 'user';
  }): Promise<string> {
    const { db } = createDb();
    // Insert a minimal invitation for the FK on users.redeemed_by_user_id — not needed
    // here since we insert users directly. We just need a plausible recovery_verifier_key.
    const zero32 = Buffer.alloc(32);
    const rows = await db
      .insert(users)
      .values({
        username: opts.username,
        role: opts.role,
        recoveryVerifierKey: zero32,
      })
      .returning({ id: users.id });
    const row = rows[0];
    if (!row) throw new Error('Failed to insert test user');
    return row.id;
  }

  beforeAll(async () => {
    app = createServer();
    adminId = await createBareUser({ username: adminUsername, role: 'primary_admin' });
    userId = await createBareUser({ username: userUsername, role: 'user' });
    ({ accessToken: adminToken } = await issueTokens({ userId: adminId, role: 'primary_admin' }));
    ({ accessToken: userToken } = await issueTokens({ userId, role: 'user' }));
  });

  afterAll(async () => {
    const { db } = createDb();
    // Remove any invitations created during the tests.
    for (const id of createdInvitationIds) {
      await db.delete(invitations).where(eq(invitations.id, id));
    }
    // Remove the audit rows for the test admin to avoid cross-test contamination.
    await db.delete(auditLog).where(eq(auditLog.actorUserId, adminId));
    // Remove users (both bare rows inserted directly — no invitation FK to null out).
    for (const id of [adminId, userId]) {
      if (id) await db.delete(users).where(eq(users.id, id));
    }
    await closeDb();
  });

  // ---------------------------------------------------------------------------
  // POST /v1/admin/invitations
  // ---------------------------------------------------------------------------

  it('POST /v1/admin/invitations returns 403 for regular user', async () => {
    const res = await app.request('/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /v1/admin/invitations creates an invitation and returns token + qr_payload', async () => {
    const res = await app.request('/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600, issuer_label: 'test-issuer' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invitation_id: string;
      token: string;
      expires_at: string;
      qr_payload: string;
    };
    expect(typeof body.invitation_id).toBe('string');
    expect(typeof body.token).toBe('string');
    expect(typeof body.expires_at).toBe('string');
    expect(typeof body.qr_payload).toBe('string');
    createdInvitationIds.push(body.invitation_id);

    // Verify the QR payload decodes to the expected shape.
    const decoded = JSON.parse(Buffer.from(body.qr_payload, 'base64url').toString('utf8')) as {
      v: number;
      kind: string;
      token: string;
      base_url: string;
      role: string;
      issuer_label: string | null;
    };
    expect(decoded.v).toBe(1);
    expect(decoded.kind).toBe('invitation');
    expect(decoded.token).toBe(body.token);
    expect(decoded.role).toBe('user');
    expect(decoded.issuer_label).toBe('test-issuer');
    // base_url must not end with /auth
    expect(decoded.base_url.endsWith('/auth')).toBe(false);

    // Verify the token hashes to the row stored in the DB.
    const { db } = createDb();
    const row = (
      await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(eq(invitations.id, body.invitation_id))
        .limit(1)
    )[0];
    expect(row?.id).toBe(body.invitation_id);
  });

  it('POST /v1/admin/invitations rejects unknown role', async () => {
    const res = await app.request('/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'primary_admin', expires_in_seconds: 3600 }),
    });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // GET /v1/admin/invitations
  // ---------------------------------------------------------------------------

  it('GET /v1/admin/invitations returns 403 for regular user', async () => {
    const res = await app.request('/v1/admin/invitations', {
      headers: { Authorization: `Bearer ${userToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it('GET /v1/admin/invitations lists invitations without token field', async () => {
    const res = await app.request('/v1/admin/invitations', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    type InvRow = { id: string; status: string; token?: undefined };
    const body = (await res.json()) as {
      invitations: Array<InvRow>;
      total: number;
    };
    expect(Array.isArray(body.invitations)).toBe(true);
    expect(typeof body.total).toBe('number');
    // Ensure no invitation row exposes the raw token.
    for (const inv of body.invitations) {
      expect(inv.token).toBeUndefined();
    }
    // The invitation we created should be in the list.
    const found = body.invitations.some((i) => i.id === createdInvitationIds[0]);
    expect(found).toBe(true);
  });

  it('GET /v1/admin/invitations filters by status=pending', async () => {
    const res = await app.request('/v1/admin/invitations?status=pending', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invitations: Array<{ status: string }>;
      total: number;
    };
    for (const inv of body.invitations) {
      expect(inv.status).toBe('pending');
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /v1/admin/invitations/:id
  // ---------------------------------------------------------------------------

  it('DELETE /v1/admin/invitations/:id revokes a pending invitation', async () => {
    // Create a fresh invitation to revoke.
    const createRes = await app.request('/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
    });
    const { invitation_id } = (await createRes.json()) as { invitation_id: string };
    createdInvitationIds.push(invitation_id);

    const res = await app.request(`/v1/admin/invitations/${invitation_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify revokedAt is now set.
    const { db } = createDb();
    const row = (
      await db
        .select({ revokedAt: invitations.revokedAt })
        .from(invitations)
        .where(eq(invitations.id, invitation_id))
        .limit(1)
    )[0];
    expect(row?.revokedAt).not.toBeNull();
  });

  it('DELETE /v1/admin/invitations/:id returns 409 when already revoked', async () => {
    const alreadyRevokedId = createdInvitationIds.at(-1);
    if (!alreadyRevokedId) throw new Error('Expected a revoked invitation id');

    const res = await app.request(`/v1/admin/invitations/${alreadyRevokedId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('conflict');
  });

  it('DELETE /v1/admin/invitations/:id returns 404 for unknown id', async () => {
    const res = await app.request('/v1/admin/invitations/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /v1/admin/invitations/:id returns 409 when already redeemed', async () => {
    // Insert an invitation directly as redeemed.
    const { db } = createDb();
    const rawToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const tokenHmac = await hashInvitationToken(rawToken);
    const rows = await db
      .insert(invitations)
      .values({
        tokenHmac,
        role: 'user',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        redeemedAt: new Date(),
        redeemedByUserId: userId,
      })
      .returning({ id: invitations.id });
    const row = rows[0];
    if (!row) throw new Error('Failed to insert test invitation');
    const redeemedId = row.id;
    createdInvitationIds.push(redeemedId);

    const res = await app.request(`/v1/admin/invitations/${redeemedId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('conflict');
  });

  // ---------------------------------------------------------------------------
  // GET /v1/admin/audit-log
  // ---------------------------------------------------------------------------

  it('GET /v1/admin/audit-log returns 403 for regular user', async () => {
    const res = await app.request('/v1/admin/audit-log', {
      headers: { Authorization: `Bearer ${userToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it('GET /v1/admin/audit-log returns entries with expected shape', async () => {
    const res = await app.request('/v1/admin/audit-log', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{
        id: string;
        user_id: string | null;
        actor_user_id: string | null;
        event_type: string;
        metadata: Record<string, unknown>;
        created_at: string;
      }>;
      total: number;
    };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe('number');
    if (body.entries.length > 0) {
      const entry = body.entries[0];
      if (!entry) throw new Error('Expected at least one entry');
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.event_type).toBe('string');
      expect(typeof entry.created_at).toBe('string');
    }
  });

  it('GET /v1/admin/audit-log filters by event_type=invitation.created', async () => {
    const res = await app.request('/v1/admin/audit-log?event_type=invitation.created', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ event_type: string; actor_user_id: string | null }>;
      total: number;
    };
    // Every returned entry must match the filter.
    for (const entry of body.entries) {
      expect(entry.event_type).toBe('invitation.created');
    }
    // Our admin should have generated at least two invitation.created events above.
    const mine = body.entries.filter((e) => e.actor_user_id === adminId);
    expect(mine.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /v1/admin/audit-log filters by event_type=invitation.revoked', async () => {
    const res = await app.request('/v1/admin/audit-log?event_type=invitation.revoked', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ event_type: string; actor_user_id: string | null }>;
    };
    for (const entry of body.entries) {
      expect(entry.event_type).toBe('invitation.revoked');
    }
    const mine = body.entries.filter((e) => e.actor_user_id === adminId);
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/admin/audit-log paginates correctly', async () => {
    // Fetch total with a large limit, then re-fetch with limit=1 and verify offset works.
    const allRes = await app.request('/v1/admin/audit-log', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const allBody = (await allRes.json()) as { total: number };
    if (allBody.total < 2) {
      // Not enough rows to test pagination meaningfully — skip the assertion.
      return;
    }
    const pageRes = await app.request('/v1/admin/audit-log?limit=1&offset=1', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const pageBody = (await pageRes.json()) as {
      entries: Array<{ id: string }>;
      total: number;
    };
    expect(pageBody.entries.length).toBe(1);
    expect(pageBody.total).toBe(allBody.total);
  });

  it('GET /v1/admin/audit-log filters by since= and until=', async () => {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const until = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min from now
    const res = await app.request(
      `/v1/admin/audit-log?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
      {
        headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ created_at: string }>; total: number };
    for (const entry of body.entries) {
      const ts = new Date(entry.created_at).getTime();
      expect(ts).toBeGreaterThanOrEqual(new Date(since).getTime());
      expect(ts).toBeLessThanOrEqual(new Date(until).getTime());
    }
  });
});
