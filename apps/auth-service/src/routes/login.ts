// SPDX-License-Identifier: AGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { server as opaqueServer } from '@serenity-kit/opaque';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { and, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { seedStepUpKey } from '../auth/step-up.js';
import { createDb } from '../db/client.js';
import { authMethods, users } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { metrics } from '../metrics.js';
import { ApiError } from '../middleware/error-envelope.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';
import { createRedis } from '../redis/client.js';
import { generateAuthentication, verifyAuthentication } from '../webauthn/server.js';
import { applyLoginRateLimit } from './_rate-limit-helpers.js';

const opaqueStartReq = object({
  username: string(),
  start_login_request: string(),
});

const opaqueFinishReq = object({
  session_id: string(),
  finish_login_request: string(),
});

const passkeyStartReq = object({
  username: string(),
});

const passkeyFinishReq = object({
  session_id: string(),
  response: object({
    id: string(),
    rawId: string(),
    response: object({
      clientDataJSON: string(),
      authenticatorData: string(),
      signature: string(),
      userHandle: string(),
    }),
    authenticatorAttachment: string(),
    clientExtensionResults: object({}),
    type: string(),
  }),
});

export function registerLoginRoutes(app: Hono): void {
  /**
   * POST /api/v1/opaque/login/start
   *
   * Runs the OPAQUE server-side login-start step. Returns a `ke2` / `login_response`
   * alongside the stored wrapped_mk_opaque blobs for the client.
   *
   * Enumeration mitigation: when the username does not exist or has no OPAQUE auth method
   * the response is still a valid-shaped OPAQUE ke2 produced by passing `registrationRecord: null`
   * to opaqueServer.startLogin. @serenity-kit/opaque handles null records by returning a fake
   * deterministic response that is indistinguishable from a real one at the network layer.
   */
  app.post('/api/v1/opaque/login/start', async (c) => {
    await ensureOpaqueReady();
    const body = parse(opaqueStartReq, await c.req.json());
    await applyLoginRateLimit(body.username);

    const { db } = createDb();

    // Look up user + OPAQUE auth method together.
    const userRows = await db
      .select({
        userId: users.id,
        role: users.role,
        suspendedAt: users.suspendedAt,
        opaqueCredential: authMethods.opaqueCredential,
        opaqueUserIdentifier: authMethods.opaqueUserIdentifier,
        opaqueClientIdentifier: authMethods.opaqueClientIdentifier,
        wrappedMasterKey: authMethods.wrappedMasterKey,
        wrapNonce: authMethods.wrapNonce,
        wrapAad: authMethods.wrapAad,
      })
      .from(users)
      .leftJoin(
        authMethods,
        and(eq(authMethods.userId, users.id), eq(authMethods.methodType, 'opaque')),
      )
      .where(eq(users.username, body.username))
      .limit(1);

    const row = userRows[0];

    // Produce a response in all cases (including unknown username) to prevent enumeration.
    // Passing registrationRecord: null yields a fake-but-well-formed ke2.
    const registrationRecord = row?.opaqueCredential
      ? Buffer.from(row.opaqueCredential).toString('base64url')
      : null;

    const userIdentifier = row?.opaqueUserIdentifier ?? `fake:${body.username}`;

    // Identifiers must match the values the client baked into the registration
    // record at link time (see packages/crypto/src/opaque/client.ts:62-65):
    //   client = registration-time username (frozen on the auth_methods row
    //            as opaque_client_identifier — survives later PATCH /api/v1/me
    //            username changes)
    //   server = opaqueServerIdentity(base_url) — origin-derived, shared by
    //            client and server (packages/shared-types/opaque-identity.ts),
    //            so it agrees in dev (direct port) and prod (reverse proxy).
    // Spec §3 anti-replay binding.
    const clientIdentifier = row?.opaqueClientIdentifier ?? body.username;
    const env = loadEnv();
    const { serverLoginState, loginResponse } = opaqueServer.startLogin({
      serverSetup: getServerSetup(),
      registrationRecord,
      startLoginRequest: body.start_login_request,
      userIdentifier,
      identifiers: {
        client: clientIdentifier,
        server: opaqueServerIdentity(env.API_BASE_URL),
      },
    });

    if (!row || row.suspendedAt) {
      // User does not exist or is suspended. The client receives a fake ke2 and will fail at
      // /finish with a 401 — no information about existence is leaked here.
      const sessionId = generateSessionId();
      await storeOpaqueState({
        scope: 'login',
        sessionId,
        payload: {
          fake: 'true',
          server_login_state: serverLoginState,
        },
      });
      return c.json({
        session_id: sessionId,
        login_response: loginResponse,
        wrapped_mk_opaque: null,
        wrap_nonce_opaque: null,
        wrap_aad_opaque: null,
      });
    }

    const sessionId = generateSessionId();
    await storeOpaqueState({
      scope: 'login',
      sessionId,
      payload: {
        user_id: row.userId,
        server_login_state: serverLoginState,
      },
    });

    // wrappedMasterKey / wrapNonce / wrapAad are notNull in the schema but Drizzle types
    // left-join columns as nullable; fall back to null (treated as fake session).
    const wrappedMkOpaque = row.wrappedMasterKey
      ? Buffer.from(row.wrappedMasterKey).toString('base64url')
      : null;
    const wrapNonceOpaque = row.wrapNonce ? Buffer.from(row.wrapNonce).toString('base64url') : null;
    const wrapAadOpaque = row.wrapAad ? Buffer.from(row.wrapAad).toString('base64url') : null;

    return c.json({
      session_id: sessionId,
      login_response: loginResponse,
      wrapped_mk_opaque: wrappedMkOpaque,
      wrap_nonce_opaque: wrapNonceOpaque,
      wrap_aad_opaque: wrapAadOpaque,
    });
  });

  /**
   * POST /api/v1/opaque/login/finish
   *
   * Completes the OPAQUE login ceremony. On success issues JWT tokens. On failure emits
   * auth.login.failed and returns 401 — same response shape whether the user exists or not.
   */
  app.post('/api/v1/opaque/login/finish', async (c) => {
    await ensureOpaqueReady();
    const body = parse(opaqueFinishReq, await c.req.json());

    const state = await fetchOpaqueState('login', body.session_id);
    if (!state) throw new ApiError(410, 'expired', 'Session expired or not found');

    // Fake sessions always fail at finishLogin — the session key will not match.
    if (state.fake === 'true') {
      metrics.authLoginsTotal.inc({ method_type: 'opaque', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'Invalid username or password');
    }

    const userId = state.user_id;
    const serverLoginState = state.server_login_state;
    if (!userId || !serverLoginState) {
      throw new ApiError(410, 'expired', 'Session state is incomplete');
    }

    try {
      opaqueServer.finishLogin({
        serverLoginState,
        finishLoginRequest: body.finish_login_request,
      });
    } catch {
      metrics.authLoginsTotal.inc({ method_type: 'opaque', result: 'fail' });
      const { db } = createDb();
      await writeAudit({
        db,
        eventType: 'auth.login.failed',
        userId,
        metadata: { method_type: 'opaque', reason: 'bad_credentials' },
      });
      throw new ApiError(401, 'invalid_credentials', 'Invalid username or password');
    }

    const { db } = createDb();

    // Refresh last_login_at.
    const updatedRows = await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.suspendedAt)))
      .returning({ id: users.id, role: users.role });

    const user = updatedRows[0];
    if (!user) {
      // Suspended between start and finish — still 401.
      metrics.authLoginsTotal.inc({ method_type: 'opaque', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'Invalid username or password');
    }

    const tokens = await issueTokens({
      userId: user.id,
      role: user.role,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });

    // Fresh OPAQUE evidence seeds the Tier-1 grace window (spec §4.1).
    await seedStepUpKey(tokens.sessionId, 1);

    await writeAudit({
      db,
      eventType: 'auth.login.success',
      userId: user.id,
      metadata: { method_type: 'opaque' },
    });

    metrics.authLoginsTotal.inc({ method_type: 'opaque', result: 'success' });

    c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
    return c.json({
      user_id: user.id,
      role: user.role,
      access_token: tokens.accessToken,
      expires_in: tokens.expiresIn,
    });
  });

  /**
   * POST /api/v1/passkey/login/start
   *
   * Generates WebAuthn authentication options bound to the user's registered passkey
   * credential IDs, stores the challenge in Redis, and returns the options.
   *
   * Requires a username so we can restrict allowCredentials to the user's own passkeys.
   * Discoverable-credential (username-free) login is a phase-1 concern.
   */
  app.post('/api/v1/passkey/login/start', async (c) => {
    const body = parse(passkeyStartReq, await c.req.json());
    await applyLoginRateLimit(body.username);

    const { db } = createDb();

    const userRows = await db
      .select({ id: users.id, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1);

    const user = userRows[0];
    if (!user || user.suspendedAt) {
      // Return a valid-looking challenge even when the user does not exist.
      // The client will fail at /finish — no existence information leaked.
      const options = await generateAuthentication({ allowCredentialIds: [] });
      const sessionId = generateSessionId();
      const redis = createRedis();
      await redis.set(
        `webauthn:auth:${sessionId}`,
        JSON.stringify({ challenge: options.challenge, fake: true }),
        'EX',
        120,
      );
      return c.json({ session_id: sessionId, options });
    }

    const passkeyRows = await db
      .select({
        credentialId: authMethods.passkeyCredentialId,
      })
      .from(authMethods)
      .where(and(eq(authMethods.userId, user.id), eq(authMethods.methodType, 'passkey')));

    const credentialIds = passkeyRows
      .filter((r): r is typeof r & { credentialId: Uint8Array } => r.credentialId != null)
      .map((r) => Buffer.from(r.credentialId).toString('base64url'));

    const options = await generateAuthentication({ allowCredentialIds: credentialIds });

    const sessionId = generateSessionId();
    const redis = createRedis();
    await redis.set(
      `webauthn:auth:${sessionId}`,
      JSON.stringify({ challenge: options.challenge, userId: user.id }),
      'EX',
      120,
    );

    return c.json({ session_id: sessionId, options });
  });

  /**
   * POST /api/v1/passkey/login/finish
   *
   * Verifies the WebAuthn authentication assertion. On success:
   *  - updates the sign counter on the auth_method row
   *  - issues JWT tokens
   *  - returns access_token + the wrapped_mk_passkey blobs for client-side key unwrapping
   */
  app.post('/api/v1/passkey/login/finish', async (c) => {
    const body = parse(passkeyFinishReq, await c.req.json());

    const redis = createRedis();
    const stateRaw = await redis.get(`webauthn:auth:${body.session_id}`);
    if (!stateRaw) throw new ApiError(410, 'expired', 'Session expired or not found');
    await redis.del(`webauthn:auth:${body.session_id}`);

    const state = JSON.parse(stateRaw) as { challenge: string; userId?: string; fake?: boolean };

    if (state.fake) {
      metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'Invalid credentials');
    }

    const { db } = createDb();

    // Look up the passkey row by credential ID (base64url from the response).
    const credentialIdBytes = Buffer.from(body.response.id, 'base64url');
    const passkeyRows = await db
      .select({
        id: authMethods.id,
        userId: authMethods.userId,
        passkeyPublicKey: authMethods.passkeyPublicKey,
        passkeySignCount: authMethods.passkeySignCount,
        wrappedMasterKey: authMethods.wrappedMasterKey,
        wrapNonce: authMethods.wrapNonce,
        wrapAad: authMethods.wrapAad,
      })
      .from(authMethods)
      .where(
        and(
          eq(authMethods.methodType, 'passkey'),
          eq(authMethods.passkeyCredentialId, credentialIdBytes),
        ),
      )
      .limit(1);

    const pk = passkeyRows[0];
    if (!pk || !pk.passkeyPublicKey) {
      metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'Credential not found');
    }

    // Verify the credential belongs to the expected user (from session state).
    if (pk.userId !== state.userId) {
      metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'Credential mismatch');
    }

    let verification: Awaited<ReturnType<typeof verifyAuthentication>>;
    try {
      verification = await verifyAuthentication({
        response: body.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: state.challenge,
        publicKey: pk.passkeyPublicKey,
        signCount: pk.passkeySignCount ?? 0,
      });
    } catch {
      metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'fail' });
      const failAuditDb = createDb().db;
      await writeAudit({
        db: failAuditDb,
        eventType: 'auth.login.failed',
        userId: pk.userId,
        metadata: { method_type: 'passkey', reason: 'bad_credentials' },
      });
      throw new ApiError(401, 'invalid_credentials', 'Invalid passkey assertion');
    }

    if (!verification.verified) {
      metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'Passkey verification failed');
    }

    const { newCounter } = verification.authenticationInfo;

    // Update sign counter + last_used_at.
    await db
      .update(authMethods)
      .set({ passkeySignCount: newCounter, lastUsedAt: new Date() })
      .where(eq(authMethods.id, pk.id));

    const userRows = await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(and(eq(users.id, pk.userId), isNull(users.suspendedAt)))
      .returning({ id: users.id, role: users.role });

    const user = userRows[0];
    if (!user) {
      metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(401, 'invalid_credentials', 'User not found or suspended');
    }

    const tokens = await issueTokens({
      userId: user.id,
      role: user.role,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });

    await writeAudit({
      db,
      eventType: 'auth.login.success',
      userId: user.id,
      metadata: { method_type: 'passkey' },
    });

    metrics.authLoginsTotal.inc({ method_type: 'passkey', result: 'success' });

    c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
    return c.json({
      user_id: user.id,
      role: user.role,
      access_token: tokens.accessToken,
      expires_in: tokens.expiresIn,
      wrapped_mk_passkey: Buffer.from(pk.wrappedMasterKey).toString('base64url'),
      wrap_nonce_passkey: Buffer.from(pk.wrapNonce).toString('base64url'),
      wrap_aad_passkey: Buffer.from(pk.wrapAad).toString('base64url'),
    });
  });
}
