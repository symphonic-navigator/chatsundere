// SPDX-License-Identifier: AGPL-3.0-only

import { SignJWT } from 'jose';
import { createDb } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { metrics } from '../metrics.js';
import { getKeyMaterial } from './keys.js';

let refreshKeyCache: CryptoKey | null = null;

/** Returns a cached HMAC-SHA-256 CryptoKey derived from REFRESH_TOKEN_HMAC_KEY. */
async function getRefreshKey(): Promise<CryptoKey> {
  if (refreshKeyCache) return refreshKeyCache;
  const env = loadEnv();
  const raw = Buffer.from(env.REFRESH_TOKEN_HMAC_KEY, 'base64url');
  refreshKeyCache = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return refreshKeyCache;
}

export const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const REFRESH_TOKEN_BYTES = 32;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  familyId: string;
  expiresIn: number;
  /**
   * Opaque session identifier (the access-token jti claim). Use as the
   * key prefix for per-session server-side state such as step-up grace
   * windows. Never derive from the raw refresh or access token.
   */
  sessionId: string;
}

/** Issues an access token (signed JWT) and a refresh token (opaque, SHA-256 hashed at rest). */
export async function issueTokens(args: {
  userId: string;
  role: 'primary_admin' | 'admin' | 'user';
  familyId?: string;
  userAgent?: string;
}): Promise<IssuedTokens> {
  const env = loadEnv();
  const { privateKey, kid } = await getKeyMaterial();
  const aud = `${env.API_BASE_URL}/v1`;

  // jti is a per-token UUID used as the session_id for server-side per-session
  // state (currently step-up grace windows per ADR 0027; future: any per-session
  // counter that should reset on logout). Using a UUID rather than the token
  // itself keeps the actual token out of any storage key.
  const sessionId = crypto.randomUUID();
  const access = await new SignJWT({ role: args.role })
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setSubject(args.userId)
    .setJti(sessionId)
    .setIssuer('chatsundere-auth-v1')
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(privateKey);
  metrics.authJwtIssuedTotal.inc({ kind: 'access' });

  const refresh = generateOpaqueToken(REFRESH_TOKEN_BYTES);
  const refreshHash = await hmacRefreshToken(refresh);
  const familyId = args.familyId ?? crypto.randomUUID();

  const { db } = createDb();
  const inserted = await db
    .insert(refreshTokens)
    .values({
      userId: args.userId,
      tokenHash: refreshHash,
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      userAgent: args.userAgent ?? null,
    })
    .returning({ id: refreshTokens.id });
  metrics.authJwtIssuedTotal.inc({ kind: 'refresh' });

  const insertedId = inserted[0]?.id;
  if (!insertedId) throw new Error('Refresh token insert returned no row');

  return {
    accessToken: access,
    refreshToken: refresh,
    refreshTokenId: insertedId,
    familyId,
    expiresIn: ACCESS_TTL_SECONDS,
    sessionId,
  };
}

/** Generates a cryptographically random opaque token as a base64url string. */
function generateOpaqueToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}

/**
 * Returns an HMAC-SHA-256 digest of the refresh token using REFRESH_TOKEN_HMAC_KEY.
 * Keyed hashing prevents off-line brute-force attacks against the token_hash column.
 * IMPORTANT: do not rotate REFRESH_TOKEN_HMAC_KEY without flushing the refresh_tokens
 * table — all live sessions use this key for both write (issue) and read (lookup).
 */
async function hmacRefreshToken(token: string): Promise<Uint8Array> {
  const key = await getRefreshKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return new Uint8Array(sig);
}

/** Builds the Set-Cookie header value for the refresh-token HttpOnly cookie. */
export function refreshCookieFor(refreshToken: string): string {
  const env = loadEnv();
  const secure = env.NODE_ENV !== 'development';
  const parts = [
    `refresh_token=${refreshToken}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/v1/token/refresh',
    `Max-Age=${REFRESH_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Exposed for refresh.ts so it can look up a token's hash. Uses HMAC-SHA-256 (same key as issue). */
export async function sha256ForCookie(refreshToken: string): Promise<Uint8Array> {
  return hmacRefreshToken(refreshToken);
}
