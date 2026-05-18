# ADR 0021: Phase 0 — Backend linking requires OPAQUE first

**Date:** 2026-05-18
**Status:** Accepted

## Context

The spec catalogue (`superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §4) originally listed `POST /v1/link/passkey/start` and `/finish` as accepting **either** an invitation token (first-time link with a passkey, no prior OPAQUE method) **or** a bearer token (add-passkey post-link).

The Squash B implementation (`apps/auth-service/src/routes/link.ts:213`) ships only the bearer-authorised path. The endpoint actively rejects passkey-first registration: it verifies an existing `opaque` auth method exists for the bearer's user and returns `400 invalid_state — Must link via OPAQUE before adding a passkey` otherwise. The code comment frames it as "out of scope for phase 0".

This divergence surfaced during user-client (Squash D) plan review. We could either nachziehen (implement the invitation-authorised path) or akzeptieren (lock in the simpler model). The latter has both a scope benefit (less code, fewer flows in user-client) and a non-trivial security benefit that this ADR records.

## Decision

Backend linking in Phase 0 **requires OPAQUE as the first auth method**. Passkey is always a secondary method, registered after a successful OPAQUE link via the bearer-authorised endpoint.

User-facing flow:

1. User creates a local account (passphrase + recovery key).
2. User links to a server with an invitation token via `POST /v1/link/opaque/{start,finish}`. The account now exists server-side with an OPAQUE auth method.
3. User may optionally add one or more PRF-capable passkeys via `POST /v1/link/passkey/{start,finish}` with a bearer token from step 2.

The endpoints `/v1/link/passkey/{start,finish}` permanently refuse invitation tokens. The spec catalogue is amended to reflect the implementation.

## Consequences

Positive — security:

- **Guaranteed passphrase-based recovery path on every linked account.** The recovery flow (`POST /v1/recovery/{start,finish}` per ADR 0010) is fundamentally OPAQUE-coupled: it relies on the user's recovery key being able to unwrap a recovery-wrapped MK and produce a new OPAQUE record. An account with **only** passkey auth methods would have no rekey target, leaving the user permanently locked out if every passkey is lost. Requiring OPAQUE on every account removes that footgun by construction.
- **Simpler server state-machine.** Every row in `auth_methods` with a given `user_id` is guaranteed to include at least one `method_type='opaque'`. Code that assumes "there is always an OPAQUE method" (recovery, change-passphrase, refresh-token sanity checks) is correct unconditionally, with no defensive `if (!opaque) ...` branches that would otherwise need test coverage and review.
- **Reduced attack surface.** Two-of-N auth-method registration with mixed first-method types doubles the number of valid bootstrap states. Locking the first method to OPAQUE collapses that to one state.
- **Recovery key entropy stays meaningful.** Recovery is rooted in the recovery-key-derived AMK plus the OPAQUE-derived recovery proof flow. Without OPAQUE this leg is missing; alternative designs (e.g., a passkey-recovery hybrid) would need explicit threat-modelling we are not investing in for Phase 0.

Positive — scope:

- User-client (Squash D) implements **one** linking flow, not two.
- Server tests cover one bootstrap path.

Negative / accepted trade-offs:

- Users who want "passwordless from day one" cannot have it in Phase 0. They must set an OPAQUE passphrase first; they may then add passkeys and ignore the passphrase day-to-day.
- The passphrase cannot be removed entirely (consistent with the spec's "no removing the last non-recovery method" rule); a user wanting maximum passkey-purity will see the passphrase remain as a dormant fallback.

## Revisit

Phase 1, if usage patterns indicate a real demand for passkey-only accounts. A future design would need to answer: how does recovery work without an OPAQUE rekey target? Candidate paths include a passkey-recovery hybrid (one designated passkey acts as a wrap-of-MK rekey origin) or accepting "lost passkeys = lost account" with explicit user consent. Neither path is in scope today.

## References

- `apps/auth-service/src/routes/link.ts:213` — code comment and bearer-only guard.
- `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §4 — endpoint catalogue, amended in the same commit as this ADR.
- ADR 0005 — PRF required for passkey wrapping.
- ADR 0007 — Recovery key required at registration.
- ADR 0010 — Recovery via challenge-response.
- `superpowers/plans/2026-05-18-foundational-auth-service.md` Task 10 — the original plan called for both invitation- and bearer-authorised passkey linking; this ADR locks in the actual implementation.
