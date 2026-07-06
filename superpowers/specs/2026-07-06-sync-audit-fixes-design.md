# Sync Audit Fixes — Design Spec

**Date:** 2026-07-06
**Status:** Draft for Chris's review → overnight remote execution
**Provenance:** Four-package adversarial protocol/functional audit of the client
sync engine (2026-07-06, this session). All eight severe findings were
independently verified at code level before this spec was written.
**Branch target:** every PR merges into `full-backend-transition`.
**Dexie:** **no version bump needed** — every new field in this spec is
unindexed (Dexie requires bumps only for store/index changes). Version 34
remains the tip; parallel feature work may claim v35 freely.

---

## 1. Problem statement

The 2026-07-06 audit confirmed the steady-state engine (ack/CAS, watermark
monotonicity, tombstone throttle, wire contract, blob transport/crypto) is
sound, but found one CRITICAL and seven HIGH defects concentrated in two
structural roots:

- **Root A — the watermark advances past records that were not durably
  absorbed.** Three findings (#1, #3, #5) are instances: an engine-availability
  failure (`!mk`) is paged over like a poison record; a suppressed upsert's rev
  is skipped with no CAS base recorded; recovery's cleared `syncRows` makes the
  drain drop pending tombstones.
- **Root B — transitions (recovery, relink, restore) violate premises the
  steady-state guards rely on.** The L-4 "server never knew this row" guard,
  the H-1 dead-key anchor, blind-id resolution, and the ack write path all
  assume `syncRows`/engine state that recovery, relink, and restore legitimately
  destroy.

This spec fixes all eight findings in **five sequentially numbered PRs**.

## 2. Findings register

| # | Sev | Finding | Anchors | Fixed in |
|---|-----|---------|---------|----------|
| 1 | CRITICAL | `!mk` mid-pull returns `rejected` per record while the watermark advances; in recovery the epoch can persist over an unapplied corpus | `apply.ts:397-398`, `worker.ts:987-993` | PR 1 |
| 2 | HIGH | Coalesced delete→upsert with missing live row drops the tombstone entirely (deletion loss, ghost resurrection) | `worker.ts:264-274`, `worker.ts:368-372`, `enqueue.ts:190` | PR 3 |
| 3 | HIGH | Epoch/`bad_since` recovery clears `syncRows` before the drain; pending deletes then hit the L-4 guard and are dropped (deletion reverts fleet-wide) | `recovery.ts:227`, `apply.ts:565`, `worker.ts:359-362` | PR 1 |
| 4 | HIGH | Recovery's pull-all resolves tombstone blind ids only via the just-cleared `syncRows` → every pulled tombstone is a no-op (deletion propagation loss; resurrection) | `apply.ts:364-376`, `recovery.ts:227` | PR 2 |
| 5 | HIGH | Pending-delete suppression advances the watermark past the suppressed rev; fast-Undo then strands the foreign edit forever and wedges the key in a conflict loop | `apply.ts:565`, `worker.ts:989` | PR 1 |
| 6 | HIGH | `restoreCard` revives blobRefs without re-uploading held bytes or cancelling pending blob-deletes; the phase-3 delete gate cannot see cross-key references (dangling refs; irreversible byte loss for a sole byte-holder) | `trash-repo.ts:180-264`, `worker.ts:449-462` | PR 4 |
| 7 | HIGH | `blob_reupload_threshold` is an ask with no answer path, and the epoch persists anyway — >512 MiB of server-lost blobs are never re-uploaded, ever | `recovery.ts:313-322`, `recovery.ts:248-250` | PR 2 |
| 8 | HIGH | Relink while another tab (or an immediate drain) is mid-flight re-inserts `syncRows` after the reset → rows permanently stranded off the new account | `link-reset.ts` (`resetEngineStateForNewLink`), `worker.ts` ack path | PR 5 |

Line anchors are as of `full-backend-transition` tip `9a0888fd`; treat function
names as authoritative where lines have drifted.

## 3. Design

### 3.1 PR 1 — Pull-loop durability and suppression semantics (findings #1, #3, #5)

**Files:** `sync/apply.ts`, `sync/worker.ts` (pull loop only), `sync/watermark.ts`,
`trash/delete-flow.ts`.

**(a) Engine-unavailable aborts the cycle (fixes #1).**
A new `ApplyOutcome` kind `unavailable` is returned when `applyRecord` finds no
MK. It is NOT poison: the pull loop checks each record's outcome and, on
`unavailable`, aborts the page loop immediately — the watermark is persisted
only up to `highestApplied` *before* that record (records already applied this
page were genuinely absorbed; advancing over them is correct). No re-raise, no
attention: the session is ending; the next authenticated cycle resumes from the
held watermark. `pullAllFromZero` propagates the abort as a thrown
`RecoveryAbortedError`, so `performRecovery` exits before the epoch persist —
the existing crash boundary (epoch-persist-last) then guarantees the recovery
re-runs in full next time.

The loop's contract changes from "advance regardless" to: **the watermark may
only advance over a record whose outcome proves durable absorption or proves
the record needs no absorption** (`applied`/`echo`/`stale`/`tombstoned`/
`resolved`/`inserted`/`skipped`/`rejected`-as-poison). `unavailable` and
`suppressed` (below) are the two non-absorbing outcomes.

**(b) Suppression establishes the CAS base (fixes #3, and #5's conflict loop).**
The `§7.4 L-3` suppression branch in `applyUpsert` writes the `syncRows` meta
(`rev: pulled.rev`, `ciphertextHash` of the pulled ciphertext) exactly as the
local-wins no-meta branch already does. Consequences, both load-bearing:

- The step-4 recovery drain now finds `meta !== undefined` for a pending
  delete, so the L-4 guard no longer eats the tombstone — the user's deletion
  pushes and propagates (closes #3's chain).
- A post-Undo local edit pushes a correct `baseRev`, ending the permanent
  conflict loop (closes half of #5).

**(c) Undo rewinds the watermark below suppressed revs (fixes the rest of #5).**
When suppression fires, the suppressed rev is recorded durably in a
`suppressedRevs` map (`Record<'collection:key', number>`, an unindexed field on
the `syncState` singleton — no Dexie bump; cleared on drain-ack for the key,
recovery, and relink). The fast in-place Undo in `delete-flow.ts`, after
restoring the rows, consumes the entries for the restored card and calls
a new `rewindWatermark(rev - 1)` (an explicit, documented monotonicity
exception in `watermark.ts` — the same class of deliberate rewind recovery
already performs with its `watermarkRev: 0` reset). The next pull re-delivers
the foreign edit; the local row now exists, so normal conflict resolution runs
and LWW picks the newer foreign edit. Nothing is lost on either side.

Server-semantics note (why the rewind is safe and cheap): the sync service is a
rev-watermarked **state store**, not an oplog — a rewound pull re-delivers at
most one current row per blindId above the rewound watermark, and every
re-delivery is an idempotent echo/stale no-op except the suppressed row itself.

### 3.2 PR 2 — Recovery tombstone resolution and the blob re-upload answer path (findings #4, #7)

**Files:** `sync/apply.ts` (`findKeyByBlindId`), `sync/recovery.ts`,
`sync/copy.ts`, the attention surface (`SyncStatusLine` and its store wiring).

**(a) Blind-id resolution independent of `syncRows` (fixes #4).**
`findKeyByBlindId` gains a second stage: when the `syncRows` scan misses, it
enumerates the collection's **local primary keys** (via the existing
per-collection table map) and matches blind ids against those. Properties:

- Steady state is byte-identical (stage 1 hits).
- During recovery (post-clear), a pulled tombstone for a locally present row now
  resolves → routes to trash → writes the dead key. Deleted-elsewhere rows in
  the non-repush collections (personaAvatars/artefacts/attachments/vectors) are
  cleaned up in the same pass, closing the multi-day ghost window.
- A tombstone for a row this device never held still resolves to `null` → no-op
  (correct: nothing to remove).
- Stateless — no pre-clear snapshot to lose in a crash; a re-run recovery
  behaves identically.

Perf bound: the fallback fires only on stage-1 misses (recovery, effectively).
One HMAC per local key per missed tombstone's collection, cached per cycle in a
`Map<collection, Map<blindId, key>>` built lazily on first miss, so a
mass-deletion recovery costs one enumeration per collection, not per tombstone.

**(b) An answer path for `blob_reupload_threshold` (fixes #7).**
`recoverBlobs` is refactored to accept `{ force?: boolean }` and to be
invocable standalone (outside `performRecovery`), guarded by the sync Web Lock.
A new exported `confirmBlobReupload()` runs it with `force: true` and clears
the attention on success. The attention surface renders this kind with a real
affordance — copy in the constructive-error register, e.g.:

> "This server is missing N images (X GB) that this device still holds. —
> **Upload them now**"

The epoch persist in `performRecovery` deliberately stays where it is: the blob
reconcile is a channel repair decoupled from epoch identity, and the persisted
attention (already durable) plus the new affordance make it answerable at any
later time, across reloads. Laura reviews the affordance pre-squash (new
user-reachable action).

### 3.3 PR 3 — Coalescer tombstone degrade (finding #2)

**Files:** `sync/worker.ts` (coalesce + drain missing-row branch only).

`OutboxGroup` gains `hasDelete: boolean`, set when any delete op joins the
group (the last-op-wins rule is otherwise unchanged). The drain's missing-row
branch changes from unconditional drop to:

- `meta` exists AND `hasDelete` → **degrade the group to a tombstone push**
  (`baseRev: meta.rev`), exactly as if the delete had been the final op. The
  queued deletion survives a racing background upsert (title generator, memory
  pipeline — any `deferWhenOffline` writer whose `update()` no-ops on the
  deleted row yet still enqueues).
- `meta` exists AND NOT `hasDelete` → keep today's drop (an upsert of a
  vanished row with no queued delete has nothing truthful to push; minting a
  tombstone here would delete server data on a local anomaly — wrong polarity).
- No `meta` → the L-4 drop stands (the server never knew the row).

Rider (one line, same file): the coalesce map key gains the `:` separator so it
matches `keyId()` (`${collection}:${key}`) — closes the latent cross-collection
key-merge hazard.

### 3.4 PR 4 — Restore blob byte-safety (finding #6)

**Files:** `trash/trash-repo.ts`, `sync/worker.ts` (phase 3 gate),
`sync/blob-transform.ts` (export the per-collection blob-field accessor).

**(a) Restore re-establishes the blob channel.** Inside `restoreCard`'s
existing transaction, for every restored clone whose blob field carries bytes
AND a `BlobRef`:

- enqueue a `blob-put` for the **preserved** blobId (deterministic SIV re-seal
  makes this an idempotent repair PUT — the mirror of the `retireRestoredTrash`
  heal that closed HIGH-1 on the peer path);
- delete any pending `syncOutbox` `blob-delete` rows whose `blobId` matches a
  revived ref (same tx — the delete raced the restore and must lose).

A clone with a ref but no bytes (lazy original never fetched) enqueues nothing —
the ref stays placeholder-state on the wire, as designed.

**(b) Reference-aware phase-3 delete gate.** Before executing a `blob-delete`,
the drain re-checks whether any **live row of the owning collection** currently
references the blobId (via the exported blob-field accessor; a filtered table
scan is acceptable — blob-deletes are rare). Referenced → drop the delete entry
silently (the object is authoritatively alive; the put path owns it). This
closes the same-drain restore variant and the cross-device
delete-after-peer-heal race for every case where the deleting device holds the
reviving reference.

**Documented residual (deferral entry, `security-deferrals.md`):** the pure
cross-device ordering where peer B's retire-heal re-PUT lands between A's gate
check and A's DELETE remains a narrow race; it requires B to restore from a
byte-bearing snapshot while A's delete is still queued, and self-heals on B's
next 404-with-bytes repair. Accepted for v1.

### 3.5 PR 5 — Relink generation guard (finding #8)

**Files:** `sync/link-reset.ts`, `sync/worker.ts` (ack/meta write sites),
`sync/watermark.ts` (or wherever `syncState` accessors live).

`syncState` gains `linkGeneration: number` (unindexed; defaulted to 0 by
`getSyncState`'s existing healing path — no Dexie bump). Two co-operating
mechanisms:

- **The reset takes the sync Web Lock.** `resetEngineStateForNewLink` acquires
  the same `chatsundere-sync` Web Lock the cycle path holds, so a
  lock-respecting cycle in any tab finishes (or hasn't started) before the
  reset transaction runs. Inside the transaction it increments
  `linkGeneration`.
- **Acks are generation-guarded.** `drainOutbox` and `runPullLoop` capture the
  generation at start; every `syncRows`/watermark/outbox-ack write re-reads it
  inside its own transaction and **discards the write when the generation has
  moved**. This covers the paths the lock cannot: the immediate drain (which
  bypasses the lock today) and a token-still-valid tab that started before the
  reset. A discarded ack is safe polarity: the push landed on the *old*
  account (irrelevant to the new one), the local row keeps no stale meta, and
  the armed backfill enumerates it correctly as unsynced.

Non-goals here (explicitly): making the immediate drain honour the single-flight
lock globally, and clearing `deadKeys`/`enginePaused` on relink — both are
registered follow-ups (§7), not part of #8's minimal closure.

## 4. PR sequencing and parallelism

| PR | Contents | Depends on | Parallel lane |
|----|----------|-----------|---------------|
| 1 | Pull-loop durability + suppression (§3.1) | — | α |
| 2 | Recovery resolution + re-upload affordance (§3.2) | PR 1 (`apply.ts` overlap) | α |
| 3 | Coalescer degrade (§3.3) | PR 1 merged (shared `worker.ts`) | α |
| 4 | Restore blob safety (§3.4) | — (worktree off base; `worker.ts` phase-3 region is disjoint from PR 1's pull loop) | β |
| 5 | Relink generation guard (§3.5) | PRs 1–4 merged (touches the ack sites PRs 1/3 modify) | final |

Lanes α and β run in parallel worktrees; PR 5 runs last on the merged state.
Every PR merges into `full-backend-transition`; nothing touches `master`.

## 5. Invariants (unchanged, verified per PR)

- **Zero-knowledge boundary:** no fix sends plaintext, keys, or new metadata to
  the server. PR 1's meta writes, PR 5's generation stamp, and PR 4's re-PUTs
  are all client-local or ciphertext-only (deterministic re-seal under the MK).
- **Watermark monotonicity** stays the steady-state rule; the two rewind sites
  (recovery reset, PR 1's undo rewind) are explicit, documented exceptions
  through a dedicated API — never an incidental write.
- **Delete-wins** and the H-1 dead-key terminality are untouched; PR 1(b)
  strengthens delete-wins (a queued delete now survives recovery), PR 3
  strengthens it in the coalescer.
- **Mint-once ref stability** is untouched; PR 4 re-uses preserved ids
  (idempotent re-PUT), never re-mints.
- `strip.ts` / the settings allowlist are **not touched by any PR** (relevant
  for parallel feature work).

## 6. Test requirements

Every fix lands TDD (RED first) with a regression test reproducing the audit
scenario end-to-end at the module level. Non-negotiable list:

- **PR 1:** mk-nulled mid-page → watermark held, cycle aborted; recovery abort
  → epoch NOT persisted; suppression → meta written; the full #3 chain
  (recovery → suppressed pull → drain mints tombstone); the full #5 chain
  (suppress → undo → rewind → re-pull → LWW foreign win).
- **PR 2:** recovery pull-all applies tombstones for locally present rows with
  cleared `syncRows` (incl. a non-repush collection); stage-1 steady-state
  behaviour unchanged; `confirmBlobReupload` uploads over threshold + clears
  attention; below-threshold path unchanged.
- **PR 3:** the exact `[delete, upsert]`-missing-row cell → tombstone pushed;
  `[upsert]`-missing-row-with-meta still drops; no-meta L-4 drop preserved.
- **PR 4:** delete→drain→restore → blob-put enqueued under preserved id;
  restore-before-drain → pending blob-delete cancelled in-tx; phase-3 gate
  drops a delete whose id a live row references.
- **PR 5:** reset increments generation; a captured-stale drain's acks are
  discarded (no `syncRows` re-insert); backfill then enumerates the key.

Suite baseline: full user-client vitest must stay at the 8-test
Node-localStorage baseline (`localStorage.clear()` undefined — environmental);
`tests/sync/**` and `tests/trash/**` green throughout. Gate command:
`pnpm typecheck --force` (14/14) + full vitest — never a cached typecheck.

## 7. Out of scope (registered follow-ups)

The audit's MEDIUM/LOW findings are deliberately not in these PRs. The ones
adjacent to this spec's surface, for the follow-ups index:

- Immediate drain bypassing the single-flight lock + discarded `DrainResult`
  (`triggers.ts`) — PR 5's generation guard mitigates the relink hazard only.
- `deadKeys` never scoped/cleared at epoch change or relink (false `tamper`).
- Cascade enumeration outside the delete transaction (`chats.ts` et al.).
- Restore remap gaps (`attachments.messageId`, `artefacts.personaId`,
  compaction anchors, `memoryBody.entriesProcessed`); vectors outside the trash
  net (both directions).
- `writeBytesOntoRow` TOCTOU (avatar bytes overwrite); transient GET errors
  feeding the 404 rest counter with no terminal retry affordance; non-durable
  fresh-id repair cap; `enginePaused` surviving relink; single attention slot
  vs per-kind semantics; deterministic per-record push errors retrying silently
  forever; onboarding first-cycle kick race.

## 8. Manual verification (Chris, device, post-merge)

Two browsers (A, B) on the dev stack (`./dev.sh`), linked to one account:

1. **#2:** A: delete a chat while offline (or with the server paused), let the
   title generator run on another chat of the same persona, go online, drain.
   B: the deleted chat disappears (previously: ghost survived).
2. **#3/#4:** A: delete a chat; before it drains, force an epoch mismatch
   (server `re-epoch` command). After A's recovery: B no longer shows the chat;
   A shows no resurrected copy.
3. **#5:** A: delete a chat with pending sync; B: edit a message in that chat;
   A: pull (B's edit suppressed), then Undo from the trash toast. A shortly
   after shows B's edit (previously: edit lost + endless conflict).
4. **#6:** A: delete a chat with an image, let it fully drain, restore from
   Recently deleted. B: the image renders (previously: permanent placeholder).
5. **#7:** with >512 MiB (or a dev-lowered threshold) of blobs and a wiped
   MinIO bucket + `re-epoch`: the banner offers "Upload them now"; pressing it
   restores images on B.
6. **#8:** two tabs in A's browser; start a large drain in tab 1, relink to a
   fresh account in tab 2 mid-drain. After backfill: the new account holds the
   full corpus (previously: skipped rows).

## 9. Coordination notes for parallel work (this weekend)

- **No Dexie bump in these PRs.** A parallel feature may claim **v35** without
  colliding. The verno-assertion sweep (~31 tests hard-code `db.verno`) belongs
  to whoever bumps.
- The parallel feature touches `chats` and a configuration property. Two
  dispositions to declare before building (they do NOT touch these PRs' files,
  but they decide sync behaviour): a new **chat field** rides the sealed row
  automatically (synced, LWW whole-row) unless added to the `chats` deny-list
  in `sync/strip.ts` (device-local); a new **settings field** is device-local
  by default (allowlist polarity) and syncs only if added to
  `SETTINGS_SYNC_ALLOWLIST` in the same file. `strip.ts` is untouched by PRs
  1–5, so either choice is collision-free.
- All chat writes in the parallel feature must go through `mutateSynced` (or an
  existing repo helper that does) so `updatedAt` stamping and outbox enqueue
  stay correct.
