# Provider uniqueness by template — structural one-row-per-provider

**Date:** 2026-07-06
**Author:** Liz
**Status:** Draft — awaiting Chris's review
**Related:** [`2026-07-06-client-data-identity-isolation.md`](2026-07-06-client-data-identity-isolation.md) (the sibling isolation fix), `data/providers.ts`, `sync/apply.ts`

---

## 1. Problem

A user's account can end up with **two provider rows for the same provider** (observed
live 2026-07-06: two `nano-gpt` rows on a single primary-admin account). The chat and
credential paths assume at most one enabled row per provider template and take the
first match:

```ts
// credentials/sources/provider-key-source.ts
// "duplicate enabled rows for one templateId should not occur"
async function findEnabledRow(id) {
  return db.providers.where('templateId').equals(id).filter(r => r.enabled).first();
}
```

That invariant is **assumed but nowhere enforced**. When two rows exist, first-match is
non-deterministic across devices, and a stale/duplicate key can shadow the real one.

## 2. Root cause — cross-device convergence, not a local double-insert

The write path already guards against same-device duplicates: `provider.tsx:46` finds the
existing row **by `templateId`** and routes to the update branch (`id: existing?.id`).
So a single device cannot normally create a second row through the UI (a rapid
double-submit race is the only local window).

The real source is **cross-device convergence**:

1. Device A creates a `nano-gpt` row with `id = uuidv7()` → call it `#A`.
2. Device B independently creates its own `nano-gpt` row with `id = #B`.
3. Both sync up. `sync/apply.ts` keys every row by its **local sync key = table primary
   key** (`db.table(collection).get(key)`, apply.ts:278) and writes each incoming row
   under its own id. There is **no `templateId`-level reconciliation anywhere**.
4. The account now holds two `nano-gpt` rows, `#A` and `#B`.

This matches the field report exactly ("two browsers, same-named primary admin, felt like
one user"). The per-device `existing`-by-`templateId` check cannot prevent it, because the
two inserts happen on different devices with independent local state.

**Corollary:** a write-path upsert alone is necessary but not sufficient. Convergence has
to be solved where the collections meet — the sync key.

## 3. Decision

**Make `templateId` the identity of a provider row: one row per provider template, the
row's primary key *is* its `templateId`.** (Chosen over a `uuid` PK + unique index +
sync-apply reconciliation.)

Rationale: the sync key for a collection is its local primary key (`listLocalKeys` returns
`primaryKeys()`; `blindId` is derived from `(mk, collection, key)`). If the provider's sync
key is its `templateId`, then **both devices write the same sync key** and the existing
last-writer-wins merge converges them automatically — a second row cannot exist. The
"one provider per template" invariant becomes a **property of the data shape**, not a
guard defended by distributed reconciliation logic. This is the structurally-honest model
and it deletes an entire class of convergence bugs rather than policing them.

## 4. The seal-context wrinkle, and how we avoid a re-seal

A provider's API key is sealed with an AAD context derived from the **row id**:

```ts
openSecret(row.apiKey, mk, `provider/${row.id}/api-key`)
```

Consumers: `provider-key-source.ts:40`, `voice-transport.ts:48`, `resolve-args.ts:45`,
`send-message.ts` (×3), and the seal side in `provider.tsx`.

Naively, changing the id from `uuid` to `templateId` would break the AAD of every
already-sealed key, and **re-sealing needs the MasterKey, which a Dexie upgrade does not
have**.

**We avoid the re-seal entirely by decoupling the seal context from the primary key.**
Introduce a non-indexed field `keySlot: string` on `ProviderRow`, which holds "the value
the AAD is bound to":

- **Migrated rows:** `keySlot = <old uuid>` — preserves the existing sealed blob verbatim,
  no MK, no re-seal.
- **New rows:** `keySlot = uuidv7()` at creation (preserves today's per-row separation).
- **All reads/writes** compute the context from `row.keySlot`, never `row.id`:
  `provider/${row.keySlot}/api-key`.

`keySlot` is unindexed, so it adds no schema surface of its own (it rides the same version
bump the PK change already forces). The AAD is not secret and need not be globally unique;
within one account one `templateId` = one row = one slot, so no context collision is
possible.

## 5. Design

### 5.1 Schema — `providers` primary key `uuid` → `templateId`

`client-data-db.ts` currently declares `providers: 'id, templateId, enabled'`. The target
is `providers: 'templateId, enabled'` with `keySlot` carried as unindexed data and the
`id` field dropped (or retained equal to `templateId` for consumer compatibility — see
§5.4).

> **Crux risk — verify empirically before building (empirical-truth-over-docs).** Dexie
> does **not** support changing a store's primary key in place via `.stores()`. The
> baseline mechanism is the temp-store copy: create `providers` afresh under the new key
> by copying+deduping rows out of the old store, because Dexie cannot rename a store. The
> plan's **first task must be a throwaway prototype** proving the exact Dexie sequence
> (temp store → copy+dedup → swap) round-trips real rows, including the `keySlot`
> preservation. If the prototype shows the PK change is disproportionately fragile, the
> documented fallback is **Weg 2b** (§8): keep the `uuid` PK but override the *sync key*
> for the `providers` collection to `templateId`, achieving the same convergence without a
> local PK migration. Chris decides between them at plan time, informed by the prototype.

### 5.2 Local dedup during migration

Existing devices may already hold duplicate rows. The migration collapses each `templateId`
group to one survivor using a **total, device-identical** rule (so every device picks the
same winner and they converge, not oscillate):

1. an `enabled` row beats a disabled one;
2. else the higher `updatedAt` wins;
3. else lexicographic tiebreak on the old `id` (fully deterministic).

The survivor keeps its sealed `apiKey` and takes `keySlot = <its old id>`. Losers are
dropped locally **and** their sync deletion is enqueued (§5.3).

The migration reads only metadata (`enabled`, `updatedAt`, `id`) — it cannot and must not
try to decrypt, so it can run without the MK.

### 5.3 Sync re-key choreography

After rekeying, a provider's sync key changes from `<old uuid>` to `<templateId>`. The
device must:

- enqueue an **upsert** for the new key `<templateId>` (publishes the row under its new
  blindId), and
- enqueue a **delete** (tombstone) for each old key it is retiring (`<old uuid>`, and any
  deduped loser ids), so the old blind entries do not resurrect.

Convergence argument: every device applies the same deterministic dedup, and the
old-key deletes + new-key upsert propagate through the normal outbox. A device that has
not yet migrated receives the new `templateId` row and the old-uuid delete, converging to
the single row; when it later runs its own migration the step is a no-op. There is a
transient window in which a lagging device holds both rows; this is eventually consistent
and acceptable for a one-shot migration. **This choreography is the second risk area and
is covered by the two-device convergence test (§7).**

### 5.4 Write-path & consumer simplification

- With `templateId` as the key, `useUpsertProvider`'s two branches collapse: there is no
  "mint a new uuid" path, so the **two-phase seal dance in `provider.tsx`** (seal under
  `pending`, insert, re-seal under the real id, update again — lines 91–135) disappears.
  Seal once under `provider/${keySlot}/api-key` and `put` by `templateId`.
- Consumers that read a provider row's `.id` (`model-picker-data.ts:122` `providerRowId`,
  `web-backend-options.ts:41` — the latter is already a *catalogue* provider whose `.id`
  is the template id) continue to work: post-migration a row's identity **is** its
  `templateId`, which is what every offering ref already resolves against
  (`voice-transport.ts:36`, `select-offering.ts:35`, `use-dictation.ts:252` all match
  `row.templateId === offering.providerId`). Retaining an `id` field equal to `templateId`
  is the lowest-churn option and is recommended unless the prototype shows dropping it is
  clean.

## 6. Scope boundaries

**In scope:** `apps/user-client` client-data (`providers` store, its migration, write
path, seal-context decoupling) and the client-side sync outbox/apply interaction for the
`providers` collection.

**Out of scope (tracked separately):**

- **(A)** `reset-dev-auth.sh` also clearing `sync_db` + MinIO — **already done**
  2026-07-06 (dev tooling, not part of this feature).
- **(C)** deleting the three orphan accounts from the live dev `sync_db` — **already done**
  2026-07-06.
- The `client-data-identity.ts` "tag absent → adopt" window (a returning-user vs
  foreign-legacy-data ambiguity) — noted for a separate look with Larissa; **not** touched
  here.

## 7. Testing

- **Unit — dedup rule:** the total order (enabled > updatedAt > id) picks a stable winner
  for every input permutation; idempotent on already-single groups.
- **Migration idempotency:** running the migration twice is a no-op the second time;
  `keySlot` is preserved and the sealed key still opens under `provider/${keySlot}/api-key`
  (round-trip a *real* sealed blob — full fidelity, not a text stub).
- **Integration — two-device convergence (the load-bearing test):** simulate device A and
  device B each creating a `nano-gpt` row, cross-apply their outboxes, and assert both
  converge to exactly one row under key `nano-gpt` with a deterministic survivor and the
  loser tombstoned (no resurrection on a second sync cycle).
- **Prototype gate:** the Dexie PK-change prototype (§5.1) must pass before the real
  migration is written.

## 8. Weg 2b — documented fallback

If the PK-change prototype is too fragile: keep `providers: 'id, ...'` (uuid PK) but make
the sync layer use `templateId` as the collection's sync key (override `keyFor('providers')`
and the local-key listing). Convergence is identical (same sync key → existing LWW merge);
the cost moves from a local schema migration to a small, well-contained local-uniqueness
guard so two local uuid rows never map to one sync key. This keeps the structural
convergence property while sidestepping the Dexie sharp edge.

## 9. Audit

Not in Larissa's four hard directories (`auth-service`, `sync-service`, `proxy-service`,
`crypto`) — this is client-data. But it **changes how a credential's AAD context is
derived** and it **alters sync convergence semantics**, both squarely in her wheelhouse. A
**light Larissa spec-pass is advisable** before the plan lands, focused on: the `keySlot`
decoupling preserving domain separation, and the re-key choreography not opening a window
where a superseded key shadows the live one.

## 10. Manual verification (Chris, on-device)

1. `./reset-dev-auth.sh` → `./bootstrap-admin.sh`, register fresh on device A, add a
   `nano-gpt` key.
2. Pair device B (or a second browser profile), confirm the single `nano-gpt` row syncs
   down — **one** row, not two.
3. On device B, edit the `nano-gpt` key; confirm device A converges to the edit with still
   **one** row.
4. Console probe (`db.providers.toArray()`): exactly one row per `templateId`, its
   `keySlot` present, its key equal to its `templateId`.
