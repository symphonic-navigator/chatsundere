# Design — Tombstone throttle + universal trashcan (v2)

**Status:** v2 — Laura + Larissa spec-pass folded in; awaiting Chris's spec review, then the implementation plan.
**Branch context:** `worktree-sync-lifecycle` (Full Backend Transition sprint)
**Supersedes:** the §7.3a panic-pause mechanism in `2026-07-02-ws-c-sync-engine-design.md`
**v2 changes:** reconciled the trash-card grouping vs dependency-gate contradiction (Laura HARD-1); added delete-time transparency + an immediate permanent-delete (Laura HARD-2 + Larissa M-C, Chris: offer permanent delete); made the H-1 anchor durable via a dead-key marker (Larissa M-A); added encrypted `restoredFrom` cross-device restore de-dup (Larissa M-B, Chris: build coordination); pinned the throttle page-loop break + `rev ≤ since` guard + single-transaction restore + purge-no-outbox constraints (Larissa L-A/L-B/I-3/I-4); aligned defer-tombstones-only (Larissa I-1).

---

## 1. Motivation

Two coupled problems surfaced from Chris's two-browser sync test.

1. **Deferred-tombstone loss at the panic pause.** When a pull cycle would apply
   more than the panic threshold (200) of pulled tombstones, the engine defers
   the rest — but `runPullLoop` still advances the watermark past the deferred
   records (`highestRev` counts every record, applied or not: `worker.ts:918-924`).
   The deferred tombstones are **neither applied nor ever re-pulled**: the local
   rows stay live forever, diverge permanently from the server, and can never
   re-sync. The pause silently drops data.

2. **"Recoverable for 30 days" is an unkept promise.** Pulled tombstones route the
   local row into `db.trash` with a 30-day grace, but **nothing reads `db.trash`** —
   no surface to see, restore, or purge. The reassurance is aspirational.

Chris's brainstorm decisions (2026-07-04): replace the panic pause with a
**throttle** (rate-limit, never drop); build a **universal trashcan** (the user's
own deletions become 30-day-recoverable too); ship both in one spec; restore all
descendants when a parent is restored; offer an immediate permanent-delete at
delete time; build lightweight cross-device restore de-dup.

---

## 2. Part 1 — Tombstone throttle

### 2.1 What is removed

The panic-pause machinery is deleted end-to-end: `apply.ts` `TOMBSTONE_PANIC`,
the `tombstonePaused` flag, the `{ kind: 'tombstone-paused' }` outcome, the
`setAttention({ kind: 'tombstone_paused' })` raise; the `tombstone_paused` kind in
`shared-types` `SyncAttention`; `copy.ts` `attention.tombstonePaused`;
`SyncStatusLine.tsx` its case; and the now-dead `tombstone_paused` branch/comment
in `settleTombstoneNotice`.

The **`tombstone_threshold` calm notice (≥20 applied per cycle) stays** — the
visibility half of the Larissa M-2 mitigation — and still auto-clears on a calm
cycle (existing `settleTombstoneNotice`).

### 2.2 The throttle

`runPullLoop` caps the number of tombstones **applied** per cycle at
`TOMBSTONE_CYCLE_CAP` (rename of the former panic constant; default 200) and
spreads a large removal across cycles without losing one.

**Only tombstones defer; upserts always apply** (Larissa I-1 — an upsert
interleaved with a same-key deferred tombstone is a malicious-server signal that
H-1 catches on the next cycle regardless). Records arrive rev-ordered but ordering
is NOT trusted (M-7). Ignore any pulled record with `rev ≤ sinceRev` at ingest —
an honest server never sends them, and this closes the below-watermark edge
(Larissa L-B). Per-cycle apply loop over one page:

```
let applied = 0
let lowestDeferredRev = null
for (const record of page.records) {
  if (record.rev <= sinceRev) continue                 // L-B: honest servers never send these
  if (record.deleted && applied >= TOMBSTONE_CYCLE_CAP) {
    lowestDeferredRev = min(lowestDeferredRev ?? ∞, record.rev)
    continue                                           // defer THIS tombstone; keep scanning the page
  }
  await applyRecord(record)                            // upserts + under-cap tombstones apply
  if (record.deleted) applied += 1
}
```

**Watermark rule (M-7-preserving — the load-bearing correctness point):** if
anything was deferred, advance to `lowestDeferredRev − 1`; else to the page's
highest applied rev. Always via `advanceWatermark` (clamped monotone, never
regresses). A deferred low-rev tombstone holds the watermark below itself,
forcing a re-pull next cycle; applied records above it are re-pulled and
re-applied next cycle — harmless, apply is idempotent (§7.0 echo / rev check).
Larissa confirmed a malicious server cannot craft an ordering that permanently
skips a returned record.

**Page-loop break (Larissa L-A — mandatory):** once `applied` reaches
`TOMBSTONE_CYCLE_CAP`, finish processing the *current* page (apply its upserts,
tally `lowestDeferredRev` over its remaining tombstones) and then **stop paging
for this cycle** — do NOT fetch the next page. Without this, the next page fetch
uses `since = lowestDeferredRev − 1`, re-returns the same records, defers them all
again (cap already reached), and busy-refetches up to `PULL_PAGE_CAP` (64) times
applying nothing. The removal resumes on the next sync trigger. This also answers
"can a malicious server pin the client": each cycle is cap-bounded and stops.

### 2.3 Interaction with the notice

`tombstone_threshold` is still raised inside `applyTombstone` (counting applied
tombstones). During a multi-cycle throttled drain each cycle applies ≤ cap and
keeps the count ≥ 20, so the notice stays up; when the removal finishes and a
cycle applies < 20, `settleTombstoneNotice` retires it. No new state.

---

## 3. Part 2 — Universal trashcan

### 3.1 Scope

Trashable (delete routes to `db.trash`; restore + purge available) — the four
**user-facing** families:

| Root entity | Children (cascade) |
|---|---|
| **Persona** | its **Chats** (`chat.personaId`) → each chat's Messages / Pills / CompactionCheckpoints; its **Memories** (`memoryJournal.personaId`, `memoryBody.personaId`) |
| **Library** | its **Documents** (`document.libraryId`) |

Everything else (`settings`, `providers`, `mcpServers`, `mindspaces`,
`seedTemplates`, `vectors`, …) keeps **hard-delete** — internal/technical rows.

### 3.2 Dependency graph + card grouping (Laura HARD-1, reconciled)

Two trees:

```
Persona ─┬─ Chat ── (Message | Pill | CompactionCheckpoint)
         └─ Memory (memoryJournal + memoryBody)
Library ─── Document
```

The dependency rule ("a child cannot be restored while its parent is gone") is
enforced **structurally by the card grouping**, not by a disabled button:

- The surface shows **one card per restore-unit**, where a restore-unit is the
  **highest trashed ancestor**. A trashed child whose parent is **live** is its
  own top-level card (Restore enabled). A trashed child whose parent is **also
  trashed folds INTO the parent's card** as a summarised count ("512 items") and
  has **no independent Restore control**.
- Restore is all-or-nothing per card (Chris: restoring a parent restores its
  whole trashed subtree). So there is no per-child Restore to gate, and no
  "Restore its persona first" disabled-tooltip — the child simply isn't an
  independent actionable unit while its parent is trashed. This satisfies Chris's
  rule (delete chat → delete persona → the chat can't be restored alone; it
  returns with the persona) and is ND-calmer (one action per card).
- **Inline-reason rule (Laura HARD-3):** should any disabled affordance appear on
  this surface in future (e.g. Restore blocked mid-sync), its reason renders as
  visible inline helper text, never a hover-only `title` (invisible on 380 px
  touch — the house `NavTile` pattern's gap). No disabled Restore ships in v1.

### 3.3 Trash data model

`db.trash` rows gain grouping metadata; a **separate durable dead-key store** is
added for H-1 (§3.9). New Dexie version (§3.8).

```ts
interface TrashRow {
  id: string;                    // `${collection}:${key}` (PK, unchanged)
  collection: SyncCollection;
  key: string;
  row: unknown;                  // full plaintext snapshot (unchanged)
  deletedAt: number;
  purgeAt: number;               // deletedAt + 30 days (unchanged)
  // NEW:
  entityKind: 'persona' | 'chat' | 'memory' | 'library' | 'document' | 'chatChild';
  rootGroup: string;             // the card this row displays under: `persona:<id>` | `library:<id>`
  parentRef: { field: string; id: string } | null; // e.g. {field:'personaId', id:<originalId>}
}
```

- **Card = one `rootGroup` whose root entity is itself trashed**; a child whose
  parent is live is its own card (its `rootGroup` root is not in trash). Cascade
  grandchildren (`chatChild`) never render as their own cards.
- `parentRef` records the **original** parent id, so restore remaps onto the
  parent's new id (§3.5).

### 3.4 Delete flow (local, the four families) + delete-time transparency

Today a local delete hard-removes the row and enqueues a sync `delete` (+cascade).
New behaviour:

The delete affordance offers **two paths** (Chris — the anti-surveillance duress
case gets a one-step escape):

- **Delete (default, recoverable):** snapshot the row **and its exact cascade
  descendant set** (§I-2 build constraint — must equal the set `mutateSynced`
  cascade-deletes, `enqueue.ts:191-192`) into `db.trash` with §3.3 metadata,
  remove the rows from live tables, and enqueue the sync `delete` (+cascade) —
  **the deletion still propagates promptly**; each peer device routes the incoming
  tombstones into its own trash. All in one transaction. The dead-key marker is
  written at **ack**, not here (§3.9).
- **Delete permanently (opt-in):** hard-delete (no trash snapshot), enqueue the
  sync `delete` (+cascade); the dead-key marker is written at ack. No local
  plaintext retention.

**Delete-time signal (Laura HARD-2 + Larissa M-C — mandatory).** A default
recoverable delete surfaces a brief calm confirmation the moment it happens:
> "Moved to Recently deleted · recoverable for 30 days" — with **Undo** and a
> secondary **Delete permanently** action.

This closes three gaps at once: discoverability of the whole safety net, the
astonishment/trust risk of silently retaining "deleted" data (locally *and* on
every peer for 30 days — Larissa M-C), and the *dere* moment the delete flow was
missing.

**Undo — two modes, identity-preserving when possible.** If the sync `delete` has
**not yet drained** (its outbox entries are all still queued — the common case,
Undo tapped seconds after an accidental delete), Undo does a **fast in-place
restore**: cancel the queued delete (+cascade), restore the rows with their
**original ids** (no dead-key marker was written yet — §3.9), one transaction.
This preserves identity, so live back-references stay valid and the §3.5
limitation does not bite. If the delete **has** drained (death is
server-confirmed, dead-key marker written), Undo falls back to the §3.5
new-identity restore.

### 3.5 Restore (the technical core)

Restore is a recursive, id-remapping re-materialisation, forced by **H-1**: an
upsert on a tombstoned blindId trips the tamper alarm, so a restored entity must
be a **new identity**; the old blindId stays dead (and its dead-key marker
persists — §3.9).

**`restore(card)` — restores the card's root and every trashed descendant, in a
SINGLE Dexie rw transaction (Larissa I-4)** spanning `db.trash`, every affected
live table, and `syncOutbox` (this serialises restore against a concurrent
`applyTombstone`/`purgeTrash` and makes the H-1/pull race benign):

1. Collect the root + all trashed descendants (persona → its trashed chats, their
   messages/pills/checkpoints, its memories; chat → its cascade children; library
   → its documents).
2. Mint a fresh id for every collected entity; build an `oldId → newId` remap.
3. Rewrite each row: own id → new; `parentRef` field → the parent's new id **if
   the parent is in the collected set**, else the parent's existing **live** id
   (how a child restores under a live parent). Cross-tree refs (message `kbRef →
   {libraryId, documentId}`) remap if the target is in the set, keep if live,
   else dangle→fallback. Embed the encrypted **`restoredFrom` provenance marker**
   (§3.7) carrying the entity's *original* key.
4. Write the re-keyed rows into their live tables; enqueue fresh sync **upserts**;
   delete the `db.trash` entries (but NOT the dead-key markers — §3.9). One
   transaction.

**Copy (Laura soft):** primary "Restored." with a quieter "(as a fresh copy)"
secondary — reassurance first.

**Known v1 limitation (Laura soft — flag, defer to `ux-deferrals.md`):** a *live*
chat that referenced persona P keeps pointing at the dead P after P is
restored-as-P′, falling back to the default persona display. Only trashed
descendants are remapped, not live back-references. The mainstream flow (delete
persona → restore persona restores its own chats) is clean; only cross-tree /
cross-device edges bite. The persona-restore confirmation hints that already-open
chats may show the default companion until reopened. Auto-repair of live
back-references is v-next.

### 3.6 Purge ("delete now completely")

- **Cascades down**: purging a persona card purges its trashed chats (+messages)
  and memories; a chat card purges its messages/pills/checkpoints; a library
  purges its documents. Otherwise orphaned descendants become permanently
  unrestorable clutter.
- **Local-only** — the server already holds the tombstone. Purge deletes
  **`db.trash` snapshot rows and NOTHING else** — in particular it must **NOT
  sweep `syncOutbox`** (Larissa I-3: clearing a not-yet-drained local delete would
  strand it and diverge cross-device). The **dead-key markers persist** (§3.9).
- **Confirm names the cascade with concrete counts (Laura soft):** "Permanently
  delete this persona and its 3 chats and 12 memories? This cannot be undone."
- The existing 30-day auto-purge (`purgeTrash`) continues (each row's own
  `purgeAt`), and likewise leaves the dead-key markers intact.

### 3.7 Cross-device restore de-dup (`restoredFrom` — Larissa M-B, Chris: build it)

A restore is deliberately unlinkable at the server (new blindId), so peers cannot
auto-correlate P′ with the deleted P. Lightweight coordination, zero-knowledge
preserved:

- Each restored entity embeds a **`restoredFrom: <originalKey>`** field **inside
  its sealed payload** (client-side, before encryption) — the server never sees
  it (no linkage, no plaintext leak; Larissa I-5 correlation is only the same
  timing/size any create exposes).
- On apply of a pulled upsert whose decrypted payload carries `restoredFrom = K`,
  if the device holds a matching **`db.trash` entry keyed by `collection:K`**, it
  **retires that trash entry** (removes the card) — best-effort dedup: device B
  no longer offers to restore something A already restored.
- **Bounded, not perfect** (acknowledged): two devices restoring the same item
  *before* either pulls the other's restore still yields two live copies
  (inherent to concurrent restore). The marker retires the trash card so the
  common sequential case (A restores; B later opens trash) shows it already
  handled. Duplicates remain user-resolvable (delete one).

### 3.8 Surface

The trashcan is a **place** → a dedicated navigable surface, not an overlay.

**Placement (Laura soft → adopted):** **My Account**, a tile adjacent to
**"Recovery Key"** (data-recovery belongs with data-recovery, not with
behaviour-tuning Settings). Label "Recently deleted", meta "restore or purge · 30
days". Turns the account matrix from 2×3 into 2×4 — a deliberate layout call for
Laura's build-time re-glance.

The surface lists **cards** (one per §3.3 group): entity kind, title, and counts
that scope both actions ("Fable · 3 chats · 12 memories · deleted 2 days ago").
Per card: **Restore** and **Delete now** (confirm per §3.6). Empty state: a calm
"Nothing here — deleted items rest here for 30 days before they're gone." No
sidebar; mobile-first at 380 px; opulent user-facing styling.

### 3.9 Durable H-1 dead-key anchor (Larissa M-A)

**Problem:** today the *only* H-1 anchor is the trash row (`apply.ts:560-567`
reads `db.trash.get(\`${collection}:${key}\`)`). Restore and purge both delete
that row; the 30-day auto-purge already erodes it. Once gone, an upsert on the old
key finds no anchor → `applyUpsert` **inserts** → a malicious server that retained
the old ciphertext replays it as a live duplicate. This defeats the H-1 invariant
the design leans on.

**Fix:** decouple the terminal anchor from the recoverable snapshot. A new tiny,
**durable** store records dead keys:

```ts
interface DeadKeyRow { id: string; /* `${collection}:${key}` */ collection: SyncCollection; key: string; diedAt: number; }
// Dexie table: deadKeys: 'id, collection'
```

- Written when a key's death becomes **server-authoritative**, NOT at local
  enqueue time: (a) a pulled tombstone is applied, or (b) a local delete (default
  or permanent) is **acked** by the server (in the drain's `applyOk`/`tombstoned`
  path). Writing it at ack — not at local delete — is what lets fast-Undo before
  drain cancel cleanly and restore the original identity (§3.4); before ack, a
  malicious upsert is just an ordinary insert (the server has not been told the
  key died), so H-1 has nothing to protect yet.
- **Survives** purge, restore, and the 30-day auto-purge — the *snapshot* (trash
  `row` plaintext) is what those free; the marker is permanent.
- **H-1 reads `deadKeys`, not the trash snapshot.** `applyUpsert`'s
  `local === undefined` branch raises the tamper alarm iff `deadKeys` holds the
  key. This makes H-1 durable for the first time (a strict improvement over the
  pre-existing 30-day erosion).
- A restored entity uses a **new** key → not in `deadKeys` → syncs cleanly. The
  old key stays in `deadKeys` forever → can never be resurrected.
- Growth: one small row per dead key ever. Acceptable; a future bound (e.g. prune
  markers older than the server's retention proof) is out of scope and noted.

### 3.10 Dexie version (§3.8 schema + dead-key store)

One new Dexie version adds: the three `TrashRow` fields (+ an index on
`rootGroup`/`entityKind` for grouped queries), the `deadKeys` store, and the
`restoredFrom` field lives inside entity payloads (no schema change for it).
Collides with the parallel-worktree Dexie-ownership rule
([[project_parallel_feature_dexie_version_ownership]]) and the
`expect(db.verno).toBe(N)` sweep ([[project_dexie_bump_breaks_verno_assertions]])
— the plan owns exactly one new version number and folds the verno sweep into the
bump task.

**Upgrade backfill (Larissa L-C):** for existing trash rows, derive `parentRef`
from the snapshot's own foreign key (`chat.personaId`, `document.libraryId`,
`message.chatId`) and set `rootGroup` accordingly whenever present; only fall back
to an ungrouped top-level card when the ref is genuinely absent (bounded,
non-destructive under-enforcement of the gate for truly field-less legacy rows —
stated, accepted). Seed `deadKeys` from the existing trash rows' keys on upgrade.

---

## 4. Build constraints (pinned from Larissa's spec-pass)

- **I-2 cascade snapshot completeness:** the delete snapshot must capture the
  exact descendant set `mutateSynced` cascade-deletes; any sync-deleted-but-not-
  snapshotted descendant is unrecoverable.
- **I-3 purge/auto-purge must not touch `syncOutbox`** — only `db.trash` (never
  the dead-key markers).
- **I-4 restore is a single Dexie rw transaction** over `db.trash`, live tables,
  and `syncOutbox`.
- **L-A throttle breaks the page loop at the cap**; **L-B ignores `rev ≤ since`**.
- **I-5 correlation note (accepted):** restore is observable to the server as
  "tombstone then a similar-sized fresh-blindId upsert" — the same timing/size
  metadata any create exposes; no linkage, no plaintext.

---

## 5. Testing

- **Throttle:** > cap tombstones → exactly cap applied, watermark held at
  `lowestDeferredRev − 1`, page loop stops, next cycle drains the rest; nothing
  lost, none double-destroyed; adversarial ordering does not skip a deferred
  low-rev tombstone; `rev ≤ since` records ignored.
- **Delete → trash / permanent:** each family's default delete snapshots the exact
  cascade set + writes dead-key markers + enqueues the sync delete; permanent
  delete writes markers + enqueues delete with no snapshot.
- **Dead-key H-1 durability:** after restore AND after purge, an upsert on the old
  key still raises the tamper alarm (deadKeys survives).
- **Card grouping:** child under a trashed parent folds into the parent card (no
  own Restore); child under a live parent is its own card.
- **Restore remap:** persona restore re-materialises the subtree with fresh ids,
  parent refs remapped, upserts enqueued, trash cleared, dead-keys retained, in
  one transaction; restored child attaches to a live parent's id.
- **Cross-device de-dup:** applying a pulled upsert with `restoredFrom = K`
  retires the local `trash[collection:K]` card.
- **Purge cascade:** purging a persona removes all trashed descendants; leaves
  `syncOutbox` and `deadKeys` untouched.

## 6. Audit gates

- **Larissa (pre-squash):** the dead-key H-1 durability, the `restoredFrom`
  zero-knowledge boundary (marker stays inside the seal), the single-transaction
  restore race, the throttle page-loop/`rev ≤ since` guards, purge-no-outbox.
- **Laura (pre-squash):** the built "Recently deleted" surface + the delete-time
  toast/undo/permanent-delete flow honour the approved intent.

## 7. Deferrals

- **`ux-deferrals.md`:** live-back-reference fallback on persona restore (§3.5);
  auto-repair is v-next.
- **`security-deferrals.md`:** the `deadKeys` unbounded-growth note (§3.9) — a
  retention bound is deferred, not required for correctness; the bounded
  concurrent-restore duplicate window (§3.7).

## 8. Manual verification (Chris, on device)

1. Delete a chat (persona live) → toast with Undo → Recently deleted → Restore →
   chat back (new id), messages intact, syncs to the other device.
2. Delete a chat, then its persona → the chat has no own card (folded under the
   persona); restore the persona → persona + chat + messages return, one action.
3. Delete → "Delete permanently" → no trash entry, no local plaintext, delete
   still propagates.
4. Cross-device mass delete (> cap) → the other browser drains it over several
   cycles, no stuck banner, nothing lost; removed items appear in its trash.
5. Restore on device A → device B's matching trash card disappears after B pulls.
6. Delete now on a persona → it and all descendants vanish from trash; a later
   malicious replay of the old ciphertext still trips the tamper alarm (dead-key).
7. Delete a document → Recently deleted → Restore under its live library.
