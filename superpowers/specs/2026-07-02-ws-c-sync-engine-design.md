# WS-C — Client Sync Engine (design)

**Version:** v2 — Larissa spec-pass (H-1, M-1–M-8, L-1–L-7, I-1–I-5) and Laura spec-pass (2 hard, 7 soft) folded, 2026-07-02.
**Date:** 2026-07-02 · **Workstream:** C of the Full Backend Transition (STATUS-TRANSITION §4) — the long pole
**Depends on:** WS-0 Foundation (discovery/account-link/connectivity, `useServerGate`, `ConnectivityBadge`), WS-B (linked accounts), built server side (sync-service, `packages/crypto` sync-envelope, shared-types wire types)
**Audit:** **Larissa full pass** (spec-pass done — verdict FINDINGS-TO-FOLD, folded here; re-audit on the built diff) + **Laura** (spec-pass done — folded here; pre-squash walk of §11)
**Server counterpart:** `superpowers/specs/2026-07-01-client-sync-design.md` — its §12 is the engine contract this spec implements; §7 (protocol), §8 (doorbell), §15 (wire shapes) are the wire truth.

## 1. Why

The server side of zero-knowledge sync is built and audited: `sync-service`
(push/pull with CAS, tombstones, doorbell), the `packages/crypto`
sync-envelope (blind index, seal/open, padding), and the wire types. The
client half — the engine that enqueues local writes, seals them, drains them,
pulls, and resolves conflicts — was deliberately deferred (server spec §16
"OUT"). This workstream builds it, turnkey on the branch. Server spec §12
already pins most decisions with Chris; this spec makes them client-concrete
and resolves the open points.

## 2. Decisions settled with Chris (2026-07-02)

1. **Trash is internal-only in v1.** The pulled-tombstone trash table exists
   and auto-purges after its 30-day grace window, but gets no user-facing
   surface; restore is possible via dev tools. A restore UI is registered as
   a follow-up in [[insights/future-feature-couplings]]. The mass-tombstone
   protection is completed by a threshold notice (§7.3a, Larissa M-2) —
   without a signal, a 30-day devtools-only window is a bound in name only.
2. **Minimal sync status line, enriched vocabulary.** One row on the
   account/server-linking page. Laura's spec-pass showed the original
   four-state vocabulary misreports the new-device bulk pull and leaves
   error states homeless; the full vocabulary is pinned in §11.1.
3. **Dexie v33 belongs to this engine** (re-confirmed; no parallel master
   feature took a version).
4. **STATUS-TRANSITION open decision 2, resolved:** server spec §12.1 cited
   the memory-body editor as the two-phase precedent; the editor is purely
   local. The real precedent is the **passphrase-change staging** pattern
   (`packages/crypto/src/flows/change-passphrase.ts` + `db/staging.ts` +
   `reconcileStagingOnBoot`): write-ahead intent + boot reconcile. This
   engine adopts the *pattern*, unified: the outbox IS the write-ahead
   staging for both write classes, and the boot drain is the reconcile (§5).
5. **Offline bookmarking stays Class 2** (Laura soft, Chris 2026-07-02):
   no third write class tonight; the control gets the gentlest copy in the
   catalogue and a registered post-alpha revisit.

## 3. Architecture overview

New directory `apps/user-client/src/sync/`:

| Module | Responsibility |
|---|---|
| `enqueue.ts` | `enqueueSync(tx, collection, key, op)` — outbox writes inside the caller's Dexie transaction; `mutateSynced(...)` for Class-2 write-through |
| `worker.ts` | the single-flight cycle: coalesce → seal → push (byte-batched) → apply results → pull loop → apply |
| `apply.ts` | pull-side application: open, verify, per-collection conflict resolution, trash routing, inert rejection |
| `resolution.ts` | the pure per-collection resolution rules (LWW keys, state precedence, stamp adoption) — pure functions, unit-test-ideal |
| `sync-keys.ts` | the per-collection **sync key** extractor (§3.1) |
| `watermark.ts` | syncState read/update helpers, epoch check, recovery procedure |
| `doorbell.ts` | ticket fetch + WSS consumer + reconnect/backoff |
| `gate.ts` | `useSyncGate()` (wraps `useServerGate('sync')`) + non-hook `isSyncAvailable()` + `isClass2Allowed()` |
| `triggers.ts` | boot / regain / foreground / timer / poke wiring into the worker |
| `strip.ts` | device-local field strip before seal, restore-local-on-open (§10) |
| `copy.ts` | the sync failure/status copy catalogue (§11.3) |

The engine consumes, never re-implements: `sealRecord(mk, collection, key,
row)`, `openRecord(mk, collection, blindId, sealed, extractKey)`,
`computeBlindId(mk, collection, key)` from `@chatsundere/crypto`;
`SYNC_COLLECTIONS`, `SyncPushRecord`, `SyncPulledRecord`, error codes from
`@chatsundere/shared-types`; `syncUrl` + `'sync'` feature from the WS-0
discovery store; the session MK from `useSessionStore`.

### 3.1 The sync key is not always a uuid (Larissa M-6)

`openRecord`'s fifth parameter, `extractKey`, is load-bearing: it re-derives
the blind index from the decrypted row and rejects a mismatch. The key is
**per-collection** (server spec §5.1): the row uuid for most collections, the
literal `"1"` for the `settings` singleton, and `"<documentId>#<chunkIndex>"`
for `vectors`. `sync-keys.ts` owns both directions (key-of-row for
seal/enqueue, extractor for open). Consequently the outbox and `syncRows`
field is named **`key`** (the §5.1 serialisation), not `uuid`; the
`[collection+key]` index carries the two non-uuid shapes correctly. A wrong
extractor fails closed (inert rejection of valid records — availability, not
confidentiality), so this is pinned at spec level rather than discovered.

**v1 collection handling:** the engine pushes and applies every
`SYNC_COLLECTIONS` member EXCEPT the three blob-bearing ones
(`personaAvatars`, `artefacts`, `attachments`) — those join in WS-D. A pulled
record of an unhandled collection is skipped inertly (logged, watermark still
advances); acceptable only because WS-D lands on this same branch before
go-live, so no real deployment ever runs C-without-D across devices.

## 4. Dexie v33

New tables (`apps/user-client/src/boot/client-data-db.ts`):

```ts
// v33 — sync engine (this version is RESERVED for this workstream)
syncOutbox: '++seq, [collection+key]',
syncRows: '[collection+key]',
syncState: 'id',
trash: 'id, purgeAt',
```

```ts
interface SyncOutboxRow {
  seq?: number;                 // auto-increment
  collection: SyncCollection;
  key: string;                  // sync key (§3.1) — uuid for most collections
  op: 'upsert' | 'delete';
  enqueuedAt: number;
}
interface SyncRowMeta {
  collection: SyncCollection;
  key: string;
  rev: number;                  // last server rev seen for this row (CAS base)
  ciphertextHash: string;       // LOCALLY computed SHA-256, base64url (§7.0)
}
interface SyncStateRow {
  id: 'state';
  epoch: string | null;         // first-synced epoch; mismatch → recovery (§8)
  watermarkRev: number;         // advances ONLY via pull, monotonically (§6)
  lastSyncAt: number | null;
  pulling: { pages: number; startedAt: number } | null; // §11.1 progress state
  attention: SyncAttention | null;                      // §11.1 error state
}
interface TrashRow {
  id: string;                   // `${collection}:${key}`
  collection: SyncCollection;
  key: string;
  row: unknown;                 // the plaintext local row at tombstone time
  deletedAt: number;
  purgeAt: number;              // deletedAt + 30 days
}
```

- **No payload in the outbox.** Sealing happens at drain time from the
  current row — multiple queued edits of one key coalesce for free, and the
  outbox never persists a second plaintext copy.
- The v33 `upgrade()` stamps `updatedAt: Date.now()` onto every existing
  `chats`, `messages`, `mindspaces`, **and `attachments`** row lacking it
  (the LWW keys; attachments' handling arrives with WS-D but the stamp
  lands here so WS-D needs no migration). All pre-existing rows receive one
  identical stamp; LWW ties then resolve by uuid — arbitrary but
  deterministic, and mostly moot since second devices arrive fresh via
  pairing (Larissa I-3; do not "fix" this later).
- **The verno sweep:** ~27 hard-coded `expect(db.verno).toBe(32)`-style
  assertions break with the bump. The sweep is a named plan task.
- **Trash lifecycle (Larissa M-3):** the purge sweep (`purgeAt <= now`) runs
  at boot AND at the start of every worker cycle (a long-lived PWA tab never
  reboots). The trash table is explicitly enumerated in every wipe path —
  unlink, logout-everywhere, local wipe, account deletion — alongside the
  other synced tables. **Dignity asymmetry, stated honestly:** the user's
  own delete is immediate on the deleting device, but the same user's OTHER
  devices retain the row in trash for up to 30 days. This is the conscious
  §12.3 trade (tombstone-flood protection outranks instant
  delete-everywhere); user-facing copy must not claim immediate
  everywhere-deletion.

## 5. Write classes and enqueue discipline

One outbox, two call-site behaviours (server spec §12.1's classes, unified
under the §2.4 staging pattern):

- **Class 1 — offline-capable** (appends: completed `messages`,
  `memoryJournal` entries, `compactionCheckpoints`, `pills` once terminal;
  creation-inserts of fresh uuids in any handled collection —
  **EXCEPT `memoryBody` creation, which stays Class 2**, coupled to the
  Class-2 journal state transitions of the dream that produces it (server
  spec §12.1's exception, restated verbatim per Larissa M-5)):
  `enqueueSync()` runs **inside the same Dexie transaction** as the local
  write. Fire-and-forget; the worker drains when it can. `baseRev` for a
  fresh key is 0 by definition (`syncRows` has no entry).
- **Class 2 — mutating, online-required** (every edit/delete of an existing
  record): call sites go through

```ts
/** Two-phase synced mutation: gate → local write + enqueue (atomic) → awaited drain. */
async function mutateSynced(args: {
  collection: SyncCollection;
  key: string;
  write: (tx: Transaction) => Promise<void>;  // the local mutation, incl. updatedAt stamp
  op?: 'upsert' | 'delete';                   // default 'upsert'
}): Promise<void>;
```

  which (a) throws a typed `SyncOfflineError` when `isClass2Allowed()` is
  false — surfaces render this state as disabled *before* the user tries,
  the throw is the programming-error backstop; (b) applies the write and the
  outbox entry in one transaction; (c) triggers an immediate drain and
  **awaits the server ack for this row**. **Pending and late-failure
  semantics (Laura soft):** the caller's surface shows its ordinary busy
  affordance while awaiting; if the user navigates away before the ack, the
  promise resolves unobserved and any failure lands on the **attention
  state** (§11.1) instead — the outbox retains the entry either way, so
  "surfaces synchronously" means *when a caller is still mounted*, never
  that the write is lost otherwise. A crash between (b) and (c) leaves the
  outbox entry for the boot drain — exactly `reconcileStagingOnBoot`'s
  shape.
- **Gating scope: linked accounts only.** For a local-only user the engine
  does not exist — no gates, no outbox, unrestricted offline editing.
  `isClass2Allowed()`: local-only → always true; linked → requires
  connectivity `server_ok`, an unlocked session, **and no recovery cycle in
  progress** (§8 — editing into a churning merge is a race, Laura soft).
- **Enqueue-site inventory:** the write sites found by
  `rg "db\.(chats|messages|…)\.(add|put|update|delete|bulk…)"` across
  `data/`, `memory/`, `compaction/`, `knowledge/`, `state/stream-manager`,
  imports, and routes (~35 sites, exact enumeration is a plan task). Each is
  classified Class 1 / Class 2 / non-synced. Chatsune/Chatsundere **imports
  enqueue as Class-1 creation-inserts** (fresh uuids by construction).
- **Coalescing rule for never-pushed rows (Larissa L-4):** create + delete
  with no `syncRows` entry coalesces to **nothing** — pushing it would mint
  a permanent server tombstone for an entity the server never knew
  (existence-metadata for free, plus a forever-row).
- **Field dispositions** follow server spec §12.1's table verbatim: `title`
  Class 2 with title-gen deferring when unreachable; `lastMessageAt`,
  `bookmarkedMessageCount`, `activeCompactionId` derived locally, never
  synced; `draftInput`, `openerPending`, `compactionToastShown` device-local;
  `lastExtractedMessageId` Class-2-by-background-job with CAS convergence;
  `messages.bookmarked`/`bookmarkLabel` Class-2 edits (offline bookmarking
  disabled — gentlest copy, §11.3, decision 5); `vectors` ride their
  document's lifecycle.

## 6. The worker

`runSyncCycle()` — single-flight via
`navigator.locks.request('chatsundere-sync', { ifAvailable: true }, …)`
(cross-tab correctness; the memory pipeline's process-local mutex is not
enough for a PWA with two tabs). Falls back to a process-local mutex when
`navigator.locks` is unavailable (jsdom tests).

Preconditions checked at cycle start: linked, discovery `syncUrl` present
with `'sync'` feature, session unlocked (MK available), connectivity not
`local_offline`. Any miss → cycle no-ops. Each cycle starts with the trash
purge sweep (§4).

**Drain (push):**
1. Read the outbox, coalesce by `[collection+key]` (delete supersedes
   upserts; create+delete with no `syncRows` entry coalesces to nothing,
   §5; the latest state wins by construction since sealing reads the live
   row).
2. For each entry: read the row; compute the blind id
   (`computeBlindId(mk, collection, key)`); apply the §10 strip; seal
   (`sealRecord(mk, collection, key, strippedRow)`); `baseRev` from
   `syncRows` (absent → 0); tombstones for deletes.
3. Batch by **summed encoded bytes** (target 4 MiB per request, comfortably
   under the server's `MAX_BODY_BYTES`), never by record count. POST
   `<syncUrl>/api/v1/sync/changes` via `apiFetch` (bearer + refresh).
4. Per-record results:
   - `ok` → update `syncRows` (rev, locally-computed ciphertext hash),
     delete the outbox entries covered by this seal.
   - `conflict` → pull and resolve (§7). **If the server's current record
     for this key is undecryptable (poison), adopt the returned rev as the
     new CAS base and re-push the local good copy** — a `syncRows` metadata
     update is not a local-data mutation and does not violate §12.3; the
     honest client heals the poison instead of wedging forever (Larissa
     M-1). Otherwise, after resolution, re-derive whether a re-push is
     still meaningful (the local row may have lost LWW).
   - `tombstoned` (the wire's name — not `tombstone_exists`, Larissa I-1) →
     drop the entry and route the local row to trash (the key is dead —
     restoring mints a new uuid).
   - quota/rate errors → attention state with catalogue copy (§11.3), retry
     with backoff; a permanently failing entry never blocks the queue
     behind it.
5. Push responses carry `head` + `epoch`: epoch mismatch → recovery (§8).
   **Piggyback pull iff `head > max(watermarkRev, highest rev in this
   push's results)`** — the server contract's exact form (§7.3 `[P]`,
   Larissa L-1); the naive `head > watermarkRev` would trigger a pull after
   every push.
6. **The watermark never advances from push results** (server spec §12.2 —
   own revs interleave with other devices').

**Pull:**
`GET <syncUrl>/api/v1/sync/changes?since=<watermarkRev>&limit=200`, loop
while `more` with a **per-cycle page cap** (64 pages; continuation next
cycle — an unbounded `more: true` server must not pin the client, Larissa
M-7); apply each page (§7), then advance the watermark to
**`max(watermarkRev, last record's rev)` — monotone, never regressed by a
maliciously ordered page** (Larissa M-7) — page by page, never ahead of
application. **Echo tolerance is a tested property:** re-delivered own
writes must apply as idempotent no-ops (§7.0's hash shortcut).

**Triggers** (`triggers.ts`): boot after unlock (the reconcile drain);
connectivity-regain (WS-0 `maybeProbeLinkedServer` callback chain);
`visibilitychange` → foreground; a coarse timer (10 min); doorbell poke;
Class-1 enqueue (debounced 3 s); Class-2 immediate awaited drain.

## 7. Pull application and conflict resolution

**§7.0 — Echo shortcut, pinned (Larissa L-2):** before decrypting, compare
`syncRows.ciphertextHash` against a **locally computed** SHA-256 of the
pulled ciphertext — never against the server-echoed hash field (trusting
the field would let the server label arbitrary bytes as "your own echo").
On match: no-op for local data, but `syncRows.rev` **is** updated to the
pulled rev (the CAS base tracks the server's current numbering).

**Stale-rev guard (Larissa M-7):** a pulled record whose `rev` is ≤ the
row's `syncRows.rev` is ignored as stale (cheap replay tightening; LWW
remains the primary anchor).

Per pulled record, in order:

1. **Open**: `openRecord(mk, collection, blindId, {nonce, ciphertext},
   extractKey)` with the §3.1 per-collection extractor. GCM failure, codec
   failure, or blind-id re-check mismatch → **inert rejection** `[L]`: no
   local mutation, no tombstone application, a structured diagnostic
   (counter surfaces on the status line's detail), watermark still advances
   (the record is poison, not a blocker — and since the server is a
   latest-state store, skipping poison loses nothing retryable).
2. **Unhandled collection** (blob-bearing pre-WS-D) → inert skip.
3. **Tombstone** → local row (if any) moves to `trash` with its 30-day
   `purgeAt`; outbox entries for the key are dropped; the `syncRows` entry
   is removed. Row-move, outbox drop, `syncRows` removal, and the watermark
   advance for the page happen in **one Dexie transaction** (Larissa L-6 —
   a crash between row-delete and trash-write must not lose the safety
   net). The user's own local deletes remain immediate — trash receives
   only *pulled* tombstones `[L]`.

   **§7.3a — Tombstone threshold notice (Larissa M-2):** pulled tombstones
   above a threshold (default 20 per cycle or per rolling day) raise a
   persistent, calm attention notice — "N items were removed by another
   device. They stay recoverable for 30 days." Above a panic threshold
   (default 200), the engine **pauses further tombstone application**
   pending user acknowledgement; upserts continue. This converts the trash
   bound from forensic artefact into actual mitigation.

   **Viewing breadcrumb (Laura soft):** when a pulled tombstone removes the
   record the user is *currently viewing*, one calm inline breadcrumb —
   "This was deleted on another device." No per-tombstone toasts otherwise.
4. **Upsert, no local row** →
   - **Trash-anchored terminality guard (Larissa H-1, non-negotiable):** if
     a live trash entry exists for this key (pulled-tombstone provenance),
     the upsert is **rejected inertly** with a diagnostic and the trash row
     stays. An honest server can never deliver an upsert for a blind id it
     has tombstoned — such a pull is cryptography-free proof of server
     misbehaviour, and applying it would let a malicious server destroy the
     LWW anchor (tombstone first, then replay an old ciphertext into the
     void). Doubles as a tamper alarm (attention state).
   - **Pending-delete guard (Larissa L-3):** if the outbox holds a pending
     `delete` for this key (shame-delete not yet drained), the insert is
     suppressed — delete-always-wins holds locally too; the drain will
     propagate it.
   - Otherwise → insert.
5. **Upsert, local row exists** → resolve per collection (`resolution.ts`,
   pure):

| Collections | Rule |
|---|---|
| `personas`, `libraries`, `documents`, `providers`, `mcpServers` | LWW on existing `updatedAt`, tie-break by uuid |
| `chats`, `messages`, `mindspaces` | LWW on the engine-stamped `updatedAt` (v33) |
| `settings` | **server wins, whole row — with a replay guard (Larissa M-8):** when the pulled row's `updatedAt` is *older* than the local row's, skip-and-repush (the local row is strictly newer knowledge; a genuine old blob replayed by the server must not roll settings back with a benign toast legitimising it). Applied overwrites surface the §11.3 note; device-local fields restored per §10 |
| `memoryJournal` | state precedence `archived > committed > uncommitted` |
| `memoryBody` | never merged: losing body discarded, re-dream from the unioned journal; **anti-ping-pong** — a fresh-dream CAS loser adopts the winner when the winner's `entriesProcessed` covers its own journal view |
| `vectors` | stamp adoption: compatible `codecVersion`/`modelId`/`dim` → adopt pulled; incompatible → keep local, schedule local re-embed |
| `pills`, `compactionCheckpoints`, `seedTemplates` | immutable/creation-only → idempotent no-op on conflict |

6. **Derived fields recompute** after application (`lastMessageAt`,
   `bookmarkedMessageCount`, `activeCompactionId`) and TanStack invalidation
   fires for affected chats. **During bulk apply (initial pull, recovery,
   any multi-page cycle) invalidations are coalesced and flushed once per
   page batch, debounced** (Laura soft — page-by-page refetch churn during
   onboarding/recovery is exactly when the app must feel composed).

## 8. Epoch and recovery

The client persists the first-synced `epoch`. An **authenticated response**
(push or pull) carrying a different epoch aborts the cycle and runs
recovery. A **doorbell poke** carrying a different epoch only *schedules a
verification cycle* — pokes are unauthenticated content and must never
trigger the expensive path directly (Larissa M-4).

1. Set the recovery state (status line: §11.1's re-check copy; Class-2
   mutations gate closed for the duration, §5).
2. Invalidate every `syncRows` rev (the CAS bases are meaningless against
   the new epoch) and every outbox `baseRev` derivation.
3. Pull-all from `since=0`, applying under §7's rules (local data is merged,
   never blindly overwritten).
4. Re-push the entire local state of handled collections as fresh outbox
   entries with re-derived `baseRev`s.
5. Persist the new epoch only after the full cycle completes.

**Recovery rate-limit (Larissa M-4):** consecutive recoveries back off
exponentially; more than 2 within an hour stops the engine with a
persistent attention state — "Your server is behaving inconsistently —
syncing is paused." — and a manual retry affordance. An epoch-flapping
server gets DoS containment, not an infinite full-vault churn loop.

No silent divergence: local data always wins its way back up — **qualified
for `settings`** (server-wins applies during recovery too; the replay guard
of §7.5 still holds) (Larissa I-5).

## 9. Doorbell consumer

- `POST <syncUrl>/api/v1/sync/doorbell-ticket` (bearer) → `{ticket}`;
  connect `wss://<syncUrl host>/api/v1/sync/doorbell?ticket=…`.
- Poke `{rev, epoch}`: epoch mismatch → schedule a verification cycle (§8);
  `rev > watermarkRev` → schedule a cycle (debounced — the pusher hears its
  own bell, server spec §8.3, and echo-tolerant pulls make that harmless).
- Connected only while: linked + unlocked + document visible + connectivity
  not offline. Reconnect with exponential backoff (max 60 s), fresh ticket
  per attempt. Close-code `4401` → **at most one token refresh per backoff
  cycle** (Larissa L-5); a server closing every socket with 4401 degrades
  the doorbell to the timer silently — it is an accelerant, never an
  escalation path.
- The doorbell is an accelerant, not a dependency: every correctness
  property must hold with the socket permanently dead (timer + foreground
  + piggyback still converge).
- The ticket and the WSS URL never appear in structured diagnostics or the
  status line's detail (Larissa I-4).

## 10. Device-local strip and built-in mindspaces

- **`settings` uses allowlist polarity (Larissa I-2):** because settings is
  the one collection where sync-by-default composes with server-wins
  whole-row application, its sealed form is built from an explicit
  **allowlist** of synced fields; everything not listed stays device-local
  automatically (`adultMode`, the dormant `corsProxy`, and any future field
  until consciously added). On open, non-allowlisted fields keep local
  values.
- All other collections keep **deny-list strip**: `chats.draftInput`,
  `chats.openerPending`, `chats.compactionToastShown`, the derived fields
  (§5), and `mcpServers.resolvedEndpoint`/`lastTestedAt`/`lastError`/
  `routing` (device-probe results — another device's probe outcome is
  functional staleness, Larissa I-2). New fields on non-settings
  collections sync by default — a named property; adding a device-local
  field requires a conscious strip-list entry (checklist item in the plan's
  final task).
- `voiceAudio` and lazy-chat localStorage drafts never enter the engine.
- **Built-in mindspaces do not sync.** A pulled reference to a uuid unknown
  locally (the other device's built-in) falls back calmly to the local
  default built-in; user-created mindspaces sync and resolve by uuid.

## 11. UX surfaces (Laura — spec-pass folded)

### 11.1 Status vocabulary (Laura hard 2)

The status line (account/server-linking page) renders from `SyncStateRow` +
the outbox count — **not** from the outbox count alone:

| State | Trigger | Copy |
|---|---|---|
| Synced | outbox empty, no pull active, no attention | "Synced" + relative `lastSyncAt` |
| Waiting | outbox non-empty, online | "N changes waiting" |
| Offline | linked + offline | "Offline — changes queued" |
| **Pulling** | `pulling` set (any multi-page pull; always on `watermarkRev === 0`) | "Pulling your data onto this device…" + page-based progress (the server contract's §7.2 promised progress bar; on a fresh link this is the trust-critical first impression) |
| **Recovery** | §8 running | "Re-checking everything is in sync — your data is safe." (calm, no operator jargon) |
| **Attention** | `attention` set | catalogue copy (§11.3) + retry affordance where applicable |

"Synced" is **defined to exclude an in-progress pull**.

### 11.2 The offline sweep and its system-level explanation (Laura hard 1)

- Every mutating affordance on synced records disables (never hides) when
  `isClass2Allowed()` is false, with the WS-0 offline gate tooltip: persona
  edit/delete, chat rename/delete, message bookmarking, provider/mcpServer
  edits, settings changes, document/library operations, seed-template
  edits, mindspace management. Touch-reachable tooltip affordance mandate
  carries over from WS-0. The plan enumerates each surface; Laura's
  pre-squash walks them.
- **The ambient `ConnectivityBadge` (mounted app-wide in `root.tsx`) is
  designated the system-level explanation.** While a linked user is
  offline, its expanded/tapped state carries the systemic framing: "Your
  server isn't reachable, so shared edits are paused — nothing is lost, and
  everything wakes up the moment you're back. Reading works as always."
  The per-control tooltips explain the island; the badge explains the
  weather. Framing is deliberately *the app resting into reading mode*, not
  breakage.
- **Named consequences** (decided server-side, surfaced here): offline
  bookmarking disabled — the **gentlest copy in the catalogue** (decision
  5): "Saved bookmarks need your server — this wakes up the moment you're
  back."; title generation defers offline (title stays default, no error
  state); artefact/attachment images do not follow until WS-D.

### 11.3 The sync copy catalogue (Laura soft — no 35-site improvisation)

`sync/copy.ts`, keyed by server error codes and engine states, mirroring
WS-0's gate catalogue. Every entry names the next constructive step:

- `quota_exceeded` → "Your account's sync storage is full (X of Y used).
  Free space by deleting large documents, or ask your operator for more."
  (uses the server's `usedBytes`/`quotaBytes`).
- `record_too_large` → "This item is too large to sync (over the server's
  per-item limit). It stays on this device."
- `conflict` (post-resolution surface, only when the local edit lost) →
  "Another device changed this first — its version was kept."
- `delete_rate_limited` → "That's a lot of deleting at once — the rest
  will follow shortly."
- Settings note, two-tier (Laura soft): ordinary pulled change → "Your
  account's settings were applied."; overwrite of a **locally-differing
  value set this session** → "Your other device's settings took precedence
  here."
- Tombstone threshold (§7.3a), recovery-paused (§8), tamper alarm (§7.4)
  copy live here too.

## 12. Security invariants (Larissa) `[L]`

1. **Plaintext never leaves the device.** The only wire payloads are
   `sealRecord` outputs; blind ids are HMAC-derived; no collection carries
   plaintext metadata beyond the allowlisted `collection` string itself.
2. **MK handling:** sealing/opening happens strictly through
   `@chatsundere/crypto` with the session MK; the engine never copies key
   material into its own state, logs, or Dexie rows.
3. **Inert rejection** (§7.1): a record failing GCM/codec/blind-id re-check
   never mutates local state — a ciphertext-tampering server cannot use the
   client to destroy its own data.
   **3b. Trash-anchored terminality** (§7.4, H-1): an upsert for a key with
   a live pulled-tombstone trash entry is rejected inertly and raises the
   tamper alarm — the tombstone-then-resurrect rollback is structurally
   closed.
4. **Pulled-tombstone trash + threshold notice** (§7.3, §7.3a): bounds a
   malicious mass-tombstone *and* makes the bound real for a non-technical
   user; local deletes stay immediate (dignity preserved, asymmetry stated
   in §4).
5. **Epoch recovery** (§8): a server restore/reset cannot silently discard
   local data; recovery re-pushes, is rate-limited against flapping, and
   is never triggered directly by unauthenticated pokes.
6. **Token use:** all HTTP via the existing `apiFetch` bearer path; the WS
   ticket is single-use, fetched over the authenticated channel; no tokens
   in URLs except the opaque one-shot ticket (server-designed), none in
   `localStorage`; ticket/WSS URL excluded from diagnostics.
7. The strip discipline (§10): allowlist polarity for `settings`; deny-list
   for the rest with new-fields-sync-by-default as a named property and a
   conscious-entry checklist.
8. **Watermark monotonicity + stale-rev guard + local hash verification**
   (§6, §7.0): a malicious server cannot regress the watermark, replay
   lower revs, or mislabel bytes as echoes.

## 13. Out of scope

- Blob transport client (WS-D — `BlobRef` transform, `sync-blob`, fetch
  strategy, repair PUTs, quota display, epoch re-upload).
- Trash restore UI (follow-up, decision 1), uplevelling, ADR 0026 handover,
  device management, account-deletion purge (server-side obligation).
- Any server change. The engine consumes the built, audited services as-is.
- **Follow-up couplings to register in
  [[insights/future-feature-couplings]]** (plan's final task): (a) trash
  restore UI; (b) offline bookmarking post-alpha revisit (decision 5);
  (c) **uplevelling must re-seal `EncryptedBlob` secrets** — provider/MCP
  keys are sealed under the local MK's secrets DEK; a local→linked MK
  change without re-seal silently kills every synced key on other devices
  (Larissa, verified-clean note).

## 14. Testing

- `resolution.ts` pure rules: full matrix per collection incl. ties,
  state-precedence transitions, stamp compatibility, anti-ping-pong,
  settings replay guard (older `updatedAt` → skip-and-repush).
- `sync-keys.ts`: the three key shapes (uuid, `"1"`, docId#chunk) both
  directions.
- Worker: coalescing (edit+edit, edit+delete, create+delete-to-nothing),
  byte-batching boundaries, watermark monotone advance + page cap, **echo
  tolerance** (local-hash match, rev adoption), piggyback max-of-results
  rule, push-result handling per error code incl. **conflict-with-poison
  CAS-base adoption** (M-1), epoch-mismatch abort + recovery sequence +
  recovery rate-limit.
- Apply: inert rejection (bad GCM, bad codec, blind-id mismatch),
  stale-rev ignore, tombstone → trash single-transaction atomicity,
  **trash-anchored terminality rejection** (H-1), pending-delete
  suppression (L-3), tombstone threshold + panic pause (§7.3a),
  unhandled-collection skip, derived-field recompute + debounced
  invalidation.
- Class-2 `mutateSynced`: atomicity of write+enqueue, awaited-ack success,
  offline throw, navigate-away late failure → attention state,
  crash-window reconcile, recovery-gate closed.
- Doorbell: poke → cycle, epoch poke → verification (not direct recovery),
  `4401` refresh-cap per backoff cycle, degrade-to-timer, backoff caps.
  (Mock WS; no live socket in vitest.)
- Migration: v32→v33 stamps `updatedAt` on unstamped rows (incl.
  attachments); **the ~27 verno assertion sweep**; trash purge at boot and
  per cycle.
- Integration (vitest, mocked fetch): register→edit-on-A→pull-on-B scenario
  files driving two in-memory engine instances against a scripted server,
  incl. a malicious-server scenario file (tombstone-then-resurrect, epoch
  flap, watermark regression page).
- Full battery at the end: `pnpm typecheck --force` (14/14), full
  user-client vitest (8-failure baseline rule), `pnpm build`, Biome.

## 15. Manual verification (Chris, dev stack, two browsers)

1. Dev stack up (auth + sync + postgres + redis); link two browser profiles
   (A, B) to the same account via pairing. **Watch the status line show
   "Pulling your data onto this device…" with progress on B.**
2. Create a chat + send messages on A → they appear on B after the doorbell
   poke (status line ticks).
3. Edit a persona on A while B is offline (DevTools offline): B's persona
   edit affordances grey out with the tooltip; the ConnectivityBadge's
   expanded state shows the paused-shared-edits explanation; back online,
   B receives A's edit.
4. Bookmark a message on B offline → disabled with the gentle copy.
5. Delete a chat on A → it disappears on B; if B was viewing it, the
   breadcrumb shows. Check `trash` holds nothing on A (own delete) and the
   row on B (pulled tombstone) via DevTools.
6. Change a setting on A → B shows the settings note; change the same
   setting on both quickly → B's overwrite shows the "took precedence"
   variant.
7. Stop sync-service mid-edit on A → the edit surfaces a constructive error
   and the input survives; restart → drain completes, status line returns
   to "Synced".
8. Wipe the server DB (fresh epoch), restart: both devices show the
   re-check copy, run recovery, and re-converge without data loss.
