# OPAQUE / Sync hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task's implementer sees ONLY their own task — read the cited files first; the fix contract and the neighbouring interfaces are in the task.

**Goal:** Close the verified OPAQUE/sync hardening findings (register:
`obsidian/insights/2026-07-10-opaque-sync-hardening-findings.md`; spec:
`superpowers/specs/2026-07-10-opaque-sync-hardening-design.md`) ahead of the
v0.2.0 backend go-live.

**Architecture:** Three workstreams, each landing as one squashed feature unit:
**A** server (auth-service + sync-service), **B** client sync engine, **C**
crypto/client identity. Larissa audits all three built diffs before any squash.

**Tech Stack:** Bun + Hono + Drizzle/Postgres + ioredis (server); React +
Dexie + `@serenity-kit/opaque` + WebCrypto (client); Bun test + Vitest.

## Global Constraints

- **British English** in all code, comments, copy, tests.
- **The client never trusts the server:** every server-driven value (collection,
  ack rev, blob verdict) is validated client-side; an unexpected input becomes an
  inert, watermark-preserving skip — never a crash or a silent loss.
- **No silent loss:** a record that cannot be applied holds the watermark.
- **No Dexie version bump** is expected (V and #3 are field-disposition / optional
  non-indexed field changes). If one becomes unavoidable, add the `db.verno`
  assertion sweep (24+ hard-coded assertions) into that task.
- **Gates per task:** the touched suite green; `pnpm typecheck --force` (distrust
  cached typecheck on test-touching tasks); Biome clean on changed files.
- **Larissa is mandatory** on auth-service, sync-service, `packages/crypto`; the
  client sync engine is included by Chris's call. Summon with absolute worktree
  paths.
- **Subagents never merge, push, or switch branches.**

## Execution setup (do FIRST, before Task A1)

- [ ] Commit the planning docs to `master` (doc-only): the findings register, this
  spec, and this plan.
  ```bash
  git add obsidian/insights/2026-07-10-opaque-sync-hardening-findings.md \
          superpowers/specs/2026-07-10-opaque-sync-hardening-design.md \
          superpowers/plans/2026-07-10-opaque-sync-hardening.md
  git commit -m "Add OPAQUE/sync hardening findings register, spec and plan [skip ci]"
  ```
- [ ] The **#1 fix is uncommitted in the main tree** (`login-online-linked.ts` +
  `tests/flows/login-online-linked.test.ts`). Carry it into the sprint worktree,
  do NOT leave it on master: `git stash push -- packages/crypto/src/flows/login-online-linked.ts packages/crypto/tests/flows/login-online-linked.test.ts`
- [ ] Create the worktree via superpowers:using-git-worktrees, branch
  `feat/opaque-sync-hardening`, then `git stash pop` inside it. Verify the #1 fix +
  test are present and `cd packages/crypto && bun test tests/flows/login-online-linked.test.ts` is green.
- [ ] All subsequent tasks run inside the worktree. Verify each subagent commit
  landed on `feat/opaque-sync-hardening` (`git branch --contains`).

---

# Workstream A — server (auth-service + sync-service)

### Task A1: #2-server — reject unvalidated-collection tombstones

**Files:**
- Modify: `apps/sync-service/src/records/store.ts` (delete branch `:114`, validation `:149`)
- Modify: `apps/sync-service/src/routes/changes.ts:29` (`PushRecordSchema.collection`)
- Test: `apps/sync-service/tests/records/store.test.ts` (or the nearest existing store/route test)

**Interfaces:**
- Consumes: `isSyncCollection(collection: string): boolean` from `records/collections.ts`.
- Produces: the store rejects any record (delete OR upsert) whose `collection` is
  not in `SYNC_COLLECTIONS` with `{ status: 'error', code: 'bad_collection' }`
  before any DB write.

- [ ] **Step 1: Failing test** — a batch with a delete record whose
  `collection: 'evil'` (fresh `blindId`, `deleted: true`) returns
  `status: 'error', code: 'bad_collection'` and stores NO row (assert
  `syncRecords` has no row for that `blindId` afterwards). Add a sibling assertion
  that a valid-collection delete still tombstones.
- [ ] **Step 2: Run — FAIL** (`cd apps/sync-service && bun test tests/records/store.test.ts`); the delete is currently stored with the bad collection.
- [ ] **Step 3: Implement** — hoist the `if (!isSyncCollection(record.collection))`
  check (currently `store.ts:149`) to run BEFORE the tombstone/delete branches
  (before `store.ts:108`), so it governs every path. Add a Valibot picklist to
  `PushRecordSchema.collection` in `routes/changes.ts:29`:
  `v.picklist(SYNC_COLLECTIONS)` (import `SYNC_COLLECTIONS` from the shared list).
- [ ] **Step 4: Run — PASS**; run the full sync-service suite (`bun test`) to
  confirm no regression on valid collections.
- [ ] **Step 5: Commit** — `Validate sync collection before storing any record`.

### Task A2: #9 — atomic OPAQUE / recovery state consumption (GETDEL)

**Files:**
- Modify: `apps/auth-service/src/opaque/server.ts:65-78` (`fetchOpaqueState`)
- Modify: `apps/auth-service/src/recovery/nonce.ts:21-31` (`consumeNonce`)
- Test: `apps/auth-service/tests/opaque/server.test.ts` + `tests/recovery/nonce.test.ts` (create if absent)

**Interfaces:**
- Produces: both functions consume their Redis key in ONE round-trip; two
  concurrent consumers of the same key — exactly one gets the value, the other
  gets `null`/`false`.

- [ ] **Step 1: Failing test** — `fetchOpaqueState`: seed a key, fire two
  `fetchOpaqueState('login', id)` concurrently (`Promise.all`), assert exactly one
  returns the payload and one returns `null`. Repeat for `consumeNonce` (one
  `true`, one `false`). (Needs native Redis; mirror existing auth-service Redis
  test setup.)
- [ ] **Step 2: Run — FAIL** (both currently return the value due to the GET+DEL
  window — the race test double-consumes).
- [ ] **Step 3: Implement** — replace `redis.get(k)` + `redis.del(k)` with
  `const raw = await redis.getdel(k)` in both functions. Update the JSDoc that
  currently claims atomicity to reflect it is now true. Pattern already in-tree at
  `step-up.ts:227`.
- [ ] **Step 4: Run — PASS**; run the auth-service suite legs that consume state
  (login-finish, step-up, recovery-finish, join-pairing, passphrase-change).
- [ ] **Step 5: Commit** — `Consume OPAQUE and recovery state atomically with GETDEL`.

### Task A3: #9-DiD — unique auth-method index

**Files:**
- Modify: `apps/auth-service/src/db/schema.ts:96` (add uniqueIndex)
- Create: `apps/auth-service/migrations/0006_unique_auth_method.sql`
- Test: `apps/auth-service/tests/recovery/finish.test.ts` (concurrent finish)

**Interfaces:**
- Produces: at most one `auth_methods` row per `(user_id, method_type)`; a second
  insert of the same pair fails at the DB.

- [ ] **Step 1: Pre-check** — grep for any flow inserting two rows of one
  `method_type` for a user (seed scripts, tests, `join.ts`, `recovery.ts`,
  `me.ts`). If found, resolve before adding the constraint. Record the check result
  in the commit body.
- [ ] **Step 2: Failing test** — two concurrent `recovery/finish` with the same
  nonce+proof (after the A2 getdel fix, only one should pass `consumeNonce`; this
  test pins that the DB ALSO forbids the double row even if two delete-then-insert
  txns interleave). Assert exactly one `opaque` row for the user afterwards.
- [ ] **Step 3: Run — FAIL** (schema currently allows two rows).
- [ ] **Step 4: Implement** — add
  `userMethodUnique: uniqueIndex('auth_methods_user_method_unique').on(t.userId, t.methodType)`
  to the schema table config; write `0006_unique_auth_method.sql`:
  `CREATE UNIQUE INDEX "auth_methods_user_method_unique" ON "auth_methods" ("user_id","method_type");`
  (drop the now-redundant plain `auth_methods_user_method` index in the same
  migration if the pre-check confirms no code depends on the non-unique variant).
- [ ] **Step 5: Run — PASS** against a freshly migrated `auth_db_test`.
- [ ] **Step 6: Commit** — `Enforce one auth method per (user, method_type)`.

### Task A4: #8 — atomic, IP-backstopped login rate limit

**Files:**
- Modify: `apps/auth-service/src/routes/_rate-limit-helpers.ts`
- Modify: `apps/auth-service/src/routes/login.ts:74,275`, `recovery.ts:59` (add IP arg)
- Test: `apps/auth-service/tests/routes/rate-limit.test.ts`

**Interfaces:**
- Produces: `applyLoginRateLimit(username: string, ip?: string): Promise<void>` —
  the username window is updated atomically; when `ip` is given, a parallel per-IP
  window (`rl:login:ip:<ip>`) is also enforced.

- [ ] **Step 1: Failing test** — (a) fire 20 concurrent `applyLoginRateLimit('bob')`
  and assert at most `LOGIN_MAX_ATTEMPTS` succeed (the rest throw 429). (b) with 12
  distinct usernames from one `ip`, assert the IP bucket throttles.
- [ ] **Step 2: Run — FAIL** (current four-command sequence lets the concurrent
  burst through; no IP bucket exists).
- [ ] **Step 3: Implement** — replace the zremrangebyscore→zcard→check→zadd
  sequence with one Lua `EVAL` that, given `(key, now, windowStartMs, max, member)`:
  `ZREMRANGEBYSCORE key 0 windowStart; ZADD key now member; local c = ZCARD key; PEXPIRE key windowMs; if c > max then ZREM key member; return 1 else return 0 end` — throw 429 when it returns 1. Run the same script for `rl:login:ip:<ip>` when `ip` is provided. Thread `ipKey(c)` from the callers (reuse `middleware/rate-limit.ts` `ipKey`); note in a comment the IP bucket is only spoof-resistant once `TRUST_PROXY_HOPS` lands (spec §3.4, resolved OQ3).
- [ ] **Step 4: Run — PASS**.
- [ ] **Step 5: Commit** — `Make login rate limit atomic and add a per-IP backstop`.

### Task A5: #10a — decoy wraps close the enumeration oracle

**Files:**
- Modify: `apps/auth-service/src/routes/login.ts:131-149` (fake/suspended branch)
- Create: `apps/auth-service/src/opaque/decoy-wrap.ts` (deterministic decoy derivation)
- Test: `apps/auth-service/tests/routes/login-enumeration.test.ts`

**Interfaces:**
- Produces: `deriveDecoyWrap(username: string): { wrapped_mk_opaque: string;
  wrap_nonce_opaque: string; wrap_aad_opaque: string }` — deterministic per
  username, realistic base64url lengths matching a real wrap.

- [ ] **Step 1: Failing test** — call login/start for (a) an existing active user,
  (b) an unknown user, (c) a suspended user; assert all three responses have the
  SAME shape: `wrapped_mk_opaque` present, non-null, base64url, same length class.
  Assert the decoy is stable across two calls for the same unknown username, and
  differs between two different unknown usernames.
- [ ] **Step 2: Run — FAIL** (unknown/suspended currently return `null` wraps).
- [ ] **Step 3: Implement** — `deriveDecoyWrap` = HMAC-SHA256(server-secret,
  `decoy-wrap:${username.toLowerCase()}`) expanded to the real wrap byte lengths
  (ciphertext 48, nonce 12, aad from the real AAD scheme), base64url-encoded. Use a
  server-side secret already available (e.g. derive from `getServerSetup()` or a
  dedicated env; do NOT reuse a key with another purpose — add
  `DECOY_WRAP_KEY` if needed, documented in `.env.example`). Return it from the
  fake/suspended branch (`login.ts:143-149`) instead of `null`. Keep suspended
  users on the same shape as active (they already 401 at finish).
- [ ] **Step 4: Run — PASS**.
- [ ] **Step 5: Commit** — `Return decoy OPAQUE wraps for unknown and suspended users`.

### Task A6: #10b — hard-fail on missing OPAQUE setup outside tests

**Files:**
- Modify: `apps/auth-service/src/opaque/server.ts:27-41` (`getServerSetup`)
- Modify: `apps/auth-service/.env.example` (document `ALLOW_EPHEMERAL_OPAQUE_SETUP`)
- Test: `apps/auth-service/tests/opaque/server-setup.test.ts`

**Interfaces:**
- Produces: `getServerSetup()` throws when `OPAQUE_SERVER_SETUP` is unset and
  `NODE_ENV !== 'test'` and `ALLOW_EPHEMERAL_OPAQUE_SETUP !== '1'`.

- [ ] **Step 1: Failing test** — with `NODE_ENV='production'`, unset
  `OPAQUE_SERVER_SETUP`, unset the escape hatch: `getServerSetup()` throws. With
  `NODE_ENV='test'`: returns an ephemeral setup (no throw). With the escape hatch
  `='1'`: returns ephemeral + warns.
- [ ] **Step 2: Run — FAIL** (currently always falls back with a warn).
- [ ] **Step 3: Implement** — in the unset branch, `if (env.NODE_ENV !== 'test' &&
  env.ALLOW_EPHEMERAL_OPAQUE_SETUP !== '1') throw new Error('OPAQUE_SERVER_SETUP is
  required outside tests — refusing to boot with an ephemeral setup that would
  invalidate all accounts on restart. Set it, or ALLOW_EPHEMERAL_OPAQUE_SETUP=1 for
  a throwaway run.')`. Keep the warn for the test/escape-hatch path. Add the env to
  the schema (`env.ts`) and `.env.example`.
- [ ] **Step 4: Run — PASS**.
- [ ] **Step 5: Commit** — `Refuse to boot on missing OPAQUE setup outside tests`.

**→ A-squash gate:** Larissa audits the auth-service + sync-service diff. Fix/defer,
then squash workstream A: `Harden auth-service and sync-service (OPAQUE state,
rate limit, enumeration, collection validation)`.

---

# Workstream B — client sync engine

> Each B-task implementer: read the cited file(s) end-to-end first. These are
> concurrency/ordering fixes — the tests are the contract; write them from the
> assertions below, then implement against the real code.

### Task B1: #2-client — guard `db.table()`, never crash the pull loop

**Files:** Modify `apps/user-client/src/sync/apply.ts` (`readLocalRow`/`listLocalKeys`/`findKeyByBlindId` ~`:287`), `apps/user-client/src/sync/worker.ts` (`runPullLoop` per-record apply `:1142`). Test: `apps/user-client/tests/sync/apply-poison.test.ts`.

- [ ] Failing test: a pulled tombstone with `collection:'evil'` (unknown table) →
  `applyRecord` returns an inert skip AND the pull loop advances the watermark past
  it (assert `advanceWatermark` called, no throw escapes). A second, valid record
  after it in the page IS applied.
- [ ] Implement: guard collection lookups behind `isSyncCollection` (treat unknown
  → inert skip); wrap the per-record `applyRecord` call in `runPullLoop` so any
  unexpected throw becomes a logged inert outcome that still advances the watermark.
- [ ] Commit `Guard unknown sync collections and keep the pull loop crash-proof`.

### Task B2: #4a — immediate drain under the Web Lock

**Files:** Modify `apps/user-client/src/sync/triggers.ts:105-107` + docstring `:8-10`. Test: `apps/user-client/tests/sync/triggers.test.ts`.

- [ ] Failing test: an immediate drain and a `runSyncCycle` cannot execute
  `drainOutbox` concurrently (assert serialisation via a spy that records
  enter/exit ordering under a mocked `navigator.locks`).
- [ ] Implement: wrap the immediate-drain callback in the blocking `withSyncLock`
  (`worker.ts:1007`), not `withSingleFlight`. Correct the docstring.
- [ ] Commit `Run the immediate drain under the sync Web Lock`.

### Task B3: #4b — fold apply read+resolve+write into one transaction

**Files:** Modify `apply.ts` `applyUpsert` (`:612-703`) and `applyTombstone` (`:504-508`). Test: `apps/user-client/tests/sync/apply-toctou.test.ts`.

- [ ] Failing test: a concurrent local edit landing between the local-read and the
  write is NOT lost (the resolver sees the fresh row, or the write is CAS-guarded
  inside the tx). Use fake-timers / an interleaved write in the same table.
- [ ] Implement: fold local-read → `resolveConflict` → `put` into one
  `db.transaction` per record for both upsert and tombstone paths.
- [ ] Commit `Serialise pulled-record apply inside a single transaction`.

### Task B4: #4c — monotone rev guard on push acks

**Files:** Modify `worker.ts` `applyOk` (`:688-712`) and `applyConflict` poison branch (`:764-771`). Test: `apps/user-client/tests/sync/apply-ok-monotone.test.ts`.

- [ ] Failing test: an `applyOk` with `rev` LOWER than the existing `meta.rev` does
  NOT regress `meta.rev`/`ciphertextHash` (assert the meta is unchanged).
- [ ] Implement: inside the existing tx, `get` current meta and put only when
  `rev > existing.rev`; else drop the stale ack. Mirror in the conflict poison branch.
- [ ] Commit `Only advance sync meta on a strictly newer ack rev`.

### Task B5: #5 — hold the watermark when the MK vanishes mid-pull

**Files:** Modify `worker.ts` `runPullLoop` (`:1093-1180`), `apply.ts` reject/tombstone-miss paths (`:572`, `:484`), comment `session.ts:88-92`. Test: `apps/user-client/tests/sync/pull-mk-cleared.test.ts`.

- [ ] Failing test: clearing the session MK (`closeAndForget`) mid-pull, before a
  record's blind-id re-check, yields an `unavailable` outcome and the watermark is
  NOT advanced (record re-pulled next cycle) — not a silent `rejected`.
- [ ] Implement: snapshot session identity at pull start; after each `applyRecord`
  re-check the session is still open (mirror `generationStillCurrent`), discard the
  page without advancing if the MK went away. Belt-and-braces: on reject/tombstone-
  miss, re-read `useSessionStore.getState().mk`; if `null`, return `unavailable`.
- [ ] Commit `Hold the sync watermark when the master key is cleared mid-pull`.

### Task B6: #6a — re-push blob-collection records after epoch recovery

**Files:** Modify `apps/user-client/src/sync/recovery.ts` (`REPUSH_COLLECTIONS` `:96-98`, `performRecovery` post-`recoverBlobs` step `:273-277`, `enqueueFullRepush` `:414`). Test: `apps/user-client/tests/sync/recovery-blob-records.test.ts`.

- [ ] Failing test: after an epoch recovery, `personaAvatars`/`artefacts`/
  `attachments` local rows ARE re-enqueued for push (assert outbox entries exist),
  ordered AFTER the blob byte re-upload.
- [ ] Implement: after `recoverBlobs()` succeeds, run a second re-push pass scoped
  to `BLOB_COLLECTIONS` (reuse the `enqueueFullRepush` machinery), ordered after the
  blob upload so §11.5 (record never precedes its bytes) holds.
- [ ] Commit `Re-push blob-collection records after epoch recovery`.

### Task B7: #6b — honour typed blob-upload verdicts in recovery

**Files:** Modify `recovery.ts` `recoverBlobs` (`:352-356`) + `performRecovery` epoch-persist (`:275-277`). Test: `apps/user-client/tests/sync/recovery-blob-verdict.test.ts`.

- [ ] Failing test: a `putBlob` returning `quota_exceeded` (or `blob_too_large`/
  `blobs_disabled`) causes recovery to NOT persist the new epoch (recovery re-runs);
  a `blob_exists` raises a tamper-class attention.
- [ ] Implement: inspect each `PutBlobResult`; route through `resolveBlobFailure`.
  On `blob_exists` → tamper attention; on quota/too-large/disabled → withhold the
  step-5 epoch persist.
- [ ] Commit `Honour typed blob-upload verdicts during epoch recovery`.

### Task B8: V — keep `embeddingStatus` device-local so peers re-embed

**Files:** Modify `apps/user-client/src/sync/strip.ts` (`DENY_LISTS.documents` `:66-88`), the pulled-document apply path (re-embed trigger; `apply.ts` afterApplied + `start-ingestion.ts:80-94`). Test: `apps/user-client/tests/sync/document-reembed.test.ts`.

- [ ] Failing test: a pulled `documents` row arriving with `embeddingStatus:
  'embedded'` but no local vectors is treated as `pending` and re-embedding is
  triggered (assert the ingestion queue picks it up).
- [ ] Implement: add `embeddingStatus`, `embeddingError`, `chunkCount` to
  `DENY_LISTS.documents`; on applying a pulled document with no local vectors, set
  local `embeddingStatus = 'pending'` so `startKnowledgeIngestion` re-embeds. No
  Dexie bump (deny-list-only). Preserve the one-directional-vectors design.
- [ ] Commit `Keep embeddingStatus device-local so peers re-embed pulled documents`.

### Task B9: #7 — corpus-wide reconnect reconciliation

**Files:** Modify `worker.ts` `runSyncCycle` (`:935`) — add a reconciliation pass; `enqueue.ts` (source of the deferred-no-outbox path `:173-184`). Test: `apps/user-client/tests/sync/reconnect-reconcile.test.ts`.

- [ ] Failing test: a row committed via the `deferWhenOffline` path (no outbox
  entry, already-synced base) is enqueued for push after the next reconnect cycle
  when its live `ciphertextHash` diverges from `syncRows.ciphertextHash`.
- [ ] Implement: a batched reconciliation pass, invoked from `runSyncCycle`, that
  scans already-synced rows, re-seals to compute the current `ciphertextHash`, and
  enqueues keys whose hash differs from the stored meta. Corpus-wide, batched
  (resolved OQ2). Guard it so it does not thrash on every trigger (e.g. run on
  connectivity-regain / a coarse interval).
- [ ] Commit `Reconcile divergent already-synced rows on reconnect`.

### Task B10: P — `recovery_paused` quiesces the cycle

**Files:** Modify `worker.ts` `canRunCycle` (`:984`); `sync/copy.ts:65` if kept as-is. Test: `apps/user-client/tests/sync/engine-paused.test.ts`.

- [ ] Failing test: with `isEnginePaused()` true, `canRunCycle()` returns false
  (no drain/pull fires).
- [ ] Implement: `if (isEnginePaused()) return false` at the top of `canRunCycle`
  (`isEnginePaused` already exported, `recovery.ts:226`). The "syncing is paused"
  copy is now accurate.
- [ ] Commit `Quiesce the sync cycle while recovery is paused`.

### Task B11: C — deterministic tiebreak at equal (updatedAt, id)

**Files:** Modify `apps/user-client/src/sync/resolution.ts` `lww` (`:74-80`). Test: `apps/user-client/tests/sync/resolution.test.ts`.

- [ ] Pre-check: confirm `ciphertextHash` is available to `lww` on both the local
  and pulled sides at resolve time (resolved OQ4). If not, tiebreak on the sealed
  ciphertext bytes instead.
- [ ] Failing test: two devices with the same record, equal `updatedAt` and `id`,
  different content → both converge on the same winner (higher `ciphertextHash`),
  and the loser has `repush: true` regardless of pull order.
- [ ] Implement: when `updatedAt` and `id` are equal, compare `ciphertextHash`
  lexicographically; higher wins, loser repushes.
- [ ] Commit `Converge equal-timestamp conflicts on a content-intrinsic tiebreak`.

### Task B12: G — surface the 64-page pull cap

**Files:** Modify `worker.ts` `runPullLoop` cap-exit (`:1096`, `:1172-1173`). Test: `apps/user-client/tests/sync/pull-cap.test.ts`.

- [ ] Failing test: when the loop exits with `pages >= PULL_PAGE_CAP && more`, a
  follow-up cycle is scheduled and a transient "catching up" indicator is set
  (retired when `more` is false).
- [ ] Implement: on cap-exit-with-more, schedule an immediate follow-up cycle and
  set the indicator; clear it on a clean finish.
- [ ] Commit `Surface and auto-resume the 64-page pull cap`.

**→ B-squash gate:** Larissa audits the client sync-engine diff (Chris's call to
include it). Fix/defer, then squash workstream B: `Harden the client sync engine
(races, silent-loss, epoch recovery, convergence, observability)`.

---

# Workstream C — crypto / client identity

### Task C0: #1 — master-key buffer copy · DONE

Already implemented + tested (execution-setup step carries it into the branch). No
new work; it squashes with workstream C.

### Task C1: #3 — persist and reuse the frozen OPAQUE client identifier

**Files:**
- Modify: `packages/crypto/src/db/schema.ts` (`linked_account` row + `opaque_client_identifier` optional field), `db/linked-account.ts`.
- Modify: `packages/crypto/src/flows/link-to-server.ts`, `recovery-online.ts`, `recover-from-scratch.ts` (write the frozen identifier at link/recovery time).
- Modify: `packages/crypto/src/flows/login-online-linked.ts:86,204`, `step-up.ts:88`, the pairing login path (read the frozen identifier, not the live username).
- Modify: `packages/crypto/src/flows/change-username.ts` (must NOT touch the identifier — add a comment).
- Test: `packages/crypto/tests/flows/change-username-opaque.test.ts`.

**Interfaces:**
- Produces: `linked_account.opaque_client_identifier: string` — the username at
  link/registration time, frozen; every client OPAQUE ceremony uses it.

- [ ] **Step 1: Failing test** — build a linked account (real OPAQUE register via
  the `@serenity-kit/opaque` server pattern from `login-online-linked.test.ts`),
  `changeUsername` to a new name, then run an online login (and a step-up) and
  assert they SUCCEED under the frozen identifier. Without the fix they fail
  (`wrong_passphrase`).
- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — add the optional `opaque_client_identifier` field to
  the `linked_account` row (optional, non-indexed → **no Dexie bump**; confirm via
  the unindexed-field rule); write it at `linkToServer`/`recoverOnline`/
  `recoverFromScratch`; read it in `runServerLogin` (`login-online-linked.ts`),
  `step-up.ts`, and pairing, passing it as the OPAQUE `client` identifier instead of
  `local.username`. Fall back to `local.username` only when the field is absent
  (legacy rows linked before this change — a one-time self-heal: stamp it on the
  next successful login).
- [ ] **Step 4: Run — PASS**; run the crypto suite.
- [ ] **Step 5: Commit** — `Freeze the OPAQUE client identifier across username changes`.

### Task C2: R — adopt the server-issued access token on online recovery

**Files:**
- Modify: `packages/crypto/src/flows/recovery-online.ts:59` (return `{session, mk}` instead of `void`; adopt `finish.access_token`).
- Modify: `apps/user-client/src/routes/login/recovery.tsx:163-191` (use the returned online session, drop the extra `loginLocalWithRecoveryKey`).
- Test: `packages/crypto/tests/flows/recovery-online.test.ts`.

**Interfaces:**
- Consumes: `RecoveryFinishResponse.access_token` (already returned by the server).
- Produces: `recoveryOnline(...): Promise<{ session: MasterKeySession; mk: MasterKey }>`
  with `mode:'linked'`, `online:true`, `accessToken` set.

- [ ] **Step 1: Failing test** — `recoveryOnline` returns a session with
  `mode:'linked'`, `online:true`, and a non-empty access token (mock the server
  `recoveryFinish` to return an `access_token`).
- [ ] **Step 2: Run — FAIL** (currently returns `void`).
- [ ] **Step 3: Implement** — build and return `createMasterKeySession({ mk,
  userId: finish.user_id, username, mode:'linked', online:true, role: finish.role,
  accessToken: finish.access_token })` (mirror `recover-from-scratch.ts:233-241`);
  also stamp `opaque_client_identifier` (Task C1). Update `recovery.tsx` to adopt
  it; fix the `void`/docstring.
- [ ] **Step 4: Run — PASS**; run the crypto suite + the user-client recovery tests.
- [ ] **Step 5: Commit** — `Adopt the server-issued access token on online recovery`.

**→ C-squash gate:** Larissa audits the `packages/crypto` diff (mandatory path).
Fix/defer, then squash workstream C: `Harden client identity (OPAQUE identifier
freeze, recovery session, MK buffer copy)`.

---

## Final gate (after all three squashes)

- [ ] **Larissa whole-scope pass** over the three squashed units together (Chris's
  "just in case" over everything).
- [ ] `pnpm typecheck --force` 14/14 on the integrated tree; full suites green;
  Biome clean.
- [ ] Update `obsidian/STATUS-BACKEND.md` (done/next), note the go-live is now
  unblocked on these findings.
- [ ] Chris's manual verification (spec §9), then push.

## Self-review notes

- **Spec coverage:** every spec §3–§5 finding maps to a task (A1–A6, B1–B12,
  C0–C2). §3.7 (server confirmations) needs no task. OQ1–6 resolutions are baked
  into A4/B2/B9/B11/A3/C1.
- **No Dexie bump:** B8 (deny-list) and C1 (optional non-indexed field) are the
  only schema-adjacent client changes; both ride free. If C1's field turns out to
  need an index, add the `db.verno` sweep — flagged in the task.
- **Type consistency:** `opaque_client_identifier` (C1) is the single field name
  used across schema, link, recovery, login, step-up. `resolveBlobFailure` reused
  by B7. `isEnginePaused` (B10) matches `recovery.ts:226`.
