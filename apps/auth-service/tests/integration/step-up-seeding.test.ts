// SPDX-License-Identifier: AGPL-3.0-only
//
// Verifies the t1 fresh-evidence seeding (WS-B+E spec §4.1):
// join/finish (invitation + pairing), opaque login/finish, and
// recovery/finish each seed step_up:<jti>:t1; nothing seeds t3/t4.
// Also verifies the recovery opaque_client_identifier fix: step-up
// mechanism=opaque still works after a recovery.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

// Must match the server's derivation (origin-only opaqueServerIdentity) — used
// for both the recovery HMAC proof and the OPAQUE identifiers.
const serverId = opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth');

/** Reads the jti claim out of a JWS access token without verifying it. */
function jtiOf(accessToken: string): string {
  const payload = accessToken.split('.')[1] ?? '';
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { jti?: string };
  if (!claims.jti) throw new Error('access token has no jti');
  return claims.jti;
}

/**
 * Builds an HMAC-SHA-256 proof matching the server's expected message:
 *   nonce || username || 0x00 || serverId
 * (copied verbatim from recovery.test.ts).
 */
async function buildProof(
  nonceB64: string,
  username: string,
  verifierKeyB64: string,
): Promise<string> {
  const nonceBytes = new Uint8Array(Buffer.from(nonceB64, 'base64url'));
  const usernameBytes = new TextEncoder().encode(username);
  const separator = new Uint8Array([0]);
  const serverIdBytes = new TextEncoder().encode(serverId);

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

  const msgAb = message.buffer.slice(
    message.byteOffset,
    message.byteOffset + message.byteLength,
  ) as ArrayBuffer;
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgAb);
  return Buffer.from(sig).toString('base64url');
}

const zero32 = Buffer.alloc(32).toString('base64url');

interface JoinedUser {
  username: string;
  userId: string;
  joined: { user_id: string; access_token: string };
}

describe.skipIf(skip)('t1 seeding on fresh evidence', () => {
  const redis = createRedis();
  let app: ReturnType<typeof createServer>;
  const createdUserIds: string[] = [];

  /**
   * Registers a fresh user via an invitation OPAQUE round and returns the
   * /join/finish response. Mirrors step-up.test.ts's beforeAll verbatim.
   */
  async function joinViaInvitation(
    username: string,
    password: string,
    recoveryVerifierKey: string,
  ): Promise<JoinedUser> {
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
        recovery_verifier_key: recoveryVerifierKey,
      }),
    });
    const joined = (await finishRes.json()) as { user_id: string; access_token: string };
    createdUserIds.push(joined.user_id);
    return { username, userId: joined.user_id, joined };
  }

  /** Runs a full OPAQUE login round and returns the /login/finish response. */
  async function opaqueLogin(
    username: string,
    password: string,
  ): Promise<{ access_token: string }> {
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
      identifiers: { client: username, server: serverId },
    });
    if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');
    const loginFinish = await app.request('/api/v1/opaque/login/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: loginStartBody.session_id,
        finish_login_request: finishResult.finishLoginRequest,
      }),
    });
    return (await loginFinish.json()) as { access_token: string };
  }

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    // Drop cross-file rate-limit pollution before this file's /join calls.
    const rlKeys = await redis.keys('rl:join_*');
    if (rlKeys.length) await redis.del(...rlKeys);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      const { db } = createDb();
      for (const id of createdUserIds) {
        await db
          .update(pendingCodes)
          .set({ redeemedByUserId: null })
          .where(eq(pendingCodes.redeemedByUserId, id));
        // Pairing owners create pending codes (createdBy) — clear them and
        // the user's auth methods before deleting the user row.
        await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, id));
        await db.delete(authMethods).where(eq(authMethods.userId, id));
        await db.delete(users).where(eq(users.id, id));
      }
    }
    await closeDb();
  });

  it('seeds t1 (and only t1) after an invitation join', async () => {
    const username = `seedinv-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');
    const { joined } = await joinViaInvitation(
      username,
      'seed-inv-passphrase-correct-horse',
      zero32,
    );

    const jti = jtiOf(joined.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();
    expect(await redis.get(`step_up:${jti}:t3`)).toBeNull();
    expect(await redis.get(`step_up:${jti}:t4`)).toBeNull();
  });

  it('seeds t1 after an OPAQUE login', async () => {
    const username = `seedlog-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');
    const password = 'seed-login-passphrase-correct-horse';
    await joinViaInvitation(username, password, zero32);

    const loggedIn = await opaqueLogin(username, password);
    const jti = jtiOf(loggedIn.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();
  });

  it('seeds t1 after a pairing join', async () => {
    const ownerName = `seedpair-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');
    const password = 'seed-pairing-passphrase-correct-horse';
    const owner = await joinViaInvitation(ownerName, password, zero32);

    // Seed the owner's t1 grace key directly so pairing-code creation (a
    // Tier-1 gated endpoint) is authorised.
    const ownerJti = jtiOf(owner.joined.access_token);
    await redis.set(`step_up:${ownerJti}:t1`, String(Date.now()), 'EX', 120);

    const codeRes = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${owner.joined.access_token}`,
        Origin: 'http://localhost:3000',
      },
      body: '{}',
    });
    const { code } = (await codeRes.json()) as { code: string };

    // Pairing join OPAQUE round from the "new device" (join-pairing.test.ts).
    const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password });
    const startRes = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ kind: 'pairing', code, login_request: startLoginRequest }),
    });
    const startBody = (await startRes.json()) as { session_id: string; login_response: string };

    const finishResult = opaqueClient.finishLogin({
      clientLoginState,
      loginResponse: startBody.login_response,
      password,
      identifiers: { client: ownerName, server: serverId },
    });
    if (!finishResult) throw new Error('OPAQUE finishLogin returned undefined');

    const pairRes = await app.request('/api/v1/join/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        kind: 'pairing',
        session_id: startBody.session_id,
        login_evidence: finishResult.finishLoginRequest,
      }),
    });
    const paired = (await pairRes.json()) as { access_token: string };

    const jti = jtiOf(paired.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();
  });

  it('seeds t1 after recovery, and step-up opaque still works post-recovery', async () => {
    const username = `seedrec-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');
    const originalPassword = 'seed-recovery-original-passphrase';
    const newPassword = 'seed-recovery-new-passphrase';
    const recoveryVerifierKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      'base64url',
    );

    await joinViaInvitation(username, originalPassword, recoveryVerifierKey);

    // Recovery /start for a NEW passphrase.
    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password: newPassword,
    });
    const startRes = await app.request('/api/v1/recovery/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ username, registration_request: registrationRequest }),
    });
    const startBody = (await startRes.json()) as {
      nonce: string;
      registration_response: string;
    };

    const { registrationRecord } = opaqueClient.finishRegistration({
      password: newPassword,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: { client: username, server: serverId },
    });

    const proof = await buildProof(startBody.nonce, username, recoveryVerifierKey);

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
    const recovered = (await finishRes.json()) as { access_token: string };

    const jti = jtiOf(recovered.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();

    // Regression guard for the opaque_client_identifier fix: a step-up
    // start with mechanism=opaque must NOT return 400 no_opaque.
    const startLogin = opaqueClient.startLogin({ password: newPassword });
    const stepUpRes = await app.request('/api/v1/auth/step-up/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${recovered.access_token}`,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        mechanism: 'opaque',
        tier_requested: 't1',
        login_request: startLogin.startLoginRequest,
      }),
    });
    expect(stepUpRes.status).toBe(200);
  });
});
