// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for the OPAQUE linking round-trip: /v1/link/opaque/start + finish.
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { hashInvitationToken } from '../../src/invitations/token.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('OPAQUE linking round-trip', () => {
  let invitationToken: string;
  let invitationId: string;
  let userId: string;
  let app: ReturnType<typeof createServer>;

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();

    // Insert a fresh invitation directly into the DB.
    const { db } = createDb();
    const rawToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    invitationToken = rawToken;

    const codeHmac = await hashInvitationToken(rawToken);
    const inserted = await db
      .insert(pendingCodes)
      .values({
        type: 'invitation',
        codeHmac,
        role: 'user',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      })
      .returning({ id: pendingCodes.id });
    invitationId = inserted[0]?.id ?? '';
  });

  afterAll(async () => {
    if (userId) {
      const { db } = createDb();
      // Null out the redeemed_by_user_id reference on pending_codes before deleting the user,
      // since that FK has no ON DELETE cascade.
      await db
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, userId));
      // auth_methods deletes via cascade from users.
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDb();
  });

  it('completes the OPAQUE registration flow and returns tokens', async () => {
    const password = 'hunter2-correct-horse-battery-staple';
    const username = `opaque-test-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

    // --- Start registration (client side) ---
    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password,
    });

    // --- POST /v1/link/opaque/start ---
    const startRes = await app.request('/v1/link/opaque/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        invitation_token: invitationToken,
        registration_request: registrationRequest,
      }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      session_id: string;
      registration_response: string;
    };
    expect(typeof startBody.session_id).toBe('string');
    expect(typeof startBody.registration_response).toBe('string');

    // --- Finish registration (client side) ---
    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

    // Dummy wrapping blobs (32 zero bytes each, base64url-encoded).
    const zero32 = Buffer.alloc(32).toString('base64url');

    // --- POST /v1/link/opaque/finish ---
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
    const finishBody = (await finishRes.json()) as {
      user_id: string;
      role: string;
      access_token: string;
      expires_in: number;
    };
    expect(typeof finishBody.user_id).toBe('string');
    expect(finishBody.role).toBe('user');
    expect(typeof finishBody.access_token).toBe('string');
    expect(typeof finishBody.expires_in).toBe('number');

    userId = finishBody.user_id;

    // Verify the user row exists in the DB.
    const { db } = createDb();
    const userRows = await db.select().from(users).where(eq(users.id, userId));
    expect(userRows.length).toBe(1);
    expect(userRows[0]?.username).toBe(username);

    // Verify the auth_method row and the persisted OPAQUE identifier.
    const methodRows = await db.select().from(authMethods).where(eq(authMethods.userId, userId));
    expect(methodRows.length).toBe(1);
    expect(methodRows[0]?.methodType).toBe('opaque');
    expect(methodRows[0]?.opaqueUserIdentifier).toBe(invitationId);

    // Verify the invitation is marked as redeemed.
    if (!invitationId) throw new Error('invitationId not set');
    const invRows = await db.select().from(pendingCodes).where(eq(pendingCodes.id, invitationId));
    expect(invRows[0]?.redeemedAt).not.toBeNull();
    expect(invRows[0]?.redeemedByUserId).toBe(userId);
  });

  it('returns 409 on duplicate username', async () => {
    // We need a fresh invitation for the second attempt.
    const { db } = createDb();
    const rawToken2 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const codeHmac2 = await hashInvitationToken(rawToken2);
    await db.insert(pendingCodes).values({
      type: 'invitation',
      codeHmac: codeHmac2,
      role: 'user',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const password = 'hunter2-correct-horse';
    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password,
    });

    const startRes = await app.request('/v1/link/opaque/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        invitation_token: rawToken2,
        registration_request: registrationRequest,
      }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      session_id: string;
      registration_response: string;
    };

    // Use the same username as the first test user — should conflict.
    const existingUsername = (
      await db.select({ username: users.username }).from(users).where(eq(users.id, userId))
    )[0]?.username;

    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: existingUsername ?? 'unknown',
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

    const zero32 = Buffer.alloc(32).toString('base64url');

    const finishRes = await app.request('/v1/link/opaque/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: startBody.session_id,
        username: existingUsername,
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
    expect(finishRes.status).toBe(409);
    const body = (await finishRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe('username_taken');
  });

  it('returns 410 when session_id is reused', async () => {
    // The session from the first test is already consumed. Replaying it should return 410.
    const zero32 = Buffer.alloc(32).toString('base64url');
    const res = await app.request('/v1/link/opaque/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: 'bogus-session-id-that-never-existed',
        username: 'anotherusername',
        registration_record: zero32,
        wrapped_mk_opaque: zero32,
        wrap_nonce_opaque: zero32,
        wrap_aad_opaque: zero32,
        wrapped_mk_recovery: zero32,
        wrap_nonce_recovery: zero32,
        wrap_aad_recovery: zero32,
        recovery_verifier_key: zero32,
      }),
    });
    expect(res.status).toBe(410);
  });
});
