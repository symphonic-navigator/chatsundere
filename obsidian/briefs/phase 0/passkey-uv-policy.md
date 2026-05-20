# Chatsundere — Passkey UV-Policy Briefing

**For:** Liz (implementation)
**From:** Lyra (architecture) + Chris (vision)
**Service:** `apps/user-client` (primary), `apps/auth-service` (verification side, no semantic change)
**Related ADRs:** ADR 0005 (PRF required), ADR 0022 (this brief's decision)
**Date:** 2026-05-20

---

## Purpose

Chatsundere passkeys carry two independent properties:

- **PRF** — the WebAuthn PRF extension produces deterministic key material
  inside the authenticator. We use that material to wrap and unwrap the
  user's master key. PRF is the *cryptographic floor* and is mandatory
  (see [ADR 0005](../../decisions/0005-require-prf-for-passkey-mk-wrapping.md)).
- **UV (User Verification)** — has the authenticator actively verified
  the user on this ceremony via biometric, PIN, or master-password
  re-prompt? UV sets the *per-operation auth strength* on top of PRF.

The two are orthogonal: PRF gives us secure key derivation regardless of
whether UV happened on a given ceremony, and UV gives us a fresh
human-presence proof regardless of whether PRF is wired up. Squash D
landed with `userVerification: 'required'` for every ceremony in
`apps/user-client`, which over-constrains the second axis: it refuses
several authenticator categories that Chris explicitly wants to support.

This brief formalises a relaxation of the UV requirement to `'preferred'`
while leaving the PRF requirement from ADR 0005 untouched. ADR 0022
records the decision in its own right.

---

## Context

### What `userVerification: 'required'` currently excludes

Concrete excluded categories observed during Phase 0 manual testing:

- **Bitwarden Desktop** with an already-unlocked vault. Bitwarden cannot
  reliably re-prompt the master password on a per-passkey-use basis, so
  UV='required' refuses the credential outright.
- **Hardware tokens in no-PIN configuration** (most YubiKeys shipped
  without PIN setup). Touch alone counts as User Presence (UP), not UV.
- **Any provider** where UV is not reliably available on this ceremony
  but PRF still derives correctly.

### What Chris wants as a user

Parity with the Gmail / Amazon / GitHub passkey model: passkey lives in
a vault or on a hardware token, one tap on a new machine, drin. The
*vault* (or the *hardware token*) is the security boundary for "is this
really the user"; Chatsundere does not double-gate it.

### Industry precedent

All major passkey-supporting consumer services (Gmail, Amazon, GitHub,
Microsoft consumer accounts, Apple ID) ship UV='preferred' or an
equivalent default. The pattern is settled.

---

## Decisions

### [DECIDED] Blanket UV='preferred' across every WebAuthn ceremony

Every ceremony in `apps/user-client/**` uses
`userVerification: 'preferred'`. There is no per-passkey override and no
operator-configurable knob. Sites currently known to need the change:

- `apps/user-client/src/lib/webauthn.ts` — registration of a
  PRF-capable passkey.
- `apps/user-client/src/routes/login/index.tsx` — local passkey unlock.
- `apps/user-client/src/routes/linking/confirm.tsx` — server-bound
  passkey registration during linking (if PRF round-trip lives here
  too; Liz to verify when implementing).

Per-passkey policy is rejected explicitly: it violates the Omakase
principle ([`CLAUDE.md`](../../../CLAUDE.md) §11), the user-explanation
cost is high, and authenticators that intrinsically enforce UV (Face ID
device, Yubikey-with-PIN configured at provisioning, etc.) will continue
to require it regardless of our policy. The authenticator wins, which
is the correct outcome.

### [DECIDED] PRF requirement is unchanged

[ADR 0005](../../decisions/0005-require-prf-for-passkey-mk-wrapping.md)
stands. Registration of a PRF-less passkey is still refused at the
crypto layer (`packages/crypto`) with the same user-facing message. The
relaxation in this brief is strictly on the UV axis.

This orthogonality is the most important sentence in the brief: **PRF is
the crypto floor and stays mandatory; UV is per-operation strength and
moves to `'preferred'`.** Anyone reviewing this change for security
should hold those two axes apart.

### [DECIDED] Generic user-facing copy, no vault enumeration

Button labels read "Sign in with passkey" or "Unlock with passkey". They
do not enumerate vault or token brands ("Sign in with Bitwarden /
Touch ID / Windows Hello / …"). Enumerated lists in button copy age
badly, balloon as new authenticators are added, and confuse users whose
local authenticator is not on the list. A future "What's a passkey?"
help link (Phase 1+ UX work) is the right home for the explanatory list.

### [DECIDED] `showBiometric` UI gate is renamed and rewidened

In `apps/user-client/src/routes/login/index.tsx:73` the current gate
is `showBiometric = passkeys.length > 0 && uvpaaAvailable`.
`isUserVerifyingPlatformAuthenticatorAvailable()` (UVPAA) is specifically
"this device has Touch ID / Face ID / Windows Hello"; under UV='preferred'
we additionally accept cross-platform passkeys (Bitwarden Desktop, hardware
tokens), where UVPAA reports `false`.

The replacement gate is `passkeys.length > 0 && webAuthnAvailable`, where
`webAuthnAvailable` is the helper already in use at
`apps/user-client/src/routes/settings/auth-methods.tsx` (`isWebAuthnAvailable()`).
The variable name should follow the new semantics — `showPasskeyUnlock`
or `passkeyUnlockAvailable`, not `showBiometric`. Button copy follows:
"Sign in with passkey" rather than "Unlock with biometric" when UV is
not guaranteed to be biometric.

### [DEFERRED] Conditional UI (`mediation: 'conditional'`)

Browser-autocomplete-style passkey suggestion in the username field
(Gmail-style). Standard pattern on modern auth flows, but explicitly
**not in scope for Phase 0**.

Why:

- Squash D's explicit-button login flow is now QA-verified end-to-end
  on the device matrix Chris cares about. Adding Conditional UI requires
  re-QA, in particular on iOS Safari (Conditional UI shipped only in
  17.4, March 2024).
- Implementation cost is ~30–50 lines of UI logic plus a careful
  `AbortController` lifecycle to avoid hung credential requests when
  the user changes their mind mid-flow.
- It is UX polish, not architecture or security. Right bucket: future
  UX-polish squash (possibly alongside the theming pivot) or Phase 1+
  enhancement.

The deferral is **not** an architectural concern; it is a phase-cut
decision. Conditional UI degrades cleanly when unsupported (no error,
just no suggestion), so adding it later is purely additive.

---

## Authenticator Compatibility Matrix

Reference list of authenticator categories and the expected UV behaviour
under this policy. PRF must work in all rows — that part is enforced
elsewhere and not optional.

| Authenticator                                  | UV happens? | PRF works? | Accepted? |
|------------------------------------------------|-------------|------------|-----------|
| Touch ID / Face ID / Windows Hello             | Yes (biometric)       | Yes | Yes |
| Yubikey 5.7+ with PIN configured               | Yes (PIN prompt)      | Yes | Yes |
| Yubikey 5.7+ without PIN (UP only)             | No (touch is UP only) | Yes | Yes |
| Bitwarden Desktop, vault already unlocked      | No                    | Yes | Yes |
| Bitwarden Desktop, vault locked                | Yes (master password) | Yes | Yes |
| 1Password Desktop, vault already unlocked      | No                    | Yes | Yes |
| Any browser-native passkey (Chrome profile)    | Varies (per platform) | Yes | Yes |
| Older authenticator without PRF support        | n/a                   | No  | **No** (ADR 0005) |

The bottom row is the only refusal; everything above it is accepted.
"UV happens" is informational — it tells the user-client what the actual
ceremony delivered, but it does not gate acceptance.

---

## Threat-Model Framing

The vault-as-security-boundary trade-off is explicit and reasoned, not
incidental.

**What we give up.** For a passkey stored in an unlocked vault, the
per-operation auth strength on a Chatsundere unlock equals the strength
of the user's vault lock, not a fresh biometric. An attacker with brief
physical access to an unlocked-and-unattended machine that has Bitwarden
unlocked could in principle initiate a passkey unlock without a fresh
challenge.

**What we keep.**
- The PRF cryptographic floor is intact. The wrapped master key cannot
  be derived without the authenticator producing the PRF output, which
  requires the credential to be present on the device performing the
  ceremony. A remote attacker without the credential cannot unwrap MK.
- The recovery path remains OPAQUE-gated and is not affected by this
  policy (see [ADR 0021](../../decisions/0021-phase0-opaque-first-linking.md)).
- The user retains the option of using a UV-enforcing authenticator if
  they want strict per-operation UV; that choice lives with them and
  their authenticator, not with our policy.

**Why the trade-off is correct.**
- Gmail, Amazon, GitHub, Microsoft and Apple all operate at this level
  with substantially larger account-value asymmetry than Chatsundere
  faces in Phase 0. The pattern is industry-default for a reason.
- Vault security is the layer the user already maintains — vault master
  password, auto-lock timeout, biometric unlock on the vault itself.
  Chatsundere does not need to duplicate that layer; it composes on it.
- The alternative (UV='required') excludes a substantial fraction of
  the authenticator population, which would push users either onto
  the OPAQUE passphrase (slower UX) or away from Chatsundere entirely
  (worse outcome). Both are net negatives.

---

## Implementation Notes for Liz

Small squash, frontend-only, no server-side semantic change. Pseudo-diff
across the user-client:

1. `apps/user-client/src/lib/webauthn.ts` — change
   `authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }`
   to
   `authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' }`.
2. `apps/user-client/src/routes/login/index.tsx` — change
   `userVerification: 'required'` to `userVerification: 'preferred'` at
   the call site (currently line ~145; verify on touch).
3. `apps/user-client/src/routes/login/index.tsx:73` — rewrite the gate
   per the "showBiometric is renamed and rewidened" decision above.
   Variable rename included.
4. `apps/user-client/src/routes/linking/confirm.tsx` — audit for the
   same `userVerification` string; align if present. If PRF eval is
   here, ensure UV is not separately pinned to 'required'.
5. Search the whole `apps/user-client/src/**` tree for any other
   `userVerification:` occurrences and migrate them. Should be zero
   beyond the three named files, but verify.
6. Button copy update: any string "Unlock with biometric",
   "Sign in with biometric", or equivalent — replace with "Sign in
   with passkey" / "Unlock with passkey". Search for stale copy in
   `apps/user-client/src/routes/login/**` and `apps/user-client/src/i18n/**`.
7. Tests: existing user-client tests that hard-code
   `userVerification: 'required'` in their fixtures need updating to
   the new policy. Run the full Vitest suite after the changes.

### Server-side check

`apps/auth-service` already accepts WebAuthn assertions whether or not
UV is set; `@simplewebauthn/server` reports the UV flag in the verified
result but does not gate on it by default. Verify no defensive
`if (!verification.userVerified) reject(...)` exists in
`apps/auth-service/src/routes/**`. If it does, remove it and add a brief
code comment referencing ADR 0022. Otherwise leave the service alone.

### Larissa pre-squash audit

Frontend-only diff. Per [CLAUDE.md §9](../../../CLAUDE.md), the audit
decision is Liz's judgement call.

### Manual verification matrix

Chris re-runs the device matrix from the Phase 0 manual-verification
checklist:

- Touch ID Mac (UV expected): unlock succeeds.
- Windows Hello PC (UV expected): unlock succeeds.
- Bitwarden Desktop with unlocked vault on Linux (no UV expected): unlock
  succeeds, was previously refused.
- Yubikey 5C NFC without PIN (UP only): unlock succeeds, was previously
  refused.
- Yubikey 5C NFC with PIN configured (UV via PIN): unlock succeeds.
- A PRF-less authenticator (if Chris has one to hand, otherwise simulate):
  registration is **still refused**. This is the ADR 0005 guarantee and
  must not regress.

Estimated total Liz effort: 1–2 hours including manual verification.

---

## What this brief does **not** change

To pre-empt confusion in review:

- The PRF requirement (ADR 0005) is untouched.
- The OPAQUE-first linking rule (ADR 0021) is untouched.
- The recovery-key flow (ADR 0007) is untouched.
- The "exactly one primary admin" rule (ADR 0006) is untouched.
- Server-side `auth_methods` schema is untouched.
- The user-client login UI structure is untouched beyond the gate
  rename and copy update.

---

## Open items for Lyra to address in a future revision

| Item | Notes |
|---|---|
| Conditional UI rollout brief | Standalone brief when the Phase 1 UX-polish squash is on the table. Will need its own re-QA plan for iOS Safari. |
| "What's a passkey?" help-link content | UX writing exercise, lives outside this brief. Track in `obsidian/insights/` until it has a home. |
| Per-operation UV signalling in UI | If we later decide to *show* the user when UV happened vs not (small lock-icon variant, "unlocked via biometric" subtle label), that is a separate UX brief. Not blocking. |

---

## References

- [ADR 0005](../../decisions/0005-require-prf-for-passkey-mk-wrapping.md) — PRF requirement (orthogonal to this brief, unchanged).
- [ADR 0022](../../decisions/0022-uv-policy-for-webauthn-passkeys.md) — the decision this brief feeds into.
- [`obsidian/briefs/phase 0/auth-service.md`](auth-service.md) — auth-service surface, no schema change required.
- [`obsidian/briefs/phase 0/crypto.md`](crypto.md) — PRF Handling Details.
- [`obsidian/insights/2026-05-19-brief-material-passkey-uv.md`](../../insights/2026-05-19-brief-material-passkey-uv.md) — discussion notes from which this brief was distilled.
- [`CLAUDE.md`](../../../CLAUDE.md) §3 (Hard Rules, PRF + passkey-first), §9 (Larissa gate), §11 (Omakase principle).
