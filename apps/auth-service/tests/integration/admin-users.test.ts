// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the admin user management endpoints.
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { invitations, users } from '../../src/db/schema.js';
import { hashInvitationToken } from '../../src/invitations/token.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };

/** Registers a fresh user via the OPAQUE link flow and returns their user id. */
async function registerUser(
  app: ReturnType<typeof createServer>,
  opts: { password: string; username: string; role?: 'primary_admin' | 'admin' | 'user' },
): Promise<{ userId: string }> {
  const { db } = createDb();
  const rawToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const tokenHmac = await hashInvitationToken(rawToken);
  await db.insert(invitations).values({
    tokenHmac,
    role: opts.role ?? 'user',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
    password: opts.password,
  });

  const startRes = await app.request('/v1/link/opaque/start', {
    method: 'POST',
    headers: JSON_ORIGIN,
    body: JSON.stringify({ invitation_token: rawToken, registration_request: registrationRequest }),
  });
  const startBody = (await startRes.json()) as {
    session_id: string;
    registration_response: string;
  };

  const { registrationRecord } = opaqueClient.finishRegistration({
    password: opts.password,
    clientRegistrationState,
    registrationResponse: startBody.registration_response,
    identifiers: {
      client: opts.username,
      server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
    },
  });

  const zero32 = Buffer.alloc(32).toString('base64url');
  const finishRes = await app.request('/v1/link/opaque/finish', {
    method: 'POST',
    headers: JSON_ORIGIN,
    body: JSON.stringify({
      session_id: startBody.session_id,
      username: opts.username,
      registration_record: registrationRecord,
      wrapped_mk_opaque: zero32,
      wrap_nonce_opaque: zero32,
      wrap_aad_opaque: zero32,
      wrapped_mk_recovery: zero32,
      wrap_nonce_recovery: zero32,
      wrap_aad_recovery: zero32,
      recovery_verifier_key: zero32,
    }),
  });

  const finishBody = (await finishRes.json()) as { user_id: string };
  return { userId: finishBody.user_id };
}

/** Cleans up a user and their referenced invitation rows (FK constraint). */
async function cleanupUser(userId: string): Promise<void> {
  const { db } = createDb();
  await db
    .update(invitations)
    .set({ redeemedByUserId: null })
    .where(eq(invitations.redeemedByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

describe.skipIf(skip)('Admin user endpoints', () => {
  let app: ReturnType<typeof createServer>;

  // Three users: primary_admin, admin, regular user.
  let primaryId: string;
  let adminId: string;
  let userId: string;

  let primaryToken: string;
  let adminToken: string;
  let userToken: string;

  const ts = Date.now();
  const primaryUsername = `prim${ts}`.slice(0, 32).replace(/-/g, '');
  const adminUsername = `adm${ts}`.slice(0, 32).replace(/-/g, '');
  const userUsername = `usr${ts}`.slice(0, 32).replace(/-/g, '');

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();

    // Register all three users — all arrive as 'user' role initially.
    ({ userId: primaryId } = await registerUser(app, {
      password: 'primary-admin-password-1',
      username: primaryUsername,
    }));
    ({ userId: adminId } = await registerUser(app, {
      password: 'admin-password-1',
      username: adminUsername,
    }));
    ({ userId } = await registerUser(app, {
      password: 'user-password-1',
      username: userUsername,
    }));

    // Promote primary and admin directly in the DB. We bypass the constraint by
    // promoting primary_admin first (no existing primary_admin yet in this test run),
    // then the admin.
    await db.update(users).set({ role: 'primary_admin' }).where(eq(users.id, primaryId));
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, adminId));

    // Issue access tokens that reflect the elevated roles.
    ({ accessToken: primaryToken } = await issueTokens({
      userId: primaryId,
      role: 'primary_admin',
    }));
    ({ accessToken: adminToken } = await issueTokens({ userId: adminId, role: 'admin' }));
    ({ accessToken: userToken } = await issueTokens({ userId, role: 'user' }));
  });

  afterAll(async () => {
    // Tidy up all three users if they still exist.
    for (const id of [primaryId, adminId, userId]) {
      if (!id) continue;
      const { db } = createDb();
      const remaining = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
      if (remaining.length > 0) await cleanupUser(id);
    }
    await closeDb();
  });

  // ---------------------------------------------------------------------------
  // GET /v1/admin/users
  // ---------------------------------------------------------------------------

  it('GET /v1/admin/users returns a list of users (admin token)', async () => {
    const res = await app.request('/v1/admin/users', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ id: string }>; total: number };
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.some((u) => u.id === primaryId)).toBe(true);
  });

  it('GET /v1/admin/users returns 403 for regular user', async () => {
    const res = await app.request('/v1/admin/users', {
      headers: { Authorization: `Bearer ${userToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
  });

  it('GET /v1/admin/users filters by q=', async () => {
    const res = await app.request(`/v1/admin/users?q=${adminUsername}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ id: string }> };
    expect(body.users.some((u) => u.id === adminId)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // GET /v1/admin/users/:id
  // ---------------------------------------------------------------------------

  it('GET /v1/admin/users/:id returns user detail with auth_methods', async () => {
    const res = await app.request(`/v1/admin/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      username: string;
      role: string;
      auth_methods: Array<{ method_type: string }>;
    };
    expect(body.id).toBe(userId);
    expect(body.username).toBe(userUsername);
    expect(body.auth_methods.length).toBeGreaterThan(0);
    expect(body.auth_methods[0]?.method_type).toBe('opaque');
  });

  it('GET /v1/admin/users/:id returns 404 for unknown id', async () => {
    const res = await app.request('/v1/admin/users/00000000-0000-0000-0000-000000000000', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // POST /v1/admin/users/:id/suspend
  // ---------------------------------------------------------------------------

  it('POST /v1/admin/users/:id/suspend suspends a user', async () => {
    const res = await app.request(`/v1/admin/users/${userId}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify suspended_at is now set.
    const { db } = createDb();
    const row = (
      await db.select({ suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, userId))
    )[0];
    expect(row?.suspendedAt).not.toBeNull();
  });

  it('POST /v1/admin/users/:id/suspend returns 403 for self-target', async () => {
    const res = await app.request(`/v1/admin/users/${adminId}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  // ---------------------------------------------------------------------------
  // POST /v1/admin/users/:id/unsuspend
  // ---------------------------------------------------------------------------

  it('POST /v1/admin/users/:id/unsuspend re-enables a suspended user', async () => {
    const res = await app.request(`/v1/admin/users/${userId}/unsuspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);

    const { db } = createDb();
    const row = (
      await db.select({ suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, userId))
    )[0];
    expect(row?.suspendedAt).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // POST /v1/admin/users/:id/role  (primary_admin only)
  // ---------------------------------------------------------------------------

  it('POST /v1/admin/users/:id/role changes a user role', async () => {
    const res = await app.request(`/v1/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${primaryToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);

    const { db } = createDb();
    const row = (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)))[0];
    expect(row?.role).toBe('admin');

    // Restore to user for the DELETE test later.
    await db.update(users).set({ role: 'user' }).where(eq(users.id, userId));
  });

  it('POST /v1/admin/users/:id/role returns 403 for regular admin token', async () => {
    const res = await app.request(`/v1/admin/users/${userId}/role`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /v1/admin/users/:id/role returns 403 for self-target', async () => {
    const res = await app.request(`/v1/admin/users/${primaryId}/role`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${primaryToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  // ---------------------------------------------------------------------------
  // POST /v1/admin/transfer-primary
  // ---------------------------------------------------------------------------

  it('POST /v1/admin/transfer-primary is a no-op success when target is self', async () => {
    const res = await app.request('/v1/admin/transfer-primary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${primaryToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ target_user_id: primaryId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // primary_admin should still be the primary admin.
    const { db } = createDb();
    const row = (
      await db.select({ role: users.role }).from(users).where(eq(users.id, primaryId))
    )[0];
    expect(row?.role).toBe('primary_admin');
  });

  it('POST /v1/admin/transfer-primary returns 400 if target is not admin', async () => {
    const res = await app.request('/v1/admin/transfer-primary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${primaryToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ target_user_id: userId }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_input');
  });

  it('POST /v1/admin/transfer-primary atomically swaps primary_admin to target admin', async () => {
    const res = await app.request('/v1/admin/transfer-primary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${primaryToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ target_user_id: adminId }),
    });
    expect(res.status).toBe(200);

    const { db } = createDb();
    const newPrimary = (
      await db.select({ role: users.role }).from(users).where(eq(users.id, adminId))
    )[0];
    const oldPrimary = (
      await db.select({ role: users.role }).from(users).where(eq(users.id, primaryId))
    )[0];
    expect(newPrimary?.role).toBe('primary_admin');
    expect(oldPrimary?.role).toBe('admin');

    // Swap back so afterAll cleanup and DELETE test work correctly.
    // Direct DB update: demote the new primary first, then restore original.
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, adminId));
    await db.update(users).set({ role: 'primary_admin' }).where(eq(users.id, primaryId));
  });

  it('POST /v1/admin/transfer-primary returns 403 for non-primary-admin', async () => {
    const res = await app.request('/v1/admin/transfer-primary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ target_user_id: adminId }),
    });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // DELETE /v1/admin/users/:id
  // ---------------------------------------------------------------------------

  it('DELETE /v1/admin/users/:id rejects self-delete for primary_admin', async () => {
    const res = await app.request(`/v1/admin/users/${primaryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${primaryToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('DELETE /v1/admin/users/:id deletes a regular user', async () => {
    const res = await app.request(`/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);

    const { db } = createDb();
    const remaining = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    expect(remaining.length).toBe(0);
    // Mark as gone so afterAll skips it.
    userId = '';
  });

  it('DELETE /v1/admin/users/:id returns 404 for unknown id', async () => {
    const res = await app.request('/v1/admin/users/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(404);
  });
});
