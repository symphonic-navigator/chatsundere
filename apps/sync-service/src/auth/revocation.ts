// SPDX-License-Identifier: AGPL-3.0-only

import { revokedJtiKey, revokedSubKey } from '@chatsundere/shared-types';

/** The minimal Redis surface the revocation check needs (satisfied by ioredis). */
export interface RevocationRedis {
  mget(...keys: string[]): Promise<(string | null)[]>;
}

/**
 * True when the token's session or subject was revoked after the token was
 * issued (spec §9). A `jti` hit revokes unconditionally; a `sub` entry stores
 * the revocation unix-seconds and refuses only tokens with `iat` before it, so
 * a user who logs out everywhere and immediately logs back in is not locked out
 * by their own deny entry. A Redis error propagates — the route maps it to 503
 * (fail closed).
 */
export async function isRevoked(
  redis: RevocationRedis,
  claims: { sub: string; jti: string; iat: number },
): Promise<boolean> {
  const [jtiHit, subRevokedAt] = await redis.mget(
    revokedJtiKey(claims.jti),
    revokedSubKey(claims.sub),
  );
  if (jtiHit !== null && jtiHit !== undefined) return true;
  if (subRevokedAt !== null && subRevokedAt !== undefined && claims.iat < Number(subRevokedAt))
    return true;
  return false;
}
