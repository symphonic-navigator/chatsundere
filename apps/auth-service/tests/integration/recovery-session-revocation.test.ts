// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration test for the compromise-response property of recovery: a successful
// /api/v1/recovery/finish must sever every pre-existing session (recovery is the
// only account-eviction tool in the no-forgot-password model), while the freshly
// issued session survives. Requires a live PostgreSQL instance and Redis; skipped
// when DATABASE_URL or REDIS_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity, revokedSubKey } from '@chatsundere/shared-types';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { and, eq, isNull } from 'drizzle-orm';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { pendingCodes, refreshTokens, users } from '../../src/db/schema.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

/** A fake 32-byte blob as base64url, used as a stand-in for wrapped-key material. */
const zero32 = Buffer.alloc(32).toString('base64url');

/** The server identity the recovery proof is bound to (origin + /v1). */
function serverIdentity(): string {
  return opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth');
}

/**
 * Builds an HMAC-SHA-256 recovery proof over the server's expected message:
 *   nonce || username || 0x00 || serverId
 */
async function buildProof(
  nonceB64: string,
  username: string,
  verifierKeyB64: string,
): Promise<string> {
  const nonceBytes = new Uint8Array(Buffer.from(nonceB64, 'base64url'));
  const usernameBytes = new TextEncoder().encode(username);
  const separator = new Uint8Array([0]);
  const serverIdBytes = new TextEncoder().encode(serverIdentity());

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

/** Decodes a JWT's `iat` (issued-at) claim without verifying the signature. */
function iatOf(accessToken: string): number {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) throw new Error('access token has no payload segment');
  const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
    iat: number;
  };
  return payload.iat;
}

describe.skipIf(skip)('Recovery severs pre-existing sessions', () => {
  const originalPassword = 'original-passphrase-for-revocation-test';
  const newPassword = 'new-passphrase-after-revocation';
  const username = `recovery-revoke-${Date.now()}`.slice(0, 32).replace(/-/g, 'x');

  let app: ReturnType<typeof createServer>;
  let userId: string;

  // Fixed verifier key so we can produce a valid proof in the finish step.
  const recoveryVerifierKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64url',
  );

  beforeAll(async () => {
    const rlRedis = createRedis();
    const rlKeys = await rlRedis.keys('rl:join_*');
    if (rlKeys.length) await rlRedis.del(...rlKeys);
    await opaqueReady;
    app = createServer();

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
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
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
    const redis = createRedis();
    if (userId) await redis.del(revokedSubKey(userId));
    await closeDb();
  });

  it('revokes the pre-existing refresh family and denies the old subject, while the new token survives', async () => {
    // A pre-existing session — the sort of thing a stolen refresh cookie represents.
    const preExisting = await issueTokens({ userId, role: 'user' });

    // /start — obtain nonce + OPAQUE registration_response for the new passphrase.
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
    };

    const { registrationRecord } = opaqueClient.finishRegistration({
      password: newPassword,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: opaqueServerIdentity(process.env.API_BASE_URL ?? 'http://localhost:3100/auth'),
      },
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
    expect(finishRes.status).toBe(200);
    const finishBody = (await finishRes.json()) as { access_token: string };

    const { db } = createDb();

    // (a) The pre-existing refresh family is now revoked — it can no longer rotate.
    const preRows = await db
      .select({ revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, preExisting.refreshTokenId));
    expect(preRows[0]?.revokedAt).not.toBeNull();

    // (b) A denySub cutoff exists for the subject — pre-existing access tokens
    //     (iat < cutoff) are refused by the deny-list.
    const redis = createRedis();
    const storedCutoff = await redis.get(revokedSubKey(userId));
    expect(storedCutoff).not.toBeNull();
    const cutoff = Number(storedCutoff);
    expect(Number.isFinite(cutoff)).toBe(true);

    // (c) The freshly issued access token survives: its iat is at or after the
    //     cutoff (revoke ran BEFORE issuance), so the deny-list does not evict it.
    expect(iatOf(finishBody.access_token)).toBeGreaterThanOrEqual(cutoff);

    // (d) The NEW refresh family survives — revoke ran BEFORE issuance, so exactly
    //     one non-revoked family exists for the subject. This catches a
    //     revoke-AFTER-issue regression that would kill the new family too (which
    //     (a)-(c) would stay green under, since they only inspect the old family).
    const liveFamilies = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    expect(liveFamilies.length).toBe(1);
  });
});
