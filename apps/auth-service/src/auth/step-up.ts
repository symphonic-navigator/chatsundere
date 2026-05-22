// SPDX-License-Identifier: AGPL-3.0-only

import { ApiError } from '../middleware/error-envelope.js';
import { createRedis } from '../redis/client.js';

/**
 * The step-up tier required by a privileged endpoint. Per ADR 0027:
 * - Tier 1: mutations of auth state (add passkey, generate pairing code)
 *   — 2-minute grace window, allows bursts of related operations.
 * - Tier 4: operator-side privileged operations (create / revoke invitation,
 *   suspend user) — 5-minute grace window.
 *
 * Tier 2 (re-disclosure of secrets) and Tier 3 (destructive ops) also exist
 * per ADR 0027 but use a tighter 10-second tolerance; they are added by the
 * step-up backend plan, not this initial cross-device Squash α helper.
 */
export type StepUpTier = 1 | 4;

const GRACE_MS: Record<StepUpTier, number> = {
  1: 120_000, // 2 minutes
  4: 300_000, // 5 minutes
};

/**
 * Returns the per-tier grace window in milliseconds. The Redis key TTL is
 * derived from this value (rounded up to whole seconds).
 */
export function tierGraceMs(tier: StepUpTier): number {
  return GRACE_MS[tier];
}

interface RequireStepUpInput {
  sessionId: string;
  tier: StepUpTier;
}

/**
 * Verifies the session has a fresh step-up confirmation for the given tier
 * per ADR 0027. Reads `step_up:<sessionId>:t<tier>` from Redis and validates
 * the stored millisecond timestamp against the tier's grace window.
 *
 * Tier 0 endpoints must not invoke this helper. The `POST /api/v1/auth/step-up`
 * endpoint that issues confirmations is built in the separate step-up backend
 * plan; until then, callers must seed the Redis key directly (e.g., in tests).
 *
 * Throws ApiError(403, 'step_up_required', message, { tier }) on miss; the
 * tier metadata is surfaced in the error envelope so the client can render
 * the right mechanism prompt.
 */
export async function requireStepUp({ sessionId, tier }: RequireStepUpInput): Promise<void> {
  const graceMs = GRACE_MS[tier];
  // Defence in depth: TypeScript narrows StepUpTier to 1 | 4 today, but a future
  // caller could force-cast a different value. Unknown-tier here would compare
  // a number against undefined (NaN), which is always false — meaning the gate
  // would silently pass for any tier outside the table. Fail loudly instead.
  if (graceMs === undefined) {
    throw new ApiError(500, 'internal', `Unsupported step-up tier: ${tier}`);
  }
  const redis = createRedis();
  const raw = await redis.get(`step_up:${sessionId}:t${tier}`);
  if (!raw) {
    throw new ApiError(403, 'step_up_required', 'Step-up confirmation required', { tier });
  }
  const ts = Number(raw);
  if (!Number.isFinite(ts) || Date.now() - ts > graceMs) {
    throw new ApiError(403, 'step_up_required', 'Step-up confirmation expired', { tier });
  }
}
