# ADR 0022: UV-policy for WebAuthn passkeys is `preferred`, not `required`

**Date:** 2026-05-20
**Status:** Accepted (implemented 2026-05-21)
**Related:** ADR 0005 (PRF required)

## Context

WebAuthn ceremonies carry two independent properties relevant to
Chatsundere:

- **PRF** — the Pseudo-Random Function extension produces deterministic
  key material inside the authenticator. We use that material to wrap
  and unwrap the user's master key. PRF is the cryptographic floor and
  is mandatory ([ADR 0005](0005-require-prf-for-passkey-mk-wrapping.md)).
- **UV (User Verification)** — has the authenticator actively verified
  the user on this ceremony via biometric, PIN, or master-password
  re-prompt? UV sets per-operation auth strength on top of PRF.

The two axes are orthogonal: PRF gives secure key derivation regardless
of whether UV happened on a given ceremony, and UV gives a fresh
human-presence proof regardless of whether PRF is wired up.

Squash D landed with `userVerification: 'required'` for every WebAuthn
ceremony in `apps/user-client`. That setting over-constrains the UV
axis and refuses several authenticator categories Chris explicitly
wants to support:

- Bitwarden Desktop and 1Password Desktop with an already-unlocked vault
  (vault cannot reliably re-prompt the master password on a
  per-passkey-use basis).
- Hardware tokens in no-PIN configuration (touch counts as User Presence,
  not User Verification).
- Any authenticator where UV is not reliably available on this ceremony
  even though PRF still derives correctly.

The intended user model is parity with Gmail / Amazon / GitHub / Microsoft
consumer / Apple ID: passkey in a vault or on a hardware token, one tap
on a new machine, drin. The *vault* (or the *hardware token*) is the
security boundary for "is this really the user"; Chatsundere does not
need to double-gate it.

## Decision

Set `userVerification: 'preferred'` in every WebAuthn ceremony across
`apps/user-client`. The PRF requirement from ADR 0005 is unchanged;
this ADR addresses only the UV axis.

The policy is blanket and not per-passkey. Per-passkey UV policy was
considered and rejected: it violates the Omakase principle, has high
user-explanation cost, and authenticators that intrinsically enforce UV
(Face ID device, Yubikey-with-PIN provisioned that way, etc.) will
continue to require UV regardless of the client-side setting — the
authenticator wins, which is the correct outcome.

## Consequences

Positive:

- UX parity with the major consumer passkey ecosystems (Gmail, Amazon,
  GitHub, Microsoft consumer, Apple ID).
- Bitwarden Desktop, 1Password Desktop, and similar credential-manager
  vaults work cleanly when their vault is unlocked.
- Hardware tokens (Yubikey 5.7+) work in any configuration, including
  no-PIN UP-only setups.
- Reduces cross-device unlock friction without altering the
  cryptographic security model.

Negative / accepted trade-offs:

- For a passkey stored in an unlocked vault, the per-operation auth
  strength on a Chatsundere unlock equals the strength of the user's
  vault lock, not a fresh biometric. An attacker with brief physical
  access to an unlocked-and-unattended machine that has the vault
  unlocked could in principle initiate a passkey unlock without a fresh
  challenge.

Mitigation:

- The PRF cryptographic floor is intact. The wrapped master key cannot
  be derived without the authenticator producing the PRF output, which
  requires the credential to be physically present on the device
  performing the ceremony. A remote attacker without the credential
  cannot unwrap MK.
- Vault security (master password, auto-lock timeout, vault-level
  biometric unlock) is the layer the user already maintains; Chatsundere
  composes on it rather than duplicating it.
- Users who want strict per-operation UV may choose a UV-enforcing
  authenticator (Face ID device, Yubikey with PIN, etc.); the
  authenticator's intrinsic behaviour wins regardless of our policy.

## Alternatives considered

1. **Keep `userVerification: 'required'`.** Rejected: excludes a
   substantial fraction of the authenticator population (vaults with
   unlocked state, no-PIN hardware tokens). The exclusion would push
   users either onto OPAQUE passphrase day-to-day (slower UX, defeats
   the point of having passkeys) or away from Chatsundere entirely
   (worse outcome).
2. **Per-passkey UV policy.** Rejected: too configurable, violates the
   Omakase principle ([`CLAUDE.md`](../../CLAUDE.md) §11), and the
   authenticator's intrinsic behaviour overrides the policy anyway.
   May be revisited if real-world use shows the need, but the bar for
   re-opening this is empirical demand, not theoretical preference.

## Scope

This ADR covers UV on PRF-bearing passkey ceremonies in Phase 0. It does
**not** cover:

- Conditional UI (`mediation: 'conditional'`) — deferred to a future
  UX-polish squash; see [passkey-uv-policy brief](../briefs/phase%200/passkey-uv-policy.md)
  "Deferred" section.
- Future passkey-only accounts without an OPAQUE method — explicitly
  forbidden by [ADR 0021](0021-phase0-opaque-first-linking.md) in
  Phase 0.

## References

- [ADR 0005](0005-require-prf-for-passkey-mk-wrapping.md) — PRF requirement (orthogonal to this ADR, unchanged).
- [ADR 0021](0021-phase0-opaque-first-linking.md) — OPAQUE-first linking, recovery-path guarantee.
- [`obsidian/briefs/phase 0/passkey-uv-policy.md`](../briefs/phase%200/passkey-uv-policy.md) — full Lyra brief.
- [`obsidian/insights/2026-05-19-brief-material-passkey-uv.md`](../insights/2026-05-19-brief-material-passkey-uv.md) — originating discussion notes.
- `apps/user-client/src/lib/webauthn.ts:65-67` — current UV='required' call site (to be updated).
- `apps/user-client/src/routes/login/index.tsx:73,145` — current UV='required' call site and `showBiometric` gate (to be updated).
