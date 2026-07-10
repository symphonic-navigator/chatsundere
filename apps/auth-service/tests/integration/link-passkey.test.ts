// SPDX-License-Identifier: AGPL-3.0-only
//
// Race test for /api/v1/link/passkey/finish's single-use webauthn:register:*
// Redis state consumption (Finding #9 scope extension, task A2b).
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'link-passkey-race-test-passphrase';

describe.skipIf(skip)('POST /api/v1/link/passkey/finish — race', () => {
  const username = `linkrace-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  const redis = createRedis();

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);

    // Register a fresh user via the OPAQUE join flow.
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
    await app.request('/api/v1/join/finish', {
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

    const userRow = (
      await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)
    )[0];
    if (!userRow) throw new Error('test setup: user row not found after join');
    userId = userRow.id;

    // Login via OPAQUE to obtain a bearer access token.
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
    const loginFinishBody = (await loginFinish.json()) as { access_token: string };
    accessToken = loginFinishBody.access_token;
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

  it('lets exactly one of two concurrent /finish calls pass the state-existence check', async () => {
    const sessionId = `race-test-${Math.random().toString(36).slice(2, 10)}`;
    await redis.set(
      `webauthn:register:${sessionId}`,
      JSON.stringify({ challenge: 'race-test-challenge', userId }),
      'EX',
      120,
    );
    // Pre-warm bearerAuth's user-exists cache (see middleware/auth.ts) and the JIT/
    // crypto cold-start cost of verifyAccessToken, so neither concurrent request
    // pays a variable-latency DB round-trip or first-call overhead before reaching
    // the race-critical state read — otherwise the two requests desynchronise on
    // that lookup and never contend for the same GET+DEL window.
    await redis.set(`userexists:${userId}`, '1', 'EX', 30);
    await app.request('/api/v1/link/passkey/finish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        session_id: 'warm-up-nonexistent-session',
        credential: {
          id: 'warm-up',
          rawId: 'warm-up',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'x' },
          clientExtensionResults: {},
        },
        wrapped_mk_passkey: Buffer.alloc(32).toString('base64url'),
        wrap_nonce_passkey: Buffer.alloc(32).toString('base64url'),
        wrap_aad_passkey: Buffer.alloc(32).toString('base64url'),
        label: 'warm-up',
      }),
    });

    const body = JSON.stringify({
      session_id: sessionId,
      credential: {
        id: 'race-test-credential',
        rawId: 'race-test-credential',
        type: 'public-key',
        response: {
          clientDataJSON: 'x',
          attestationObject: 'x',
        },
        clientExtensionResults: {},
      },
      wrapped_mk_passkey: Buffer.alloc(32).toString('base64url'),
      wrap_nonce_passkey: Buffer.alloc(32).toString('base64url'),
      wrap_aad_passkey: Buffer.alloc(32).toString('base64url'),
      label: 'race-test-key',
    });

    const request = () =>
      app.request('/api/v1/link/passkey/finish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body,
      });

    const [first, second] = await Promise.all([request(), request()]);

    const statuses = [first.status, second.status];
    // Exactly one call finds the round state and proceeds to (and fails)
    // WebAuthn verification against the bogus credential; the other finds
    // the state already consumed (410 expired).
    const expiredCount = statuses.filter((status) => status === 410).length;
    const otherCount = statuses.filter((status) => status !== 410).length;
    expect(expiredCount).toBe(1);
    expect(otherCount).toBe(1);
  });
});
