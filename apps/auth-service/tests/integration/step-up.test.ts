// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for the step-up endpoint pair:
//   POST /api/v1/auth/step-up/{start,finish}
//
// Mechanism=opaque is exercised end-to-end against a real OPAQUE round.
// Mechanism=webauthn /start is exercised via a fake-passkey-row shortcut to
// cover the handler branching without needing a virtual authenticator;
// mechanism=webauthn /finish is left to manual verification per Chris's
// 2026-05-22 testing decision (virtual authenticator out of scope).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { and, desc, eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { auditLog, authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'step-up-test-passphrase-correct-horse';

describe.skipIf(skip)('Step-up endpoint pair', () => {
  const username = `stepup-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  let sessionId: string;
  const redis = createRedis();

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();
    // Drop cross-file rate-limit pollution before this file's /join call.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);

    // 1. Mint an invitation and redeem it via the OPAQUE link flow.
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
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
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
    if (!userRow) throw new Error('test setup: user row not found after link');
    userId = userRow.id;

    // 2. Login via OPAQUE to obtain a fresh access token + sessionId.
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
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });
    if (!finishResult) throw new Error('test setup: OPAQUE finishLogin returned undefined');
    const { finishLoginRequest } = finishResult;
    const loginFinish = await app.request('/api/v1/opaque/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: loginStartBody.session_id,
        finish_login_request: finishLoginRequest,
      }),
    });
    const loginFinishBody = (await loginFinish.json()) as { access_token: string };
    accessToken = loginFinishBody.access_token;

    // The jti claim doubles as the server-side sessionId for step-up state.
    const [, payloadB64] = accessToken.split('.');
    if (!payloadB64) throw new Error('test setup: malformed access token');
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { jti: string };
    sessionId = payload.jti;
  });

  beforeEach(async () => {
    const keys = await redis.keys(`step_up:${sessionId}:*`);
    if (keys.length) await redis.del(...keys);
    const roundKeys = await redis.keys('step_up_round:*');
    if (roundKeys.length) await redis.del(...roundKeys);
    // Rate-limit sliding-window keys must be reset between tests so the
    // per-session and per-IP counters do not bleed into one another.
    const rlKeys = await redis.keys('rl:step_up_*');
    if (rlKeys.length) await redis.del(...rlKeys);
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
    // Note: the Redis client is a process-wide singleton (createRedis caches)
    // and other test files share it. Do not quit it here — process exit
    // tears it down. The step_up:* keys we wrote have short TTLs and the
    // user-scoped sessionId is unique per run.
    await closeDb();
  });

  describe('POST /api/v1/auth/step-up/start', () => {
    it('returns 200 with login_response for mechanism=opaque', async () => {
      const { startLoginRequest } = opaqueClient.startLogin({ password });
      const res = await app.request('/api/v1/auth/step-up/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          mechanism: 'opaque',
          tier_requested: 't1',
          login_request: startLoginRequest,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        session_id: string;
        mechanism: 'opaque';
        login_response: string;
      };
      expect(body.session_id).toBeTruthy();
      expect(body.mechanism).toBe('opaque');
      expect(body.login_response).toBeTruthy();
    });

    it('returns 401 without bearer', async () => {
      const res = await app.request('/api/v1/auth/step-up/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ mechanism: 'opaque', tier_requested: 't1', login_request: 'x' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 for tier_requested=t0 or t2 (reserved / not applicable)', async () => {
      for (const tier of ['t0', 't2']) {
        const res = await app.request('/api/v1/auth/step-up/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({ mechanism: 'opaque', tier_requested: tier, login_request: 'x' }),
        });
        expect(res.status).toBe(400);
      }
    });

    it('returns 200 with assertion options for mechanism=webauthn when user has a passkey', async () => {
      // Insert a synthetic passkey row so the /start handler has credentials to
      // include in allowCredentials. /finish would refuse this credential at
      // verification time — by design — but /start does not verify, it only
      // shapes the assertion options.
      const { db } = createDb();
      const fakeCredentialId = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
      const zero32 = new Uint8Array(32);
      await db.insert(authMethods).values({
        userId,
        methodType: 'passkey',
        passkeyCredentialId: fakeCredentialId,
        passkeyPublicKey: zero32,
        passkeySignCount: 0,
        wrappedMasterKey: zero32,
        wrapNonce: zero32,
        wrapAad: zero32,
      });

      try {
        const res = await app.request('/api/v1/auth/step-up/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({ mechanism: 'webauthn', tier_requested: 't1' }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          session_id: string;
          mechanism: 'webauthn';
          options: { challenge: string; userVerification: string };
        };
        expect(body.mechanism).toBe('webauthn');
        expect(body.session_id).toBeTruthy();
        expect(body.options.challenge).toBeTruthy();
        // Step-up Mechanism A per ADR 0027: UV must be 'required'.
        expect(body.options.userVerification).toBe('required');
      } finally {
        await db.delete(authMethods).where(eq(authMethods.passkeyCredentialId, fakeCredentialId));
      }
    });

    it('returns 400 no_passkey for mechanism=webauthn when user has no passkey', async () => {
      const res = await app.request('/api/v1/auth/step-up/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ mechanism: 'webauthn', tier_requested: 't1' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('no_passkey');
    });
  });

  describe('POST /api/v1/auth/step-up/finish', () => {
    async function startOpaqueRound(tier: 't1' | 't3' | 't4'): Promise<{
      sessionIdRound: string;
      clientLoginState: string;
      loginResponse: string;
    }> {
      const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password });
      const startRes = await app.request('/api/v1/auth/step-up/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          mechanism: 'opaque',
          tier_requested: tier,
          login_request: startLoginRequest,
        }),
      });
      const body = (await startRes.json()) as { session_id: string; login_response: string };
      return {
        sessionIdRound: body.session_id,
        clientLoginState,
        loginResponse: body.login_response,
      };
    }

    it('completes opaque step-up and sets step_up:<session>:t1 with 120s TTL', async () => {
      const { sessionIdRound, clientLoginState, loginResponse } = await startOpaqueRound('t1');

      const finishResult = opaqueClient.finishLogin({
        clientLoginState,
        loginResponse,
        password,
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

      const finishRes = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: finishResult.finishLoginRequest,
        }),
      });
      expect(finishRes.status).toBe(200);
      const body = (await finishRes.json()) as { tier_confirmed: string; expires_at: string };
      expect(body.tier_confirmed).toBe('t1');
      expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());

      const raw = await redis.get(`step_up:${sessionId}:t1`);
      expect(raw).toBeTruthy();
      const writtenTs = Number(raw);
      expect(Date.now() - writtenTs).toBeLessThan(2_000);

      const ttl = await redis.ttl(`step_up:${sessionId}:t1`);
      expect(ttl).toBeGreaterThanOrEqual(115);
      expect(ttl).toBeLessThanOrEqual(125);
    });

    it('sets a 10-second TTL for tier_requested=t3', async () => {
      const { sessionIdRound, clientLoginState, loginResponse } = await startOpaqueRound('t3');

      const finishResult = opaqueClient.finishLogin({
        clientLoginState,
        loginResponse,
        password,
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

      const finishRes = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: finishResult.finishLoginRequest,
        }),
      });
      expect(finishRes.status).toBe(200);

      const ttl = await redis.ttl(`step_up:${sessionId}:t3`);
      expect(ttl).toBeGreaterThanOrEqual(5);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('returns 401 opaque_authentication_failed for the wrong passphrase', async () => {
      const { sessionIdRound, loginResponse } = await startOpaqueRound('t1');

      // Compute a finishLogin against a different password — same
      // loginResponse — to simulate an attacker with a stolen bearer who
      // does not know the passphrase.
      const wrongClient = opaqueClient.startLogin({ password: 'definitely-not-the-right-one' });
      const wrongFinish = opaqueClient.finishLogin({
        clientLoginState: wrongClient.clientLoginState,
        loginResponse,
        password: 'definitely-not-the-right-one',
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      // OPAQUE's client.finishLogin returns undefined when the loginResponse
      // does not match the local OPRF output for the wrong password — in
      // that case we synthesise a junk evidence string; the server's
      // finishLogin must still reject it.
      const evidence = wrongFinish?.finishLoginRequest ?? 'AAAAAAAA';

      const finishRes = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: evidence,
        }),
      });
      expect(finishRes.status).toBe(401);
      const body = (await finishRes.json()) as { error: { code: string } };
      expect(body.error.code).toBe('opaque_authentication_failed');

      // No Redis key should have been written.
      const raw = await redis.get(`step_up:${sessionId}:t1`);
      expect(raw).toBeNull();
    });

    it('returns 410 session_expired for an unknown session_id', async () => {
      const finishRes = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: 'this-session-was-never-started',
          login_evidence: 'AAAAAAAA',
        }),
      });
      expect(finishRes.status).toBe(410);
      const body = (await finishRes.json()) as { error: { code: string } };
      expect(body.error.code).toBe('session_expired');
    });

    it('returns 429 rate_limited after 10 step-up attempts per session within 5 minutes', async () => {
      // The eleventh request inside the window must trip the per-session
      // limit regardless of mechanism outcome — the limiter runs before the
      // handler so the OPAQUE round state does not matter.
      for (let i = 0; i < 10; i++) {
        const res = await app.request('/api/v1/auth/step-up/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Origin: 'http://localhost:3000',
          },
          body: JSON.stringify({
            mechanism: 'opaque',
            tier_requested: 't1',
            login_request: 'AAAAAAAA',
          }),
        });
        // The body is malformed OPAQUE input so the handler will 4xx — but
        // the limiter still counted the request, which is what we are
        // exercising. Any non-429 outcome is acceptable for this loop.
        expect(res.status).not.toBe(429);
      }

      const blocked = await app.request('/api/v1/auth/step-up/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          mechanism: 'opaque',
          tier_requested: 't1',
          login_request: 'AAAAAAAA',
        }),
      });
      expect(blocked.status).toBe(429);
      const body = (await blocked.json()) as { error: { code: string } };
      expect(body.error.code).toBe('rate_limited');
    });

    it('logout clears step_up:<session>:* keys for the session', async () => {
      // Seed two grace-window keys for this session directly — the handler
      // logic under test is the cascade, not /finish (covered elsewhere).
      await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 120);
      await redis.set(`step_up:${sessionId}:t4`, String(Date.now()), 'EX', 300);

      const res = await app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
      });
      expect(res.status).toBe(200);

      expect(await redis.get(`step_up:${sessionId}:t1`)).toBeNull();
      expect(await redis.get(`step_up:${sessionId}:t4`)).toBeNull();
    });

    it('writes auth.step_up.confirmed on successful opaque finish', async () => {
      const { sessionIdRound, clientLoginState, loginResponse } = await startOpaqueRound('t1');

      const finishResult = opaqueClient.finishLogin({
        clientLoginState,
        loginResponse,
        password,
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

      const res = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: finishResult.finishLoginRequest,
        }),
      });
      expect(res.status).toBe(200);

      const { db } = createDb();
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, 'auth.step_up.confirmed')))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      expect(rows[0]).toBeDefined();
      expect(rows[0]?.metadata).toMatchObject({ method_type: 'opaque', tier: 't1' });
    });

    it('succeeds even after the user has been renamed (opaque identifier frozen at link time)', async () => {
      // Rename the user out-of-band — direct SQL bypasses any rename-
      // surface guards we may add later, isolating the OPAQUE identifier
      // invariant. The OPAQUE registration record was sealed against the
      // original username; if step-up read identifiers.client from the
      // live users.username, it would now fail with auth_failed.
      const { db } = createDb();
      const renamedUsername = `${username}r`;
      await db.update(users).set({ username: renamedUsername }).where(eq(users.id, userId));

      try {
        const { sessionIdRound, clientLoginState, loginResponse } = await startOpaqueRound('t1');

        const finishResult = opaqueClient.finishLogin({
          clientLoginState,
          loginResponse,
          password,
          // Client still uses the original username — its OPAQUE state was
          // bound to it at registration; renaming on the server side does
          // not retroactively change what the client computed.
          identifiers: {
            client: username,
            server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
          },
        });
        if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

        const res = await app.request('/api/v1/auth/step-up/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
          body: JSON.stringify({
            mechanism: 'opaque',
            session_id: sessionIdRound,
            login_evidence: finishResult.finishLoginRequest,
          }),
        });
        expect(res.status).toBe(200);
      } finally {
        await db.update(users).set({ username }).where(eq(users.id, userId));
      }
    });

    it('writes auth.step_up.failed on opaque wrong-passphrase rejection', async () => {
      const { sessionIdRound, loginResponse } = await startOpaqueRound('t1');

      const wrongClient = opaqueClient.startLogin({ password: 'wrong-password-here' });
      const wrongFinish = opaqueClient.finishLogin({
        clientLoginState: wrongClient.clientLoginState,
        loginResponse,
        password: 'wrong-password-here',
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      const evidence = wrongFinish?.finishLoginRequest ?? 'AAAAAAAA';

      const res = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: evidence,
        }),
      });
      expect(res.status).toBe(401);

      const { db } = createDb();
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, 'auth.step_up.failed')))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      expect(rows[0]).toBeDefined();
      expect(rows[0]?.metadata).toMatchObject({
        method_type: 'opaque',
        tier: 't1',
        reason: 'auth_failed',
      });
    });

    it('returns 410 session_expired on second use of the same session_id', async () => {
      const { sessionIdRound, clientLoginState, loginResponse } = await startOpaqueRound('t1');

      const finishResult = opaqueClient.finishLogin({
        clientLoginState,
        loginResponse,
        password,
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

      const first = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: finishResult.finishLoginRequest,
        }),
      });
      expect(first.status).toBe(200);

      const second = await app.request('/api/v1/auth/step-up/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          mechanism: 'opaque',
          session_id: sessionIdRound,
          login_evidence: finishResult.finishLoginRequest,
        }),
      });
      expect(second.status).toBe(410);
    });
  });
});
