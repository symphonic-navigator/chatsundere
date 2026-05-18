# Foundational Auth Layer — Design Specification

**Date:** 2026-05-18
**Status:** Draft (awaiting Chris's review)
**Authors:** Chris (vision, brainstorming partner) + Liz (architecture, drafting)
**Independent audit:** general-purpose subagent, 2026-05-18 (findings integrated below)
**Scope:** Step 1 of Chatsundere — identity, authentication, key management, admin UI for user management, local-first user client with optional backend linking

---

## 1. Purpose and Scope

Step 1 builds the **identity and authentication layer** that everything else in Chatsundere rests on. It is the largest single piece of foundational work before any chat, persona, sync, or proxy functionality can land. It deliberately covers four packages together (rather than slicing them into independent specs) because their interfaces are tightly coupled: the client-side crypto primitives, the server-side account-linking API, the admin UI for user management, and the user PWA all share one mental model of identity that must stay consistent.

### 1.1 In scope

- Client-side cryptography (`packages/crypto`): key management, OPAQUE client, WebAuthn-PRF, recovery key, DEK derivation, branded types, isomorphic for browser and Bun.
- Server (`apps/auth-service`): Hono on Bun, PostgreSQL via Drizzle, Redis for short-lived state and rate limits, OPAQUE server, WebAuthn server, recovery flow, JWT issuance with EdDSA + JWKS, refresh-token rotation, admin endpoints, audit log, Prometheus metrics, structured logging, health and readiness probes, bootstrap CLI.
- Admin client (`apps/admin-client`): Catppuccin-themed PWA. Login, dashboard with counters, users list and detail (suspend, unsuspend, delete, role change, transfer primary), invitations list with create-and-revoke, audit-log viewer with filters and pagination.
- User client (`apps/user-client`): local-first PWA. Onboarding (create or load local account), local login with passphrase / biometric / recovery key, settings (passphrase change, biometric setup, recovery-key regeneration, auth-method management, server linking and unlinking, server-account self-deletion, logout-everywhere), connectivity awareness.

### 1.2 Out of scope (deferred to later phases)

Chat UI, personas, conversations, attachments, sync, CORS proxy, homelab integration, JWT key rotation, multi-account-per-origin switching, advanced WebAuthn attestation, full content-security-policy hardening, Subresource Integrity for centrally-hosted PWAs.

### 1.3 Key promise that local-first unlocks

A first-class consequence of the local-first design: **users can migrate between operators without data loss**. Unlink from operator A, scan QR for operator B, link. The master key stays the same; locally encrypted data remains decryptable. The server-side account on A is deleted; a new one is created on B and the same master key is wrapped with a fresh OPAQUE AMK for B. This is a feature, not a side effect, and is documented in a dedicated ADR.

---

## 2. Architectural Pivot — Local-First Identity

### 2.1 The pivot

Lyra's original auth-service brief assumed a server-centric model: register on the server, server issues identity, client wraps and stores the resulting master key. We **invert** this:

- The **local account is the primary identity.** On first PWA open the user creates an account: username, passphrase, recovery key. The master key (MK) is generated locally with `crypto.getRandomValues(32)`. Wraps go into IndexedDB.
- The **backend is an optional add-on.** A purely local account works without any server contact. By scanning a QR-encoded invitation the user can link to a server; the server then learns one additional wrapping of the same MK and can issue JWTs. Linked accounts get sync, CORS proxy (phase 2+), homelab integration (later) as additive features.
- **`auth-service` is conceptually an account-linking service.** The endpoints Lyra named `register` become `link`. The server never sees the plaintext MK, recovery key, or passphrase. All E2EE guarantees are preserved.

### 2.2 Component layout (four squash units)

| # | Squash | Paths | Purpose |
|---|---|---|---|
| A | Crypto package | `packages/crypto/**`, `packages/shared-types/**` | Local KDFs, OPAQUE client, WebAuthn-PRF, MK / DEK primitives, branded types, IndexedDB helpers with schema versioning |
| B | Auth service | `apps/auth-service/**`, `infra/` | Hono service, Drizzle schema and migrations, OPAQUE / WebAuthn / recovery server logic, JWT with JWKS, refresh-token rotation, rate limiting, admin endpoints, audit log, bootstrap CLI |
| C | Admin client | `apps/admin-client/**` | Catppuccin PWA: login, dashboard, users, invitations, audit-log viewer |
| D | User client | `apps/user-client/**` | Local-first PWA: onboarding, login, settings, linking, connectivity awareness |

A precedes B because B's tests need crypto primitives; B precedes C because C consumes admin endpoints; D can in principle start in parallel with C but is sequenced last to keep one focus per squash. Larissa audits before A, B, and C; D is a UI consumer of vetted primitives and skips formal audit.

### 2.3 Truth sources for identity

| Location | Holds | Created at |
|---|---|---|
| IndexedDB (client) | `local_account`: username, `local_salt`, wrapped MK (local AMK), wrapped MK (recovery AMK), `recovery_verifier`, integrity HMAC, schema version, created-at | Local account creation |
| IndexedDB (client) | `linked_account` (only if linked): `server_user_id`, `base_url`, `issuer_label`, `role`, wrapped MK (opaque AMK), wrap nonce, per-passkey wrapped MK | Successful linking |
| IndexedDB (client) | `local_passkey_credentials` (zero or more): credential id, public key, sign counter, PRF-wrapped MK, label, AAGUID, created-at | Biometric setup or add-passkey |
| PostgreSQL (server) | `users` with username, role, `recovery_verifier_hmac_key`, suspended-at; `auth_methods` with OPAQUE credential or passkey credential, wrapped MK, wrap nonce, AAD context, label | Linking |

There is no notion of "server-assigned username". Usernames flow from client to server; UNIQUE constraint on the server resolves conflicts at link time.

### 2.4 What stays in memory only

The plaintext MK lives only in `MasterKeySession`'s in-memory buffer, zeroed on close. The access token lives only in JS memory of the active tab. The refresh token lives only in an HTTP-only cookie set by the server. No plaintext key, no passphrase, no recovery key ever crosses the wire to the server, and nothing in plaintext ever goes to IndexedDB.

---

## 3. Crypto Architecture

### 3.1 KDF layering at a glance

```
                    +----------------------------+
                    |  Master Key (32 bytes)     |
                    |  generated locally on      |
                    |  first account creation    |
                    +-----+--------+-------------+
                          |        |
        AES-256-GCM wraps |        | HKDF-SHA256 derives
                          |        |
   +-------+-------+------+--+----+--------+----------+
   |       |       |         |             |          |
   v       v       v         v             v          v
 local   recov   local_prf  opaque       prf_amk    DEK[ctx]
  amk     amk     amk        amk         (per         (per
                  (Opt-in)   (linked)    passkey,     context,
                                          linked)     phase 1+)
   |       |        |         |             |
 Argon2id HKDF    HKDF       HKDF          HKDF
 (pass,  (RK)   (PRF out)  (OPAQUE       (PRF out)
  salt)                     export)
   |       |        |         |             |
 IDB     IDB     IDB        IDB           IDB
 only    only    only       + Server      + Server
                            wrapped       wrapped
```

The MK has exactly three resting places: in-memory in an active session, AES-GCM-wrapped in IndexedDB, AES-GCM-wrapped in `auth_methods` on the server (only for linked accounts).

### 3.2 Wrapping topology by account mode

| Mode | Wraps in IndexedDB | Wraps on server |
|---|---|---|
| Local only | `local_amk`, `recovery_amk`, optional `local_prf_amk` per registered local biometric | none |
| Linked | all of the above, plus `opaque_amk` and `prf_amk` per registered server-side passkey | `opaque_amk` and one `prf_amk` per registered server-side passkey |

The symmetric storage of `opaque_amk` and `prf_amk` wraps both client-side and server-side is deliberate. It allows offline login via a previously-used passkey, and gives a recovery path if the local-side `local_amk` wrap is ever damaged (the client can re-derive from the server side when next online).

### 3.3 KDF parameters

| KDF | Parameters | Used for |
|---|---|---|
| Argon2id (via `hash-wasm`) | `m_cost = 64 MiB`, `t_cost = 3`, `p = 1`, salt = 16 random bytes, output = 32 bytes | `local_amk` from the user's passphrase. Conservative for now; benchmark on low-end mobile devices before v0.1.0 and re-tune if user-perceived latency is unacceptable. Per-device auto-tuning is deferred. |
| HKDF-SHA256 | salt = empty, info = `"chatsundere-amk-v1::<context>"`, output = 32 bytes | All AMKs derived from OPAQUE export key, PRF output, recovery key. All DEKs. |
| AES-256-GCM | 12-byte random nonce per wrap, 16-byte authentication tag, **AAD bound to `"${user_id_or_local_uuid}::${method_type}::${schema_version}"`** | All wrap-of-MK operations and all DEK encryption. AAD-binding (audit finding L1) prevents a server-side attacker from swapping wrap rows between users or methods. |

PBKDF2, bcrypt, scrypt are not used. WebCrypto SubtleCrypto is used for everything except OPAQUE (which is its own WASM library) and Argon2id (which is `hash-wasm`).

### 3.4 OPAQUE specifics (linked mode only)

Library: `@serenity-kit/opaque`. Argon2id is the library's internal KDF; this is a separate Argon2id instance from our local one.

- Server identity string for OPAQUE: `"${base_url}/auth/v1"`. Bound into every OPAQUE hash; anti-replay across instances.
- Username also bound into OPAQUE hash; anti-replay across users.
- Client-side `exportKey` (32 bytes) becomes `opaque_amk = HKDF(exportKey, info="chatsundere-amk-v1::opaque")`.
- **OPAQUE start-state Redis key (audit finding H1):** the server returns a random 16-byte URL-safe session identifier from `/start`. The client echoes this identifier in `/finish`. Redis key is `opaque:<flow>:<session_id>`, TTL 60 seconds. Never key Redis by username, invitation token, or any client-derivable value.

### 3.5 WebAuthn-PRF specifics

- PRF input salt is fixed application-wide: `SHA-256("chatsundere-mk-derivation-v1")`. Passed in `extensions.prf.eval.first`.
- PRF output (32 bytes) becomes `prf_amk = HKDF(prfOutput, info="chatsundere-amk-v1::prf::<credential_id_prefix>")`. Credential-id prefix in info prevents cross-authenticator replays.
- WebAuthn RP id is the **PWA origin**, not the auth-service origin. Example: `chatsundere.example.com`.
- PRF-less passkeys are refused at registration (per ADR 0005).
- **Synced passkey sign-counter policy (audit finding M1):** cloud-synced passkeys (iCloud, 1Password, etc.) legitimately return `signCount = 0` on every assertion. Strict monotonic enforcement would lock these users out on device swaps. Solution: maintain an AAGUID allow-list of known synced authenticators; for AAGUIDs on the list, skip monotonic checks but log the assertion. For others, enforce strict monotonic. The list ships as a constant in `packages/crypto`; updates require an ADR.

### 3.6 Recovery flow primitives

The recovery key is 32 random bytes generated client-side at first registration. Encoding is Crockford base32 (case-insensitive, no `O` `I` `L`), grouped in fours, with a checksum character at the end: `K7QW-9X4P-2NM3-...-XX`. The string is shown to the user exactly once and must be confirmed-stored before the user can proceed.

`recovery_amk = HKDF(recovery_key_bytes, info="chatsundere-amk-v1::recovery")` wraps the MK on every device the user touches.

**Server-side recovery proof — challenge-response, not static comparator (audit findings C1 plus my earlier replacement of `mk_proof_value`):**

The server never stores anything that, by itself, lets it (or a DB attacker) issue a recovery. Instead:

- At link time, the client computes `verifier_key = HKDF(recovery_key, info="chatsundere-rk-verifier-key-v1")` (32 bytes) and sends it once. Server stores it on `users.recovery_verifier_key`.
- At recovery start, the client sends `{username}`. Server returns `{nonce (16 bytes random), wrapped_mk_recovery, wrap_nonce}` and stashes `(username, nonce)` in Redis with 60-second TTL.
- The client unwraps MK locally using its recovery key, then proves freshness by computing `proof = HMAC(verifier_key, nonce || username || server_id)`. The client cannot compute this without holding the recovery key, because `verifier_key` is itself derived from the recovery key.
- At recovery finish, the client sends `{username, nonce, proof, new_opaque_record, new_wrapped_mk_opaque, new_wrap_nonce, new_recovery_verifier_key, new_wrapped_mk_recovery, new_wrap_nonce_recovery}`. Server verifies the proof using its stored `verifier_key`, atomically deletes the user's prior OPAQUE and passkey auth methods, installs the new OPAQUE auth method, replaces `recovery_verifier_key`. All in one transaction; audit event written.

DB leak alone: gives away `verifier_key` per user, which is `HMAC(recovery_key, ...)` — irreversible, 256-bit-entropy preimage. No recovery is performable without the recovery key itself.

Eavesdropper on `/recovery/start` response: sees the wrapped MK but cannot unwrap it without the recovery key.

Replay of an old `/recovery/finish` request: nonce is single-use in Redis, replay rejected.

### 3.7 DEK derivation (phase 1+ data; architecture pinned now)

`DEK_for(context) = HKDF(MK, salt=empty, info="chatsundere-dek-v1::<context>")`.

Example contexts: `vault/conversations`, `vault/personas`, `prefs`, `attachments`. DEKs are never stored, always derived on demand.

### 3.8 `MasterKeySession`

In-memory object held by the application layer after a successful login.

```typescript
interface MasterKeySession {
  readonly id: string;
  readonly userId: string;
  readonly mode: 'local' | 'linked';
  readonly username: string;
  readonly role?: 'primary_admin' | 'admin' | 'user';
  readonly accessToken?: string;
  readonly online: boolean;

  deriveDek(context: string): Promise<DEK>;
  encrypt(plaintext: Uint8Array, context: string): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }>;
  decrypt(args: { ciphertext: Uint8Array; nonce: Uint8Array; context: string }): Promise<Uint8Array>;
  rewrapWithAmk(newAmk: AMK, target: 'local' | 'opaque' | 'prf', methodId?: string): Promise<WrappedKey>;
  produceRecoveryProof(nonce: Uint8Array, serverId: string): Promise<Uint8Array>;
  close(): void;
}
```

Sessions in `mode = 'local'` cannot rewrap for `opaque`; UI disables the corresponding controls. Sessions degraded to local-only because the server is unreachable mark `online = false`.

### 3.9 IndexedDB integrity HMAC (audit finding M9)

XSS landing before unlock could rewrite `wrapped_mk_local` with an attacker-controlled blob whose AMK the attacker knows. When the user unlocks, the MK ends up being the attacker's choice, and all subsequent encryption flows to the attacker.

Defence: every wrapped-MK bundle in IndexedDB carries an integrity tag `HMAC(HKDF(local_amk, "chatsundere-integrity-v1"), wrapped_mk || wrap_nonce || aad)`. After deriving `local_amk` on unlock, the client first verifies the HMAC and refuses to use any wrapped-MK row whose HMAC does not match. Attacker without knowledge of the passphrase cannot forge a matching HMAC.

The same integrity construction protects the recovery-wrapped MK (keyed off `recovery_amk`) and the PRF-wrapped MKs (keyed off the relevant PRF AMK).

### 3.10 IndexedDB schema versioning

Single database `chatsundere`. Object stores: `local_account`, `linked_account`, `local_passkey_credentials`, `staging` (for password-change atomicity, see section 5.7).

Version starts at 1 in phase 0. Every schema change bumps the version and adds an `onupgradeneeded` handler that migrates row shapes. A versioned schema constant lives in `packages/crypto/src/db/schema.ts`. Migration handlers are unit-tested with fixtures of every prior version.

### 3.11 Buffer zeroing and constant-time comparisons

Best-effort zeroing on session close: every Uint8Array holding key material is overwritten with zeros before the reference is released. Documented limitation: JavaScript garbage collection may have copied the buffer; this is the platform's reality.

All token-hash comparisons (refresh tokens, recovery verifiers, invitation tokens) use `crypto.timingSafeEqual` (Bun) or its WebCrypto-equivalent constant-time check. AES-GCM authentication-tag verification is constant-time by construction.

### 3.12 Runtime preconditions (audit finding L5)

`packages/crypto` exposes a `assertRuntimeSupport()` function called at application boot in both clients. It refuses to continue if any of these are missing: `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder`, `Uint8Array`, `IndexedDB`. Failure is loud — an immediate user-facing error screen, not silent fallback.

---

## 4. Data Model

### 4.1 PostgreSQL schema (Drizzle)

```typescript
// users
{
  id: uuid (pk, default uuid_generate_v7()),
  username: text (unique, not null, citext extension required),
  role: enum('primary_admin', 'admin', 'user') (not null, default 'user'),
  recovery_verifier_key: bytea (not null),   // HMAC(recovery_key, "...verifier-key-v1")
  suspended_at: timestamptz (null),
  created_at: timestamptz (not null, default now()),
  storage_quota_bytes: bigint (null),        // null = unlimited; not enforced in phase 0
  // no email, no phone, no display_name in phase 0
}

// partial unique index for primary_admin
CREATE UNIQUE INDEX users_one_primary_admin
  ON users (role) WHERE role = 'primary_admin';

// auth_methods
{
  id: uuid (pk, default uuid_generate_v7()),
  user_id: uuid (fk users.id, on delete cascade, not null),
  method_type: enum('opaque', 'passkey') (not null),
                                             // recovery is NOT here; it lives client-side gated by recovery_verifier_key
  label: text (null),                        // user-facing
  opaque_credential: bytea (null),           // OPAQUE registration blob
  passkey_credential_id: bytea (null, unique partial when not null),
  passkey_public_key: bytea (null),
  passkey_sign_count: bigint (null),
  passkey_aaguid: uuid (null),
  passkey_transports: jsonb (null),
  wrapped_master_key: bytea (not null),
  wrap_nonce: bytea (not null),
  wrap_algo: text (not null, default 'AES-256-GCM'),
  wrap_aad: bytea (not null),                // bound context, see section 3.3
  created_at: timestamptz (not null, default now()),
  last_used_at: timestamptz (null),
}

CREATE UNIQUE INDEX auth_methods_passkey_credential
  ON auth_methods (passkey_credential_id)
  WHERE passkey_credential_id IS NOT NULL;

// invitations
{
  id: uuid (pk, default uuid_generate_v7()),
  token_hmac: bytea (not null, unique),      // HMAC-SHA256(token, INVITATION_HMAC_KEY) — keyed, not plain SHA-256 (audit M5)
  role: enum('primary_admin', 'admin', 'user') (not null, default 'user'),
  // no username field — user picks at link time
  issuer_label: text (null),                 // optional UI hint shown to the joining user
  created_by: uuid (fk users.id, null only for bootstrap),
  created_at: timestamptz (not null, default now()),
  expires_at: timestamptz (not null),
  redeemed_at: timestamptz (null),
  redeemed_by_user_id: uuid (fk users.id, null),
  revoked_at: timestamptz (null),
  attempt_count: int (not null, default 0),  // for per-token attempt rate-limit (audit M6 / invitation user-enum)
}

// refresh_tokens
{
  id: uuid (pk, default uuid_generate_v7()),
  user_id: uuid (fk users.id, on delete cascade, not null),
  token_hash: bytea (not null, unique),      // SHA-256 of the opaque refresh token
  family_id: uuid (not null),
  created_at: timestamptz (not null, default now()),
  expires_at: timestamptz (not null),
  revoked_at: timestamptz (null),
  rotated_to_id: uuid (null),                // when this token was rotated, points at the successor; allows re-use detection (audit L2)
  user_agent: text (null),
  // no ip column — explicit privacy decision
}

// audit_log
{
  id: uuid (pk, default uuid_generate_v7()),
  user_id: uuid (null),                      // the subject of the event
  actor_user_id: uuid (null),                // the user who performed it (may equal user_id, may be null for system)
  event_type: text (not null),               // see canonical list below
  metadata: jsonb (not null, default '{}'),  // schema-validated per event_type (audit M4), max 2 KiB enforced at insert
  created_at: timestamptz (not null, default now()),
}

CREATE INDEX audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX audit_log_user_id ON audit_log (user_id) WHERE user_id IS NOT NULL;
```

UUIDv7 throughout. `citext` extension required (enabled in initial migration).

### 4.2 IndexedDB schema (version 1)

Object stores:

```typescript
// local_account (single row, key='primary')
{
  schema_version: 1,
  username: string,
  local_salt: Uint8Array,                   // 16 bytes
  wrapped_mk_local: Uint8Array,
  wrap_nonce_local: Uint8Array,             // 12 bytes
  wrap_aad_local: Uint8Array,
  integrity_hmac_local: Uint8Array,         // 32 bytes
  wrapped_mk_recovery: Uint8Array,
  wrap_nonce_recovery: Uint8Array,
  wrap_aad_recovery: Uint8Array,
  integrity_hmac_recovery: Uint8Array,
  recovery_verifier_key: Uint8Array,        // same value the server has if linked
  created_at: Date,
}

// linked_account (single row, key='primary'; absent if not linked)
{
  server_user_id: string,                   // UUID
  base_url: string,
  issuer_label: string | null,
  role: 'primary_admin' | 'admin' | 'user',
  wrapped_mk_opaque: Uint8Array,
  wrap_nonce_opaque: Uint8Array,
  wrap_aad_opaque: Uint8Array,
  integrity_hmac_opaque: Uint8Array,
  linked_at: Date,
}

// local_passkey_credentials (zero or more, key=credential_id)
{
  credential_id: Uint8Array,
  public_key: Uint8Array,
  sign_counter: number,
  aaguid: string | null,
  label: string,                            // user-set, e.g. "iPhone Face ID"
  wrapped_mk_prf: Uint8Array,
  wrap_nonce_prf: Uint8Array,
  wrap_aad_prf: Uint8Array,
  integrity_hmac_prf: Uint8Array,
  is_synced_with_server: boolean,           // true when also registered server-side
  created_at: Date,
}

// staging (transient, used during password change for atomicity, see 5.7)
{
  key: 'pending_passphrase_change',
  new_local_salt: Uint8Array,
  new_wrapped_mk_local: Uint8Array,
  new_wrap_nonce_local: Uint8Array,
  new_wrap_aad_local: Uint8Array,
  new_integrity_hmac_local: Uint8Array,
  server_state: 'pending' | 'committed' | 'rolled_back',
  created_at: Date,
}
```

---

## 5. Endpoints and Flows

### 5.1 Endpoint catalogue

All paths under `${base_url}/auth` plus version `/v1`. The default `base_url` in production layout is `https://chatsundere.example.com/api` (single-domain, path-routed); subdomain deployments are also supported through configuration. CORS allowed origins come from `CORS_ALLOWED_ORIGINS` env, comma-separated.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/healthz` | none | Liveness only |
| GET | `/readyz` | none | Includes `{ db: 'ok', redis: 'ok' }` or 503 |
| GET | `/metrics` | none | Prometheus; firewall in production. No PII labels (audit M3). |
| GET | `/v1/jwks` | none | Public keys for JWT verification by sibling services |
| POST | `/v1/link/opaque/start` | invitation token | Returns `{ session_id, registration_response }` |
| POST | `/v1/link/opaque/finish` | invitation token | Body: `{ session_id, username, registration_record, wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque, wrapped_mk_recovery, wrap_nonce_recovery, wrap_aad_recovery, recovery_verifier_key }`. UNIQUE username check; 409 on conflict |
| POST | `/v1/link/passkey/start` | invitation token *or* bearer | Returns `{ session_id, options }` |
| POST | `/v1/link/passkey/finish` | invitation token *or* bearer | Adds passkey; first-time link includes recovery and OPAQUE fields if invitation-authorised |
| POST | `/v1/opaque/login/start` | none | Returns `{ session_id, ke2, wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque }`. Fake response for unknown usernames (deterministic from username), constant-time |
| POST | `/v1/opaque/login/finish` | none | Body includes `session_id`, `ke3`. Returns `{ user_id, role, access_token, expires_in }` and sets refresh-cookie |
| POST | `/v1/passkey/login/start` | none | Returns `{ session_id, options }` |
| POST | `/v1/passkey/login/finish` | none | Body includes `session_id`, credential assertion, returns same as opaque/finish |
| POST | `/v1/recovery/start` | none | Body: `{ username }`. Returns `{ nonce, wrapped_mk_recovery, wrap_nonce_recovery, wrap_aad_recovery }`. Heavy rate limit |
| POST | `/v1/recovery/finish` | none | Body: `{ username, nonce, proof, new_opaque_record, new_wrapped_mk_opaque, ..., new_recovery_verifier_key, new_wrapped_mk_recovery, ... }`. Atomic install |
| POST | `/v1/token/refresh` | refresh cookie | Body none. Rotation per family with re-use detection (audit L2) |
| POST | `/v1/auth/logout` | bearer | `?revoke_all=true` revokes all families of user |
| GET | `/v1/me` | bearer | User info + auth-methods list. **Username always read from DB, never from JWT claim (audit L3)**. EXISTS-check via short-TTL Redis cache (audit H4) |
| PATCH | `/v1/me` | bearer | Username change. Uses UNIQUE constraint, translates `23505` to 409 (audit M6) |
| DELETE | `/v1/me` | bearer | Self-delete server account. Refresh-family cascade; SERIALIZABLE txn (audit H4) |
| DELETE | `/v1/auth-methods/:id` | bearer | Last non-recovery requires `?confirm_lockout=true` |
| POST | `/v1/auth-methods/passphrase/change/start` | bearer | OPAQUE registration start, new passphrase. Returns `{ session_id, registration_response }` |
| POST | `/v1/auth-methods/passphrase/change/finish` | bearer | Body includes `session_id`, new record, new wraps. Server replaces opaque auth_method row |
| GET | `/v1/admin/users` | bearer + role ≥ admin | `?q=&limit=&offset=`; returns `last_login_at`, role, suspended state |
| GET | `/v1/admin/users/:id` | bearer + role ≥ admin | Detail incl. auth-methods overview, audit-events count |
| POST | `/v1/admin/users/:id/suspend` | bearer + role ≥ admin | Revoke all refresh-token families; max-15-min JWT lifetime tail (audit H5 self-guard) |
| POST | `/v1/admin/users/:id/unsuspend` | bearer + role ≥ admin | — |
| DELETE | `/v1/admin/users/:id` | bearer + role ≥ admin | Server delete; refresh-family cascade. Self-target rejected unless preceded by transfer (audit H5) |
| POST | `/v1/admin/users/:id/role` | bearer + role = primary_admin | Self-demotion rejected unless preceded by transfer (audit H5) |
| POST | `/v1/admin/transfer-primary` | bearer + role = primary_admin | Atomic role swap in a SERIALIZABLE txn |
| GET | `/v1/admin/invitations` | bearer + role ≥ admin | `?status=pending|redeemed|expired|revoked&limit=&offset=` |
| POST | `/v1/admin/invitations` | bearer + role ≥ admin | Returns `{ invitation_id, token, expires_at, qr_payload }` — token is THE secret, only here |
| DELETE | `/v1/admin/invitations/:id` | bearer + role ≥ admin | Sets `revoked_at` |
| GET | `/v1/admin/audit-log` | bearer + role ≥ admin | `?event_type=&user_id=&since=&until=&limit=&offset=` |

Bootstrap CLI is **not** an HTTP endpoint; see section 8.1.

Error envelope: `{ "error": { "code": "string", "message": "string" } }`. Standard codes: `unauthorized`, `forbidden`, `not_found`, `invalid_input`, `rate_limited`, `expired`, `conflict`, `internal`, `username_taken`, `invitation_consumed`, `invitation_attempts_exhausted`.

### 5.2 Storyboard — bootstrap

1. Operator starts the stack: `docker compose -f infra/docker-compose.dev.yml up -d`.
2. Operator runs `bun run --filter @chatsundere/auth-service bootstrap-admin`.
3. CLI refuses if any user with `role='primary_admin'` already exists, or if `auth_methods` is non-empty (audit M7 hardening of ADR 0004). Otherwise it generates a bootstrap invitation row with `role='primary_admin'`, `expires_at = now() + 24h`, `created_by = NULL`, writes the QR-payload to `${XDG_RUNTIME_DIR}/chatsundere-bootstrap-${invitation_id}.json` with mode `0600`, prints **only the path** to stdout, schedules auto-delete after 10 minutes or after first successful redemption. (Audit M7: stdout never carries the secret.)
4. Operator opens user-client (typically `http://localhost:5173` in dev, the deployment URL in production), sees the empty-IndexedDB state and the onboarding screen.
5. Operator creates a local account (their preferred username, passphrase, recovery key).
6. Operator opens Settings → Server linking → "Open invitation file" or "Paste invitation URL" or "Scan QR".
7. Linking flow runs (5.5). Operator becomes primary_admin.
8. Operator opens admin-client and logs in.

### 5.3 Storyboard — local account creation

1. PWA opens with empty IndexedDB. Onboarding screen: "Welcome. Create or load an account."
2. "Create account" → form: username (3-32 chars, lowercase `[a-z][a-z0-9_-]*`, NFKC-normalised; reserved words `admin`, `root`, `system`, `me`, `you` rejected — also enforced server-side at link time via Valibot schema, returning 400 `invalid_input` if a client lies), passphrase + confirmation (minimum 8 characters, no upper-bound, no composition rules — strength is the user's responsibility, OPAQUE does not see it).
3. Client (`packages/crypto`):
   - generates MK (32 random bytes), `local_salt` (16 bytes), `recovery_key` (32 bytes).
   - derives `local_amk = Argon2id(passphrase, local_salt)`, `recovery_amk = HKDF(recovery_key)`, `verifier_key = HKDF(recovery_key, info="chatsundere-rk-verifier-key-v1")`.
   - wraps MK with each AMK (random nonce, AAD bound).
   - computes integrity HMACs.
   - writes `local_account` row to IndexedDB.
4. Recovery-key reveal: modal showing the Crockford-base32 string with copy button. Confirm-checkbox plus continue button (disabled until checked).
5. App shell (phase 0: placeholder "Chat coming in a later phase"; phase 1+: actual chat UI). Settings is reachable.

### 5.4 Storyboard — local login (three variants)

PWA opens, IndexedDB has `local_account`. Login screen shows the username (single-account-per-origin).

**a) Passphrase:** user types passphrase → `local_amk` derived → integrity HMAC verified → wrapped MK unwrapped → MK in RAM → `MasterKeySession` created.

**b) Biometric unlock** (if `local_passkey_credentials` non-empty and `isUserVerifyingPlatformAuthenticatorAvailable()` resolves to true): primary button "Unlock with Face ID / fingerprint" → WebAuthn assertion with locally-generated 32-byte random challenge → returned signature verified locally with stored public key → sign-counter checked (strict monotonic, or skipped for allow-listed AAGUIDs per 3.5) → PRF output derived → `prf_amk` derived → integrity HMAC verified → MK unwrapped. Fallback "Use passphrase" link always visible.

**c) Recovery key:** "Forgot passphrase?" link → recovery-key input → `recovery_amk` derived → integrity HMAC verified → MK unwrapped. Immediately forced to a "Set new passphrase" screen (recovery use-case implies the passphrase was lost). New `local_salt` generated; new `local_amk` derived; new wrap installed.

After successful local unlock, if `linked_account` exists and `navigator.onLine` is true, the client transparently starts a server OPAQUE login with the same passphrase entered (variant a) or skips server auth (variants b and c — biometric unlock implies the user has a passkey that also unlocks server-side; recovery flow transitions through `/v1/recovery/start` and `/finish` if user opts in, see 5.8).

### 5.5 Storyboard — linking to a backend

Precondition: user is locally logged in, MK in RAM, has an invitation URL or QR code.

1. Settings → Server linking → QR scan or URL paste.
2. Client parses the QR payload:
   ```json
   {
     "v": 1,
     "kind": "invitation",
     "token": "base64url",
     "base_url": "https://chatsundere.example.com/api",
     "role": "user",
     "issuer_label": "Chris's Chatsundere instance"
   }
   ```
3. Confirmation screen: "Link to `<issuer_label>` (`<base_url>`) with role `<role>`. Your username `<local_username>` will be created on this server. Continue?"
4. On confirm:
   - Client posts `POST ${base_url}/auth/v1/link/opaque/start` with `{ invitation_token, registration_request }`. Server validates the invitation (exists, not redeemed, not expired, not revoked, `attempt_count < 3` per audit), increments `attempt_count`, runs OPAQUE server-side start, stashes state in Redis keyed by a fresh random session id, returns `{ session_id, registration_response }`.
   - Client runs OPAQUE finish, derives `exportKey`, derives `opaque_amk`, wraps MK with it, computes integrity HMAC.
   - Client computes `verifier_key` (same value already in local IndexedDB, since same recovery key).
   - Client posts `POST ${base_url}/auth/v1/link/opaque/finish` with `{ session_id, username, registration_record, wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque, wrapped_mk_recovery, wrap_nonce_recovery, wrap_aad_recovery, recovery_verifier_key }`.
   - Server: SERIALIZABLE transaction. Re-validate invitation. Check username UNIQUE. On conflict: 409 `{ error: { code: 'username_taken' } }`. Otherwise: create `users` row (role from invitation, recovery_verifier_key stored), create `auth_methods` row (method_type='opaque', wraps), mark invitation redeemed, write audit events `user.linked` and `invitation.redeemed`. Issue access token + refresh token (cookie).
5. On 409: client shows a dialog "The username 'alice' is taken on this server. Would you like to choose another?" → user can rename locally (see 5.11) and retry, or cancel.
6. On success: client writes `linked_account` to IndexedDB. If `local_passkey_credentials` contains entries with `is_synced_with_server = false`, the user sees a dismissible banner in Settings → Authentication methods: "Sync your biometric unlock to this server so it works for backend features". Per-passkey button to trigger one WebAuthn re-authentication and the corresponding `POST /v1/link/passkey/finish` with bearer auth; on success `is_synced_with_server` flips to `true`. Not auto-triggered, because chaining several WebAuthn prompts immediately after linking is poor UX.
7. UI: "Linked to `<issuer_label>`. Sync and proxy features will become available in later versions."

### 5.6 Storyboard — online login in linked mode (transparent double auth)

1. PWA open: IndexedDB has both `local_account` and `linked_account`. `navigator.onLine` is true.
2. Login screen as in 5.4.
3. User enters passphrase.
4. Client always starts both halves in parallel (audit H2):
   - Local: derives `local_amk`, verifies integrity HMAC, attempts unwrap.
   - Server: posts `POST /v1/opaque/login/start` with `{ username, ke1 }`, server returns `{ session_id, ke2, wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque }`. Client runs OPAQUE finish, derives `opaque_amk` (discarded — MK already in RAM from local), posts `POST /v1/opaque/login/finish` with `{ session_id, ke3 }`, server replies with JWT + refresh-cookie.
5. Commit gate:
   - Local OK and server OK: `MasterKeySession { mode: 'linked', accessToken, online: true }`.
   - Local OK and server 5xx / network error: `MasterKeySession { mode: 'linked', online: false }`. Banner shows "Server unreachable, local session active". Background retry on next online event.
   - Local OK and server 401: `MasterKeySession { mode: 'linked', online: false }` plus persistent banner "Server authentication failed — your passphrase may have been changed elsewhere. Sync your passphrase in Settings". Backend features stay disabled.
   - Local fails (wrong passphrase): the server-side response is computed and discarded. UI shows "Wrong passphrase" only. (Audit H2: this removes the local-first-specific oracle. The standard OPAQUE response-code oracle remains; mitigated by rate-limiting.)

### 5.7 Storyboard — passphrase change (three scenarios)

| Scenario | Steps |
|---|---|
| Local only (online or offline) | (1) New passphrase entered. (2) Client derives new local-side material into RAM. (3) Writes new wrap to IndexedDB `staging` slot. (4) Atomic swap into `local_account.primary` (server_state field on staging marks `committed`; primary updated; staging deleted). |
| Linked + online | (1) New passphrase entered. (2) Client derives new server-side OPAQUE registration (the start/finish dance) and new local-side material — all in RAM. (3) Writes the new local material to `staging` with `server_state = 'pending'`. (4) Calls `POST /v1/auth-methods/passphrase/change/finish` on the server. (5) On server-OK: updates staging `server_state = 'committed'`, performs the atomic swap into primary, deletes staging. (6) On server-fail: staging marked `rolled_back` and deleted; user notified, original passphrase still valid both sides. (Audit H3: this is the correct ordering — local prepared first, server committed, then local atomically committed. Crash recovery on next boot inspects staging: `pending` → still safe to rollback; `committed` → finish the swap.) |
| Linked + offline | Button disabled with tooltip "Requires server connection — your passphrase is also registered with the server. Sync up online to change it." |

In all three, MK itself does not change; only its wraps. No data re-encryption is necessary.

### 5.8 Storyboard — recovery flow

**a) Local-only account:** "Forgot passphrase?" → recovery-key input → unwrap locally → forced "Set new passphrase" → new local material installed. No server interaction.

**b) Linked account:** the user chooses between "Local recovery only" (server-side method untouched; user is locally OK but server features stay broken until next passphrase synchronisation) or "Local plus server recovery" (full):

Full path:

1. Client posts `POST /v1/recovery/start` with `{ username }`. Server returns `{ nonce, wrapped_mk_recovery, wrap_nonce, wrap_aad }`, stashes `(username, nonce)` in Redis with 60-second TTL.
2. Client unwraps MK locally using the user-entered recovery key, verifies integrity HMAC.
3. Client prompts the user for a new passphrase, derives new OPAQUE state and new local material.
4. Client computes `proof = HMAC(verifier_key, nonce || username || server_id)`.
5. Client posts `POST /v1/recovery/finish` with `{ username, nonce, proof, new_opaque_record, new_wrapped_mk_opaque, new_wrap_nonce_opaque, new_wrap_aad_opaque, new_recovery_verifier_key, new_wrapped_mk_recovery, new_wrap_nonce_recovery, new_wrap_aad_recovery }`. (Recovery key itself rotated if the user opts to regenerate; defaults to keeping the same recovery key, only re-wrapping the MK.)
6. Server verifies the proof using `users.recovery_verifier_key`. SERIALIZABLE transaction: deletes all `auth_methods` rows for this user (opaque + passkeys), installs the new opaque method, updates `recovery_verifier_key`, writes audit event `recovery_used`.
7. Returns access token + refresh cookie. Client installs new local material (staging-swap pattern), writes new `linked_account`.

Passkeys are deliberately deleted because we cannot prove the recovering user is the original device owner — only that they hold the recovery key.

### 5.9 Storyboard — biometric unlock setup

Precondition: user is logged in, MK in RAM, platform probe returns true.

1. Settings → Authentication methods → "Set up biometric unlock".
2. Hint text: "On this device, you'll be able to unlock with Face ID / Fingerprint. Your passphrase remains valid."
3. Client generates a local random challenge, triggers WebAuthn registration with PRF extension enabled.
4. Authenticator prompts user.
5. Client receives credential + `prfOutput`. Derives `prf_amk = HKDF(prfOutput, info="chatsundere-amk-v1::prf::<credential_id_prefix>")`. Wraps MK with `prf_amk`. Computes integrity HMAC.
6. Writes a row to `local_passkey_credentials` (credential_id, public_key, sign_counter=0, aaguid, label="This device", wrap, integrity HMAC, `is_synced_with_server=false`).
7. If `linked_account` exists: client immediately runs `POST /v1/link/passkey/start` and `/finish` with bearer auth, registering the same credential server-side. On success, `is_synced_with_server=true`.
8. UI: "Activated. Next time you open the app, unlock with Face ID."

### 5.10 Storyboard — add another passkey (linked only)

Conceptually identical to 5.9 but exposed as "Add another passkey" in Settings → Authentication methods, with the implicit expectation that the user is setting up a second-device-class authenticator (YubiKey alongside phone, for instance).

### 5.11 Storyboard — server-account deletion (self) and migration

1. Settings → Server linking → "Disconnect from server" → confirmation: "Your account on `<issuer_label>` will be deleted. Local data stays intact. Sync and proxy will no longer be available until you link with another server."
2. Client posts `DELETE /v1/me`. Server: SERIALIZABLE transaction deletes user row (cascade to auth_methods and refresh_tokens), writes audit event `user.self_deleted`.
3. Client deletes `linked_account` row from IndexedDB. `local_account` stays. Existing `MasterKeySession` is downgraded to `mode = 'local'` (banner update).
4. UI offers "Connect to another server" with direct link to QR scan.
5. Migration is steps 1-4 plus a subsequent linking flow against a new operator. **MK does not change** — no data loss, no re-encryption.

### 5.12 Storyboard — username change

1. Settings → Account → "Change username" → form → submit.
2. If `mode = 'linked'`: client posts `PATCH /v1/me` with `{ username }`. Server attempts `UPDATE users SET username = $1 WHERE id = $2`; the UNIQUE constraint produces `23505` on conflict → server returns 409 `{ error: { code: 'username_taken' } }` (audit M6: rely on constraint, do not TOCTOU pre-check). On success, server returns updated user.
3. Client updates IndexedDB `local_account.username` and `linked_account.username` (single transaction) only after server-OK. If `mode = 'local'`: server step is skipped, local-only update.

### 5.13 Storyboard — logout

- This device: close `MasterKeySession` (zero buffers), drop the access token from memory, call `POST /v1/auth/logout`. The refresh cookie's family is revoked on the server. IndexedDB stays (account loads on next open). UI returns to login.
- Everywhere: as above with `?revoke_all=true`. Other devices' JWTs remain valid until their natural expiry (max 15 minutes) — consistent with the soft-suspend semantics chosen in section 8.4.

---

## 6. Admin Client UI

### 6.1 General principles for admin-client

- Catppuccin theme (Latte for light mode, Mocha for dark mode, system-preference-respecting).
- Functional over opulent (per CLAUDE.md §11).
- Single-page React app; React Router for navigation.
- No drag-and-drop.
- Disabled-over-hidden: primary_admin-only actions are visible to admins but greyed out with tooltip.
- Admin does **not** manage their own auth methods in admin-client; they use user-client for that (per CLAUDE.md "single uniform flows").

### 6.1.1 Origin sharing with user-client

Default deployment puts user-client at `chatsundere.example.com/` and admin-client at `chatsundere.example.com/admin`. **Same origin.** This means:

- Both clients share one IndexedDB. There is no separate "admin account" — the admin's account is created and managed in user-client (`local_account` and `linked_account` in IndexedDB). Admin-client simply reads the same rows and reuses the same crypto session machinery.
- WebAuthn credentials registered on the shared origin work for both clients (RP id is eTLD+1, not path-scoped).
- Tabs of either client can in principle access the other's in-RAM state if a deliberate channel exists; none is built. Each tab maintains its own `MasterKeySession`.
- Defense-in-depth via path-scoped CSP if it becomes necessary; not in phase 0.

Operators who want stronger isolation can deploy admin-client on a separate subdomain (e.g., `admin.chatsundere.example.com`). In that case the admin must repeat local-account creation and linking on the admin subdomain. Documented in deployment docs; not the default.

### 6.2 Screens

**Login**

Identical to user-client login (section 7.2). Admin-client loads the account from the shared IndexedDB.

Decision tree:

- No `local_account` in IndexedDB → "Admin-client needs a Chatsundere account. Set one up in user-client first." with a button linking to user-client onboarding.
- `local_account` exists but no `linked_account` → "Admin features require a server connection. Link your account to a server in user-client first." with a button linking to user-client Settings → Server linking.
- `local_account` and `linked_account` exist, but the device is offline → admin-client refuses to load past login: "Admin-client requires an active server connection." All admin actions are backend calls; there is no useful offline mode.
- All conditions met, user logs in, server login succeeds, role from `/v1/me` response is `user` (not admin or primary_admin) → "Your account does not have admin permissions on this server." with a link back to user-client.
- All conditions met and role is `admin` or `primary_admin` → dashboard.

**Dashboard**

Three count cards: total users, pending invitations, suspended users. Recent-activity panel (last 10 audit events) for quick situational awareness.

**Users — list**

Table: username, role (with primary_admin distinguished visually), status (active, suspended), created-at (relative), last-login-at (relative).

Above the table: search input (filters by username substring server-side), role filter, status filter. Pagination (20 per page). "Create invitation" button at the top, opens the invitation modal.

**Users — detail**

Click a username → modal or right-side panel with full info: id, username, role, status, created-at, last-login-at, list of auth methods (label, type, last-used-at), recent audit events for this user.

Actions in the panel:
- Suspend / Unsuspend (one button, toggles)
- Change role: opens a small form (only primary_admin can; greyed for others with tooltip)
- Transfer primary admin to this user (only primary_admin can, and target must be admin)
- Delete user (requires typed confirmation of username)
- Cannot self-target for suspend / delete / role-downgrade (server enforces; client disables for self-row as well, audit H5)

**Invitations**

Table: created-at, role, status (pending / redeemed / expired / revoked), redeemed-by (if any), expires-at.

Top: status filter, "Create invitation" button.

Create-invitation modal: role select (user or admin; primary_admin only available if no primary_admin exists, i.e., bootstrap case), expires-in (default 7 days), `issuer_label` (optional, defaults to instance name from server env).

On create: a one-time reveal screen with the QR code rendered from `qr_payload`, the URL, and a copy button. Big warning "This is shown only once. Make sure to capture it before closing." On close, the token is unavailable; only the QR can be recreated by revoking and creating fresh.

Revoke action on existing pending invitations.

**Audit log**

Table: timestamp, event_type, actor (username), subject (username if applicable), metadata-summary.

Filters: event-type select (categories: auth, user-lifecycle, invitation-lifecycle, recovery, admin-action), user filter, date range.

Pagination (50 per page). Metadata cell opens a JSON viewer on click.

### 6.3 Empty states

- No users (after bootstrap-admin completes their own linking): "Just you so far. Create an invitation to add the next user." with a Create-invitation button.
- No invitations: "No invitations yet. Create one to start onboarding people."
- No audit events visible after filter: "No matching events. Try a wider time range."

---

## 7. User Client UI and PWA

### 7.1 General principles

- Instrument Serif headings, opulent feel (per CLAUDE.md §11).
- Mobile-first at 380 px viewport. Single `lg` breakpoint at 1024 px.
- No drag-and-drop.
- Disabled-over-hidden.
- Inline-marker aesthetic for small interactive elements.
- Connectivity indicator visible top-bar (badge: online / linked / offline).

### 7.2 Screens

**Onboarding (empty IndexedDB)**

Single screen with two cards: "Create new account" (primary) and "Load existing account from device" (disabled — for phase 0 there is only one account per origin and no import flow; greyed with tooltip "Coming in a later phase").

**Create account form**

Three steps in a wizard:
1. Username (with live validation against the regex and reserved words).
2. Passphrase + confirmation (with a strength meter that is informational only).
3. Recovery key reveal (read-only, copy button, confirm-stored checkbox, continue button disabled until checked).

**Local login**

Two large buttons if biometric is set up, single passphrase field otherwise. Always a small "Forgot passphrase?" link to the recovery flow.

**App shell (phase 0)**

Top bar with username + connectivity badge + Settings cog. Centre: placeholder card "Your space is ready. Chat, personas, and sync will arrive in upcoming phases." Bottom: nothing (no nav bar yet — there is only one screen in phase 0).

**Settings**

Side-tab navigation (mobile: top-tab horizontal scroll):

1. Account — username (with edit), local account creation date, "Delete local data" (destructive, requires typed username confirmation; deletes IndexedDB after warning about loss of all locally-encrypted data).
2. Authentication methods — list of all local methods (passphrase always present; biometric devices with labels; recovery key indicator). For each: rename, remove (where allowed; passphrase cannot be removed; last non-recovery requires the lockout-confirm flow). At the bottom: "Set up biometric on this device", "Regenerate recovery key" (warning: previous recovery key invalidated).
3. Server linking — current state: not linked / linked to `<issuer_label>`. If linked: connectivity status, "Disconnect from server" (red), "Change passphrase" (greyed when offline). If not linked: "Scan QR" and "Paste invitation URL" controls.
4. About — version, license link, link to docs.

### 7.3 Connectivity states

| State | Indicator | Capabilities |
|---|---|---|
| Local-only account, no internet | grey "Local" badge | full local features; settings show "Not linked" |
| Local-only account, online | grey "Local" badge | same as above; "Link to server" available in settings |
| Linked, online, server reachable | green "Linked" badge with issuer label tooltip | full local + server features |
| Linked, online, server unreachable (5xx, timeout) | amber "Server unreachable" badge | local features; backend-dependent actions disabled with tooltip |
| Linked, online, server returned 401 (auth state diverged) | red "Server auth failed" badge | local features; Settings → Server linking offers "Sync passphrase" |
| Locally logged out | n/a | login screen only |

### 7.4 PWA setup

Toolchain: `vite-plugin-pwa` with Workbox runtime.

Manifest: app name, short name, icons, theme colour, background colour, `display: standalone`, scope and start URL of the user-client base path.

Service worker:
- Precaches static assets (HTML, JS, CSS, fonts, icons).
- Runtime cache for fonts (cache-first).
- **Never caches API responses.** Backend interactions either succeed live or fall back to local-only flows. (Caching API responses for offline would risk serving stale auth state or stale-but-decrypted data.)
- Activates immediately on update with a small in-app notification "New version available, refresh to apply" (user-controlled, never auto-reload).

IndexedDB versioning: see 3.10.

### 7.5 Empty states and error states

- Empty IndexedDB: onboarding (see above).
- Network error during linking: full-screen error with retry, never a partial state in IndexedDB.
- Invalid QR payload: friendly error "This doesn't look like a valid Chatsundere invitation. Make sure it's from a trusted source."
- Invitation expired or already redeemed: precise message naming the cause.
- Password change interrupted (staging-slot detected on boot): silent rollback if `server_state = 'pending'`, silent completion if `server_state = 'committed'`; user is informed if the rollback occurred ("Your previous passphrase change didn't complete. Please try again when ready.").

---

## 8. Operations and Security

### 8.1 Bootstrap CLI

`apps/auth-service/src/cli/bootstrap.ts`. Run as `bun run --filter @chatsundere/auth-service bootstrap-admin`.

Behaviour:
1. Refuse if any row with `role='primary_admin'` exists or if `auth_methods` is non-empty.
2. Generate a 32-byte random invitation token.
3. Write invitation row with `role='primary_admin'`, `expires_at = now() + 24h`, `created_by = NULL`, `attempt_count = 0`.
4. Write the QR-payload to `${XDG_RUNTIME_DIR:-/tmp}/chatsundere-bootstrap-${invitation_id}.json` with mode `0600`. The file contains `{ "qr_payload": "...", "url": "...", "invitation_id": "...", "expires_at_unix_ms": ... }`.
5. Print to stdout: only the file path and a one-line instruction ("Open this file from the user-client; the file will be removed automatically after the bootstrap invitation is redeemed.").
6. Exit 0.

File cleanup policy:
- The file is deleted by the auth-service process when `/v1/link/opaque/finish` (or `/v1/link/passkey/finish`) successfully redeems the bootstrap invitation. The auth-service finds the file by reading `${XDG_RUNTIME_DIR:-/tmp}/chatsundere-bootstrap-${invitation_id}.json` from the redeemed invitation's id and removes it post-commit.
- If the operator never redeems, no automatic timer is implemented in phase 0. The invitation itself expires after 24 hours (the DB row's `expires_at`); the on-disk file remains until the operator removes it manually. Documented in deployment docs as an operator hygiene point.

Failure modes return non-zero with messages on stderr.

Implication: stdout never carries the secret; tokens cannot land in shell history, journald, or container logs. (Audit M7.)

### 8.2 JWT format

- Algorithm: EdDSA (Ed25519).
- Private key: read from `AUTH_JWT_PRIVATE_KEY` env (base64url-encoded raw key).
- Public key: served via `/v1/jwks` so sibling services (sync, proxy) can verify.
- Claims:
  - `sub` — user id (UUID).
  - `role` — `primary_admin` | `admin` | `user`.
  - `iat`, `exp` — standard.
  - `iss` — `"chatsundere-auth-v1"` (with version suffix, audit L4).
  - `aud` — full `"${base_url}/auth/v1"` (audit M2). Verified client-side too.
- Access token TTL: 15 minutes.
- Refresh token TTL: 30 days. Opaque random string, SHA-256 hashed at rest. Set in HTTP-only Secure SameSite=Lax cookie at path `/api/auth/v1/token/refresh`. Rotation per family; on rotation, the prior token's `rotated_to_id` is set and the row is marked revoked. Presentation of a revoked token whose successor still lives = compromise signal; the entire family is revoked, audit event `refresh_token.reuse_detected` written. (Audit L2.)
- Username is **not** in JWT claims (audit L3). Services that need to display a username call `GET /v1/me` and cache.
- Key rotation is **deferred** to a pre-v0.1.0 ADR; for phase 0 the key is rotated by operator intervention only.

### 8.3 Cookie, CORS, CSRF strategy

- Refresh cookie: HTTP-only, Secure, SameSite=Lax, path `/api/auth/v1/token/refresh`. Default deployment is same-origin (user-client and auth-service on the same hostname behind a reverse proxy), so no `Domain=` attribute is set.
- CORS: only origins listed in `CORS_ALLOWED_ORIGINS` (comma-separated env) are permitted. Credentials allowed for those origins. No wildcard ever.
- CSRF: SameSite=Lax cookie defends most cross-site cases; defence-in-depth via Origin-header check on every state-mutating endpoint (POST, PATCH, DELETE) — request rejected with 403 if the Origin header is missing or not in the allow-list.
- Production requires HTTPS; HTTP requests are rejected.
- HSTS: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- CSP on any HTML the auth-service serves (only the JWKS-explainer page, if at all): strict, `default-src 'none'`, scoped script and style sources.

### 8.4 Rate limiting

Backed by Redis with sliding-window counters.

- Per IP, unauthenticated endpoints: 60 requests / minute.
- Per IP, authenticated endpoints: 600 requests / minute.
- OPAQUE login per username: 10 attempts / 15 minutes.
- Passkey login per username: 10 attempts / 15 minutes.
- Recovery start per username: 5 attempts / hour.
- Recovery finish: 3 attempts per nonce (in practice 1, but small buffer for legitimate retries).
- Invitation token: max 3 link attempts per token (token_id-keyed), then the token is auto-revoked (audit, invitation enumeration).

Reverse-proxy IP-trust configuration is an operations concern documented in deployment docs, not in this spec.

### 8.5 Suspend semantics

Soft suspend, by decision in the brainstorming session:
- `users.suspended_at` is set.
- All refresh-token families for the user are revoked in the same transaction.
- Active JWTs continue to work until natural expiry (max 15 minutes).
- An EXISTS-check (audit H4) on every authenticated handler short-circuits to 401 if the user no longer exists or is suspended. The check is cached in Redis with 30-second TTL keyed by user-id.
- `POST /v1/admin/users/:id/suspend` rejects with 403 if `:id` is the caller's own id and the caller is the sole primary_admin (audit H5).

### 8.6 Audit log

Canonical event types (phase 0):

| Event | Fired by | Subject | Metadata fields |
|---|---|---|---|
| `user.linked` | server (link finish) | linked user | `role`, `invitation_id` |
| `user.suspended` | admin endpoint | suspended user | (none; actor is in `actor_user_id`) |
| `user.unsuspended` | admin endpoint | user | (none) |
| `user.deleted_by_admin` | admin endpoint | deleted user | (none) |
| `user.self_deleted` | self endpoint | self | (none) |
| `user.role_changed` | admin endpoint | user | `from_role`, `to_role` |
| `user.username_changed` | self endpoint | user | (no values — pre/post would be PII; recover from time-ordered backups if needed) |
| `primary_admin.transferred` | admin endpoint | new primary_admin | `previous_primary_admin_id` |
| `invitation.created` | admin endpoint | (none) | `invitation_id`, `role`, `expires_at` |
| `invitation.revoked` | admin endpoint | (none) | `invitation_id` |
| `invitation.redeemed` | linking finish | invited user | `invitation_id`, `role` |
| `auth_method.added` | bearer endpoint | user | `method_type`, `label` |
| `auth_method.removed` | bearer endpoint | user | `method_type`, `label` |
| `auth_method.passphrase_changed` | bearer endpoint | user | (none) |
| `auth.login.success` | login finish | user | `method_type` |
| `auth.login.failed` | login finish | user (or null if username unknown) | `method_type`, `reason` (`bad_credentials` / `not_found` / `suspended` / `expired`) — never the supplied passphrase or other secrets |
| `auth.logout` | bearer endpoint | user | `scope` (`this_device` / `all`) |
| `recovery_used` | recovery finish | user | (none) |
| `refresh_token.reuse_detected` | refresh endpoint | user | `family_id` |

Each metadata payload is validated against a Valibot schema specific to its event_type. Total row size capped at 2 KiB. (Audit M4.) Metadata never includes IP, user-agent, or any user-provided free-text.

Audit-log endpoint is admin-readable, filterable, paginated.

### 8.7 Prometheus metrics

Counters, gauges, and histograms registered with `prom-client`. Labels are restricted to fixed-cardinality values only — never user-id, never username, never IP. (Audit M3.) Lint pass in CI scans the metric registry for forbidden label names.

Metrics:

| Name | Type | Labels | Meaning |
|---|---|---|---|
| `auth_links_total` | counter | `method_type` ∈ {opaque, passkey}, `result` ∈ {success, conflict, error} | Linking attempts |
| `auth_logins_total` | counter | `method_type`, `result` | Login attempts |
| `auth_active_users_30d` | gauge | (none) | Distinct users with `last_login_at` in last 30 days |
| `auth_invitations_created_total` | counter | `role` | Invitations created |
| `auth_invitations_redeemed_total` | counter | `role` | Invitations redeemed |
| `auth_jwt_issued_total` | counter | `kind` ∈ {access, refresh} | Tokens issued |
| `auth_recovery_attempts_total` | counter | `result` ∈ {success, bad_proof, no_nonce, rate_limited} | Recovery attempts |
| `auth_admin_actions_total` | counter | `action` ∈ {suspend, unsuspend, delete, role_change, transfer_primary, invite_create, invite_revoke} | Admin actions |
| `auth_request_duration_seconds` | histogram | `route`, `method`, `status_class` ∈ {2xx, 3xx, 4xx, 5xx} | Latency by endpoint group |

### 8.8 Logging

Structured JSON via `pino`. No secrets ever logged. Pino redact paths cover at least `passphrase`, `passphrase_confirmation`, `recovery_key`, `wrapped_master_key`, `wrap_nonce`, `registration_request`, `registration_record`, `ke1`, `ke2`, `ke3`, `prfOutput`, `credential_id`, `public_key`, `proof`, `verifier_key`, `recovery_verifier_key`, `access_token`, `refresh_token`, `cookie`, `set-cookie`, `authorization`.

Log levels: `info` for normal request lifecycle, `warn` for rate-limit hits / 4xx, `error` for 5xx and uncaught exceptions. Correlation: each request gets a `request_id` (UUIDv7) header echoed in response and included in every log line.

---

## 9. Threat Model and Accepted Trade-Offs

### 9.1 What we protect against

- **Server-DB leak:** the server holds only ciphertext blobs and HKDF-derived verifier keys; the leak does not give the attacker plaintext keys, passphrases, or master keys. OPAQUE prevents offline brute force against the passphrase. The replaced-`mk_proof_value` scheme (audit C1) prevents server-DB-only recovery takeover.
- **Network observer / hostile Wi-Fi:** TLS provides confidentiality. OPAQUE prevents the observer from learning the passphrase. Our local-first composition no longer adds an extra oracle (audit H2).
- **Server compromise (read-only):** read-only attacker sees the same as a DB leak — ciphertext only.
- **Single device compromise (post-unlock):** while a user is logged in, MK is in browser memory. We zero buffers best-effort on session close. A compromised browser environment after unlock can read MK; this is the platform's reality and not in our threat scope.
- **Device theft pre-unlock:** wrapped MK in IndexedDB is protected by Argon2id over the passphrase. Strength depends on passphrase entropy. Recovery key is independent; whoever has the device but not the passphrase cannot brute-force the recovery key (it has 256 bits of entropy).
- **Operator compromise / malicious operator:** server cannot decrypt user data. Operator can serve a malicious user-client; users who fetch the PWA from a centrally-hosted source rather than the operator's own host are exposed to the central host (see 9.3).
- **Passkey theft (device only):** without the device's biometric or PIN, the authenticator does not release PRF output.

### 9.2 What we deliberately do not protect against

- **Forgotten passphrase plus lost recovery key:** unrecoverable. By design.
- **Coerced unlock (user under duress):** out of scope.
- **Lawful interception of TLS by trusted CA:** TLS is the trust anchor we accept.
- **Browser-level XSS on the application origin:** mitigated to the degree we can (CSP, integrity-HMAC on IndexedDB wrappers, no `eval`, no inline scripts). Cannot fully prevent. Post-unlock memory is exposed.
- **Cross-server user correlation via `verifier_key`:** if a user links the same recovery key to two operators, both servers store `HMAC(recovery_key, fixed-info)` — the same value. Two cooperating operators could detect "same user". Accepted because making it per-operator would break the migration story (which requires the same recovery key to work on a new operator).

### 9.3 Centrally-hosted PWA risk

Operators are recommended to host the user-client and admin-client themselves (same origin as their `base_url`). A centrally-hosted PWA (e.g., served from a third party at app.chatsundere.org and used against various operator backends) creates total-trust dependency on the central host. SRI and update signatures would mitigate; both are deferred.

### 9.4 Per-finding security map

Every audit finding from the independent review on 2026-05-18 is addressed in this spec. Map for traceability:

| Finding | Where addressed |
|---|---|
| C1 (recovery-verifier replay) | §3.6 (challenge-response), §5.8 (recovery storyboard) |
| H1 (Redis OPAQUE collision) | §3.4 (session-id-keyed state), §5.1 (session_id in endpoints) |
| H2 (passphrase-validity oracle) | §5.6 (always run server roundtrip, commit gated by local) |
| H3 (passphrase change atomicity) | §5.7 (staging slot, three-state recovery on boot) |
| H4 (DELETE /me + refresh race) | §8.5 (EXISTS-check, cached), §5.1 (SERIALIZABLE on DELETE /me) |
| H5 (primary admin self-lockout) | §5.1, §6.2, §8.5 (server-side guards on self-targeted actions) |
| M1 (sync passkey sign counter) | §3.5 (AAGUID allow-list) |
| M2 (JWT aud collision) | §8.2 (full-URL aud, version suffix on iss) |
| M3 (Prometheus PII labels) | §8.7 (label policy + CI lint) |
| M4 (audit-log injection) | §8.6 (Valibot per-event schema, 2 KiB cap) |
| M5 (invitation token hashing) | §4.1 (HMAC with INVITATION_HMAC_KEY) |
| M6 (username TOCTOU) | §5.12, §5.1 (rely on UNIQUE constraint) |
| M7 (bootstrap stdout leak) | §8.1 (file output, 0600, auto-delete) |
| M8 (dependency confusion) | §11 (claim npm scope; in deferred list since pre-publishing setup) |
| M9 (IndexedDB tampering pre-unlock) | §3.9 (integrity HMAC over wrapped-MK bundles) |
| L1 (wrap AAD) | §3.3 (AAD-bound wraps) |
| L2 (refresh re-use detection) | §8.2 (rotated_to_id + family revoke) |
| L3 (username drift in JWT) | §8.2 (username dropped from claims) |
| L4 (iss/aud version suffix) | §8.2 (`chatsundere-auth-v1`) |
| L5 (runtime preconditions) | §3.12 (`assertRuntimeSupport()`) |

---

## 10. Testing and Manual Verification

### 10.1 Test pyramid

| Layer | Tooling | Targets |
|---|---|---|
| Unit | Bun's built-in test runner (server, crypto), Vitest (clients) | All `packages/crypto` primitives (wrap/unwrap round-trips, AMK derivation paths, recovery encoding/decoding, PRF helpers, integrity HMAC); auth-service token hashing, JWT issuance/verification, role checks, rate-limit math; client form validation |
| Integration | Bun test runner with a real PostgreSQL and Redis (testcontainers or `docker compose -f infra/docker-compose.test.yml`) | Full OPAQUE link flow against a real DB; passkey link with mocked PRF; recovery flow end-to-end; admin actions (create invitation, list, suspend, unsuspend, role change, transfer primary); bootstrap CLI on an empty DB |
| Property | `fast-check` | wrap-then-unwrap is identity for any random input; nonce-tamper triggers auth-fail; ciphertext-tamper triggers auth-fail; AAD-tamper triggers auth-fail |
| Client component | Vitest + Testing Library | Onboarding form, login screen variants, settings sub-pages, connectivity badge state transitions |

Larissa audits the diff for squashes A, B, and C before squash.

### 10.2 Manual verification (Chris on real devices)

Required end-to-end runs before squash D is squashed:

1. Local account creation on Firefox desktop, Safari iOS, Chrome Android. Recovery key reveal works and is copyable. Account loads on app reload.
2. Local login via passphrase on all three.
3. Biometric setup and unlock on iOS Safari (Face ID), Android Chrome (fingerprint), macOS Safari (Touch ID). Confirm cross-session persistence.
4. Recovery from a recovery key on a wiped IndexedDB (simulating device loss): user reaches the "Set new passphrase" forced screen and lands logged in.
5. Bootstrap: docker compose up, `bun run bootstrap-admin`, file output, user-client onboarding through linking, admin-client login.
6. Linking flow: invitation creation from admin-client, scan QR with user-client, complete linking, observe online-linked-badge.
7. Username conflict on linking: deliberately set a colliding username, observe 409 dialog, rename, retry, succeed.
8. Online double-auth: log in to linked account with correct passphrase, observe single passphrase entry brings up full linked session.
9. Wrong passphrase on linked account: same UI as unlinked; no extra information leakage.
10. Passphrase change online: confirm staging-slot reconciliation works (kill the tab between server-commit and local-swap by force-quitting the browser at the right moment).
11. Server-account self-delete: confirm `linked_account` removed from IndexedDB and local features keep working.
12. Migration: delete server account, link to a different operator (run two compose stacks for the test), confirm same MK and local data still encrypted-decryptable.
13. Suspend by admin: another browser logged in as the suspended user observes that authenticated calls start returning 401 within 30 seconds (cache TTL).
14. Primary admin self-suspend / self-delete / self-demote: server rejects (admin-client also greys out for self).
15. Audit-log viewer in admin-client: pagination, filters by event_type and date range, metadata expand.

---

## 11. Deferred (explicitly out of phase 0)

- JWT key rotation: ADR + rotation mechanism + JWKS `kid` headers + key-rollover window. Pre-v0.1.0.
- Multi-account-per-origin switching in user-client.
- Multi-device linking flow (a second device of the same user pulls account state from the server). For phase 0, a second device = a separate local account.
- WebAuthn attestation beyond `none`.
- Storage-quota enforcement (column exists, null = unlimited, no UI).
- Subresource Integrity (SRI) for centrally-hosted PWAs.
- ServiceWorker integrity pinning.
- Argon2id per-device parameter auto-tuning.
- Background-sync support in the service worker (waiting for sync-service in phase 1).
- IP and user-agent in audit log (deliberate privacy decision; revisit only if a real operational need emerges and an ADR justifies it).
- `display_name` field on users.
- Chat, personas, sync, proxy, homelab integration.
- `@chatsundere` npm scope reservation (becomes relevant only when publishing externally; phase-0 is private-only).

---

## 12. New ADRs Required

These will be drafted and committed before or alongside their corresponding implementation squashes.

| ADR # | Title | Squash association |
|---|---|---|
| 0008 | Local-First Identity: account is primary, backend is opt-in | Spec-level, before squash A |
| 0009 | Operator Migration as a First-Class Feature | Spec-level, before squash A |
| 0010 | Recovery proof via challenge-response, not stored comparator | Squash A and B |
| 0011 | OPAQUE server state keyed by random session id in Redis | Squash B |
| 0012 | AES-GCM AAD-binding for all wrap operations | Squash A |
| 0013 | IndexedDB integrity HMAC against pre-unlock tampering | Squash A |
| 0014 | Synced-passkey sign-counter AAGUID allow-list policy | Squash A and B |
| 0015 | Bootstrap CLI writes to file with `0600`, never stdout (supersedes ADR 0004 detail) | Squash B |
| 0016 | Local-First Biometric Unlock via WebAuthn PRF | Squash A and D |
| 0017 | Path-based routing as phase-0 default; subdomains optional | Squash B |
| 0018 | Audit log: no IP, no user-agent, structured metadata only | Squash B |
| 0019 | Username chosen by user at link time; UNIQUE-constraint resolved 409 (no pre-check) | Squash B |

ADR 0004 (`bootstrap-cli-not-env`) is amended by 0015 rather than replaced — the principle holds (no env-triggered magic); the implementation tightens to file output.

---

## 13. Open Questions

None at this writing. Items above marked "deferred" or "operations concern" are intentional, not unresolved.

---

## 14. Appendix — KDF reference card

```
local_amk            = Argon2id(passphrase, local_salt; m=64MiB, t=3, p=1, out=32B)
recovery_amk         = HKDF-SHA256(recovery_key, "", "chatsundere-amk-v1::recovery", 32B)
local_prf_amk        = HKDF-SHA256(prf_output,  "", "chatsundere-amk-v1::prf::<credential_id_prefix>", 32B)
opaque_amk           = HKDF-SHA256(opaque_export_key, "", "chatsundere-amk-v1::opaque", 32B)
prf_amk              = HKDF-SHA256(prf_output, "", "chatsundere-amk-v1::prf::<credential_id_prefix>", 32B)

verifier_key         = HKDF-SHA256(recovery_key, "", "chatsundere-rk-verifier-key-v1", 32B)
proof                = HMAC-SHA256(verifier_key, nonce || username || server_id)

DEK[ctx]             = HKDF-SHA256(MK, "", "chatsundere-dek-v1::<ctx>", 32B)

wrap_aad             = "${user_id_or_local_uuid}::${method_type}::v1"
wrapped_mk           = AES-256-GCM-Encrypt(amk, random_12B_nonce, MK, aad=wrap_aad)
integrity_key_x      = HKDF-SHA256(x_amk, "", "chatsundere-integrity-v1", 32B)
integrity_hmac_x     = HMAC-SHA256(integrity_key_x, wrapped_mk || wrap_nonce || wrap_aad)

WebAuthn PRF input salt: SHA-256("chatsundere-mk-derivation-v1")
```

End of specification.
