# Chatsundere — Step-up Authentication Briefing

**For:** Liz (implementation)
**From:** Lyra (architecture) + Chris (vision)
**Services touched:** `apps/auth-service` (primary), `apps/user-client`, `apps/admin-client`
**Related ADRs:** ADR 0021 (OPAQUE-first), ADR 0022 (UV-policy default), ADR 0024 (single-server-per-account), ADR 0027 (this brief's decision)
**Date:** 2026-05-20

---

## Purpose

[ADR 0022](../../decisions/0022-uv-policy-for-webauthn-passkeys.md) set
`userVerification: 'preferred'` as the Chatsundere default for routine
unlock. That setting is correct for opening the app, resuming a chat,
reading existing data. It is too loose for operations that change auth
state, re-disclose secrets, destroy data, or otherwise produce
consequences a passive observer of an unattended unlocked client could
exploit.

This brief specifies the **step-up authentication** layer that sits on
top of the routine session: which operations require it, which
mechanisms can satisfy it, how long a step-up confirmation remains
valid, and how the server tracks and enforces it.

The cross-device-identity brief currently carries inline minimal
step-up requirements on three of its endpoints. This brief **supersedes
those inline minimums** with formal per-tier definitions; the
cross-device-identity brief continues to be standalone-implementable,
but new auth-touching work after this brief lands references this
brief's tiers rather than re-defining them.

---

## Context

### Why step-up exists

The routine session, post-UV='preferred' login, gives a client the
ability to read the user's data and perform unprivileged mutations
(create a chat, send a message, edit a persona). What it does **not**
give — by deliberate design — is the ability to perform high-consequence
operations on the strength of a possibly-stale, possibly-unverified
unlock event.

Three threats motivate step-up:

1. **Unattended unlocked client.** The user walks away from their
   machine with the app open and their credential-manager vault
   unlocked. An opportunistic observer (housemate, colleague, partner
   in a contested relationship) reaches the client and starts clicking.
2. **Hijacked session.** A bearer token leaks somehow (XSS,
   cross-origin attack, leaked refresh-token cookie). The attacker
   has session-level access but not the user's fresh consent.
3. **Mistake protection.** The user themselves clicks something
   destructive in a moment of inattention. A step-up prompt is the
   "are you sure?" with crypto behind it.

Threat 1 is the dominant motivator because it composes badly with
ADR 0022's acceptance of vault-stored passkeys (the vault is the
security boundary; once unlocked, the boundary is gone). Step-up
restores a per-operation boundary specifically where it matters.

### What step-up is NOT

- It is not a re-authentication of the entire session. The routine
  session remains valid; only the privileged operation requires a
  fresh proof.
- It is not a CAPTCHA, security question, or out-of-band code. Those
  patterns are weaker than what we already have (passkey or OPAQUE)
  and add friction without security benefit.
- It is not configurable per-user. Per [`CLAUDE.md`](../../../CLAUDE.md)
  §11 (Omakase), every Chatsundere user gets the same step-up
  behaviour. Operators have no knob to relax it.

---

## Tier Classification

Operations are classified by what they mutate or expose, not by where
they live in the UI. The classification is the source of truth; new
endpoints inherit their tier from this list.

### Tier 1 — Mutation of auth state

These change *what counts as the user*. Lose this gate, lose the
account.

- `POST /v1/link/passkey/{start,finish}` — add a new passkey
  (bearer-authorised path per [ADR 0021](../../decisions/0021-phase0-opaque-first-linking.md))
- `DELETE /v1/auth-methods/{id}` — remove an existing passkey
- `POST /v1/auth/passphrase/change` — OPAQUE re-registration with new
  passphrase
- `POST /api/me/pairing-codes` — generate a pairing code for an
  additional device (cross-device-identity brief)
- `POST /api/join` with `type=pairing` — redeem a pairing code on a
  new device; the OPAQUE evidence in the request *is* the step-up
  for this case (the user is on a new device, so passphrase entry is
  the natural gate)
- Username rename — when implemented (Phase 1+, deferred per
  cross-device-identity brief Q7)

### Tier 2 — Re-disclosure of secrets

These reveal material that was meant to be shown only once or under
explicit consent.

- Re-reveal of the recovery key — **not currently offered**
  per [ADR 0007](../../decisions/0007-recovery-key-required-at-registration.md).
  If we ever soften that, re-reveal lands here at Tier 2.
- Cleartext export of master-key-wrapped vault content — **not currently
  offered**; design call when proposed.
- Export of operator-side audit logs containing usernames — Tier 4
  variant (operator surface), see below.

Tier 2 is empty in Phase 0; it exists in the brief as a reserved tier
so future features inherit the right behaviour.

### Tier 3 — Destructive operations

These cannot be undone, or can only be undone by re-onboarding.

- `DELETE /api/me/account` — full server-side wipe with local data
  deletion
- "Disconnect from server" action — the explicit-pre-handover delete
  variant; semantically a half-account-delete
- Auto-handover trigger (scanning a non-matching server's QR while
  linked, per cross-device-identity brief §Multi-Server Linking) —
  destructive because the user's local data is about to be uploaded
  to a different server, and the link to the old server is about to
  be severed

### Tier 4 — Operator-side privileged operations

Different threat model (operator is trusted by definition), but a
hijacked admin session can still silently mutate the user population.

- `POST /api/admin/invitations` — create invitation tokens
- `DELETE /api/admin/invitations/{id}` — revoke
- `POST /api/admin/users/{id}/suspend` — user suspension actions
- Operator role changes — when implemented

Tier 4 operates with longer grace windows (operators do bursts of
related work) but uses the same mechanisms.

### Tier 0 — No step-up required

Everything else. Routine session is sufficient. Examples for clarity:

- Reading own data (chats, personas, memories, libraries)
- Creating, editing, or deleting routine content (chats, messages,
  personas, library entries, memories)
- Listing own active pairing codes (`GET /api/me/pairing-codes`)
- Revoking own active pairing codes
  (`DELETE /api/me/pairing-codes/{id}`) — this is a safety lever for
  the user, the opposite of destructive
- Routine sync operations
- Reading own session info (the passive-auth-state-on-profile pattern
  per [`2026-05-20-pattern-passive-auth-state-on-profile`](../../insights/2026-05-20-pattern-passive-auth-state-on-profile.md))

---

## Mechanism Options

Three primitives. The brief uses combinations of them per tier; this
section defines them once.

### Mechanism A — Fresh WebAuthn ceremony with UV='required'

The client initiates a new WebAuthn assertion, this time overriding
the default UV='preferred' to UV='required'. The user re-taps their
authenticator with full UV. If their authenticator cannot do UV
(Bitwarden Desktop with unlocked vault, no-PIN Yubikey), the client
**transparently falls through to Mechanism B**.

Server verifies the assertion and issues a step-up token with TTL =
the tier's grace window.

### Mechanism B — OPAQUE re-prompt

A modal asks for the OPAQUE passphrase. Server re-runs OPAQUE
authentication (a fresh OPAQUE round, not just a string compare) and
issues a step-up token with TTL = the tier's grace window.

Mechanism B is universal — it works for every account regardless of
authenticator configuration, because every account has OPAQUE by
[ADR 0021](../../decisions/0021-phase0-opaque-first-linking.md). It
is the fallback for A, and the primary mechanism for users who
explicitly prefer passphrase over biometric.

### Mechanism C — Recent-auth grace window

If a step-up confirmation happened within the tier's grace window,
the operation proceeds without prompting. The grace window is
per-tier (see below) and per-session — a logout invalidates all
active grace windows for that session.

Mechanism C is **not a substitute** for A or B; it is a soft cache
of a recent A or B success. The first sensitive operation always
triggers A (or B fallback); subsequent operations within the window
proceed silently.

---

## Per-Tier Mapping

[DECIDED]

| Tier | Primary | Fallback | Grace window | Notes |
|---|---|---|---|---|
| 0 | none | none | n/a | routine session |
| 1 | A | B | 2 minutes | covers "add two passkeys in a row" |
| 2 | A | B | none — always re-prompt | re-disclosure of secrets gets no cache |
| 3 | A | B | none — always re-prompt | destructive ops get no cache |
| 4 | A | B | 5 minutes | operators do bursts of related admin work |

Tier 2 and Tier 3 deliberately reject grace windows: re-disclosure of
secrets and irreversible destruction are exactly the operations where
"the user might have walked away from their desk" is the threat. The
extra confirmation each time is the point.

---

## Server-side State

### Where step-up confirmations live

[DECIDED] **Redis, per-session, with TTL = grace window for the tier
that established the confirmation.**

Key shape:

```
step_up:<session_id>:<tier> → unix_ts_ms_of_confirmation
```

- `<session_id>` is a server-side identifier derived from the access
  token (not the access token itself; we never put tokens in keys).
- `<tier>` is `t1`, `t3`, or `t4` (no `t0` because no confirmation
  exists, no `t2` because no grace window).
- The value is the millisecond timestamp of the confirmation, set on
  successful Mechanism A or B completion.

TTL is applied to the key directly:
- `t1`: 120 seconds
- `t4`: 300 seconds
- `t3`: not stored at all (always re-prompt; no key exists)

On logout (`POST /v1/auth/logout`) the server `DEL`s every
`step_up:<session_id>:*` key for that session.

### Why Redis, not Postgres

- **Sub-ms lookup latency.** Every privileged endpoint checks; the
  hot path needs to stay hot.
- **Native TTL.** No background cleanup job.
- **Easy bulk-revocation.** Logout invalidates all keys for a session
  in one `SCAN` + `DEL` pass.
- **Volatility is fine.** Step-up grace is by definition short-lived;
  losing the cache on Redis restart just means users get prompted
  once more, which is correct fail-safe behaviour.

Refresh-token revocation already lives in Redis per the existing
auth-service architecture; this extends an existing pattern, not a
new infrastructure dependency.

### Why not a signed JWT claim

Stateless step-up tokens (a JWT carrying "step-up confirmed at TS")
were considered and rejected. Stateless means:

- Revocation requires either short TTL (every operation needs a
  fresh JWT, defeating Mechanism C's grace-window benefit) or a
  blocklist (which puts us back into stateful territory, with the
  blocklist living in Redis anyway).
- A leaked step-up JWT cannot be invalidated. With Redis keys we
  can `DEL` immediately on suspicion.

The complexity of a stateless approach buys nothing because we already
have Redis online for refresh-token revocation.

---

## API Surface

### `POST /v1/auth/step-up`

Single endpoint that completes a step-up using either Mechanism A
(WebAuthn) or Mechanism B (OPAQUE). The client signals which mechanism
in the body.

Request (Mechanism A — WebAuthn):

```json
{
  "mechanism": "webauthn",
  "tier_requested": "t1",
  "assertion": "<base64 WebAuthn assertion with UV verified>"
}
```

Request (Mechanism B — OPAQUE):

```json
{
  "mechanism": "opaque",
  "tier_requested": "t1",
  "opaque_evidence": "<base64 OPAQUE login evidence>"
}
```

Response on success (`200 OK`):

```json
{
  "tier_confirmed": "t1",
  "expires_at": "2026-05-20T09:16:00Z"
}
```

The server sets the Redis key as a side effect. The client does not
receive a token; subsequent privileged calls in the same session are
authorised by the server consulting Redis on each request.

Error responses:

| Status | Code | Meaning |
|---|---|---|
| `400` | `invalid_mechanism` | The body's `mechanism` is not `webauthn` or `opaque` |
| `400` | `invalid_tier` | The body's `tier_requested` is not `t1` or `t4` (t2/t3 have no grace window; t0 doesn't exist) |
| `401` | `webauthn_uv_required` | The assertion was accepted but UV did not happen — Mechanism A requires UV. Client should retry with Mechanism B. |
| `401` | `opaque_authentication_failed` | OPAQUE evidence was wrong |
| `429` | `rate_limit_exceeded` | See rate-limiting section |

### Privileged endpoint behaviour

Every Tier-1+ endpoint checks step-up state at request time:

1. Compute the required tier from the endpoint definition.
2. Look up `step_up:<session_id>:<tier>` in Redis.
3. If the key exists and the timestamp is within the grace window,
   proceed.
4. If the key does not exist (or has expired), return
   `403 step_up_required` with body:

   ```json
   {
     "error": "step_up_required",
     "tier_required": "t1",
     "mechanism_hints": ["webauthn", "opaque"]
   }
   ```

5. Tier 2 and Tier 3 endpoints **always** return `step_up_required`
   first if the immediately preceding step-up was more than a few
   seconds ago — effectively forcing a fresh prompt every time.
   Concrete: Tier 2/3 endpoints check a key with TTL=10s (just
   enough to cover the round-trip from step-up confirmation to the
   privileged call). Within 10 seconds, proceed; beyond 10 seconds,
   re-prompt. The 10-second window is **not** the same as Tier 1's
   2-minute grace — it's a "complete the operation immediately"
   tolerance.

### Rate limits

[DECIDED]

- `POST /v1/auth/step-up`: 10 attempts per session per 5 minutes,
  20 attempts per IP per 5 minutes. Sufficient against opportunistic
  brute-force of OPAQUE evidence on a hijacked session; insufficient
  to lock out legitimate user retry.

---

## UX Patterns

### Trigger timing

[DECIDED] **Lazy trigger.** The step-up modal appears when the user
confirms the destructive action, not when they open the form. This
matches Gmail / GitHub conventions.

Exception: **eager trigger for Tier 2** (when we have Tier 2 ops).
"Show me my recovery key" *is* the operation; there is no separate
form to fill in.

### Modal vs full-page

[DECIDED] **Modal always.** Phase 0 has no operations where a full-page
treatment is warranted.

### Modal copy

Three variants depending on what the user can do.

#### Both mechanisms available

```
Confirm this action

This action requires a fresh sign-in.

[ Use passkey ]
[ Use passphrase instead ]

[ Cancel ]
```

Tapping "Use passkey" triggers Mechanism A. If it fails with UV not
happening, the modal silently switches to the passphrase entry
without surfacing the error (the client interprets the error and
adapts; the user just sees the passphrase prompt).

#### Only OPAQUE available

(User has no passkeys configured, or has explicitly chosen to use
passphrase for this session.)

```
Confirm this action

This action requires you to re-enter your passphrase.

Passphrase:  [_______________]

[ Cancel ]  [ Confirm ]
```

#### Step-up cancellation

User dismisses the modal. No state change; routine session continues;
the privileged action does not happen.

### Failure copy

Precise but non-leaky:

- "Authentication required to continue." — generic, used when we
  don't want to differentiate.
- "Couldn't verify with passkey. Try your passphrase." — when
  Mechanism A failed and B is available.
- "Wrong passphrase. Try again." — when Mechanism B failed; no
  hint about retry count, no hint about whether the username also
  exists.

### Success behaviour

No celebration. The destructive action proceeds. A success toast for
the *operation* ("Account deleted." / "Passkey added.") covers it;
the step-up itself is invisible in success.

### Cross-reference to passive auth-state

The passive auth-state visibility pattern from
[`2026-05-20-pattern-passive-auth-state-on-profile`](../../insights/2026-05-20-pattern-passive-auth-state-on-profile.md)
is the **read-only complement** to this brief's active step-up modal.
Together they cover the full surface:

- Routine state (read-only, advanced-user-relevant) → passive on
  profile.
- Privileged actions (mutating, irreversible, secret-disclosing) →
  active modal with step-up.

The two patterns must agree on terminology — both call the underlying
event "step-up" or "fresh verification", never "biometric unlock" or
similar method-specific language. The user-client surfaces method-
agnostic copy.

---

## Implementation Notes for Liz

### Auth-service additions (Larissa-audit territory)

- New endpoint `POST /v1/auth/step-up` per the API Surface section.
- Step-up-required middleware (or per-route check) on every Tier 1+
  endpoint. Implementation choice: I lean towards a small explicit
  decorator/middleware that the route handler opts into (`stepUp(t1)`,
  `stepUp(t3)`), rather than a global table mapping URLs to tiers.
  The decorator approach keeps the tier requirement next to the
  handler in code review.
- Redis keys per the Server-side State section. Reuse the existing
  Redis client; new keyspace prefix `step_up:`.
- `POST /v1/auth/logout` extended to `DEL` step-up keys for the
  session.
- Rate limits per the Rate limits subsection.
- OPAQUE re-prompt support: a fresh OPAQUE round on an existing
  session, distinct from the initial-login OPAQUE flow. The OPAQUE
  library exposes this naturally; the wiring is straightforward.

### User-client additions

- Generic `<StepUpModal />` component that handles both mechanisms,
  including the silent A→B fallback when UV is unavailable.
- Centralised request interceptor that catches `403 step_up_required`
  responses, surfaces the modal, and retries the original request
  on success. This is the key abstraction — every Tier 1+ call sites
  uses it transparently, no per-site step-up logic.
- Existing Tier 1+ call sites already in the codebase:
  - `apps/user-client/src/lib/webauthn.ts` — add-passkey flow
  - The auth-methods settings screen (remove-passkey, change-passphrase)
  - The forthcoming cross-device-identity flows (pairing-code
    generation, auto-handover trigger)

### Admin-client additions

- Same `<StepUpModal />` reused, configured for Tier 4 grace window.
- Tier-4 call sites: invitation creation, invitation revocation,
  user suspension actions.

### Shared types

`packages/shared-types` gains:

- `StepUpTier` enum: `t0` | `t1` | `t2` | `t3` | `t4`.
- `StepUpRequiredResponse` shape.
- `StepUpMechanism` enum: `webauthn` | `opaque`.

### Larissa pre-squash audit

Auth-service is in scope per [`CLAUDE.md`](../../../CLAUDE.md) §9 —
mandatory audit. Step-up is the single most security-critical
mechanism added in Phase 0 outside the original auth flow itself;
Larissa gets generous review time.

User-client side is frontend, but: the `<StepUpModal />` and request
interceptor change which inputs reach the crypto layer (Mechanism A
specifically affects WebAuthn assertion paths). Per
[`2026-05-20-pattern-frontend-changes-affecting-crypto-semantics`](../../insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md)
this is a frontend diff that touches the cryptographic-acceptance
surface; Liz should opt into a Larissa courtesy-pass.

### Manual verification matrix

Chris exercises the full step-up surface on the device matrix:

- Tier 1 add-passkey flow with passkey-mechanism (Mac, Windows)
- Tier 1 add-passkey flow with OPAQUE fallback (Linux + Bitwarden
  Desktop)
- Tier 3 account-delete flow with passkey then passphrase
- Tier 4 invitation-creation as admin
- Verify grace window: add two passkeys in 90 seconds → second
  one skips prompt; add two passkeys with 3-minute gap → both
  prompt
- Verify Tier 3 has no grace: delete-account modal appears even
  if a Tier 1 step-up just happened
- Verify logout invalidates grace: log out, log back in, perform
  a Tier 1 op → prompted (grace is gone)

---

## What this brief does **not** cover

- **Operator-side audit-log export** is parked at Tier 2 in the
  classification but the export functionality itself isn't built;
  when it is, the step-up integration is trivial because Tier 2 is
  already specified.
- **Multi-step transactions where step-up is needed mid-flow** (e.g.,
  "start a destructive operation, scroll through items, confirm" —
  if the scroll takes too long the step-up has expired). Phase 0
  has no such flows; Tier 2's 10-second-window addresses the case
  conservatively.
- **Out-of-band step-up channels** (e.g., a notification to another
  trusted device asking for approval). Out of scope; Phase 1+ if
  ever.

---

## Open items

| # | Item | Resolution path |
|---|---|---|
| 1 | API endpoint shape for `POST /v1/auth/step-up` — curl-verification | Chris exercises the proposed request/response with curl before Liz writes tests; per [`CLAUDE.md`](../../../CLAUDE.md) §13 |
| 2 | Exact grace-window values for Tier 1 (2 min) and Tier 4 (5 min) — confirm or tune | Chris's call after manual-verification; tunable post-v0.1.0 |
| 3 | Cross-device-identity brief's inline minimums should be superseded by reference to this brief in a future amendment | Soft sequencing; not blocking implementation |

---

## References

- [ADR 0021](../../decisions/0021-phase0-opaque-first-linking.md) — every account has an OPAQUE method (Mechanism B fallback is always available).
- [ADR 0022](../../decisions/0022-uv-policy-for-webauthn-passkeys.md) — UV='preferred' default that this brief overrides for Tier 1+ operations.
- [ADR 0024](../../decisions/0024-single-server-per-account.md) — auto-handover is a Tier 3 operation.
- [ADR 0027](../../decisions/0027-step-up-authentication-policy.md) — codifies the tier system and grace-window choices from this brief.
- [`obsidian/briefs/phase 0/cross-device-identity.md`](cross-device-identity.md) — sibling brief whose endpoints inherit tiers from this brief.
- [`obsidian/briefs/phase 0/passkey-uv-policy.md`](passkey-uv-policy.md) — the routine-session UV policy on which step-up layers.
- [`obsidian/insights/2026-05-20-brief-material-step-up-auth.md`](../../insights/2026-05-20-brief-material-step-up-auth.md) — originating discussion notes.
- [`obsidian/insights/2026-05-20-pattern-passive-auth-state-on-profile.md`](../../insights/2026-05-20-pattern-passive-auth-state-on-profile.md) — read-only complement to the active step-up modal.
- [`obsidian/insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md`](../../insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md) — Larissa-pass guidance for the user-client diff.
- [`CLAUDE.md`](../../../CLAUDE.md) §3 (Hard Rules), §9 (Larissa gate), §11 (UX principles), §13 (API-shape pre-verification).
