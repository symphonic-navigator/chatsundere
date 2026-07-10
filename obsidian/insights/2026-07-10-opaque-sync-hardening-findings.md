# OPAQUE / Sync hardening — verified findings register

**Date:** 2026-07-10
**Source:** External second-opinion review (Codex, run by a tester), cross-verified
against the real code by four parallel read-only audit passes (Liz).
**Status:** pre-spec. This register is the input to a bundled hardening sprint,
to be closed with a whole-scope Larissa audit.

Every finding below was traced through the actual working tree (branch `master`),
not taken on the reviewer's word. Severities are Liz's re-assessment under
Chatsundere's zero-knowledge / adversarial-server threat model, which in several
places differs from the reviewer's headline. "Logged?" records whether the item
already appears in `security-deferrals.md` or `follow-ups-index.md`.

---

## Severity summary

| # | Finding | Reviewer | Verified | Area | Logged? |
|---|---|---|---|---|---|
| 1 | Linked-online login zeroes the master key (shared buffer) | Critical | **Critical — FIXED in tree** | crypto | no |
| 2 | Unvalidated-collection tombstone wedges pull (adversarial-server DoS) | High | **High** | sync-service + client | no |
| 3 | Username change bricks OPAQUE (client uses live name) | High | **High** | crypto (client-only) | no |
| 4a | Immediate-drain bypasses the Web Lock (root enabler) | High | **Medium** | client sync | no |
| 4b | applyUpsert TOCTOU — local read outside the write tx | High | **Medium** | client sync | no |
| 4c | Push ack overwrites meta without a monotone rev check | High | **Medium** (server-amplifiable) | client sync | no |
| 5 | Logout/lock during pull → silent permanent record skip | High | **Medium** | client sync | no |
| 6a | Blob-collection *records* excluded from epoch re-push | High | **Medium** | client sync | no |
| 6b | Typed blob-upload verdicts ignored, epoch persisted anyway | High | **Medium** | client sync | no |
| 7 | Offline-deferred derived fields can stay local | High | **Low** | client sync | no |
| 8 | OPAQUE login rate-limit bypassable in parallel | High | **Medium** | auth-service | partial (L-B1) |
| 9 | OPAQUE/recovery state consumed non-atomically (GET+DEL) | Med–High | **Medium–High** | auth-service | no |
| 10a | Account enumeration via `wrapped_mk_opaque` null-vs-present | Medium | **Medium** | auth-service | no |
| 10b | Ephemeral OPAQUE setup fallback (restart bricks auth) | Medium | **Medium** | auth-service | yes |
| V | Vector re-embed hole (`embeddingStatus` synced, not device-local) | — | **Medium** (functional) | client sync | no (delete-gap is) |
| R | Online recovery discards the server-issued access token | — | **Medium** | crypto (client) | no |
| P | `recovery_paused` doesn't quiesce the cheap cycle loop | — | **Low** | client sync | partial |
| C | Non-converging conflict at equal (updatedAt, id) | — | **Low** | client sync | no |
| G | Silent 64-page pull cap (cap-and-resume, not lossy) | — | **Low** (observability) | client sync | no |

---

## 1 — Linked-online login zeroes the master key — **Critical — FIXED**

`login-local.ts:124-134` returns a session and an `mk` that share one `Uint8Array`
(`session.ts:66` stores `init.mk` by reference). `login-online-linked.ts` destructured
that shared buffer, called `localSession.close()` (`session.ts:169` → `mk.fill(0)`),
then built the online session **and** returned the key from the now-zeroed buffer.
The boot identity check (`client-data-identity.ts:82`) derives its tag from that
all-zero key → tag mismatch → `wipeClientDataStores()`. A *successful* linked-online
login wiped the local vault. It survived because no green test exercised the `ok`
happy path.

**Fix (applied):** copy the key into a fresh buffer before `close()`
(`login-online-linked.ts` `onlineMk = asMasterKey(mk.slice())`), used for both the
online session and the return value. Regression test added
(`tests/flows/login-online-linked.test.ts`) building a real OPAQUE register+login
round-trip and asserting the online session derives the same DEK as a local login;
verified to fail under the pre-fix code. Crypto suite 210/0, typecheck 14/14, Biome
clean. **Uncommitted** — folded into this sprint so Larissa sees it with the rest.

## 2 — Unvalidated-collection tombstone wedges pull — **High**

Server: the delete branch (`sync-service/src/records/store.ts:114`) runs **before**
the `isSyncCollection` allowlist check (`:149`), and the route schema
(`routes/changes.ts:29`) types `collection` as a bare `v.string()`. A delete of a
fresh `blindId` with `collection: "evil"` is stored as a tombstone with the
attacker-supplied collection and served verbatim to every device on the account
(`toWire`, `changes.ts:50`). Client: on pull, `applyTombstone` →
`findKeyByBlindId` → `listLocalKeys` calls `db.table("evil")` (`apply.ts:287`),
which **throws** (`InvalidTableError`). `runPullLoop`'s per-record `applyRecord`
(`worker.ts:1142`) is inside a `try` with only a `finally`, no `catch`, so the throw
propagates before `advanceWatermark` — the watermark never moves, the poison page
is re-served forever, and the entire pull pipeline is permanently wedged for every
honest device. Within the adversarial-server threat model (sync-spec §12), a
malicious/compromised server can inject this to brick sync on all clients — the very
thing the model must withstand. Scope is one account (sync keyed by `accountId`).

**Fix:** (server) validate `collection` on the delete path too — reject
`bad_collection` before storing; add a picklist to `PushRecordSchema.collection`.
(client, defence-in-depth) guard `db.table()` behind an `isSyncCollection` check and
make an unexpected per-record throw an inert skip that still advances the watermark —
the client must not trust the server.

## 3 — Username change bricks OPAQUE — **High** (client-only fix)

OPAQUE binds the client identifier into the envelope. `opaque/client.ts:63,131` pass
`client: args.username`, and `login-online-linked.ts:86` / `step-up.ts` feed the
**live** `local_account.username`. After a rename, the client authenticates under the
new name while the record was registered under the old one → login/step-up/pairing
fail. The server side is **correct and complete**: every OPAQUE login-ceremony
endpoint reads the frozen `auth_methods.opaque_client_identifier` (migration 0005) —
`login.ts:118`, `step-up.ts:172`, `join.ts:182` — and `me.ts:308-318`
(passphrase-change) deliberately preserves the freeze. So the fix is **purely
client-side**: persist the original OPAQUE client identifier at
registration/link/recovery time (e.g. on the `linked_account` row), and reuse *that*
frozen value in every client OPAQUE ceremony instead of the live username.
`change-username.ts` must not touch it. The STATUS "username-change-bricks-OPAQUE
fixed (migration 0005)" note covered only the server half.

## 4 — Sync push/pull races — **Medium** (4a is the root enabler)

**4a — immediate-drain bypasses the Web Lock.** `triggers.ts:105-107` registers the
immediate drain as a raw `drainOutbox()`; only `runSyncCycle` takes
`SYNC_LOCK_NAME` (`worker.ts:937`). The write-through path
`mutateSynced → immediateDrain → drainOutbox` (`enqueue.ts:198`) runs outside the
lock, so it interleaves with a trigger-driven cycle (same tab) and with other tabs
(cross-tab) → two drains read the same outbox rows, double-push, and race their
`syncRows` write-backs. The module docstring (`triggers.ts:8-10`) is inaccurate. **Fix:**
wrap the immediate drain in the blocking `withSyncLock` (`worker.ts:1007`), not
`withSingleFlight` (which would drop the user's write-through behind a running cycle).

**4b — applyUpsert TOCTOU.** `apply.ts:612` reads the local row, decides the winner
at `:642`, and writes in a *separate* transaction at `:699-703`. A concurrent local
edit (Class-1 append / Class-2 mutate, none holding the lock) between read and write
→ lost update, or device-local fields restored from a stale snapshot. `applyTombstone`
has the same shape (`:504` read outside the `:508` tx). **Fix:** fold read →
`resolveConflict` → write into one `db.transaction`.

**4c — push ack overwrites meta without a monotone rev check.** `applyOk`
(`worker.ts:705-711`) puts `{rev, ciphertextHash}` from the server-returned
`result.rev` unconditionally. A pull can advance `meta.rev` between push and ack
(gated by 4a), and a **malicious server** can return a low `rev` on an `ok` ack
(server-amplifiable). Regressing the CAS base below the watermark → the record is
never re-served → a later edit pushes a stale `baseRev` → perpetual conflict →
**per-key wedge / re-push loop** (no data destruction; availability). **Fix:** inside
the existing tx, `get` current meta and only put when `rev > existing.rev`; mirror in
`applyConflict`'s poison branch.

The reviewer's "lingering conflict-outbox entries" is a **downstream symptom** of
4a+4c, not an independent defect — fixing them closes it.

## 5 — Logout/lock during pull → silent permanent record skip — **Medium**

`closeAndForget` (`session.store.ts:48-52`) synchronously zeroes the MK buffer — the
same `onlineMk` buffer the in-flight pull holds. `applyRecord` captures `mk` at
`apply.ts:451`; the `unavailable` guard (`:457`) only checks `mk === null` **at
capture**. The AEAD decrypt is safe (the key is copied synchronously into an
`importKey` handle before any await), but `openRecord` re-derives the blind id from
the raw `mk` buffer *after* the decrypt await (`seal.ts:106`). If `closeAndForget`
interleaves during that await (user lock/logout, or a foreground 401 →
`closeAndForget`; background 401s correctly latch auth-degraded), the blind-id
re-check reads a zeroed buffer → mismatch → `throw` → `{kind:'rejected'}` (not
`unavailable`). The pull loop bumps `highestApplied` for any non-`unavailable`
outcome (`worker.ts:1152`) and advances the watermark → the falsely-rejected
record's rev is covered and **never re-pulled**. The tombstone path is worse
(`findKeyByBlindId` re-derives after a Dexie await → silent no-op delete). Violates
the no-silent-loss ethos. **Fix:** on the reject/tombstone-miss path, re-read
`useSessionStore.getState().mk`; if now `null`, return `unavailable` so the watermark
holds. Cleaner: snapshot session identity at pull start and discard the page if the
MK went away (mirror the `generationStillCurrent` pattern, `worker.ts:1162`).

## 6 — Epoch recovery blob gaps — **Medium**

**6a — blob-collection records excluded from re-push.** `recovery.ts:96-98` filters
`personaAvatars / artefacts / attachments` out of `REPUSH_COLLECTIONS`;
`enqueueFullRepush` (`:414`) never re-enqueues them; `recoverBlobs` (`:305`)
re-uploads only the binary objects. After an epoch reset that dropped the record
channel, the server ends with orphan blob bytes and **no** referencing records → the
rows never re-converge to other devices (the origin device keeps them locally, so no
local loss). Root cause: a phase-ordering avoidance (a record must not be pushed
before its blob exists, §11.5) that over-reached. **Fix:** after `recoverBlobs`
succeeds (bytes now server-side), run a second re-push pass restricted to the blob
collections, ordered after the blob upload so §11.5 holds.

**6b — typed upload verdicts ignored, epoch persisted anyway.** `recovery.ts:352-356`
discards the `PutBlobResult` from `putBlob`, which by contract never throws on a typed
verdict (409 `blob_exists` / 413 / 507 / 501; `blob-transport.ts:166`). Step 5
(`:275-277`) then persists the new epoch unconditionally → false convergence, and a
`409 blob_exists` (the spec's tamper/divergence signal) is silently swallowed. Content
stays AEAD-authenticated at open (AAD bound to `blobId`), so this is silent-failure /
missed-tamper-signal, **not** a zero-knowledge breach. Contrast the normal drain path,
which routes every verdict through `resolveBlobFailure`. **Fix:** inspect each result;
raise a tamper attention on `blob_exists`, withhold the epoch persist on
quota/too-large/disabled so recovery re-runs. Reuse `resolveBlobFailure`.

## 7 — Offline-deferred derived fields — **Low**

`enqueue.ts:173-184`: the `deferWhenOffline` branch commits in a tx scoped to the data
tables only — no `syncOutbox` entry. `backfill.ts:134-143` excludes any row that has a
`syncRows` CAS base, so these already-synced rows are never picked up. Three background
jobs take this path: chat `title` (`title-generator.ts`), memory
`lastExtractedMessageId` (`memory/repo.ts`), attachment `visionDescription`
(`stream-manager.store.ts`). All three are **derived/cosmetic and self-healing** (peers
regenerate title, re-extract memory, re-describe the image) and **documented design
tradeoffs** (spec §12.1). No adversarial-server relevance; Larissa lens = Informational.
One honest nuance: they do **not** converge on reconnect (only on a later same-key edit,
or for `chats` on epoch recovery) — marginally weaker than the spec's "until
connectivity returns" phrasing. Deferral candidate; if tightened, add a reconnect-time
reconciliation that diffs local rows against `syncRows.ciphertextHash`.

## 8 — OPAQUE login rate-limit bypass — **Medium**

`_rate-limit-helpers.ts:19-32` runs four separate Redis commands (zremrangebyscore →
zcard → check → zadd) with no atomicity. N concurrent `login/start` all read the same
sub-threshold `zcard` before any `zadd` lands → each burst gets ~concurrency×10 guesses
per window (bounded, hence Medium not High). The key is username-only
(`rl:login:username:*`) with **no per-IP backstop** on any login/recovery start
endpoint (the IP `rateLimit` middleware is wired only onto step-up) → username-spraying
from one IP is unthrottled. The username-only half is logged as **L-B1**; the
parallel/TOCTOU bypass is new. **Fix:** (1) make the window update atomic — one Lua
`EVAL` (zrem → zadd → zcard → expire, reject when the post-add count exceeds the
limit); (2) add a per-IP backstop bucket to login/recovery start — but that is only
trustworthy once `TRUST_PROXY_HOPS` lands (spoofable XFF, already tracked).

## 9 — Non-atomic OPAQUE/recovery state consumption — **Medium–High**

`opaque/server.ts:74-76` (`fetchOpaqueState`) does `redis.get()` then `redis.del()`
despite a JSDoc claiming atomicity; consumed by opaque login-finish, step-up
opaque-finish, join-pairing finish, passphrase-change finish. `recovery/nonce.ts:27-29`
(`consumeNonce`) has the same shape. Parallel finish requests can consume the same
state twice. **Duplicate-auth-method consequence is feasible:** `db/schema.ts:93`
indexes `(user_id, method_type)` as a plain `index`, not `uniqueIndex`; under READ
COMMITTED two concurrent recovery-finishes with the same nonce can both pass
`consumeNonce`, each run delete-all-then-insert, and leave **two** `opaque` rows,
poisoning later `.limit(1)` OPAQUE lookups. **Fix:** `redis.getdel(...)` at both sites
(ioredis ^5.4 supports it; already used at `step-up.ts:227` — these are the stragglers)
and fix the lying JSDoc. Defence-in-depth: a partial `uniqueIndex` on
`(user_id, method_type)` (separate schema change).

## 10 — Enumeration + ephemeral setup — **Medium**

**10a — `wrapped_mk_opaque` null oracle.** The fake-ke2 machinery masks the OPAQUE
layer for unknown users, but the sibling wrap fields leak: unknown/suspended →
`login.ts:143-149` returns `wrapped_mk_opaque: null`; active → real base64url blobs
(`:170-176`). A boolean existence oracle requiring no OPAQUE completion; also
distinguishes suspended from active. **Fix:** return realistic decoy blobs (random, or
a per-username deterministic derivation from the server secret) in the fake/suspended
branch — the client never legitimately uses these on a fake session (finish always
401s).

**10b — ephemeral OPAQUE setup.** `opaque/server.ts:27-41`: unset
`OPAQUE_SERVER_SETUP` → per-process setup + `console.warn`; a restart permanently
invalidates all passphrase auth. Guard-railed by the deploy kit + warning, but a warn
is not a guard-rail against a mis-set prod env var. Already bit dev
(`follow-ups-index.md:157`, which names the fix). **Fix (follow-up option b):** throw
when unset unless `NODE_ENV === 'test'` (optional `ALLOW_EPHEMERAL_OPAQUE_SETUP=1`
escape hatch). Converts a silent footgun into a loud boot failure — protects
self-hosters.

## V — Vector re-embed hole — **Medium** (functional)

The reviewer's premise ("vectors enumerate to nothing") is **wrong** — `backfill.ts:112`
enumerates and pushes them. Items 1–2 (no live push path; pulled vectors not
materialised, `apply.ts:602-610`) are **intended** design (peers re-embed rather than
ship vector bytes, spec §12.3). The **real** bug is item 3: `documents` has no
deny-list entry in `sync/strip.ts:66-88`, so `embeddingStatus` is sealed and synced
whole. A document that syncs as `'embedded'` lands on a fresh device as `'embedded'`
with **zero local vectors** and is never re-embedded (`start-ingestion.ts:80-94` scans
only `'pending'`) → **silently unsearchable** on that device. **Fix:** add
`embeddingStatus`, `embeddingError`, `chunkCount` to `DENY_LISTS.documents`, and treat
a pulled document with no local vectors as `pending`. The vectors *delete* direction is
already logged (`follow-ups-index.md:64`, MEDIUM-1).

## R — Online recovery discards the access token — **Medium**

`recovery-online.ts:59` returns `Promise<void>` and discards `finish.access_token`
(the server issues it correctly — `recovery.ts:216-239`). The live caller
(`routes/login/recovery.tsx:179`) then builds an **offline local** session via
`loginLocalWithRecoveryKey` (`login-local.ts:125-134`: `mode:'local'`,
`online:false`, no token). So server-assisted recovery lands the user unauthenticated
for sync; the sibling `recover-from-scratch.ts:233-241` does it right. Not a security
breach (MK intact), a functional regression. **Fix:** return
`{session, mk}` from `recoveryOnline` with `mode:'linked'`, `online:true`,
`accessToken: finish.access_token` (mirror `recover-from-scratch`); update the caller
and the lying `void`/docstring.

## P, C, G — Low / observability

- **P — `recovery_paused` doesn't quiesce the cheap cycle.** `enginePaused`
  (`recovery.ts:169`) is consulted only in `runRecovery` (`:182`); `canRunCycle`
  (`worker.ts:984`) never checks it. The *recovery* loop (the expensive re-push/
  re-upload) is correctly stopped — its job — but drain/pull cycles keep firing under
  a misleading "syncing is paused" label. **Fix:** `if (isEnginePaused()) return false`
  in `canRunCycle` (the export exists, `recovery.ts:226`), or correct the copy.
- **C — equal-(updatedAt, id) non-convergence.** `resolution.ts:74-80`: same record
  edited at the same millisecond on two devices → both resolve `winner:'local',
  repush:false` → permanent divergence. Very low probability; `updatedAt` is inside the
  sealed blob (not server-amplifiable). **Fix:** a deterministic content-intrinsic
  tiebreak both devices compute identically (e.g. on `ciphertextHash`). Deferral
  candidate.
- **G — silent 64-page pull cap.** `PULL_PAGE_CAP = 64` (`worker.ts:1055`) is
  **lossless** (watermark holds; correct anti-pin defence) but silent — a >12,800-record
  first pull looks "done" then trickles in on the next external trigger (up to 10 min).
  **Fix:** on `pages >= cap && more`, schedule an immediate follow-up cycle and/or show
  a "catching up" indicator.

---

## Triage order (recommended)

1. **#1** (done, in tree) — critical, already fixed.
2. **#2** — adversarial-server DoS; server validation + client guard.
3. **#9** — cheap `getdel` fix, closes a duplicate-auth window; **#8** atomic limit.
4. **#4a → #4c → #5** — the sync-race cluster; 4a is the root enabler, 4c is
   server-amplifiable, #5 is silent loss.
5. **#3** (client identifier persistence), **R** (recovery token) — crypto/client.
6. **#6a/#6b**, **V** — recovery/blob + vector convergence.
7. **#10a/#10b** — enumeration decoys + prod hard-fail.
8. **#7, P, C, G** — Low; consciously defer or fold in cheaply.

## Cross-cutting notes

- Nothing here is a plaintext / key-exposure zero-knowledge breach. The heaviest items
  (#1 fixed, #2) are availability/data-loss under the adversarial-server model; the rest
  are convergence, silent-failure, auth-hardening, and observability.
- Workstream seams for a sprint: **auth-service** (#8, #9, #10, schema uniqueIndex) is
  a Larissa-mandatory path, disjoint from the **client sync engine** (#2-client, #4, #5,
  #6, #7, V, R, P, G) and **crypto** (#1 done, #3). The sync-service change for #2 is
  small and pairs with the client guard.
- Several fixes are one-liners (#9 getdel, 4c monotone guard, P canRunCycle, V
  deny-list); the sync-race tx-folding (#4b) and epoch re-push (#6a) are the meatier
  pieces.
