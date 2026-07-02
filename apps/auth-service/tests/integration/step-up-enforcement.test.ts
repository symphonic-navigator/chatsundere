// SPDX-License-Identifier: AGPL-3.0-only
//
// Verifies the WS-B+E spec §4 enforcement table: Tier 1 on
// link/passkey/start, auth-methods DELETE, passphrase-change start;
// Tier 3 on DELETE /me. Each endpoint 403s without a key and proceeds
// with a seeded key.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'step-up-enforce-passphrase-correct-horse';
const serverId = `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`;

describe.skipIf(skip)('step-up enforcement', () => {
  const username = `stepupenf-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  let jti: string;
  const redis = createRedis();

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    const { db } = createDb();
    // Drop cross-file rate-limit pollution before this file's /join call.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);

    // Mint an invitation and redeem it via the OPAQUE join flow.
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
      identifiers: { client: username, server: serverId },
    });

    const zero32 = Buffer.alloc(32).toString('base64url');
    const finishRes = await app.request('/api/v1/join/finish', {
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
    const joined = (await finishRes.json()) as { user_id: string; access_token: string };
    userId = joined.user_id;
    accessToken = joined.access_token;

    // The jti claim doubles as the server-side sessionId for step-up state.
    const payloadB64 = accessToken.split('.')[1];
    if (!payloadB64) throw new Error('test setup: malformed access token');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      jti: string;
    };
    jti = payload.jti;
  });

  beforeEach(async () => {
    // Task 2 now seeds t1 on join; clear both keys so each case starts ungated.
    await redis.del(`step_up:${jti}:t1`, `step_up:${jti}:t3`);
  });

  afterAll(async () => {
    if (userId) {
      const { db } = createDb();
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, userId));
      await db.delete(authMethods).where(eq(authMethods.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  async function expectStepUpRequired(res: Response, tier: number): Promise<void> {
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; tier: number } };
    expect(body.error.code).toBe('step_up_required');
    expect(body.error.tier).toBe(tier);
  }

  // State-changing requests must carry an allowed Origin — corsAndOriginCheck
  // rejects Origin-less mutations with 403 forbidden before the handler runs.
  // Built lazily (accessToken is only populated in beforeAll, after this
  // describe body is collected).
  const postHeaders = () => ({
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    Origin: 'http://localhost:3000',
  });
  const deleteHeaders = () => ({
    authorization: `Bearer ${accessToken}`,
    Origin: 'http://localhost:3000',
  });

  it('gates POST /api/v1/link/passkey/start at tier 1', async () => {
    const bare = await app.request('/api/v1/link/passkey/start', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({}),
    });
    await expectStepUpRequired(bare, 1);

    await redis.set(`step_up:${jti}:t1`, String(Date.now()), 'EX', 120);
    const seeded = await app.request('/api/v1/link/passkey/start', {
      method: 'POST',
      headers: postHeaders(),
      body: JSON.stringify({}),
    });
    expect(seeded.status).toBe(200); // returns { session_id, options }
  });

  it('gates POST /api/v1/auth-methods/passphrase/change/start at tier 1', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({ password: 'next-pass' });
    const call = () =>
      app.request('/api/v1/auth-methods/passphrase/change/start', {
        method: 'POST',
        headers: postHeaders(),
        body: JSON.stringify({ registration_request: registrationRequest }),
      });
    await expectStepUpRequired(await call(), 1);
    await redis.set(`step_up:${jti}:t1`, String(Date.now()), 'EX', 120);
    expect((await call()).status).toBe(200);
  });

  it('gates DELETE /api/v1/auth-methods/:id at tier 1', async () => {
    // Insert a second (throwaway) auth-method row directly via drizzle so the
    // delete does not trip the lockout guard, then delete it.
    const zero32 = new Uint8Array(32);
    const throwawayId = (
      await createDb()
        .db.insert(authMethods)
        .values({
          userId,
          methodType: 'passkey',
          passkeyCredentialId: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
          passkeyPublicKey: zero32,
          passkeySignCount: 0,
          wrappedMasterKey: zero32,
          wrapNonce: zero32,
          wrapAad: zero32,
        })
        .returning({ id: authMethods.id })
    )[0]?.id;
    if (!throwawayId) throw new Error('test setup: throwaway auth-method insert returned no row');

    await expectStepUpRequired(
      await app.request(`/api/v1/auth-methods/${throwawayId}`, {
        method: 'DELETE',
        headers: deleteHeaders(),
      }),
      1,
    );
    await redis.set(`step_up:${jti}:t1`, String(Date.now()), 'EX', 120);
    const ok = await app.request(`/api/v1/auth-methods/${throwawayId}`, {
      method: 'DELETE',
      headers: deleteHeaders(),
    });
    expect(ok.status).toBe(200);
  });

  it('gates DELETE /api/v1/me at tier 3 — run LAST, destroys the user', async () => {
    await expectStepUpRequired(
      await app.request('/api/v1/me', {
        method: 'DELETE',
        headers: deleteHeaders(),
      }),
      3,
    );
    await redis.set(`step_up:${jti}:t3`, String(Date.now()), 'EX', 10);
    const ok = await app.request('/api/v1/me', {
      method: 'DELETE',
      headers: deleteHeaders(),
    });
    expect(ok.status).toBe(200);
  });
});
