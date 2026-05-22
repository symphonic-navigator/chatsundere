// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { type AccessClaims, verifyAccessToken } from '../jwt/verify.js';
import { createRedis } from '../redis/client.js';
import { ApiError } from './error-envelope.js';

/** Redis TTL for the user-exists cache key (seconds). Audit H4. */
const EXISTS_CACHE_TTL = 30;

interface BearerOptions {
  /** When set, the authenticated user must have at least this role. */
  minRole?: 'admin' | 'primary_admin';
}

/**
 * Middleware that enforces bearer-token authentication.
 *
 * 1. Extracts the Bearer token from the Authorization header.
 * 2. Verifies the token signature and claims via jose (EdDSA).
 * 3. Checks that the user exists and is not suspended — cached in Redis for 30 s.
 * 4. Optionally enforces a minimum role (admin or primary_admin).
 * 5. Stores the typed claims in `c.var.claims` for downstream handlers.
 */
export function bearerAuth(options: BearerOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();

    let claims: AccessClaims;
    try {
      claims = await verifyAccessToken(token);
    } catch {
      throw new ApiError(401, 'unauthorized', 'Invalid bearer token');
    }

    if (!(await userExistsAndActive(claims.sub))) {
      throw new ApiError(401, 'unauthorized', 'User no longer exists or is suspended');
    }

    if (options.minRole === 'admin' && claims.role === 'user') {
      throw new ApiError(403, 'forbidden', 'Admin role required');
    }
    if (options.minRole === 'primary_admin' && claims.role !== 'primary_admin') {
      throw new ApiError(403, 'forbidden', 'Primary admin role required');
    }

    c.set('claims', claims);
    // session_id is the jti claim. Downstream handlers reach for it via
    // `c.get('sessionId')` when keying server-side per-session state
    // (e.g. step-up grace windows per ADR 0027).
    c.set('sessionId', claims.jti);
    await next();
  };
}

/**
 * Immediately removes the cached user-exists entry for the given user.
 * Must be called at every state-change site (suspend, unsuspend, delete, role change).
 * Without this, the 30 s Redis TTL would delay enforcement by up to 30 s.
 */
export async function invalidateUserExistsCache(userId: string): Promise<void> {
  await createRedis().del(`userexists:${userId}`);
}

/** Returns true if the user exists and has no suspendedAt timestamp. Redis-cached for 30 s. */
async function userExistsAndActive(userId: string): Promise<boolean> {
  const redis = createRedis();
  const cacheKey = `userexists:${userId}`;

  const cached = await redis.get(cacheKey);
  if (cached === '1') return true;
  if (cached === '0') return false;

  const { db } = createDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.suspendedAt)))
    .limit(1);

  const exists = rows.length > 0;
  await redis.set(cacheKey, exists ? '1' : '0', 'EX', EXISTS_CACHE_TTL);
  return exists;
}
