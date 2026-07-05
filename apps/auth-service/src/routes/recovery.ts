// SPDX-License-Identifier: AGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { server as opaqueServer } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { denySub, nowSeconds } from '../auth/deny-list.js';
import { seedStepUpKey } from '../auth/step-up.js';
import { createDb } from '../db/client.js';
import { authMethods, users } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { revokeAllForUser } from '../jwt/refresh.js';
import { metrics } from '../metrics.js';
import { ApiError } from '../middleware/error-envelope.js';
import { ensureOpaqueReady, getServerSetup } from '../opaque/server.js';
import { consumeNonce, storeNonce } from '../recovery/nonce.js';
import { createRedis } from '../redis/client.js';
import { applyLoginRateLimit } from './_rate-limit-helpers.js';

const startReqSchema = object({
  username: string(),
  registration_request: string(),
});

const finishReqSchema = object({
  username: string(),
  nonce: string(),
  proof: string(),
  registration_record: string(),
  new_wrapped_mk_opaque: string(),
  new_wrap_nonce_opaque: string(),
  new_wrap_aad_opaque: string(),
  new_recovery_verifier_key: string(),
  new_wrapped_mk_recovery: string(),
  new_wrap_nonce_recovery: string(),
  new_wrap_aad_recovery: string(),
});

export function registerRecoveryRoutes(app: Hono): void {
  /**
   * POST /api/v1/recovery/start
   *
   * The client sends its username and an OPAQUE registration_request for a fresh
   * re-registration under its new passphrase. The server returns:
   *   - nonce: 16 random bytes (base64url) — to be included in the proof
   *   - wrapped_mk_recovery / wrap_nonce_recovery / wrap_aad_recovery: the encrypted
   *     master-key blob the client stored at link time, so the client can decrypt it
   *     with its recovery key and re-wrap it under the new passphrase.
   *   - registration_response: OPAQUE server-side response for the fresh registration.
   *
   * The nonce is stored in Redis with a 60 s TTL and consumed on the /finish call.
   */
  app.post('/api/v1/recovery/start', async (c) => {
    await ensureOpaqueReady();
    const body = parse(startReqSchema, await c.req.json());
    await applyLoginRateLimit(body.username);

    const { db } = createDb();
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1);

    const user = userRows[0];
    if (!user) {
      // Return 404 — in production a timing-safe fake response would be preferable,
      // but username enumeration via the challenge endpoint is lower-risk than
      // via the login endpoint. Deferred to a future hardening pass.
      throw new ApiError(404, 'not_found', 'Unknown user');
    }

    if (!user.wrappedMkRecovery || !user.wrapNonceRecovery || !user.wrapAadRecovery) {
      // Recovery wraps absent — the user row predates migration 0002 or was created
      // without recovery fields. Recovery is not possible.
      throw new ApiError(409, 'recovery_unavailable', 'Recovery wraps not set for this account');
    }

    const nonce = new Uint8Array(16);
    crypto.getRandomValues(nonce);
    await storeNonce(body.username, nonce);

    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: user.id,
      registrationRequest: body.registration_request,
    });

    return c.json({
      nonce: Buffer.from(nonce).toString('base64url'),
      wrapped_mk_recovery: Buffer.from(user.wrappedMkRecovery).toString('base64url'),
      wrap_nonce_recovery: Buffer.from(user.wrapNonceRecovery).toString('base64url'),
      wrap_aad_recovery: Buffer.from(user.wrapAadRecovery).toString('base64url'),
      registration_response: registrationResponse,
    });
  });

  /**
   * POST /api/v1/recovery/finish
   *
   * The client sends:
   *   - username + nonce (as returned by /start)
   *   - proof: HMAC-SHA-256 over (nonce || username || 0x00 || serverId) using
   *     the recovery_verifier_key stored on the users row.
   *   - registration_record: OPAQUE record produced by finishRegistration.
   *   - new_wrapped_mk_opaque / _nonce / _aad: re-wrapped master key for OPAQUE.
   *   - new_recovery_verifier_key: fresh HMAC key derived from the new recovery key.
   *   - new_wrapped_mk_recovery / _nonce / _aad: re-wrapped master key for the new RK.
   *
   * On success, in a single transaction: all existing auth_methods are deleted, a new
   * opaque auth_method is inserted, and the recovery columns + verifier key on users
   * are updated. A recovery_used audit event is written and tokens are issued.
   */
  app.post('/api/v1/recovery/finish', async (c) => {
    await ensureOpaqueReady();
    const body = parse(finishReqSchema, await c.req.json());

    const { db } = createDb();
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1);

    const user = userRows[0];
    if (!user) throw new ApiError(404, 'not_found', 'Unknown user');

    // Consume the nonce first — any subsequent path that fails still invalidates it,
    // preventing an attacker from retrying with a different proof.
    const nonceBytes = new Uint8Array(Buffer.from(body.nonce, 'base64url'));
    const validNonce = await consumeNonce(body.username, nonceBytes);
    if (!validNonce) {
      metrics.authRecoveryAttemptsTotal.inc({ result: 'no_nonce' });
      throw new ApiError(401, 'unauthorized', 'Nonce missing or expired');
    }

    // Verify the HMAC proof using the stored recovery_verifier_key.
    // Slice the underlying ArrayBuffer to guarantee it is a plain ArrayBuffer (not
    // SharedArrayBuffer), which is what crypto.subtle requires.
    const verifierKeyBuf = Buffer.from(user.recoveryVerifierKey);
    const verifierKeyAb = verifierKeyBuf.buffer.slice(
      verifierKeyBuf.byteOffset,
      verifierKeyBuf.byteOffset + verifierKeyBuf.byteLength,
    ) as ArrayBuffer;
    const verifierKey = await crypto.subtle.importKey(
      'raw',
      verifierKeyAb,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const env = loadEnv();
    const serverId = opaqueServerIdentity(env.API_BASE_URL);
    const message = concat(
      nonceBytes,
      new TextEncoder().encode(body.username),
      new Uint8Array([0]),
      new TextEncoder().encode(serverId),
    );
    const proofBuf = Buffer.from(body.proof, 'base64url');
    const proofAb = proofBuf.buffer.slice(
      proofBuf.byteOffset,
      proofBuf.byteOffset + proofBuf.byteLength,
    ) as ArrayBuffer;
    const messageAb = message.buffer.slice(
      message.byteOffset,
      message.byteOffset + message.byteLength,
    ) as ArrayBuffer;
    const proofValid = await crypto.subtle.verify('HMAC', verifierKey, proofAb, messageAb);
    if (!proofValid) {
      metrics.authRecoveryAttemptsTotal.inc({ result: 'bad_proof' });
      throw new ApiError(401, 'unauthorized', 'Invalid recovery proof');
    }

    // Recovery is the compromise-response tool (no forgot-password model): evict
    // every existing session. Revoke BEFORE issuing the new tokens so the pre-existing
    // refresh families die and pre-existing access tokens (iat < cutoff) are denied,
    // while the freshly-issued session — new refresh family, access iat >= cutoff —
    // survives. Runs before the auth-swap tx so a failed swap still evicts (fail-safe).
    const revokeCutoff = nowSeconds();
    await revokeAllForUser(user.id);
    await denySub(createRedis(), user.id, revokeCutoff);

    // Atomic: delete all existing auth_methods, insert new opaque method, update user wraps.
    const tokens = await db.transaction(async (tx) => {
      await tx.delete(authMethods).where(eq(authMethods.userId, user.id));

      await tx.insert(authMethods).values({
        userId: user.id,
        methodType: 'opaque',
        // Re-use the same OPAQUE userIdentifier (user.id) for the fresh registration.
        opaqueUserIdentifier: user.id,
        // Freeze the registration-time username so post-recovery OPAQUE
        // login and step-up keep working after a later rename (mirrors the
        // join path; without it step-up /start returns 400 no_opaque).
        opaqueClientIdentifier: body.username,
        opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
        wrappedMasterKey: Buffer.from(body.new_wrapped_mk_opaque, 'base64url'),
        wrapNonce: Buffer.from(body.new_wrap_nonce_opaque, 'base64url'),
        wrapAad: Buffer.from(body.new_wrap_aad_opaque, 'base64url'),
      });

      await tx
        .update(users)
        .set({
          recoveryVerifierKey: Buffer.from(body.new_recovery_verifier_key, 'base64url'),
          wrappedMkRecovery: Buffer.from(body.new_wrapped_mk_recovery, 'base64url'),
          wrapNonceRecovery: Buffer.from(body.new_wrap_nonce_recovery, 'base64url'),
          wrapAadRecovery: Buffer.from(body.new_wrap_aad_recovery, 'base64url'),
        })
        .where(eq(users.id, user.id));

      return issueTokens({
        userId: user.id,
        role: user.role,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });
    });

    // Fresh recovery-key evidence seeds the Tier-1 grace window (spec §4.1).
    await seedStepUpKey(tokens.sessionId, 1);

    await writeAudit({
      db,
      eventType: 'recovery_used',
      userId: user.id,
    });
    metrics.authRecoveryAttemptsTotal.inc({ result: 'success' });

    c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
    return c.json({
      user_id: user.id,
      role: user.role,
      access_token: tokens.accessToken,
      expires_in: tokens.expiresIn,
    });
  });
}

/** Concatenates multiple Uint8Array segments into one. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
