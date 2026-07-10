// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for the OPAQUE login round-trip:
//   /api/v1/join/start + finish  →  /api/v1/opaque/login/start + finish
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { verifyAccessToken } from '../../src/jwt/verify.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('OPAQUE login round-trip', () => {
  const password = 'correct-horse-battery-staple-login-test';
  const username = `login-test-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;

  beforeAll(async () => {
    const _rlRedis = createRedis();
    const _rlKeys = await _rlRedis.keys('rl:join_*');
    if (_rlKeys.length) await _rlRedis.del(..._rlKeys);
    await opaqueReady;
    app = createServer();

    // --- Register a fresh user via OPAQUE link flow ---

    const { db } = createDb();
    const invitationCode = generateCode();
    const codeHmac = await hashCode(invitationCode);
    await db.insert(pendingCodes).values({
      type: 'invitation',
      codeHmac,
      role: 'user',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password,
    });

    const startRes = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
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
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });

    const zero32 = Buffer.alloc(32).toString('base64url');
    const finishRes = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
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
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
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

  it('returns 200 with a decoy wrap for an unknown username (enumeration mitigation, Finding #10a)', async () => {
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
    // The wrap fields must be a non-null decoy — a null vs present split would
    // itself be an existence oracle (Finding #10a).
    expect(typeof body.wrapped_mk_opaque).toBe('string');
    expect(Buffer.from(body.wrapped_mk_opaque as string, 'base64url').length).toBe(48);
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
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
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
