// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Derives the trusted client IP for rate limiting. Never trusts a
 * client-settable value: it reads the entry `trustHops` positions from the
 * right of X-Forwarded-For — the address the trusted front proxy (Traefik)
 * actually observed — and falls back to the direct socket IP.
 */
export function deriveClientIp(
  xForwardedFor: string | null,
  directIp: string,
  trustHops: number,
): string {
  if (trustHops <= 0 || !xForwardedFor) return directIp;
  const parts = xForwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = parts.length - trustHops;
  return idx >= 0 ? (parts[idx] as string) : directIp;
}
