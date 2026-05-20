# Pattern — Frontend-only diffs that move crypto-acceptance semantics

**Date:** 2026-05-20
**Status:** Observation, not policy
**Audience:** Liz (judgement input), Lyra (revisit if recurring)

---

## The observation

[`CLAUDE.md`](../../CLAUDE.md) §9 scopes Larissa's mandatory audit to
diffs touching `apps/auth-service/**`, `apps/sync-service/**`,
`apps/proxy-service/**`, or `packages/crypto/**`. Frontend-only diffs
default-skip; the decision to summon Larissa anyway is Liz's call.

The passkey UV-policy work (brief
[`passkey-uv-policy.md`](../briefs/phase%200/passkey-uv-policy.md),
[ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md), landing
2026-05-20) is the first case I've spotted where a strictly frontend
diff — pure `apps/user-client/**` edits, no server change, no
`packages/crypto/**` change — nevertheless moves the **acceptance
semantics for master-key unwrap**. Specifically, it widens the set of
authenticator/UV combinations that the user-client will offer to PRF.
The cryptographic floor (PRF requirement, ADR 0005) is unchanged; the
*gate* in front of that floor is loosened.

This kind of diff is not what §9 had in mind when it scoped the audit
mandate by path. Path-based scoping is a reasonable proxy for "where
crypto lives", but it doesn't catch frontend changes that change *what
gets fed to* the crypto.

## Why I'm not turning this into a rule yet

One case is not a pattern. Promoting it to a §9 amendment now would
either (a) over-trigger Larissa on routine frontend work or (b) require
a fuzzy carve-out that's harder to apply consistently than the current
path-based rule. Either is worse than what we have.

## What I'd suggest Liz consider, case by case

When a frontend-only diff:

1. Changes the *acceptance criteria* for a credential, signature,
   ciphertext, or proof that the crypto layer will subsequently process —
   even if `packages/crypto/**` is untouched, **and**
2. The change is a *loosening* (more inputs accepted), not a tightening,

then a narrowly framed Larissa pass is probably worth the time. Frame
the audit so Larissa doesn't re-audit the underlying crypto: "this diff
loosens the X gate in the client; the Y crypto floor is unchanged —
please confirm the gate change does not enable an unintended bypass."

The narrow framing matters. A general "audit this" prompt wastes
Larissa-cycles re-reading PRF code that hasn't changed. A scoped prompt
puts the audit on the actual delta.

## Revisit conditions

If a second case shows up that fits the criteria above, this stops being
a curiosity and becomes a pattern worth formalising. At that point Lyra
should propose either:

- A §9 amendment that names "client-side gate loosenings against
  cryptographic acceptance" alongside the path-based criteria, or
- A separate ADR documenting the rule with its own scope language.

Until then, this file is the home for the thought.

## References

- [`CLAUDE.md`](../../CLAUDE.md) §9 — current Larissa scope rules.
- [`obsidian/briefs/phase 0/passkey-uv-policy.md`](../briefs/phase%200/passkey-uv-policy.md) — the case that prompted this observation.
- [ADR 0005](../decisions/0005-require-prf-for-passkey-mk-wrapping.md) — PRF crypto floor (the "Y" in the framing above for the UV case).
- [ADR 0022](../decisions/0022-uv-policy-for-webauthn-passkeys.md) — the UV gate change (the "X").
