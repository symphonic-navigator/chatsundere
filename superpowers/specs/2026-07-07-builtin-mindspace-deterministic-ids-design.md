# Deterministic Built-in Mindspace IDs — Design

**Date:** 2026-07-07 · **Author:** Liz (with Chris) · **Status:** Approved
**Fixes:** [`PRE-TEST-ANALYSIS-v0.2.0.md`](../../PRE-TEST-ANALYSIS-v0.2.0.md) finding **#5 (Medium)** — mindspace convergence
**Precedent:** [`2026-07-06-provider-key-uniqueness-design.md`](2026-07-06-provider-key-uniqueness-design.md) (the v35 provider-identity fix; same bug class, same structural remedy)

---

## 1. Problem

The seven built-in mindspaces are seeded per device with fresh `uuidv7()`
(`apps/user-client/src/boot/client-data-db.ts:1516`) and are deliberately excluded from
sync (engine spec §12.5; enforced at `sync/backfill.ts:121`, `sync/apply.ts:580`,
`sync/recovery.ts:429`). But **three synced reference fields** point at those per-device
ids:

1. `settings.defaultMindspaceId` — in the settings sync allowlist (`sync/strip.ts:47`).
2. `personas.mindspaceId` — personas sync whole (no deny-list entry).
3. `chats.resolvedMindspaceId` — the palette snapshot taken at chat creation
   (`data/chats.ts:67`, `data/send-message.ts:525`); not in the chats deny-list, so it
   syncs. This is the case the original analysis missed: **every** chat synced from
   device A renders with the fallback palette on device B, not just the default/persona
   choice.

On any other device the reference dangles and `resolveMindspace` silently falls back to
`mindspaces[0]` (`state/mindspace-resolver.ts:28`) — no crash, no data loss, but device B
ignores device A's chosen mindspace, and the `mindspaces[0]` fallback itself is
uuid-ordering lottery.

Two verified simplifications shape the fix:

- **There is no custom-mindspace creation.** The only write paths to the `mindspaces`
  table are the seeding paths in `client-data-db.ts`. Every mindspace row in the field is
  one of the seven built-ins, so the `mindspaces` sync collection currently never syncs
  anything.
- **No real user has ever synced.** v0.1.3 (the deployed client) is local-only; the
  v0.2.0 backend go-live has not happened. Dev sync state is wiped by
  `reset-dev-auth.sh`. This is the same load-bearing assumption the provider fix
  documented (§6 there) and it removes any need for server-side republish choreography.

## 2. Decision

**Deterministic slug ids for the seven built-ins, plus a Dexie v36 rekey-and-remap
migration** — the provider-fix pattern applied to mindspaces. Built-ins stay excluded
from sync; because every device now seeds identical ids, the synced reference fields
converge by construction.

Rejected alternatives:

- *Stable-key mapping on apply* (translate refs by `displayName` at every apply site) — a
  permanent translation layer, and it handles the `chats.resolvedMindspaceId` snapshot
  only awkwardly.
- *Syncing built-ins* (deterministic ids + removing the three engine exclusions) — solves
  the same problem while touching three engine sites for zero gain; mindspace rows carry
  no user-editable fields today.

## 3. Slug scheme and seeding

### 3.1 Ids

Self-describing slugs — entity, provenance, name; no mutable attributes (the palettes are
provisional until Lyra finalises them, and Verdan/Azuro have already been refreshed once
in place — an id encoding a colour would lie after the next refresh):

| displayName | id |
|---|---|
| Crimson | `mindspace-builtin-crimson` |
| Aurum | `mindspace-builtin-aurum` |
| Verdan | `mindspace-builtin-verdan` |
| Azuro | `mindspace-builtin-azuro` |
| Indigaut | `mindspace-builtin-indigaut` |
| Violetta | `mindspace-builtin-violetta` |
| Rosari | `mindspace-builtin-rosari` |

`BUILT_IN_MINDSPACES` (`client-data-db.ts:1485`) gains an `id` per entry and becomes the
single source of truth for the slug↔name mapping (the migration imports it too — no
second copy).

### 3.2 Seeding changes (`seedBuiltinsIfNeeded`, `client-data-db.ts:1495`)

- Missing-built-in detection matches on **`id`** instead of `displayName`; new rows are
  seeded via `buildMindspace(b.id, …)` — the `uuidv7()` call at line 1516 disappears.
- The settings-singleton seed uses the Aurum slug constant directly instead of the
  `where('displayName').equals('Aurum')` query (`client-data-db.ts:1528-1529`); the
  final `?? uuidv7()` fallback becomes the Aurum slug (the row is guaranteed to exist in
  the same transaction).
- The Verdan/Azuro stale-palette refresh keeps its behaviour, keyed by id.

A pleasant side effect: mindspace slugs sort lexicographically with
`mindspace-builtin-aurum` first, so the resolver's `mindspaces[0]` fallback now lands on
the intended default instead of uuid lottery. The resolver itself is untouched.

## 4. Dexie v36 — rekey and cross-table remap

One version bump whose stores clause is unchanged (`mindspaces: 'id, builtIn,
displayName'`); the bump exists only to run the data rewrite, exactly like v35. All work
happens **in the single upgrade transaction** (the v35 lesson: a migration that changes a
row's identity must remap every other store referencing it in the same transaction):

1. **Rekey.** For every `mindspaces` row with `builtIn === true`, look up its slug by
   `displayName` in `BUILT_IN_MINDSPACES`. If the row's id is already the slug → no-op
   (idempotency). Otherwise delete the old row and re-put it under the slug id,
   preserving `texture`, `createdAt` and the rest of the row. A built-in row whose
   `displayName` matches no entry (none exist today) is left untouched. Build an
   `oldId → slug` map over every rekeyed row.
2. **Remap references** using that map; unknown ids (e.g. from historic imports) pass
   through untouched and keep today's fallback behaviour:
   - `settings.defaultMindspaceId` (the singleton row),
   - `personas.mindspaceId` (nullable),
   - `chats.resolvedMindspaceId` (every chat row — a `modify` with the map lookup),
   - `trash` row **snapshots**: for trash entries with `collection === 'personas'` or
     `'chats'`, remap `row.mindspaceId` / `row.resolvedMindspaceId` inside the stored
     snapshot, so restoring from the trashcan does not resurrect a dead uuid reference.
3. **Not remapped, verified as non-referencing:** `outbox` (payload-free, keys only),
   `deadKeys` (collection:key of deleted rows — mindspaces are never deleted), messages
   and all other stores (no mindspace fields).

No re-seal and no MasterKey involvement — mindspace rows and the remapped fields carry no
secrets (unlike v35's `keySlot` decoupling, which this migration does not need).

Duplicate built-ins per name cannot exist locally (seeding is name-keyed), so unlike v35
there is no survivor-picking step.

## 5. Sync stance — deliberately no engine change

- The three built-in exclusions (`backfill.ts:121`, `apply.ts:580`, `recovery.ts:429`)
  **stay**. Their comments (and the §12.5 references) are updated: the rationale is no
  longer "per-device uuids must not sync" but "deterministically seeded identically on
  every device — syncing them would be redundant".
- **No post-migration republish.** Load-bearing assumption, mirrored from the provider
  fix: no real account has pre-migration ciphertext on any server (v0.1.3 is local-only;
  dev sync state is reset before go-live). If the assumption ever proves false for an
  account, the fallback is the same one-shot republish noted in the provider spec
  (enqueue upserts for the remapped rows after boot). Recorded here so the decision is
  conscious, not a drift.
- Transitional note: during a mixed-version window (one device on v36, another still on
  v35) a pulled row can still carry an old uuid — it dangles exactly as today and
  self-heals once the writer migrates and next edits the row. Acceptable; no code.

## 6. Tests

- **Migration (`tests/boot/client-data-db-v36.test.ts`,** following the v35 file's
  shape): rekey of all seven built-ins; remap of all four reference sites (settings,
  personas, chats, trash snapshots); `texture`/`createdAt` preservation; idempotency
  (running against an already-migrated DB is a no-op); unknown-reference passthrough;
  a persona with `mindspaceId: null` stays null.
- **Seeding:** fresh DB seeds the seven slugs; the settings singleton points at
  `mindspace-builtin-aurum`; re-open is a no-op (existing idempotency tests updated to
  assert slug ids).
- **verno sweep:** ~24 hard-coded `expect(db.verno).toBe(35)` assertions across the
  suite (47 `verno` mentions in `tests/`) move to 36 — planned as an explicit task, not
  discovered at the gate.
- Resolver tests are unaffected (pure function, id-agnostic).

## 7. Gates and audits

- `pnpm typecheck --force` 14/14 · user-client vitest at the 8-failure Node-localStorage
  baseline · Biome clean on changed files.
- **Larissa: post-run audit required** (the overnight worker cannot summon her). Not one
  of her four hard directories, but identity-derived ids and sync-convergence semantics
  are squarely her wheelhouse — the same justification as the v35 audit.
- **Laura: consciously skipped** — pure internals; no user-reachable flow, state or
  reachability changes (Liz's judgement call per CLAUDE.md §9.2).

## 8. Manual verification (Chris, after merge)

1. **Existing device upgrade:** open the app on a device with existing data — the
   selected default/persona mindspaces look identical before and after (palette, texture,
   picker selection state).
2. **Convergence:** device A sets a built-in as account default and as a persona's
   mindspace → after sync, device B shows the same selections (previously: silent
   fallback to an arbitrary first row).
3. **Chat palette:** a chat created on device A renders on device B with A's mindspace
   palette (previously: fallback palette).
4. **Trash restore:** delete a persona on a migrated device, restore it from the
   trashcan — its mindspace binding survives.

## 9. Execution

Overnight remote run (claude.ai worker) from a hardened plan + kickoff prompt — plan
under `superpowers/plans/`, hardened via the overnight-implementation contract. Dexie
**v36 ownership is confirmed free** (no in-flight branch touches
`boot/client-data-db.ts`; verified against `origin/claude/pre-test-analysis-open-items-6s118y`
on 2026-07-07). Post-run: Larissa audit, Chris reviews + merges, manual verification
above.
