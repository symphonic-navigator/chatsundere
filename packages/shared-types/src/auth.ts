// SPDX-License-Identifier: MIT

/**
 * The set of user roles in Chatsundere. Exactly one user has the
 * `primary_admin` role at any given time (enforced by a partial unique
 * index in the auth-service database).
 */
export type UserRole = 'primary_admin' | 'admin' | 'user';

/**
 * The categories of server-side authentication method. Recovery is
 * handled entirely client-side (gated by a server-stored verifier key)
 * and is not represented as an auth method on the server.
 */
export type ServerAuthMethodType = 'opaque' | 'passkey';

/**
 * Per-invitation metadata as returned by `GET /v1/admin/invitations`.
 * The one-time secret `token` is intentionally absent — it is only
 * returned by the create endpoint and is never re-listed.
 */
export interface Invitation {
  id: string;
  role: UserRole;
  issuer_label: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  revoked_at: string | null;
  attempt_count: number;
}

/**
 * The QR-payload embedded in an invitation. Encoded as JSON, then
 * base64url for transport. The user-client renders this as a QR code
 * and parses it on scan.
 */
export interface InvitationQrPayload {
  v: 1;
  kind: 'invitation';
  token: string;
  base_url: string;
  role: UserRole;
  issuer_label: string | null;
}

/**
 * JWT claims issued by the auth-service. Username is deliberately
 * absent — services that need the current username call `/v1/me`.
 * `aud` is the full `${base_url}/auth/v1` string; `iss` carries a
 * version suffix so future protocol breaks can be detected.
 */
export interface JWTClaims {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
  iss: 'chatsundere-auth-v1';
  aud: string;
}

/**
 * Uniform error envelope returned by every Chatsundere service.
 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'rate_limited'
  | 'expired'
  | 'conflict'
  | 'internal'
  | 'username_taken'
  | 'invitation_consumed'
  | 'invitation_attempts_exhausted';
