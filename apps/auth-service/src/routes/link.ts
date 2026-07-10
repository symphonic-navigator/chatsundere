// SPDX-License-Identifier: AGPL-3.0-only

import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { looseObject, object, parse, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { requireStepUp } from '../auth/step-up.js';
import { createDb } from '../db/client.js';
import { authMethods, users } from '../db/schema.js';
import { metrics } from '../metrics.js';
import { bearerAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-envelope.js';
import { generateSessionId } from '../opaque/server.js';
import { createRedis } from '../redis/client.js';
import { generateRegistration, verifyRegistration } from '../webauthn/server.js';

/**
 * Post-link passkey enrolment endpoints. The original /v1/link/opaque/*
 * pair has been absorbed into POST /api/v1/join/{start,finish} per ADR
 * 0028 — these endpoints remain because they manage post-login passkey
 * registration (PRF-bound, per ADR 0005), which is structurally
 * unrelated to the unified join flow.
 */
export function registerLinkRoutes(app: Hono): void {
  /**
   * POST /api/v1/link/passkey/start
   *
   * Bearer-authorised only (add-passkey post-link). First-link via passkey is out of scope for
   * phase 0: the user must first link via OPAQUE, then call this endpoint with a valid access
   * token to register an additional passkey.
   *
   * Generates WebAuthn registration options (with PRF extension per ADR 0005), stores the
   * challenge in Redis keyed by a fresh session_id, and returns options for the client to pass
   * to navigator.credentials.create().
   */
  app.post('/api/v1/link/passkey/start', bearerAuth(), async (c) => {
    const claims = c.get('claims');
    // Tier 1 step-up: adding a passkey mutates the account's auth methods.
    await requireStepUp({ sessionId: c.get('sessionId') as string, tier: 1 });
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
   * POST /api/v1/link/passkey/finish
   *
   * Bearer-authorised. Verifies the WebAuthn registration response, stores the new passkey
   * auth_method row (with wrapped_mk_passkey for client-side key unwrapping), and emits
   * auth_method.added audit event.
   *
   * Phase-0 constraint: passkey-first linking is not supported. This endpoint only adds
   * a passkey to an account that already has OPAQUE linked.
   */
  app.post('/api/v1/link/passkey/finish', bearerAuth(), async (c) => {
    const claims = c.get('claims');

    // The `credential` is a WebAuthn RegistrationResponseJSON. We validate only
    // the fields SimpleWebAuthn's verifyRegistration needs (and the wraps), and
    // use `looseObject` so optional/extension fields — crucially
    // `clientExtensionResults.prf`, read below for the ADR-0005 PRF check, plus
    // `transports` and `authenticatorAttachment` — pass through untouched rather
    // than being stripped. A stricter object() dropped `prf` and demanded a
    // `response`/`authenticatorData`/string-`transports` shape a real
    // registration response never has, so every enrolment 400'd (contract drift
    // vs shared-types LinkPasskeyFinishRequest.credential).
    const passkeyFinishReq = object({
      session_id: string(),
      credential: looseObject({
        id: string(),
        rawId: string(),
        type: string(),
        response: looseObject({
          clientDataJSON: string(),
          attestationObject: string(),
        }),
        clientExtensionResults: looseObject({}),
      }),
      wrapped_mk_passkey: string(),
      wrap_nonce_passkey: string(),
      wrap_aad_passkey: string(),
      label: string(),
    });

    const body = parse(passkeyFinishReq, await c.req.json());

    const redis = createRedis();
    // GETDEL is atomic — single-use round state, no race window for two
    // concurrent /finish calls to both pass the existence check before the
    // delete lands (Finding #9 scope extension; see step-up.ts:227).
    const stateRaw = await redis.getdel(`webauthn:register:${body.session_id}`);
    if (!stateRaw) throw new ApiError(410, 'expired', 'Session expired or not found');

    const state = JSON.parse(stateRaw) as { challenge: string; userId: string };
    if (state.userId !== claims.sub) {
      throw new ApiError(403, 'forbidden', 'Session does not belong to this user');
    }

    // The client sends the RegistrationResponseJSON; cast via unknown to satisfy strict types.
    const verification = await verifyRegistration({
      response: body.credential as unknown as RegistrationResponseJSON,
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
    const extensions = body.credential.clientExtensionResults as Record<string, unknown>;
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
