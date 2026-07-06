// SPDX-License-Identifier: AGPL-3.0-only

import { revokedJtiKey, revokedSubKey } from '@chatsundere/shared-types';
import type { Redis } from 'ioredis';
import { ACCESS_TTL_SECONDS } from '../jwt/issue.js';

/**
 * Token revocation deny-list writes (spec §9). Every entry carries
 * TTL = ACCESS_TTL_SECONDS: after the access-token lifetime all affected tokens
 * have expired anyway (suspended users cannot refresh), so the list is
 * self-cleaning and never grows. Read by the sync-service after signature
 * verification; auth-service and sync-service must share the Redis instance.
 */

/** Denies a single session: any token bearing this `jti` is refused until it expires. */
export async function denyJti(redis: Redis, jti: string): Promise<void> {
  await redis.set(revokedJtiKey(jti), '1', 'EX', ACCESS_TTL_SECONDS);
}

/**
 * Denies a subject from `nowSeconds`: tokens with `iat` before this are refused,
 * so a user who logs out everywhere and immediately logs back in is not locked
 * out by their own deny entry.
 */
export async function denySub(redis: Redis, sub: string, nowSeconds: number): Promise<void> {
  await redis.set(revokedSubKey(sub), String(nowSeconds), 'EX', ACCESS_TTL_SECONDS);
}

/** Current unix time in seconds, for `denySub`. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * True when the token's session (`jti`) or subject (`sub`, iat-aware) was revoked
 * (spec §9). Mirrors the sync-service check so both services enforce the same
 * deny-list: a `jti` hit revokes unconditionally; a `sub` entry stores the
 * revocation unix-seconds and refuses only tokens with `iat` before it (strict
 * `<`), so a user who logs out everywhere and immediately logs back in is not
 * locked out by their own deny entry. A Redis error propagates — bearerAuth fails
 * closed (the request is denied), matching auth-service's existing hard Redis
 * dependency.
 */
export async function isTokenRevoked(
  redis: Redis,
  claims: { sub: string; jti: string; iat: number },
): Promise<boolean> {
  const [jtiHit, subRevokedAt] = await redis.mget(
    revokedJtiKey(claims.jti),
    revokedSubKey(claims.sub),
  );
  if (jtiHit != null) return true;
  if (subRevokedAt != null && claims.iat < Number(subRevokedAt)) return true;
  return false;
}
