# ADR 0027: Step-up authentication policy — tiers, mechanisms, and grace windows

**Date:** 2026-05-20
**Status:** Proposed
**Related:** ADR 0021 (OPAQUE-first), ADR 0022 (UV-policy default), ADR 0024 (single-server-per-account), `obsidian/briefs/phase 0/step-up-auth.md`

## Context

[ADR 0022](0022-uv-policy-for-webauthn-passkeys.md) made
`userVerification: 'preferred'` the Chatsundere default for routine
unlock. That decision was the right call for routine UX, but the
acceptance of vault-stored passkeys without per-operation UV opens a
real threat: an unattended unlocked client (or a hijacked session, or
a user-mistake moment) can in principle execute any operation the
user can — including operations that mutate auth state, re-disclose
secrets, or destroy data.

Step-up authentication is the mechanism that re-establishes a
per-operation verification boundary specifically where it matters,
without imposing it on routine use. The cross-device-identity brief
carries inline minimal step-up requirements on three endpoints
(`POST /api/me/pairing-codes`, auto-handover trigger,
`POST /api/admin/invitations`); this ADR codifies the underlying
policy so future endpoints inherit the right behaviour by default.

## Decision

Chatsundere implements **tier-based step-up authentication** with the
following structure:

### Tiers

| Tier | Surface | Examples |
|---|---|---|
| 0 | Routine session sufficient | Read own data, send messages, edit personas, revoke own pairing codes |
| 1 | Auth-state mutation | Add/remove passkey, change passphrase, generate pairing code, redeem pairing code (OPAQUE-evidence-as-step-up) |
| 2 | Re-disclosure of secrets | Reserved; empty in Phase 0 |
| 3 | Destructive | Delete account, disconnect from server, auto-handover trigger |
| 4 | Operator-side privileged | Create/revoke invitations, suspend users, role changes |

### Mechanisms

Three primitives, combined per tier:

- **A — Fresh WebAuthn ceremony with `userVerification: 'required'`.**
  Re-tap with UV. Transparent fall-through to Mechanism B if the
  authenticator cannot do UV.
- **B — OPAQUE re-prompt.** Fresh OPAQUE round on existing session.
  Universal fallback; available on every account by virtue of
  [ADR 0021](0021-phase0-opaque-first-linking.md).
- **C — Recent-auth grace window.** A recent A or B success caches
  the confirmation in Redis for the tier's grace window.

### Per-tier mapping

| Tier | Primary | Fallback | Grace window |
|---|---|---|---|
| 0 | n/a | n/a | n/a |
| 1 | A | B | 2 minutes |
| 2 | A | B | none — always re-prompt |
| 3 | A | B | none — always re-prompt |
| 4 | A | B | 5 minutes |

### Server-side state

Step-up confirmations live in **Redis**, keyed
`step_up:<session_id>:<tier>` with TTL equal to the tier's grace
window. Logout `DEL`s all step-up keys for the session.

### Endpoint

`POST /v1/auth/step-up` accepts either a WebAuthn assertion
(Mechanism A) or OPAQUE evidence (Mechanism B), validates the
mechanism, sets the Redis key, and returns the confirmed tier with
expiry timestamp. Privileged endpoints check the Redis key on each
request and return `403 step_up_required` when absent.

## Consequences

Positive:

- **Restores per-operation verification where it matters** without
  imposing it on routine use. The vault-as-security-boundary
  trade-off from ADR 0022 stays acceptable because step-up plugs
  the specific gap for sensitive operations.
- **Universal coverage.** Every account has OPAQUE per ADR 0021,
  so Mechanism B is always available; no user can be locked out of
  a Tier 1+ operation by their authenticator configuration.
- **Auditable.** Every step-up confirmation is a discrete event;
  every privileged operation either has a recent confirmation in
  Redis or is refused. The audit trail is clear.
- **Composes cleanly with existing infrastructure.** Redis is
  already online for refresh-token revocation; step-up reuses the
  same primitive.
- **Future-extensible.** Adding a new privileged operation is a
  one-line decision (which tier does it belong to?); the rest is
  inherited from the policy.

Negative / accepted trade-offs:

- **Friction for high-frequency power users** performing many Tier
  1+ operations in sequence. The 2-minute grace window mitigates
  this for related Tier 1 ops; sequences across tiers do re-prompt.
  Acceptable: these operations are by definition rare.
- **Redis becomes part of the privileged-operation hot path.**
  Every Tier 1+ endpoint adds one Redis `GET`. The latency cost is
  sub-millisecond and the operation count is low; impact is
  negligible.
- **Operator-side Tier 4 burst-work assumption.** The 5-minute
  grace window assumes operators perform related admin work in
  bursts. If real usage patterns deviate (e.g., operators do one
  thing at a time spaced minutes apart), the grace window becomes
  pure friction. Revisitable post-v0.1.0 with usage data.

## Alternatives considered

1. **Stateless step-up tokens (signed JWT carrying timestamp).**
   Rejected: revocation requires either no caching at all (defeats
   Mechanism C's benefit) or a Redis blocklist (which is the
   stateful approach we already chose, with extra parsing). The
   stateless complexity buys nothing.
2. **Per-user configurable step-up (a "high-security mode" toggle).**
   Rejected: violates [`CLAUDE.md`](../../CLAUDE.md) §11 (Omakase).
   The Tier 1+ defaults are the right defaults for everyone;
   user-configurable settings here would mostly produce
   misconfigured accounts.
3. **No tiers, single threshold ("always require fresh UV for any
   mutation").** Rejected: too strict for routine ops, would push
   users to fewer features rather than more security. The tier
   system is the calibration mechanism.
4. **Out-of-band step-up via a trusted device (Phase 1+ candidate).**
   Considered but deferred. Adds notification infrastructure (push,
   WebSocket, or similar) that Phase 0 doesn't have. Will land in
   its own ADR if Phase 1+ wants it.

## Migration impact

This ADR retroactively defines the tier on operations that the
cross-device-identity brief already specified inline:

| Operation | Brief inline minimum | This ADR's formal tier |
|---|---|---|
| `POST /api/me/pairing-codes` | "fresh UV-confirmed ceremony or OPAQUE re-prompt within 2 min" | Tier 1 — confirms minimum, makes formal |
| `POST /api/join` with `type=pairing` | "OPAQUE evidence in request" | Tier 1 — the OPAQUE evidence IS the step-up for this case |
| Auto-handover trigger | "modal + fresh OPAQUE re-prompt" | Tier 3 — formalises minimum |
| `DELETE /api/me/pairing-codes/{id}` | "none" | Tier 0 — confirmed |
| `POST /api/admin/invitations` | "fresh UV-confirmed ceremony within 5 min, OPAQUE fallback" | Tier 4 — confirms minimum, makes formal |

No semantic divergence between the inline minimums and this ADR's
formal tiers. The cross-device-identity brief stays
standalone-implementable; this ADR makes the rules referenceable
from any future brief.

## References

- [ADR 0021](0021-phase0-opaque-first-linking.md) — guarantees OPAQUE-based Mechanism B is always available.
- [ADR 0022](0022-uv-policy-for-webauthn-passkeys.md) — routine-session UV='preferred' that this ADR's Mechanism A overrides.
- [ADR 0024](0024-single-server-per-account.md) — auto-handover is Tier 3.
- [`obsidian/briefs/phase 0/step-up-auth.md`](../briefs/phase%200/step-up-auth.md) — full brief with API surface, UX patterns, Liz implementation notes.
- [`obsidian/briefs/phase 0/cross-device-identity.md`](../briefs/phase%200/cross-device-identity.md) — sibling brief whose inline minimums this ADR formalises.
- [`obsidian/insights/2026-05-20-brief-material-step-up-auth.md`](../insights/2026-05-20-brief-material-step-up-auth.md) — originating discussion.
