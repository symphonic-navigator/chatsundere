# Chatsundere Architecture

> _Skeleton. Each section is filled when the service or subsystem it describes lands._

## Overview & Mission

_To be filled when the first end-to-end flow exists. Anchor: zero-knowledge AI companion, OPAQUE + WebAuthn-PRF authentication, local-first vault, self-hostable backend._

## Services & Boundaries

_To be filled with the deployment diagram, port map, and JWT trust topology once `auth-service` ships._

## Crypto Model

_To be filled with the AMK/MK/DEK derivation graph and the wrap chain once `packages/crypto` ships. See `obsidian/briefs/phase 0/crypto.md` for the design intent._

## Data Flow

_To be filled per service: registration, login, recovery, vault sync, proxy request._

## Threat Model

_To be filled. Anchors: zero-knowledge backend, untrusted-server assumption, recovery-key irrecoverability by design._

## Deployment Topology

_To be filled. Anchors: Hetzner VPS, Docker Compose, Traefik, Let's Encrypt._

## Credential bus

`apps/user-client/src/credentials/` answers "does the user have an API key for
credential X, and if so, give it to me." It is the single boundary integrations
use to reach stored API keys, rather than reading provider rows directly.

- **Source abstraction.** A `CredentialSource` array, queried first-match. Today
  the only source is `providerKeySource`, which passes through enabled
  `ProviderRow`s (`credentialId === templateId`). A standalone-key source (keys
  with no LLM provider behind them) is the documented future extension.
- **Presence vs retrieval.** `hasCredential(id)` is MasterKey-free (row
  existence). `getCredentialKey(id, mk)` is MasterKey-gated and opens the sealed
  key via `openSecret`, the same path the chat send uses.
- **Reactive.** `useCredential(id)` returns presence only and updates
  automatically when the user adds or removes a key (it shares the `providers`
  query prefix). Integration UI builds on this; the plaintext is never exposed
  reactively.

See ADR 0033 and `superpowers/specs/2026-06-01-credential-bus-design.md`.
