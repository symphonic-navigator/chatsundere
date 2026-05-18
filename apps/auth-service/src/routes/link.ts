// SPDX-License-Identifier: AGPL-3.0-only

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { server as opaqueServer } from '@serenity-kit/opaque';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { authMethods, invitations, users } from '../db/schema.js';
import { consumeInvitationAttempt } from '../invitations/rate-limit.js';
import { hashInvitationToken } from '../invitations/token.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { metrics } from '../metrics.js';
import { bearerAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-envelope.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';
import { createRedis } from '../redis/client.js';
import {
  generateAuthentication,
  generateRegistration,
  verifyRegistration,
} from '../webauthn/server.js';

const startReq = object({
  invitation_token: string(),
  registration_request: string(),
});

const finishReq = object({
  session_id: string(),
  username: string(),
  registration_record: string(),
  wrapped_mk_opaque: string(),
  wrap_nonce_opaque: string(),
  wrap_aad_opaque: string(),
  wrapped_mk_recovery: string(),
  wrap_nonce_recovery: string(),
  wrap_aad_recovery: string(),
  recovery_verifier_key: string(),
});

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

export function registerLinkRoutes(app: Hono): void {
  /**
   * POST /v1/link/opaque/start
   *
   * Validates the invitation token, increments its attempt counter, and runs the
   * OPAQUE registration-response step. Returns a session_id (stored in Redis for
   * 60 s) and the registration_response for the client.
   *
   * OPAQUE identifier choice: we use invitation.id as the userIdentifier at this
   * stage because the user has not yet chosen a username. The same identifier is
   * stored in Redis state and reused at /finish. It is also persisted on the
   * auth_methods row so that the login flow (Task 10) can look it up.
   */
  app.post('/v1/link/opaque/start', async (c) => {
    await ensureOpaqueReady();
    const body = parse(startReq, await c.req.json());
    const tokenHmac = await hashInvitationToken(body.invitation_token);
    const invitation = await consumeInvitationAttempt(tokenHmac);

    const sessionId = generateSessionId();

    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: invitation.id,
      registrationRequest: body.registration_request,
    });

    await storeOpaqueState({
      scope: 'register',
      sessionId,
      payload: {
        invitation_id: invitation.id,
        invitation_role: invitation.role,
        // Persisted so /finish can write it to auth_methods without re-deriving.
        opaque_user_identifier: invitation.id,
      },
    });

    return c.json({ session_id: sessionId, registration_response: registrationResponse });
  });

  /**
   * POST /v1/link/opaque/finish
   *
   * Completes user registration: validates the session, inserts the user and
   * auth_method rows in a single transaction, marks the invitation as redeemed,
   * and issues JWT tokens.
   *
   * The registration_record is stored as-is — it was produced by the client
   * using the registrationResponse from /start, which was bound to invitation.id.
   * The opaque_user_identifier column on auth_methods records that binding so
   * that the login flow can use the same identifier.
   */
  app.post('/v1/link/opaque/finish', async (c) => {
    await ensureOpaqueReady();
    const body = parse(finishReq, await c.req.json());

    if (!USERNAME_RE.test(body.username) || RESERVED.has(body.username)) {
      throw new ApiError(400, 'invalid_input', 'Invalid username');
    }

    const state = await fetchOpaqueState('register', body.session_id);
    if (!state) throw new ApiError(410, 'expired', 'Session expired');

    const invitationId = state.invitation_id;
    const invitationRole = state.invitation_role;
    const opaqueUserIdentifier = state.opaque_user_identifier;
    if (!invitationId || !invitationRole || !opaqueUserIdentifier) {
      throw new ApiError(410, 'expired', 'Session state is incomplete');
    }

    const { db } = createDb();

    try {
      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            username: body.username,
            role: invitationRole as 'primary_admin' | 'admin' | 'user',
            recoveryVerifierKey: Buffer.from(body.recovery_verifier_key, 'base64url'),
            wrappedMkRecovery: Buffer.from(body.wrapped_mk_recovery, 'base64url'),
            wrapNonceRecovery: Buffer.from(body.wrap_nonce_recovery, 'base64url'),
            wrapAadRecovery: Buffer.from(body.wrap_aad_recovery, 'base64url'),
          })
          .returning({ id: users.id, role: users.role });
        // The insert always returns exactly one row; the undefined guard satisfies the linter.
        const user = inserted[0];
        if (!user) throw new Error('User insert returned no row');

        await tx.insert(authMethods).values({
          userId: user.id,
          methodType: 'opaque',
          opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
          opaqueUserIdentifier,
          wrappedMasterKey: Buffer.from(body.wrapped_mk_opaque, 'base64url'),
          wrapNonce: Buffer.from(body.wrap_nonce_opaque, 'base64url'),
          wrapAad: Buffer.from(body.wrap_aad_opaque, 'base64url'),
        });

        await tx
          .update(invitations)
          .set({ redeemedAt: new Date(), redeemedByUserId: user.id })
          .where(eq(invitations.id, invitationId));

        return user;
      });

      const tokens = await issueTokens({
        userId: result.id,
        role: result.role,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });

      await writeAudit({
        db,
        eventType: 'user.linked',
        userId: result.id,
        metadata: { role: result.role, invitation_id: invitationId },
      });
      await writeAudit({
        db,
        eventType: 'invitation.redeemed',
        userId: result.id,
        metadata: { invitation_id: invitationId, role: result.role },
      });

      // Clean up bootstrap file if this was a primary_admin bootstrap invitation.
      if (invitationRole === 'primary_admin') {
        const dir = process.env.XDG_RUNTIME_DIR ?? '/tmp';
        const bootstrapFilePath = join(dir, `chatsundere-bootstrap-${invitationId}.json`);
        try {
          unlinkSync(bootstrapFilePath);
        } catch {
          // File may not exist if cleaned up out of band; silently ignore.
        }
      }

      metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'success' });
      metrics.authInvitationsRedeemedTotal.inc({ role: result.role });

      c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
      return c.json({
        user_id: result.id,
        role: result.role,
        access_token: tokens.accessToken,
        expires_in: tokens.expiresIn,
      });
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'conflict' });
        throw new ApiError(409, 'username_taken', 'Username already exists');
      }
      metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'error' });
      throw err;
    }
  });

  /**
   * POST /v1/link/passkey/start
   *
   * Bearer-authorised only (add-passkey post-link). First-link via passkey is out of scope for
   * phase 0: the user must first link via OPAQUE, then call this endpoint with a valid access
   * token to register an additional passkey. Attempting this endpoint with an invitation token
   * is rejected with 400.
   *
   * Generates WebAuthn registration options (with PRF extension per ADR 0005), stores the
   * challenge in Redis keyed by a fresh session_id, and returns options for the client to pass
   * to navigator.credentials.create().
   */
  app.post('/v1/link/passkey/start', bearerAuth(), async (c) => {
    const claims = c.get('claims');
    const { db } = createDb();

    // Verify the user has an existing OPAQUE auth method (not a fresh account trying to skip it).
    const existingOpaque = await db
      .select({ id: authMethods.id })
      .from(authMethods)
      .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'opaque')))
      .limit(1);
    if (existingOpaque.length === 0) {
      throw new ApiError(400, 'invalid_state', 'Must link via OPAQUE before adding a passkey');
    }

    const userRows = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const user = userRows[0];
    if (!user) throw new ApiError(404, 'not_found', 'User not found');

    const options = await generateRegistration({
      userId: claims.sub,
      username: user.username,
    });

    const sessionId = generateSessionId();
    const redis = createRedis();
    await redis.set(
      `webauthn:register:${sessionId}`,
      JSON.stringify({ challenge: options.challenge, userId: claims.sub }),
      'EX',
      120,
    );

    return c.json({ session_id: sessionId, options });
  });

  /**
   * POST /v1/link/passkey/finish
   *
   * Bearer-authorised. Verifies the WebAuthn registration response, stores the new passkey
   * auth_method row (with wrapped_mk_passkey for client-side key unwrapping), and emits
   * auth_method.added audit event.
   *
   * Phase-0 constraint: passkey-first linking is not supported. This endpoint only adds
   * a passkey to an account that already has OPAQUE linked.
   */
  app.post('/v1/link/passkey/finish', bearerAuth(), async (c) => {
    const claims = c.get('claims');

    const passkeyFinishReq = object({
      session_id: string(),
      response: object({
        id: string(),
        rawId: string(),
        response: object({
          clientDataJSON: string(),
          attestationObject: string(),
          authenticatorData: string(),
          transports: string(),
        }),
        authenticatorAttachment: string(),
        clientExtensionResults: object({}),
        type: string(),
      }),
      wrapped_mk_passkey: string(),
      wrap_nonce_passkey: string(),
      wrap_aad_passkey: string(),
      label: string(),
    });

    const body = parse(passkeyFinishReq, await c.req.json());

    const redis = createRedis();
    const stateRaw = await redis.get(`webauthn:register:${body.session_id}`);
    if (!stateRaw) throw new ApiError(410, 'expired', 'Session expired or not found');
    await redis.del(`webauthn:register:${body.session_id}`);

    const state = JSON.parse(stateRaw) as { challenge: string; userId: string };
    if (state.userId !== claims.sub) {
      throw new ApiError(403, 'forbidden', 'Session does not belong to this user');
    }

    // The client sends the RegistrationResponseJSON; cast via unknown to satisfy strict types.
    const verification = await verifyRegistration({
      response: body.response as unknown as RegistrationResponseJSON,
      expectedChallenge: state.challenge,
    });

    if (!verification.verified || !verification.registrationInfo) {
      metrics.authLinksTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(400, 'verification_failed', 'Passkey registration verification failed');
    }

    // Enforce ADR-0005: the passkey must support the PRF extension.
    // clientExtensionResults.prf is not yet in the @simplewebauthn/types DOM typings
    // (v11), so we read it via a cast. A supported PRF authenticator reports
    // { prf: { enabled: true } } in the registration response.
    const extensions = body.response.clientExtensionResults as Record<string, unknown>;
    const prfResult = extensions.prf as { enabled?: boolean } | undefined;
    if (!prfResult?.enabled) {
      metrics.authLinksTotal.inc({ method_type: 'passkey', result: 'fail' });
      throw new ApiError(400, 'invalid_input', 'Passkey must support the PRF extension (ADR-0005)');
    }

    const { credential, aaguid } = verification.registrationInfo;

    const { db } = createDb();
    await db.insert(authMethods).values({
      userId: claims.sub,
      methodType: 'passkey',
      label: body.label,
      passkeyCredentialId: Buffer.from(credential.id, 'base64url'),
      passkeyPublicKey: credential.publicKey,
      passkeySignCount: credential.counter,
      passkeyAaguid: aaguid,
      wrappedMasterKey: Buffer.from(body.wrapped_mk_passkey, 'base64url'),
      wrapNonce: Buffer.from(body.wrap_nonce_passkey, 'base64url'),
      wrapAad: Buffer.from(body.wrap_aad_passkey, 'base64url'),
    });

    await writeAudit({
      db,
      eventType: 'auth_method.added',
      userId: claims.sub,
      metadata: { method_type: 'passkey', label: body.label },
    });

    metrics.authLinksTotal.inc({ method_type: 'passkey', result: 'success' });

    return c.json({ ok: true });
  });
}
