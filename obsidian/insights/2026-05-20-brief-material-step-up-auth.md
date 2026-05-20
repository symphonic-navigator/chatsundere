# Brief Material — Step-up Authentication for Sensitive Operations

**For:** Lyra (to formalise into `obsidian/briefs/phase 0/step-up-auth.md` or a phase-1 brief — Chris's call on priority)
**From:** Chris + Lyra (UV-policy review discussion, 2026-05-20)
**Originating discussion:** [`2026-05-19-brief-material-passkey-uv.md`](2026-05-19-brief-material-passkey-uv.md), follow-up risk review on 2026-05-20
**Status:** Planning — should formalise before v0.1.0
**Priority:** High. This is the most important gap remaining after the
UV-policy relaxation lands ([ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md)).

---

## The gap

[ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md) sets
`userVerification: 'preferred'` for every WebAuthn ceremony in
`apps/user-client`. That is the correct posture for **routine** unlock —
opening the app, resuming a chat, reading existing data. It is **too
loose** for operations that have higher consequences if executed without
fresh user intent.

The brief deliberately did not address this. The narrow scope was
"loosen the routine unlock gate without breaking the crypto floor", and
that is what it does. But the absence of a step-up layer means that an
attacker who reaches the user-client with a session already established
(or with the credential-manager vault already unlocked on an unattended
machine) can in principle execute any operation the user can — including
operations that mutate auth state, leak secrets, or destroy data.

This is not a flaw in ADR 0022. It is a feature that ADR 0022 does not
provide and never claimed to provide. The brief on which it is based
explicitly notes "future UX brief" for related work; this insight names
that work and gives it a scope.

## Operations that should require step-up

Categorised by what they mutate or expose, not by where they live in
the UI.

### Tier 1 — Mutation of auth state

These change *what counts as the user*. Lose this gate, lose the
account.

- Add a new passkey (`POST /v1/link/passkey/{start,finish}` with bearer
  per [ADR 0021](../decisions/0021-phase0-opaque-first-linking.md))
- Remove an existing passkey
- Change the OPAQUE passphrase (= OPAQUE re-registration, see
  ADR 0021 Phase 0 constraints)
- Generate a new pairing code for an additional device (see
  [cross-device-identity brief material](2026-05-19-brief-material-cross-device-identity.md) Q3)
- Use a pairing/invitation code on a new device (= `POST /api/join`)
- Username rename (Phase 1+, see Q7 in cross-device-identity material —
  also rooted in OPAQUE-KDF, semantically equivalent to passphrase change)

### Tier 2 — Re-disclosure of secrets

These reveal material that was meant to be shown only once or under
explicit consent.

- Re-reveal of the recovery key (if we offer this — current ADR 0007
  says one-shot at registration; if we soften that for usability, the
  re-reveal needs step-up)
- Export of master-key-wrapped vault content (if we offer cleartext
  export at all — open design question)
- Export of unencrypted account audit log (operator-side)

### Tier 3 — Destructive operations

These cannot be undone, or can only be undone by re-onboarding.

- Account deletion (full server-side wipe + local data deletion)
- Disconnect from server (the "leave Bob's server" flow in
  cross-device-identity Q5 — semantically a half-delete from the
  server's perspective)
- Pre-disconnect-sync-pull initiated as part of auto-handover (Q5
  variant α) — sensitive because it triggers a full data movement,
  not because of mutation per se

### Tier 4 — Operator-side admin operations

Different threat model (operator is trusted by definition), but step-up
is still appropriate so a hijacked admin session cannot silently mutate
the user population.

- Create / revoke invitation tokens
- Suspend / unsuspend a user
- View user list (this one is borderline — read-only, but operator-level
  knowledge)
- Any change to operator role assignments

## Mechanism options

Three building blocks, each with its own trade-offs. The brief should
choose which combination per tier, not try to be all-encompassing.

### Option A — Fresh WebAuthn ceremony with UV='required'

For step-up specifically, override the default UV='preferred' policy
back to UV='required'. The user is asked to re-tap their authenticator;
if their authenticator cannot do UV (Bitwarden Desktop with unlocked
vault, no-PIN Yubikey), the request is rejected and the user falls
back to Option B.

Pro: cryptographically anchored, consistent with the WebAuthn model.
Con: harsh failure mode for users on UV-incapable authenticators —
they cannot complete the step-up at all without switching to OPAQUE
passphrase entry.

### Option B — OPAQUE re-prompt

Pop a modal asking for the OPAQUE passphrase. Server re-runs OPAQUE
authentication and issues a fresh "step-up confirmed" token with a
short lifetime (suggested: 5 minutes).

Pro: works universally, including for users without UV-capable
authenticators.
Con: passphrase fatigue; users with long passphrases will dislike
frequent prompts.

### Option C — Recent-auth grace window

If a UV-confirmed ceremony happened within the last N minutes
(suggested: 5 minutes), treat the user as already stepped-up without
prompting again. Falls through to A or B if expired.

Pro: best UX for sequences of sensitive ops (e.g., adding two passkeys
in a row).
Con: requires server-side tracking of "last UV-confirmed at" per session;
small attack surface (a session-hijacker within the grace window can
execute step-up ops).

### Recommended combination per tier (proposed)

Subject to Lyra's formalisation, but as a starting point:

| Tier | Default mechanism | Fallback | Grace window |
|---|---|---|---|
| 1 — auth mutation | A (UV='required') | B (OPAQUE) | C, 2 minutes |
| 2 — secret re-disclosure | A | B | None — always re-prompt |
| 3 — destructive | A | B | None — always re-prompt |
| 4 — admin | A | B | C, 5 minutes |

Tier 2 and Tier 3 deliberately reject grace windows. Re-disclosure of
secrets and irreversible destruction are exactly the operations where
"the user might have walked away from their desk" is the threat we are
defending against.

## UX patterns to settle in the brief

### When does step-up trigger?

Two options:

1. **Eager** — surface the step-up modal when the user opens the
   destructive flow (e.g., as soon as they tap "Delete account").
2. **Lazy** — let the user fill in the form and surface step-up at the
   confirm-button press.

Lazy is the standard pattern (Gmail, GitHub). Eager is friendlier for
flows where the form itself is sensitive (e.g., "Show me my recovery
key" — the form *is* the operation).

### Modal vs full-page transition?

Mainstream services use modal. Chatsundere should too unless a specific
flow needs the full-page treatment (currently none come to mind).

### Failure mode messaging

When step-up fails (cancelled, UV unavailable, OPAQUE wrong), the
message should be precise:

- "Authentication required to continue." — generic, when we don't want
  to leak why.
- "This action requires a fresh sign-in. Use your passkey or passphrase."
  — when fallback is offered.
- Never leak whether the OPAQUE attempt was wrong vs the passkey was
  refused — both fail the same way to the user.

### What does the user see after step-up succeeds?

Subtle confirmation, not a celebration. The destructive action proceeds.
A success toast ("Account deleted." / "Passkey added.") covers it.

## Cross-references that the brief must reconcile

- [ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md) — the
  default UV='preferred' policy. Step-up is the explicit override path.
- [ADR 0021](../decisions/0021-phase0-opaque-first-linking.md) — every
  account has an OPAQUE method, which guarantees Option B is always
  available as fallback.
- [ADR 0005](../decisions/0005-require-prf-for-passkey-mk-wrapping.md) —
  PRF requirement is orthogonal; step-up does not change it.
- [`cross-device-identity brief material`](2026-05-19-brief-material-cross-device-identity.md) —
  device pairing / linking / auto-handover are Tier 1 / Tier 3 operations.
  The cross-device brief and this step-up brief must agree on the
  triggering points.

## Server-side implications

This is **not** a frontend-only piece of work. The server needs:

- A "step-up confirmed at" timestamp per session (or per refresh token).
- New endpoints or middleware to gate Tier 1–4 operations on a fresh
  step-up token.
- OPAQUE re-prompt support that does not invalidate the existing session
  (a re-auth flow that is distinct from the initial login).
- Rate-limiting on step-up attempts to prevent OPAQUE brute-force.

That is server work, which means Larissa pre-squash audit applies by
default per [CLAUDE.md §9](../../CLAUDE.md).

## Priority and timing

Recommendation: this is a **must-have before v0.1.0**, not a phase-1
deferral. Without step-up:

- Phase-0 promise of "as trustworthy as Proton" is overstated. Proton
  step-ups for sensitive ops (e.g., reveal-recovery-phrase, add-trusted-
  device) — we should too.
- The cross-device-identity brief's pairing/linking flow has no
  meaningful gate against a hijacked session opening a new pairing code
  for an attacker's device. That is a real attack and undermines the
  whole identity model.

If pre-v0.1.0 capacity is tight, Tier 1 and Tier 3 are non-negotiable.
Tier 2 (we don't currently re-disclose secrets) and Tier 4 (operator
side) can slip to v0.2.0 with explicit risk acceptance.

## Open items for Lyra to resolve in the brief

| Item | Notes |
|---|---|
| Exact endpoint shape for step-up confirmation | New `POST /v1/auth/step-up/{start,finish}` mirroring `/v1/link/*`? Or middleware on existing endpoints? Architectural choice. |
| Recent-auth grace window length per tier | Suggested 2 / 0 / 0 / 5 minutes; needs Chris's call. |
| Server-side state location | Session record? Refresh-token record? Redis key? Trade-off between durability and revocation ergonomics. |
| Step-up failure UX wording | Final copy in the manual-verification matrix. |
| Interaction with cross-device pairing-code-creation flow | Specifically: does generating a pairing code count as Tier 1? I think yes; the brief should confirm. |
| Operator-side flows (Tier 4) | Admin-client work; do we tackle in the same brief or as a sibling brief? |

## Action triggers

| Item | Trigger | Owner |
|---|---|---|
| Lyra produces formal `step-up-auth.md` brief | Chris's call on timing; recommend immediately after cross-device-identity brief lands | Chris + Lyra |
| ADR 0023 (step-up policy) drafted alongside | With the brief | Chris + Lyra |
| Implementation (Liz + Larissa) | After brief + ADR land | Liz + Larissa |
| Manual-verification matrix update | Liz, post-implementation | Liz |

## References

- [ADR 0005](../decisions/0005-require-prf-for-passkey-mk-wrapping.md) — PRF crypto floor.
- [ADR 0021](../decisions/0021-phase0-opaque-first-linking.md) — OPAQUE-first guarantees Option B fallback.
- [ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md) — UV='preferred' default this brief overrides.
- [`obsidian/briefs/phase 0/passkey-uv-policy.md`](../briefs/phase%200/passkey-uv-policy.md) — origin brief for the UV-policy decision.
- [`2026-05-19-brief-material-cross-device-identity.md`](2026-05-19-brief-material-cross-device-identity.md) — interacts heavily with Tier 1 / Tier 3 here.
- [`2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md`](2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md) — sibling observation from the same review.
