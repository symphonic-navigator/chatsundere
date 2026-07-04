# Design — Tombstone throttle + universal trashcan

**Status:** draft (brainstormed with Chris 2026-07-04; awaiting his spec review, then Laura + Larissa spec-pass)
**Branch context:** `worktree-sync-lifecycle` (Full Backend Transition sprint)
**Supersedes:** the §7.3a panic-pause mechanism in `2026-07-02-ws-c-sync-engine-design.md`

---

## 1. Motivation

Two coupled problems surfaced from Chris's two-browser sync test.

1. **Deferred-tombstone loss at the panic pause.** When a pull cycle would apply
   more than the panic threshold (200) of pulled tombstones, the engine defers
   the rest (`{ kind: 'tombstone-paused' }`) — but `runPullLoop` still advances
   the watermark past the deferred records (`highestRev` counts every record,
   applied or not). The deferred tombstones are therefore **neither applied nor
   ever re-pulled**: the local rows stay live forever, diverge permanently from
   the server, and can never re-sync (an edit re-push hits the server tombstone).
   The panic pause never actually spans cycles — it silently drops data.

2. **"Recoverable for 30 days" is an unkept promise.** Pulled tombstones route
   the local row into `db.trash` with a 30-day grace, but **nothing reads
   `db.trash`** — there is no user-facing surface to see, restore, or purge
   deleted items. The reassurance in the tombstone notice is aspirational.

Chris's decisions in brainstorming (2026-07-04):
- Replace the hard panic pause with a **throttle** (rate-limit application, never
  drop) — the trashcan is the real safety net, so the pause is redundant.
- Build a **universal trashcan**: the user's *own* deletions also become
  30-day-recoverable, not just remote ones.
- Ship both in **one combined spec**.

---

## 2. Part 1 — Tombstone throttle

### 2.1 What is removed

The panic-pause machinery is deleted end-to-end:
- `apply.ts`: `TOMBSTONE_PANIC`, the `tombstonePaused` flag, the
  `{ kind: 'tombstone-paused' }` outcome, and the `setAttention({ kind:
  'tombstone_paused' })` raise.
- `shared-types` `SyncAttention`: the `tombstone_paused` kind is removed.
- `copy.ts`: `attention.tombstonePaused`.
- `SyncStatusLine.tsx`: the `tombstone_paused` case.
- `watermark.ts` / earlier work: the `tombstone_paused` branch in
  `settleTombstoneNotice` (already `tombstone_threshold`-only, so this is just
  dropping the now-dead comment about the sticky paused alarm).

The **`tombstone_threshold` calm notice (≥20 per cycle) stays** — it is the
visibility half of the Larissa M-2 mitigation and still auto-clears on a calm
cycle (existing `settleTombstoneNotice`).

### 2.2 The throttle

`runPullLoop` caps the number of tombstones **applied** per cycle at
`TOMBSTONE_CYCLE_CAP` (rename of the former panic constant; default 200) and
spreads a large removal across cycles without ever losing one.

Per-cycle apply loop (records arrive rev-ordered ascending, but ordering is NOT
trusted — Larissa M-7):

```
let applied = 0
let lowestDeferredRev = null
for (const record of page.records) {
  if (record.deleted && applied >= TOMBSTONE_CYCLE_CAP) {
    lowestDeferredRev = min(lowestDeferredRev ?? ∞, record.rev)
    continue            // defer this record; keep scanning to find the true minimum deferred rev
  }
  await applyRecord(record)
  if (record.deleted) applied += 1
}
```

**Watermark rule (M-7-preserving, the load-bearing correctness point):** advance
the watermark to `min(lowestDeferredRev) − 1` when anything was deferred, else to
the page's highest rev — clamped monotone via `advanceWatermark` (never
regresses). This guarantees **no un-applied record is ever skipped**, even under
adversarial page ordering: a deferred low-rev tombstone holds the watermark below
itself, forcing a re-pull next cycle. Applied records with a rev above the lowest
deferred rev are re-pulled and re-applied next cycle — harmless, because apply is
idempotent (the §7.0 echo shortcut / rev check absorbs the repeat).

`more` stays effectively `true` while anything was deferred (a deferral means the
cycle did not fully consume the server head), so the next cycle continues from
the held watermark. A 10 000-item removal drains over ~50 cycles into the trash.

> Note: this deliberately drops the old spec's "upserts continue during the
> pause" nuance — once the cap trips, the remainder of the page (including any
> interspersed upserts after the break point) defers to the next cycle. Simpler
> and monotone-safe; the one-cycle delay on those upserts is immaterial.

### 2.3 Interaction with the notice

`tombstone_threshold` is still raised inside `applyTombstone` (counting applied
tombstones). During a multi-cycle throttled drain each cycle applies ≤ cap and
keeps the count ≥ 20, so the notice stays up; when the removal finishes and a
cycle applies < 20, `settleTombstoneNotice` retires it. No new state needed.

---

## 3. Part 2 — Universal trashcan

### 3.1 Scope

Trashable (deletion routes to `db.trash`, restore + purge available) — the four
**user-facing** entity families the user consciously deletes:

| Root entity | Children (cascade) |
|---|---|
| **Persona** | its **Chats** (`chat.personaId`) → each chat's Messages / Pills / CompactionCheckpoints; its **Memories** (`memoryJournal.personaId`, `memoryBody.personaId`) |
| **Library** | its **Documents** (`document.libraryId`) |

Everything else (`settings`, `providers`, `mcpServers`, `mindspaces`,
`seedTemplates`, `vectors`, …) keeps **hard-delete** semantics — internal/technical
rows the user does not "delete and want back".

### 3.2 Dependency graph (the integrity rule)

Two trees:

```
Persona ─┬─ Chat ── (Message | Pill | CompactionCheckpoint)
         └─ Memory (memoryJournal + memoryBody)
Library ─── Document
```

**A trashed child is individually restorable only while its parent is LIVE.** If
the parent is also in the trash, the child's Restore is **disabled** (Chatsundere
"disabled over hidden": greyed out + tooltip *"Restore its persona first"*). This
enforces Chris's rule: delete a chat, then delete its persona → the chat cannot
be restored alone; the persona must come back first (and does so with its
children — §3.5).

### 3.3 Trash data model

`db.trash` rows gain grouping + hierarchy metadata (new Dexie version — see §3.8):

```ts
interface TrashRow {
  id: string;                    // `${collection}:${key}` (unchanged PK)
  collection: SyncCollection;
  key: string;
  row: unknown;                  // full snapshot (unchanged)
  deletedAt: number;
  purgeAt: number;               // deletedAt + 30 days (unchanged)
  // NEW:
  entityKind: 'persona' | 'chat' | 'memory' | 'library' | 'document'
            | 'chatChild';       // messages/pills/checkpoints ride their chat
  rootGroup: string;             // the trash card this row displays under:
                                 //   persona → `persona:<id>`, library → `library:<id>`
  parentRef: { field: string; id: string } | null; // e.g. {field:'personaId', id:<oldPersonaId>}
}
```

- **Grouping for display:** the surface shows **one card per `rootGroup`** whose
  root entity is itself trashed; a child whose parent is *live* is its own
  top-level card (its `rootGroup` root is not in trash). Cascade grandchildren
  (messages etc.) never render as their own cards — they are summarised on the
  chat card ("512 items").
- `parentRef` records the **original** parent id at deletion time, so restore can
  remap onto the parent's new id (§3.5).

### 3.4 Delete flow (local, the four families)

Today a local delete hard-removes the row and enqueues a sync `delete` (+cascade).
New behaviour for the four families:

1. Snapshot the row (+ its cascade descendants) into `db.trash` with the §3.3
   metadata, in the **same transaction** as the removal.
2. Remove the row from its live table (as today).
3. Enqueue the sync `delete` (+cascade) exactly as today — **the deletion still
   propagates promptly** to other devices; each device routes the incoming
   tombstone into its own trash (grouped by `rootGroup`, which every child can
   compute from its own parent ref).

So "delete" is unchanged on the wire; only the local disposition changes from
hard-delete to trash. Remote devices already route pulled tombstones to trash
(existing `applyTombstone`) — they gain the §3.3 grouping metadata.

### 3.5 Restore (the technical core)

Restore is a recursive, id-remapping re-materialisation, forced by **H-1
(non-negotiable):** an upsert on a blindId the server has tombstoned raises a
tamper alarm on every device that holds it in trash. So a restored entity must be
a **new identity**; the old blindId stays dead.

**`restore(entry)` — restores `entry` and every trashed descendant in one pass:**

1. Collect `entry` + all trashed rows whose `rootGroup`/parent chain descends from
   it (for a persona: its trashed chats, their messages/pills/checkpoints, its
   memories; for a chat: its messages/pills/checkpoints; for a library: its
   documents).
2. Mint a fresh id for every collected entity; build an `oldId → newId` remap.
3. Rewrite each row: its own id → new; its `parentRef` field → the parent's new
   id **if the parent is in the collected set**, otherwise the parent's existing
   **live** id (this is how a child restored under a live parent re-attaches).
   Cross-tree references (e.g. a message `kbRef → {libraryId, documentId}`) are
   remapped if the target is in the set, kept if the target is live, or left to
   dangle→fallback if the target is trashed-and-not-restored.
4. Write the re-keyed rows into their live tables; enqueue fresh sync **upserts**
   for all of them; delete the entries from `db.trash` — all in one transaction.

Because restoring a root pulls its whole trashed subtree (Chris's "restore
everything under it" choice), there is a single remap pass and no cross-action
remap bookkeeping. A child with a live parent restores just its own subtree onto
the existing parent id.

**UX copy:** restore confirms "Restored as a new copy" (the *dere* framing — it
came back, honestly labelled). The old-identity-stays-dead fact is not surfaced
as an error; it is simply how restore works.

**Known v1 limitation (flag for Chris/Laura):** an entity referenced by a *live*
sibling tree loses that back-reference on restore. Concretely: a live chat that
pointed at persona P (`chat.personaId = P`); P is deleted then restored as P′; the
live chat still points at the dead P and falls back to the default persona
display. Restoring the persona does **not** repair live children that reference
the old id — only trashed descendants are remapped. Acceptable for v1; auto-repair
of live back-references is a future extension.

### 3.6 Purge ("delete now completely")

- Purging a trash card **cascades down**: purging a persona card purges its
  trashed chats (+their messages) and memories; purging a chat card purges its
  messages/pills/checkpoints; purging a library purges its documents. Otherwise
  orphaned descendants would be permanently unrestorable clutter.
- Purge is **local-only** — the server already holds the tombstone, so this just
  frees local storage. No sync op.
- The existing 30-day auto-purge (`purgeTrash`, `purgeAt`) continues; it must also
  respect the cascade (purging a root at expiry purges its descendants) — in
  practice each row has its own `purgeAt`, so they expire together within a tick.

### 3.7 Surface

The trashcan is a **place** (you navigate to it, browse, act), so it is a
dedicated navigable surface, not a transient overlay (per Chris's
surfaces-are-for-places / overlays-are-for-operations principle).

**Proposed placement (Laura spec-passes this):** reachable from the account /
settings area as **"Recently deleted"**. The surface lists trash **cards** (one
per §3.3 group), each showing entity kind, title, item count, deleted-when, and —
where relevant — its parent-state. Per card: **Restore** (disabled with tooltip
when the parent is trashed) and **Delete now** (with a confirm, since purge is the
one irreversible action in the whole feature). Empty state: a calm "Nothing here —
deleted items rest here for 30 days before they're gone."

No sidebar (§CLAUDE.md); mobile-first at 380 px; opulent user-facing styling.

### 3.8 Dexie version

Adding the three `TrashRow` fields + any new index (e.g. `rootGroup`, `entityKind`
for grouped queries) is a schema change → a new Dexie version bump. This
collides with the parallel-worktree Dexie-ownership rule
([[project_parallel_feature_dexie_version_ownership]]) and the
`expect(db.verno).toBe(N)` test sweep
([[project_dexie_bump_breaks_verno_assertions]]) — the plan must own exactly one
new version number and fold the verno-assertion sweep into the bump task.

Existing trash rows (pre-bump) lack the new fields; the version's `upgrade`
backfills them from the row's own parent references (a `chat` row knows its
`personaId`, so `rootGroup`/`parentRef` are derivable) or, failing that, treats
them as ungrouped top-level cards.

---

## 4. Testing

- **Throttle (Part 1):** a cycle pulling > cap tombstones applies exactly cap,
  holds the watermark at `lowestDeferredRev − 1`, and the next cycle applies the
  remainder — **no tombstone lost, none double-destroyed** (idempotent re-apply).
  Adversarially-ordered page: a low-rev deferred tombstone must not be skipped.
- **Delete → trash:** deleting each of the four families snapshots the row
  (+cascade) into `db.trash` with correct `entityKind`/`rootGroup`/`parentRef`,
  removes it from the live table, and still enqueues the sync delete (+cascade).
- **Dependency gate:** a trashed chat under a trashed persona reports
  restore-disabled; under a live persona, restore-enabled.
- **Restore remap:** restoring a persona re-materialises persona + chats +
  messages + memories with fresh ids, all parent refs remapped consistently, sync
  upserts enqueued, trash entries cleared. A restored chat under a live persona
  attaches to the live persona id.
- **Purge cascade:** purging a persona removes all its trashed descendants; no
  orphans remain.
- **H-1 safety:** a restored (new-id) entity never re-pushes a tombstoned blindId
  (assert the enqueued upserts carry fresh keys).

## 5. Audit gates

- **Larissa (spec-pass + pre-squash):** sync integrity — the M-7 watermark rule
  under adversarial ordering, H-1 preservation on restore (no resurrection of a
  tombstoned blindId), the delete-still-propagates invariant, and that the
  throttle cannot be driven into a stall or a skip by a malicious server.
- **Laura (spec-pass):** the "Recently deleted" surface — placement/reachability,
  the disabled-restore affordance + tooltip, the destructive-purge confirm, empty
  state, and the "Restored as a new copy" framing.

## 6. Manual verification (Chris, on device)

1. Delete a chat (persona live) → appears in Recently deleted → Restore → the
   chat is back (new id), messages intact, syncs to the other device.
2. Delete a chat, then its persona → the chat's Restore is disabled; restore the
   persona → persona + chat + messages all return, one action.
3. Cross-device mass delete (> cap) → the other browser drains it over several
   cycles with no stuck banner and nothing lost; all removed items appear in its
   trash.
4. Delete now on a persona → it and all its descendants vanish from trash; 30-day
   grace no longer applies.
5. Delete a document → Recently deleted → Restore under its live library.
