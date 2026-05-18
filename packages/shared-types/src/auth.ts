// SPDX-License-Identifier: MIT

/**
 * The set of user roles in Chatsundere. Exactly one user has the
 * `primary_admin` role at any given time (enforced by a partial unique
 * index in the auth-service database).
 */
export type UserRole = 'primary_admin' | 'admin' | 'user';

/**
 * The categories of authentication method a user may register. A single
 * user may have multiple methods; each one independently wraps the same
 * Master Key client-side.
 */
export type AuthMethodType = 'opaque' | 'passkey' | 'recovery_key';

/**
 * A one-time invitation token, issued by an admin, that binds a
 * pre-assigned username and role to a future registration event.
 *
 * Field names match the wire format produced by the auth-service
 * (see `obsidian/briefs/phase 0/auth-service.md`). The secret
 * `token` is intentionally absent — it is only returned once at
 * creation time and is never re-listed or re-fetched.
 */
export interface Invitation {
  id: string;
  username: string;
  role: UserRole;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  revoked_at: string | null;
}

/**
 * Standard JWT claims issued by the auth-service for cross-service
 * authentication. The access token is short-lived (~15 min); refresh
 * tokens are opaque strings stored server-side.
 *
 * `aud` is always emitted as a JSON array (single-element by default).
 * Verifying services should treat it as `string[]`; the expected
 * baseline value is `['chatsundere-services']`.
 */
export interface JWTClaims {
  sub: string;
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
  iss: 'chatsundere-auth';
  aud: string[];
}

/**
 * Uniform error envelope returned by every Chatsundere service.
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}
