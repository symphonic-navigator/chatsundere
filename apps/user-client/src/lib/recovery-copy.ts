// SPDX-License-Identifier: AGPL-3.0-only

import { formatWaitPhrase } from './wait-time.js';

/**
 * Renders the honest recovery-attempt rate-limit message shared by both
 * recovery surfaces (onboarding recovery-from-scratch and login recovery),
 * using the server's `Retry-After` hint when present. The recovery-attempt
 * rate-limit window is 10 attempts / 15 min. The wait phrase comes from the
 * one shared formatter (`wait-time.ts`), so this reads identically to the
 * connectivity badge for the same wait.
 */
export function rateLimitMessage(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined) return 'Too many attempts. Please wait a few minutes.';
  return `Too many attempts. Please wait ${formatWaitPhrase(retryAfterSeconds)}.`;
}
