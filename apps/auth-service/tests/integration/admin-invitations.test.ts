// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the admin invitation and audit-log endpoints.
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { auditLog, pendingCodes, users } from '../../src/db/schema.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };

describe.skipIf(skip)('Admin invitation endpoints', () => {
  let app: ReturnType<typeof createServer>;

  /** A primary_admin user created directly in the DB. */
  let adminId: string;
  let adminToken: string;
  let adminSessionId: string;

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
    ({ accessToken: adminToken, sessionId: adminSessionId } = await issueTokens({
      userId: adminId,
      role: 'primary_admin',
    }));
    ({ accessToken: userToken } = await issueTokens({ userId, role: 'user' }));
  });

  /**
   * Seed a fresh Tier 4 step-up confirmation for the admin's session. POST
   * /api/v1/admin/invitations now requires this per ADR 0027; tests that
   * exercise the happy path call this in beforeEach to keep each test
   * independent of step-up grace bleed-through.
   */
  beforeEach(async () => {
    const redis = createRedis();
    await redis.set(`step_up:${adminSessionId}:t4`, String(Date.now()), 'EX', 400);
  });

  afterAll(async () => {
    const { db } = createDb();
    // Remove any pending_codes created during the tests.
    for (const id of createdInvitationIds) {
      await db.delete(pendingCodes).where(eq(pendingCodes.id, id));
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
  // POST /api/v1/admin/invitations
  // ---------------------------------------------------------------------------

  it('POST /api/v1/admin/invitations returns 403 for regular user', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/v1/admin/invitations returns 403 step_up_required without Tier 4 step-up', async () => {
    // beforeEach seeds the step-up key; clear it to exercise the gate.
    const redis = createRedis();
    await redis.del(`step_up:${adminSessionId}:t4`);
    const res = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; tier?: number } };
    expect(body.error.code).toBe('step_up_required');
    expect(body.error.tier).toBe(4);
  });

  it('POST /api/v1/admin/invitations creates an invitation and returns code + qr_url', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600, issuer_label: 'test-issuer' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      invitation_id: string;
      code: string;
      qr_url: string;
      expires_at: string;
      state: string;
    };
    expect(typeof body.invitation_id).toBe('string');
    expect(body.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/);
    expect(typeof body.expires_at).toBe('string');
    expect(body.state).toBe('active');
    createdInvitationIds.push(body.invitation_id);

    // qr_url is the join deep-link constructed from the (stripped) base URL.
    expect(body.qr_url).toMatch(
      /^https?:\/\/.+\/join#[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/,
    );
    expect(body.qr_url.endsWith(body.code)).toBe(true);
    expect(body.qr_url.includes('/auth/join')).toBe(false); // /auth suffix stripped

    // Verify the code hashes to the row stored in the DB.
    const { db } = createDb();
    const expectedHmac = await hashCode(body.code);
    const row = (
      await db
        .select({ id: pendingCodes.id, codeHmac: pendingCodes.codeHmac })
        .from(pendingCodes)
        .where(eq(pendingCodes.id, body.invitation_id))
        .limit(1)
    )[0];
    if (!row) throw new Error('inserted invitation row missing from DB');
    expect(row.id).toBe(body.invitation_id);
    expect(Buffer.from(row.codeHmac).equals(Buffer.from(expectedHmac))).toBe(true);
  });

  it('POST /api/v1/admin/invitations persists suggested_username and note', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({
        role: 'user',
        expires_in_seconds: 3600,
        suggested_username: 'chris.tidesson',
        note: 'kenne ich von X, leiwander typ',
      }),
    });
    expect(res.status).toBe(201);
    const createBody = (await res.json()) as { invitation_id: string };
    createdInvitationIds.push(createBody.invitation_id);

    // The list endpoint must surface the operator-private fields to admins.
    const listRes = await app.request('/api/v1/admin/invitations', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const list = (await listRes.json()) as {
      invitations: Array<{
        id: string;
        suggested_username: string | null;
        note: string | null;
      }>;
    };
    const found = list.invitations.find((i) => i.id === createBody.invitation_id);
    expect(found).toBeDefined();
    expect(found?.suggested_username).toBe('chris.tidesson');
    expect(found?.note).toBe('kenne ich von X, leiwander typ');
  });

  it('POST /api/v1/admin/invitations rejects unknown role', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'primary_admin', expires_in_seconds: 3600 }),
    });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/admin/invitations
  // ---------------------------------------------------------------------------

  it('GET /api/v1/admin/invitations returns 403 for regular user', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
      headers: { Authorization: `Bearer ${userToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/admin/invitations lists invitations without token field', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
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

  it('GET /api/v1/admin/invitations filters by status=pending', async () => {
    const res = await app.request('/api/v1/admin/invitations?status=pending', {
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
  // DELETE /api/v1/admin/invitations/:id
  // ---------------------------------------------------------------------------

  it('DELETE /api/v1/admin/invitations/:id revokes a pending invitation', async () => {
    // Create a fresh invitation to revoke.
    const createRes = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
    });
    const { invitation_id } = (await createRes.json()) as { invitation_id: string };
    createdInvitationIds.push(invitation_id);

    const res = await app.request(`/api/v1/admin/invitations/${invitation_id}`, {
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
        .select({ revokedAt: pendingCodes.revokedAt })
        .from(pendingCodes)
        .where(eq(pendingCodes.id, invitation_id))
        .limit(1)
    )[0];
    expect(row?.revokedAt).not.toBeNull();
  });

  it('DELETE /api/v1/admin/invitations/:id returns 409 when already revoked', async () => {
    const alreadyRevokedId = createdInvitationIds.at(-1);
    if (!alreadyRevokedId) throw new Error('Expected a revoked invitation id');

    const res = await app.request(`/api/v1/admin/invitations/${alreadyRevokedId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('conflict');
  });

  it('DELETE /api/v1/admin/invitations/:id returns 404 for unknown id', async () => {
    const res = await app.request(
      '/api/v1/admin/invitations/00000000-0000-0000-0000-000000000000',
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
      },
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /api/v1/admin/invitations/:id returns 409 when already redeemed', async () => {
    // Insert an invitation directly as redeemed.
    const { db } = createDb();
    // The code is hashed with the same key (HMAC_KEY_PENDING_CODES) as live
    // codes; the plaintext value does not need to match the 10-char format here
    // since we never redeem this row through the join flow — we only test the
    // DELETE handler's redeemed-state branch.
    const codeHmac = await hashCode('REDM1-TST44');
    const rows = await db
      .insert(pendingCodes)
      .values({
        type: 'invitation',
        codeHmac,
        role: 'user',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        redeemedAt: new Date(),
        redeemedByUserId: userId,
      })
      .returning({ id: pendingCodes.id });
    const row = rows[0];
    if (!row) throw new Error('Failed to insert test invitation');
    const redeemedId = row.id;
    createdInvitationIds.push(redeemedId);

    const res = await app.request(`/api/v1/admin/invitations/${redeemedId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('conflict');
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/admin/audit-log
  // ---------------------------------------------------------------------------

  it('GET /api/v1/admin/audit-log returns 403 for regular user', async () => {
    const res = await app.request('/api/v1/admin/audit-log', {
      headers: { Authorization: `Bearer ${userToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/admin/audit-log returns entries with expected shape', async () => {
    const res = await app.request('/api/v1/admin/audit-log', {
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

  it('GET /api/v1/admin/audit-log filters by event_type=invitation.created', async () => {
    const res = await app.request('/api/v1/admin/audit-log?event_type=invitation.created', {
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

  it('GET /api/v1/admin/audit-log filters by event_type=invitation.revoked', async () => {
    const res = await app.request('/api/v1/admin/audit-log?event_type=invitation.revoked', {
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

  it('GET /api/v1/admin/audit-log paginates correctly', async () => {
    // Fetch total with a large limit, then re-fetch with limit=1 and verify offset works.
    const allRes = await app.request('/api/v1/admin/audit-log', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const allBody = (await allRes.json()) as { total: number };
    if (allBody.total < 2) {
      // Not enough rows to test pagination meaningfully — skip the assertion.
      return;
    }
    const pageRes = await app.request('/api/v1/admin/audit-log?limit=1&offset=1', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const pageBody = (await pageRes.json()) as {
      entries: Array<{ id: string }>;
      total: number;
    };
    expect(pageBody.entries.length).toBe(1);
    expect(pageBody.total).toBe(allBody.total);
  });

  it('GET /api/v1/admin/audit-log filters by since= and until=', async () => {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const until = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min from now
    const res = await app.request(
      `/api/v1/admin/audit-log?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
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
