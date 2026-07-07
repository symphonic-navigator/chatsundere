// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for POST /api/v1/join/{start,finish} with kind=invitation
// — the absorbed replacement for the old /v1/link/opaque/{start,finish} pair.
// The /finish branch is exercised in Task 11; this file covers /start +
// kind discriminator + lookup paths.

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

describe.skipIf(skip)('POST /api/v1/join (kind=invitation)', () => {
  let app: ReturnType<typeof createServer>;
  let invitationId: string;
  let invitationCode: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    // Drop cross-file rate-limit pollution before this file's /join calls.
    const redis = createRedis();
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);
  });

  beforeEach(async () => {
    const { db } = createDb();
    // Reset per-IP /join rate-limit budget between tests so the file's five
    // /join calls do not collectively cross the 10/min cap.
    const redis = createRedis();
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);
    invitationCode = generateCode();
    const codeHmac = await hashCode(invitationCode);
    const rows = await db
      .insert(pendingCodes)
      .values({
        type: 'invitation',
        codeHmac,
        role: 'user',
        suggestedUsername: 'chris.tidesson',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: pendingCodes.id });
    const row = rows[0];
    if (!row) throw new Error('test setup: pendingCodes insert returned no row');
    invitationId = row.id;
  });

  afterAll(async () => {
    const { db } = createDb();
    if (createdUserIds.length) {
      // Detach FK references before delete; mirrors the pattern used by
      // login-opaque.test.ts and step-up.test.ts.
      for (const uid of createdUserIds) {
        await db
          .update(pendingCodes)
          .set({ redeemedByUserId: null })
          .where(eq(pendingCodes.redeemedByUserId, uid));
        await db.delete(authMethods).where(eq(authMethods.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      }
    }
    if (invitationId) {
      await db.delete(pendingCodes).where(eq(pendingCodes.id, invitationId));
    }
    await closeDb();
  });

  it('returns 200 with session_id, registration_response, and suggested_username', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({
      password: 'join-start-test-passphrase',
    });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      registration_response: string;
      suggested_username: string | null;
    };
    expect(body.session_id).toBeTruthy();
    expect(body.registration_response).toBeTruthy();
    expect(body.suggested_username).toBe('chris.tidesson');
  });

  it('returns 404 code_not_found_or_expired when the code does not exist', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({ password: 'x' });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: '22222-33333',
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('code_not_found_or_expired');
  });

  it('returns 400 invalid_code_format for malformed codes', async () => {
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: 'lowercase-bad',
        registration_request: 'irrelevant',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_code_format');
  });

  it('completes the full /start + /finish round and persists a new user with auth_method', async () => {
    const username = `inv-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');
    const password = 'invitation-finish-test-passphrase';
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
    const finishBody = (await finishRes.json()) as {
      user_id: string;
      username: string;
      role: string;
      access_token: string;
      expires_in: number;
      is_new_account: boolean;
    };
    expect(finishBody.username).toBe(username);
    expect(finishBody.role).toBe('user');
    expect(finishBody.access_token).toBeTruthy();
    expect(finishBody.is_new_account).toBe(true);
    createdUserIds.push(finishBody.user_id);

    // The pending_codes row should now be marked redeemed.
    const { db } = createDb();
    const codeRow = (
      await db
        .select({
          redeemedAt: pendingCodes.redeemedAt,
          redeemedByUserId: pendingCodes.redeemedByUserId,
        })
        .from(pendingCodes)
        .where(eq(pendingCodes.id, invitationId))
        .limit(1)
    )[0];
    expect(codeRow?.redeemedAt).toBeTruthy();
    expect(codeRow?.redeemedByUserId).toBe(finishBody.user_id);
  });

  it('returns 429 rate_limited after 10 /join requests per IP in 60 seconds', async () => {
    // Ten allowed-shape requests will all see code_not_found_or_expired
    // (they hit unknown codes, since beforeEach's invitation is for a
    // different code). The 11th request must trip the per-IP minute cap.
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/api/v1/join/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          kind: 'invitation',
          code: '22222-33333',
          registration_request: 'AAAAAAAA',
        }),
      });
      expect(res.status).not.toBe(429);
    }

    const blocked = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: '22222-33333',
        registration_request: 'AAAAAAAA',
      }),
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('returns 410 code_already_redeemed when the code was already redeemed', async () => {
    // A redeemed one-time code is terminally spent, not a conflict — the
    // consume guard must surface 410 Gone (parity with code_expired and the
    // atomic-CAS redemption path in routes/join.ts). Seed the beforeEach row
    // as already-redeemed but neither revoked nor expired, so the /start
    // consume routes straight to the redeemedAt !== null branch.
    const { db } = createDb();
    await db
      .update(pendingCodes)
      .set({ redeemedAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(pendingCodes.id, invitationId));

    const { registrationRequest } = opaqueClient.startRegistration({ password: 'x' });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('code_already_redeemed');
  });

  it('returns 400 kind_mismatch without bumping the attempt counter', async () => {
    // Larissa β M1: a wrong-kind submission must NOT count against the
    // 4-attempt cap. Otherwise an attacker who saw the plaintext code
    // could DoS the legitimate user by burning the attempt budget with
    // 4 wrong-kind submissions.
    const { db } = createDb();
    await db
      .update(pendingCodes)
      .set({ type: 'pairing', role: null })
      .where(eq(pendingCodes.id, invitationId));

    const { registrationRequest } = opaqueClient.startRegistration({ password: 'x' });
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/v1/join/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          kind: 'invitation',
          code: invitationCode,
          registration_request: registrationRequest,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('kind_mismatch');
    }

    // The attempt counter must still be zero — the code stays usable.
    const row = (
      await db
        .select({ attemptCount: pendingCodes.attemptCount, revokedAt: pendingCodes.revokedAt })
        .from(pendingCodes)
        .where(eq(pendingCodes.id, invitationId))
        .limit(1)
    )[0];
    expect(row?.attemptCount).toBe(0);
    expect(row?.revokedAt).toBeNull();
  });
});
