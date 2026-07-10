# OPAQUE / Sync hardening sprint (design)

## 1. Why

An external second-opinion review (Codex, run by a tester) flagged one critical
data-loss bug and a spread of auth, recovery, and concurrency issues in the
OPAQUE and sync stack, ahead of the v0.2.0 backend go-live. Every claim was
cross-verified against the real code by four parallel read-only audit passes; the
consolidated, severity-recalibrated register is
[[../../obsidian/insights/2026-07-10-opaque-sync-hardening-findings]] (read it
alongside this spec — it carries the full per-finding evidence and `file:line`
trail; this spec is the fix contract).

Headline: **nothing here is a zero-knowledge or plaintext/key breach.** The
heaviest items are availability / data-loss under the adversarial-server model
(#1, already fixed in tree; #2) and a cluster of convergence, silent-failure,
auth-hardening, and observability gaps. The zero-knowledge foundation itself
holds. Chris's call: **fix everything, defer nothing**, in one bundled sprint
closed by a whole-scope Larissa audit.

This work **blocks the v0.2.0 push** — #1 was silent vault loss and #2 is an
adversarial-server denial-of-service on the very sync engine we are about to
make live.

## 2. Guiding principles (settled with Chris)

- **Fix everything in the register.** No Low is deferred; the cheap ones ride
  along, the two documented tradeoffs (#7 convergence, C equal-timestamp) are
  *tightened*, not shipped as-is.
- **The client never trusts the server.** Every server-driven value that steers
  local state (collection names, ack revs, blob verdicts) is validated
  client-side; an unexpected server input becomes an inert, watermark-preserving
  skip, never a crash or a silent loss.
- **No silent loss, ever** — the *dere* ethos at the mechanism level. A record
  that cannot be applied holds the watermark so it is re-pulled; it is never
  covered by an advancing watermark on a false rejection.
- **Atomic consume, atomic count.** Single-use server state and rate-limit
  windows are consumed/updated in one Redis round-trip, not read-then-write.
- **British English** throughout (code, comments, copy, tests).
- **One squash per workstream** (three feature units), Larissa over all three
  before any squash.

## 3. Workstream A — server (auth-service + sync-service) · Larissa-mandatory

### 3.1 #2 (High) — reject unvalidated-collection tombstones (server half)

`apps/sync-service/src/records/store.ts`: the delete branch (`:114`) runs before
the `isSyncCollection` allowlist check (`:149`), so a delete of a fresh `blindId`
with an arbitrary `collection` is stored as a tombstone and served to every
device. **Fix:** hoist the `isSyncCollection(record.collection)` check above the
delete branch so `bad_collection` is returned before any store, on *both* the
delete and non-delete paths. Add a Valibot picklist to
`PushRecordSchema.collection` (`routes/changes.ts:29`) from the shared
`SYNC_COLLECTIONS` list so the route rejects the shape at the boundary too
(defence in depth — the store check is the wall, the schema is the fence). The
client-side guard is §4.1.

### 3.2 #9 (Medium–High) — atomic OPAQUE / recovery state consumption

Two sites do `redis.get()` then `redis.del()` despite JSDoc claiming atomicity:
`opaque/server.ts:74-76` (`fetchOpaqueState`, consumed by opaque login-finish,
step-up opaque-finish, join-pairing finish, passphrase-change finish) and
`recovery/nonce.ts:27-29` (`consumeNonce`). Parallel finishes can consume the same
state twice. **Fix:** replace both with `redis.getdel(...)` (ioredis ^5.4 supports
it; already used at `step-up.ts:227`), and correct the JSDoc to stop claiming an
atomicity the old code never had.

### 3.3 #9 defence-in-depth — unique auth-method index

`db/schema.ts:93` indexes `(user_id, method_type)` as a plain `index`. Combined
with the GET+DEL window, two concurrent recovery-finishes can leave two `opaque`
rows for one user, poisoning later `.limit(1)` OPAQUE lookups. **Fix:** a new
migration adds a `uniqueIndex` on `(user_id, method_type)`. *(Open question 5 —
partial vs full, and whether any legitimate flow relies on two rows of the same
type. Verify no seed/test path inserts duplicates before landing the constraint.)*

### 3.4 #8 (Medium) — atomic, IP-backstopped login rate limit

`_rate-limit-helpers.ts:19-32` runs four separate Redis commands
(zremrangebyscore → zcard → check → zadd) with no atomicity, so N concurrent
`login/start` all read the same sub-threshold count. The key is username-only
(no per-IP backstop on login/recovery start; the IP `rateLimit` middleware is
wired only onto step-up — logged as L-B1). **Fix, two parts:**
1. **Atomicity** — one Lua `EVAL` doing zrem(expired) → zadd(now) → zcard →
   pexpire, returning the post-add count; reject (and `zrem` the just-added
   member, or check-before-add inside the script) when it exceeds the limit.
   Single site: `_rate-limit-helpers.ts`.
2. **Per-IP backstop** — add an IP bucket to the opaque/passkey/recovery start
   endpoints (`login.ts:74`, `:275`; `recovery.ts:59`) reusing `rateLimit`/`ipKey`.
   *(Open question 3 — this is only trustworthy once `TRUST_PROXY_HOPS` lands
   (spoofable XFF, already tracked, owed before go-live per STATUS). Land the IP
   bucket now behind the same env, or sequence it with `TRUST_PROXY_HOPS`?)*

### 3.5 #10a (Medium) — close the `wrapped_mk_opaque` enumeration oracle

Unknown/suspended users get `wrapped_mk_opaque: null` (`login.ts:143-149`); active
users get real blobs (`:170-176`) — a boolean existence oracle the fake-ke2 was
meant to prevent. **Fix:** in the fake/suspended branch return realistic **decoy**
blobs of the correct shape instead of `null`. Derive them **deterministically
per-username** from the server setup/secret (HMAC(server-secret, username) →
sized base64url) so the decoy is stable per username (no "different decoy each
call" tell) and indistinguishable from a real wrap without the passphrase. The
client never legitimately uses these on a fake session — finish always 401s
(`login.ts:193-196`, `:231-235`) — so decoys are safe. Fold suspended users into
the same shape as active so suspension is not distinguishable at start either.

### 3.6 #10b (Medium) — hard-fail on missing OPAQUE setup outside tests

`opaque/server.ts:27-41`: an unset `OPAQUE_SERVER_SETUP` silently generates a
per-process setup (a restart then permanently invalidates all passphrase auth).
**Fix (follow-up option b):** `getServerSetup` throws when `OPAQUE_SERVER_SETUP`
is unset unless `NODE_ENV === 'test'`, with an explicit
`ALLOW_EPHEMERAL_OPAQUE_SETUP=1` escape hatch for deliberate throwaway local runs.
Converts a silent prod footgun into a loud boot failure — protects self-hosters.
Retire the `./dev.sh`-only workaround note once this lands.

### 3.7 Server-side confirmations (no change needed)

Verified complete during the audit, recorded here so the client fixes can rely on
them: every server OPAQUE login-ceremony reads the frozen
`opaque_client_identifier` (login/step-up/pairing), and `recovery/finish` issues a
full `access_token` + refresh cookie. So #3 and R are **client-only** fixes.

## 4. Workstream B — client sync engine

### 4.1 #2 (High) — guard `db.table()` and never crash the pull loop (client half)

`apply.ts:287` calls `db.table(collection)` which throws on an unknown table;
`worker.ts:1142`'s per-record `applyRecord` sits in a `try/finally` with **no
`catch`**, so the throw escapes before `advanceWatermark` → permanent wedge.
**Fix:** (a) guard `readLocalRow`/`listLocalKeys`/`findKeyByBlindId` behind an
`isSyncCollection` check, treating an unknown collection as an inert per-record
skip; (b) wrap `applyRecord` in `runPullLoop` so *any* unexpected throw becomes a
logged `{kind:'rejected-inert'}` that **still advances the watermark** for that
record (the server can't be allowed to wedge the loop with a malformed page). Pair
with §3.1.

### 4.2 #4a (Medium, root enabler) — immediate drain under the Web Lock

`triggers.ts:105-107` registers the immediate drain as a raw `drainOutbox()`
outside `SYNC_LOCK_NAME`. **Fix:** wrap it in the blocking `withSyncLock`
(`worker.ts:1007`), *not* `withSingleFlight` (which would silently drop the user's
write-through behind a running cycle). Correct the inaccurate docstring
(`triggers.ts:8-10`). *(Open question 1 — the trade-off: an immediate drain then
waits behind a long pull. Acceptable, and strictly safer than the current hazard;
confirm.)*

### 4.3 #4b (Medium) — fold applyUpsert read+resolve+write into one transaction

`apply.ts:612` reads the local row, resolves the winner at `:642`, and writes in a
*separate* tx at `:699-703` → a concurrent local edit between read and write
causes a lost update. `applyTombstone` has the same shape (`:504` read outside the
`:508` tx). **Fix:** fold local-read → `resolveConflict` → write into a single
`db.transaction` per record so read and put serialise on the same table.

### 4.4 #4c (Medium, server-amplifiable) — monotone rev guard on acks

`applyOk` (`worker.ts:705-711`) puts `{rev, ciphertextHash}` from the
server-returned `result.rev` unconditionally — a low rev (concurrent pull, or a
malicious ack) regresses the CAS base below the watermark → per-key wedge. **Fix:**
inside the existing tx, `get` current meta and put only when `rev > existing.rev`;
otherwise drop the stale ack entirely (do not clobber the newer hash). Mirror the
guard in `applyConflict`'s poison branch (`:764-771`). This also closes the
"lingering conflict-outbox" symptom, which is downstream of 4a+4c.

### 4.5 #5 (Medium) — hold the watermark when the MK vanishes mid-pull

`closeAndForget` (`session.store.ts:48-52`) zeroes the `onlineMk` buffer the
in-flight pull holds; the `unavailable` guard (`apply.ts:457`) only checks
`mk === null` at capture, so a blind-id re-check after the decrypt await
(`seal.ts:106`) reads a zeroed buffer → `throw` → `{kind:'rejected'}` (not
`unavailable`), and the pull loop advances the watermark past a record it never
actually rejected. **Fix (preferred):** in `runPullLoop`, snapshot session
identity at start and re-check "session still open" after each `applyRecord`
(mirror `generationStillCurrent`, `worker.ts:1162`); if the MK went away, discard
the page without advancing. Belt-and-braces: on the reject / tombstone-miss path
re-read `useSessionStore.getState().mk` and return `unavailable` if now `null`.
Correct the misleading comment at `session.ts:88-92`.

### 4.6 #6a (Medium) — re-push blob-collection records after epoch recovery

`recovery.ts:96-98` excludes `personaAvatars/artefacts/attachments` records from
the epoch re-push; only the binary bytes climb back up (§11.5 phase-ordering
avoidance that over-reached). **Fix:** after `recoverBlobs()` succeeds (bytes now
server-side), run a second re-push pass restricted to the blob collections,
ordered *after* the blob upload so a record never precedes its bytes. Reuse the
`enqueueFullRepush` machinery scoped to `BLOB_COLLECTIONS`.

### 4.7 #6b (Medium) — honour typed blob-upload verdicts in recovery

`recovery.ts:352-356` discards each `PutBlobResult`; step 5 (`:275-277`) then
persists the new epoch unconditionally → false convergence, and a `409 blob_exists`
(the tamper signal) is swallowed. **Fix:** inspect each result; on `blob_exists`
raise a tamper-class attention; on `quota_exceeded`/`blob_too_large`/
`blobs_disabled` withhold the step-5 epoch persist (leave it unpersisted so
recovery re-runs). Reuse `resolveBlobFailure` to unify with the drain path.

### 4.8 V (Medium) — keep `embeddingStatus` device-local so peers re-embed

`documents` has no deny-list entry (`sync/strip.ts:66-88`), so `embeddingStatus`
syncs whole; a document arriving as `'embedded'` lands on a fresh device with zero
local vectors and is never re-embedded (`start-ingestion.ts:80-94` scans only
`'pending'`) → silently unsearchable. **Fix:** add `embeddingStatus`,
`embeddingError`, `chunkCount` to `DENY_LISTS.documents`, and have the pulled-
document apply path treat a document with no local vectors as `pending` so
re-embedding fires. *(Design note — the intended one-directional-vectors model
(peers re-embed, don't ship vector bytes) is preserved; this only stops the status
field from lying about local state. No Dexie bump — deny-list-only field
disposition change.)*

### 4.9 #7 (Low) — reconnect-time reconciliation for deferred derived fields

`enqueue.ts:173-184`'s `deferWhenOffline` branch commits with no outbox entry;
`backfill.ts:134-143` excludes already-synced rows → chat `title`, memory
`lastExtractedMessageId`, attachment `visionDescription` never converge on
reconnect (only on a later same-key edit). **Fix (tightening, not shipping the
tradeoff):** add a reconnect-time reconciliation pass invoked from `runSyncCycle`
(`worker.ts:935`) that diffs each already-synced local row against its
`syncRows.ciphertextHash` and enqueues the divergent keys. This is the general
mechanism that also subsumes any future deferred-field drift. *(Open question 2 —
this pass costs a hash comparison per row on every reconnect; scope it to the three
known deferred fields, or run it corpus-wide? Recommend corpus-wide but batched, so
it is a real convergence guarantee rather than a special-case.)*

### 4.10 P (Low) — make `recovery_paused` quiesce the cycle

`canRunCycle` (`worker.ts:984`) never checks `enginePaused`; the expensive recovery
loop is stopped but cheap drain/pull cycles churn under a "syncing is paused"
label. **Fix:** `if (isEnginePaused()) return false` in `canRunCycle` (the export
exists, `recovery.ts:226`), matching the documented "STOP the engine" intent.

### 4.11 C (Low) — deterministic tiebreak at equal (updatedAt, id)

`resolution.ts:74-80`: the same record edited at the same millisecond on two
devices → both resolve `winner:'local', repush:false` → permanent divergence.
**Fix:** when `updatedAt` and `id` are equal, tiebreak on a content-intrinsic
value both devices compute identically — the `ciphertextHash` (lexicographic).
Higher hash wins and `repush:true` on the loser so it converges regardless of pull
order. *(Open question 4 — confirm `ciphertextHash` is available at resolve time
on both sides of the compare; if not, fall back to comparing the sealed ciphertext
bytes.)*

### 4.12 G (Low, observability) — surface the 64-page pull cap

`PULL_PAGE_CAP = 64` (`worker.ts:1055`) is lossless (watermark holds; correct
anti-pin defence) but silent — a large first pull looks "done" then trickles in on
the next external trigger. **Fix:** when the loop exits with `pages >= cap && more`,
schedule an immediate follow-up cycle and surface a transient "catching up"
indicator (`worker.ts:1172-1173`), retired when `more` goes false.

## 5. Workstream C — crypto / client identity

### 5.1 #1 (Critical) — master-key buffer copied before close · **DONE (in tree)**

`login-online-linked.ts` now copies the MK into a fresh buffer
(`onlineMk = asMasterKey(mk.slice())`) before `localSession.close()`, used for both
the online session and the return value. Regression test
(`tests/flows/login-online-linked.test.ts`) builds a real OPAQUE register+login
round-trip and asserts the online session derives the same DEK as a local login;
verified to fail under the pre-fix code. Uncommitted — folded into this sprint so
Larissa sees it with the rest. No further work; listed for completeness.

### 5.2 #3 (High) — persist and reuse the frozen OPAQUE client identifier

The client bakes the **live** `local_account.username` into its OPAQUE ceremonies
(`opaque/client.ts:63,131` via `login-online-linked.ts:86`, `step-up.ts`,
pairing), so a rename desyncs from the server's frozen
`opaque_client_identifier`. **Fix:** persist the original OPAQUE client identifier
at link/recovery time and reuse that frozen value in every client OPAQUE ceremony
instead of the live username; `changeUsername` must never touch it.
*(Open question 6 — storage location. Recommend a new
`opaque_client_identifier` field on the `linked_account` row (OPAQUE is per-server,
and a local-only account runs no OPAQUE), set at `linkToServer`/`recoverOnline`/
`recoverFromScratch` time. Confirm no Dexie migration collision — this adds an
optional non-indexed field, so per the unindexed-fields rule no version bump is
needed.)* Wire it through `login-online-linked.ts`, `step-up.ts`, and the pairing
login path.

### 5.3 R (Medium) — adopt the server-issued access token on online recovery

`recovery-online.ts:59` returns `void` and discards `finish.access_token`; the
caller (`routes/login/recovery.tsx:179`) then builds an **offline local** session,
landing the user unauthenticated for sync. **Fix:** return `{session, mk}` from
`recoveryOnline` with `mode:'linked'`, `online:true`,
`accessToken: finish.access_token` (mirror `recover-from-scratch.ts:233-241`);
update the caller to adopt that session and fix the `void`/docstring. Also persist
the frozen OPAQUE client identifier here (§5.2).

## 6. Testing

- **Crypto (`bun test`):** #1 regression (done); #3 — a rename-then-OPAQUE round
  trip asserting login/step-up succeed under the frozen identifier; R — assert
  `recoveryOnline` returns an online session carrying the access token.
- **auth-service (`bun test`, native PG+Redis):** #9 — concurrent finish requests
  consume state once (looping race, mirror the refresh-rotation race test); #8 —
  concurrent `login/start` burst respects the limit (looping) + per-IP backstop;
  #3.3 uniqueIndex — concurrent recovery-finish yields exactly one opaque row;
  #10a — start responses for existing/suspended/unknown are byte-shape-identical;
  #10b — boot throws without setup when `NODE_ENV!==test`.
- **sync-service (`bun test`):** #2 — a delete with an unknown collection is
  rejected `bad_collection` and never stored.
- **client sync (vitest):** #2-client — a poison tombstone is an inert skip and the
  watermark advances; #4b — concurrent local edit during apply does not lose the
  update (fake-timers/tx ordering); #4c — a low-rev ack does not regress meta; #5 —
  MK cleared mid-pull holds the watermark (record re-pulled next cycle); #6a — blob
  records re-enqueued after `recoverBlobs`; #6b — a typed verdict withholds the
  epoch persist; V — a pulled `'embedded'` document with no vectors re-embeds; #7 —
  reconnect reconciliation enqueues a divergent already-synced row; P —
  `isEnginePaused` blocks `canRunCycle`; C — equal-(updatedAt,id) converges; G —
  cap-exit schedules a follow-up.
- **Gates:** `pnpm typecheck --force` 14/14; full user-client vitest at the known
  Node-localStorage baseline + new coverage; crypto/auth/sync `bun test` green;
  Biome clean on changed files. Distrust cached typecheck on test-touching tasks.

## 7. Audit gates

- **Larissa over all three workstreams** before any squash — auth-service and
  sync-service are her mandatory paths, `packages/crypto` too; the client sync
  engine is included by Chris's call given the security surface. Summon her with
  the built diff at **absolute worktree paths**.
- **Laura** — not required (no user-reachable flow, state, or affordance changes;
  the only user-visible deltas are the "catching up" indicator (G) and the honest
  `recovery_paused` copy (P), both minor — a light pre-squash pass on those two is
  optional, Chris's call).
- Any conscious deferral (none planned — scope is "everything") would go to
  `security-deferrals.md` with Chris sign-off for a High/Critical.

## 8. Out of scope

- `TRUST_PROXY_HOPS` itself (already tracked, owed before go-live) — this sprint
  *depends* on it for #8's per-IP backstop to be spoof-resistant (open question 3).
- The vectors *delete*-direction gap (`follow-ups-index.md:64`, MEDIUM-1) and the
  non-atomic `deleteLibraryCascade` (`:82`) — related but separate, keep tracked.
- Any Dexie schema/store change: this sprint should need **no version bump** (V and
  #3 are field-disposition / optional-field changes). If one becomes necessary,
  plan the `db.verno` assertion sweep into the task (24+ hard-coded assertions).

## 9. Manual verification (Chris, on device / dev stack)

1. **#1** — link a device, log in online; confirm the vault is intact (not wiped)
   and sync works. (The bug's symptom was a wiped local store on a successful
   linked login.)
2. **#3** — rename the username on a linked account; then log out and log back in
   online, run a step-up ceremony, and pair a second device. All succeed.
3. **#2** — (dev) push a delete with `collection:"evil"` via the seal-CLI / a
   crafted request; confirm the server rejects it and other devices keep syncing.
4. **R** — recover an account online with the recovery key; confirm the app lands
   **online** (not "offline local") and sync starts without a re-login.
5. **#6a/#6b** — trigger an epoch reset (re-epoch command); confirm avatars/
   artefacts/attachments re-converge to a second device, and that a quota/blob-exists
   condition surfaces rather than silently "completing".
6. **V** — create a knowledge document on device A, let it embed, sync to a fresh
   device B; confirm search works on B (it re-embedded).
7. **#10b** — start the auth-service in prod mode without `OPAQUE_SERVER_SETUP`;
   confirm it refuses to boot (loud), and boots with the escape hatch set.

## 10. Open questions — RESOLVED (Chris, 2026-07-10)

1. **#4a lock trade-off** — **RESOLVED: accept.** Immediate drain under the blocking
   `withSyncLock`; a user write-through waiting behind a long pull is acceptable and
   strictly safer than the current hazard.
2. **#7 reconciliation breadth** — **RESOLVED: corpus-wide, batched.** A real
   convergence guarantee, not a special-case for the three known deferred fields.
3. **#8 per-IP backstop sequencing** — **RESOLVED: land the IP bucket now** behind
   the same env; it becomes fully spoof-resistant once `TRUST_PROXY_HOPS` lands
   (both owed before go-live). Do not block this sprint on `TRUST_PROXY_HOPS`.
4. **C tiebreak** — **RESOLVED: use `ciphertextHash`**, verify availability at
   resolve time during the plan; fall back to sealed-ciphertext byte compare only if
   it is not present on both sides.
5. **#9 uniqueIndex** — **RESOLVED: full `uniqueIndex`** on `(user_id, method_type)`;
   verify no seed/test/legitimate flow inserts two rows of one type before landing
   the constraint.
6. **#3 identifier storage** — **RESOLVED: new optional field on `linked_account`**
   (OPAQUE is per-server; a local-only account runs no OPAQUE). Optional, non-indexed
   → no Dexie version bump.

## 11. Related

- Findings register (evidence + `file:line`):
  [[../../obsidian/insights/2026-07-10-opaque-sync-hardening-findings]]
- Sync design contract: [[2026-07-01-client-sync-design]] §12
- Blob transport / re-epoch: [[2026-07-02-blob-transport-and-deployment-docs-design]]
- STATUS: [[../../obsidian/STATUS-BACKEND]] (go-live gating)
