// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Renders the honest recovery-attempt rate-limit message shared by both
 * recovery surfaces (onboarding recovery-from-scratch and login recovery),
 * using the server's `Retry-After` hint when present. The recovery-attempt
 * rate-limit window is 10 attempts / 15 min.
 */
export function rateLimitMessage(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined) return 'Too many attempts. Please wait a few minutes.';
  const minutes = Math.max(1, Math.round(retryAfterSeconds / 60));
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return `Too many attempts. Please wait about ${minutes} ${unit}.`;
}
