// SPDX-License-Identifier: AGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { server as opaqueServer } from '@serenity-kit/opaque';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import { and, eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { object, optional, parse, picklist, string, unknown } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { type StepUpTier, seedStepUpKey, tierGraceMs } from '../auth/step-up.js';
import { createDb } from '../db/client.js';
import { authMethods } from '../db/schema.js';
import { loadEnv } from '../env.js';
import type { AccessClaims } from '../jwt/verify.js';
import { metrics } from '../metrics.js';
import { bearerAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error-envelope.js';
import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';
import { createRedis } from '../redis/client.js';
import { generateAuthentication, verifyAuthentication } from '../webauthn/server.js';

/**
 * Per ADR 0027 and the step-up brief, /start accepts t1 (auth mutations),
 * t3 (destructive ops), and t4 (operator privileged). Tier 2 (re-disclosure
 * of secrets) is reserved — no endpoint enforces it in Phase 0 — and Tier 0
 * is not a step-up tier. The brief's failure table originally listed only
 * t1 and t4; t3 is added here because Tier 3 endpoints rely on a key being
 * set, which requires /start to accept t3. See plan Task 7 doc-patch.
 */
const acceptedStartTiers = ['t1', 't3', 't4'] as const;
type AcceptedStartTier = (typeof acceptedStartTiers)[number];

const startReq = object({
  mechanism: picklist(['webauthn', 'opaque']),
  tier_requested: picklist(acceptedStartTiers),
  login_request: optional(string()), // opaque-only
});

const STEP_UP_ROUND_TTL_SECONDS = 60;

interface WebAuthnRoundState {
  mechanism: 'webauthn';
  tier: AcceptedStartTier;
  user_id: string;
  session_id_user: string;
  challenge: string;
}

// Brief: 10 attempts per session per 5 minutes, 20 per IP per 5 minutes.
// The session limit binds tightly to the bearer's jti (= sessionId); the IP
// limit applies on both endpoints. /finish has no bearer so only the IP cap
// runs there; /start carries both.
const STEP_UP_RL_WINDOW_SEC = 5 * 60;
const STEP_UP_RL_SESSION_MAX = 10;
const STEP_UP_RL_IP_MAX = 20;

const sessionRateLimit = rateLimit({
  bucket: 'step_up_session',
  windowSec: STEP_UP_RL_WINDOW_SEC,
  max: STEP_UP_RL_SESSION_MAX,
  key: (c) => (c.get('sessionId') as string) ?? '',
});

const ipRateLimit = rateLimit({
  bucket: 'step_up_ip',
  windowSec: STEP_UP_RL_WINDOW_SEC,
  max: STEP_UP_RL_IP_MAX,
  key: (c) => ipKey(c),
});

export function registerStepUpRoutes(app: Hono): void {
  app.post('/api/v1/auth/step-up/start', bearerAuth(), sessionRateLimit, ipRateLimit, async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionIdUser = c.get('sessionId') as string;
    const body = parse(startReq, await c.req.json());

    const sessionIdRound = generateSessionId();

    if (body.mechanism === 'webauthn') {
      const { db } = createDb();
      const passkeyRows = await db
        .select({ credentialId: authMethods.passkeyCredentialId })
        .from(authMethods)
        .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'passkey')));

      const credentialIds = passkeyRows
        .filter((r): r is { credentialId: Uint8Array } => r.credentialId != null)
        .map((r) => Buffer.from(r.credentialId).toString('base64url'));

      if (credentialIds.length === 0) {
        throw new ApiError(
          400,
          'no_passkey',
          'User has no passkey enrolled; retry with mechanism=opaque',
        );
      }

      // ADR 0027 Mechanism A: UV must be 'required' for step-up. Overrides
      // ADR 0022's relaxed 'preferred' default used at ordinary login time.
      const options = await generateAuthentication({
        allowCredentialIds: credentialIds,
        userVerification: 'required',
      });

      const redis = createRedis();
      const state: WebAuthnRoundState = {
        mechanism: 'webauthn',
        tier: body.tier_requested,
        user_id: claims.sub,
        session_id_user: sessionIdUser,
        challenge: options.challenge,
      };
      await redis.set(
        `step_up_round:${sessionIdRound}`,
        JSON.stringify(state),
        'EX',
        STEP_UP_ROUND_TTL_SECONDS,
      );

      metrics.authStepUpStartedTotal.inc({ method_type: 'passkey', tier: body.tier_requested });

      return c.json({
        session_id: sessionIdRound,
        mechanism: 'webauthn' as const,
        options,
      });
    }

    // mechanism === 'opaque'
    if (!body.login_request) {
      throw new ApiError(400, 'invalid_input', 'login_request required for mechanism=opaque');
    }
    await ensureOpaqueReady();

    const { db } = createDb();

    // Step-up OPAQUE binds to the user from the bearer — no username in body
    // (the user is already authenticated; we only need a fresh proof). The
    // identifiers passed to opaqueServer.startLogin must match what was
    // baked into the registration record at link time, which means reading
    // the registration-time username from auth_methods.opaque_client_identifier
    // rather than the live users.username (which would desynchronise after
    // a PATCH /api/v1/me username change).
    const rows = await db
      .select({
        opaqueCredential: authMethods.opaqueCredential,
        opaqueUserIdentifier: authMethods.opaqueUserIdentifier,
        opaqueClientIdentifier: authMethods.opaqueClientIdentifier,
      })
      .from(authMethods)
      .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'opaque')))
      .limit(1);

    const row = rows[0];
    if (!row || !row.opaqueCredential || !row.opaqueUserIdentifier || !row.opaqueClientIdentifier) {
      throw new ApiError(400, 'no_opaque', 'User has no OPAQUE auth method enrolled');
    }

    const env = loadEnv();
    const { serverLoginState, loginResponse } = opaqueServer.startLogin({
      serverSetup: getServerSetup(),
      registrationRecord: Buffer.from(row.opaqueCredential).toString('base64url'),
      startLoginRequest: body.login_request,
      userIdentifier: row.opaqueUserIdentifier,
      identifiers: {
        client: row.opaqueClientIdentifier,
        server: opaqueServerIdentity(env.API_BASE_URL),
      },
    });

    await storeOpaqueState({
      scope: 'step-up',
      sessionId: sessionIdRound,
      payload: {
        tier: body.tier_requested,
        user_id: claims.sub,
        session_id_user: sessionIdUser,
        server_login_state: serverLoginState,
      },
    });

    metrics.authStepUpStartedTotal.inc({ method_type: 'opaque', tier: body.tier_requested });

    return c.json({
      session_id: sessionIdRound,
      mechanism: 'opaque' as const,
      login_response: loginResponse,
    });
  });

  app.post('/api/v1/auth/step-up/finish', ipRateLimit, async (c) => {
    const body = parse(finishReq, await c.req.json());

    if (body.mechanism === 'webauthn') {
      return finishWebAuthn(c, body);
    }
    return finishOpaque(c, body);
  });
}

const finishReq = object({
  mechanism: picklist(['webauthn', 'opaque']),
  session_id: string(),
  assertion: optional(unknown()), // @simplewebauthn AuthenticationResponseJSON envelope
  login_evidence: optional(string()), // base64url OPAQUE finish-login request
});

type FinishBody = {
  mechanism: 'webauthn' | 'opaque';
  session_id: string;
  assertion?: unknown;
  login_evidence?: string;
};

async function finishWebAuthn(c: Context, body: FinishBody): Promise<Response> {
  const redis = createRedis();
  // GETDEL is atomic — single-use round state, no race window for two
  // concurrent /finish calls to both pass the existence check before the
  // delete lands (which was Larissa M1 against the prior GET + DEL pair).
  const stateRaw = await redis.getdel(`step_up_round:${body.session_id}`);
  if (!stateRaw) {
    throw new ApiError(410, 'session_expired', 'Step-up round expired or not found');
  }

  const state = JSON.parse(stateRaw) as WebAuthnRoundState;

  if (!body.assertion) {
    throw new ApiError(400, 'invalid_input', 'assertion required for mechanism=webauthn');
  }

  const assertion = body.assertion as AuthenticationResponseJSON;

  // Look up the public key for the credential the user actually used.
  const { db } = createDb();
  const credentialIdBytes = Buffer.from(assertion.id, 'base64url');
  const pkRows = await db
    .select({
      passkeyPublicKey: authMethods.passkeyPublicKey,
      passkeySignCount: authMethods.passkeySignCount,
      userId: authMethods.userId,
    })
    .from(authMethods)
    .where(
      and(
        eq(authMethods.methodType, 'passkey'),
        eq(authMethods.passkeyCredentialId, credentialIdBytes),
      ),
    )
    .limit(1);

  const pk = pkRows[0];
  if (!pk || !pk.passkeyPublicKey || pk.userId !== state.user_id) {
    await recordStepUpFailed(db, state.user_id, 'passkey', state.tier, 'verify_failed');
    throw new ApiError(401, 'webauthn_verification_failed', 'WebAuthn verification failed');
  }

  let verification: Awaited<ReturnType<typeof verifyAuthentication>>;
  try {
    verification = await verifyAuthentication({
      response: assertion,
      expectedChallenge: state.challenge,
      publicKey: pk.passkeyPublicKey,
      signCount: pk.passkeySignCount ?? 0,
    });
  } catch {
    await recordStepUpFailed(db, state.user_id, 'passkey', state.tier, 'verify_failed');
    throw new ApiError(401, 'webauthn_verification_failed', 'WebAuthn verification failed');
  }

  if (!verification.verified) {
    await recordStepUpFailed(db, state.user_id, 'passkey', state.tier, 'verify_failed');
    throw new ApiError(401, 'webauthn_verification_failed', 'WebAuthn verification failed');
  }

  // Persist the new sign counter immediately on successful cryptographic
  // verification — before the UV-required gate. The assertion is valid;
  // only the policy check below may still reject it. Skipping the counter
  // update on the uv_required path would leave the authenticator's
  // last-presented counter reusable for a later replay (Larissa M2).
  await db
    .update(authMethods)
    .set({
      passkeySignCount: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(authMethods.methodType, 'passkey'),
        eq(authMethods.passkeyCredentialId, credentialIdBytes),
      ),
    );

  // ADR 0027 Mechanism A: UV must have happened. If not, return a distinct
  // error code so the client can silently fall through to mechanism=opaque
  // without re-prompting the user for the same passkey.
  if (!verification.authenticationInfo?.userVerified) {
    await recordStepUpFailed(db, state.user_id, 'passkey', state.tier, 'uv_required');
    throw new ApiError(401, 'webauthn_uv_required', 'UV not performed — fall through to opaque');
  }

  await setStepUpKey(state.session_id_user, state.tier);
  await recordStepUpConfirmed(db, state.user_id, 'passkey', state.tier);

  metrics.authStepUpFinishedTotal.inc({
    method_type: 'passkey',
    tier: state.tier,
    result: 'success',
  });

  return c.json({
    tier_confirmed: state.tier,
    expires_at: expiresAtFor(state.tier),
  });
}

async function finishOpaque(c: Context, body: FinishBody): Promise<Response> {
  await ensureOpaqueReady();

  // fetchOpaqueState is atomic GETDEL — single-use, no replay window.
  const state = await fetchOpaqueState('step-up', body.session_id);
  if (!state) {
    throw new ApiError(410, 'session_expired', 'Step-up round expired or not found');
  }

  if (!body.login_evidence) {
    throw new ApiError(400, 'invalid_input', 'login_evidence required for mechanism=opaque');
  }

  const tier = state.tier as AcceptedStartTier;
  const userId = state.user_id;
  const sessionIdUser = state.session_id_user;
  const serverLoginState = state.server_login_state;
  if (!tier || !userId || !sessionIdUser || !serverLoginState) {
    throw new ApiError(410, 'session_expired', 'Step-up round state is incomplete');
  }

  const { db } = createDb();

  try {
    opaqueServer.finishLogin({
      serverLoginState,
      finishLoginRequest: body.login_evidence,
    });
  } catch {
    await recordStepUpFailed(db, userId, 'opaque', tier, 'auth_failed');
    throw new ApiError(401, 'opaque_authentication_failed', 'Passphrase verification failed');
  }

  await setStepUpKey(sessionIdUser, tier);
  await recordStepUpConfirmed(db, userId, 'opaque', tier);

  metrics.authStepUpFinishedTotal.inc({ method_type: 'opaque', tier, result: 'success' });

  return c.json({
    tier_confirmed: tier,
    expires_at: expiresAtFor(tier),
  });
}

/**
 * Writes `step_up:<session_id_user>:t<tier>` with the millisecond timestamp
 * as the value and a TTL derived from tierGraceMs(). The double check —
 * stored timestamp + Redis TTL — lets requireStepUp catch both natural
 * expiry and clock-skewed eviction.
 */
async function setStepUpKey(sessionIdUser: string, tier: AcceptedStartTier): Promise<void> {
  await seedStepUpKey(sessionIdUser, numericTierFor(tier));
}

function numericTierFor(tier: AcceptedStartTier): StepUpTier {
  return Number(tier.slice(1)) as StepUpTier;
}

function expiresAtFor(tier: AcceptedStartTier): string {
  return new Date(Date.now() + tierGraceMs(numericTierFor(tier))).toISOString();
}

type AuditMethodType = 'opaque' | 'passkey';
type StepUpFailedReason = 'auth_failed' | 'verify_failed' | 'uv_required';

async function recordStepUpConfirmed(
  db: ReturnType<typeof createDb>['db'],
  userId: string,
  methodType: AuditMethodType,
  tier: AcceptedStartTier,
): Promise<void> {
  await writeAudit({
    db,
    eventType: 'auth.step_up.confirmed',
    userId,
    actorUserId: userId,
    metadata: { method_type: methodType, tier },
  });
}

async function recordStepUpFailed(
  db: ReturnType<typeof createDb>['db'],
  userId: string,
  methodType: AuditMethodType,
  tier: AcceptedStartTier,
  reason: StepUpFailedReason,
): Promise<void> {
  metrics.authStepUpFinishedTotal.inc({
    method_type: methodType,
    tier,
    result: reason === 'uv_required' ? 'uv_required' : reason,
  });
  await writeAudit({
    db,
    eventType: 'auth.step_up.failed',
    userId,
    actorUserId: userId,
    metadata: { method_type: methodType, tier, reason },
  });
}
