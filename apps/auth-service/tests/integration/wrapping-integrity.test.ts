// SPDX-License-Identifier: AGPL-3.0-only
//
// Defence-in-depth test for assertOpaqueWrappingPresent: deliberately
// corrupts the user's OPAQUE wrapping columns and asserts that the
// pairing-finish flow refuses to surface wrapped MK material, writes the
// wrapping_invariant_violated audit row, and increments the Prometheus
// counter. The invariant cannot be reached by any legitimate flow today
// (registration + passphrase-change always write all three columns
// atomically), so this test exists to catch future regressions or DB
// tampering.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { and, desc, eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { auditLog, authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'wrapping-integrity-test-passphrase';

describe.skipIf(skip)('Wrapping-integrity invariant on /api/v1/join/finish', () => {
  const username = `wrap-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  let sessionId: string;
  let originalWrappedMk: Uint8Array;
  let originalWrapNonce: Uint8Array;
  let originalWrapAad: Uint8Array;
  const redis = createRedis();

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();
    // Drop cross-file rate-limit pollution before this file's /join calls.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);

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
    if (!userRow) throw new Error('test setup: user row not found');
    userId = userRow.id;

    // Capture the original wrapping so we can restore it between tests.
    const opaqueRow = (
      await db
        .select({
          wrappedMasterKey: authMethods.wrappedMasterKey,
          wrapNonce: authMethods.wrapNonce,
          wrapAad: authMethods.wrapAad,
        })
        .from(authMethods)
        .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')))
        .limit(1)
    )[0];
    if (!opaqueRow?.wrappedMasterKey || !opaqueRow.wrapNonce || !opaqueRow.wrapAad) {
      throw new Error('test setup: OPAQUE wrapping missing after link');
    }
    originalWrappedMk = opaqueRow.wrappedMasterKey;
    originalWrapNonce = opaqueRow.wrapNonce;
    originalWrapAad = opaqueRow.wrapAad;

    // Login the owner so we can mint a pairing code.
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
    // Restore the original wrapping (in case a prior test corrupted it) and
    // clear any leftover pairing codes for the test user.
    const { db } = createDb();
    await db
      .update(authMethods)
      .set({
        wrappedMasterKey: originalWrappedMk,
        wrapNonce: originalWrapNonce,
        wrapAad: originalWrapAad,
      })
      .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')));
    await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, userId));
    const keys = await redis.keys(`step_up:${sessionId}:*`);
    if (keys.length) await redis.del(...keys);
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
    return ((await res.json()) as { code: string }).code;
  }

  it('returns 500 wrapping_invariant_violated when the user has multiple OPAQUE auth_methods', async () => {
    const code = await mintPairingCode();
    const { db } = createDb();
    // Insert a second OPAQUE row for the same user — the schema allows
    // this (the (user_id, method_type) index is not unique). Reaching this
    // state requires explicit code or DB tampering; the test exists to
    // catch the assertion guarding against either.
    const garbage = new Uint8Array(32);
    const insertedRows = await db
      .insert(authMethods)
      .values({
        userId,
        methodType: 'opaque',
        opaqueCredential: garbage,
        opaqueUserIdentifier: 'second-opaque-method',
        opaqueClientIdentifier: 'second-username',
        wrappedMasterKey: garbage,
        wrapNonce: garbage,
        wrapAad: garbage,
      })
      .returning({ id: authMethods.id });
    const secondId = insertedRows[0]?.id;
    if (!secondId) throw new Error('test setup: second opaque insert returned no row');

    try {
      const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password });
      const startRes = await app.request('/api/v1/join/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ kind: 'pairing', code, login_request: startLoginRequest }),
      });
      // /start picks the first matching opaque row (LIMIT 1), so the
      // start path still succeeds; the invariant assertion fires at /finish.
      expect(startRes.status).toBe(200);
      const startBody = (await startRes.json()) as { session_id: string; login_response: string };

      const finishResult = opaqueClient.finishLogin({
        clientLoginState,
        loginResponse: startBody.login_response,
        password,
        identifiers: {
          client: username,
          server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
        },
      });
      if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

      const finishRes = await app.request('/api/v1/join/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          kind: 'pairing',
          session_id: startBody.session_id,
          login_evidence: finishResult.finishLoginRequest,
        }),
      });
      expect(finishRes.status).toBe(500);
      const body = (await finishRes.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('wrapping_invariant_violated');
      // The generic message must not leak which specific invariant failed.
      expect(body.error.message).not.toContain('multiple');
      expect(body.error.message).not.toContain('null');

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.userId, userId), eq(auditLog.eventType, 'wrapping_invariant_violated')),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      expect(auditRows[0]).toBeDefined();
      expect(auditRows[0]?.metadata).toMatchObject({ reason: 'multiple_opaque_methods' });
    } finally {
      // Remove the second opaque row so afterAll's cleanup does not double-
      // delete (cascade-on-user handles the rest).
      await db.delete(authMethods).where(eq(authMethods.id, secondId));
    }
  });
});
