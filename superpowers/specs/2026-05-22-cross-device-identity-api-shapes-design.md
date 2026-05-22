# Cross-device-identity — API endpoint shapes

**Date:** 2026-05-22
**Status:** brainstorm complete, awaiting Chris review before plan
**Implements:** [`obsidian/briefs/phase 0/cross-device-identity.md`](../../obsidian/briefs/phase%200/cross-device-identity.md) §"API Surface" — resolves Open #3
**Related ADRs:** ADR 0021 (OPAQUE-first), ADR 0023 (server-at-root — **relaxed by this spec**), ADR 0024 (single-server-per-account), ADR 0025 (UUIDv7), ADR 0027 (step-up policy)
**Lead:** Liz, with Chris in walk-through mode
**Out of scope:** pre-disconnect-sync-pull state machine (ADR 0026; client-side), step-up-auth endpoint shapes (separate spec for `POST /api/v1/auth/step-up`), DB migration scripts (covered in the implementation plan), HTML fallback page at `/join` (Phase 1 polish).

---

## 1. Purpose

The cross-device-identity brief left one item open: pre-implementation curl-verification of the proposed request/response bodies for the five new endpoints. This spec resolves that item by walking each endpoint's wire format end-to-end and locking the shape before code is written.

Beyond the brief's original five endpoints, this spec reconciles three reality-vs-brief tensions that surfaced during walk-through:

1. **Sub-path hosting via Baalnet-style relays.** A URL field like `https://relay.baalnet.io/t4524089sdf24902405fwej/` is now a first-class deployment mode. ADR 0023's "server at root" stance is relaxed.
2. **OPAQUE is a two-round protocol.** The brief's one-shot `POST /api/join` is mechanically impossible. Replaced with `POST /api/v1/join/{start,finish}` unified across invitation and pairing flows.
3. **Two-field UX (URL + short code) coexists with QR.** Manual entry uses two fields parsed into the same canonical form as a scanned QR URL.

---

## 2. Decisions captured during brainstorm

1. **URL field semantics — base URL, client appends `/api/v1/...`.** Direct hosting: `https://chatsundere.me/api/v1/join/start`. Baalnet routing: `https://relay.baalnet.io/t4524089sdf24902405fwej/api/v1/join/start`. The auth-service itself remains mounted at `/api/v1/...` from its own perspective; relays do transparent path rewriting.
2. **Token format — 10 characters, 50 bits, two groups of five.** Alphabet is RFC 4648 §6 Base32 minus `0`, `O`, `1`, `I`. Example: `AB7K3-MN9PX`. Replaces the brief's 15-character / 75-bit format. Tippable in ~5 seconds, brute-force-resistant under our rate-limit model.
3. **QR payload — real URL with fragment-encoded code.** Example: `https://chatsundere.me/join#AB7K3-MN9PX`. Foreign QR scanners open it in a browser; the server responds at `/join` with an HTML deep-link page to the PWA. Our own scanner recognises the format directly. Manual entry uses URL field + code field, parsed into the same canonical form.
4. **Username collision — 409 + user picks again.** The brief's stance stands. Server does not propose alternatives, does not auto-rename. No live as-you-type pre-check (username enumeration vector).
5. **Endpoint unification — `POST /api/v1/join/{start,finish}` with `kind` discriminator.** Existing `POST /v1/link/opaque/{start,finish}` is migrated into the new join endpoints. One external surface for both invitation and pairing joins.
6. **Step-up mechanism — implicit Redis-backed session state, no proof header.** Per ADR 0027. No `X-Step-Up-Proof` header. Bearer-auth middleware exposes `session_id`; step-up endpoint handlers check `redis.GET step_up:<session_id>:<tier>` and return 403 step_up_required on miss. Client recovers by calling `POST /api/v1/auth/step-up` and retrying.
7. **Invitation fields — `role`, `expires_in_seconds`, `suggested_username?`, `issuer_label?`, `note?`.** `issuer_label` is categorical/sortable ("invitation round june '26"); `note` is freeform ("kenne ich von X, leiwander typ"). Both operator-private; never surfaced to the joining user.
8. **Pairing-code body — empty.** No label, no note. Pairing codes are user-private, kurzlebig (5 min); discoverability does not apply.
9. **Pairing `/finish` returns wrapped MK material.** `wrapped_mk_opaque`, `wrap_nonce_opaque`, `wrap_aad_opaque` are included in the response so the new device can unwrap the master key with its OPAQUE session key. Brief did not call this out; without it the new device has no path into the user's crypto domain.
10. **Three-layer wrapping-integrity guarantee.** Spec invariant ("OPAQUE wrapping is canonical per ADR 0021"), server sanity check at pairing-finish (refuse with `500 wrapping_invariant_violated` + audit + alert if violated), and an integration test matrix over plausible account states.
11. **Username included in pairing `/start` response.** Lets the new device show "Add this device to account chris?" before passphrase entry. Trust model: TLS protects against passive network observers; the TLS terminator (server directly, or Baalnet relay) sees the response regardless — the username leak is dominated by every other authenticated request through the same channel.

---

## 3. Endpoint table

| Endpoint | Auth | Step-up | Status |
|---|---|---|---|
| `POST /api/v1/admin/invitations` | Bearer (admin or primary_admin) | Tier 4 | Reshape existing `POST /v1/admin/invitations` |
| `GET /api/v1/admin/invitations[?status=…]` | Bearer (admin+) | none | Path migration only; structure unchanged |
| `DELETE /api/v1/admin/invitations/:id` | Bearer (admin+) | none | Path migration only; structure unchanged |
| `POST /api/v1/me/pairing-codes` | Bearer (any user) | Tier 1 | New |
| `GET /api/v1/me/pairing-codes` | Bearer (any user) | none | New |
| `DELETE /api/v1/me/pairing-codes/:id` | Bearer (any user) | none | New |
| `POST /api/v1/join/start` | none | none | New; absorbs existing `POST /v1/link/opaque/start` |
| `POST /api/v1/join/finish` | none | none | New; absorbs existing `POST /v1/link/opaque/finish` |

All endpoints emit Prometheus metrics and write to the audit log per existing patterns. Audit event types added by this spec:

| Event | Emitted by | Actor |
|---|---|---|
| `pairing_code.created` | `POST /api/v1/me/pairing-codes` | user themself |
| `pairing_code.revoked` | `DELETE /api/v1/me/pairing-codes/:id` | user themself |
| `pairing_code.redeemed` | `POST /api/v1/join/finish` (kind=pairing) | user themself |
| `wrapping_invariant_violated` | `POST /api/v1/join/finish` (kind=pairing, defence path) | system |

Existing `invitation.created`, `invitation.revoked`, `invitation.redeemed`, `user.linked` events are retained unchanged.

---

## 4. Endpoint shapes

All bodies are JSON unless noted. All cryptographic blobs are base64url-encoded strings. Cookies use the existing `refreshCookieFor()` helper; `Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/token/refresh`. The `qr_url` field is constructed server-side from `env.API_BASE_URL` (existing config; existing `invitations.ts:94` already derives base URL from this var) with `/join#<code>` appended; deployers behind a sub-path reverse-proxy set `API_BASE_URL` to the externally-visible URL.

### 4.1 `POST /api/v1/admin/invitations` — create invitation

```bash
curl -X POST https://chatsundere.me/api/v1/admin/invitations \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "user",
    "expires_in_seconds": 604800,
    "suggested_username": "chris.tidesson",
    "issuer_label": "invitation round june 26",
    "note": "kenne ich von X, leiwander typ"
  }'
```

Response `201 Created`:

```json
{
  "invitation_id": "0192a1c0-7fef-7c5e-9bb1-c3dd2f0e1e8a",
  "code": "AB7K3-MN9PX",
  "qr_url": "https://chatsundere.me/join#AB7K3-MN9PX",
  "expires_at": "2026-05-29T08:14:00Z",
  "state": "active"
}
```

Required: `role`, `expires_in_seconds`. Optional: `suggested_username`, `issuer_label`, `note`.

`code` and `qr_url` are returned **only** in this creation response and never again. Listing and detail endpoints omit them.

### 4.2 `GET /api/v1/admin/invitations` — list invitations

Query parameters: `status` (filter by `pending`|`redeemed`|`revoked`|`expired`), `limit` (default 20, max 100), `offset` (default 0).

```bash
curl 'https://chatsundere.me/api/v1/admin/invitations?status=pending&limit=20' \
  -H "Authorization: Bearer <admin-jwt>"
```

Response `200 OK`:

```json
{
  "invitations": [
    {
      "id": "0192a1c0-...",
      "role": "user",
      "suggested_username": "chris.tidesson",
      "issuer_label": "invitation round june 26",
      "note": "kenne ich von X, leiwander typ",
      "created_by": "0192a0aa-...",
      "created_at": "2026-05-22T08:14:00Z",
      "expires_at": "2026-05-29T08:14:00Z",
      "redeemed_at": null,
      "redeemed_by_user_id": null,
      "revoked_at": null,
      "attempt_count": 0,
      "status": "pending"
    }
  ],
  "total": 1
}
```

Code is intentionally absent — admin cannot re-display invitation codes after creation. Lost code → revoke + reissue.

### 4.3 `DELETE /api/v1/admin/invitations/:id` — revoke invitation

```bash
curl -X DELETE https://chatsundere.me/api/v1/admin/invitations/0192a1c0-... \
  -H "Authorization: Bearer <admin-jwt>"
```

Response `200 OK`:

```json
{ "ok": true }
```

Errors: 404 not_found, 409 conflict (already redeemed or revoked).

### 4.4 `POST /api/v1/me/pairing-codes` — generate pairing code

```bash
curl -X POST https://chatsundere.me/api/v1/me/pairing-codes \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response `201 Created`:

```json
{
  "id": "0192a1c1-7f23-7c5e-a112-d8ee2f0e1e8a",
  "code": "RWVG3-K8YJL",
  "qr_url": "https://chatsundere.me/join#RWVG3-K8YJL",
  "expires_at": "2026-05-22T08:19:00Z",
  "created_at": "2026-05-22T08:14:00Z",
  "state": "active"
}
```

Shape parity with `GET /api/v1/me/pairing-codes` list items (§4.5). Empty request body. If Tier 1 grace window has expired:

```
HTTP/1.1 403 Forbidden
{ "error": "step_up_required", "tier": 1 }
```

### 4.5 `GET /api/v1/me/pairing-codes` — list active pairing codes

```bash
curl https://chatsundere.me/api/v1/me/pairing-codes \
  -H "Authorization: Bearer <user-jwt>"
```

Response `200 OK`:

```json
{
  "pairing_codes": [
    {
      "id": "0192a1c1-...",
      "code": "RWVG3-K8YJL",
      "qr_url": "https://chatsundere.me/join#RWVG3-K8YJL",
      "expires_at": "2026-05-22T08:19:00Z",
      "created_at": "2026-05-22T08:14:00Z",
      "state": "active"
    }
  ]
}
```

Only `state=active` codes are returned. The user already authored these codes; full-text retrieval is safe within the bearer-authenticated session and lets the user re-display a code without regenerating.

### 4.6 `DELETE /api/v1/me/pairing-codes/:id` — revoke pairing code

```bash
curl -X DELETE https://chatsundere.me/api/v1/me/pairing-codes/0192a1c1-... \
  -H "Authorization: Bearer <user-jwt>"
```

Response `200 OK`:

```json
{ "ok": true }
```

Errors: 404 (id not owned by user, or does not exist — deliberately conflated), 409 (already used or revoked).

### 4.7 `POST /api/v1/join/start` — begin join (no auth)

Discriminator: `kind` ∈ {`invitation`, `pairing`}. Branches the handler.

**Invitation variant:**

```bash
curl -X POST https://chatsundere.me/api/v1/join/start \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "invitation",
    "code": "AB7K3-MN9PX",
    "registration_request": "<base64url OPAQUE registration request>"
  }'
```

Response `200 OK`:

```json
{
  "session_id": "0192a1c2-...",
  "registration_response": "<base64url OPAQUE registration response>",
  "suggested_username": "chris.tidesson"
}
```

`suggested_username` is `null` if the operator omitted it.

**Pairing variant:**

```bash
curl -X POST https://chatsundere.me/api/v1/join/start \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "pairing",
    "code": "RWVG3-K8YJL",
    "login_request": "<base64url OPAQUE login request>"
  }'
```

Response `200 OK`:

```json
{
  "session_id": "0192a1c3-...",
  "login_response": "<base64url OPAQUE login response>",
  "username": "chris"
}
```

`username` lets the new device show "Add this device to account chris?" before passphrase entry.

**Behaviour:** Code is looked up at `/start`; an attempt counter is incremented per the existing `consumeInvitationAttempt` pattern (rate-limit-relevant) but the code is **not** marked used yet. Single-use enforcement happens atomically at `/finish` alongside the OPAQUE record write.

**Errors:**

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_code_format` | Code does not match the alphabet/length spec |
| 400 | `kind_mismatch` | `kind` does not match the code's actual type |
| 404 | `code_not_found_or_expired` | Invalid / expired / used — deliberately not distinguished |
| 429 | `rate_limit_exceeded` | See §6 |

### 4.8 `POST /api/v1/join/finish` — complete join (no auth, validated by session_id)

**Invitation variant:**

```bash
curl -X POST https://chatsundere.me/api/v1/join/finish \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "invitation",
    "session_id": "0192a1c2-...",
    "username": "chris",
    "registration_record": "<base64url>",
    "wrapped_mk_opaque": "<base64url>",
    "wrap_nonce_opaque": "<base64url>",
    "wrap_aad_opaque": "<base64url>",
    "wrapped_mk_recovery": "<base64url>",
    "wrap_nonce_recovery": "<base64url>",
    "wrap_aad_recovery": "<base64url>",
    "recovery_verifier_key": "<base64url>"
  }'
```

Response `200 OK` + `Set-Cookie: refresh_token=…`:

```json
{
  "user_id": "0192a0ff-...",
  "username": "chris",
  "role": "user",
  "access_token": "<jwt>",
  "expires_in": 900,
  "is_new_account": true
}
```

The wrapping material is generated client-side: the client derives keys from the OPAQUE export-key, wraps the freshly-generated master key, and uploads. Recovery key is generated and presented to the user out-of-band per ADR 0007.

**Pairing variant:**

```bash
curl -X POST https://chatsundere.me/api/v1/join/finish \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "pairing",
    "session_id": "0192a1c3-...",
    "login_evidence": "<base64url OPAQUE login evidence>"
  }'
```

Response `200 OK` + `Set-Cookie: refresh_token=…`:

```json
{
  "user_id": "0192a0ff-...",
  "username": "chris",
  "role": "user",
  "access_token": "<jwt>",
  "expires_in": 900,
  "is_new_account": false,
  "wrapped_mk_opaque": "<base64url>",
  "wrap_nonce_opaque": "<base64url>",
  "wrap_aad_opaque": "<base64url>"
}
```

The wrapped MK material is returned from the user's existing OPAQUE auth-method row. The new device unwraps using the OPAQUE session key and is now in the user's crypto domain.

**Wrapping-invariant enforcement (Decision 10):**

Before issuing tokens, the pairing-finish handler validates:

```sql
select wrapped_master_key, wrap_nonce, wrap_aad
from auth_methods
where user_id = $1 and method_type = 'opaque'
```

Expected: exactly one row with all three columns non-null. If zero rows, multiple rows, or any null → refuse with `500 wrapping_invariant_violated`, write an audit event with the user_id and the violation type, increment a Prometheus counter `auth_wrapping_invariant_violations_total`. The user gets a generic "Cannot complete pairing — please contact your operator" copy.

**Errors:**

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_input` | Username format invalid (invitation), missing fields |
| 401 | `opaque_evidence_invalid` | OPAQUE verification failed (pairing) |
| 409 | `username_taken` | Username already exists on this server (invitation only) |
| 410 | `session_expired` | session_id is stale (>60s) or code consumed in the meantime |
| 500 | `wrapping_invariant_violated` | Defence-in-depth — should never happen |

---

## 5. Step-up integration (per ADR 0027)

No new headers, no new request fields. Bearer-auth middleware exposes `session_id` (derived from access-token, not the token itself). Tier 1+ endpoint handlers call a helper:

```typescript
await requireStepUp({ sessionId, tier: 1 });
// throws ApiError(403, 'step_up_required', { tier: 1 }) on miss
```

The helper executes `GET step_up:<session_id>:t<tier>` against Redis and validates the value's millisecond-timestamp against the tier's grace window. On 403, the client triggers Mechanism A (WebAuthn UV) or Mechanism B (OPAQUE re-prompt) via `POST /api/v1/auth/step-up`, then retries the original call. The step-up endpoint itself is out of scope for this spec; covered in the step-up-auth spec.

Tier assignment:

| Endpoint | Tier |
|---|---|
| `POST /api/v1/admin/invitations` | 4 |
| `POST /api/v1/me/pairing-codes` | 1 |
| Everything else in §4 | 0 |

---

## 6. Rate limits

Per the brief, calibrated to the 50-bit code entropy:

| Endpoint | Per-IP-per-minute | Per-IP-per-hour | Per-actor-per-day |
|---|---|---|---|
| `POST /api/v1/admin/invitations` | — | 100 | — |
| `POST /api/v1/me/pairing-codes` | — | — | 50 generations / 10 active |
| `POST /api/v1/join/start` | 10 | 100 | — |
| `POST /api/v1/join/finish` | 10 | — | — |

Per-actor limits use Redis with TTL = window. Per-IP limits use the existing rate-limit middleware. Single-use atomicity at the DB level is the primary brute-force defence; rate limits are the secondary defence.

---

## 7. DB schema impact

Per the brief, single `pending_codes` table with `type` discriminator. The existing `invitations` table (per `apps/auth-service/src/db/schema.ts`) is renamed and extended:

```typescript
pending_codes: {
  id: uuid (uuidv7, pk),
  type: text ('invitation' | 'pairing'),
  code_hmac: bytea (HMAC-SHA256 of plaintext code),

  // Invitation-only fields
  role: text | null,                    // 'admin' | 'user' | 'primary_admin', invitation-only
  suggested_username: text | null,
  issuer_label: text | null,
  note: text | null,
  attempt_count: integer (default 0),   // existing invitations field; rate-limit-relevant

  // Lifecycle
  created_by: uuid (FK users.id, NOT NULL for both types — operator for invitations,
                    user themself for pairing codes),
  created_at: timestamptz,
  expires_at: timestamptz,
  redeemed_at: timestamptz | null,
  redeemed_by_user_id: uuid | null,
  revoked_at: timestamptz | null,
}
```

HMAC key is `HMAC_KEY_PENDING_CODES`, distinct from the refresh-token HMAC key per the brief's leak-domain-isolation rationale. New env var; added to `.env.example` + README.

Migration plan (executed in the implementation phase, not this spec):
1. Rename `invitations` → `pending_codes`.
2. Add columns: `type` (default `'invitation'` for existing rows), `suggested_username`, `note`.
3. Rename `token_hmac` → `code_hmac`.
4. Drop `issuer_label`'s NOT-NULL constraint (keep nullable as it always was).
5. Add `HMAC_KEY_PENDING_CODES` to env config.
6. Refresh-token cookie `Path` attribute updates from `/v1/token/refresh` to `/api/v1/token/refresh` in lockstep with the route migration. Existing live sessions get a one-time refresh-required state on cookie-path mismatch (graceful: client treats missing refresh-token as "need re-login").

---

## 8. ADR migration impact

This spec affects two ADRs and triggers one new ADR:

1. **ADR 0023 (server-at-root, /api prefix)** — relaxed. Sub-path hosting via transparent reverse-proxy (e.g., Baalnet relay) is now supported. The constraint becomes: "the auth-service mounts at `/api/v1/...` *from its own perspective*; deployers may front it with a path-rewriting reverse-proxy that maps any external prefix to root." Amendment to ADR 0023 lands alongside the implementation.
2. **Existing `/v1/...` endpoints** — migrated to `/api/v1/...` in the same squash. All admin endpoints, all auth endpoints, all link endpoints. Affects `apps/admin-client` and `apps/user-client` fetch baseURLs.
3. **New ADR (number TBD, likely 0028) — "Cross-device join is a unified two-round flow"** — captures the rejection of the brief's one-shot `/api/join` in favour of `/api/v1/join/{start,finish}` with `kind` discriminator, and the rationale (OPAQUE mechanics + uniformity).

---

## 9. Manual verification

Chris runs the following on the dev server before squash:

1. **Invitation create + list + revoke (admin-client):**
   - Log in as admin, create invitation with `suggested_username: chris.tidesson`, `issuer_label: smoke-test`, `note: brainstorm walk-through`. Confirm `qr_url` is shaped `https://localhost:5173/join#<10char>`.
   - Reload the invitations list; confirm `code`/`qr_url` are absent from the list response.
   - Revoke the invitation; confirm state transition to `revoked`.

2. **Invitation redemption (user-client):**
   - Scan the QR (or paste into manual URL+code fields) on a fresh user-client session.
   - Confirm the username field pre-fills with `chris.tidesson`.
   - Submit registration; confirm the user lands in the app with the expected role.

3. **Pairing-code generation + listing + redemption:**
   - Log in as a user, generate a pairing code. Confirm Tier 1 step-up flow if not in grace window.
   - List active pairing codes; confirm the code is shown in full.
   - On a second device, paste URL + code, complete OPAQUE login with the user's passphrase.
   - Confirm the new device receives the wrapped MK and can decrypt server-side data (touch one sync'd item).

4. **Username collision:**
   - On a fresh invitation, attempt to register with a username already taken on the server.
   - Confirm 409 + inline error copy. Pick a different name; confirm success.

5. **Step-up flow:**
   - With Tier 1 grace window expired, attempt to generate a pairing code.
   - Confirm 403 step_up_required → modal appears → re-prompt completes → original call retries automatically.

6. **Sub-path hosting (smoke test):**
   - Spin up a local reverse-proxy stub that maps `/relay-test/` to the auth-service root.
   - Configure user-client base URL to `http://localhost:8080/relay-test/`.
   - Run the invitation-redemption flow end-to-end. Confirm no path-related errors.

7. **Wrapping-invariant violation (deliberately):**
   - In a dev DB, NULL out the `wrapped_master_key` column of an OPAQUE auth_method row.
   - Attempt pairing on a new device.
   - Confirm 500 wrapping_invariant_violated, audit event written, Prometheus counter incremented.

---

## 10. References

- Brief: [`obsidian/briefs/phase 0/cross-device-identity.md`](../../obsidian/briefs/phase%200/cross-device-identity.md)
- Step-up brief: [`obsidian/briefs/phase 0/step-up-auth.md`](../../obsidian/briefs/phase%200/step-up-auth.md)
- ADR 0021: [`obsidian/decisions/0021-phase0-opaque-first-linking.md`](../../obsidian/decisions/0021-phase0-opaque-first-linking.md)
- ADR 0023: [`obsidian/decisions/0023-server-at-root-https-api-prefix.md`](../../obsidian/decisions/0023-server-at-root-https-api-prefix.md) — relaxed by this spec
- ADR 0024: [`obsidian/decisions/0024-single-server-per-account.md`](../../obsidian/decisions/0024-single-server-per-account.md)
- ADR 0025: [`obsidian/decisions/0025-uuidv7-across-the-data-model.md`](../../obsidian/decisions/0025-uuidv7-across-the-data-model.md)
- ADR 0027: [`obsidian/decisions/0027-step-up-authentication-policy.md`](../../obsidian/decisions/0027-step-up-authentication-policy.md)
- Existing code: `apps/auth-service/src/routes/admin/invitations.ts`, `apps/auth-service/src/routes/link.ts`, `apps/auth-service/src/db/schema.ts`
- `CLAUDE.md` §3 (Hard Rules), §9 (Larissa gate), §13 (API-shape verification)
