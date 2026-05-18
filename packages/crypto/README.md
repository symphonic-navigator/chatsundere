# @chatsundere/crypto

Client-side cryptographic foundation for Chatsundere. Implements the local-first identity model: a Master Key generated client-side, wrapped under multiple Auth Method Keys (passphrase via Argon2id, recovery key via HKDF, optional WebAuthn-PRF for biometric unlock, optional OPAQUE-derived AMK when linked to a backend), persisted in IndexedDB with AES-256-GCM AAD-bound wraps and integrity HMACs.

See [`SECURITY.md`](./SECURITY.md) for the threat model.

## Status

Phase 0. Not yet published.

## API

Public exports come from `src/index.ts`. The high-level flows are the primary entry points:

- `createLocalAccount({ db, username, passphrase })` → new local account, returns the session and a one-time recovery key string.
- `loginLocalWithPassphrase`, `loginLocalWithRecoveryKey`, `loginWithLocalBiometric` — three local login variants.
- `linkToServer({ db, serverClient, invitationToken, baseUrl, ... })` — promotes a local account to a linked one.
- `loginOnlineLinked` — transparent double-auth login (local + server in parallel).
- `recoveryOnline` — server-side recovery via verifier-key challenge-response.
- `deleteServerAccount` — drop the server side; local data untouched.
- `addPasskeyPostLink` — add another authenticator after linking.

See the per-flow doc comments for the exact argument shapes.

## Testing

```bash
pnpm --filter @chatsundere/crypto test
pnpm --filter @chatsundere/crypto typecheck
```

Property tests live under `tests/property/`. Integration tests at `tests/integration/` exercise the full lifecycle using `@serenity-kit/opaque`'s server bindings.

## Licence

LGPL-3.0-only. See [`LICENSE`](./LICENSE).
