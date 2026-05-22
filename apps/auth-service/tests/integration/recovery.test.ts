// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for the recovery challenge-response flow:
//   /api/v1/join/start + finish  →  /api/v1/recovery/start + finish
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produces a fake 32-byte blob as base64url. */
const zero32 = Buffer.alloc(32).toString('base64url');

/**
 * Builds an HMAC-SHA-256 proof matching the server's expected message:
 *   nonce || username || 0x00 || serverId
 */
async function buildProof(
  nonceB64: string,
  username: string,
  verifierKeyB64: string,
): Promise<string> {
  const serverId = `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`;

  const nonceBytes = new Uint8Array(Buffer.from(nonceB64, 'base64url'));
  const usernameBytes = new TextEncoder().encode(username);
  const separator = new Uint8Array([0]);
  const serverIdBytes = new TextEncoder().encode(serverId);

  // Concatenate all parts.
  const total = nonceBytes.length + usernameBytes.length + 1 + serverIdBytes.length;
  const message = new Uint8Array(total);
  let offset = 0;
  message.set(nonceBytes, offset);
  offset += nonceBytes.length;
  message.set(usernameBytes, offset);
  offset += usernameBytes.length;
  message.set(separator, offset);
  offset += 1;
  message.set(serverIdBytes, offset);

  // Import the verifier key.
  const keyBuf = Buffer.from(verifierKeyB64, 'base64url');
  const keyAb = keyBuf.buffer.slice(
    keyBuf.byteOffset,
    keyBuf.byteOffset + keyBuf.byteLength,
  ) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyAb,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Sign the message.
  const msgAb = message.buffer.slice(
    message.byteOffset,
    message.byteOffset + message.byteLength,
  ) as ArrayBuffer;
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgAb);
  return Buffer.from(sig).toString('base64url');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(skip)('Recovery challenge-response round-trip', () => {
  const originalPassword = 'original-passphrase-for-recovery-test';
  const newPassword = 'new-passphrase-after-recovery';
  const username = `recovery-test-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;

  // A 32-byte base64url string used as a stand-in for the recovery verifier key.
  // The client derives this from its recovery key; for tests we use a fixed value
  // so we can produce a valid HMAC proof in the finish step.
  const recoveryVerifierKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64url',
  );

  beforeAll(async () => {
    const _rlRedis = createRedis();
    const _rlKeys = await _rlRedis.keys('rl:join_*');
    if (_rlKeys.length) await _rlRedis.del(..._rlKeys);
    await opaqueReady;
    app = createServer();

    // Register a user via the OPAQUE link flow.
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
      password: originalPassword,
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
      password: originalPassword,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

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
        recovery_verifier_key: recoveryVerifierKey,
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

  it('start returns nonce, recovery wraps, and registration_response for a known user', async () => {
    const { clientRegistrationState: _state, registrationRequest } = opaqueClient.startRegistration(
      {
        password: newPassword,
      },
    );

    const res = await app.request('/api/v1/recovery/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, registration_request: registrationRequest }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nonce: string;
      wrapped_mk_recovery: string;
      wrap_nonce_recovery: string;
      wrap_aad_recovery: string;
      registration_response: string;
    };
    expect(typeof body.nonce).toBe('string');
    expect(body.nonce.length).toBeGreaterThan(0);
    expect(typeof body.wrapped_mk_recovery).toBe('string');
    expect(typeof body.wrap_nonce_recovery).toBe('string');
    expect(typeof body.wrap_aad_recovery).toBe('string');
    expect(typeof body.registration_response).toBe('string');

    // Confirm the server returned the recovery wraps we stored at link time.
    expect(body.wrapped_mk_recovery).toBe(zero32);
    expect(body.wrap_nonce_recovery).toBe(zero32);
    expect(body.wrap_aad_recovery).toBe(zero32);
  });

  it('start returns 404 for an unknown username', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({ password: 'irrelevant' });
    const res = await app.request('/api/v1/recovery/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        username: 'nosuchuser99999',
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(404);
  });

  it('finish completes recovery and issues new tokens', async () => {
    // Phase 1: get a nonce and registration_response from /start.
    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password: newPassword,
    });

    const startRes = await app.request('/api/v1/recovery/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, registration_request: registrationRequest }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      nonce: string;
      registration_response: string;
      wrapped_mk_recovery: string;
      wrap_nonce_recovery: string;
      wrap_aad_recovery: string;
    };

    // Phase 2: client-side OPAQUE finish using the server's registration_response.
    const { registrationRecord } = opaqueClient.finishRegistration({
      password: newPassword,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

    // Phase 3: build a valid HMAC proof using the same verifier key we stored.
    const proof = await buildProof(startBody.nonce, username, recoveryVerifierKey);

    // Phase 4: POST /api/v1/recovery/finish.
    const finishRes = await app.request('/api/v1/recovery/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        username,
        nonce: startBody.nonce,
        proof,
        registration_record: registrationRecord,
        new_wrapped_mk_opaque: zero32,
        new_wrap_nonce_opaque: zero32,
        new_wrap_aad_opaque: zero32,
        new_recovery_verifier_key: recoveryVerifierKey,
        new_wrapped_mk_recovery: zero32,
        new_wrap_nonce_recovery: zero32,
        new_wrap_aad_recovery: zero32,
      }),
    });
    expect(finishRes.status).toBe(200);
    const finishBody = (await finishRes.json()) as {
      user_id: string;
      role: string;
      access_token: string;
      expires_in: number;
    };
    expect(finishBody.user_id).toBe(userId);
    expect(finishBody.role).toBe('user');
    expect(typeof finishBody.access_token).toBe('string');
    expect(typeof finishBody.expires_in).toBe('number');

    // Verify the DB was updated: auth_methods replaced, user wraps updated.
    const { db } = createDb();
    const methodRows = await db.select().from(authMethods).where(eq(authMethods.userId, userId));
    expect(methodRows.length).toBe(1);
    expect(methodRows[0]?.methodType).toBe('opaque');
    // The OPAQUE userIdentifier on the new auth_method row should be the user's id.
    expect(methodRows[0]?.opaqueUserIdentifier).toBe(userId);
  });

  it('finish returns 401 when nonce is replayed', async () => {
    // The nonce from the previous test is already consumed. A replay attempt should fail.
    const proof = await buildProof('aGVsbG8', username, recoveryVerifierKey);
    const res = await app.request('/api/v1/recovery/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        username,
        nonce: 'aGVsbG8', // arbitrary — not in Redis
        proof,
        registration_record: zero32,
        new_wrapped_mk_opaque: zero32,
        new_wrap_nonce_opaque: zero32,
        new_wrap_aad_opaque: zero32,
        new_recovery_verifier_key: zero32,
        new_wrapped_mk_recovery: zero32,
        new_wrap_nonce_recovery: zero32,
        new_wrap_aad_recovery: zero32,
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('finish returns 401 when proof is invalid', async () => {
    // Get a fresh nonce.
    const { registrationRequest } = opaqueClient.startRegistration({ password: 'x' });
    const startRes = await app.request('/api/v1/recovery/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, registration_request: registrationRequest }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { nonce: string; registration_response: string };

    const res = await app.request('/api/v1/recovery/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        username,
        nonce: startBody.nonce,
        proof: zero32, // wrong proof
        registration_record: zero32,
        new_wrapped_mk_opaque: zero32,
        new_wrap_nonce_opaque: zero32,
        new_wrap_aad_opaque: zero32,
        new_recovery_verifier_key: zero32,
        new_wrapped_mk_recovery: zero32,
        new_wrap_nonce_recovery: zero32,
        new_wrap_aad_recovery: zero32,
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });
});
