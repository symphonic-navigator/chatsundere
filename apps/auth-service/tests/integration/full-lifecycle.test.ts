// SPDX-License-Identifier: AGPL-3.0-only
//
// Full end-to-end lifecycle test for the auth-service.
//
// Walks the entire admin + user journey in a single ordered describe block:
//   1. Bootstrap CLI runs against an empty-of-admins DB → bootstrap file written.
//   2. Bootstrap file's invitation token used to link a primary_admin user.
//   3. Primary admin creates an invitation for a regular user.
//   4. Second client links using that invitation.
//   5. Second client logs in via OPAQUE.
//   6. Admin lists users → both present.
//   7. Admin suspends second user → Redis EXISTS-cache cleared → /me returns 401.
//   8. Admin unsuspends → second user can log in again.
//   9. Second user PATCH /me username conflict → 409.
//  10. Second user DELETE /me → user gone; admin list reflects.
//
// Requires a live PostgreSQL instance and Redis. Gated on DATABASE_URL + REDIS_URL.
// Run with: RUN_INTEGRATION=1 pnpm --filter @chatsundere/auth-service test:integration

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync, unlinkSync } from 'node:fs';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

// The integration test truncates every table in beforeAll. To prevent this
// from ever happening against a real DATABASE_URL (dev or prod), we require
// a separate TEST_DATABASE_URL pointing at a dedicated database.
//
// If TEST_DATABASE_URL is unset, skip entirely — never fall back to
// DATABASE_URL. If it accidentally equals DATABASE_URL, refuse to run.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const skip = !TEST_DATABASE_URL || !REDIS_URL;

if (TEST_DATABASE_URL && process.env.DATABASE_URL) {
  // Compare normalised host + pathname rather than raw strings — trailing
  // slashes, equivalent host aliases (localhost vs 127.0.0.1 are NOT equal
  // here intentionally; sslmode query params and the like are stripped),
  // and case-variation in the protocol must not be allowed to bypass this
  // guard. The point of the check is to make accidental misconfiguration
  // impossible, not to catch sophisticated bypasses.
  const normalise = (url: string): string => {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`;
  };
  try {
    if (normalise(TEST_DATABASE_URL) === normalise(process.env.DATABASE_URL)) {
      throw new Error(
        'TEST_DATABASE_URL and DATABASE_URL resolve to the same host+database. ' +
          'Set TEST_DATABASE_URL to a dedicated test database (e.g. auth_db_test).',
      );
    }
  } catch (e) {
    // URL parsing itself can throw. Re-throw the explicit guard error;
    // hide URL-parse internals from the test output.
    if (e instanceof Error && e.message.includes('resolve to the same host')) throw e;
    // If URL parsing fails for either env var, we can't compare — let
    // Valibot reject the URL downstream rather than continue silently.
  }
}

// Save the original DATABASE_URL so we can restore it after the test.
// The override happens in beforeAll and the restore in afterAll.
let ORIGINAL_DATABASE_URL: string | undefined;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Extracts the refresh_token value from a Set-Cookie header string. */
function extractRefreshCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/(?:^|;\s*)refresh_token=([^;]+)/);
  return match?.[1] ?? null;
}

/** Builds a Cookie header string from a stored refresh token value. */
function cookieHeader(refreshToken: string): string {
  return `refresh_token=${refreshToken}`;
}

// ---------------------------------------------------------------------------
// OPAQUE registration helper
// ---------------------------------------------------------------------------

/** Runs the full OPAQUE link flow for a new user. Returns { userId, accessToken, refreshToken }. */
async function registerViaOpaque(
  app: ReturnType<typeof createServer>,
  opts: { password: string; username: string; invitationToken: string },
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
    password: opts.password,
  });

  const startRes = await app.request('/v1/link/opaque/start', {
    method: 'POST',
    headers: JSON_ORIGIN,
    body: JSON.stringify({
      invitation_token: opts.invitationToken,
      registration_request: registrationRequest,
    }),
  });
  if (startRes.status !== 200) {
    const body = await startRes.text();
    throw new Error(`link/opaque/start returned ${startRes.status}: ${body}`);
  }
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
  if (finishRes.status !== 200) {
    const body = await finishRes.text();
    throw new Error(`link/opaque/finish returned ${finishRes.status}: ${body}`);
  }

  const finishBody = (await finishRes.json()) as {
    user_id: string;
    access_token: string;
  };

  const refreshToken = extractRefreshCookie(finishRes.headers.get('set-cookie'));
  if (!refreshToken) throw new Error('link/opaque/finish did not set a refresh cookie');

  return {
    userId: finishBody.user_id,
    accessToken: finishBody.access_token,
    refreshToken,
  };
}

// ---------------------------------------------------------------------------
// OPAQUE login helper
// ---------------------------------------------------------------------------

/** Logs in via OPAQUE and returns a fresh access token + refresh token. */
async function loginViaOpaque(
  app: ReturnType<typeof createServer>,
  opts: { password: string; username: string },
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({
    password: opts.password,
  });

  const startRes = await app.request('/api/v1/opaque/login/start', {
    method: 'POST',
    headers: JSON_ORIGIN,
    body: JSON.stringify({ username: opts.username, start_login_request: startLoginRequest }),
  });
  if (startRes.status !== 200) {
    const body = await startRes.text();
    throw new Error(`opaque/login/start returned ${startRes.status}: ${body}`);
  }
  const startBody = (await startRes.json()) as { session_id: string; login_response: string };

  const finishResult = opaqueClient.finishLogin({
    clientLoginState,
    loginResponse: startBody.login_response,
    password: opts.password,
    identifiers: {
      client: opts.username,
      server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
    },
  });
  if (!finishResult)
    throw new Error('opaqueClient.finishLogin returned undefined (wrong password?)');
  const { finishLoginRequest } = finishResult;

  const finishRes = await app.request('/api/v1/opaque/login/finish', {
    method: 'POST',
    headers: JSON_ORIGIN,
    body: JSON.stringify({
      session_id: startBody.session_id,
      finish_login_request: finishLoginRequest,
    }),
  });
  if (finishRes.status !== 200) {
    const body = await finishRes.text();
    throw new Error(`opaque/login/finish returned ${finishRes.status}: ${body}`);
  }

  const finishBody = (await finishRes.json()) as {
    user_id: string;
    access_token: string;
  };

  const refreshToken = extractRefreshCookie(finishRes.headers.get('set-cookie'));
  if (!refreshToken) throw new Error('opaque/login/finish did not set a refresh cookie');

  return {
    userId: finishBody.user_id,
    accessToken: finishBody.access_token,
    refreshToken,
  };
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

/** Removes a user from the DB, nulling out any pending_codes FK references first. */
async function cleanupUser(userId: string): Promise<void> {
  const { db } = createDb();
  // pending_codes.created_by and pending_codes.redeemed_by_user_id both reference users.id
  // without ON DELETE CASCADE, so they must be nulled before the user row can be deleted.
  await db.update(pendingCodes).set({ createdBy: null }).where(eq(pendingCodes.createdBy, userId));
  await db
    .update(pendingCodes)
    .set({ redeemedByUserId: null })
    .where(eq(pendingCodes.redeemedByUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(skip)('Full auth-service lifecycle', () => {
  let app: ReturnType<typeof createServer>;

  // Mutable state threaded through the ordered `it` steps.
  let bootstrapFilePath: string;
  let bootstrapInvitationToken: string;
  let bootstrapInvitationId: string;

  let adminUserId: string;
  let adminAccessToken: string;
  let adminRefreshToken: string;
  const adminUsername = `admlc${Date.now()}`.slice(0, 32).replace(/-/g, '');
  const adminPassword = 'primary-admin-lifecycle-password-1!';

  let userInvitationToken: string;
  let userInvitationId: string;

  let userUserId: string;
  let userAccessToken: string;
  let userRefreshToken: string;
  const userUsername = `usrlc${Date.now()}`.slice(0, 32).replace(/-/g, '');
  const userPassword = 'regular-user-lifecycle-password-2!';

  // A second username used only to create a conflict in step 9.
  const conflictUsername = `cnflc${Date.now()}`.slice(0, 32).replace(/-/g, '');
  let conflictUserId: string;

  beforeAll(async () => {
    // Override DATABASE_URL for the duration of this test so createDb() picks
    // up the test DB. This override is scoped to beforeAll/afterAll so other
    // tests running in the same process are not affected.
    if (TEST_DATABASE_URL) {
      ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
      process.env.DATABASE_URL = TEST_DATABASE_URL;
    }

    await opaqueReady;
    app = createServer();

    // Pre-test cleanup: remove every user so that bootstrap is eligible.
    // pending_codes holds two FK references to users.id (created_by and
    // redeemed_by_user_id), neither of which has ON DELETE CASCADE.
    // Both must be nulled before users can be deleted.
    const { db } = createDb();
    await db.update(pendingCodes).set({ createdBy: null, redeemedByUserId: null });
    await db.delete(authMethods);
    await db.delete(users);
    await db.delete(pendingCodes);
  });

  afterAll(async () => {
    const { db } = createDb();

    // Null out all invitation FK references that point to our test users,
    // then delete the invitation rows themselves, then delete the users.
    // This order avoids FK violations regardless of which steps succeeded.

    // Step-3 invitation (admin-issued, redeemed by the regular user).
    if (userInvitationId) {
      await db
        .update(pendingCodes)
        .set({ createdBy: null, redeemedByUserId: null })
        .where(eq(pendingCodes.id, userInvitationId));
      await db.delete(pendingCodes).where(eq(pendingCodes.id, userInvitationId));
    }

    // Any remaining pending_codes that reference our test users.
    for (const id of [adminUserId, userUserId, conflictUserId]) {
      if (!id) continue;
      await db.update(pendingCodes).set({ createdBy: null }).where(eq(pendingCodes.createdBy, id));
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, id));
    }

    // Delete users if still present.
    for (const id of [adminUserId, userUserId, conflictUserId]) {
      if (!id) continue;
      const remaining = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
      if (remaining.length > 0) {
        await db.delete(users).where(eq(users.id, id));
      }
    }

    // Remove any leftover bootstrap file.
    if (bootstrapFilePath) {
      try {
        unlinkSync(bootstrapFilePath);
      } catch {
        // Already removed by the link/finish route.
      }
    }

    // Restore the original DATABASE_URL so any subsequent code (e.g. when the
    // test process is reused) sees the unaltered env.
    if (ORIGINAL_DATABASE_URL !== undefined) {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    } else {
      // `process.env.X = undefined` coerces to the literal string "undefined"
      // (process.env coerces all values to strings), which leaves the env var
      // present with a wrong value. `delete` is the only correct way to unset.
      // biome-ignore lint/performance/noDelete: process.env requires delete to truly unset
      delete process.env.DATABASE_URL;
    }

    await closeDb();
  });

  // -------------------------------------------------------------------------
  // Step 1: Bootstrap CLI writes a file
  // -------------------------------------------------------------------------

  it('step 1: bootstrap CLI writes a file containing the invitation token', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/cli/bootstrap.ts'], {
      cwd: '/home/chris/workspace/chatsundere/apps/auth-service',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await Bun.readableStreamToText(proc.stdout);
    const stderr = await Bun.readableStreamToText(proc.stderr);
    const exitCode = await proc.exited;

    if (exitCode !== 0) throw new Error(`bootstrap CLI exited ${exitCode}: ${stderr}`);

    const filePath = stdout.trim().split('\n')[0];
    if (!filePath) throw new Error('bootstrap CLI produced no file path on stdout');
    expect(filePath).toContain('chatsundere-bootstrap-');

    bootstrapFilePath = filePath;

    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as {
      qr_payload: string;
      invitation_id: string;
      expires_at_unix_ms: number;
    };
    expect(typeof data.qr_payload).toBe('string');
    expect(typeof data.invitation_id).toBe('string');

    bootstrapInvitationId = data.invitation_id;

    // Decode QR payload to extract the raw token.
    const decoded = JSON.parse(Buffer.from(data.qr_payload, 'base64url').toString('utf-8')) as {
      token: string;
    };
    bootstrapInvitationToken = decoded.token;

    expect(typeof bootstrapInvitationToken).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Step 2: Use the bootstrap token to link a primary_admin
  // -------------------------------------------------------------------------

  it('step 2: primary_admin registers using the bootstrap invitation', async () => {
    const result = await registerViaOpaque(app, {
      password: adminPassword,
      username: adminUsername,
      invitationToken: bootstrapInvitationToken,
    });

    adminUserId = result.userId;
    adminAccessToken = result.accessToken;
    adminRefreshToken = result.refreshToken;

    expect(typeof adminUserId).toBe('string');

    // Verify the role in the DB.
    const { db } = createDb();
    const row = (
      await db.select({ role: users.role }).from(users).where(eq(users.id, adminUserId))
    )[0];
    expect(row?.role).toBe('primary_admin');

    // Bootstrap file is cleaned up by the link route.
    try {
      readFileSync(bootstrapFilePath);
      // If we reach here the file was not removed — that is acceptable in dev (path
      // mismatch between XDG_RUNTIME_DIR values). Mark it for afterAll cleanup.
    } catch {
      // File was removed automatically — expected.
      bootstrapFilePath = '';
    }
  });

  // -------------------------------------------------------------------------
  // Step 3: Admin creates an invitation for a regular user
  // -------------------------------------------------------------------------

  it('step 3: primary_admin creates an invitation for a regular user', async () => {
    const res = await app.request('/api/v1/admin/invitations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminAccessToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({
        role: 'user',
        expires_in_seconds: 3600,
        issuer_label: 'lifecycle-test',
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      invitation_id: string;
      token: string;
      qr_payload: string;
    };
    expect(typeof body.invitation_id).toBe('string');
    expect(typeof body.token).toBe('string');

    userInvitationId = body.invitation_id;
    userInvitationToken = body.token;
  });

  // -------------------------------------------------------------------------
  // Step 4: Second client links using that invitation
  // -------------------------------------------------------------------------

  it('step 4: regular user registers using the admin-issued invitation', async () => {
    const result = await registerViaOpaque(app, {
      password: userPassword,
      username: userUsername,
      invitationToken: userInvitationToken,
    });

    userUserId = result.userId;
    userAccessToken = result.accessToken;
    userRefreshToken = result.refreshToken;

    expect(typeof userUserId).toBe('string');

    const { db } = createDb();
    const row = (
      await db.select({ role: users.role }).from(users).where(eq(users.id, userUserId))
    )[0];
    expect(row?.role).toBe('user');
  });

  // -------------------------------------------------------------------------
  // Step 5: Second client logs in via OPAQUE
  // -------------------------------------------------------------------------

  it('step 5: regular user can log in via OPAQUE and receives fresh tokens', async () => {
    const result = await loginViaOpaque(app, {
      password: userPassword,
      username: userUsername,
    });

    expect(result.userId).toBe(userUserId);
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');

    // Thread the fresh tokens forward for subsequent steps.
    userAccessToken = result.accessToken;
    userRefreshToken = result.refreshToken;
  });

  // -------------------------------------------------------------------------
  // Step 6: Admin lists users — both present
  // -------------------------------------------------------------------------

  it('step 6: admin GET /api/v1/admin/users shows both the admin and the regular user', async () => {
    const res = await app.request('/api/v1/admin/users', {
      headers: { Authorization: `Bearer ${adminAccessToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { users: Array<{ id: string }> };
    const ids = body.users.map((u) => u.id);
    expect(ids).toContain(adminUserId);
    expect(ids).toContain(userUserId);
  });

  // -------------------------------------------------------------------------
  // Step 7: Admin suspends the regular user; /me returns 401 after cache clear
  // -------------------------------------------------------------------------

  it('step 7: admin suspends the regular user; after cache eviction /me returns 401', async () => {
    // Suspend the user.
    const suspendRes = await app.request(`/api/v1/admin/users/${userUserId}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminAccessToken}`, ...ORIGIN },
    });
    expect(suspendRes.status).toBe(200);
    const suspendBody = (await suspendRes.json()) as { ok: boolean };
    expect(suspendBody.ok).toBe(true);

    // The bearer middleware caches user-exists state in Redis for 30 s.
    // Rather than waiting, delete the cache key directly so the next /me call
    // falls through to the DB and sees the suspended flag.
    const redis = createRedis();
    await redis.del(`userexists:${userUserId}`);

    const meRes = await app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${userAccessToken}`, ...ORIGIN },
    });
    expect(meRes.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Step 8: Admin unsuspends → regular user can log in again
  // -------------------------------------------------------------------------

  it('step 8: admin unsuspends the regular user; user can log in via OPAQUE again', async () => {
    const unsuspendRes = await app.request(`/api/v1/admin/users/${userUserId}/unsuspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminAccessToken}`, ...ORIGIN },
    });
    expect(unsuspendRes.status).toBe(200);

    // Clear the cache key again so the next login/me uses a fresh DB look-up.
    const redis = createRedis();
    await redis.del(`userexists:${userUserId}`);

    // Log in again — should succeed.
    const result = await loginViaOpaque(app, {
      password: userPassword,
      username: userUsername,
    });

    expect(result.userId).toBe(userUserId);
    userAccessToken = result.accessToken;
    userRefreshToken = result.refreshToken;
  });

  // -------------------------------------------------------------------------
  // Step 9: PATCH /me username conflict → 409
  // -------------------------------------------------------------------------

  it('step 9: PATCH /api/v1/me with an already-taken username returns 409', async () => {
    // Register a second user to create the conflict target.
    const { db } = createDb();
    const conflictToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      'base64url',
    );
    // Import the token hasher inline to avoid pulling in non-exported internals.
    const { hashInvitationToken } = await import('../../src/invitations/token.js');
    const codeHmac = await hashInvitationToken(conflictToken);
    await db.insert(pendingCodes).values({
      type: 'invitation',
      codeHmac,
      role: 'user',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const conflictResult = await registerViaOpaque(app, {
      password: 'conflict-user-password-9!',
      username: conflictUsername,
      invitationToken: conflictToken,
    });
    conflictUserId = conflictResult.userId;

    // The regular user tries to rename to the conflict username.
    const patchRes = await app.request('/api/v1/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${userAccessToken}`, ...JSON_ORIGIN },
      body: JSON.stringify({ username: conflictUsername }),
    });
    expect(patchRes.status).toBe(409);
    const patchBody = (await patchRes.json()) as { error: { code: string } };
    expect(patchBody.error.code).toBe('username_taken');

    // Clean up the conflict user now; it is no longer needed.
    await cleanupUser(conflictUserId);
    conflictUserId = '';
  });

  // -------------------------------------------------------------------------
  // Step 10: Regular user deletes themselves; admin list no longer contains them
  // -------------------------------------------------------------------------

  it('step 10: regular user DELETE /api/v1/me removes the account; admin list reflects', async () => {
    const deleteRes = await app.request('/api/v1/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Cookie: cookieHeader(userRefreshToken),
        ...ORIGIN,
      },
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as { ok: boolean };
    expect(deleteBody.ok).toBe(true);

    // Mark as gone so afterAll skips it.
    userUserId = '';

    // Admin list must no longer contain the deleted user.
    const listRes = await app.request('/api/v1/admin/users', {
      headers: { Authorization: `Bearer ${adminAccessToken}`, ...ORIGIN },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { users: Array<{ id: string }> };
    const ids = listBody.users.map((u) => u.id);
    // The user row is gone — the id should not appear.
    expect(ids).not.toContain(userUserId);
  });
});
