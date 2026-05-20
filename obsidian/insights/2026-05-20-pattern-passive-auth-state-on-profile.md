# Pattern — Passive visibility of auth-state on the profile page

**Date:** 2026-05-20
**Status:** Design principle, to be honoured in future UX briefs
**Audience:** Lyra (when writing UX briefs touching session/auth state), Liz (when implementing the profile page or auth-methods settings)

---

## The pattern

Authentication state that *might* be relevant to advanced users (how
the current session was established, whether UV happened on the most
recent ceremony, when the session expires, what authenticator was used)
lives on the **profile / settings page** as plain, factual information.
It does **not** live in the global header, status bar, or as a
floating indicator.

The user who cares can look it up in one place that they already know
how to find. The user who does not care never sees it.

## Why

Three principles compose into this rule:

1. **"Don't make me think"** ([`CLAUDE.md`](../../CLAUDE.md) §11). The
   99% case is "user opens the app, uses it, closes it" — they do not
   need to know which authenticator participated in any given ceremony.
   Surfacing the information passively keeps the routine UX clean.
2. **"Disabled over hidden"** (same §11). The information is not
   suppressed; it is exactly where a curious user would look. Not
   buried in a developer console, not gated behind a feature flag —
   visible to anyone who navigates to their own settings.
3. **Don't undermine accepted defaults with UX theatre.**
   [ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md)
   establishes that vault-stored passkeys without per-operation UV are
   an accepted login mode. If we then plastered a header warning ("you
   logged in without biometric!") on every page, we would be telling
   the user the default is unsafe — which contradicts the ADR. Passive
   visibility on the profile reports the fact; it does not editorialise.

## Anti-patterns

For the reviewer's benefit, the things this pattern explicitly **rejects**:

- A lock-icon variant in the global header that changes colour based on
  UV status. "Strong" vs "weak" framing implies the weak case is
  dangerous, which we have decided it is not.
- A toast or banner shown after login summarising the authentication
  method. Users read login confirmations once, then learn to dismiss
  them — the information density is wasted.
- A "session strength" badge next to the user's name. Same critique as
  the lock icon, plus it permanently consumes UI real estate.
- Hiding the information entirely until the user opens a developer
  console. Not transparent.

## Concrete shape (illustrative, not normative)

The actual layout is for the UX brief that will eventually formalise
the settings/profile screen. Sketch for orientation:

```
Settings → Account → Active session

  Signed in:            2026-05-20 09:14
  Method:               Passkey
  Stored in:            Vault (Bitwarden Desktop)
  Verified this session: No (vault was already unlocked)
  Session expires:      2026-05-20 17:14

  [Sign out]            [Sign out everywhere]
```

Important framing choices the brief should hold:

- "Verified this session: No" is **factual**, not alarming. No red
  colour, no warning icon. It pairs naturally with the "Method: Passkey"
  line and lets the reader correlate.
- "Stored in: Vault (Bitwarden Desktop)" is helpful context, but only
  show it when we can reliably identify the storage. For platform
  authenticators (Touch ID, Windows Hello) the answer is the OS;
  for security keys it is the device model if we can read it; for
  vaults it is the vault if WebAuthn surfaces it, otherwise just
  "Vault".
- "Sign out everywhere" is the operational lever the user reaches for
  if they suspect any of this is wrong. That button is the active
  counterpart to the passive display.

## When to apply this pattern beyond auth

The principle generalises. Any security-relevant state that:

- might be useful for an advanced user to know,
- is not actionable for the average user, and
- would be **misread as alarm** if surfaced prominently,

belongs on a settings/profile page in plain factual form, not in the
global UI chrome.

Other candidates this rule will eventually cover:

- Sync state ("last synced at", "items pending upload") — when sync
  service lands.
- Encryption-key fingerprint for the active master key — for users who
  want to verify cross-device.
- Connected devices list — already implied by the
  [cross-device-identity brief material](2026-05-19-brief-material-cross-device-identity.md).

## Complement — active prompts for sensitive operations

This pattern is the **passive** half. Its active counterpart is the
**step-up modal** described in
[`2026-05-20-brief-material-step-up-auth.md`](2026-05-20-brief-material-step-up-auth.md):
when the user initiates a sensitive operation (add a passkey, generate
a pairing code, delete the account), a modal explicitly asks for fresh
verification. The two patterns cover the full surface:

- Routine state (read-only, advanced-user-relevant) → passive on profile.
- Privileged actions (mutating, irreversible, secret-disclosing) →
  active modal with step-up.

Together they ensure the user is never *startled* by security UI in the
routine flow, and never *blindsided* by an irreversible action without a
fresh prompt.

## References

- [ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md) — the policy this passive display reports on without editorialising.
- [`2026-05-20-brief-material-step-up-auth.md`](2026-05-20-brief-material-step-up-auth.md) — the active counterpart.
- [`CLAUDE.md`](../../CLAUDE.md) §11 — Omakase, Don't-make-me-think, Disabled-over-hidden.
- [`obsidian/briefs/phase 0/passkey-uv-policy.md`](../briefs/phase%200/passkey-uv-policy.md) — the originating brief that flagged "future UX work" for this surface.
