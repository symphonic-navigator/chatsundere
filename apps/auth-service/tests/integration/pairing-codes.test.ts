// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the /api/v1/me/pairing-codes lifecycle:
//   POST   — create (Tier 1 step-up required)
//   GET    — list active codes (code/qr_url surfaced as null; HMAC-only storage)
//   DELETE — revoke (404 if not owned, 409 if already revoked)

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { and, eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;
const password = 'pairing-codes-test-passphrase-correct-horse';

describe.skipIf(skip)('/api/v1/me/pairing-codes', () => {
  const username = `pair-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

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

    // Register a fresh user via OPAQUE link.
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

    // Login via OPAQUE to get a fresh access token + sessionId.
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
    const loginFinishBody = (await loginFinish.json()) as { access_token: string };
    accessToken = loginFinishBody.access_token;
    const [, payloadB64] = accessToken.split('.');
    if (!payloadB64) throw new Error('test setup: malformed access token');
    sessionId = (
      JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
        jti: string;
      }
    ).jti;
  });

  beforeEach(async () => {
    const keys = await redis.keys(`step_up:${sessionId}:*`);
    if (keys.length) await redis.del(...keys);
    // Drop every pairing code the test user owns so list/count assertions
    // are deterministic per test.
    const { db } = createDb();
    await db
      .delete(pendingCodes)
      .where(and(eq(pendingCodes.createdBy, userId), eq(pendingCodes.type, 'pairing')));
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

  async function seedTier1(): Promise<void> {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 120);
  }

  describe('POST /api/v1/me/pairing-codes', () => {
    it('returns 403 step_up_required without Tier 1 step-up', async () => {
      const res = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: '{}',
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('step_up_required');
    });

    it('returns 201 with code, qr_url, and ~5-minute TTL when step-up is fresh', async () => {
      await seedTier1();
      const res = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: '{}',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        code: string;
        qr_url: string;
        expires_at: string;
        created_at: string;
        state: string;
      };
      expect(body.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/);
      expect(body.qr_url).toBe(
        `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/join#${body.code}`,
      );
      expect(body.state).toBe('active');
      const ttlMs = new Date(body.expires_at).getTime() - new Date(body.created_at).getTime();
      expect(ttlMs).toBeGreaterThanOrEqual(290_000);
      expect(ttlMs).toBeLessThanOrEqual(310_000);
    });

    it('returns 401 without bearer', async () => {
      const res = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: '{}',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/me/pairing-codes', () => {
    it('lists only active codes; code and qr_url are intentionally null', async () => {
      await seedTier1();
      const createRes = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: '{}',
      });
      const created = (await createRes.json()) as { id: string };

      const listRes = await app.request('/api/v1/me/pairing-codes', {
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
      });
      expect(listRes.status).toBe(200);
      const body = (await listRes.json()) as {
        pairing_codes: Array<{
          id: string;
          code: string | null;
          qr_url: string | null;
          state: string;
        }>;
      };
      const found = body.pairing_codes.find((p) => p.id === created.id);
      expect(found).toBeDefined();
      // Spec §4.5 deviation: codes are HMAC-stored and cannot be recovered.
      // GET surfaces null; the user must save the code from the POST response.
      expect(found?.code).toBeNull();
      expect(found?.qr_url).toBeNull();
      expect(found?.state).toBe('active');
    });

    it('excludes revoked codes from the list', async () => {
      await seedTier1();
      const createRes = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: '{}',
      });
      const created = (await createRes.json()) as { id: string };
      await app.request(`/api/v1/me/pairing-codes/${created.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
      });

      const listRes = await app.request('/api/v1/me/pairing-codes', {
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
      });
      const body = (await listRes.json()) as { pairing_codes: Array<{ id: string }> };
      expect(body.pairing_codes.find((p) => p.id === created.id)).toBeUndefined();
    });

    it('returns 401 without bearer', async () => {
      const res = await app.request('/api/v1/me/pairing-codes', {
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/me/pairing-codes/:id', () => {
    it('revokes an active code and returns ok=true', async () => {
      await seedTier1();
      const createRes = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: '{}',
      });
      const { id } = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/api/v1/me/pairing-codes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
      });
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ ok: true });
    });

    it('returns 404 for an id that does not belong to the user', async () => {
      const res = await app.request(
        '/api/v1/me/pairing-codes/00000000-0000-0000-0000-000000000000',
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
        },
      );
      expect(res.status).toBe(404);
    });

    it('returns 409 already_revoked on a second revoke of the same code', async () => {
      await seedTier1();
      const createRes = await app.request('/api/v1/me/pairing-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Origin: 'http://localhost:3000',
        },
        body: '{}',
      });
      const { id } = (await createRes.json()) as { id: string };

      await app.request(`/api/v1/me/pairing-codes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
      });
      const dup = await app.request(`/api/v1/me/pairing-codes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, Origin: 'http://localhost:3000' },
      });
      expect(dup.status).toBe(409);
      const body = (await dup.json()) as { error: { code: string } };
      expect(body.error.code).toBe('already_revoked');
    });
  });
});
