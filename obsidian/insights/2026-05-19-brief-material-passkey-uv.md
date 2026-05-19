# Brief Material — Passkey UV-Policy

**For:** Lyra (to formalise into `obsidian/briefs/phase 0/passkey-uv-policy.md` and into ADR 0022)
**From:** Chris + Liz (open-design-questions walk-through, 2026-05-19)
**Originating discussion:** [[2026-05-19-open-design-questions]] §2
**Status:** Decisions made. Awaiting Lyra brief + ADR draft.

---

## Context

ADR 0005 makes the PRF extension required for Chatsundere passkeys (the
PRF output is what unwraps the wrapped MK). PRF is *orthogonal* to
WebAuthn's User Verification (UV) concept:

- **PRF** — cryptographic material derived inside the authenticator,
  used to wrap/unwrap the MK. Sets the *cryptographic* security floor.
- **UV** — has the authenticator actively verified the user via
  biometric, PIN, or master-password re-prompt? Sets the *per-operation
  auth strength*.

Squash D landed with `userVerification: 'required'` everywhere
(`apps/user-client/src/lib/webauthn.ts:65-67` and
`apps/user-client/src/routes/login/index.tsx:145`). That excludes:

- **Bitwarden Desktop** when the vault is already unlocked — Bitwarden
  cannot reliably re-prompt master-password on a per-passkey-use basis,
  so UV='required' refuses the credential.
- **Hardware tokens** in their no-PIN configuration (most YubiKeys
  shipped without PIN setup).
- **Any provider** where UV is not reliably available but PRF is.

The goal is parity with the Gmail / Amazon model that Chris explicitly
prefers as a user: passkey lives in a vault (or hardware), one tap on
a new machine, drin.

---

## Decisions

### [DECIDED] Blanket UV='preferred' for all WebAuthn ceremonies

- Set `userVerification: 'preferred'` (not 'required') in *every*
  WebAuthn ceremony in `apps/user-client/**`. Sites:
  - `apps/user-client/src/lib/webauthn.ts` — register-local-biometric
  - `apps/user-client/src/routes/login/index.tsx` — local biometric
    unlock
  - `apps/user-client/src/routes/linking/confirm.tsx` — server-bound
    passkey registration (if PRF round-trip happens here too)
- *Not* per-passkey policy. Rationale: violates CLAUDE.md §11 ("Omakase
  over options"); user explanation cost is high; if high-security users
  want strict UV they can use an authenticator that intrinsically
  requires it (Yubikey-with-PIN, Face-ID device, etc.) — the
  authenticator's intrinsic behaviour wins regardless of our policy.

### [DECIDED] Generic user-facing copy

- Buttons read "Sign in with passkey" / "Unlock with passkey" rather
  than enumerating specific vault or token brands.
- A future "What's a passkey?" help link (Phase 1+ UX) is the right
  place for the explanatory list (Touch-ID, Face-ID, Windows Hello,
  vaults, hardware tokens). Do *not* sprinkle this list across
  button tooltips.

### [DECIDED] New ADR — 0022 — separate from ADR 0005

- ADR 0005 stays focused on PRF requirement.
- ADR 0022 is a fresh ADR documenting UV='preferred' as the policy.
- ADR 0022 explicitly cross-references 0005 with language like
  "this ADR adds the UV-policy that complements the PRF requirement
  established in ADR 0005; the two are independent concerns."

### [DEFERRED] Conditional UI (`mediation: 'conditional'`)

- Browser-autocomplete-style passkey suggestion in the username field
  (Gmail-style). Standard pattern on modern auth flows.
- Implementation cost: ~30–50 lines of UI logic, plus careful
  `AbortController` lifecycle to avoid hung credential requests.
- Browser support: Chrome since 2022, Safari iOS only since 17.4
  (March 2024), Firefox in progress. Degrades cleanly on unsupported
  browsers (no error, just no suggestion).
- Why defer: Squash D's explicit-button login flow is now QA-verified
  end-to-end. Adding Conditional UI requires re-QA on iOS Safari
  specifically. It's UX-polish, not architecture or security. Right
  bucket: future UX-polish squash (possibly alongside the theming
  pivot) or Phase 1+ enhancement.
- Reference for the brief: *we want this, just not in Phase 0.*

---

## Implementation notes (for Liz, post-brief / post-ADR-0022)

When the brief and ADR land, the Liz-side work is small:

1. In `apps/user-client/src/lib/webauthn.ts`, change
   `authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }`
   to
   `authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' }`.
2. In `apps/user-client/src/routes/login/index.tsx`, change
   `userVerification: 'required'` to `userVerification: 'preferred'`.
3. Check `apps/user-client/src/routes/linking/confirm.tsx` for the
   same string — currently uses PRF eval, may or may not pin UV.
4. In `apps/user-client/src/routes/login/index.tsx:73`,
   `showBiometric = passkeys.length > 0 && uvpaaAvailable` needs
   revisiting. `uvpaaAvailable` is *platform-authenticator-specific*
   (= "this device has Touch/Face/Hello"); with UV='preferred' we
   also accept cross-platform passkeys (Bitwarden, YubiKey) where
   UVPAA reports false. The new gate should be:
   `passkeys.length > 0 && webAuthnAvailable` (the same helper used
   in `apps/user-client/src/routes/settings/auth-methods.tsx` —
   `isWebAuthnAvailable()`). Button copy should adapt: "Sign in with
   passkey" rather than "Unlock with biometric" when UV is not
   guaranteed.
5. Larissa-audit pre-merge: the changes are user-client-only (per
   CLAUDE.md §9, frontend skips by default), but this touches the
   semantics of what we accept for unlocking the MK — worth a single
   Larissa pass anyway, framed as "we're loosening the UV gate on
   PRF-unlock; the PRF cryptographic floor stays unchanged".

---

## What the Lyra brief should formalise

When Lyra writes the formal brief for `obsidian/briefs/phase 0/`,
these four threads need clean expression:

1. **Threat-model framing**: why "vault-as-security-boundary" is
   acceptable. (Industry precedent: Gmail, Amazon, GitHub, all major
   passkey-supporting services use UV='preferred' or equivalent
   defaults.)
2. **PRF + UV orthogonality**: explicit statement that PRF requirement
   (ADR 0005) is unaffected; UV is a separate policy layer.
3. **Compatibility matrix**: list of supported authenticator categories
   and what each means for UV behaviour:
   - Touch-ID / Face-ID / Windows Hello — UV via biometric, always
     succeeds when device locked-and-unlocked-on-prompt
   - Bitwarden / 1Password Desktop with unlocked vault — UV may not
     happen; accepted because PRF still derives correctly
   - Hardware token with PIN configured — UV via PIN
   - Hardware token without PIN (UP-only) — accepted; PRF still works
4. **Conditional UI deferred** with explicit "not in Phase 0" note,
   pointer to a future enhancement (possibly its own brief).

---

## ADR 0022 draft skeleton

```
# 22. UV-policy for WebAuthn passkeys

Status: Proposed (2026-05-19)
Supersedes: none
Superseded by: none
Related: ADR 0005 (PRF required)

## Context

[Brief framing: PRF gives crypto floor; UV is per-operation; current
'required' excludes Bitwarden Desktop, hardware tokens, etc.]

## Decision

We set `userVerification: 'preferred'` in all WebAuthn ceremonies
across `apps/user-client`. PRF requirement from ADR 0005 is unchanged.

## Consequences

Positive:
- Parity with Gmail/Amazon UX
- Bitwarden / 1Password Desktop work cleanly
- Hardware tokens (Yubikey 5.7+ in any configuration) work
- Reduces user friction on cross-device unlock

Negative:
- Per-operation auth strength may degrade for vault-stored passkeys
  whose vault is currently unlocked

Mitigation:
- Vault security (master-password, vault-lock-timeout) is the
  security layer for that scenario — same as Gmail, Amazon, GitHub
- PRF cryptographic floor stays intact regardless of UV

## Alternatives considered

1. Keep 'required' — excludes major use cases (rejected).
2. Per-passkey policy — too configurable, violates Omakase principle
   (rejected; could be revisited if real-world use shows need).
```

---

## Next

Once Lyra produces the formal brief and ADR 0022, Liz does the
implementation listed above as a single small squash (Larissa-pass
on the diff, then merge). Estimated 1-2 hours of Liz work including
the manual-QA re-verification on multiple authenticator types.
