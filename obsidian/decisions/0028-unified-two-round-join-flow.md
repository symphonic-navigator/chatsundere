# 0028 — Unified two-round join flow

**Date:** 2026-05-22
**Status:** Accepted
**Supersedes:** the implicit one-shot framing in the cross-device-identity brief; the per-flow endpoints `/v1/link/opaque/{start,finish}`.

## Context

The cross-device-identity brief proposed a single `POST /api/join`
endpoint handling both invitation-driven first-link and pairing-driven
device-add via a `type` discriminator. The endpoint was sketched as
one-shot — the client submits the code plus everything else, the server
redeems it in one transaction.

OPAQUE is fundamentally a two-round protocol for both flows in scope here:

- **Registration:** the client sends a `registrationRequest`, the server
  responds with a `registrationResponse` the client incorporates into
  the final `registrationRecord`.
- **Login:** the client sends a `loginRequest` (`ke1`), the server
  responds with a `loginResponse` (`ke2`), the client computes
  `finishLoginRequest` (`ke3`) as the evidence.

The server cannot derive the registration record from the registration
request without the client's round-trip. The login evidence requires
the server's `ke2` to be computed. One-shot redemption is mechanically
impossible without breaking the OPAQUE guarantee.

The existing auth-service already implemented invitation linking as
`/v1/link/opaque/{start,finish}` — a two-round flow, but separate from
the pairing flow that did not yet exist.

## Decision

We unify both flows under `POST /api/v1/join/{start,finish}` with a
`kind` discriminator (`'invitation' | 'pairing'`) in the request body.
Existing `/v1/link/opaque/*` is removed and its logic absorbed into
the invitation branch of the new endpoints.

```
POST /api/v1/join/start
  { kind: 'invitation', code, registration_request } → 200 { session_id, registration_response, suggested_username }
  { kind: 'pairing', code, login_request }           → 200 { session_id, login_response, username }

POST /api/v1/join/finish
  { kind: 'invitation', session_id, username, registration_record, wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque, wrapped_mk_recovery, wrap_nonce_recovery, wrap_aad_recovery, recovery_verifier_key }
                                                     → 200 { user_id, username, role, access_token, expires_in, is_new_account: true }
  { kind: 'pairing', session_id, login_evidence }    → 200 { user_id, username, role, access_token, expires_in, is_new_account: false, wrapped_mk_opaque, wrap_nonce_opaque, wrap_aad_opaque }
```

Both branches share:

- Session-state plumbing (`storeOpaqueState` / `fetchOpaqueState`).
- Atomic code redemption against `pending_codes` (single-use guaranteed
  by an `UPDATE … WHERE redeemed_at IS NULL AND revoked_at IS NULL`).
- Rate limiting (`consumePendingCodeAttempt`, per-IP minute + hour caps
  per spec §6).
- Defence-in-depth wrapping-integrity check on the pairing branch
  (`assertOpaqueWrappingPresent` — see ADR 0021).

## Consequences

- One external surface for "joining a server" (whether first-link or new
  device on existing account). The client-side onboarding code branches
  on input shape, not on endpoint URL.
- The OPAQUE primitives (`createRegistrationResponse`, `startLogin`,
  `finishLogin`) are invoked per-branch within the same handler;
  shared concerns are written once.
- The unified shape allows the pairing flow to return the existing
  account's wrapped MK material on success (cross-device crypto domain
  join), which the registration branch does not need.
- `kind_mismatch` (400) is returned when a code submitted with `kind:
  invitation` is actually a pairing code (or vice versa). The mismatch
  check fires *before* the attempt counter is incremented so a
  shoulder-surfed code cannot be DoS'd by wrong-kind submissions
  (Larissa β M1).
- The brief's one-shot framing is rejected. Client docs describe the
  join flow as start+finish.
- `/v1/link/opaque/*` is deleted from the server; client-side wiring
  that still calls those paths (user-client `linkOpaqueStart` /
  `linkOpaqueFinish`) will get 404 until the user-client onboarding
  overhaul (next-session work) migrates it to the unified shape.

## Alternatives considered

1. **Keep `/v1/link/opaque/*` and add `/v1/pair/*` as a twin pair.**
   Rejected — duplicates session-handling, rate-limit, and atomic-
   redemption logic across two code paths that are 90% identical.
2. **Brief-style one-shot with the OPAQUE round hidden behind a single
   request.** Mechanically impossible — the server cannot produce a
   `registrationRecord` from a `registrationRequest` (or `finishLogin`
   evidence from a `loginRequest`) without the client round-trip.
3. **Single endpoint pair without `kind` discriminator (look up the
   `pending_codes` row, branch on its `type`).** Rejected — clients
   already know which kind they hold (they chose the input flow);
   declaring it explicitly catches mismatches early (`400 kind_mismatch`)
   rather than silently entering the wrong branch.
4. **GET-based pairing-code redemption.** Rejected — pairing requires
   submitting OPAQUE evidence; a GET cannot carry the body.

## References

- [Cross-device-identity API shapes spec, 2026-05-22](../../superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md)
- [ADR 0021 — Phase 0 OPAQUE-first linking](0021-phase0-opaque-first-linking.md)
- [ADR 0023 — Server at root, HTTPS, `/api/` prefix (2026-05-22 amendment)](0023-server-at-root-https-api-prefix.md)
- [ADR 0027 — Step-up authentication policy](0027-step-up-authentication-policy.md)
