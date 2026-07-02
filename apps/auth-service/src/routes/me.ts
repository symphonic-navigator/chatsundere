// SPDX-License-Identifier: AGPL-3.0-only

import { server as opaqueServer } from '@serenity-kit/opaque';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, pipe, regex, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { denySub, nowSeconds } from '../auth/deny-list.js';
import { requireStepUp } from '../auth/step-up.js';
import { createDb } from '../db/client.js';
import { authMethods, pendingCodes, users } from '../db/schema.js';
import type { AccessClaims } from '../jwt/verify.js';
import { bearerAuth, invalidateUserExistsCache } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-envelope.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';
import { createRedis } from '../redis/client.js';

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

const patchMeReq = object({
  username: pipe(string(), regex(USERNAME_RE, 'Invalid username')),
});

const passphraseChangeStartReq = object({
  registration_request: string(),
});

const passphraseChangeFinishReq = object({
  session_id: string(),
  registration_record: string(),
  wrapped_mk_opaque: string(),
  wrap_nonce_opaque: string(),
  wrap_aad_opaque: string(),
});

export function registerMeRoutes(app: Hono): void {
  /**
   * GET /api/v1/me
   *
   * Returns the authenticated user's profile and their list of auth methods.
   */
  app.get('/api/v1/me', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const { db } = createDb();
    const user = (await db.select().from(users).where(eq(users.id, claims.sub)).limit(1))[0];
    if (!user) throw new ApiError(401, 'unauthorized', 'User gone');
    const methods = await db.select().from(authMethods).where(eq(authMethods.userId, user.id));
    return c.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        created_at: user.createdAt.toISOString(),
        storage_quota_bytes: user.storageQuotaBytes,
      },
      auth_methods: methods.map((m) => ({
        id: m.id,
        method_type: m.methodType,
        label: m.label,
        created_at: m.createdAt.toISOString(),
        last_used_at: m.lastUsedAt?.toISOString() ?? null,
      })),
    });
  });

  /**
   * PATCH /api/v1/me
   *
   * Allows the authenticated user to rename themselves. Returns 409 if the
   * desired username is already taken (PostgreSQL unique constraint 23505).
   */
  app.patch('/api/v1/me', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const body = parse(patchMeReq, await c.req.json());
    if (RESERVED.has(body.username)) {
      throw new ApiError(400, 'invalid_input', 'Username is reserved');
    }
    const { db } = createDb();
    try {
      await db.update(users).set({ username: body.username }).where(eq(users.id, claims.sub));
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        throw new ApiError(409, 'username_taken', 'Username already exists');
      }
      throw err;
    }
    await writeAudit({
      db,
      eventType: 'user.username_changed',
      userId: claims.sub,
      actorUserId: claims.sub,
    });
    return c.json({ ok: true });
  });

  /**
   * DELETE /api/v1/me
   *
   * Self-deletes the authenticated user. The FK cascade on auth_methods.user_id
   * and refresh_tokens.user_id removes all associated rows automatically.
   */
  app.delete('/api/v1/me', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionId = c.get('sessionId') as string;
    await requireStepUp({ sessionId, tier: 3 });
    const { db } = createDb();
    await db.transaction(async (tx) => {
      // pending_codes.redeemed_by_user_id has no ON DELETE CASCADE, so NULL it out first.
      await tx
        .update(pendingCodes)
        .set({ redeemedByUserId: null })
        .where(eq(pendingCodes.redeemedByUserId, claims.sub));
      await tx.delete(users).where(eq(users.id, claims.sub));
    });
    // Deny every current access token for the deleted account (spec §9).
    await denySub(createRedis(), claims.sub, nowSeconds());
    await invalidateUserExistsCache(claims.sub);
    await writeAudit({
      db,
      eventType: 'user.self_deleted',
      userId: claims.sub,
      actorUserId: claims.sub,
    });
    c.header(
      'Set-Cookie',
      'refresh_token=; HttpOnly; SameSite=Lax; Path=/api/v1/token/refresh; Max-Age=0',
    );
    return c.json({ ok: true });
  });

  /**
   * DELETE /api/v1/auth-methods/:id
   *
   * Removes one auth method. Rejects with 409 if this would leave the user with
   * zero auth methods unless the caller passes `?confirm_lockout=true`.
   */
  app.delete('/api/v1/auth-methods/:id', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionId = c.get('sessionId') as string;
    await requireStepUp({ sessionId, tier: 1 });
    const id = c.req.param('id');
    const confirm = c.req.query('confirm_lockout') === 'true';
    const { db } = createDb();
    const all = await db.select().from(authMethods).where(eq(authMethods.userId, claims.sub));
    const target = all.find((m) => m.id === id);
    if (!target) throw new ApiError(404, 'not_found', 'Auth method not found');
    const remainingAfterRemoval = all.filter((m) => m.id !== id).length;
    if (remainingAfterRemoval === 0 && !confirm) {
      throw new ApiError(
        409,
        'conflict',
        'Removing this would lock you out; pass confirm_lockout=true to override',
      );
    }
    await db.delete(authMethods).where(eq(authMethods.id, id));
    await writeAudit({
      db,
      eventType: 'auth_method.removed',
      userId: claims.sub,
      actorUserId: claims.sub,
      metadata: { method_type: target.methodType, label: target.label ?? undefined },
    });
    return c.json({ ok: true });
  });

  /**
   * POST /api/v1/auth-methods/passphrase/change/start
   *
   * Begins an OPAQUE re-registration for a passphrase change. Stores a short-lived
   * session in Redis. The existing opaque_user_identifier is reused so that the
   * updated credential remains consistent with the original login binding.
   */
  app.post('/api/v1/auth-methods/passphrase/change/start', bearerAuth(), async (c) => {
    await ensureOpaqueReady();
    const claims = c.get('claims') as AccessClaims;
    // Tier 1 step-up: this begins re-registration of the passphrase credential.
    await requireStepUp({ sessionId: c.get('sessionId') as string, tier: 1 });
    const body = parse(passphraseChangeStartReq, await c.req.json());
    const { db } = createDb();

    // Fetch the existing OPAQUE auth method to preserve its opaque_user_identifier.
    const existing = (
      await db
        .select({ opaqueUserIdentifier: authMethods.opaqueUserIdentifier })
        .from(authMethods)
        .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'opaque')))
        .limit(1)
    )[0];
    if (!existing) {
      throw new ApiError(409, 'invalid_state', 'No passphrase auth method found');
    }
    // Fall back to user.id if the identifier was somehow not persisted (shouldn't happen).
    const opaqueUserIdentifier = existing.opaqueUserIdentifier ?? claims.sub;

    const sessionId = generateSessionId();
    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: opaqueUserIdentifier,
      registrationRequest: body.registration_request,
    });

    await storeOpaqueState({
      scope: 'register',
      sessionId,
      payload: {
        user_id: claims.sub,
        opaque_user_identifier: opaqueUserIdentifier,
      },
    });

    return c.json({ session_id: sessionId, registration_response: registrationResponse });
  });

  /**
   * POST /api/v1/auth-methods/passphrase/change/finish
   *
   * Completes the passphrase change: updates the OPAQUE credential and wrapped
   * master-key blobs on the existing opaque auth_method row.
   */
  app.post('/api/v1/auth-methods/passphrase/change/finish', bearerAuth(), async (c) => {
    await ensureOpaqueReady();
    const claims = c.get('claims') as AccessClaims;
    const body = parse(passphraseChangeFinishReq, await c.req.json());
    const state = await fetchOpaqueState('register', body.session_id);
    if (!state || state.user_id !== claims.sub) {
      throw new ApiError(410, 'expired', 'Session expired or does not belong to this user');
    }
    const { db } = createDb();
    await db.transaction(async (tx) => {
      await tx
        .update(authMethods)
        .set({
          opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
          wrappedMasterKey: Buffer.from(body.wrapped_mk_opaque, 'base64url'),
          wrapNonce: Buffer.from(body.wrap_nonce_opaque, 'base64url'),
          wrapAad: Buffer.from(body.wrap_aad_opaque, 'base64url'),
        })
        .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'opaque')));
    });
    await writeAudit({
      db,
      eventType: 'auth_method.passphrase_changed',
      userId: claims.sub,
      actorUserId: claims.sub,
    });
    return c.json({ ok: true });
  });
}
