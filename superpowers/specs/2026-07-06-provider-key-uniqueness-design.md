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

**Make `templateId` the identity of a provider row: one row per provider template, a
provider row's `id` value *is* its `templateId`** (the Dexie keyPath stays `id`; only the
value written to it changes — see §5.1). Chosen over a `uuid` PK + unique index +
sync-apply reconciliation.

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

### 5.1 Identity — a provider row's `id` value **is** its `templateId` (keyPath unchanged)

We do **not** change the Dexie keyPath. The store stays `providers: 'id, templateId,
enabled'`; what changes is the **value** written to `id`: instead of `uuidv7()`, a new
provider row is created with `id = templateId`.

This is the pivotal simplification. The sync key for providers is already `row.id`
(`sync-keys.ts:40`, `syncKeyOfRow` → the "every other collection → the row's `id`"
branch). So once `id === templateId`:

- **Forward cross-device convergence is automatic.** Two devices creating `nano-gpt` both
  write `id = 'nano-gpt'` → identical sync key → identical `blindId` → the existing
  last-writer-wins merge collapses them. No sync re-key choreography.
- **Local uniqueness is the primary key itself.** `db.providers.put({ id: templateId, … })`
  upserts by `id`; a second `nano-gpt` cannot exist.
- **No Dexie keyPath change**, so none of the Dexie "can't change the primary key"
  fragility applies. Only the row `id` *values* change — a plain data migration (§5.2).

`extractKeyFor('providers')` (the decrypt-time re-derivation that rejects a key mismatch)
also returns `row.id`, so it agrees by construction after migration.

`templateId` is retained as its own (now-redundant but harmless) indexed field so the many
`.where('templateId')` call-sites keep working unchanged.

### 5.2 Local dedup during migration

Existing devices may already hold duplicate rows. The migration collapses each `templateId`
group to one survivor using a **total, device-identical** rule (so every device picks the
same winner and they converge, not oscillate):

1. an `enabled` row beats a disabled one;
2. else the higher `updatedAt` wins;
3. else lexicographic tiebreak on the old `id` (fully deterministic).

Each survivor is **re-inserted under `id = templateId`** with `keySlot = <its old id>`
(preserving its sealed `apiKey` verbatim), and every old-`id` row in the group (survivor's
old uuid + losers) is deleted from the store. Idempotent: a row already keyed by its
`templateId` is left untouched, so a re-run is a no-op.

The migration reads only metadata (`enabled`, `updatedAt`, `id`) — it cannot and must not
try to decrypt, so it runs without the MK, entirely inside the Dexie `v(N).upgrade()`
transaction (a data rewrite, no keyPath change).

### 5.3 Sync — nothing to republish (pre-alpha), forward-automatic thereafter

The encrypted backend is **pre-alpha and dev-only** (goes live at v0.3.0 / Block 6; the
current work is the 0.2.0 sprint). There are **no real accounts with provider rows already
synced to a server**, so there is no pre-existing server-side duplicate to migrate:

- **Dev** accounts are reset via the (now sync-aware) `reset-dev-auth.sh`, which wipes
  `sync_db` outright.
- **Going forward**, every write already uses `id = templateId` as its sync key, so
  cross-device creation converges automatically (§5.1) with no explicit republish.

A linked *dev* account carried across the migration without a reset would keep an orphaned
old-uuid blind on the server (the local rewrite does not enqueue anything). That orphan is
harmless (dev-only) and clears on the next reset; the first subsequent edit republishes the
row under `templateId`. **This assumption — no real synced users pre-alpha — is
load-bearing for dropping the republish; confirm it before executing.** If it ever becomes
false, the follow-up is a one-shot post-link republish (enqueue `upsert templateId` +
`delete <old uuid>`), not part of this plan.

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
- **Migration — real Dexie upgrade (fake-indexeddb):** seed a store at the prior version
  with (a) two `nano-gpt` rows (uuid ids, one enabled) plus a singleton `openrouter` row,
  (b) open at the new version, (c) assert exactly one `nano-gpt` row keyed by `id ===
  'nano-gpt'` with `keySlot` equal to the surviving old uuid, the `openrouter` row rekeyed
  to `id === 'openrouter'`, and the losing uuid rows gone. Round-trip a *real* sealed blob
  (full fidelity, not a text stub): after migration `openSecret(row.apiKey, mk,
  \`provider/${row.keySlot}/api-key\`)` returns the original plaintext. Re-running the
  upgrade is a no-op.
- **Unit — sync-key identity:** `syncKeyOfRow('providers', { id: 'nano-gpt', … }) ===
  'nano-gpt'`, the property that makes cross-device creation converge for free (§5.1). No
  two-device harness needed: convergence reduces to "same `id` ⇒ same sync key", which the
  existing sync engine already merges.

## 8. On the earlier "Weg 2b" fallback

The spec originally carried a Dexie-keyPath-change risk and a "Weg 2b" sync-key-override
fallback. Both are **obsolete**: keeping the keyPath as `id` and setting `id === templateId`
(§5.1) delivers the identical convergence property with neither a keyPath migration nor a
sync-layer override. There is no remaining Dexie sharp edge to hedge against.

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
