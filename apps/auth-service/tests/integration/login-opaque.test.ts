// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for the OPAQUE login round-trip:
//   /v1/link/opaque/start + finish  →  /api/v1/opaque/login/start + finish
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { hashInvitationToken } from '../../src/invitations/token.js';
import { verifyAccessToken } from '../../src/jwt/verify.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('OPAQUE login round-trip', () => {
  const password = 'correct-horse-battery-staple-login-test';
  const username = `login-test-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();

    // --- Register a fresh user via OPAQUE link flow ---

    const { db } = createDb();
    const rawToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const codeHmac = await hashInvitationToken(rawToken);
    await db.insert(pendingCodes).values({
      type: 'invitation',
      codeHmac,
      role: 'user',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password,
    });

    const startRes = await app.request('/v1/link/opaque/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        invitation_token: rawToken,
        registration_request: registrationRequest,
      }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      session_id: string;
      registration_response: string;
    };

    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

    const zero32 = Buffer.alloc(32).toString('base64url');
    const finishRes = await app.request('/v1/link/opaque/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: startBody.session_id,
        username,
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
    expect(finishRes.status).toBe(200);
    const finishBody = (await finishRes.json()) as { user_id: string };
    userId = finishBody.user_id;
  });

  afterAll(async () => {
    if (userId) {
      const { db } = createDb();
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  it('completes the OPAQUE login flow and returns valid JWT tokens', async () => {
    // --- Client: start login ---
    const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password });

    // --- POST /api/v1/opaque/login/start ---
    const loginStartRes = await app.request('/api/v1/opaque/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, start_login_request: startLoginRequest }),
    });
    expect(loginStartRes.status).toBe(200);
    const loginStartBody = (await loginStartRes.json()) as {
      session_id: string;
      login_response: string;
      wrapped_mk_opaque: string;
      wrap_nonce_opaque: string;
      wrap_aad_opaque: string;
    };
    expect(typeof loginStartBody.session_id).toBe('string');
    expect(typeof loginStartBody.login_response).toBe('string');
    // wrapped_mk_opaque blobs should be returned for an existing user
    expect(typeof loginStartBody.wrapped_mk_opaque).toBe('string');

    // --- Client: finish login ---
    const finishResult = opaqueClient.finishLogin({
      clientLoginState,
      loginResponse: loginStartBody.login_response,
      password,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });
    if (!finishResult) throw new Error('Client finishLogin returned undefined');
    const { finishLoginRequest } = finishResult;

    // --- POST /api/v1/opaque/login/finish ---
    const loginFinishRes = await app.request('/api/v1/opaque/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: loginStartBody.session_id,
        finish_login_request: finishLoginRequest,
      }),
    });
    expect(loginFinishRes.status).toBe(200);
    const loginFinishBody = (await loginFinishRes.json()) as {
      user_id: string;
      role: string;
      access_token: string;
      expires_in: number;
    };

    expect(loginFinishBody.user_id).toBe(userId);
    expect(loginFinishBody.role).toBe('user');
    expect(typeof loginFinishBody.access_token).toBe('string');
    expect(typeof loginFinishBody.expires_in).toBe('number');

    // Verify the access token is a valid JWT signed by the server.
    const claims = await verifyAccessToken(loginFinishBody.access_token);
    expect(claims.sub).toBe(userId);
    expect(claims.role).toBe('user');
  });

  it('returns 410 when session_id is replayed at /finish', async () => {
    const res = await app.request('/api/v1/opaque/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: 'no-such-session',
        finish_login_request: Buffer.alloc(32).toString('base64url'),
      }),
    });
    expect(res.status).toBe(410);
  });

  it('returns 200 with no wrapped key blobs for an unknown username (enumeration mitigation)', async () => {
    const { startLoginRequest } = opaqueClient.startLogin({ password });

    const res = await app.request('/api/v1/opaque/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        username: 'nonexistent-user-xyz-abc',
        start_login_request: startLoginRequest,
      }),
    });
    // Must return 200 even for unknown users to prevent enumeration.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      login_response: string;
      wrapped_mk_opaque: string | null;
    };
    expect(typeof body.session_id).toBe('string');
    expect(typeof body.login_response).toBe('string');
    // No wrapping blobs for a non-existent user.
    expect(body.wrapped_mk_opaque).toBeNull();
  });

  it('returns 401 when wrong password is used at /finish', async () => {
    const wrongPassword = 'this-is-the-wrong-password-entirely';
    const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({
      password: wrongPassword,
    });

    const startRes = await app.request('/api/v1/opaque/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, start_login_request: startLoginRequest }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      session_id: string;
      login_response: string;
    };

    // finishLogin may return undefined when the password does not match.
    const finishResult = opaqueClient.finishLogin({
      clientLoginState,
      loginResponse: startBody.login_response,
      password: wrongPassword,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

    // If the client returns undefined the finish_login_request is bogus — the server rejects it.
    const finishLoginRequest =
      finishResult?.finishLoginRequest ?? Buffer.alloc(32).toString('base64url');

    const finishRes = await app.request('/api/v1/opaque/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: startBody.session_id,
        finish_login_request: finishLoginRequest,
      }),
    });
    expect(finishRes.status).toBe(401);
    const body = (await finishRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_credentials');
  });
});
