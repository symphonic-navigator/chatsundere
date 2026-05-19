# Brief Material — Cross-Device Identity, QR Pairing, Onboarding

**For:** Lyra (to formalise into `obsidian/briefs/phase 0/cross-device-identity.md` and subsidiary specs / ADRs)
**From:** Chris + Liz (open-design-questions walk-through, 2026-05-19)
**Originating discussion:** [[2026-05-19-open-design-questions]] §1
**Status:** Seven sub-questions resolved; one (Q7 username-rename) explicitly deferred to Phase 1. Awaiting Lyra brief + supporting ADRs.

---

## Vision (Chris's framing)

> "I want the user to be themselves everywhere — across devices, across
> re-installs, across device loss. Multiple devices need a sync, that's
> fine, but the *identity* should travel."

Implementation mechanism: **QR-based device pairing**, layered on top of
the existing OPAQUE-server-linking flow. The user joins a server via an
operator-issued invitation, then pairs additional devices via codes
generated from the server.

---

## Identity Model (settled)

| Concept | What it is | Where it lives |
|---|---|---|
| `user_id` | Opaque, stable, UUIDv7 identifier | Server, internal; never user-visible |
| `username` | Human-readable label mapped to `user_id` | Server (display) + local (pinned post-link) |
| Credentials | Passphrase (OPAQUE), passkeys (PRF), recovery key | Distributed by type |

**Identity is a server-side concept.** Pre-link, a `local_account` has
only a local username with no global anchor. First successful server-
link binds the local username to a `server_username` (which may differ
if the user's original local choice collided with an existing one on
the target server); post-link the local username is *pinned* to the
server username on every device.

**Usernames are server-relative.** `chris@chatsune.me` and
`chris@bobs-server.de` are different identities by design — same as
email addresses.

---

## Decisions

### Q1 — Onboarding Default Flow

[DECIDED] **Three explicit paths on the first onboarding screen**, no
hidden default:

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

The QR path and Manual path lead to the **same** onboarding flow; only
the input method differs. The local-only path is preserved as a
deliberate choice with no committment trap — late linking is supported.

### Sub-question (emerged): Merge Strategy for Cross-Device Sync

[DECIDED] **UUID-based merge, name-collisions tolerated.**

All merge-able entities (Personas, Knowledge Base Libraries, Chats,
Memories, future addable types) carry UUIDv7 as primary identity. Sync
operates on UUID — two entities with the same UUID are *the same
entity* (apply updates); two entities with the same name but different
UUIDs are *different entities* (both kept, coexist).

User accepts that duplicates by name may exist post-merge (real example
from Chris: an "Amy" persona on his hosted instance and an "Amy" on
local-Ollama diverged so far they are two genuinely distinct entities
despite shared concept; UUID-based merge respects that). The user
resolves duplicates manually via the editors when wanted; there is no
auto-merge by name.

**Architectural principle**: every merge-able entity in Chatsundere
ships with a UUIDv7 from creation. No name-as-identity anywhere.

### Q2 — `user_id` Format

[DECIDED] **UUIDv7 universally** — client and server, all entities not
just `user_id`. Rationale: B-tree-friendly (timestamp-prefixed inserts),
sortable (chronological order without `created_at` field needed for
most cases), 75 bits random component is plenty for collision-free
operation at our scale, RFC 9562 standardised (2024).

Client-side: small `uuidv7` library or hand-rolled helper (the function
is ~30 lines). `crypto.randomUUID()` produces v4 by default, so we
cannot use it without an `Object.assign` wrapper.

Server-side: Postgres native `uuid` column type with custom
`gen_uuidv7()` function (Postgres 18 ships it natively; until then we
provide our own).

### Q3 — QR-Code Payload Format

[DECIDED] **Custom string format**, not a URL.

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

Fields:
1. `CHATSUNDERE` — magic prefix
2. `<version>` — format version (`1` for now)
3. `<type>` — `INVITE` or `PAIRING`
4. `<host[:port]>` — Server hostname, optional port for dev/non-standard setups
5. `<token>` — the short code (see below)
6. `<suggested-username>` — optional, only for INVITE; operator-supplied hint

**Why custom and not HTTPS URL:**
- Prevents accidental "open in browser" half-flows when a non-Chatsundere
  QR scanner reads the code (e.g., the user's default phone camera app).
- Eliminates confused-deputy risk on screenshot forwarding.
- Magic prefix makes "is this our QR?" detection trivial in-app.
- Trade-off accepted: no graceful browser fallback for non-installed
  apps. Acceptable because Chatsundere is invitation-only — the
  operator has direct contact with the user and can send "install the
  PWA from chatsune.me first, then scan this QR" as part of the
  invitation message.

**Token format**:
- 3 groups of 5 chars (Base32, ambiguous-chars removed: no `0/O`, no `1/I`)
- Hyphenated for readability: `PJK9X-2HM4N-RT8WQ`
- 75 bits entropy in 15 displayed chars
- Voice-friendly for verbal transmission ("Papa, Juliett, Kilo, nine, X-Ray...")

**Server-side**:
- All codes are server-generated and HMAC-stored (analogous to
  refresh-tokens already in auth-service).
- Atomic single-use enforcement: `UPDATE pending_codes SET used_at = now()
  WHERE id = $1 AND used_at IS NULL` — zero rows means already used.

**API surface (new endpoints needed)**:

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/admin/invitations` | Operator | Create invitation token + QR |
| `POST /api/me/pairing-codes` | User | Create pairing code + QR for another device |
| `GET /api/me/pairing-codes` | User | List active pairing codes (for UI display) |
| `DELETE /api/me/pairing-codes/{id}` | User | Revoke before use/expiry |
| `POST /api/join` | None | Atomic code-validation + registration/device-link |

`POST /api/join` body distinguishes flows:
```json
{ "type": "invitation", "code": "PJK9X-2HM4N-RT8WQ", "username": "chris", "opaque_record": "..." }
{ "type": "pairing",    "code": "RWVG3-K8YJL-2BPNT", "opaque_evidence": "..." }
```

**TTLs (Phase 0 defaults, no operator-override yet)**:
- Invitation: 7 days
- Pairing: 5 minutes

**Local + manual entry**: the user can paste a full QR string into a
manual-entry field, or fill in the structured `Server: __ / Code: __`
form. Both paths feed the same `/api/join` call.

### Q4 — Confirmation Copy

[DECIDED] **Neutral, explicit, non-dramatic phrasing.** The original
"wipe local data" warning is gone — Chris clarified that the server
has no own data and merge-with-duplicates is the policy, so the warning
mismodelled the actual behaviour.

**Invitation flow:**
```
You are about to join Server [bobs-server.de].

Operator: Bob
Username: [chris.tidesson]   ← editable

Your data on this device will sync to the server and be encrypted with
your master key. The operator cannot read it.

[Cancel]  [Join Bob's server]
```

**Device-pair flow:**
```
Add this device to your account on [bobs-server.de]?

Account: chris.tidesson
Operator: Bob

Your data on this device will be merged with your account data. Items
with matching IDs are updated; items unique to this device are
uploaded. You may see duplicates if you created similar items
independently on multiple devices.

[Cancel]  [Add this device]
```

**Auto-handover** (Q5):
```
You are already linked to Server [bobs-server.de].

Continuing will sign this device out of Bob's server and link it to
[alices-server.de] instead. Your other devices stay on Bob's server —
you'll need to migrate them separately.

Your local data will be uploaded to Alice's server. Your data on
Bob's server stays there (encrypted, no longer accessible from this
device); to remove it, sign in to Bob first and use "Disconnect from
server".

[Cancel]  [Switch to Alice's server]
```

### Q5 — Multi-Server Linking

[DECIDED] **Single-server per local_account, hard-enforced**, with
**graceful auto-handover** on switching attempt.

- A `local_account` is linked to *at most one* server at a time.
- Attempting to scan an invitation/pairing-QR for a different server
  while already linked triggers the auto-handover confirm modal (Q4).
- Confirmation triggers atomic disconnect + re-link in one operation.
- Data on the old server is **not** auto-deleted; user must explicitly
  use "Disconnect from server" before the switch if they want their
  data removed.

[DECIDED] **Pre-disconnect-sync-pull (variant α)** for data-preservation:
before the auto-handover commits, the client forces a full sync-down
from the old server to ensure all server-resident data is locally
cached. Then the local cache (now complete) is uploaded to the new
server. Slower switch, but honours the "no data loss on linking"
guarantee. Worth the latency.

### Q6 — Username Collision UX

[DECIDED] **Pure inline error, no server-side suggestions.**

```
Username: [chris___________]
          ⚠ "chris" is taken on this server. Pick a different name.
```

Server returns plain `409 Conflict` on `POST /api/join`. Client renders
the error inline. User picks something else and retries.

Rationale:
- Username suggestions are a known UX anti-pattern (LinkedIn-style
  auto-suggestions are universally disliked).
- Server-side suggestion generation is needless complexity for an
  edge case (rare on small self-hosted instances).
- A live "as-you-type" pre-check (variant 3) introduces a username-
  enumeration vector — an attacker could discover existing usernames
  through the API. Worse security than the simple flow.

### Q7 — Username Rename Flow

[DEFERRED] **Phase 1+ feature; lands as part of sync-service brief.**

Anchor list for Lyra when she gets to it:
- Username is OPAQUE-KDF input → rename = atomic OPAQUE re-registration
  under new name. Cannot be a plain UPDATE.
- Multi-device coordination: server invalidates all non-initiating
  refresh-tokens; other devices re-login under new name.
- UX flow lives in Settings → Account, with ConfirmTyped + passphrase
  re-prompt for re-auth.
- Larissa-audit territory (auth-touching).
- Rate-limit: max 1 rename per 30 days (suggested; reviewed in brief).

---

## Architectural Constraints That Fell Out

These are first-class architectural decisions that should land as ADRs:

1. **Server hosted at domain root** — no sub-path hosting
   (e.g., `https://example.com/chatsundere/` is not supported). API
   prefix is `/api/...` off the root. Self-hosters dedicate a full
   subdomain or domain to a Chatsundere instance.
2. **HTTPS-required except for loopback** — `localhost:*` and
   `127.0.0.1:*` accept HTTP (per WebAuthn spec on secure contexts);
   all other hosts must be HTTPS.
3. **UUIDv7 across the entire data model** (see Sub-question above).
4. **All persistent codes/tokens are HMAC-stored** (analogous to
   refresh-tokens) — server never stores plaintext invitation or
   pairing codes.
5. **Single-server-per-account** is a hard rule, not a soft default
   (see Q5).

---

## Implementation Notes for Liz (Post-Brief, Post-Spec)

When the Lyra brief lands and the ADRs are written, the implementation
fans out into several areas:

**Auth-service additions** (Larissa-audit territory):
- New tables: `invitations`, `pairing_codes`, `accounts` enriched with
  `user_id UUID`
- New endpoints: see Q3 API surface table
- Atomic code validation + single-use enforcement (existing
  refresh-token HMAC pattern)
- Rate-limiting per user on pairing-code generation
- OPAQUE-registration extended to accept `code` parameter

**Admin-client** (Squash C territory):
- "Create invitation" action with form (suggested username, expiry
  override, generate-button)
- "Invitations" list with state (active, used, expired, revoked)
- Operator-perspective audit log of invitation creation + redemption

**User-client** (post-Phase-0 enhancement):
- Onboarding screen split into three paths (Q1)
- QR scanner component (already in deps as `qr-scanner`)
- Manual entry form (Server + Code fields, auto-format the hyphens)
- Code parser/validator for both QR-scanned and manually-entered strings
- "Add device" flow in Settings: trigger pairing-code generation,
  display QR + code text, watch for revoke / use / expiry events
- Auto-handover confirm modal (Q5) when scanning a non-matching server's QR

**Shared types**: invitation payload shape, pairing code payload, join
request bodies.

---

## What Lyra's Brief Should Formalise

When Lyra writes the formal brief, the threads to clean up:

1. **Single-username post-link rule**, derived from Identity Model
   section. State it explicitly.
2. **The three onboarding paths** with their UX flows fully spec'd
   (each becomes a route in user-client + admin-client where relevant).
3. **API surface** — the five endpoints in Q3, with request/response
   shapes, error codes, rate-limit guidance.
4. **Token-format spec** — Base32 alphabet, exact byte layout, hyphen
   placement, length, server-side HMAC storage scheme.
5. **DB schema** for `invitations` and `pairing_codes` tables.
6. **Self-hosting constraints** — domain-root, HTTPS, /api prefix —
   probably an own ADR.
7. **Pre-disconnect-sync-pull procedure** — the exact sequence of
   server calls + state transitions on the client during an
   auto-handover. May want a separate small ADR.
8. **Pointer to Phase 1 sync-service brief** for the open items:
   conflict-resolution-on-concurrent-edits ("welcher change hat
   recht"), Q7 username-rename, multi-device-state-coordination
   beyond the basics.

---

## Open Items for the Brief (Not Yet Decided)

| Item | Where to resolve | Notes |
|---|---|---|
| Conflict resolution on concurrent edits (LWW vs CRDT vs ...) | Phase 1 sync-service brief | Chris flagged ("das wird spannend genug *hust*"); not in scope for cross-device-identity brief |
| Rate-limiting numbers for pairing-code generation | Auth-service spec extension | Suggested defaults: 10 active codes per user, 50 generations per 24h |
| Pre-disconnect-sync-pull exact state machine | Could be its own ADR | Variant α decided in principle; spec the procedure |
| Operator-override of TTL defaults | Phase 1 or later | Defaults are fine for v0.1.0 |
| Code generation: human-readable Base32 alphabet exactly which chars | Token-format spec | Standard suggestion: RFC 4648 §6 minus 0, O, 1, I |

---

## Action Triggers

| Item | Trigger | Owner |
|---|---|---|
| Lyra writes formal brief from this material | Next architecture-sparring session with Chris | Chris + Lyra |
| ADR — server-at-domain-root, HTTPS, /api prefix | Alongside the brief | Chris + Lyra |
| ADR — single-server-per-account | Alongside the brief | Chris + Lyra |
| Implementation of onboarding three-path UI | After brief lands; user-client polish squash | Liz |
| Implementation of auth-service code endpoints | After brief + ADRs land; Larissa-audited | Liz + Larissa |
| Q7 (username-rename) tackled | Phase 1 sync-service brief | Chris + Lyra |
| Conflict-resolution-on-sync tackled | Phase 1 sync-service brief | Chris + Lyra |
| Pre-disconnect-sync-pull state-machine ADR | Before implementation | Chris + Lyra |
