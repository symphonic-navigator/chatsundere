// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One honest rate-limit wait phrase, shared by every surface that shows the
 * server's `Retry-After` (the connectivity badge and both recovery gates), so a
 * user throttled at login and then tapping the in-app badge never sees two
 * phrasings of the same wait. Rounds UP (never promising a slot sooner than the
 * server implied) and drops to seconds below a minute for calm precision.
 */
export function formatWaitPhrase(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return `about ${total} second${total === 1 ? '' : 's'}`;
  const minutes = Math.ceil(total / 60);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Turns the server's absolute retry-at instant into the shared wait phrase,
 * computed fresh at render so it never goes stale. Returns null when there is no
 * hint or the window has already elapsed — the caller then falls back to its
 * vaguer "resumes shortly" copy.
 */
export function formatRetryWait(retryAt: number | undefined, now: number): string | null {
  if (retryAt === undefined) return null;
  const remainingMs = retryAt - now;
  if (remainingMs <= 0) return null;
  return formatWaitPhrase(remainingMs / 1000);
}
