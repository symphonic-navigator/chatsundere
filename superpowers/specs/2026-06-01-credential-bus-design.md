# Credential Bus — Design Spec

**Date:** 2026-06-01
**Status:** Approved (Chris, brainstorming session 2026-06-01)
**Author:** Liz
**Scope:** Client-only (`apps/user-client`). No backend, no `packages/crypto` change.

---

## 1. Purpose

Introduce a forward-looking structure — the **credential bus** — that lets any
part of the user-client ask *"does the user have an API key for X, and if so,
give it to me."* No consumer exists yet; this is anticipatory scaffolding that
becomes a documented part of the architecture, per Chris's request.

The motivating future use case is **integrations**: surfaces such as "show the
user their nano-gpt usage and account balance". nano-gpt is already a configured
LLM provider with a stored API key — the balance integration should reuse *that*
key rather than ask the user to enter it again.

A second, deliberately out-of-scope future case (LAN actuator control via a key
that has no LLM provider behind it) informs the design but is not built here.

## 2. Decisions captured during brainstorming

1. **Key source: pass through existing provider keys.** The bus reads the
   already-stored LLM-provider keys. An integration asking for `nano-gpt`
   receives exactly the key the user entered as an LLM provider — no duplicate
   entry, no separate credential store for the cases we have today.
2. **Identity: abstract credential ID.** Consumers ask for a named
   `CredentialId` (e.g. `'nano-gpt'`). The bus encapsulates the source. Today
   every ID is provider-backed; the abstraction lets a future standalone-key
   source (the actuator case) plug in additively.
3. **Build now: query API *and* the reactive surface.** Because keys live as
   Dexie `ProviderRow`s and the app already uses TanStack Query, reactivity is
   nearly free, so the bus ships "integration-ready" rather than query-only.
4. **`enabled` gating.** Key presence is reported **only when the provider row
   is `enabled`**. Disabling nano-gpt as a chat route also hides any integration
   that depends on its key. (Conscious coupling — see §7.)

## 3. Architecture (Approach A — thin facade over a source registry)

Everything lives in the **user-client** — Dexie and the session MasterKey are
there. `llm-unified` stays protocol-pure and gains nothing.

```
apps/user-client/src/credentials/
├── types.ts                      CredentialId, CredentialSource, CredentialPresence
├── credential-bus.ts             the facade: hasCredential / getCredentialKey + source registry
├── sources/
│   └── provider-key-source.ts    reads enabled ProviderRows; credentialId === templateId
└── use-credential.ts             reactive TanStack hook useCredential(id)
```

### Core types

```ts
/** Abstract credential identity. For provider-backed credentials this equals
 * the provider's templateId (e.g. 'nano-gpt'). */
export type CredentialId = string;

/** A source of credentials the bus can query. The provider-key source is the
 * only implementation today; a standalone-key source is the documented future
 * extension. */
export interface CredentialSource {
  readonly kind: string;                      // e.g. 'provider-key'
  /** Presence check — MasterKey-free. */
  has(id: CredentialId): Promise<boolean>;
  /** Retrieve the plaintext key — MasterKey-gated. null if this source does
   * not serve the id. Throws if the MasterKey is wrong/absent (AES-GCM tag). */
  get(id: CredentialId, mk: MasterKey): Promise<string | null>;
}
```

The bus holds an ordered array of registered sources and dispatches
**first-match**. Today the array is `[providerKeySource]`. A future
`standaloneKeySource` is appended without changing the bus or any consumer.

`credentialId === templateId` for the provider source — no separate mapping
table is needed while providers are the only source.

## 4. Public API

Three consumption paths, chosen by context.

### 4.1 Imperative presence (MasterKey-free)

```ts
hasCredential(id: CredentialId): Promise<boolean>
```

Asks each registered source in order; `true` as soon as one serves the id. For
the provider source: an **enabled** `ProviderRow` with `templateId === id`
exists. Usable in non-React code and for pre-flight checks; does not require the
vault to be unlocked.

### 4.2 Imperative retrieval (MasterKey-gated)

```ts
getCredentialKey(id: CredentialId, mk: MasterKey): Promise<string | null>
```

Opens the sealed key via `openSecret` — the same path `send-message.ts` uses
today (`provider/<rowId>/api-key` slot). Returns `null` when no source serves
the id. **Throws** when the MasterKey is wrong or absent (the AES-GCM tag
fails); the caller handles this like any crypto error. Called at the point an
integration actually performs an API call.

### 4.3 Reactive hook

```ts
useCredential(id: CredentialId): { present: boolean; isLoading: boolean }
```

A TanStack Query over the `providers` table. Because `useUpsertProvider` and
`useDeleteProvider` already invalidate `QK.providers`, the hook updates
automatically when the user enters or deletes a key — exactly the reactivity for
"integration appears / disappears".

**The hook exposes presence only, never the plaintext.** A decrypted key never
lingers in React state; retrieval is always an explicit, MasterKey-gated call
(4.2) at the point of need.

## 5. Semantics

- **Presence (provider source):** `present === true` iff a `ProviderRow` with
  `templateId === id` exists **and** `enabled === true`. Presence checks the
  row, not the plaintext (which would need the MasterKey). A configured row
  always carries an `apiKey` blob; there is no "empty key" special case.
- **Unknown id:** no source serves it → `hasCredential` returns `false`,
  `getCredentialKey` returns `null`. Not an error — "unknown" means "not
  present".
- **Duplicate enabled rows** with the same `templateId` (should not occur):
  first-match, deterministic over Dexie order.

## 6. Error handling

- Unknown id → `false` / `null`, never throws.
- Wrong/absent MasterKey on retrieval → `openSecret` throws (AES-GCM tag); the
  bus does **not** swallow it. A genuine crypto error propagates to the caller.

## 7. Consequences & implications

- **enabled coupling (Decision 4).** Credential availability is tied to the
  provider being an active LLM route. Disabling nano-gpt for chat also removes
  any key-dependent integration (e.g. balance). This is a conscious product
  choice; a future revision could decouple "credential present" from "LLM route
  active" by checking row existence independent of `enabled`. Recorded here so a
  later reader can revisit deliberately.
- **No new persistence, no Dexie migration.** The bus reads existing
  `ProviderRow`s. The standalone-key store (actuator case) is a future source
  kind with its own table when a consumer needs it.
- **New access surface to unsealed keys.** The bus is a new place that calls
  `openSecret`. It changes no crypto primitive and adds no new storage, but it
  widens *who* can request a decrypted key. Noted in the security journal
  (§9).

## 8. Testing (Vitest, user-client)

- `provider-key-source`: `has`/`get` across enabled / disabled / missing row;
  `get` opens the correctly-sealed key; wrong MasterKey throws.
- `credential-bus`: registry dispatch (first-match); unknown id → `false` /
  `null`.
- `use-credential`: reactive update after provider upsert / delete (query
  invalidation propagates).

## 9. Documentation & gates

- **ADR 0033** — "Credential bus as the integration credential boundary":
  context, the four decisions, consequences, and the documented future path
  (second source kind for standalone keys; an integration manager with
  auto-activation — explicitly out of scope).
- **`obsidian/ARCHITECTURE.md`** — a short section anchoring the bus as an
  architectural component (Chris's "documented part of the architecture").
- **Larissa gate:** the bus does **not** touch `apps/auth-service`,
  `apps/sync-service`, `apps/proxy-service`, or `packages/crypto`. It *uses*
  `secrets.ts`/`openSecret` but changes no crypto primitive — no mandatory audit
  under CLAUDE.md §9. A note goes into the security journal because it is a new
  access surface to unsealed keys.

## 10. Out of scope (anticipated, not built)

- The integrations themselves and any integration UI.
- Auto-activation of an integration when a matching key appears, and
  auto-deactivation when the key is deleted (incl. a late-arriving integration
  picking up an existing key). The reactive hook (§4.3) is the primitive these
  will build on.
- The standalone-key source and its storage (the LAN actuator case) — a
  documented future `CredentialSource` implementation.

## 11. Manual verification

No user-facing surface ships in this unit, so device verification is limited.
Chris can confirm post-implementation:

1. With a configured, enabled nano-gpt provider, a temporary dev probe
   (`hasCredential('nano-gpt')`) returns `true`; toggling the provider to
   disabled flips it to `false` reactively in a `useCredential('nano-gpt')`
   harness.
2. `getCredentialKey('nano-gpt', mk)` returns the same plaintext the chat path
   uses (spot-check against a known key), and returns `null` for an unknown id.
