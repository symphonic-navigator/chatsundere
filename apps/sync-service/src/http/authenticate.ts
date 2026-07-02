// SPDX-License-Identifier: AGPL-3.0-only

import type { Context } from 'hono';
import { isRevoked } from '../auth/revocation.js';
import type { TokenClaims } from '../auth/verify-token.js';
import { recordRateLimited, recordRevoked, recordUnauthorized } from '../metrics.js';
import { deriveClientIp } from '../net/client-ip.js';
import type { SyncDeps } from './deps.js';

export type AuthOutcome = { ok: true; claims: TokenClaims } | { ok: false; response: Response };

function json(c: Context, status: 401 | 429 | 503, code: string): Response {
  if (status === 429) c.header('Retry-After', '60');
  return c.json({ error: { code, message: 'Request refused' } }, status);
}

/**
 * The per-request guard, in the spec §3 order: derive the trusted client IP →
 * per-IP limit (pre-auth) → verify the JWT → revocation deny-list → per-user
 * limit. Returns the verified claims or a ready error Response. A Redis outage
 * on the revocation check fails closed with 503.
 */
export async function authenticate(c: Context, deps: SyncDeps): Promise<AuthOutcome> {
  const { env, redis, verifyToken, allow } = deps;
  const directIp = (c.env as { ip?: string } | undefined)?.ip ?? '0.0.0.0';
  const clientIp = deriveClientIp(
    c.req.header('x-forwarded-for') ?? null,
    directIp,
    env.TRUST_PROXY_HOPS,
  );

  if (!(await allow(`ip:${clientIp}`, env.RATE_LIMIT_IP_PER_MIN, 60))) {
    recordRateLimited();
    return { ok: false, response: json(c, 429, 'rate_limited') };
  }

  const authz = c.req.header('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : undefined;
  const claims = token ? await verifyToken(token) : null;
  if (!claims) {
    recordUnauthorized();
    return { ok: false, response: json(c, 401, 'unauthorized') };
  }

  try {
    if (await isRevoked(redis, claims)) {
      recordRevoked();
      return { ok: false, response: json(c, 401, 'unauthorized') };
    }
  } catch {
    return { ok: false, response: json(c, 503, 'unavailable') }; // Redis outage → fail closed
  }

  if (!(await allow(`user:${claims.sub}`, env.RATE_LIMIT_USER_PER_MIN, 60))) {
    recordRateLimited();
    return { ok: false, response: json(c, 429, 'rate_limited') };
  }

  return { ok: true, claims };
}
