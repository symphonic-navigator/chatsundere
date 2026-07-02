# WS-C — Client Sync Engine (design)

**Date:** 2026-07-02 · **Workstream:** C of the Full Backend Transition (STATUS-TRANSITION §4) — the long pole
**Depends on:** WS-0 Foundation (discovery/account-link/connectivity, `useServerGate`), WS-B (linked accounts), built server side (sync-service, `packages/crypto` sync-envelope, shared-types wire types)
**Audit:** **Larissa full pass** (zero-knowledge boundary in the client) + **Laura** (spec-pass + pre-squash on the offline-gating UX)
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
   a follow-up in [[insights/future-feature-couplings]]. (Server spec §12.3's
   protection is about bounding a malicious mass-tombstone's blast radius —
   that protection is the table, not the UI.)
2. **Minimal sync status line.** One row on the account/server-linking page:
   "Synced" / "N changes waiting" / "Offline — changes queued". No dedicated
   screen, no in-chat spinners.
3. **Dexie v33 belongs to this engine** (re-confirmed; no parallel master
   feature took a version).
4. **STATUS-TRANSITION open decision 2, resolved:** server spec §12.1 cited
   the memory-body editor as the two-phase precedent; the editor is purely
   local. The real precedent is the **passphrase-change staging** pattern
   (`packages/crypto/src/flows/change-passphrase.ts` + `db/staging.ts` +
   `reconcileStagingOnBoot`): write-ahead intent + boot reconcile. This
   engine adopts the *pattern*, unified: the outbox IS the write-ahead
   staging for both write classes, and the boot drain is the reconcile (§5).

## 3. Architecture overview

New directory `apps/user-client/src/sync/`:

| Module | Responsibility |
|---|---|
| `enqueue.ts` | `enqueueSync(tx, collection, uuid, op)` — outbox writes inside the caller's Dexie transaction; `mutateSynced(...)` for Class-2 write-through |
| `worker.ts` | the single-flight cycle: coalesce → seal → push (byte-batched) → apply results → pull loop → apply |
| `apply.ts` | pull-side application: open, verify, per-collection conflict resolution, trash routing, inert rejection |
| `resolution.ts` | the pure per-collection resolution rules (LWW keys, state precedence, stamp adoption) — pure functions, unit-test-ideal |
| `watermark.ts` | syncState read/update helpers, epoch check, recovery procedure |
| `doorbell.ts` | ticket fetch + WSS consumer + reconnect/backoff |
| `gate.ts` | `useSyncGate()` (wraps `useServerGate('sync')`) + non-hook `isSyncAvailable()` + `isClass2Allowed()` |
| `triggers.ts` | boot / regain / foreground / timer / poke wiring into the worker |
| `strip.ts` | device-local field strip before seal, restore-local-on-open (§10) |

The engine consumes, never re-implements: `sealRecord(mk, collection, key,
row)`, `openRecord(mk, collection, blindId, sealed)`, `computeBlindId(mk,
collection, key)` from `@chatsundere/crypto`; `SYNC_COLLECTIONS`,
`SyncPushRecord`, `SyncPulledRecord`, error codes from
`@chatsundere/shared-types`; `syncUrl` + `'sync'` feature from the WS-0
discovery store; the session MK from `useSessionStore`.

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
syncOutbox: '++seq, [collection+uuid]',
syncRows: '[collection+uuid]',
syncState: 'id',
trash: 'id, purgeAt',
```

```ts
interface SyncOutboxRow {
  seq?: number;                 // auto-increment
  collection: SyncCollection;
  uuid: string;
  op: 'upsert' | 'delete';
  enqueuedAt: number;
}
interface SyncRowMeta {
  collection: SyncCollection;
  uuid: string;
  rev: number;                  // last server rev seen for this row (CAS base)
  ciphertextHash: string;       // echo/no-op detection (base64url)
}
interface SyncStateRow {
  id: 'state';
  epoch: string | null;         // first-synced epoch; mismatch → recovery (§8)
  watermarkRev: number;         // advances ONLY via pull (§7)
  lastSyncAt: number | null;
}
interface TrashRow {
  id: string;                   // `${collection}:${uuid}`
  collection: SyncCollection;
  uuid: string;
  row: unknown;                 // the plaintext local row at tombstone time
  deletedAt: number;
  purgeAt: number;              // deletedAt + 30 days; boot sweep hard-deletes
}
```

- **No payload in the outbox.** Sealing happens at drain time from the
  current row — multiple queued edits of one uuid coalesce for free, and the
  outbox never persists a second plaintext copy.
- The v33 `upgrade()` stamps `updatedAt: Date.now()` onto every existing
  `chats`, `messages`, and `mindspaces` row lacking it (the §12.3 LWW key for
  those collections; `attachments` gets its stamp in WS-D with its own
  handling). New Class-2 writes maintain the stamp from then on.
- **The verno sweep:** ~27 hard-coded `expect(db.verno).toBe(32)`-style
  assertions break with the bump (known Dexie-bump cost, memory'd). The sweep
  is a named plan task, not a discovery.
- Trash purge: a boot-time sweep deletes rows with `purgeAt <= now`.

## 5. Write classes and enqueue discipline

One outbox, two call-site behaviours (server spec §12.1's classes, unified
under the §2.4 staging pattern):

- **Class 1 — offline-capable** (appends: completed `messages`,
  `memoryJournal` entries, `compactionCheckpoints`, `pills`
  once terminal; creation-inserts of fresh uuids in any handled collection):
  `enqueueSync()` runs **inside the same Dexie transaction** as the local
  write. Fire-and-forget; the worker drains when it can. `baseRev` for a
  fresh uuid is 0 by definition (`syncRows` has no entry).
- **Class 2 — mutating, online-required** (every edit/delete of an existing
  record): call sites go through

```ts
/** Two-phase synced mutation: gate → local write + enqueue (atomic) → awaited drain. */
async function mutateSynced(args: {
  collection: SyncCollection;
  uuid: string;
  write: (tx: Transaction) => Promise<void>;  // the local mutation, incl. updatedAt stamp
  op?: 'upsert' | 'delete';                   // default 'upsert'
}): Promise<void>;
```

  which (a) throws a typed `SyncOfflineError` when `isClass2Allowed()` is
  false — surfaces render this state as disabled *before* the user tries,
  the throw is the programming-error backstop; (b) applies the write and the
  outbox entry in one transaction; (c) triggers an immediate drain and
  **awaits the server ack for this row** — CAS conflict or network failure
  surfaces synchronously to the caller (constructive error, input
  preserved). A crash between (b) and (c) leaves the outbox entry for the
  boot drain — exactly `reconcileStagingOnBoot`'s shape.
- **Gating scope: linked accounts only.** For a local-only user the engine
  does not exist — no gates, no outbox, unrestricted offline editing.
  `isClass2Allowed()` = `linkStatus !== 'linked'` → always true; linked →
  requires connectivity `server_ok` and an unlocked session.
- **Enqueue-site inventory:** the write sites found by
  `rg "db\.(chats|messages|…)\.(add|put|update|delete|bulk…)"` across
  `data/`, `memory/`, `compaction/`, `knowledge/`, `state/stream-manager`,
  imports, and routes (~35 sites, exact enumeration is a plan task). Each is
  classified Class 1 / Class 2 / non-synced (device-local tables like
  `voiceAudio` and the derived/transient fields in §10 don't enqueue).
  Chatsune/Chatsundere **imports enqueue as Class-1 creation-inserts**
  (fresh uuids by construction).
- **Field dispositions** follow server spec §12.1's table verbatim: `title`
  Class 2 with title-gen deferring when unreachable; `lastMessageAt`,
  `bookmarkedMessageCount`, `activeCompactionId` derived locally, never
  synced; `draftInput`, `openerPending`, `compactionToastShown` device-local;
  `lastExtractedMessageId` Class-2-by-background-job with CAS convergence;
  `messages.bookmarked`/`bookmarkLabel` Class-2 edits (offline bookmarking
  disabled-with-reason); `vectors` ride their document's lifecycle.

## 6. The worker

`runSyncCycle()` — single-flight via
`navigator.locks.request('chatsundere-sync', { ifAvailable: true }, …)`
(cross-tab correctness; the memory pipeline's process-local mutex is not
enough for a PWA with two tabs). Falls back to a process-local mutex when
`navigator.locks` is unavailable (jsdom tests).

Preconditions checked at cycle start: linked, discovery `syncUrl` present
with `'sync'` feature, session unlocked (MK available), connectivity not
`local_offline`. Any miss → cycle no-ops.

**Drain (push):**
1. Read the outbox, coalesce by `[collection+uuid]` (delete supersedes
   upserts; the latest state wins by construction since sealing reads the
   live row).
2. For each entry: read the row; compute `blindId`; seal
   (`sealRecord(mk, collection, uuid, strippedRow)` after the §10 strip);
   `baseRev` from `syncRows` (absent → 0); tombstones for deletes.
3. Batch by **summed encoded bytes** (target 4 MiB per request, comfortably
   under the server's `MAX_BODY_BYTES`), never by record count. POST
   `<syncUrl>/api/v1/sync/changes` via `apiFetch` (bearer + refresh).
4. Per-record results: `ok` → update `syncRows` (rev, ciphertextHash), delete
   the outbox entries covered by this seal; `conflict` → leave the entry,
   flag the uuid for pull-resolution (§7 applies the winner, then re-derives
   whether a re-push is still meaningful); `tombstone_exists` → drop the
   entry and route the local row to trash (the uuid is dead — restoring
   mints a new uuid); quota/rate errors → constructive surface via the
   status line, retry with backoff.
5. Push responses carry `head` + `epoch`: epoch mismatch → recovery (§8);
   `head > watermarkRev` → pull immediately (the §7.3 piggyback).
6. **The watermark never advances from push results** (server spec §12.2 —
   own revs interleave with other devices').

**Pull:**
`GET <syncUrl>/api/v1/sync/changes?since=<watermarkRev>&limit=200`, loop
while `more`; apply each page (§7), then advance `watermarkRev` to the
page's last record's rev — page by page, never ahead of application.
**Echo tolerance is a tested property:** re-delivered own writes must
apply as idempotent no-ops (`ciphertextHash` match in `syncRows` short-cuts
without decrypting).

**Triggers** (`triggers.ts`): boot after unlock (the reconcile drain);
connectivity-regain (WS-0 `maybeProbeLinkedServer` callback chain);
`visibilitychange` → foreground; a coarse timer (10 min); doorbell poke;
Class-1 enqueue (debounced 3 s); Class-2 immediate awaited drain.

## 7. Pull application and conflict resolution

Per pulled record, in order:

1. **Open**: `openRecord(mk, collection, blindId, {nonce, ciphertext})`. GCM
   failure, codec failure, or blind-id re-check mismatch → **inert
   rejection** `[L]`: no local mutation, no tombstone application, a
   structured diagnostic (`console.warn` + a counter on the status line's
   detail), watermark still advances (the record is poison, not a blocker).
2. **Unhandled collection** (blob-bearing pre-WS-D) → inert skip.
3. **Tombstone** → local row (if any) moves to `trash` with its 30-day
   `purgeAt`; outbox entries for the uuid are dropped; `syncRows` entry
   removed. The user's own local deletes remain immediate — trash receives
   only *pulled* tombstones `[L]`.
4. **Upsert, no local row** → insert (echo of a deleted row cannot occur —
   tombstones are terminal server-side).
5. **Upsert, local row exists** → resolve per collection (`resolution.ts`,
   pure):

| Collections | Rule |
|---|---|
| `personas`, `libraries`, `documents`, `providers`, `mcpServers` | LWW on existing `updatedAt`, tie-break by uuid |
| `chats`, `messages`, `mindspaces` | LWW on the engine-stamped `updatedAt` (v33) |
| `settings` | **server wins, whole row** — plus the §11 honest note; device-local fields restored per §10 |
| `memoryJournal` | state precedence `archived > committed > uncommitted` |
| `memoryBody` | never merged: losing body discarded, re-dream from the unioned journal; **anti-ping-pong** — a fresh-dream CAS loser adopts the winner when the winner's `entriesProcessed` covers its own journal view |
| `vectors` | stamp adoption: compatible `codecVersion`/`modelId`/`dim` → adopt pulled; incompatible → keep local, schedule local re-embed |
| `pills`, `compactionCheckpoints`, `seedTemplates` | immutable/creation-only → idempotent no-op on conflict |

6. **Derived fields recompute** after application (`lastMessageAt`,
   `bookmarkedMessageCount`, `activeCompactionId`) and TanStack invalidation
   fires for affected chats (`invalidateQueries(['chats', chatId])` — the
   known messages-need-invalidation coupling).

## 8. Epoch and recovery

The client persists the first-synced `epoch`. Any response or poke carrying
a different epoch aborts the cycle and runs recovery (server spec §12.2):

1. Set a transient "resyncing" state (status line shows it honestly).
2. Invalidate every `syncRows` rev (the CAS bases are meaningless against
   the new epoch) and every outbox `baseRev` derivation.
3. Pull-all from `since=0`, applying under §7's rules (local data is merged,
   never blindly overwritten).
4. Re-push the entire local state of handled collections as fresh outbox
   entries with re-derived `baseRev`s.
5. Persist the new epoch only after the full cycle completes.

No silent divergence: local data always wins its way back up.

## 9. Doorbell consumer

- `POST <syncUrl>/api/v1/sync/doorbell-ticket` (bearer) → `{ticket}`;
  connect `wss://<syncUrl host>/api/v1/sync/doorbell?ticket=…`.
- Poke `{rev, epoch}`: epoch mismatch → recovery; `rev > watermarkRev` →
  schedule a cycle (debounced — the pusher hears its own bell, server spec
  §8.3, and the echo-tolerant pull makes that harmless).
- Connected only while: linked + unlocked + document visible + connectivity
  not offline. Reconnect with exponential backoff (max 60 s), fresh ticket
  per attempt; close-code `4401` → one token refresh, then re-ticket.
- The doorbell is an accelerant, not a dependency: every correctness
  property must hold with the socket permanently dead (timer + foreground
  + piggyback still converge).

## 10. Device-local strip and built-in mindspaces

- Before sealing, `strip.ts` removes: `settings.adultMode`,
  `settings.corsProxy` (dormant post-WS-A, stripped defensively),
  `chats.draftInput`, `chats.openerPending`, `chats.compactionToastShown`,
  and the derived fields (§5). On open, absent fields keep local values —
  the strip list doubles as the restore list.
- `voiceAudio` and lazy-chat localStorage drafts never enter the engine.
- **Built-in mindspaces do not sync.** A pulled reference to a uuid unknown
  locally (the other device's built-in) falls back calmly to the local
  default built-in; user-created mindspaces sync and resolve by uuid.

## 11. UX surfaces (Laura)

- **Status line** (account/server-linking page, decision 2): "Synced" /
  "N changes waiting" / "Offline — changes queued" / "Resyncing after a
  server restore" — one Dexie live-query on the outbox count + syncState.
  No new screens.
- **Offline Class-2 gating — the big sweep.** Every mutating affordance on
  synced records disables (never hides) when `isClass2Allowed()` is false,
  with the WS-0 offline gate tooltip: persona edit/delete, chat
  rename/delete, message bookmarking, provider/mcpServer edits, settings
  changes, document/library operations, seed-template edits, mindspace
  management. Touch-reachable tooltip affordance mandate carries over from
  WS-0. The plan enumerates each surface; Laura's pre-squash walks them.
- **Named consequences** (decided server-side, surfaced here): offline
  bookmarking disabled; title generation defers offline (title stays
  default until connectivity returns — no error state); artefact/attachment
  images do not follow until WS-D (their records may render placeholders on
  a second device during the branch's life — never in a deployment, §3).
- **Settings server-wins note**: after a pulled settings overwrite, one calm
  line (toast/inline on settings): "Your account's settings were applied."
  No modal, no confirmation.

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
4. **Pulled-tombstone trash** (§7.3): bounds a malicious mass-tombstone;
   local deletes stay immediate (dignity preserved).
5. **Epoch recovery** (§8): a server restore/reset cannot silently discard
   local data; recovery re-pushes.
6. **Token use:** all HTTP via the existing `apiFetch` bearer path; the WS
   ticket is single-use, fetched over the authenticated channel; no tokens
   in URLs except the opaque one-shot ticket (server-designed), none in
   `localStorage`.
7. The strip list (§10) is deny-by-list on known device-local fields, but
   sealing whole rows means **new fields sync by default** — a named
   property, so future device-local fields must be added to the strip list
   consciously (checklist entry in the plan's final task).

## 13. Out of scope

- Blob transport client (WS-D — `BlobRef` transform, `sync-blob`, fetch
  strategy, repair PUTs, quota display, epoch re-upload).
- Trash restore UI (follow-up, decision 1), uplevelling, ADR 0026 handover,
  device management, account-deletion purge (server-side obligation).
- Any server change. The engine consumes the built, audited services as-is.

## 14. Testing

- `resolution.ts` pure rules: full matrix per collection incl. ties,
  state-precedence transitions, stamp compatibility, anti-ping-pong.
- Worker: coalescing (edit+edit, edit+delete, create+delete), byte-batching
  boundaries, watermark page-advance, **echo tolerance**, push-result
  handling per error code, epoch-mismatch abort + recovery sequence.
- Apply: inert rejection (bad GCM, bad codec, blind-id mismatch), tombstone
  → trash, unhandled-collection skip, derived-field recompute + query
  invalidation.
- Class-2 `mutateSynced`: atomicity of write+enqueue, awaited-ack success,
  offline throw, crash-window reconcile (enqueue present, drain on next
  cycle).
- Doorbell: poke → cycle, epoch poke → recovery, `4401` → refresh+re-ticket,
  backoff caps. (Mock WS; no live socket in vitest.)
- Migration: v32→v33 stamps `updatedAt` on unstamped rows; **the ~27 verno
  assertion sweep**; trash purge sweep.
- Integration (vitest, mocked fetch): register→edit-on-A→pull-on-B scenario
  files driving two in-memory engine instances against a scripted server.
- Full battery at the end: `pnpm typecheck --force` (14/14), full
  user-client vitest (8-failure baseline rule), `pnpm build`, Biome.

## 15. Manual verification (Chris, dev stack, two browsers)

1. Dev stack up (auth + sync + postgres + redis); link two browser profiles
   (A, B) to the same account via pairing.
2. Create a chat + send messages on A → they appear on B after the doorbell
   poke (watch the status line tick).
3. Edit a persona on A while B is offline (DevTools offline): B's persona
   edit affordances grey out with the tooltip; back online, B receives A's
   edit.
4. Bookmark a message on B offline → the affordance is disabled with reason.
5. Delete a chat on A → it disappears on B; check `trash` holds nothing on
   A (own delete) and the row on B (pulled tombstone) via DevTools.
6. Change settings on A → B shows "Your account's settings were applied."
7. Stop sync-service mid-edit on A → the edit surfaces a constructive error
   and the input survives; restart → drain completes, status line returns
   to "Synced".
8. Wipe the server DB (fresh epoch), restart: both devices run recovery and
   re-converge without data loss.
