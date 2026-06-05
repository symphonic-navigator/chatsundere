# ADR 0033: Credential bus as the integration credential boundary

## Status

Accepted (2026-06-01).

## Context

Future integrations (e.g. showing the user their nano-gpt usage and account
balance) need to ask "does the user have an API key for X, and if so, use it".
For the cases we have today, that key already exists — the user entered it as an
LLM provider. We want a single, documented place to answer that question rather
than scattering provider-row lookups across the codebase, and we want it ready
before the first integration lands.

## Decision

Introduce a client-side **credential bus** (`apps/user-client/src/credentials/`):

1. **Source: pass through existing provider keys.** The bus reads enabled
   `ProviderRow`s; no duplicate entry, no separate store for today's cases.
2. **Identity: abstract `CredentialId`.** Consumers ask for a named id
   (`'nano-gpt'`). The bus encapsulates the source via a `CredentialSource`
   interface; today the only source is `providerKeySource`, where
   `credentialId === templateId`.
3. **Query plus reactive surface.** `hasCredential`/`getCredentialKey`
   (imperative) and `useCredential` (a reactive TanStack hook). Presence is
   MasterKey-free; retrieval is MasterKey-gated via `openSecret`. The reactive
   hook exposes presence only, never the plaintext.
4. **`enabled` gating.** Presence is reported only when the provider row is
   `enabled`.

## Consequences

- Disabling a provider as a chat route also hides any integration that depends
  on its key. Conscious coupling; a future revision could decouple "credential
  present" from "LLM route active" by dropping the `enabled` filter.
- No new persistence and no Dexie migration — the bus reads existing rows.
- A new access surface to unsealed keys (it calls `openSecret`). It changes no
  crypto primitive; noted in the security journal.
- The standalone-key source (a key with no LLM provider behind it — e.g. a LAN
  actuator), and an integration manager that auto-activates/deactivates on key
  changes, are documented future work, out of scope here. The reactive hook is
  the primitive they will build on.

## References

- Spec: `superpowers/specs/2026-06-01-credential-bus-design.md`
- Plan: `superpowers/plans/2026-06-01-credential-bus.md`
