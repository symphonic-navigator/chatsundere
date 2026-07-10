// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for POST /api/v1/join/{start,finish} with kind=pairing —
// the new-device join flow against an existing user. /finish completion +
// wrapped-MK return + tokens come in Task 11; this file covers /start.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'join-pairing-test-passphrase-correct-horse';

describe.skipIf(skip)('POST /api/v1/join/start (kind=pairing)', () => {
  const username = `joinp-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  let sessionId: string;
  const redis = createRedis();

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();
    // Drop cross-file rate-limit pollution before this file's /join calls.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);

    // Register the owner user via OPAQUE link (mirrors step-up.test.ts).
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
    const linkStart = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    const linkStartBody = (await linkStart.json()) as {
      session_id: string;
      registration_response: string;
    };
    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: linkStartBody.registration_response,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });
    const zero32 = Buffer.alloc(32).toString('base64url');
    await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        session_id: linkStartBody.session_id,
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

    const userRow = (
      await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
    )[0];
    if (!userRow) throw new Error('test setup: user row not found');
    userId = userRow.id;

    // Login the owner to obtain an access token + sessionId for /me/pairing-codes.
    const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password });
    const loginStart = await app.request('/api/v1/opaque/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, start_login_request: startLoginRequest }),
    });
    const loginStartBody = (await loginStart.json()) as {
      session_id: string;
      login_response: string;
    };
    const finishResult = opaqueClient.finishLogin({
      clientLoginState,
      loginResponse: loginStartBody.login_response,
      password,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });
    if (!finishResult) throw new Error('test setup: OPAQUE finishLogin returned undefined');
    const loginFinish = await app.request('/api/v1/opaque/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: loginStartBody.session_id,
        finish_login_request: finishResult.finishLoginRequest,
      }),
    });
    accessToken = ((await loginFinish.json()) as { access_token: string }).access_token;
    const [, payloadB64] = accessToken.split('.');
    if (!payloadB64) throw new Error('test setup: malformed access token');
    sessionId = (
      JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as { jti: string }
    ).jti;
  });

  beforeEach(async () => {
    const keys = await redis.keys(`step_up:${sessionId}:*`);
    if (keys.length) await redis.del(...keys);
    // Reset per-IP /join rate-limit budget between tests — each test does
    // 2–3 /join calls and four tests easily cross the 10/min cap otherwise.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);
    // Clear the test user's pairing codes so each test starts fresh.
    const { db } = createDb();
    await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, userId));
  });

  afterAll(async () => {
    if (userId) {
      const { db } = createDb();
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, userId));
      await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, userId));
      await db.delete(authMethods).where(eq(authMethods.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  async function mintPairingCode(): Promise<string> {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 120);
    const res = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Origin: 'http://localhost:3000',
      },
      body: '{}',
    });
    const body = (await res.json()) as { code: string };
    return body.code;
  }

  async function startPairingRound(
    code: string,
  ): Promise<{ sessionIdRound: string; clientLoginState: string; loginResponse: string }> {
    const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ kind: 'pairing', code, login_request: startLoginRequest }),
    });
    const body = (await res.json()) as { session_id: string; login_response: string };
    return {
      sessionIdRound: body.session_id,
      clientLoginState,
      loginResponse: body.login_response,
    };
  }

  it('completes the /finish round and returns wrapped MK material + tokens', async () => {
    const code = await mintPairingCode();
    const { sessionIdRound, clientLoginState, loginResponse } = await startPairingRound(code);

    const finishResult = opaqueClient.finishLogin({
      clientLoginState,
      loginResponse,
      password,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });
    if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

    const res = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        session_id: sessionIdRound,
        login_evidence: finishResult.finishLoginRequest,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user_id: string;
      username: string;
      role: string;
      access_token: string;
      expires_in: number;
      is_new_account: boolean;
      wrapped_mk_opaque: string;
      wrap_nonce_opaque: string;
      wrap_aad_opaque: string;
    };
    expect(body.user_id).toBe(userId);
    expect(body.username).toBe(username);
    expect(body.is_new_account).toBe(false);
    expect(body.access_token).toBeTruthy();
    expect(body.wrapped_mk_opaque).toBeTruthy();
    expect(body.wrap_nonce_opaque).toBeTruthy();
    expect(body.wrap_aad_opaque).toBeTruthy();
  });

  it('returns 401 opaque_authentication_failed for wrong passphrase', async () => {
    const code = await mintPairingCode();
    const { sessionIdRound, loginResponse } = await startPairingRound(code);

    const wrongClient = opaqueClient.startLogin({ password: 'definitely-not-the-right-one' });
    const wrongFinish = opaqueClient.finishLogin({
      clientLoginState: wrongClient.clientLoginState,
      loginResponse,
      password: 'definitely-not-the-right-one',
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });
    const evidence = wrongFinish?.finishLoginRequest ?? 'AAAAAAAA';

    const res = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        session_id: sessionIdRound,
        login_evidence: evidence,
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 410 session_expired on second /finish with the same session_id', async () => {
    const code = await mintPairingCode();
    const { sessionIdRound, clientLoginState, loginResponse } = await startPairingRound(code);

    const finishResult = opaqueClient.finishLogin({
      clientLoginState,
      loginResponse,
      password,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
    });
    if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

    const first = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        session_id: sessionIdRound,
        login_evidence: finishResult.finishLoginRequest,
      }),
    });
    expect(first.status).toBe(200);

    const second = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        session_id: sessionIdRound,
        login_evidence: finishResult.finishLoginRequest,
      }),
    });
    expect(second.status).toBe(410);
  });

  it('returns 200 with session_id, login_response, and username', async () => {
    const code = await mintPairingCode();
    const { startLoginRequest } = opaqueClient.startLogin({ password });

    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        code,
        login_request: startLoginRequest,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      login_response: string;
      username: string;
    };
    expect(body.session_id).toBeTruthy();
    expect(body.login_response).toBeTruthy();
    expect(body.username).toBe(username);
  });

  it('returns opaque_client_identifier — the frozen identifier the joining device must present at /finish', async () => {
    const code = await mintPairingCode();
    const { startLoginRequest } = opaqueClient.startLogin({ password });

    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        code,
        login_request: startLoginRequest,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opaque_client_identifier: string };
    // This account has never been renamed in this test suite, so the frozen
    // identifier still equals the live username — the divergence case (a
    // renamed account) is covered client-side in join-by-pairing.test.ts,
    // since reproducing a rename here would need the (unbuilt) rename route.
    expect(body.opaque_client_identifier).toBe(username);

    // Cross-check against the DB column directly — the value the server sends
    // must be exactly what auth_methods.opaque_client_identifier holds, the
    // frozen registration-time identity, not derived from users.username.
    const { db } = createDb();
    const authRow = (
      await db
        .select({ opaqueClientIdentifier: authMethods.opaqueClientIdentifier })
        .from(authMethods)
        .where(eq(authMethods.userId, userId))
        .limit(1)
    )[0];
    if (!authRow?.opaqueClientIdentifier) {
      throw new Error('test setup: auth_methods row missing opaque_client_identifier');
    }
    expect(authRow.opaqueClientIdentifier).toBe(username);
    expect(body.opaque_client_identifier).toBe(authRow.opaqueClientIdentifier);
  });

  it('returns 400 kind_mismatch when kind=pairing sent for an invitation row', async () => {
    // Insert an invitation row directly so we can test the discriminator
    // without needing admin-token plumbing here.
    const { db } = createDb();
    const { generateCode, hashCode } = await import('../../src/codes/token.js');
    const invitationCode = generateCode();
    const codeHmac = await hashCode(invitationCode);
    const rows = await db
      .insert(pendingCodes)
      .values({
        type: 'invitation',
        codeHmac,
        role: 'user',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: pendingCodes.id });

    try {
      const { startLoginRequest } = opaqueClient.startLogin({ password });
      const res = await app.request('/api/v1/join/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          kind: 'pairing',
          code: invitationCode,
          login_request: startLoginRequest,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('kind_mismatch');
    } finally {
      const inserted = rows[0];
      if (inserted) await db.delete(pendingCodes).where(eq(pendingCodes.id, inserted.id));
    }
  });
});
