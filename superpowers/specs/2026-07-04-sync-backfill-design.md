# Sync Backfill, Fresh-Join Guard, and 401 Degrade-to-Offline — Design

**Date:** 2026-07-04
**Status:** v2 — Larissa spec-pass (2 High / 4 Medium / 2 Low, all folded) and
Laura spec-pass (4 hard / 4 soft, all folded or resolved) complete; approved by
Chris (brainstorm + arbitration 2026-07-03 late night). Findings tagged
`[L-n]`/`[U-n]` where they shaped a section.
**Branch target:** `full-backend-transition` — every PR targets this branch, NEVER `master`
**Delivery:** overnight remote execution, numbered PRs (see §10)

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
  It means "*some past server account* has this row", NOT "*the current
  link* has it" — the two diverge after a relink, which is why §3.2 resets
  it at link time `[L-1]`.
- **`recovery.ts` already contains the enqueue-everything primitive**
  (`enqueueFullRepush`, `sync/recovery.ts:380`) and the blob re-upload pattern
  (`recoverBlobs`, `sync/recovery.ts:276`). The backfill reuses these shapes
  rather than inventing a parallel path.
- **The drain orders blob PUTs before records** and handles CAS, byte-batching
  (4 MiB), conflicts, and poison adoption. It does **NOT** cap record count:
  `batchByBytes` splits by bytes only (`sync/seal-batch.ts:16` — "never by
  count"), while the server rejects a whole request above
  `MAX_PUSH_RECORDS` 100 (`apps/sync-service/src/routes/changes.ts:132`).
  This latent gap never fired because live edits drain per-key; the backfill
  is the first bulk path and must close it `[L-2]`.
- Server-side limits: `RATE_LIMIT_USER_PER_MIN` 120, quota 2 GiB,
  `MAX_RECORD_BYTES` per record.
- **The sync epoch is server-instance-wide, not per-account**
  (`instance_epoch`, minted once at first migration). Deleting and re-creating
  an *account* does not change it — so epoch recovery does NOT fire on a
  relink to the same server, and revs/watermarks (which ARE per-account)
  silently mismatch instead `[L-1]`.
- **The client has no `bad_since` handling** — a pull whose `since` exceeds
  the account's head returns 400 `bad_since`
  (`apps/sync-service/src/routes/changes.ts:201`) and today the cycle just
  throws `[L-1]`.
- **`SyncStatusLine` is mounted in exactly one place** — the
  `Account → server-linking` settings page (`server-linking.tsx:106`). There
  is no global sync surface in the app chrome `[U-1]`/`[U-2]`.
- **The local login navigates to `/app` unconditionally**
  (`login/index.tsx:144` passphrase, `:222` biometric); the
  `?return=`/`navTarget` mechanics exist only on the onboarding routes
  `[U-3]`.

## 2. Scope

Three numbered PRs against `full-backend-transition`:

| PR | Unit | Size |
|----|------|------|
| 1 | Same-MK sync backfill for the invitation late-link path, link-time engine reset, minimal global sync line | L |
| 2 | Fresh-join guard (UI routing + crypto backstop), login `?return=`, start-over exit, replace-link confirm | M |
| 3 | 401 degrade-to-offline, refusal classifier, refresh single-flight | M |

**OUT of scope:** foreign-MK uplevelling (pairing onto a device with existing
local data — stays deferred; the crypto guard refuses it today,
`join-by-pairing.ts:152`; the stale UI comment at `pairing/confirm.tsx:34`
claiming "Phase 0 accepts the local-data replacement" is corrected in passing
`[L-7]`); any server-side change; any Dexie version bump (v33 is owned by the
sync engine and suffices — see §3.1).

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

`SyncOutboxRow` gains an optional terminal marker (see §3.4, `[L-6]`) — also
non-indexed.

### 3.2 Trigger and the link-time engine reset `[L-1]`

The late-link success path in `confirm.tsx` (the branch that calls
`useAccountLinkStore.setLinked`) runs, in order:

1. **Reset the per-link engine state:** clear `syncRows` and `syncOutbox`,
   set `watermarkRev = 0`, set `epoch = null`, clear any sync attention.
   An invitation join ALWAYS binds to a fresh, empty server account, so this
   is unconditionally correct — and it makes the §3.4 predicate trivially
   sound. For a first-ever link the tables are empty and it costs nothing.
   For a RE-link (the L-1 scenario: server forgot the account, user
   reconnects) it prevents three failure modes at once: the stale watermark's
   `bad_since` on first pull, stale CAS bases, and — the data-stranding one —
   the predicate silently skipping every row the *old* account had synced,
   leaving the new vault permanently incomplete while the line reads
   "Synced".
2. Set `backfillPending = true`, then kick a sync cycle.

No other flow sets the flag: fresh join, pairing join, and
recover-from-scratch have no pre-link local data to upload.

**`bad_since` handling** (client-side, same PR): a 400 `bad_since` on pull is
an authenticated signal that the watermark is ahead of the account's head —
treat it exactly like an authenticated epoch mismatch and hand off to
recovery. The server spec prescribes this; the client never implemented it.
This is defence-in-depth behind the reset, not a substitute for it.

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
3. **Per chunk:** select up to **100 un-synced rows** (no `syncRows` entry,
   built-ins filtered, terminally-refused keys excluded `[L-6]`) — the chunk
   size ≤ `MAX_PUSH_RECORDS`, because the server rejects a whole request
   above 100 records `[L-2]` — enqueue them as payload-free outbox upserts
   in ONE small Dexie transaction — for the three blob-bearing collections
   also `enqueueBlobPut` for refs whose bytes are locally present, in the
   SAME transaction — then `drainOutbox()`, then advance `backfillDone`.
4. **Between chunks:** abort checks — offline, locked, engine paused, drain
   failure. On abort the pump ends the cycle; the flag survives; the next
   trigger resumes.
5. **Nothing left in any collection** (terminally-refused keys do not count
   as remaining `[L-6]`): clear the flag, null the counters. The status line
   falls back to its normal vocabulary.

**Drain-side count cap `[L-2]`:** independently of the pump's chunk size,
`batchByBytes` gains a record-count ceiling (≤ 100 per batch) so the
invariant lives in the drain and every future bulk path inherits it. The
"never by count" comment in `seal-batch.ts` is corrected.

### 3.4 Idempotency, resume, and termination

The predicate "row without a `syncRows` entry" is the single source of truth;
every run recomputes the remainder. Sound because §3.2's reset guarantees
`syncRows` reflects the *current* link. Consequences, each deliberate:

- A crash mid-chunk leaves outbox rows; the boot-reconcile drain pushes them,
  `syncRows` fills, and the next pump run does not re-enqueue them. Even a
  double-push is a harmless idempotent CAS push.
- Rows synced live between link and backfill are skipped by the predicate; a
  genuine conflict rides the existing §7 resolution.
- Quota exhaustion and rate-limit responses surface through the existing
  drain/attention mechanics. The flag survives; the backfill resumes when the
  condition clears. No new error surface.
- **Terminal refusals `[L-6]`:** a record the server refuses terminally
  (`record_too_large`) must not wedge the backfill — without a disposition,
  the outbox entry is retried every cycle, `syncRows` never fills, and the
  flag never clears ("Uploading… N of M" forever). Mirror the oversize-blob
  sentinel: mark the outbox entry terminally refused (excluded from drain
  selection and from the §3.3 remainder), surface the existing attention
  state naming the affected item, and let the flag clear. The sentinel is
  inspectable (diagnostics) and cleared if the row is later edited smaller
  (the edit enqueues afresh).

### 3.5 What deliberately rides the existing machinery

Device-local strip (seal path), coalescing with live edits (outbox coalesces
per `[collection+key]`), conflict resolution, byte-batching, poison adoption
(M-1), blob PUT-before-record phase ordering, and PR 3's degrade behaviour on
background 401s.

### 3.6 Special cases

- **Built-in mindspaces never sync** (engine spec §12.5), enforced on BOTH
  sides `[L-8]`:
  - *Push:* the backfill filters `builtIn: true`; the same filter is added to
    `enqueueFullRepush()` in `recovery.ts` — a latent gap found during this
    design (no `builtIn` reference exists anywhere under `sync/`).
  - *Apply:* a pulled `mindspaces` record with `builtIn: true` is ignored
    (inert), making the invariant two-sided and rendering any built-in
    records already sealed server-side by past recoveries harmless (built-in
    uuids are per-device; without the guard they would pull as duplicate
    inserts).
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

### 3.7 UX — the minimal global sync line `[U-1]`/`[U-2]`/`[U-5]`

**Decision (Chris, 2026-07-03, revising WS-C decision 2 / SOFT-3):** the
"global sync-attention surface deferred to the design-language pass" call is
consciously revised, not ignored. Backfill progress and the PR 3 degrade
attention only carry their value if visible where the user actually is — and
the user is navigated to `/app` the moment linking succeeds, while the only
`SyncStatusLine` mount lives on the buried server-linking settings page.

**The surface:** one deliberately plain single-line element in the app
chrome — calm, non-modal, collapsible to a dot; the design-language pass
restyles it later. It renders ONLY:

- the backfill progress entry (below), and
- sync **attention** states (quota, `recovery_paused`,
  `blob_reupload_threshold`, and PR 3's `auth_degraded` with its relink
  affordance).

Everything else (pulling, waiting, fetching, synced) stays where it is today
— the line simply does not render, and the chat keeps its centre.

**The backfill vocabulary entry:** visible while `backfillPending`:

> **Uploading your existing data… N of M**

`N = backfillDone`, `M = backfillTotal`. `M` is a one-off snapshot of
existing data; rows created during the backfill ride the live outbox and are
not counted `[U-8]`. On interruption the line yields to the standard
offline/locked presentation with a short reassurance that the upload resumes
by itself `[U-6]`; on completion the line disappears.

**Precedence, pinned `[U-5]`:** Recovery / Attention / Pulling / Offline rank
**above** the backfill entry; the backfill entry ranks **above** Waiting /
Fetching / Synced. Attention outranking backfill is load-bearing: the bulk
upload is precisely the moment a quota attention is most likely, and the
progress line must never mask it.

Rationale for the interleaved pump making a dedicated entry necessary: the
pump keeps the outbox small, so the existing "N changes waiting" would read a
misleading constant ~100.

## 4. PR 2 — Fresh-join guard

Two layers plus two exits, one PR.

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
  back into the invitation flow. After unlock the SAME flow continues as a
  clean late-link: same code, same destination, MK preserved — and, thanks
  to PR 1, followed by the backfill.
- **Login honours `?return=` `[U-3]`:** today `login/index.tsx` navigates to
  `/app` unconditionally on BOTH success paths (`:144` passphrase, `:222`
  biometric) and the `navTarget` mechanics are scoped to the onboarding
  routes. Without this, the promised continuation cannot happen — the user
  unlocks, lands on the chat, and must re-find the invitation link. Both
  login success paths gain validated return-URL handling (same-origin
  relative paths only, the existing `navTarget` discipline).

### 4.2 Crypto backstop (stop-the-line insurance)

`finishJoinByInvitation` checks `getLocalAccount(args.db)` FIRST: if a row
exists it throws `CryptoError('local_account_exists')` before any MK minting
and before any server call. The silent overwrite via
`putLocalAndLinkedAccount` becomes structurally unreachable regardless of any
future UI regression. The confirm screen maps the error (should it ever
surface) to a message pointing at the local login, not a generic failure.

This closes the LAST unguarded account-minting flow `[L-9]`:
`create-local-account.ts:67`, `join-by-pairing.ts:152`, and
`recover-from-scratch.ts:91` all carry the fresh-device guard already.

Detail: the backstop throws before `/join/finish` consumes the one-time
invitation code (verified: the code is redeemed only at finish,
`apps/auth-service/src/routes/join.ts:330`) — a refused attempt burns
nothing; the open join session on the server expires harmlessly.

### 4.3 No fresh-start escape hatch in the JOIN flow — but an honest exit at LOGIN `[U-4]`

Deliberate (Chris, 2026-07-03), refined by the audits: no "start fresh"
branch inside the invitation flow (Larissa L-9 endorses this — the place
where data was lost does not get a delete affordance). But the user who has
lost BOTH passphrase and recovery key — precisely the cohort the guard
protects — currently has NO reachable exit from the login screen: the
onboarding matrix ("Just this device") only renders when no local account
exists, and no reset affordance is reachable from the locked state.

So the login screen gains a restrained **"Start over on this device"** path:
typed confirmation, honest copy — *"This erases everything on this device
and starts over. A synced server account is separate and is not touched."*
No-recovery stays a feature; the terminal state gets a named, constructive
door instead of a dead-end.

### 4.4 Replace-link confirmation `[L-7]`

The detection matrix in §4.1 covers "account + no session". The third cell —
account + **active session** + **already linked** — must not silently
re-point the device: today an unlocked, already-linked device opening an
invitation deep-link would sail down the late-link branch and
`putLinkedAccount` would overwrite the primary link row without
acknowledgement (and PR 1 would then backfill the vault to the new server).
Confidentiality holds (ciphertext under the user's MK), but replacing the
link is a decision, not a side effect: an explicit confirm screen names the
current server and the new one and asks. On confirmation the flow proceeds
as a late-link INCLUDING the §3.2 engine reset (the reset composes: new
link, fresh predicate, full backfill to the new server).

## 5. PR 3 — 401 degrade-to-offline

### 5.1 Principle

Background requests must never destroy the local session. Only the user
(logout) or a user-initiated auth flow may trigger `closeAndForget()`.

### 5.2 Mechanics

- `apiFetch` gains an option `origin: 'user' | 'background'`, default
  `'user'` so existing call sites are untouched. The engine paths mark
  themselves `'background'`: sync push/pull, doorbell ticket, blob transport,
  quota, and any other worker-initiated request.
- **The refusal classifier lives in `refreshAccessToken`, for BOTH origins
  `[L-3]`/`[L-5]`:** a refresh failure is a *definitive refusal* only when
  the response carries a **parsed auth error envelope** with a refusal code
  (`invalid_token`, `reuse_detected`, account-gone — the codes the auth
  service actually emits). Everything else — network errors, 5xx, 429, AND
  unparseable/unexpected 4xx (a misrouted proxy answering with an HTML 404
  must not wedge the engine) — is *suspect/unreachable*: retried with
  backoff, riding the existing connectivity handling, degrading nothing and
  destroying nothing.
- **Only the ACTION differs by origin:**
  - definitive refusal + `'background'` → typed `AuthDegradedError`,
    persistent `auth_degraded` attention, engine stops. NO `closeAndForget()`.
  - definitive refusal + `'user'` → today's logout semantics
    (`closeAndForget()` + route to login) — the user actively hit a dead
    session.
  - non-definitive failure + ANY origin → NO session destruction. This
    fixes the current behaviour where a user-origin request during an
    auth-service restart destroys the MK session (`fetch.ts:119`/`126`
    trigger on any `!res.ok` and any network throw) `[L-5]`.
- **Refresh is single-flighted `[L-4]`:** one in-flight refresh promise
  shared by all callers. Without it, two parallel background 401s (doorbell,
  blob transport, quota run outside the sync cycle's single-flight) race the
  rotating refresh token and the loser manufactures a genuine-looking
  `reuse_detected` — the client degrades itself with no server misbehaviour.
- **While degraded:** the engine stops (the gate treats `auth_degraded` like
  offline; Class-2 affordances disable-over-hide). Local work continues
  unrestricted — the user loses nothing. User-origin requests keep flowing.
- **Attention copy** (the dere half), rendered on the §3.7 global line:
  *"This server no longer recognises this device. Your data is safe here —
  reconnect with a new invitation when you're ready."* with an affordance
  into the invitation flow — which PR 2 routes cleanly (in-session +
  linked → the §4.4 replace-link confirm; the guard does not fire because
  the session is alive) and PR 1 then backfills after the §3.2 reset. The
  three PRs close the loop on the exact scenario that cost Chris his
  provider secrets.
- **Recovery from the state:** a successful user-initiated auth flow (login,
  relink) clears it; so does a later successful refresh riding a
  user-initiated request.

### 5.3 Security posture (Larissa's lane)

Preserving the local session despite server refusal is sound: the MK and the
local data are the local trust domain; the server never had authority over
them ("degrade-over-destroy is the model working" — Larissa). No background
bearer requests are sent while degraded — the engine stops.

## 6. Error handling summary

| Failure | Behaviour |
|---|---|
| Crash/tab-close mid-backfill | Flag survives; outbox drains at boot; pump resumes on next cycle |
| Offline / locked mid-backfill | Pump aborts the cycle; resumes on the next trigger; line reassures it resumes |
| Quota exceeded during backfill | Existing quota attention (outranks progress line); flag survives; resumes when cleared |
| Rate-limited (429) | Drain surfaces the failure; pump stops this cycle; timer/trigger retries |
| `record_too_large` | Terminal sentinel on the outbox entry; attention names the item; backfill completes past it |
| Server already has a row (same link) | `syncRows` predicate skips it; true conflicts ride §7 resolution |
| Relink to a new server account | §3.2 engine reset → clean predicate, full backfill; `bad_since` → recovery as backstop |
| Join attempted over existing local account | UI reroutes to unlock (PR 2); crypto backstop throws as last line |
| Invitation opened while linked + unlocked | Explicit replace-link confirm; on confirm: reset + late-link + backfill |
| Passphrase AND recovery key lost | "Start over on this device" at login — typed confirmation, honest copy |
| Background 401 + refusal envelope | `auth_degraded` attention; session preserved; engine stopped (PR 3) |
| Background 401 + refresh unreachable/suspect | Backoff + existing offline handling; no degrade, no logout |
| User-origin request during auth-service outage | NO logout (today it destroys the session); failure surfaces, session lives |

## 7. Testing

- **Backfill (vitest):** pump enumeration predicate (syncRows diff, built-in
  filter, vectors from knowledge DB, terminal-sentinel exclusion); chunk size
  ≤ 100 and the `batchByBytes` count ceiling; chunk transaction atomicity
  (records + blob-puts together); resume after simulated abort at every phase
  boundary; flag lifecycle (set → progress → terminal-refusal → clear);
  link-time engine reset (syncRows/outbox cleared, watermark 0, epoch null) —
  including the relink scenario: rows synced under an old account are
  re-enqueued after reset; `bad_since` → recovery handoff; status-line
  precedence (attention outranks backfill progress); recovery's
  `enqueueFullRepush` built-in filter and the apply-side built-in guard.
- **Guard:** crypto flow throws with a local account present and performs no
  network call; UI routing for both routes (redirect with account-no-session,
  pass-through for fresh device and for active late-link); login honours a
  validated `?return=` on passphrase AND biometric paths; replace-link
  confirm appears for the linked+unlocked cell and its confirm path runs the
  engine reset; start-over exit requires typed confirmation.
- **401 degrade:** refusal classifier on parsed envelope codes — refusal
  degrades (background) / logs out (user); HTML-404, 5xx, 429, network error
  → no destruction for either origin; refresh single-flight (two concurrent
  401s → one refresh call); degraded engine sends no background requests;
  user-origin success clears the state.
- Structural assertions, not log-phrase matching (Chatsune lesson).

## 8. Manual verification (Chris, on the dev stack)

1. `./dev.sh`; register a fresh local-only account in browser A; create a few
   chats with messages, an artefact, an attachment, a persona with avatar.
2. Late-link via invitation. Observe the NEW global line in the app chrome:
   "Uploading your existing data… N of M" counting up, then disappearing.
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
7. Degrade + relink (the L-1 scenario, done WITHOUT a full dev reset — a full
   reset re-mints the instance epoch and would mask the defect): delete ONLY
   the account server-side, let the worker cycle — the client shows the "no
   longer recognises" attention on the global line, stays logged in locally,
   chats remain usable. Relink via a new invitation → the replace/link flow
   runs the engine reset → the backfill re-uploads EVERYTHING (verify
   server-side counts match the full local dataset, not just the delta).
8. Start-over exit: on the login screen, verify the "Start over on this
   device" path demands typed confirmation and its copy names what is erased.

## 9. Deferrals

None. Every audit finding was folded (Chris, 2026-07-03): Larissa L-1–L-8
into §§3–5 as tagged; Laura U-1/U-2 (global line, §3.7), U-3 (login return,
§4.1), U-4 (start-over exit, §4.3), U-5 (precedence, §3.7), U-6 (resume
reassurance, §3.7). U-7 was verified sound during the audit (degrade → guard
flow graph has no contradictory state; `putLinkedAccount` overwrites by fixed
key). U-8 accepted as designed (snapshot semantics documented in §3.7).

## 10. Delivery constraints (binding for the overnight run)

- Branch `full-backend-transition`; PRs numbered 1..3 in dependency order
  (PR 1 → PR 2 → PR 3; PRs 1 and 2 both touch `confirm.tsx`'s late-link
  branch, so PR 2 stacks on PR 1; PR 3's attention renders on PR 1's global
  line, so PR 3 stacks on PR 2). NEVER `master`.
- Every repo artefact in British English.
- Subagents never merge, push, or switch branches.
- No Dexie version bump. If one becomes unavoidable, STOP: it is v34 plus the
  ~27 hard-coded `db.verno` assertion sweep — flag it, do not improvise.
- Gates per PR: `pnpm typecheck --force`, full user-client vitest (expect the
  known 8-test Node-localStorage baseline, nothing else), Biome clean.
- Larissa audits the built diffs of all three PRs (PR 1: sync boundary +
  engine reset; PR 2: crypto flow + return-URL validation; PR 3: refusal
  classifier + single-flight). Laura pre-squash on the global line, the guard
  screen, the start-over exit, the replace-link confirm, and the degrade
  attention surface.
