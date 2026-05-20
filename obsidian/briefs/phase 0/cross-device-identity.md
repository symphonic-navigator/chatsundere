# Chatsundere — Cross-Device Identity & QR Pairing Briefing

**For:** Liz (implementation)
**From:** Lyra (architecture) + Chris (vision)
**Services touched:** `apps/auth-service` (primary), `apps/user-client`, `apps/admin-client`, `packages/shared-types`
**Related ADRs:** ADR 0021 (OPAQUE-first), ADR 0022 (UV-policy), ADR 0023 (server-at-root, this brief), ADR 0024 (single-server-per-account, this brief), ADR 0025 (UUIDv7 across the data model, this brief), ADR 0026 (sync-pull failure modes, this brief), ADR 0027 (step-up policy, formalises the inline minimums in this brief's Step-up section)
**Date:** 2026-05-20

---

## Purpose

This brief formalises the cross-device identity model for Chatsundere:
how a user joins a server, how they pair additional devices to the same
account, and how `local_account → server_account` linking behaves under
the constraint that a user belongs to *exactly one* server at a time.

The central mechanism is **QR-encoded short codes**, layered on top of
the existing OPAQUE-first linking flow (ADR 0021). Two code types share
one surface: **invitations** (operator-issued, used at first link) and
**pairing codes** (user-issued from a linked device, used to add another
device of the same user).

The brief touches user-client onboarding, admin-client invitation
management, and a small but security-critical set of new auth-service
endpoints.

---

## Vision (Chris's framing)

> "I want the user to be themselves everywhere — across devices, across
> re-installs, across device loss. Multiple devices need a sync, that's
> fine, but the *identity* should travel."

Identity travels. The mechanism is QR-coded device pairing on top of
operator-issued invitations. The brief encodes this vision as a series
of concrete decisions.

---

## Identity Model

### Concepts

| Concept | What it is | Where it lives |
|---|---|---|
| `user_id` | Opaque, stable, UUIDv7 identifier | Server, internal; never user-visible |
| `username` | Human-readable label mapped to `user_id` | Server (display) + local (pinned post-link) |
| `local_account` | Pre-link on-device account, no server anchor | Client only |
| `server_account` | Server-side row in `users`, identified by `user_id` | Server |
| Credentials | OPAQUE record, passkeys, recovery key | Distributed per type, server-side |

### Invariants

- **Identity is a server-side concept.** A `local_account` pre-link has
  only a local username and no global anchor. First successful server-
  link binds the local username to a `server_username` (which may differ
  if the original local choice collided on the target server). Post-link,
  the local username is *pinned* to the server username on every device
  belonging to the user.
- **Usernames are server-relative.** `chris@chatsune.me` and
  `chris@bobs-server.de` are distinct identities by design — same as
  email addresses. There is no notion of a global Chatsundere username.
- **A `local_account` is linked to at most one server at a time.** See
  Multi-Server Linking section and [ADR 0024](../../decisions/0024-single-server-per-account.md).
- **`user_id` is never exposed in URLs, error messages, or
  user-facing copy.** It is an internal identifier. Cross-device flows
  refer to the user by `username` server-relative.

---

## Onboarding Paths

[DECIDED] Three explicit paths on the first onboarding screen, no
hidden default. The QR path and Manual path lead to the **same**
onboarding flow downstream; only the input method differs. The
local-only path is preserved as a deliberate choice and is **not** a
commitment trap — late linking is fully supported.

Sketch (illustrative; final visual treatment per UX brief):

```
┌──────────────────────────────────────────┐
│  Welcome to Chatsundere                   │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │ Scan a QR code                      │ │
│  │ From your operator or other device  │ │
│  └─────────────────────────────────────┘ │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │ Enter invitation manually           │ │
│  │ Server:  [_______________]          │ │
│  │ Code:    [____-_____-_____]         │ │
│  └─────────────────────────────────────┘ │
│                                           │
│  ┌─────────────────────────────────────┐ │
│  │ Just this device — no server        │ │
│  │ Single-device, no sync, advanced.   │ │
│  │ You can link later if you get an    │ │
│  │ invitation — your data will follow  │ │
│  │ you, not be replaced.               │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

The "just this device" path is **not** marked as advanced in red or
warning colours — it is a legitimate user choice. The explanatory copy
makes clear that late linking preserves the user's data.

---

## UUIDv7 Across the Data Model

[DECIDED] Every merge-able entity in Chatsundere carries a UUIDv7 from
creation as its primary identifier — client and server, for every type
not just `user_id`. Cross-references to [ADR 0025](../../decisions/0025-uuidv7-across-the-data-model.md).

Affected entity classes today and in the foreseeable horizon:

- `user_id`
- Personas
- Knowledge Base Libraries (and their entries)
- Chats (and their messages)
- Memories
- Invitations and pairing codes
- Future addable types

**Sync is UUID-based, not name-based.** Two entities with the same
UUIDv7 are *the same entity* — apply updates. Two entities with the
same name but different UUIDs are *different entities* — both kept,
coexist, the user resolves duplicates manually via the editors. No
auto-merge by name.

The concrete example Chris gave that drove this decision: an "Amy"
persona on a hosted instance and an "Amy" on a local-Ollama instance
diverged so far over time that they are genuinely distinct entities
despite the shared concept. UUID-based merge respects that. Name-as-
identity would have silently merged them and destroyed real divergence.

### Client-side implementation

[DECIDED] Use the `uuidv7` npm package (~5kB, MIT-licensed, no
dependencies, RFC 9562-compliant). Audited by broad usage and avoids
the subtle correctness traps of a hand-rolled helper (monotonicity
within the same millisecond, sub-ms counter behaviour, random-portion
entropy). The dependency surface is minimal enough that the Omakase
principle in [`CLAUDE.md`](../../../CLAUDE.md) §11 is satisfied
without requiring a hand-rolled alternative.

### Server-side implementation

PostgreSQL 18 ships `gen_uuidv7()` natively. Until we are on PG 18
(Phase 0 targets PG 16+), we provide our own SQL function:

```sql
create or replace function gen_uuidv7() returns uuid
language plpgsql as $$ ... $$;
```

Reference implementation in the brief's accompanying ADR ([ADR 0025](../../decisions/0025-uuidv7-across-the-data-model.md)).

---

## QR-Code Payload Format

[DECIDED] **Custom string format, not a URL.**

```
CHATSUNDERE|<version>|<type>|<host[:port]>|<token>[|<suggested-username>]
```

Examples:

```
CHATSUNDERE|1|INVITE|bobs-server.de|PJK9X-2HM4N-RT8WQ|chris.tidesson
CHATSUNDERE|1|INVITE|bobs-server.de:8443|ZBC3V-7Y5HG-DXP2T
CHATSUNDERE|1|INVITE|localhost:3100|NM4HQ-RX9JB-K7T2P
CHATSUNDERE|1|PAIRING|bobs-server.de|RWVG3-K8YJL-2BPNT
```

### Field definitions

1. `CHATSUNDERE` — magic prefix. Enables trivial "is this our QR?"
   detection and rejection of foreign QRs that happen to be scanned in
   our flow.
2. `<version>` — format version (`1` for now). Forward-compatibility
   hook for future schema changes.
3. `<type>` — `INVITE` or `PAIRING`. Determines which flow the client
   enters.
4. `<host[:port]>` — server hostname; optional port for non-standard
   setups (`localhost:3100` in dev, `bobs-server.de:8443` for a custom
   port).
5. `<token>` — the short code; see Token Format Spec section below.
6. `<suggested-username>` — optional, **only valid for `INVITE`**.
   Operator-supplied hint that pre-fills the username field at
   onboarding. The user can edit it.

### Why custom and not HTTPS URL

- Prevents accidental "open in browser" half-flows when a
  non-Chatsundere QR scanner (the user's phone camera, a generic
  reader) consumes the code.
- Eliminates confused-deputy risk on screenshot forwarding to other
  apps.
- Magic prefix makes "is this our QR?" detection trivial.
- Accepted trade-off: no graceful browser fallback for users who scan
  before installing the PWA. Mitigated by invitation-only signup — the
  operator sends "install the PWA from chatsune.me first, then scan"
  as part of the invitation context.

### Parsing rules

- Strict pipe-separated split. No escape sequences (none of the fields
  may contain `|`).
- Magic prefix check is case-sensitive.
- Version field is parsed as integer; unknown versions are refused
  with user-facing "This QR code is from a newer version of
  Chatsundere; please update the app."
- `<host>` is validated as a hostname per RFC 1123; ports as integer
  1–65535. `localhost` and `127.0.0.1` are accepted; other hostnames
  must be valid DNS labels.
- `<token>` is validated against the token format (see below) before
  any network call is made.
- Manual entry uses the same parser: paste the full string into the
  combined field, or fill structured `Server:` / `Code:` fields and
  the client constructs the canonical form internally.

---

## Token Format Spec

[DECIDED] Three groups of five Base32 characters, hyphen-separated,
voice-friendly.

```
PJK9X-2HM4N-RT8WQ
```

### Alphabet

Base32 per RFC 4648 §6 **minus ambiguous characters**:

- Excluded: `0` (zero), `O` (oh), `1` (one), `I` (eye).
- Final alphabet: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (32 chars).

### Entropy and length

- 15 displayed characters × 5 bits/character = **75 bits of entropy**.
- Sufficient against offline brute-force at any plausible scale.
- Against **online** brute-force, sufficiency depends on rate-limiting
  (see API Surface section). With the proposed limits, expected time
  to brute-force a valid code exceeds the code's TTL by many orders
  of magnitude.

### Voice-friendliness

Designed to be readable aloud over a phone call without confusion
("Papa, Juliett, Kilo, Nine, X-Ray, dash, ..."). The ambiguity-removed
alphabet is the principal contributor; the hyphen placement makes the
read rhythm natural.

### Server-side storage

[DECIDED] **HMAC-stored, not plaintext.**

- Each code is generated server-side as 75 random bits, then
  Base32-encoded for display and HMAC-SHA256-hashed for storage.
- The HMAC key is [DECIDED] **separate from the refresh-token HMAC key**
  for leak-domain isolation. Introduce a distinct env var
  `HMAC_KEY_PENDING_CODES` alongside the existing refresh-token key.
  If the codes key were ever to leak through a code-handling bug, the
  refresh-token surface stays uncompromised. Cost is trivial (one
  additional env var, one additional secret to manage); benefit is a
  measurable defence-in-depth boundary.
- On lookup, the inbound code is re-hashed and compared against the
  stored hash. Constant-time comparison.
- Atomic single-use enforcement uses the existing refresh-token pattern:
  ```sql
  update pending_codes set used_at = now()
  where id = $1 and used_at is null and expires_at > now()
  returning *;
  ```
  Zero rows returned ⇒ code is invalid, expired, or already used.
  The client cannot distinguish those three cases — same error
  surface.

---

## API Surface

Five new endpoints. All shapes [OPEN — pre-implementation
curl-verification recommended] per [`CLAUDE.md`](../../../CLAUDE.md) §13.

### Endpoint table

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/admin/invitations` | Bearer (operator with `admin` or `primary_admin` role) | Create invitation token + QR payload |
| `POST /api/me/pairing-codes` | Bearer (any logged-in user); **requires step-up** (see Step-up Section) | Create pairing code + QR payload for an additional device |
| `GET /api/me/pairing-codes` | Bearer (any logged-in user) | List active pairing codes (for the user-client "your pending invites" view) |
| `DELETE /api/me/pairing-codes/{id}` | Bearer (any logged-in user) | Revoke a code before use or expiry |
| `POST /api/join` | None | Atomic code validation + registration (invitation flow) or device-link (pairing flow) |

### `POST /api/admin/invitations` (operator)

Request:

```json
{
  "suggested_username": "chris.tidesson",
  "expires_in_seconds": 604800,
  "note": "Chris from Tidesson Comms"
}
```

`suggested_username` and `note` are optional. `expires_in_seconds`
defaults to 7 days if omitted; per the [OPEN] item below on operator-
override of TTLs, this may be locked or capped in Phase 0.

Response (`201 Created`):

```json
{
  "id": "0192a1c0-...-uuid",
  "code": "PJK9X-2HM4N-RT8WQ",
  "qr_payload": "CHATSUNDERE|1|INVITE|bobs-server.de|PJK9X-2HM4N-RT8WQ|chris.tidesson",
  "expires_at": "2026-05-27T09:14:00Z",
  "state": "active"
}
```

### `POST /api/me/pairing-codes` (user; step-up)

[**Step-up required** — minimal inline definition per Tier 1 of
[`brief-material-step-up-auth`](../../insights/2026-05-20-brief-material-step-up-auth.md):
this endpoint requires a recent UV-confirmed WebAuthn ceremony **or** a
fresh OPAQUE re-prompt within the last 2 minutes. Without it, the
endpoint returns `403 step_up_required`. The formal pattern will live
in the step-up-auth brief; the minimal version is documented here for
standalone implementability.]

Request body is empty.

Response (`201 Created`):

```json
{
  "id": "0192a1c1-...-uuid",
  "code": "RWVG3-K8YJL-2BPNT",
  "qr_payload": "CHATSUNDERE|1|PAIRING|bobs-server.de|RWVG3-K8YJL-2BPNT",
  "expires_at": "2026-05-20T09:19:00Z",
  "state": "active"
}
```

### `POST /api/join` (no auth)

Request body depends on `type`:

```json
{
  "type": "invitation",
  "code": "PJK9X-2HM4N-RT8WQ",
  "username": "chris",
  "opaque_record": "<base64 OPAQUE registration record>"
}
```

```json
{
  "type": "pairing",
  "code": "RWVG3-K8YJL-2BPNT",
  "opaque_evidence": "<base64 OPAQUE login evidence from the user>"
}
```

Note on the `pairing` flow: pairing-code redemption proves the user
controls the existing account by completing an OPAQUE login round (the
device that scans the QR knows the user's passphrase because the user
just entered it; the server re-validates against the existing OPAQUE
record). This is the only meaningful proof-of-account-control we have
at this stage — pairing codes alone are not sufficient.

[DECIDED] **OPAQUE-evidence model for Phase 0**, with mandatory
Larissa pass on the implementation. An originating-device-handshake
alternative (Phase 1+ candidate) would be tighter against pairing-
code-leak attackers but requires push-notification or comparable new
infrastructure. For Phase 0 the threat model is: attacker who
intercepts a pairing code **and** knows the user's passphrase. The
passphrase requirement is the meaningful defence; the 5-minute TTL is
the secondary defence. Larissa is briefed accordingly:
"we accept pairing-code-leak only against passphrase-knowing
attackers; tightening the handshake is out of scope for Phase 0."

Response on success (`200 OK`):

```json
{
  "user_id": "0192a0ff-...-uuid",
  "username": "chris",
  "access_token": "<jwt>",
  "refresh_token": "<set as http-only cookie>",
  "is_new_account": true
}
```

### Error responses

| Status | Code | Meaning |
|---|---|---|
| `400` | `invalid_code_format` | Code does not match the format spec |
| `403` | `step_up_required` | Endpoint requires fresh step-up |
| `404` | `code_not_found_or_expired` | Code is invalid, expired, or already used (deliberately conflated) |
| `409` | `username_collision` | The chosen `username` is taken on this server (invitation flow only) |
| `429` | `rate_limit_exceeded` | See rate-limiting section |

### Rate limits (Phase 0 defaults)

[DECIDED]

- `POST /api/admin/invitations`: 100 per hour per operator. Sufficient
  for any plausible onboarding burst.
- `POST /api/me/pairing-codes`: 10 active codes per user, 50 generations
  per 24 hours per user.
- `POST /api/join`: 10 attempts per IP per minute, 100 attempts per IP
  per hour, with single-use atomic enforcement per code at the DB
  level. Sliding-window or fixed-window acceptable. **Critical to the
  brute-force resistance of the token format** — these limits together
  with the 75-bit entropy push expected time-to-guess beyond the
  code's TTL by many orders of magnitude.

---

## TTLs

[DECIDED]

| Code type | TTL | Rationale |
|---|---|---|
| Invitation | 7 days | Operator hands invitations out; the 7-day window covers "send Friday, user opens Monday" without manual reissue. |
| Pairing | 5 minutes | Pairing happens immediately between two devices the user controls; longer windows are exposure surface without benefit. |

[OPEN — Operator override of TTL defaults]: explicitly deferred to a
post-v0.1.0 brief. Phase 0 ships hardcoded defaults.

---

## DB Schema Sketch

[DECIDED] Single `pending_codes` table with a `type` discriminator.
Both code types share roughly 90% of their fields (lifecycle, HMAC,
single-use marker); Drizzle's discriminated-union pattern delivers
type-safety at the application layer without needing two physical
tables. Split tables would be a premature optimisation for type
discipline that solves no concrete problem.

Authoritative shape lives in `apps/auth-service/src/db/schema.ts`;
this is the architectural shape for the brief.

```typescript
// pending_codes — covers both invitations and pairing codes
{
  id: uuid (uuidv7, primary key),
  type: text ('invitation' | 'pairing'),
  code_hash: bytea (HMAC-SHA256 of plaintext code),
  // Invitation-only fields
  suggested_username: text | null,
  note: text | null,  // operator-private; never surfaced to the
                      //   redeeming user. See note-visibility decision.
  created_by_user_id: uuid (FK to users; the operator for invitations,
                            the user themself for pairing codes),
  // Lifecycle
  created_at: timestamptz,
  expires_at: timestamptz,
  used_at: timestamptz | null,
  used_by_user_id: uuid | null (set on redemption for audit trail),
  state: text ('active' | 'used' | 'expired' | 'revoked'),
}
```

### `note` field visibility

[DECIDED] **Operator-private.** The `note` field is operator-helper
text ("Chris from Tidesson Comms", "birthday gift account") and is
surfaced **only in admin-client views**. The user redeeming the
invitation never sees it. Rationale: notes might be operationally
sensitive ("account for Bob's mistress", "trial extension for slow
payer") and exposing them at redemption time would be at best awkward
and at worst harmful.

---

## Multi-Server Linking with Auto-Handover

[DECIDED] Single-server-per-account, hard-enforced, with graceful
auto-handover. Cross-ref to [ADR 0024](../../decisions/0024-single-server-per-account.md).

### Behaviour

A `local_account` is linked to *at most one* server at a time. The
linked server is the **active** server. Attempting to scan an
invitation or pairing QR for a different server while already linked
triggers the auto-handover confirm modal (see Confirmation Copy
section).

Confirmation triggers atomic disconnect + re-link in one operation.
Data on the old server is **not** auto-deleted; the user must
explicitly use "Disconnect from server" before the switch if they
want their data removed from the old server.

### Pre-disconnect-sync-pull (variant α)

[DECIDED] Before the auto-handover commits, the client forces a
**full sync-down from the old server** to ensure all server-resident
data is locally cached. Then the local cache (now complete) is
uploaded to the new server.

Concrete state machine (resolved in [ADR 0026](../../decisions/0026-pre-disconnect-sync-pull-failure-modes.md)):

```
1. User scans QR for new server X while linked to server Y.
2. Client surfaces auto-handover confirmation modal.
3. User confirms.
4. Client enters "pre-handover-sync" state.
   a. Client requests full content list from Y (paginated).
   b. Client downloads any items not present locally.
   c. Client verifies local cache matches Y's content set.
5. Client begins POST /api/join on X (with the new code).
6. On successful join, client uploads all local content to X.
7. Client switches active_server to X.
8. Client invalidates Y's bearer token (POST /api/auth/logout on Y).
9. Auto-handover complete.
```

The Y-logout is deferred to step 8 deliberately. If step 5 or 6 fails,
the client stays on Y with no transient "no-active-server" state to
recover from. The client transiently holds valid credentials on both
servers during steps 5–7; this is benign because single-server-per-
account is a client-side data-model rule, not a server-enforced
credential rule.

### Failure modes

The three failure modes (Y unreachable, sync-down verification fails,
X join fails after step 5) are fully specified in
[ADR 0026](../../decisions/0026-pre-disconnect-sync-pull-failure-modes.md),
including the user-facing recovery flows. Summary:

- **Y unreachable in step 4:** refuse handover by default; offer
  "Move anyway — risk losing items from Y" as audit-logged escape
  hatch.
- **Sync-down verification fails in step 4c:** auto-retry once
  (resolves transient network blips and concurrent-upload races),
  then escalate to the same flow as "Y unreachable".
- **X join or upload fails (step 5 or 6):** client stays on Y because
  step 8 has not happened yet. User sees a clear retry / cancel modal
  per the failure subtype.

---

## Username Collision UX

[DECIDED] **Pure inline error on the invitation flow.** No server-side
suggestions; no live as-you-type pre-check.

```
Username: [chris___________]
          ⚠ "chris" is taken on this server. Pick a different name.
```

Server returns plain `409 username_collision` on `POST /api/join`. The
client renders the error inline. User picks something else and retries.

### Rationale

- Username suggestions are a well-known UX anti-pattern (the
  LinkedIn-style "chris1, chris2, chris_real, chris.tidesson"
  generators are universally disliked).
- Server-side suggestion generation is needless complexity for an
  edge case (rare on small self-hosted instances).
- A live as-you-type pre-check (the typeahead variant) introduces a
  **username-enumeration vector** — an attacker could discover
  existing usernames through the API. Worse security than the simple
  flow.

### Suggested-username from QR interaction

If the QR's optional `<suggested-username>` field is present and the
user does not edit it, the inline error appears as normal on submit
if it collides. The suggested-username is a *hint*, not a guarantee.

---

## Confirmation Copy

[DECIDED] Neutral, explicit, non-dramatic phrasing. The original
"wipe local data" warning is gone — the server has no plaintext data
of its own and merge-with-duplicates is the policy, so the warning
mis-modelled actual behaviour.

### Invitation flow

```
You are about to join Server [bobs-server.de].

Operator: Bob
Username: [chris.tidesson]   ← editable

Your data on this device will sync to the server and be encrypted
with your master key. The operator cannot read it.

[Cancel]  [Join Bob's server]
```

### Device-pair flow

```
Add this device to your account on [bobs-server.de]?

Account: chris.tidesson
Operator: Bob

Your data on this device will be merged with your account data.
Items with matching IDs are updated; items unique to this device are
uploaded. You may see duplicates if you created similar items
independently on multiple devices.

[Cancel]  [Add this device]
```

### Auto-handover flow

```
You are already linked to Server [bobs-server.de].

Continuing will sign this device out of Bob's server and link it to
[alices-server.de] instead. Your other devices stay on Bob's server
— you'll need to migrate them separately.

Your local data will be uploaded to Alice's server. Your data on
Bob's server stays there (encrypted, no longer accessible from this
device); to remove it, sign in to Bob first and use "Disconnect from
server".

[Cancel]  [Switch to Alice's server]
```

All three modals follow the same visual treatment: two buttons, cancel
on the left, action on the right; the action button is the destructive
visual style when the operation is destructive (handover), neutral
otherwise.

---

## Self-hosting Constraints

[DECIDED] Three constraints, recorded together as [ADR 0023](../../decisions/0023-server-at-root-https-api-prefix.md).

1. **Server hosted at domain root.** Sub-path hosting
   (`https://example.com/chatsundere/`) is **not supported**. Self-hosters
   dedicate a full subdomain or domain to a Chatsundere instance.
   Operator-side documentation will say so.
2. **API prefix is `/api/...`** off the root. All endpoints in this
   brief use the `/api/` prefix.
3. **HTTPS required, loopback excepted.** `localhost:*` and
   `127.0.0.1:*` accept HTTP (per WebAuthn's secure-context exception);
   all other hosts must serve HTTPS. The user-client refuses to connect
   over plain HTTP to non-loopback hosts.

The constraints simplify the auth-service routing, eliminate
confusing-deputy attacks via sub-path collisions, and align with
WebAuthn's secure-context rules without special-casing.

---

## Step-up Authentication Requirements

> **Note:** the formal step-up policy now lives in
> [`step-up-auth.md`](step-up-auth.md) / [ADR 0027](../../decisions/0027-step-up-authentication-policy.md).
> The inline minimums below remain authoritative for this brief's
> standalone implementability and are equivalent to the formal tiers;
> new auth-touching work should reference the step-up brief directly.

Per the inline-minimal pattern (see [step-up brief material](../../insights/2026-05-20-brief-material-step-up-auth.md)
for origin, and the formal [step-up-auth brief](step-up-auth.md) for the
canonical specification):

| Operation | Step-up tier | Minimum requirement |
|---|---|---|
| `POST /api/me/pairing-codes` | Tier 1 | Fresh UV-confirmed WebAuthn ceremony OR OPAQUE re-prompt within last 2 minutes |
| `POST /api/join` with `type=pairing` (i.e., scanning a pairing QR on the new device) | Tier 1 | OPAQUE evidence (= passphrase re-entry; user is on a new device, so this is the natural gate) |
| Auto-handover trigger (scanning a non-matching server's QR on a linked client) | Tier 3 | Modal confirmation **plus** fresh OPAQUE re-prompt on the originating device |
| `DELETE /api/me/pairing-codes/{id}` | None | Routine session is sufficient; revocation is a safety lever, not a destructive op |
| `POST /api/admin/invitations` | Tier 4 (operator) | Fresh UV-confirmed ceremony within last 5 minutes; OPAQUE fallback acceptable |

These minimums will be formalised and possibly tightened in the
step-up-auth brief. The brief will not loosen them below the levels
recorded here; if it does, the cross-device-identity brief is amended
in the same change.

---

## Implementation Notes for Liz

### Auth-service additions (Larissa-audit territory)

- New table `pending_codes` (single table with `type` discriminator per
  the DB Schema decision above).
- Five new endpoints per the API Surface table.
- HMAC code generation + atomic single-use enforcement using the
  existing refresh-token pattern.
- Rate-limiting middleware per the rate-limit section.
- OPAQUE-registration accepts a `code` parameter and validates atomically.
- `users` table enriched: ensure `user_id` is UUIDv7 (migration if
  current schema uses UUIDv4).
- Step-up gate on `POST /api/me/pairing-codes` and the auto-handover
  trigger (server-side enforcement, not just client-side UX).

### Admin-client (a future "operator UX" squash)

- "Create invitation" form (suggested username, expiry override if
  enabled, generate button).
- "Invitations" list with state column (`active` / `used` / `expired`
  / `revoked`).
- Operator audit log of invitation creation and redemption.

### User-client

- Onboarding split into three paths per the Onboarding Paths section.
- QR scanner component (the `qr-scanner` dependency already exists per
  the originating material; verify).
- Manual-entry form with auto-format for hyphens.
- Code parser that accepts both QR-scanned and manually-entered strings
  via the canonical format.
- "Add device" flow in Settings: trigger pairing-code generation,
  display QR + voice-friendly code text, show countdown to expiry,
  watch for revoke / use / expiry events with auto-refresh.
- Auto-handover confirm modal when scanning a QR whose `<host>` does
  not match the linked server.

### Shared types

`packages/shared-types` gains:

- `InvitationPayload`, `PairingCodePayload`.
- `JoinRequest` (discriminated union: `invitation` | `pairing`).
- `JoinResponse`.
- Error-code enum: `invalid_code_format`, `step_up_required`,
  `code_not_found_or_expired`, `username_collision`, `rate_limit_exceeded`.

### Larissa pre-squash audits

- Auth-service changes touch `apps/auth-service/**` — mandatory Larissa
  pass per [`CLAUDE.md`](../../../CLAUDE.md) §9.
- User-client changes are frontend-only by default; the auto-handover
  flow's pre-disconnect-sync-pull state machine is borderline (it
  manipulates the cryptographic-acceptance surface across two servers)
  and **probably warrants a single Larissa pass on that file** at Liz's
  judgement. See [`2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md`](../../insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md).

---

## What this brief explicitly does **not** cover

Out of scope for this brief. Some have homes elsewhere; others are
explicitly Phase 1+.

- **Conflict resolution on concurrent edits** (LWW vs CRDT vs hybrid)
  — Phase 1 sync-service brief; Chris flagged this as "spannend genug
  *hust*" in the originating material.
- **Username rename** — explicitly deferred (Q7 in originating
  material); lands as part of the sync-service brief.
- **Federation across servers** — out of scope. Single-server-per-account
  is a hard rule, not a soft default.
- **Operator-issued invitations with capped TTLs/quotas** — Phase 0
  uses hardcoded defaults; operator override is a post-v0.1.0 feature.
- **Pairing-code QR sharing across untrusted channels (e.g., email)**
  — pairing codes are intended for in-person device transitions
  (camera-to-screen). Users *can* share them otherwise but accept the
  exposure surface; we do not document this as a supported flow.

---

## Open items for the brief

Items 1, 2, 4, 5, 6, 7, and 8 from the original [OPEN] list have been
resolved — items 1, 2, 4, 5, 6, 8 in the 2026-05-20 tension-walkthrough
with Chris, and item 7 in [ADR 0026](../../decisions/0026-pre-disconnect-sync-pull-failure-modes.md).
One item remains open:

| # | Item | Where in brief | Resolution path |
|---|---|---|---|
| 3 | API endpoint shapes: pre-implementation curl-verification with Chris | API Surface § | Chris exercises the proposed request/response bodies with curl before Liz writes tests against them. Per [`CLAUDE.md`](../../../CLAUDE.md) §13 "API shape verification before lock-in." |

Once item #3 is verified, Liz can proceed with implementation.

---

## References

- [ADR 0021](../../decisions/0021-phase0-opaque-first-linking.md) — OPAQUE-first linking; pairing flow inherits its constraints.
- [ADR 0022](../../decisions/0022-uv-policy-for-webauthn-passkeys.md) — UV-policy; step-up section overrides where Tier 1+ applies.
- [ADR 0023](../../decisions/0023-server-at-root-https-api-prefix.md) — self-hosting constraints recorded from this brief.
- [ADR 0024](../../decisions/0024-single-server-per-account.md) — single-server-per-account.
- [ADR 0025](../../decisions/0025-uuidv7-across-the-data-model.md) — UUIDv7 universally.
- [`obsidian/briefs/phase 0/auth-service.md`](auth-service.md) — auth-service base; this brief extends it.
- [`obsidian/briefs/phase 0/crypto.md`](crypto.md) — client-side crypto; UUIDv7 helper plus OPAQUE flows live here.
- [`obsidian/briefs/phase 0/passkey-uv-policy.md`](passkey-uv-policy.md) — sibling brief; step-up section here reuses the same vocabulary.
- [`obsidian/insights/2026-05-19-brief-material-cross-device-identity.md`](../../insights/2026-05-19-brief-material-cross-device-identity.md) — originating discussion notes.
- [`obsidian/insights/2026-05-20-brief-material-step-up-auth.md`](../../insights/2026-05-20-brief-material-step-up-auth.md) — step-up tiers and mechanisms.
- [`CLAUDE.md`](../../../CLAUDE.md) §3 (Hard Rules), §9 (Larissa gate), §11 (UX principles), §13 (lessons including API-shape pre-verification).
