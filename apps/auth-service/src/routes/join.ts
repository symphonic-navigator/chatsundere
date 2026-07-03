// SPDX-License-Identifier: AGPL-3.0-only

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { server as opaqueServer } from '@serenity-kit/opaque';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { object, optional, parse, picklist, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { seedStepUpKey } from '../auth/step-up.js';
import { assertOpaqueWrappingPresent } from '../auth/wrapping-integrity.js';
import { consumePendingCodeAttempt } from '../codes/rate-limit.js';
import { hashCode, isValidCodeFormat } from '../codes/token.js';
import { createDb } from '../db/client.js';
import { authMethods, pendingCodes, users } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { metrics } from '../metrics.js';
import { ApiError } from '../middleware/error-envelope.js';
import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';

/**
 * Unified two-round join flow per ADR 0028 — the absorbed replacement for
 * /v1/link/opaque/{start,finish}. `kind: 'invitation'` registers a brand-new
 * user against an admin-issued invitation; `kind: 'pairing'` adds a new
 * device to an existing user's account against a user-issued pairing code.
 *
 * The two branches share session-state plumbing, code redemption, rate
 * limiting, and Redis lifecycle; the OPAQUE primitive differs (creating a
 * registration response vs starting a login round).
 */

const startReq = object({
  kind: picklist(['invitation', 'pairing']),
  code: string(),
  // kind=invitation: client's OPAQUE registration_request
  registration_request: optional(string()),
  // kind=pairing: client's OPAQUE start_login_request
  login_request: optional(string()),
});

// Per-IP rate limits per spec §6: 10/min + 100/hour on /start, 10/min on
// /finish. The per-code attempt cap in consumePendingCodeAttempt protects
// against guessing one specific code; these limits cap brute-force code
// grinding across many random codes, which the per-code cap cannot reach.
const joinIpRateLimitMinute = rateLimit({
  bucket: 'join_ip_minute',
  windowSec: 60,
  max: 10,
  key: (c) => ipKey(c),
});
const joinIpRateLimitHour = rateLimit({
  bucket: 'join_ip_hour',
  windowSec: 60 * 60,
  max: 100,
  key: (c) => ipKey(c),
});

export function registerJoinRoutes(app: Hono): void {
  app.post('/api/v1/join/start', joinIpRateLimitMinute, joinIpRateLimitHour, async (c) => {
    await ensureOpaqueReady();
    const body = parse(startReq, await c.req.json());

    // Lightweight format guard before any DB lookup — keeps invalid input
    // from spending rate-limit budget on the consume path.
    if (!isValidCodeFormat(body.code)) {
      throw new ApiError(
        400,
        'invalid_code_format',
        'Code does not match the expected AAAAA-BBBBB format',
      );
    }

    const codeHmac = await hashCode(body.code);
    // Pass body.kind so a wrong-kind submission short-circuits before the
    // attempt counter is bumped (Larissa β M1).
    const row = await consumePendingCodeAttempt(codeHmac, body.kind);

    const sessionId = generateSessionId();

    if (body.kind === 'invitation') {
      if (!body.registration_request) {
        throw new ApiError(
          400,
          'invalid_input',
          'registration_request is required for kind=invitation',
        );
      }
      if (!row.role) {
        // Defence in depth: invitation rows must carry a role. NULL role
        // would slip through to /finish and corrupt the user-insert path.
        throw new ApiError(500, 'internal', 'Invitation row has no role assigned');
      }

      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup: getServerSetup(),
        userIdentifier: row.id,
        registrationRequest: body.registration_request,
      });

      await storeOpaqueState({
        scope: 'register',
        sessionId,
        payload: {
          kind: 'invitation',
          pending_code_id: row.id,
          invitation_role: row.role,
          opaque_user_identifier: row.id,
        },
      });

      return c.json({
        kind: 'invitation' as const,
        session_id: sessionId,
        registration_response: registrationResponse,
        suggested_username: row.suggestedUsername,
      });
    }

    // kind === 'pairing'
    if (!body.login_request) {
      throw new ApiError(400, 'invalid_input', 'login_request is required for kind=pairing');
    }
    if (!row.createdBy) {
      // Pairing rows always carry created_by per the schema; this guard
      // exists for the case where created_by is somehow NULL.
      throw new ApiError(500, 'internal', 'Pairing code has no owning user');
    }

    const { db } = createDb();
    const ownerRows = await db
      .select({
        userId: users.id,
        username: users.username,
        opaqueCredential: authMethods.opaqueCredential,
        opaqueUserIdentifier: authMethods.opaqueUserIdentifier,
        // The client identifier sealed into the OPAQUE registration record
        // at link time — must be presented again here, not the live username
        // (which a username change would have desynchronised, see Larissa H1).
        opaqueClientIdentifier: authMethods.opaqueClientIdentifier,
      })
      .from(users)
      .leftJoin(
        authMethods,
        and(eq(authMethods.userId, users.id), eq(authMethods.methodType, 'opaque')),
      )
      .where(eq(users.id, row.createdBy))
      .limit(1);

    const owner = ownerRows[0];
    if (
      !owner ||
      !owner.opaqueCredential ||
      !owner.opaqueUserIdentifier ||
      !owner.opaqueClientIdentifier
    ) {
      // The wrapping/identity invariant (ADR 0021) is what guarantees this
      // never happens; explicit assertion check happens at /finish via
      // assertOpaqueWrappingPresent in Task 11.
      throw new ApiError(
        500,
        'wrapping_invariant_violated',
        'Pairing code owner missing OPAQUE auth method',
      );
    }

    const env = loadEnv();
    const { serverLoginState, loginResponse } = opaqueServer.startLogin({
      serverSetup: getServerSetup(),
      registrationRecord: Buffer.from(owner.opaqueCredential).toString('base64url'),
      startLoginRequest: body.login_request,
      userIdentifier: owner.opaqueUserIdentifier,
      identifiers: {
        client: owner.opaqueClientIdentifier,
        server: opaqueServerIdentity(env.API_BASE_URL),
      },
    });

    await storeOpaqueState({
      scope: 'join-pairing',
      sessionId,
      payload: {
        kind: 'pairing',
        pending_code_id: row.id,
        user_id: owner.userId,
        username: owner.username,
        server_login_state: serverLoginState,
      },
    });

    return c.json({
      kind: 'pairing' as const,
      session_id: sessionId,
      login_response: loginResponse,
      username: owner.username,
    });
  });

  app.post('/api/v1/join/finish', joinIpRateLimitMinute, async (c) => {
    await ensureOpaqueReady();
    const body = parse(finishReq, await c.req.json());

    if (body.kind === 'invitation') {
      return finishInvitation(c, body);
    }
    return finishPairing(c, body);
  });
}

const finishReq = object({
  kind: picklist(['invitation', 'pairing']),
  session_id: string(),
  // kind=invitation
  username: optional(string()),
  registration_record: optional(string()),
  wrapped_mk_opaque: optional(string()),
  wrap_nonce_opaque: optional(string()),
  wrap_aad_opaque: optional(string()),
  wrapped_mk_recovery: optional(string()),
  wrap_nonce_recovery: optional(string()),
  wrap_aad_recovery: optional(string()),
  recovery_verifier_key: optional(string()),
  // kind=pairing
  login_evidence: optional(string()),
});

type FinishBody = {
  kind: 'invitation' | 'pairing';
  session_id: string;
  username?: string;
  registration_record?: string;
  wrapped_mk_opaque?: string;
  wrap_nonce_opaque?: string;
  wrap_aad_opaque?: string;
  wrapped_mk_recovery?: string;
  wrap_nonce_recovery?: string;
  wrap_aad_recovery?: string;
  recovery_verifier_key?: string;
  login_evidence?: string;
};

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

async function finishInvitation(c: Context, body: FinishBody): Promise<Response> {
  // Invitation finish mirrors /v1/link/opaque/finish (the route this
  // endpoint absorbs per ADR 0028). Behaviour is identical apart from
  // the new is_new_account: true field and the audit/metrics labels.
  // Extract + narrow the invitation-finish fields. TypeScript does not
  // carry the truthy-narrow across function boundaries when these are
  // dereferenced later (inside Buffer.from etc), so explicitly bind.
  const username = body.username;
  const registrationRecord = body.registration_record;
  const wrappedMkOpaque = body.wrapped_mk_opaque;
  const wrapNonceOpaque = body.wrap_nonce_opaque;
  const wrapAadOpaque = body.wrap_aad_opaque;
  const wrappedMkRecovery = body.wrapped_mk_recovery;
  const wrapNonceRecovery = body.wrap_nonce_recovery;
  const wrapAadRecovery = body.wrap_aad_recovery;
  const recoveryVerifierKey = body.recovery_verifier_key;
  if (
    !username ||
    !registrationRecord ||
    !wrappedMkOpaque ||
    !wrapNonceOpaque ||
    !wrapAadOpaque ||
    !wrappedMkRecovery ||
    !wrapNonceRecovery ||
    !wrapAadRecovery ||
    !recoveryVerifierKey
  ) {
    throw new ApiError(400, 'invalid_input', 'Missing required fields for kind=invitation finish');
  }

  if (!USERNAME_RE.test(username) || RESERVED.has(username)) {
    throw new ApiError(400, 'invalid_input', 'Invalid username');
  }

  const state = await fetchOpaqueState('register', body.session_id);
  if (!state) throw new ApiError(410, 'session_expired', 'Session expired or not found');

  const pendingCodeId = state.pending_code_id;
  const invitationRole = state.invitation_role;
  const opaqueUserIdentifier = state.opaque_user_identifier;
  if (!pendingCodeId || !invitationRole || !opaqueUserIdentifier) {
    throw new ApiError(410, 'session_expired', 'Session state is incomplete');
  }

  const { db } = createDb();

  try {
    const result = await db.transaction(async (tx) => {
      const insertedUsers = await tx
        .insert(users)
        .values({
          username,
          role: invitationRole as 'primary_admin' | 'admin' | 'user',
          recoveryVerifierKey: Buffer.from(recoveryVerifierKey, 'base64url'),
          wrappedMkRecovery: Buffer.from(wrappedMkRecovery, 'base64url'),
          wrapNonceRecovery: Buffer.from(wrapNonceRecovery, 'base64url'),
          wrapAadRecovery: Buffer.from(wrapAadRecovery, 'base64url'),
        })
        .returning({ id: users.id, role: users.role });
      const user = insertedUsers[0];
      if (!user) throw new Error('User insert returned no row');

      await tx.insert(authMethods).values({
        userId: user.id,
        methodType: 'opaque',
        opaqueCredential: Buffer.from(registrationRecord, 'base64url'),
        opaqueUserIdentifier,
        // Persist registration-time username so later renames do not break
        // OPAQUE login / step-up (Larissa γ H1).
        opaqueClientIdentifier: username,
        wrappedMasterKey: Buffer.from(wrappedMkOpaque, 'base64url'),
        wrapNonce: Buffer.from(wrapNonceOpaque, 'base64url'),
        wrapAad: Buffer.from(wrapAadOpaque, 'base64url'),
      });

      await tx
        .update(pendingCodes)
        .set({ redeemedAt: new Date(), redeemedByUserId: user.id })
        .where(eq(pendingCodes.id, pendingCodeId));

      return user;
    });

    const tokens = await issueTokens({
      userId: result.id,
      role: result.role,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });

    // Fresh OPAQUE evidence seeds the Tier-1 grace window (spec §4.1).
    await seedStepUpKey(tokens.sessionId, 1);

    await writeAudit({
      db,
      eventType: 'user.linked',
      userId: result.id,
      metadata: { role: result.role, invitation_id: pendingCodeId },
    });
    await writeAudit({
      db,
      eventType: 'invitation.redeemed',
      userId: result.id,
      metadata: { invitation_id: pendingCodeId, role: result.role },
    });

    // Bootstrap-file cleanup for primary_admin invitations (kept parity with
    // link.ts; future cleanup may move this elsewhere).
    if (invitationRole === 'primary_admin') {
      const dir = process.env.XDG_RUNTIME_DIR ?? '/tmp';
      const bootstrapFilePath = join(dir, `chatsundere-bootstrap-${pendingCodeId}.json`);
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
      kind: 'invitation' as const,
      user_id: result.id,
      username,
      role: result.role,
      access_token: tokens.accessToken,
      expires_in: tokens.expiresIn,
      is_new_account: true as const,
    });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'conflict' });
      throw new ApiError(409, 'username_taken', 'Username already exists');
    }
    metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'error' });
    throw err;
  }
}

async function finishPairing(c: Context, body: FinishBody): Promise<Response> {
  if (!body.login_evidence) {
    throw new ApiError(400, 'invalid_input', 'login_evidence is required for kind=pairing');
  }

  // Atomic GETDEL via fetchOpaqueState: single-use round state. A second
  // /finish on the same session_id returns 410, no replay window.
  const state = await fetchOpaqueState('join-pairing', body.session_id);
  if (!state) throw new ApiError(410, 'session_expired', 'Session expired or not found');

  const pendingCodeId = state.pending_code_id;
  const userId = state.user_id;
  const username = state.username;
  const serverLoginState = state.server_login_state;
  if (!pendingCodeId || !userId || !username || !serverLoginState) {
    throw new ApiError(410, 'session_expired', 'Session state is incomplete');
  }

  // Verify OPAQUE evidence. A bad passphrase throws — surface as 401 with
  // a generic message; we do not distinguish "unknown user" since the user
  // is identified by the pairing code, not credentials.
  try {
    opaqueServer.finishLogin({
      serverLoginState,
      finishLoginRequest: body.login_evidence,
    });
  } catch {
    metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'fail' });
    throw new ApiError(401, 'opaque_authentication_failed', 'Passphrase verification failed');
  }

  const { db } = createDb();

  // Atomically mark the pending code as redeemed. The conditional WHERE
  // closes the race where two devices simultaneously redeem the same code:
  // only one UPDATE returns a row. The other gets the 410 below.
  const redemption = await db
    .update(pendingCodes)
    .set({ redeemedAt: new Date(), redeemedByUserId: userId })
    .where(
      and(
        eq(pendingCodes.id, pendingCodeId),
        isNull(pendingCodes.redeemedAt),
        isNull(pendingCodes.revokedAt),
        gt(pendingCodes.expiresAt, new Date()),
      ),
    )
    .returning({ id: pendingCodes.id });
  if (redemption.length === 0) {
    throw new ApiError(
      410,
      'code_already_redeemed',
      'Pairing code already redeemed, revoked, or expired',
    );
  }

  // Defence in depth: refuse to surface wrapped MK material if the
  // wrapping invariant has been violated (ADR 0021). The check writes an
  // audit row + metric and throws 500 with a generic message on failure.
  const wrapping = await assertOpaqueWrappingPresent({ userId });

  // Read the owner's current role for the issued token. We do not store
  // the role in the round state because role changes between /start and
  // /finish (rare but possible via admin action) should reflect in the
  // freshly-issued token.
  const ownerRows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const ownerRole = ownerRows[0]?.role;
  if (!ownerRole) {
    // Owner row vanished between /start and /finish — treat as session
    // expiry from the joining device's perspective.
    throw new ApiError(410, 'session_expired', 'Pairing-code owner no longer exists');
  }

  const tokens = await issueTokens({
    userId,
    role: ownerRole,
    userAgent: c.req.header('User-Agent') ?? undefined,
  });

  // Fresh OPAQUE evidence seeds the Tier-1 grace window (spec §4.1).
  await seedStepUpKey(tokens.sessionId, 1);

  await writeAudit({
    db,
    eventType: 'pairing_code.redeemed',
    userId,
    actorUserId: userId,
    metadata: { pairing_code_id: pendingCodeId },
  });
  metrics.authPairingCodesRedeemedTotal.inc();
  metrics.authLinksTotal.inc({ method_type: 'opaque', result: 'success' });

  c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
  return c.json({
    kind: 'pairing' as const,
    user_id: userId,
    username,
    role: ownerRole,
    access_token: tokens.accessToken,
    expires_in: tokens.expiresIn,
    is_new_account: false as const,
    wrapped_mk_opaque: Buffer.from(wrapping.wrappedMasterKey).toString('base64url'),
    wrap_nonce_opaque: Buffer.from(wrapping.wrapNonce).toString('base64url'),
    wrap_aad_opaque: Buffer.from(wrapping.wrapAad).toString('base64url'),
  });
}
