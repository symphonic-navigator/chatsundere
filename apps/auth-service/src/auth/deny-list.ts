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
