# WS-C Implementation Plan — Client Sync Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client half of zero-knowledge sync: Dexie v33 (outbox/rows/state/trash), the two-class write discipline with outbox enqueue at every write site, the single-flight worker (drain → pull-apply), per-collection conflict resolution, epoch recovery, the doorbell consumer, and the offline-gating UX.

**Architecture:** Everything under `apps/user-client/src/sync/` plus the v33 bump and the write-site/UI sweeps. The engine consumes the built crypto (`sealRecord`/`openRecord`/`computeBlindId`), shared-types wire types, and the WS-0 stores. Spec: `superpowers/specs/2026-07-02-ws-c-sync-engine-design.md` (**v2** — Larissa H-1/M-1–M-8/L-1–L-7/I-1–I-5 and Laura 2-hard/7-soft already folded; every task below cites its spec section — the spec is the contract, this plan is the sequence).

**Tech Stack:** TypeScript strict, Dexie, Zustand v5, TanStack Query, Vitest + fake-indexeddb (house pattern in existing db tests), Web Locks API, WebSocket, pnpm + Turborepo.

## Operating rules for the overnight worker (READ FIRST)

Binding; they override your defaults. The repo's CLAUDE.md may not be in
your context — everything you need is here.

1. **STOP-guard — verify the base before touching anything.** All must hold,
   or STOP, change nothing, report:
   - `STATUS-TRANSITION.md` exists at the repo root;
   - `superpowers/specs/2026-07-02-ws-c-sync-engine-design.md` exists and
     contains "Version: v2";
   - `packages/ui-shared/src/state/discovery.store.ts` exists (WS-0 landed);
   - `apps/user-client/src/sync/` does NOT exist and
     `apps/user-client/src/boot/client-data-db.ts` contains
     `this.version(32)` as its highest version (v33 is unclaimed).
2. **Parallel-workstream note.** WS-A (proxy client) may land around the same
   time and touches `send-message.ts`, `stream-engine.ts`, settings routes
   (removing `corsProxy*` threading). Base yourself on the branch tip as you
   find it. If you hit those files, make ONLY this plan's additions (enqueue
   calls, gating); never remove or restore proxy-related code — integration
   conflicts are the humans' job.
3. **Branch + integration target.** Fresh branch cut from
   `full-backend-transition`; any PR targets **`full-backend-transition`,
   NEVER `master`**. Do not merge anything yourself.
4. **Language.** Every artefact is British English (`initialise`,
   `behaviour`). No German anywhere in the repo.
5. **TDD per task, in plan order.** Failing test → confirm the exact failure
   → minimal implementation → pass → commit. Subagents: one per task, review
   between tasks; subagents never merge, push, or switch branches.
6. **Commit convention.** Imperative subject, capitalised, prefixed `C:`.
   Footer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
7. **Gates.** Per task as named. Task 16 runs the FULL battery:
   `pnpm typecheck --force` (expect **14 successful, 14 total, 0 cached**),
   `pnpm --filter @chatsundere/user-client test`,
   `pnpm --filter @chatsundere/ui-shared test`, `pnpm build`. Biome bans
   non-null assertions (`!`); `pnpm exec biome check <touched files>` before
   each commit.
8. **Known-green baseline.** The user-client suite may show exactly **8**
   environmental failures (Node-26 experimental-localStorage trio). 0 or 8
   are acceptable; anything else is yours. Never claim "pre-existing"
   without confirming identical failure on the base branch.
9. **Audit gates are NOT yours.** Larissa re-audits the built diff (this
   plan touches the zero-knowledge boundary); Laura walks §11. Build exactly
   what the spec says; where this plan and the spec diverge, **the spec
   wins — report the divergence**.
10. **Scope guard.** `client-data-db.ts` may be modified ONLY as Task 1
    specifies (v33). Never touch `apps/auth-service`, `apps/sync-service`,
    `apps/proxy-service`, `packages/crypto` (consumption only, no edits),
    `packages/llm-unified`. No new dependencies. No tokens in
    `localStorage`.
11. **Zero-knowledge invariants (Larissa will check):** spec §12 verbatim —
    in particular H-1 trash-anchored terminality (§7.4), inert rejection
    (§7.1), locally computed hashes (§7.0), watermark monotonicity, and the
    settings allowlist polarity (§10). These are not optimisation targets;
    do not weaken them for a green test.

---

### Task 1: Dexie v33 + verno sweep (spec §4)

**Files:** Modify `apps/user-client/src/boot/client-data-db.ts` (v33 stores + upgrade + the four row interfaces + `SyncCollection` import); sweep every test asserting `db.verno` (enumerate: `rg -n "verno" apps/user-client -g '*.test.*'` — expect ~27 hits) from 32 to 33; new test file `apps/user-client/tests/boot/sync-schema.test.ts`.

**Produces:** tables `syncOutbox` (`'++seq, [collection+key]'`), `syncRows` (`'[collection+key]'`), `syncState` (`'id'`), `trash` (`'id, purgeAt'`); interfaces `SyncOutboxRow`, `SyncRowMeta`, `SyncStateRow` (with `pulling` + `attention` fields), `TrashRow` — exactly the spec §4 shapes (`key`, not `uuid` — spec §3.1). The v33 `upgrade()` stamps `updatedAt: Date.now()` on every `chats`, `messages`, `mindspaces`, `attachments` row lacking it.

- [ ] Failing tests: v33 tables exist post-open; an unstamped v32 chat/message/mindspace/attachment row carries `updatedAt` after upgrade; a stamped row keeps its original value.
- [ ] Implement; run the verno sweep; full user-client suite (rule 8) must return to baseline.
- [ ] Commit `C: Add Dexie v33 sync tables and updatedAt stamps`

### Task 2: Pure foundations — sync keys, strip, resolution (spec §3.1, §10, §7.5)

**Files:** Create `apps/user-client/src/sync/sync-keys.ts`, `sync/strip.ts`, `sync/resolution.ts` + one test file each under `apps/user-client/tests/sync/`.

**Produces (exact signatures later tasks consume):**

```ts
// sync-keys.ts — §3.1: the sync key is NOT always a uuid
export function syncKeyOfRow(collection: SyncCollection, row: unknown): string;
// 'settings' → '1' · 'vectors' → `${documentId}#${chunkIndex}` · else → row.id (personaAvatars → personaId)
export function extractKeyFor(collection: SyncCollection): (row: unknown) => string;

// strip.ts — §10: settings is ALLOWLIST, everything else deny-list
export function stripForSeal(collection: SyncCollection, row: unknown): unknown;
export function restoreLocalFields(collection: SyncCollection, pulled: unknown, local: unknown | undefined): unknown;
export const SETTINGS_SYNC_ALLOWLIST: readonly string[]; // explicit field list from SettingsRow — everything NOT listed stays device-local (adultMode, corsProxy, …)
// deny-list entries: chats.draftInput/openerPending/compactionToastShown + derived (lastMessageAt, bookmarkedMessageCount, activeCompactionId) + mcpServers.resolvedEndpoint/lastTestedAt/lastError/routing

// resolution.ts — §7.5, pure, no IO
export type Resolution = { winner: 'local' | 'pulled'; repush: boolean; note?: 'settings-applied' | 'settings-precedence' };
export function resolveConflict(collection: SyncCollection, local: unknown, pulled: unknown): Resolution;
// settings replay guard (M-8): pulled.updatedAt < local.updatedAt → { winner: 'local', repush: true }
// memoryJournal: state precedence archived > committed > uncommitted
// vectors: stamp adoption (codecVersion/modelId/dim) — incompatible → keep local + repush:false + caller schedules re-embed
export function memoryBodyAdoptsWinner(localJournalIds: string[], winnerEntriesProcessed: string[]): boolean; // anti-ping-pong
```

- [ ] Failing tests: the three key shapes both directions; settings allowlist round-trip (unlisted field survives locally, never sealed); mcpServers probe fields stripped; the full resolution matrix incl. LWW ties (uuid tie-break), settings replay guard, state precedence transitions, stamp adoption, anti-ping-pong.
- [ ] Implement → pass → `C: Add sync key, strip, and conflict-resolution foundations`

### Task 3: Gate + copy catalogue (spec §5 gating, §11.3)

**Files:** Create `sync/gate.ts`, `sync/copy.ts` + tests.

**Produces:** `useSyncGate()` (wraps `useServerGate('sync')`), `isSyncAvailable(): boolean`, `isClass2Allowed(): boolean` (local-only → true; linked → `server_ok` + unlocked session + no recovery in progress — reads a `recovering` flag exported by Task 7's watermark module; until Task 7 lands, import a placeholder const false from `watermark.ts` created here as a stub); `syncCopy` object with the §11.3 catalogue verbatim (quota_exceeded with `{used, quota}` interpolation, record_too_large, conflict-lost, delete_rate_limited, settings two-tier, tombstone threshold, recovery-paused, tamper alarm, bookmark-gentle, status-line states).

- [ ] Failing tests: gate matrix (local-only always true; linked+offline false; linked+recovering false); copy interpolation.
- [ ] Implement → pass → `C: Add sync gating and the sync copy catalogue`

### Task 4: Watermark/state module (spec §4, §6, §8 state, §11.1 states)

**Files:** Create `sync/watermark.ts` (replacing Task 3's stub) + tests.

**Produces:**

```ts
export async function getSyncState(): Promise<SyncStateRow>;           // lazily creates the singleton
export async function advanceWatermark(rev: number): Promise<void>;    // max(current, rev) — MONOTONE (M-7)
export async function setPulling(p: { pages: number; startedAt: number } | null): Promise<void>;
export async function setAttention(a: SyncAttention | null): Promise<void>;
export function isRecovering(): boolean;                                // in-memory flag + subscribe
export async function checkEpoch(epoch: string): Promise<'ok' | 'first' | 'mismatch'>;
```

- [ ] Failing tests: monotone advance never regresses; epoch first-sync persistence; mismatch detection.
- [ ] Implement → pass → `C: Add sync state and watermark helpers`

### Task 5: Enqueue + mutateSynced (spec §5)

**Files:** Create `sync/enqueue.ts` + tests.

**Produces:**

```ts
export function enqueueSync(tx: Dexie.Transaction, collection: SyncCollection, key: string, op: 'upsert' | 'delete'): void;
export class SyncOfflineError extends Error {}
export async function mutateSynced(args: { collection: SyncCollection; key: string; op?: 'upsert' | 'delete'; write: (tx: Dexie.Transaction) => Promise<void> }): Promise<void>;
// no-op passthrough (plain local write, no outbox) when linkStatus !== 'linked'
export function setImmediateDrain(fn: (target: { collection: SyncCollection; key: string }) => Promise<void>): void; // worker registers; enqueue stays import-cycle-free
```

`mutateSynced`: gate check (throw `SyncOfflineError`) → one Dexie tx (write + outbox row) → awaited immediate drain for that key; drain rejection propagates to a still-mounted caller, and ALSO sets the attention state when the failure arrives late (§5 pending semantics — the attention write happens in the drain path, Task 6, not here).

- [ ] Failing tests: local-only passthrough writes without outbox rows; linked enqueue is atomic with the write (crash-sim: tx abort leaves neither); offline throw; awaited drain called with the right target.
- [ ] Implement → pass → `C: Add outbox enqueue and Class-2 write-through`

### Task 6: Worker — drain/push (spec §6 drain, §7.0 hashes)

**Files:** Create `sync/worker.ts` (drain half) + `sync/seal-batch.ts` if you want the sealing pure-testable; tests with mocked `apiFetch`.

**Produces:**

```ts
export async function runSyncCycle(): Promise<void>;   // single-flight: navigator.locks 'chatsundere-sync' ifAvailable, process-mutex fallback
export async function drainOutbox(): Promise<DrainResult>; // exported for mutateSynced's immediate path
```

Drain, exactly spec §6: coalesce by `[collection+key]` (delete supersedes; create+delete-with-no-syncRows → nothing, L-4); read row → strip (Task 2) → `computeBlindId`/`sealRecord`; baseRev from `syncRows` else 0; byte-batch 4 MiB target; POST `<syncUrl>/api/v1/sync/changes` via `apiFetch`; results: `ok` → syncRows update with **locally computed SHA-256 of the sealed ciphertext** + outbox delete; `conflict` → poison-adoption rule (M-1: current undecryptable → adopt returned rev as CAS base + keep entry for re-push) else mark for pull-resolution; **`tombstoned`** (I-1 wire name) → drop entry + route row to trash; quota/rate → attention + backoff, never queue-blocking. Piggyback: pull iff `head > max(watermark, max own result rev)` (L-1). Epoch mismatch → recovery (Task 9). Watermark NEVER advances here.

- [ ] Failing tests: every branch above as its own case, incl. the coalescing trio, batching boundary, poison-adoption, and the piggyback inequality (push whose own revs top `head` must NOT pull).
- [ ] Implement → pass → `C: Add the sync worker drain and push path`

### Task 7: Apply pipeline (spec §7 — the security-critical task)

**Files:** Create `sync/apply.ts` + tests; extend `sync/worker.ts` with the pull loop.

Apply per record, in spec §7's exact order: echo shortcut (local hash vs `syncRows.ciphertextHash`; match → rev-adopt only) → stale-rev guard (`rev <= syncRows.rev` → ignore) → `openRecord(…, extractKeyFor(collection))`; failure → **inert rejection** (diagnostic counter, nothing local changes) → unhandled-collection skip → tombstone path (single Dexie tx: row→trash, outbox drop, syncRows removal, watermark advance — L-6; threshold notice ≥20/cycle, panic pause ≥200 pending acknowledgement — §7.3a; currently-viewing breadcrumb hook) → upsert with **H-1 trash-anchored terminality guard** (live pulled-tombstone trash entry → inert reject + tamper attention) and **L-3 pending-delete suppression** → insert or `resolveConflict` (Task 2) with settings note selection → derived-field recompute + **debounced/coalesced invalidation** (flush once per page batch).

Pull loop (worker): `since=watermark`, limit 200, page cap 64/cycle, `setPulling` progress, per-page apply-then-`advanceWatermark(max)`, echo tolerance as an explicit test.

- [ ] Failing tests: each §7 numbered branch, the H-1 scenario verbatim (tombstone arrives → trash; upsert for same key arrives → rejected, trash intact, attention set), pending-delete suppression, threshold + panic pause, page-cap continuation, watermark-regression page (malicious ordering) does not regress, invalidation coalescing (spy on queryClient).
- [ ] Implement → pass → `C: Add the pull-apply pipeline with conflict resolution`

### Task 8: Triggers + boot wiring (spec §6 triggers)

**Files:** Create `sync/triggers.ts`; modify `apps/user-client/src/boot/server-foundation.ts` (wire after WS-0 init: register `setImmediateDrain(drainOutbox)`, boot cycle after unlock, regain callback, visibilitychange, 10-min timer, 3-s debounced Class-1 kick) + tests (timer/debounce with fake timers).

- [ ] Failing tests → implement → pass → `C: Wire sync triggers into boot`

### Task 9: Epoch recovery (spec §8)

**Files:** Create `sync/recovery.ts` + tests.

Exactly §8: recovering flag on (gates Class 2) → syncRows/baseRev invalidation → pull-all from 0 under §7 rules → full re-push with fresh baseRevs → persist epoch last. **Rate limit:** exponential backoff between consecutive recoveries; >2/hour → engine stops with the recovery-paused attention state + manual retry. Triggered ONLY from authenticated responses; pokes merely schedule a verification cycle.

- [ ] Failing tests: full sequence order (epoch persisted last — crash-sim between steps re-runs recovery), rate limit, settings server-wins-during-recovery with replay guard.
- [ ] Implement → pass → `C: Add epoch recovery with flap containment`

### Task 10: Doorbell (spec §9)

**Files:** Create `sync/doorbell.ts` + tests (mock WebSocket).

Ticket POST → WSS connect; poke `{rev, epoch}` → schedule (debounced); epoch mismatch → schedule verification (never direct recovery); lifecycle gating (linked+unlocked+visible+online); backoff max 60 s, fresh ticket per attempt; `4401` → at most ONE refresh per backoff cycle, then degrade silently to timer; ticket/URL never in diagnostics.

- [ ] Failing tests: each behaviour, esp. the 4401 refresh cap and degrade-to-timer.
- [ ] Implement → pass → `C: Add the doorbell consumer`

### Task 11: Class-1 write-site sweep (spec §5 inventory)

**Files:** Modify the Class-1 sites. Enumerate first:
`rg -n "db\.(chats|messages|personas|libraries|documents|providers|mcpServers|settings|memoryJournal|memoryBody|mindspaces|vectors|pills|compactionCheckpoints|seedTemplates)\.(add|put|update|delete|bulkAdd|bulkPut|bulkDelete)" apps/user-client/src -g '!*.test.*'`
and classify every hit against spec §5's dispositions **in a table in your task report** (site → class → action). Class-1 sites (message completion in `stream-manager.store`/`send-message`, memoryJournal appends in `memory/repo`, compaction checkpoints in `compaction/repo`, creation-inserts in `data/*.ts`, knowledge ingestion, both importers) get `enqueueSync` inside their existing transaction — wrap a write in `db.transaction(...)` where none exists. Device-local tables and derived/transient field writes get NOTHING (`voiceAudio`, draft/opener/toast fields, `lastMessageAt` recomputes…). `memoryBody` creation is CLASS 2 (spec §5 exception) — leave it for Task 12.

- [ ] Tests: representative integration specs per family (message complete → outbox row; import → creation-insert rows; draft keystroke → NO row).
- [ ] Full user-client suite (rule 8) → `C: Enqueue Class-1 writes into the sync outbox`

### Task 12: Class-2 sweep — mutateSynced + disabled gating (spec §5, §11.2)

**Files:** Convert every Class-2 site from the Task 11 table to `mutateSynced` (persona edit/delete, chat rename/delete, bookmark toggle, provider/mcpServer edits, settings updates via `data/settings.ts`, document/library ops, seed-template edits, mindspace management, `lastExtractedMessageId`, memoryBody creation+transitions, title-gen write w/ offline defer). Their surfaces gain `useSyncGate`-driven disabled-over-hidden with tooltips (WS-0 affordance mandate; bookmark gets the gentle copy).

- [ ] Tests: per-family — offline+linked disables (component test), local-only unaffected, online mutation round-trip enqueues + awaits.
- [ ] Full suite → `C: Gate Class-2 mutations through synced write-through`

### Task 13: Status line + attention UI + ConnectivityBadge copy (spec §11.1, §11.2)

**Files:** Create `apps/user-client/src/components/SyncStatusLine.tsx` (mounted on the account/server-linking page), the attention-state rendering, the settings-note toast hook, the tombstone breadcrumb hook (chat surface), extend `ConnectivityBadge.tsx`'s expanded state with the paused-shared-edits system copy. All copy from `sync/copy.ts`.

- [ ] Component tests: all six §11.1 states (Synced excludes active pull!), badge copy when linked+offline, breadcrumb on viewed-record tombstone.
- [ ] Full suite → `C: Add sync status, attention surfaces, and offline framing`

### Task 14: Malicious-server integration scenarios (spec §14)

**Files:** `apps/user-client/tests/sync/scenarios.test.ts` — two in-memory engine instances against a scripted server harness: A-edits→B-pulls happy path; echo storm; tombstone-then-resurrect (H-1); epoch flap (rate limit trips); watermark-regression page; poison-conflict heal (M-1); settings replay (M-8).

- [ ] Write scenarios (they should pass against Tasks 6–9's code; any failure is a real bug — fix in the owning module, never by weakening the scenario) → `C: Add adversarial sync integration scenarios`

### Task 15: Docs + registers (spec §13)

**Files:** Append to `obsidian/insights/future-feature-couplings.md`: trash restore UI; offline-bookmarking post-alpha revisit; **uplevelling must re-seal `EncryptedBlob` secrets** (Larissa's verified-clean coupling). Append the strip-list checklist note. `[skip ci]` commit.

- [ ] `C: Register sync follow-up couplings [skip ci]`

### Task 16: Full battery + STATUS

- [ ] Rule 7's full battery; record exact counts.
- [ ] Update `STATUS-TRANSITION.md` §6/§7 (WS-C built-pending-audit, mirror the WS-0 entry shape).
- [ ] `C: Record WS-C sync engine build in transition status [skip ci]`

## Final report checklist

Per-suite counts; typecheck cache line; rule-8 baseline statement; the Task
11 classification table in full; every file touched that the plan did not
name (and why); every spec§/plan divergence (and why); explicit confirmation
that the §12 invariants have dedicated passing tests (name them).
