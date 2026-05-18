# ADR 0005: Require WebAuthn PRF for passkey-based master-key wrapping

**Date:** 2026-05-18
**Status:** Accepted

## Context

WebAuthn passkeys can carry a Pseudo-Random Function (PRF) extension. With PRF, the authenticator returns a 32-byte deterministic output for a given input salt — perfect material to derive an Auth Method Key (AMK) and wrap the user's master key.

Without PRF, a passkey authenticates the user but provides no stable key material. Two options:

- **Option A — refuse to register PRF-less passkeys.** Clean architecture: every passkey can unwrap the master key. Users on platforms without PRF support fall back to OPAQUE passphrases.
- **Option B — allow PRF-less passkeys for authentication only.** A passkey then issues a JWT but does not unwrap the master key. The user must have a parallel passphrase or another PRF-capable passkey for data access. This means the data path and the auth path diverge per credential.

Option B doubles the credential-state space (`can_auth` × `can_unwrap_mk`) and creates UX scenarios where a user logs in but cannot read their data.

## Decision

**Option A.** Registration of PRF-less passkeys is refused at the crypto layer (`packages/crypto`) and surfaced as a user-facing message: "Your device does not support secure key derivation. Use a passphrase instead, or try a different device."

`auth_method.passkey_prf_supported` is still recorded for completeness, but a `false` value blocks registration.

## Consequences

Positive:
- Single, simple invariant: every passkey can both authenticate and unwrap the master key.
- No "I can log in but I can't read my chats" UX failure modes.
- Easier security reasoning.

Negative / accepted trade-offs:
- Users on older or PRF-less platforms cannot use passkeys; they fall back to OPAQUE. Documented in registration UI.
- If platform PRF support changes (regression in a browser update), users may temporarily lose access via that authenticator until the platform fixes it.

## References

- `obsidian/briefs/phase 0/crypto.md` (PRF Handling Details)
- `obsidian/briefs/phase 0/auth-service.md` (`passkey_prf_supported` field)
