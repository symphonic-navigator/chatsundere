# Sync Backfill, Fresh-Join Guard, and 401 Degrade-to-Offline — Design

**Date:** 2026-07-04
**Status:** Approved by Chris (brainstorm 2026-07-03 late night); awaiting Larissa + Laura spec-pass
**Branch target:** `full-backend-transition` — every PR targets this branch, NEVER `master`
**Delivery:** overnight remote execution, 1..n numbered PRs (see §9)

---

## 1. Context

Sync is green end-to-end on the dev stack (push, pull, doorbell, status line —
verified 2026-07-03). But only rows touched *after* account-linking enter the
vault: the WS-C scope deliberately cut any initial sync (server spec §12.6/§16
"OUT: uplevelling", engine spec §13). Empirically, Chris's 61 pre-link chats
never synced; only the 4 post-link chats did.

Two adjacent defects sharpened the scope:

1. **The fresh-join overwrite.** `finishJoinByInvitation` mints a NEW master
   key and silently overwrites the local account
   (`packages/crypto/src/flows/join-by-invitation.ts:154` +
   `putLocalAndLinkedAccount`). On a device with existing local data but no
   active session, the invitation flow takes this path (`isLateLink` is false,
   `apps/user-client/src/routes/onboarding/invitation/confirm.tsx:99`) — this
   cost Chris his provider secrets on 2026-07-03.
2. **The 401 cascade** (parked finding, STATUS-TRANSITION). A linked client
   whose server forgot it gets its LOCAL session killed by the background
   worker: 401 → refresh fail → `closeAndForget()`
   (`apps/user-client/src/lib/fetch.ts:119`/`126`).

Verified ground truth the design builds on:

- **The late-link path keeps the local MK** (`confirm.tsx:119-133` passes the
  live `localMk` into `linkToServer`; the flow re-wraps, never re-mints). No
  re-seal of `EncryptedBlob` secrets is needed — this is the same-MK case.
  Foreign-MK uplevelling stays deferred (register entry in
  `obsidian/insights/future-feature-couplings.md`).
- **Outbox rows are payload-free** (`sync/enqueue.ts` — `collection`, `key`,
  `op`, optional `blobId`). Sealing reads the live row at drain time, so
  enqueueing is cheap and queued edits coalesce for free.
- **`syncRows [collection+key]`** is written on push-`ok` and on pull-apply.
  "Row without a `syncRows` entry" is therefore a sound, resumable
  "never synced" predicate.
- **`recovery.ts` already contains the enqueue-everything primitive**
  (`enqueueFullRepush`, `sync/recovery.ts:380`) and the blob re-upload pattern
  (`recoverBlobs`, `sync/recovery.ts:276`). The backfill reuses these shapes
  rather than inventing a parallel path.
- **The drain already orders blob PUTs before records** and handles CAS,
  byte-batching (4 MiB), `MAX_PUSH_RECORDS` (100), conflicts, and poison
  adoption. Server-side limits: `RATE_LIMIT_USER_PER_MIN` 120, quota 2 GiB.

## 2. Scope

Three numbered PRs against `full-backend-transition`:

| PR | Unit | Size |
|----|------|------|
| 1 | Same-MK sync backfill for the invitation late-link path | L |
| 2 | Fresh-join guard (UI routing + crypto backstop) | S–M |
| 3 | 401 degrade-to-offline for background requests | M |

**OUT of scope:** foreign-MK uplevelling (pairing onto a device with existing
local data — stays deferred; pairing on such a device is cleanly refused today,
`pairing/confirm.tsx:34`); any server-side change; any Dexie version bump
(v33 is owned by the sync engine and suffices — see §3.1).

## 3. PR 1 — Sync backfill

### 3.1 State

`SyncStateRow` (the `syncState` singleton) gains three fields:

```ts
backfillPending: boolean;      // set by the late-link success path
backfillTotal: number | null;  // rows to upload, counted once at first pump run
backfillDone: number | null;   // rows enqueued-and-drained so far
```

Non-indexed Dexie fields need **no schema version bump**: v33 stands, no
`db.verno` assertion sweep.

### 3.2 Trigger

The late-link success path in `confirm.tsx` (the branch that calls
`useAccountLinkStore.setLinked`) sets `backfillPending = true` and kicks a sync
cycle. No other flow sets it:

- Fresh join, pairing join, and recover-from-scratch have no pre-link local
  data to upload.
- Pairing onto a device with a local account is refused today (no late-link
  branch exists there).

### 3.3 The pump (`sync/backfill.ts`, new module)

Mirrors the `recovery.ts` structure: the worker checks the flag at the end of
`runSyncCycle` (after the normal drain + pull) and hands off, inside the same
single-flight lock. The module owns enumeration, chunking, progress, and test
seams, registered via a setter to stay import-cycle-free (the established
worker pattern).

Per pump run:

1. **First run only:** compute `backfillTotal` — per collection, count local
   rows lacking a `syncRows` entry (vectors counted from the knowledge
   database; built-in mindspaces excluded).
2. **Collection order,** structural-first so partially-backfilled remote
   devices see parents before children:
   `settings → providers → mcpServers → mindspaces → personas →
   personaAvatars → seedTemplates → libraries → documents → chats →
   artefacts → attachments → messages → pills → memoryJournal → memoryBody →
   compactionCheckpoints → vectors`.
3. **Per chunk:** select up to **200 un-synced rows** (no `syncRows` entry,
   built-ins filtered), enqueue them as payload-free outbox upserts in ONE
   small Dexie transaction — for the three blob-bearing collections also
   `enqueueBlobPut` for refs whose bytes are locally present, in the SAME
   transaction — then `drainOutbox()`, then advance `backfillDone`.
4. **Between chunks:** abort checks — offline, locked, engine paused, drain
   failure. On abort the pump ends the cycle; the flag survives; the next
   trigger resumes.
5. **Nothing left in any collection:** clear the flag, null the counters. The
   status line falls back to its normal vocabulary.

### 3.4 Idempotency and resume

The predicate "row without a `syncRows` entry" is the single source of truth;
every run recomputes the remainder. Consequences, each deliberate:

- A crash mid-chunk leaves outbox rows; the boot-reconcile drain pushes them,
  `syncRows` fills, and the next pump run does not re-enqueue them. Even a
  double-push is a harmless idempotent CAS push.
- Rows the server already knows (e.g. synced live between link and backfill)
  are skipped by the predicate; a genuine conflict rides the existing §7
  resolution.
- Quota exhaustion and rate-limit responses surface through the existing
  drain/attention mechanics. The flag survives; the backfill resumes when the
  condition clears. No new error surface.

### 3.5 What deliberately rides the existing machinery

Device-local strip (seal path), coalescing with live edits (outbox coalesces
per `[collection+key]`), conflict resolution, byte-batching,
`MAX_PUSH_RECORDS`, poison adoption (M-1), blob PUT-before-record phase
ordering, the 401-refresh path (and, once PR 3 lands, its degrade behaviour).

### 3.6 Special cases

- **Built-in mindspaces never sync** (engine spec §12.5). The backfill filters
  `builtIn: true`. The same filter is added to `enqueueFullRepush()` in
  `recovery.ts` — a latent gap found during this design (no `builtIn`
  reference exists anywhere under `sync/`); fixing it here keeps both
  enqueue-everything paths honest. Same PR, Larissa's audit window covers
  both.
- **`vectors` are IN** (Chris, 2026-07-03): consistent with the WS-C
  battery-over-bytes decision — what syncs live, backfills. They enumerate
  from the separate knowledge database; the drain's read path already exists
  (`worker.ts:208-211`, lazy import). The pump needs an enumerate/count
  helper beside `getKnowledgeVectorRow`. Estimated volume: low tens of MiB,
  far under quota, chunked like everything else. The epoch recovery's vector
  exclusion is NOT changed — its pull-all re-establishes CAS bases, a
  different situation.
- **`memoryBody`** enqueues like any other collection. Its Class-2 two-phase
  discipline governs live user edits; the backfill is an append-shaped
  enqueue of already-committed local rows and runs only while online.
- **`settings`** backfills as the singleton key `'1'` iff un-synced;
  server-wins application on pull is unaffected.
- **Trash** is not backfilled: it holds *pulled* tombstones by construction,
  and a pre-link device has none. Local pre-link deletions are simply absent
  rows — nothing to push.
- **Oversize-sentinel blob refs** are skipped (the server has terminally
  refused them; same rule as recovery §8).

### 3.7 UX (Laura's lane)

One new entry in the §11.1 status-line vocabulary, visible while
`backfillPending`:

> **Uploading your existing data… N of M**

`N = backfillDone`, `M = backfillTotal`. No new surface, no toast, no modal —
the status line is the place. On completion the line falls back to "Synced".
Rationale: the interleaved pump keeps the outbox small, so the existing
"N changes waiting" would read a misleading constant ~200; an honest one-off
progress line tells the user a large upload is running, how far it is, and
implicitly that the device should stay online.

## 4. PR 2 — Fresh-join guard

Two layers, one PR.

### 4.1 UI routing (the door, not the wall)

- **Detection:** `getLocalAccount(getDb())` returns a row, but no active
  session with an MK exists (the situation where `isLateLink` would be
  false). Covers both bug variants: logged out and locked.
- **Where:** the invitation input route AND the confirm route (the bounce-
  guard pattern at `confirm.tsx:58-70` is the model). This also catches the
  QR deep-link path, which lands directly with a pre-filled code.
- **Behaviour:** instead of the join form, a constructive screen —
  *"This device already holds an account. Unlock it first, then connect it
  to the server."* — with a button to the local login carrying a return URL
  back into the invitation flow (the existing `?return=`/`navTarget`
  mechanics). After unlock the SAME flow continues as a clean late-link:
  same code, same destination, MK preserved — and, thanks to PR 1, followed
  by the backfill.

### 4.2 Crypto backstop (stop-the-line insurance)

`finishJoinByInvitation` checks `getLocalAccount(args.db)` FIRST: if a row
exists it throws `CryptoError('local_account_exists')` before any MK minting
and before any server call. The silent overwrite via
`putLocalAndLinkedAccount` becomes structurally unreachable regardless of any
future UI regression. The confirm screen maps the error (should it ever
surface) to a message pointing at the local login, not a generic failure.

Detail: the backstop throws before `/join/finish` consumes the one-time
invitation code — a refused attempt burns nothing; the open join session on
the server expires harmlessly.

### 4.3 No fresh-start escape hatch

Deliberate (Chris, 2026-07-03): no "start fresh, erase this device" branch in
this flow. The place where data was lost yesterday does not get a new delete
affordance. A user who genuinely wants an empty device uses the existing
reset path. Omakase; one intent per screen.

## 5. PR 3 — 401 degrade-to-offline

### 5.1 Principle

Background requests must never destroy the local session. Only the user
(logout) or a user-initiated auth flow may trigger `closeAndForget()`.

### 5.2 Mechanics

- `apiFetch` gains an option `origin: 'user' | 'background'`, default
  `'user'` so existing call sites are untouched. The engine paths mark
  themselves `'background'`: sync push/pull, doorbell ticket, blob transport,
  quota, and any other worker-initiated request.
- In the refresh-fail path (`fetch.ts:119`/`126`): for `'background'`, NO
  `closeAndForget()`. Instead a typed `AuthDegradedError` plus a persistent
  `auth_degraded` attention state.
- **Refusal vs unreachable — the load-bearing distinction:** only a
  *definitive* 4xx refusal of the refresh (invalid cookie, account gone)
  degrades. A network error or 5xx during refresh is "server unreachable"
  and rides the existing connectivity handling — otherwise every
  auth-service restart would degrade the engine.
- **While degraded:** the engine stops (the gate treats `auth_degraded` like
  offline; Class-2 affordances disable-over-hide). Local work continues
  unrestricted — the user loses nothing.
- **Attention copy** (the dere half): *"This server no longer recognises
  this device. Your data is safe here — reconnect with a new invitation when
  you're ready."* with an affordance into the invitation flow — which PR 2
  routes cleanly as a late-link and PR 1 then backfills. The three PRs close
  the loop on the exact scenario that cost Chris his provider secrets.
- **Recovery from the state:** a successful user-initiated auth flow (login,
  relink) clears it; so does a later successful refresh riding a
  user-initiated request (only the *background* engine stops — user-origin
  requests keep flowing and may find the server sane again).

### 5.3 Security posture (Larissa's lane)

Preserving the local session despite server refusal is sound: the MK and the
local data are the local trust domain; the server never had authority over
them. No token outlives the degrade — the engine stops, so no further bearer
requests are sent until re-auth.

## 6. Error handling summary

| Failure | Behaviour |
|---|---|
| Crash/tab-close mid-backfill | Flag survives; outbox drains at boot; pump resumes on next cycle |
| Offline / locked mid-backfill | Pump aborts the cycle; resumes on the next trigger |
| Quota exceeded during backfill | Existing quota attention; flag survives; resumes when cleared |
| Rate-limited (429) | Drain surfaces the failure; pump stops this cycle; timer/trigger retries |
| Server already has a row | `syncRows` predicate skips it; true conflicts ride §7 resolution |
| Join attempted over existing local account | UI reroutes to unlock (PR 2); crypto backstop throws as last line |
| Background 401 + refresh refused | `auth_degraded` attention; session preserved; engine stopped (PR 3) |
| Background 401 + refresh unreachable | Existing offline/connectivity handling; no degrade |

## 7. Testing

- **Backfill (vitest):** pump enumeration predicate (syncRows diff, built-in
  filter, vectors from knowledge DB); chunk transaction atomicity (records +
  blob-puts together); resume after simulated abort at every phase boundary;
  flag lifecycle (set → progress → clear); counter correctness; status-line
  vocabulary rendering; recovery's `enqueueFullRepush` built-in filter.
- **Guard:** crypto flow throws with a local account present and performs no
  network call; UI routing tests for both routes (redirect with
  account-no-session, pass-through for fresh device and for active late-link).
- **401 degrade:** background refresh-4xx → session alive, attention set,
  engine stopped; background refresh network-fail → no degrade; user-path
  logout semantics unchanged.
- Structural assertions, not log-phrase matching (Chatsune lesson).

## 8. Manual verification (Chris, on the dev stack)

1. `./dev.sh`; register a fresh local-only account in browser A; create a few
   chats with messages, an artefact, an attachment, a persona with avatar.
2. Late-link via invitation (Account → server linking). Observe the status
   line: "Uploading your existing data… N of M" counting up, then "Synced".
3. Verify server-side:
   `docker compose -f infra/compose.dev.yml exec -T postgres psql -U chatsundere -d sync_db -c "SELECT collection, count(*) FROM sync_records GROUP BY collection;"`
   — every populated collection appears; counts match local (built-in
   mindspaces absent); `sync_blobs` carries the avatar/artefact/attachment
   blobs; metrics on `:3201/metrics` show the pushes.
4. Pair browser B; confirm the pre-link chats, artefact images, and persona
   avatar arrive.
5. Mid-backfill interruption: relink a data-heavy account, close the tab at
   ~half progress, reopen — backfill resumes and completes; no duplicate rows
   server-side.
6. Guard: log out (keep local data), open an invitation link — the unlock
   screen appears instead of the join form; unlock → flow continues as
   "Connect this device"; secrets intact afterwards.
7. Degrade: link an account, then wipe the server account (dev reset), let
   the worker cycle — the client shows the "no longer recognises" attention,
   stays logged in locally, chats remain usable; relink via invitation and
   watch the backfill re-upload.

## 9. Delivery constraints (binding for the overnight run)

- Branch `full-backend-transition`; PRs numbered 1..3 in dependency order
  (PR 1 → PR 2 → PR 3; PRs 1 and 2 both touch `confirm.tsx`'s late-link
  branch, so PR 2 stacks on PR 1). NEVER `master`.
- Every repo artefact in British English.
- Subagents never merge, push, or switch branches.
- No Dexie version bump. If one becomes unavoidable, STOP: it is v34 plus the
  ~27 hard-coded `db.verno` assertion sweep — flag it, do not improvise.
- Gates per PR: `pnpm typecheck --force`, full user-client vitest (expect the
  known 8-test Node-localStorage baseline, nothing else), Biome clean.
- Larissa audits PR 1 (sync boundary), PR 2 (crypto flow), PR 3 (auth
  handling); Laura pre-squash on the status line, the guard screen, and the
  degrade attention surface.
