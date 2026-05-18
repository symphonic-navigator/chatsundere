# Chatsundere — Auth Service Briefing

**For:** Liz (implementation)
**From:** Lyra (architecture) + Chris (vision)
**Service:** `apps/auth-service`
**License:** AGPLv3
**Date:** 2026-05-18

---

## Purpose

The auth-service is the single source of truth for user identity in
Chatsundere. It handles:

- User registration (via invitation tokens, no open signup)
- Authentication via OPAQUE (passphrase) and WebAuthn (passkey)
- JWT issuance and refresh
- User role management (primary_admin, admin, user)
- Storing wrapped master keys (without ever seeing them in plaintext)
- Invitation token lifecycle

**Critical:** This service NEVER sees passphrases, master keys, DEKs, or
any user data in plaintext. It stores ciphertext blobs and verifies
crypto proofs.

## Tech

- Bun runtime
- Hono web framework
- Drizzle ORM + PostgreSQL 16
- Redis (rate limits, refresh token revocation)
- `@serenity-kit/opaque` (server side)
- `@simplewebauthn/server`
- `jose` (JWT)
- `prom-client` (metrics)
- `pino` (logging)
- `valibot` (request validation)

## Concepts

### User Roles

```typescript
type UserRole = 'primary_admin' | 'admin' | 'user';
```

- Exactly **one** `primary_admin` exists at any time (DB constraint).
- `admin` users can create invitations, view user list, suspend users.
- `user` users have no admin capabilities.
- The `primary_admin` is set during the initial system bootstrap (see
  Bootstrap section).

### Auth Methods

A user can have multiple auth methods. Each one is independent and
each one wraps the same Master Key.

```typescript
type AuthMethodType = 'opaque' | 'passkey' | 'recovery_key';
```

- **opaque**: passphrase-based, OPAQUE protocol
- **passkey**: WebAuthn credential with optional PRF
- **recovery_key**: a 32-byte random key shown once at registration,
  user-stored (e.g., in a password manager or on paper)

**Minimum auth methods per user:**
At least one **non-recovery** auth method must exist before recovery
key is shown. Recommended UX: register with opaque OR passkey first,
then generate recovery key. Don't allow accounts with only a recovery
key (because losing it = losing everything, and recovery key is
explicitly meant to be a fallback).

### Master Key Wrapping

The client generates a 32-byte random Master Key at first registration.
That Master Key is wrapped (encrypted) using a key derived from each
auth method:

- **opaque**: AMK = HKDF(opaque_export_key, info='chatsundere-amk-v1')
- **passkey**: AMK = HKDF(prf_output, info='chatsundere-amk-v1')
- **recovery_key**: AMK = HKDF(recovery_key, info='chatsundere-amk-v1')

The wrapping algorithm is AES-256-GCM. Wrap nonce is stored alongside.

**The server stores only `wrapped_master_key` and `wrap_nonce` per
auth method. It cannot unwrap them.**

### Invitations

The system has no open signup. Admins create one-time invitation tokens
with a pre-assigned username and role. The token is encoded into a
QR code along with the service URLs.

```typescript
type Invitation = {
  id: string;            // uuid
  token: string;         // random 32-byte, base64url; this is THE secret
  username: string;      // pre-assigned by admin
  role: UserRole;        // defaults to 'user'
  created_by: string;    // admin user_id
  created_at: Date;
  expires_at: Date;      // default: created_at + 7 days
  redeemed_at: Date | null;
  redeemed_by_user_id: string | null;
};
```

QR code payload (JSON, base64url'd into URL):

```json
{
  "v": 1,
  "kind": "invitation",
  "token": "...",
  "username": "preassigned_username",
  "endpoints": {
    "auth": "https://auth.chatsundere.app/v1",
    "sync": "https://sync.chatsundere.app/v1",
    "proxy": "https://proxy.chatsundere.app/v1"
  },
  "issuer": "chris@second-circuit"
}
```

The client renders this as `chatsundere://invite?payload=<base64url>` or
via deep linking; the QR code itself encodes the URI.

## Data Model (Drizzle Schema)

```typescript
// users
{
  id: uuid (pk),
  username: text (unique, not null, citext recommended),
  role: enum('primary_admin', 'admin', 'user') not null default 'user',
  created_at: timestamptz not null default now(),
  suspended_at: timestamptz null,
  storage_quota_bytes: bigint null,  // null = unlimited (for now)
  // Optional metadata; never include sensitive fields here
  display_name: text null,
}

// Constraint: at most one user with role='primary_admin'
// CREATE UNIQUE INDEX users_one_primary_admin
//   ON users (role) WHERE role = 'primary_admin';

// auth_methods
{
  id: uuid (pk),
  user_id: uuid (fk -> users.id, on delete cascade) not null,
  method_type: enum('opaque', 'passkey', 'recovery_key') not null,
  label: text null,  // user-facing: "iPhone Face ID", "Recovery Key"
  
  // OPAQUE: the registration record (opaque blob from @serenity-kit)
  opaque_credential: bytea null,
  
  // Passkey: WebAuthn credential data
  passkey_credential_id: bytea null,  // unique across all rows when not null
  passkey_public_key: bytea null,
  passkey_sign_count: bigint null,
  passkey_transports: jsonb null,  // array of strings
  passkey_prf_supported: boolean default false,
  
  // Master key wrapping (always present)
  wrapped_master_key: bytea not null,
  wrap_nonce: bytea not null,
  wrap_algo: text not null default 'AES-256-GCM',
  
  created_at: timestamptz not null default now(),
  last_used_at: timestamptz null,
}

// Indexes:
// - (user_id, method_type)
// - passkey_credential_id WHERE passkey_credential_id IS NOT NULL (unique)

// invitations
{
  id: uuid (pk),
  token_hash: bytea not null unique,  // SHA-256 of token (we don't store raw)
  username: text not null,
  role: enum('primary_admin', 'admin', 'user') not null default 'user',
  created_by: uuid (fk -> users.id) null,  // null only for bootstrap invitation
  created_at: timestamptz not null default now(),
  expires_at: timestamptz not null,
  redeemed_at: timestamptz null,
  redeemed_by_user_id: uuid (fk -> users.id) null,
  revoked_at: timestamptz null,
}

// refresh_tokens
{
  id: uuid (pk),
  user_id: uuid (fk -> users.id, on delete cascade) not null,
  token_hash: bytea not null unique,  // SHA-256 of refresh token
  family_id: uuid not null,  // for refresh token rotation
  created_at: timestamptz not null default now(),
  expires_at: timestamptz not null,
  revoked_at: timestamptz null,
  user_agent: text null,
  ip: text null,
}

// audit_log (lightweight, for admin visibility)
{
  id: uuid (pk),
  user_id: uuid null,
  actor_user_id: uuid null,  // who did the action
  event_type: text not null,  // 'user.registered', 'auth.login', 'invitation.created', etc.
  metadata: jsonb,  // no sensitive data
  created_at: timestamptz not null default now(),
}
```

## Endpoints

All endpoints return JSON. Errors follow this shape:

```json
{ "error": { "code": "string", "message": "string" } }
```

Standard error codes: `unauthorized`, `forbidden`, `not_found`,
`invalid_input`, `rate_limited`, `expired`, `conflict`, `internal`.

### Public (no auth)

#### `GET /v1/health` — Liveness + readiness

- `/healthz` returns `{ status: 'ok' }` if process is up
- `/readyz` returns `{ status: 'ok', deps: { db: 'ok', redis: 'ok' } }`
  if all deps reachable; 503 otherwise

#### `GET /metrics` — Prometheus exposition format

Standard prom-client output. No auth (firewall this in production).

#### `POST /v1/opaque/register/start`

Begin OPAQUE registration. Requires valid invitation token.

Request:

```json
{
  "invitation_token": "base64url string",
  "registration_request": "base64url(opaque blob)"
}
```

Response:

```json
{
  "registration_response": "base64url(opaque blob)"
}
```

Server behavior:

- Validate invitation token (must exist, not redeemed, not expired,
  not revoked).
- Look up username from invitation.
- Run OPAQUE server registration start with username.
- Stash the partial state in Redis keyed by invitation_token, 5min TTL.
- Return registration response.

Note: We use the **invitation token** as the lookup key during the
two-step registration, not the username. This is because the user
doesn't exist yet.

#### `POST /v1/opaque/register/finish`

Complete OPAQUE registration and create user.

Request:

```json
{
  "invitation_token": "base64url string",
  "registration_record": "base64url(opaque blob)",
  "wrapped_master_key": "base64url(bytes)",
  "wrap_nonce": "base64url(bytes)",
  "recovery_key_wrapped_master_key": "base64url(bytes)",
  "recovery_key_wrap_nonce": "base64url(bytes)"
}
```

Response:

```json
{
  "user_id": "uuid",
  "access_token": "jwt",
  "refresh_token": "opaque-string",
  "expires_in": 900
}
```

Server behavior:

- Re-validate invitation token.
- Verify the OPAQUE registration_record corresponds to the
  registration_request from /start (via stashed state in Redis).
- In a single DB transaction:
  - Create the user (username from invitation, role from invitation).
  - Create the `opaque` auth_method with the registration record and
    wrapped master key.
  - Create the `recovery_key` auth_method with its wrapped master key.
  - Mark invitation as redeemed.
  - Write audit_log entries.
- Issue access + refresh tokens.

Note: Recovery key is required at OPAQUE registration. The client
generates it, shows it to the user once, derives the wrapping key,
and sends only the wrapped MK. We never see the recovery key plaintext.

#### `POST /v1/passkey/register/start`

Begin WebAuthn registration. Requires invitation token (for first
passkey of a new user) OR existing access token (for adding a
passkey to an existing account).

Request (first passkey, with invitation):

```json
{
  "invitation_token": "base64url string"
}
```

Request (additional passkey, with auth):

- Authorization: Bearer <access_token>
- Body: `{}`

Response:

```json
{
  "challenge": "base64url",
  "rp": { "id": "...", "name": "..." },
  "user": { "id": "base64url", "name": "...", "displayName": "..." },
  "pubKeyCredParams": [...],
  "timeout": 60000,
  "attestation": "none",
  "authenticatorSelection": { "userVerification": "preferred", "residentKey": "preferred" },
  "extensions": { "prf": { "eval": { "first": "base64url(salt)" } } }
}
```

The challenge is stored in Redis keyed by invitation_token or user_id
with 5min TTL.

#### `POST /v1/passkey/register/finish`

Complete WebAuthn registration.

Request:

```json
{
  "invitation_token": "base64url string (if first passkey)",
  "credential": { "id": "...", "rawId": "...", "response": {...}, ... },
  "wrapped_master_key": "base64url(bytes)",
  "wrap_nonce": "base64url(bytes)",
  "recovery_key_wrapped_master_key": "base64url(bytes)",
  "recovery_key_wrap_nonce": "base64url(bytes)",
  "label": "iPhone Face ID"
}
```

Notes:

- Recovery key fields are required for first passkey (new account).
- For additional passkeys (existing user), only wrapped_master_key
  - wrap_nonce are required.
- `passkey_prf_supported` is set based on whether the client's response
  includes valid PRF extension output.

Response: same as opaque register/finish.

#### `POST /v1/opaque/login/start`

Begin OPAQUE login.

Request:

```json
{
  "username": "string",
  "ke1": "base64url(opaque blob)"
}
```

Response:

```json
{
  "ke2": "base64url(opaque blob)",
  "wrapped_master_key": "base64url(bytes)",
  "wrap_nonce": "base64url(bytes)"
}
```

Server behavior:

- Look up user by username.
- Look up their `opaque` auth_method.
- Run OPAQUE server login start with their stored credential.
- Stash partial state in Redis keyed by username, 60s TTL.
- Return ke2 + wrapped master key.

Note: If user doesn't exist or doesn't have an opaque method, return
a fake ke2 (use a deterministic-from-username "fake credential")
to prevent user enumeration. The login will fail on /finish but the
timing characteristics don't reveal existence.

#### `POST /v1/opaque/login/finish`

Complete OPAQUE login.

Request:

```json
{
  "username": "string",
  "ke3": "base64url(opaque blob)"
}
```

Response:

```json
{
  "user_id": "uuid",
  "username": "string",
  "role": "user|admin|primary_admin",
  "access_token": "jwt",
  "refresh_token": "opaque-string",
  "expires_in": 900
}
```

#### `POST /v1/passkey/login/start`

Request:

```json
{
  "username": "string (optional, for discoverable credentials can be omitted)"
}
```

Response: WebAuthn authentication options.

#### `POST /v1/passkey/login/finish`

Request:

```json
{
  "credential": {...}
}
```

Response: same as opaque login/finish, plus `wrapped_master_key` +
`wrap_nonce` so client can unwrap MK using PRF-derived AMK.

#### `POST /v1/recovery/start`

Begin recovery flow using recovery key.

Request:

```json
{
  "username": "string"
}
```

Response:

```json
{
  "wrapped_master_key": "base64url(bytes)",
  "wrap_nonce": "base64url(bytes)"
}
```

The client uses the user's recovery key to derive AMK and unwrap the
MK. There's no server-side proof here (yet) — the client demonstrates
knowledge of the recovery key by successfully completing a follow-up
operation. To prevent abuse, this endpoint is heavily rate-limited.

#### `POST /v1/recovery/finish`

After successfully unwrapping MK with recovery key, client must
re-establish at least one fresh auth method.

Request:

```json
{
  "username": "string",
  "proof_of_unwrap": "base64url(...)",
  "new_opaque_record": "...",
  "new_wrapped_master_key": "...",
  "new_wrap_nonce": "...",
  "new_recovery_key_wrapped_master_key": "...",
  "new_recovery_key_wrap_nonce": "..."
}
```

Server-side proof: client derives a deterministic value from the
unwrapped MK (e.g., HMAC(MK, fixed_string)) and the server has the
expected value stored at registration time. This proves the client
unwrapped successfully without revealing the MK.

To do this we need to store at registration:

- `mk_proof_value` on the user: `HMAC-SHA256(MK, "chatsundere-mk-proof-v1")`

This is a public verifier, derived from MK once, stored once. The
client can produce it any time it has MK in hand. Server compares.

After successful proof: delete old auth_methods (except recovery_key
itself, which is being replaced), create new ones. All in a transaction.

### Authenticated (Bearer JWT)

#### `POST /v1/token/refresh`

Request:

```json
{
  "refresh_token": "string"
}
```

Response: new access_token + refresh_token. Old refresh token is
revoked. Use a rotation strategy: if a revoked refresh token is
re-used, revoke the entire family (potential token theft).

#### `POST /v1/auth/logout`

Revoke the current refresh token family.

#### `GET /v1/me`

Returns current user info from JWT, plus list of auth_methods.

Response:

```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "role": "...",
    "created_at": "iso8601",
    "storage_quota_bytes": null
  },
  "auth_methods": [
    {
      "id": "uuid",
      "method_type": "passkey",
      "label": "iPhone Face ID",
      "created_at": "iso8601",
      "last_used_at": "iso8601"
    }
  ]
}
```

#### `DELETE /v1/auth-methods/:id`

Remove an auth method. Requires:

- The auth method belongs to the current user (or current user is admin).
- The user will still have at least one non-recovery auth method after removal.
  - Exception: deleting your only non-recovery method is allowed if you're
    explicitly opting in via a `?confirm_account_lockout=true` query param.
    Don't expose this in normal UI.

#### `POST /v1/auth-methods/passphrase/change`

Change OPAQUE passphrase. Two-step (because OPAQUE is two-step).

This is an authenticated flow: user is already logged in, MK is in their
RAM. They run a new OPAQUE registration as if they were new, but for the
same username, and send the new registration_record + new wrapped MK.

```
POST /v1/auth-methods/passphrase/change/start
POST /v1/auth-methods/passphrase/change/finish
```

Server replaces the existing opaque auth_method row.

### Admin-only (Bearer JWT + role check)

#### `GET /v1/admin/users`

List all users with pagination.

Query: `?limit=20&offset=0&q=search_term`

Response:

```json
{
  "users": [
    {
      "id": "uuid",
      "username": "string",
      "role": "...",
      "created_at": "iso8601",
      "suspended_at": null,
      "storage_used_bytes": 12345,  // queried from sync-service if available
      "last_login_at": "iso8601"
    }
  ],
  "total": 42
}
```

Note: `storage_used_bytes` requires querying sync-service. For Phase 0,
return null and add a TODO.

#### `POST /v1/admin/users/:id/suspend`

Suspend a user. Sets `suspended_at`. Suspended users cannot login.

#### `POST /v1/admin/users/:id/unsuspend`

#### `DELETE /v1/admin/users/:id`

Delete a user. Cascades to auth_methods. Sync-service must also be
notified to delete user's encrypted blobs (Phase 1 concern).

#### `POST /v1/admin/users/:id/role`

Change a user's role. Only primary_admin can do this. Cannot demote
yourself if you're the primary_admin (need to transfer first).

#### `POST /v1/admin/transfer-primary`

Transfer primary_admin role to another admin. Only primary_admin can
do this. Atomic operation.

#### `GET /v1/admin/invitations`

List invitations.

Query: `?status=pending|redeemed|expired&limit=20&offset=0`

#### `POST /v1/admin/invitations`

Create an invitation.

Request:

```json
{
  "username": "string",
  "role": "user|admin",
  "expires_in_seconds": 604800
}
```

Response:

```json
{
  "invitation_id": "uuid",
  "token": "base64url string (THE secret, only returned here)",
  "expires_at": "iso8601",
  "qr_payload": "base64url(json)"
}
```

The `qr_payload` is the JSON-stringified-and-base64url'd version of the
QR code content described earlier. Frontend renders it as QR.

#### `DELETE /v1/admin/invitations/:id`

Revoke an invitation. Sets `revoked_at`.

## JWT Format

Access token (short-lived, 15min):

```json
{
  "sub": "user_uuid",
  "username": "string",
  "role": "primary_admin|admin|user",
  "iat": ...,
  "exp": ...,
  "iss": "chatsundere-auth",
  "aud": ["chatsundere-services"]
}
```

Signed with EdDSA (Ed25519). Public key exposed at:

#### `GET /v1/jwks`

JSON Web Key Set for other services (sync, proxy) to verify JWTs.

Refresh tokens are opaque random strings, hashed and stored server-side.
Rotation on every use. TTL: 30 days.

## Rate Limiting

- Per-IP: 60 requests/minute for all unauthenticated endpoints
- Per-user: 600 requests/minute for authenticated endpoints
- Special: OPAQUE login start/finish — 10 attempts per username per
  15 minutes (to slow online guessing, though OPAQUE makes it useless
  offline anyway)
- Special: recovery start — 5 attempts per username per hour

Use Redis with sliding-window counters.

## Bootstrap

The system starts with zero users. We need a way to create the first
primary_admin. Options:

**Option A: Bootstrap invitation in env var**
At startup, if `AUTH_BOOTSTRAP_INVITATION=true` and no users exist,
auto-create a special invitation with role=primary_admin and print the
QR-payload-URL to logs. Operator scans, registers, deletes the env var.

**Option B: Bootstrap CLI command**
`bun run bootstrap-admin` — creates an invitation, prints QR payload,
exits. Only works if no primary_admin exists yet.

**Chris's pick: Option B.** Simpler, no magic env behavior.

## Prometheus Metrics

Service-specific metrics to expose:

- `auth_registrations_total{method_type, result}` — counter
- `auth_logins_total{method_type, result}` — counter
- `auth_active_users_gauge` — gauge (count of users with last_login in last 30d)
- `auth_invitations_created_total{role}` — counter
- `auth_invitations_redeemed_total{role}` — counter
- `auth_jwt_issued_total{kind}` — counter where kind=access|refresh
- `auth_recovery_attempts_total{result}` — counter

## Security Notes

- All endpoints over HTTPS only in production. Reject HTTP.
- HSTS header with long max-age.
- Strict CSP headers on any HTML response (admin UI is served separately
  but consider proxy paths).
- CORS: allow only configured origins (admin-client and user-client URLs
  from env). No wildcard. Credentials allowed for refresh token cookie
  if we go that route (see below).
- Refresh token storage: **HTTP-only secure cookie, SameSite=Lax**.
  Access token can be returned in JSON for client to hold in memory
  (no localStorage for tokens). Cookie path = `/v1/token/refresh`.
- Constant-time comparison for token hashes (use Node's `crypto.timingSafeEqual`).
- All bytea fields are stored as raw bytes; never log them.
- Audit_log entries do NOT contain crypto material.

## Don't Do

- Don't add an "email" or "phone" field. Username + invitation is the
  identity model.
- Don't add OAuth providers. We're not federating.
- Don't add password complexity rules at the server (OPAQUE doesn't see
  passwords). Client can suggest strength.
- Don't add "forgot password" — that's what recovery key is for, and
  it's by-design unrecoverable beyond that.
- Don't store any audit info that contains user data. Username + event
  type + timestamp + acted-on-resource-id is enough.

## Testing Expectations

- Unit tests for: token hashing, JWT issuance/verification, role checks,
  rate limiter logic.
- Integration tests for full flows:
  - OPAQUE registration via invitation → login → refresh → logout
  - Passkey registration → login (with PRF mock) → add second passkey
  - Recovery flow (simulate lost passkey)
  - Admin: create invitation, list users, suspend user
  - Bootstrap CLI: creates initial primary_admin
- Property tests if Liz has time for `crypto/timing-safe-comparison`.

## Phase 0 Deliverables

1. Service starts, exposes healthz/readyz/metrics
2. Bootstrap CLI works
3. OPAQUE registration + login flows work end-to-end
4. Passkey registration + login flows work end-to-end (PRF supported)
5. Recovery flow works
6. Admin endpoints for users + invitations work
7. JWT issuance + refresh + revocation works
8. JWKS endpoint exposed for other services
9. Audit log writes happen on all significant events
10. Integration test suite green

Phase 1+ deferred: WebAuthn attestation verification beyond "none",
account deletion cascade to sync-service, advanced rate limiting,
device-level refresh token management UI.

## Questions That Came Up — Defer to Chris/Lyra If Needed

- Should recovery_key be re-generatable from within the app (when user
  is logged in with another method) without affecting other methods?
  **Chris's call:** Yes, but show big warning that old recovery key is
  invalidated.
- Should JWT include storage_quota_bytes for sync-service to enforce
  without querying auth-service? **Lyra's call:** Yes, add it to claims.
- Should we support multiple primary_admins via a "founders council"
  role later? **Defer.** For now: exactly one.
