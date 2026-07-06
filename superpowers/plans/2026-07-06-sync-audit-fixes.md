# Sync Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eight severe data-loss/deletion-loss defects from the 2026-07-06 sync audit (spec `superpowers/specs/2026-07-06-sync-audit-fixes-design.md`) as five numbered PRs into `full-backend-transition`.

**Architecture:** Two structural roots are fixed: (A) the pull watermark may only advance over durably-absorbed records — engine-unavailability aborts the cycle, suppressed revs record a CAS base and are re-fetchable after Undo; (B) transitions (recovery, relink, restore) stop violating steady-state premises — blind-id resolution gains a `syncRows`-independent fallback, restore re-establishes the blob channel, relink acks are generation-guarded.

**Tech Stack:** TypeScript strict, Dexie (v34 — **no version bump anywhere in this plan**), Vitest (`apps/user-client/tests/**`), Biome, pnpm + Turborepo.

## Operating rules for the overnight worker (READ FIRST)

These rules are binding and override your defaults. They encode repo
conventions you cannot otherwise see.

1. **Language.** Every text artefact you produce — code, comments, test names,
   commit messages, PR titles/bodies — is **British English** (`colour`,
   `initialise`, `behaviour`). Never German, never US spelling.
2. **TDD per task.** For every task: write the failing test, RUN it and confirm
   it fails for the expected reason, write the minimal implementation, RUN it
   and confirm it passes, then commit. Never implementation-first.
3. **Execution discipline.** Use subagent-driven development: one fresh
   subagent per task, a spec-conformance + code-quality review after each task.
   Subagents never merge, never push, never switch branches — you (the
   orchestrator) own all git operations. Verify each subagent's commit landed
   on the intended branch (`git branch --contains <sha>`); recover dangling
   commits via reflog before proceeding.
4. **Worktrees and lanes.** Each PR branch lives in its own git worktree. Lane
   α = PR 1 → PR 2 → PR 3 (each branch cut from its predecessor's tip). Lane β
   = PR 4, cut from `full-backend-transition`, may run in parallel with lane α.
   PR 5 is built on a local integration branch: merge PR 3's tip and PR 4's tip
   together first (resolve the small `worker.ts` textual overlap — PR 3 edits
   `coalesce`/the missing-row branch, PR 4 edits phase 3; they are semantically
   disjoint), re-run the full gate on the merged state, then implement Task 10
   on top.
5. **Branch discipline — hard rule.** You may create and push `claude/…`
   branches and open PRs **against `full-backend-transition`**. You must NEVER
   push to, merge into, or commit on `full-backend-transition` or `master`
   themselves. PRs stay open; the human reviews, audits, device-tests, and
   merges.
6. **Verification.** The gate for every PR is: `pnpm typecheck --force` from
   the repo root (expect **14 successful / 14 total, 0 cached** — a cached pass
   is not a pass), the **FULL** user-client suite `pnpm --filter user-client
   vitest run` (never only the touched directories), and `pnpm biome check`
   on every changed file. `pnpm run build` (expect 9/9) at least once per lane
   and in the final Task 11 gate.
7. **Known-green baseline.** The full user-client suite has **8 known
   environmental failures** on Node's experimental localStorage
   (`localStorage.clear is not a function` — same three files every run). They
   are NOT yours. One more known flake: `stream-manager-store` under parallel
   load — it must pass in isolation (`pnpm --filter user-client vitest run
   tests/state/stream-manager-store.test.ts`). ANY other failure is a
   regression you introduced: fix it before proceeding. Confirm the baseline
   once on the base branch before starting, so you know its exact shape.
8. **Security boundary.** Every task here touches `apps/user-client/src/sync/**`
   or `src/trash/**` — a **mandatory security-audit path**. You cannot summon
   the auditor (Larissa); the audit happens at integration. Your obligations:
   never weaken the zero-knowledge boundary (no plaintext, keys, or new
   cleartext metadata to the server), never remove an existing security
   assertion/test, and flag every deviation from the plan in the PR body under
   a "Deviations" heading. Deviations toward the spec are allowed; deviations
   from the spec are not.
9. **Environment.** `pnpm install` first; Node ≥ 20 and pnpm 9 assumed. If
   typecheck reports phantom errors for symbols that exist in `packages/*/src`,
   rebuild the packages (`pnpm run build`) — a stale `dist/` is the usual
   cause. No Docker, no backend services, and no provider keys are needed:
   every test in this plan runs under Vitest with fake-indexeddb and stubbed
   transports.
10. **Do not touch** `STATUS-*.md`, `obsidian/**`, or `superpowers/**` — the
    humans work on this branch in parallel and those files are theirs. Your
    reporting surface is the PR descriptions.
11. **Commit format.** Free-form imperative subject, capitalised, no
    Conventional-Commits prefix, never `[skip ci]` on code commits. Every
    commit ends with:
    `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
12. **Biome bans the non-null `!` operator** and runs as a pre-commit hook;
    write guards instead of assertions.
13. **Final hand-off (after Task 11).** In PR 5's description, report: the
    verification numbers for every gate (typecheck, full vitest incl. the
    baseline's exact shape this run, build, biome), the commit list per PR
    branch, the findings-closed-per-PR mapping, and all deviations. Then stop.
    Do not merge anything.

## Global Constraints

- Every text artefact is **British English** (code, comments, commit messages, test names).
- Biome is the pre-commit gate and **bans the non-null `!` operator**; run `pnpm biome check --write <files>` before each commit.
- Tests live under `apps/user-client/tests/**` (never beside sources); backend-style `bun test` is NOT used in the user-client — Vitest only.
- The repo-wide gate is `pnpm typecheck --force` (expect **14/14**, never trust a cached pass) plus the **full** user-client Vitest suite (baseline: 8 known Node-localStorage failures — `localStorage.clear()` undefined — are environmental; any OTHER failure is yours).
- Workers/subagents **never merge, push, or switch branches**; each PR branch is a dedicated worktree cut from `full-backend-transition` (or the prior PR's branch where a dependency is declared).
- No new Dexie stores or indexes. New row fields are unindexed and healed via `getSyncState`'s default-merge (for `syncState`) or `?? default` reads (for `chats`/trash rows).
- Commit co-author tag: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- Zero-knowledge boundary: no fix may send plaintext, keys, or new cleartext metadata to the server (spec §5).
- Line anchors below are as of `full-backend-transition` tip `9a0888fd`; if lines have drifted, the function names are authoritative.

## PR map

| PR | Branch | Contents | Base |
|----|--------|----------|------|
| 1 | `claude/sync-fix-01-pull-durability` | Tasks 1–4 | `full-backend-transition` |
| 2 | `claude/sync-fix-02-recovery-resolution` | Tasks 5–6 | PR 1 branch |
| 3 | `claude/sync-fix-03-coalescer` | Task 7 | PR 2 branch |
| 4 | `claude/sync-fix-04-restore-blobs` | Tasks 8–9 | `full-backend-transition` (parallel lane β; rebase onto PR 3 before opening the PR if it merged first) |
| 5 | `claude/sync-fix-05-relink-guard` | Task 10 | local merge of PR 3 tip + PR 4 tip (Operating rule 4) |
| — | — | Task 11: final integrated gate | on PR 5's branch |

Lane α (PRs 1→2→3) and lane β (PR 4) may run in parallel worktrees; PR 5 is
built on the local integration of both lanes (Operating rule 4) so the overnight
run never waits on a human merge. The human integrates the PRs in order 1→5.

---

## PR 1 — Pull-loop durability and suppression semantics (findings #1, #3, #5)

### Task 1: `unavailable` outcome — engine loss aborts the pull loop

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (the `ApplyOutcome` union + `applyRecord`, around lines 396-398)
- Modify: `apps/user-client/src/sync/worker.ts` (the pull loop, around lines 975-997)
- Modify: `apps/user-client/src/sync/recovery.ts` (`pullAllFromZero`'s record loop)
- Test: `apps/user-client/tests/sync/pull-unavailable.test.ts` (create)

**Interfaces:**
- Produces: `ApplyOutcome` gains `{ kind: 'unavailable' }`; `applyRecord` returns it when the session MK is absent. The pull loop and `pullAllFromZero` both abort on it. New exported error class `RecoveryAbortedError` in `recovery.ts` (message `'Recovery aborted: engine unavailable mid-pull.'`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/pull-unavailable.test.ts
import { describe, expect, it } from 'vitest';
// Use the same harness helpers the existing pull tests use — mirror the
// imports/setup of apps/user-client/tests/sync/worker.test.ts (fake-indexeddb,
// seeded session store, _setPullLoop/transport stubs).

describe('pull loop under engine unavailability (audit finding #1)', () => {
  it('aborts the page and holds the watermark when the MK vanishes mid-page', async () => {
    // Arrange: a linked, unlocked engine; a pull page of three records with
    // revs 5, 6, 7. Instrument the transport/apply seam so that AFTER record
    // rev 5 is applied, the session store's mk is set to null (simulating
    // closeAndForget() firing from another code path mid-pull).
    // Act: run one sync cycle.
    // Assert: the row from rev 5 IS applied locally; the rows from revs 6/7
    // are NOT; the persisted watermarkRev === 5 (not 7); no attention raised.
  });

  it('applyRecord returns unavailable (not rejected) without an MK', async () => {
    // Arrange: session store mk = null. Act: applyRecord(anyUpsertRecord).
    // Assert: outcome.kind === 'unavailable'.
  });

  it('recovery aborts before the epoch persist when the MK vanishes mid-pull-all', async () => {
    // Arrange: epoch-mismatch recovery underway; pullAllFromZero page contains
    // two records; null the mk after the first.
    // Assert: performRecovery rejects (RecoveryAbortedError), syncState.epoch
    // is UNCHANGED (the old value), and isRecovering() is false afterwards.
  });
});
```

Fill the arrange/act sections with the concrete harness calls from
`worker.test.ts` — the seams (`_setPullLoop`, transport stubs, `useSessionStore`
setter) already exist there; copy their setup verbatim rather than inventing new
mocks.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter user-client vitest run tests/sync/pull-unavailable.test.ts`
Expected: FAIL — `unavailable` is not a member of `ApplyOutcome`; watermark advances to 7.

- [ ] **Step 3: Implement**

`apply.ts` — outcome union + the guard:

```ts
// In the ApplyOutcome union, add:
//   | { kind: 'unavailable' }
// with the doc line: "Engine-availability failure (no MK): NOT poison — the
// pull loop must abort and hold the watermark (audit finding #1)."

export async function applyRecord(pulled: SyncPulledRecord): Promise<ApplyOutcome> {
  const mk = useSessionStore.getState().mk;
  if (!mk) return { kind: 'unavailable' };
  // ... unchanged
}
```

`worker.ts` — the pull loop's record iteration becomes outcome-aware:

```ts
let engineUnavailable = false;
for (const record of ordered) {
  if (record.rev <= watermarkRev) continue; // L-B: honest servers never send these
  if (record.deleted && applied >= TOMBSTONE_CYCLE_CAP) {
    lowestDeferredRev =
      lowestDeferredRev === null ? record.rev : Math.min(lowestDeferredRev, record.rev);
    cappedThisCycle = true;
    continue;
  }
  const outcome = await applyRecord(record);
  if (outcome.kind === 'unavailable') {
    // Finding #1: the session ended mid-pull. Everything up to highestApplied
    // was durably absorbed; this record and the rest of the page were NOT —
    // abort without advancing past them. The next authenticated cycle resumes.
    engineUnavailable = true;
    break;
  }
  if (record.deleted) applied += 1;
  if (record.rev > highestApplied) highestApplied = record.rev;
}
const nextWatermark = lowestDeferredRev !== null ? lowestDeferredRev - 1 : highestApplied;
await advanceWatermark(nextWatermark);
flushInvalidations();
if (engineUnavailable) return; // (inside the try; the finally clears `pulling`)
more = cappedThisCycle ? false : response.more;
```

Note the deferred-tombstone interaction: when the abort fires, `lowestDeferredRev`
still wins the `nextWatermark` computation if set — both holds are "do not pass
unabsorbed records", so `min` semantics via the existing expression are correct
(`advanceWatermark` is monotone; holding lower is always safe).

`recovery.ts` — `pullAllFromZero`'s loop gets the identical outcome check, but
throws instead of returning:

```ts
export class RecoveryAbortedError extends Error {
  constructor() {
    super('Recovery aborted: engine unavailable mid-pull.');
    this.name = 'RecoveryAbortedError';
  }
}
// In pullAllFromZero's per-record loop:
const outcome = await applyRecord(record);
if (outcome.kind === 'unavailable') throw new RecoveryAbortedError();
```

`performRecovery` needs no change: the throw propagates before step 5, so the
epoch persist never runs (the existing crash boundary).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter user-client vitest run tests/sync/pull-unavailable.test.ts`
Expected: PASS. Also run the neighbouring suites: `pnpm --filter user-client vitest run tests/sync/` — no regression.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/apply.ts apps/user-client/src/sync/worker.ts apps/user-client/src/sync/recovery.ts apps/user-client/tests/sync/pull-unavailable.test.ts
git commit -m "Abort the pull loop instead of paging over records when the MK is gone

Audit finding #1 (CRITICAL): applyRecord returned 'rejected' per record
after a mid-pull session loss and the watermark advanced past every
unapplied record — permanently, since the server only serves rev > since.
In recovery this could persist the new epoch over an unapplied corpus.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

### Task 2: Suppression establishes the CAS base and records the suppressed rev

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (the `§7.4 L-3` suppression branch, around line 565)
- Modify: `apps/user-client/src/sync/watermark.ts` (`defaultState` + two helpers)
- Modify: `apps/user-client/src/boot/client-data-db.ts` (the `SyncStateRow` type only — a new optional field, **no Dexie version bump**)
- Modify: `apps/user-client/src/sync/link-reset.ts` + `apps/user-client/src/sync/recovery.ts` (clear the map at both resets)
- Test: `apps/user-client/tests/sync/apply-suppression.test.ts` (create; fold in any existing suppression assertions from `apply.test.ts` if they conflict)

**Interfaces:**
- Produces: `SyncStateRow.suppressedRevs?: Record<string, number>` (key = `` `${collection}:${key}` ``, value = highest suppressed rev). New exports in `watermark.ts`: `recordSuppressedRev(collection: SyncCollection, key: string, rev: number): Promise<void>` and `takeSuppressedRevs(pairs: Array<{ collection: string; key: string }>): Promise<number | null>` (returns the minimum recorded rev across the pairs and deletes those entries — the Undo consumer).
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/apply-suppression.test.ts
describe('pending-delete suppression (audit findings #3, #5)', () => {
  it('writes the syncRows CAS base when suppressing a pulled upsert', async () => {
    // Arrange: local row absent, a pending outbox delete for [chats, K],
    // pulled upsert for K at rev 9.
    // Act: applyRecord(pulled).
    // Assert: outcome.kind === 'suppressed' AND db.syncRows.get(['chats', K])
    // is { rev: 9, ciphertextHash: <sha256 of pulled ciphertext> }.
  });

  it('records the suppressed rev for the Undo rewind', async () => {
    // Same arrange/act. Assert: (await getSyncState()).suppressedRevs
    // has { 'chats:K': 9 }.
  });

  it('drains the pending delete as a tombstone after a recovery cleared syncRows', async () => {
    // The full finding-#3 chain: pending delete for K; simulate recovery step 2
    // (syncRows.clear() + watermark 0); pull K's live upsert (→ suppressed,
    // meta re-established); run drainOutbox against a stub server.
    // Assert: the push body contains a DELETE record for K's blindId
    // (previously: the L-4 guard dropped it and pushed nothing).
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/sync/apply-suppression.test.ts`
Expected: FAIL — no meta written, no `suppressedRevs` field, drain pushes nothing.

- [ ] **Step 3: Implement**

`client-data-db.ts` — extend the type (unindexed field, no schema change):

```ts
// On SyncStateRow:
/** Highest pulled-but-suppressed rev per `collection:key` (audit #5): consumed
 *  by the fast-Undo watermark rewind, cleared on drain-ack/recovery/relink. */
suppressedRevs?: Record<string, number>;
```

`watermark.ts` — default + helpers (`defaultState()` gains `suppressedRevs: {}`;
the existing legacy-heal merge in `getSyncState` then backfills old rows):

```ts
/** Record a suppressed pulled rev so a fast Undo can rewind below it (audit #5). */
export async function recordSuppressedRev(
  collection: string,
  key: string,
  rev: number,
): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const map = { ...(state.suppressedRevs ?? {}) };
    const id = `${collection}:${key}`;
    map[id] = Math.max(map[id] ?? 0, rev);
    await db.syncState.update(STATE_ID, { suppressedRevs: map });
  });
}

/** Consume (read + delete) the suppressed revs for the given pairs; returns the
 *  minimum, or null when none were recorded. */
export async function takeSuppressedRevs(
  pairs: Array<{ collection: string; key: string }>,
): Promise<number | null> {
  const db = getClientDataDb();
  let min: number | null = null;
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const map = { ...(state.suppressedRevs ?? {}) };
    for (const p of pairs) {
      const id = `${p.collection}:${p.key}`;
      const rev = map[id];
      if (rev !== undefined) {
        min = min === null ? rev : Math.min(min, rev);
        delete map[id];
      }
    }
    await db.syncState.update(STATE_ID, { suppressedRevs: map });
  });
  return min;
}
```

`apply.ts` — the suppression branch (mirrors the local-wins no-meta branch):

```ts
// §7.4 L-3 — a pending local delete wins locally too; suppress the insert.
// Audit #3/#5: establish the CAS base (so a recovery drain still finds meta and
// mints the tombstone, and a post-Undo edit pushes a correct baseRev) and record
// the suppressed rev (so an Undo can rewind the watermark below it).
if (await hasPendingDelete(collection, key)) {
  await db.syncRows.put({ collection, key, rev: pulled.rev, ciphertextHash: localHash });
  await recordSuppressedRev(collection, key, pulled.rev);
  return { kind: 'suppressed' };
}
```

`recovery.ts` `performRecovery` step 2 and both `link-reset.ts` resets add
`suppressedRevs: {}` to their `syncState.update` patches (a rewind target below
a `watermarkRev: 0` reset is meaningless).

Also clear the consumed entry at the server-authoritative delete ack: in
`worker.ts` `applyOk`'s delete branch and `applyTombstoned`, remove the
`collection:key` entry from `suppressedRevs` (the server row is gone — a state
store no longer serves the suppressed rev, so the entry is moot). Reuse
`takeSuppressedRevs([{ collection, key }])` for this.

- [ ] **Step 4: Run to verify pass, then the neighbouring suites**

Run: `pnpm --filter user-client vitest run tests/sync/apply-suppression.test.ts tests/sync/apply.test.ts tests/sync/worker.test.ts`
Expected: PASS. If `apply.test.ts` pinned "suppression writes no meta", update that assertion — the spec consciously changed this behaviour (spec §3.1b).

- [ ] **Step 5: Commit**

```bash
git add -A apps/user-client/src/sync apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/sync
git commit -m "Establish the CAS base and record the rev when suppressing a pulled upsert

Audit findings #3 and #5 (HIGH): suppression left no syncRows meta, so a
recovery's drain dropped the pending tombstone (deletion reverted
fleet-wide) and a post-Undo edit pushed baseRev 0 into a permanent
conflict loop. The suppressed rev is now recorded for the Undo rewind.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

### Task 3: Undo rewinds the watermark below suppressed revs

**Files:**
- Modify: `apps/user-client/src/sync/watermark.ts` (new `rewindWatermark`)
- Modify: `apps/user-client/src/trash/delete-flow.ts` (the `restore()` closure)
- Test: `apps/user-client/tests/trash/undo-rewind.test.ts` (create)

**Interfaces:**
- Consumes: `takeSuppressedRevs` from Task 2.
- Produces: `rewindWatermark(rev: number): Promise<void>` in `watermark.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/trash/undo-rewind.test.ts
describe('fast-Undo watermark rewind (audit finding #5)', () => {
  it('rewinds the watermark below the suppressed rev on in-place restore', async () => {
    // Arrange: watermarkRev 12; softDelete a chat K; simulate a suppressed pull
    // at rev 9 (recordSuppressedRev('chats', K, 9)); call handle.restore().
    // Assert: (await getSyncState()).watermarkRev === 8 and suppressedRevs no
    // longer contains 'chats:K'.
  });

  it('leaves the watermark alone when nothing was suppressed', async () => {
    // softDelete + restore with no recorded suppression → watermark unchanged.
  });

  it('re-applies the foreign edit after the rewound pull (end-to-end)', async () => {
    // Arrange: the full #5 chain — pending delete, pulled foreign edit at rev 9
    // (suppressed), Undo, then run a pull cycle whose stub server serves the
    // record at rev 9 again (state store).
    // Assert: the local chat row carries the foreign edit's content (LWW picked
    // the newer pulled row over the restored snapshot).
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/trash/undo-rewind.test.ts`
Expected: FAIL — `rewindWatermark` does not exist; watermark stays 12.

- [ ] **Step 3: Implement**

`watermark.ts`:

```ts
/**
 * DELIBERATE monotonicity exception (audit #5; the recovery `watermarkRev: 0`
 * reset is the other one): rewind the watermark so a suppressed-then-undone
 * foreign edit is re-delivered. Only ever called with `suppressedRev - 1`,
 * i.e. a rev the server actually served — never attacker-controllable input.
 * Rewinding lower than necessary is safe (re-deliveries are idempotent echoes);
 * rewinding is never allowed to move FORWARD (min clamp).
 */
export async function rewindWatermark(rev: number): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.syncState, async () => {
    const state = await getSyncState();
    const next = Math.min(state.watermarkRev, Math.max(0, rev));
    if (next !== state.watermarkRev) {
      await db.syncState.update(STATE_ID, { watermarkRev: next });
    }
  });
}
```

`delete-flow.ts` — inside `restore()`, after the restore transaction commits:

```ts
// Audit #5: a foreign edit pulled while our delete was pending was suppressed
// and its rev skipped. Now that the delete is undone, rewind the watermark
// below the lowest suppressed rev so the next pull re-delivers it and normal
// LWW resolution runs against the restored row.
const minSuppressed = await takeSuppressedRevs(
  snapshots.map((s) => ({ collection: s.collection, key: s.key })),
);
if (minSuppressed !== null) await rewindWatermark(minSuppressed - 1);
scheduleClass1Sync(); // kick a pull promptly rather than waiting for the timer
```

(`scheduleClass1Sync` is the existing exported trigger in `sync/triggers.ts` —
verify the exact name there and use whatever the trash surfaces already call.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/trash/ tests/sync/`
Expected: PASS, incl. the existing trash suite (37 tests) unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/watermark.ts apps/user-client/src/trash/delete-flow.ts apps/user-client/tests/trash/undo-rewind.test.ts
git commit -m "Rewind the watermark below suppressed revs on fast Undo

Audit finding #5 (HIGH): the suppressed foreign edit's rev had already been
paged over, so after an Undo it was unreachable forever. The rewind makes
the next pull re-deliver it; LWW then resolves against the restored row.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

### Task 4: PR 1 gate

- [ ] Run `pnpm typecheck --force` from the repo root. Expected: 14/14, 0 cached.
- [ ] Run the FULL user-client suite: `pnpm --filter user-client vitest run`. Expected: only the 8-test Node-localStorage baseline may fail.
- [ ] Run `pnpm biome check apps/user-client/src apps/user-client/tests`. Expected: clean.
- [ ] Open PR 1 against `full-backend-transition` titled "Sync audit fixes 1/5: pull-loop durability and suppression semantics" with the three commit summaries in the body. Do NOT merge it yourself.

---

## PR 2 — Recovery tombstone resolution + blob re-upload answer path (findings #4, #7)

### Task 5: `findKeyByBlindId` stage-2 local-key fallback

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (`findKeyByBlindId`, lines ~358-376, plus a per-cycle cache reset hook)
- Test: `apps/user-client/tests/sync/tombstone-resolution.test.ts` (create)

**Interfaces:**
- Consumes: the existing per-collection table map used by `readLocalRow` (same file) — reuse it, do not duplicate the collection→table mapping.
- Produces: `resetBlindIdCycleCache(): void` exported from `apply.ts`, called where `resetBlobRepairCycle()` is called in `worker.ts` (`drainOutbox` start) and at `runPullLoop` start.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/tombstone-resolution.test.ts
describe('tombstone blind-id resolution (audit finding #4)', () => {
  it('resolves a tombstone via local keys when syncRows is empty (recovery)', async () => {
    // Arrange: a local chat K exists; syncRows is EMPTY (recovery step 2 ran);
    // a pulled tombstone whose blindId = blindIdOf('chats', K).
    // Act: applyRecord(tombstone).
    // Assert: outcome.kind === 'tombstoned'; the chat row moved to db.trash;
    // deadKeys contains ['chats', K].
  });

  it('resolves tombstones for non-repush collections during recovery', async () => {
    // Same, with an attachments row (REPUSH_COLLECTIONS excludes attachments —
    // previously these were never cleaned up during recovery at all).
  });

  it('still no-ops for a genuinely unknown blind id', async () => {
    // Empty syncRows, no matching local row → outcome 'tombstoned', no trash
    // write, no deadKeys write.
  });

  it('steady state stays on stage 1 (no local enumeration when syncRows hits)', async () => {
    // Spy on the table enumeration; with a syncRows meta present the fallback
    // must not run.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/sync/tombstone-resolution.test.ts`
Expected: FAIL — tombstone with empty syncRows is a no-op today.

- [ ] **Step 3: Implement**

```ts
// apply.ts — a lazily-built, cycle-scoped reverse index for stage 2.
let blindIdCache: Map<string, Map<string, string>> | null = null;

/** Reset the stage-2 blind-id cache (called at drain/pull cycle start). */
export function resetBlindIdCycleCache(): void {
  blindIdCache = null;
}

async function findKeyByBlindId(
  mk: MasterKey,
  collection: SyncCollection,
  blindIdB64: string,
): Promise<string | null> {
  const db = getClientDataDb();
  // Stage 1 — steady state: resolve via syncRows (unchanged, cheap).
  const metas = await db.syncRows.where('collection').equals(collection).toArray();
  for (const meta of metas) {
    const bid = toBase64Url(await activeBlindId()(mk, collection, meta.key));
    if (bid === blindIdB64) return meta.key;
  }
  // Stage 2 (audit #4) — syncRows-independent fallback: during recovery the
  // metas were legitimately cleared, but the ROW is still here. Enumerate the
  // collection's local primary keys once per cycle and match. Stateless — a
  // crashed-and-rerun recovery behaves identically.
  blindIdCache ??= new Map();
  let perCollection = blindIdCache.get(collection);
  if (!perCollection) {
    perCollection = new Map();
    const keys = await listLocalKeys(collection); // reuse readLocalRow's table map
    for (const key of keys) {
      perCollection.set(toBase64Url(await activeBlindId()(mk, collection, key)), key);
    }
    blindIdCache.set(collection, perCollection);
  }
  return perCollection.get(blindIdB64) ?? null;
}
```

`listLocalKeys(collection)` is a small helper beside `readLocalRow` returning
`table.toCollection().primaryKeys()` coerced to `string[]` (for
`personaAvatars` the PK is the personaId — the table map already encodes this).
Wire `resetBlindIdCycleCache()` next to `resetBlobRepairCycle()` in
`drainOutbox` and at the top of `runPullLoop` — a stale cache entry from a
previous cycle could otherwise resurrect-map a re-minted key.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/sync/`
Expected: PASS incl. existing apply/recovery suites.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/apply.ts apps/user-client/src/sync/worker.ts apps/user-client/tests/sync/tombstone-resolution.test.ts
git commit -m "Resolve tombstone blind ids via local keys when syncRows is cleared

Audit finding #4 (HIGH): recovery clears syncRows, so every tombstone in
the pull-all was a silent no-op — deletions from other devices were
skipped, and non-repush collections were never cleaned up at all.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

### Task 6: `blob_reupload_threshold` answer path

**Files:**
- Modify: `apps/user-client/src/sync/recovery.ts` (`recoverBlobs` gains `{ force }`; new exported `confirmBlobReupload`)
- Modify: `apps/user-client/src/sync/copy.ts` (the attention copy for the kind — action-bearing wording)
- Modify: the attention surface component (`SyncStatusLine` — locate via `rg -n "blob_reupload_threshold" apps/user-client/src`) to render an action button for this kind
- Test: `apps/user-client/tests/sync/blob-reupload-confirm.test.ts` (create) + a component test beside the existing `SyncStatusLine` tests

**Interfaces:**
- Produces: `confirmBlobReupload(): Promise<void>` — runs the inventory diff + re-PUTs ignoring the threshold, clears the `blob_reupload_threshold` attention on success, re-raises `quota_exceeded`/transport attentions through the existing paths on failure. The UI calls exactly this.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/blob-reupload-confirm.test.ts
describe('blob re-upload confirmation (audit finding #7)', () => {
  it('uploads every missing blob and clears the attention when forced', async () => {
    // Arrange: local rows holding two blob refs with bytes; a stub inventory
    // missing both; total size ABOVE the threshold; attention
    // blob_reupload_threshold set (as performRecovery left it).
    // Act: confirmBlobReupload().
    // Assert: putBlob called for both ids; attention === null.
  });

  it('keeps the attention when an upload fails', async () => {
    // One putBlob rejects → confirmBlobReupload rejects, attention unchanged.
  });

  it('performRecovery still asks (uploads nothing) above the threshold', async () => {
    // The existing behaviour — pin it so the force flag never leaks into the
    // automatic path.
  });
});
```

Component test: the status line renders a button labelled `Upload them now`
for the kind and invokes `confirmBlobReupload` on activation (mock the module).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/sync/blob-reupload-confirm.test.ts`
Expected: FAIL — `confirmBlobReupload` does not exist.

- [ ] **Step 3: Implement**

`recovery.ts`:

```ts
// recoverBlobs signature gains options:
async function recoverBlobs(opts: { force?: boolean } = {}): Promise<void> {
  // ... unchanged until the threshold check:
  if (!opts.force && totalBytes > reuploadThreshold) {
    await setAttention({ kind: 'blob_reupload_threshold', bytes: totalBytes, count: missing.length });
    return;
  }
  // ... unchanged upload loop
}

/**
 * The answer path for the `blob_reupload_threshold` ask (audit #7): re-run the
 * inventory diff and upload regardless of size, under the sync Web Lock so it
 * never interleaves with a drain's blob phases. Clears the attention only
 * after every missing blob uploaded.
 */
export async function confirmBlobReupload(): Promise<void> {
  await withSyncLock(async () => {           // reuse the cycle's Web Lock helper
    await recoverBlobs({ force: true });
    const { attention } = await getSyncState();
    if (attention?.kind === 'blob_reupload_threshold') await setAttention(null);
  });
}
```

(`withSyncLock` — reuse whatever `runSyncCycle` uses for its single-flight Web
Lock in `triggers.ts`/`worker.ts`; if it is not extracted as a helper yet,
extract it, do not duplicate the lock name string.)

Status line: follow the component's existing pattern for action-bearing
attention kinds (the `auth_degraded` Reconnect affordance is the precedent —
mirror its markup/handler shape). Copy, in `copy.ts`, constructive-error
register:

```
This server is missing {count} images ({size}) that this device still holds.
→ action label: "Upload them now"
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/sync/ tests/components/` (or wherever the SyncStatusLine tests live — locate with `rg -l "SyncStatusLine" apps/user-client/tests`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/user-client/src apps/user-client/tests
git commit -m "Give the blob re-upload threshold ask a real answer path

Audit finding #7 (HIGH): the attention was raised, the epoch persisted
anyway, and no code path existed to say yes — >512 MiB of server-lost
blobs were unrecoverable forever. Upload-now affordance added; the epoch
persist deliberately stays (the blob reconcile is epoch-independent).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] Repeat the Task 4 gate (typecheck --force, full vitest, biome) and open PR 2 ("Sync audit fixes 2/5: recovery tombstone resolution and blob re-upload answer path") based on PR 1's branch.

---

## PR 3 — Coalescer tombstone degrade (finding #2)

### Task 7: `hasDelete` group flag + missing-row degrade

**Files:**
- Modify: `apps/user-client/src/sync/worker.ts` (`OutboxGroup`, `coalesce`, and the drain's missing-row branch — lines ~246-274 and ~357-373)
- Test: `apps/user-client/tests/sync/coalesce-degrade.test.ts` (create)

**Interfaces:** self-contained.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/coalesce-degrade.test.ts
describe('coalescer delete→upsert degrade (audit finding #2)', () => {
  it('pushes a tombstone when a queued delete was followed by an upsert of a vanished row', async () => {
    // Arrange: syncRows meta for [chats, K] (rev 3); outbox rows
    // [delete K (seq 1), upsert K (seq 2)]; the local chats row does NOT exist.
    // Act: drainOutbox() against a stub server.
    // Assert: the push body contains exactly one DELETE record for K's blindId
    // with baseRev 3; on the stub's ok ack both seqs are cleared and
    // deadKeys contains ['chats', K].
  });

  it('still drops a pure upsert of a vanished row (no queued delete)', async () => {
    // meta exists, outbox [upsert K], row missing → nothing pushed, seq dropped.
  });

  it('still drops a delete the server never knew (L-4)', async () => {
    // NO meta, outbox [delete K] → nothing pushed, seq dropped.
  });

  it('coalesce map keys cannot merge across collections (separator rider)', async () => {
    // Two rows: ['chats', 'aX'] and ['chatsa', ...]-style adversarial pair is
    // impossible with real collections; instead pin the format directly:
    // coalesce() groups ['chats','k1'] and ['chats','k2'] separately and the
    // internal map id equals 'chats:k1' (export a test seam or assert
    // behaviourally via two same-prefix keys).
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/sync/coalesce-degrade.test.ts`
Expected: FAIL — nothing is pushed in the first case.

- [ ] **Step 3: Implement**

```ts
// OutboxGroup gains:
interface OutboxGroup {
  collection: SyncCollection;
  key: string;
  op: 'upsert' | 'delete';
  seqs: number[];
  /** True when ANY delete op joined this group (audit #2): a later background
   *  upsert must never silently cancel a queued deletion. */
  hasDelete: boolean;
}

// coalesce(): use the keyId() separator and track hasDelete.
const id = keyId(row.collection, row.key);
const existing = groups.get(id);
if (existing) {
  existing.seqs.push(row.seq);
  existing.op = row.op;
  existing.hasDelete = existing.hasDelete || row.op === 'delete';
} else {
  groups.set(id, {
    collection: row.collection,
    key: row.key,
    op: row.op,
    seqs: [row.seq],
    hasDelete: row.op === 'delete',
  });
}

// Drain missing-row branch:
const row = await readLocalRow(group.collection, group.key);
if (row === undefined || row === null) {
  if (group.hasDelete) {
    // Audit #2: the row is gone AND a delete was queued — the truthful push is
    // the tombstone (a background job's no-op upsert of the deleted key raced
    // in behind it; last-op-wins must not eat the deletion).
    const entry: CoalescedEntry = { ...group, op: 'delete', row: undefined, baseRev };
    prepared.push(await prepareRecord(crypto, mk, entry));
    continue;
  }
  // No queued delete: an upsert of a vanished row has nothing truthful to
  // seal — minting a tombstone HERE would delete server data on a local
  // anomaly (wrong polarity). Drop, as before.
  seqsToDrop.push(...group.seqs);
  continue;
}
```

Mind the ordering: the missing-row branch runs AFTER the existing
`group.op === 'delete'` branch, so `hasDelete` only changes behaviour for
groups whose final op was an upsert. The `!meta` L-4 guard above it is
unchanged and still wins (no meta → drop, even with `hasDelete`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/sync/`
Expected: PASS, incl. the existing `worker.test.ts` coalesce matrix.

- [ ] **Step 5: Commit + gate + PR**

```bash
git add apps/user-client/src/sync/worker.ts apps/user-client/tests/sync/coalesce-degrade.test.ts
git commit -m "Degrade a coalesced delete+upsert of a vanished row to a tombstone push

Audit finding #2 (HIGH): last-op-wins let a background upsert (title
generator, memory pipeline) silently cancel a queued deletion when the
local row was already gone — the server kept the record forever and a
later recovery resurrected it locally. Also: coalesce map key gains the
':' separator, closing the latent cross-collection merge hazard.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

Gate (typecheck --force, full vitest, biome), then PR 3 ("Sync audit fixes 3/5: coalescer tombstone degrade") based on PR 2's branch.

---

## PR 4 — Restore blob byte-safety (finding #6) — parallel lane β

### Task 8: `restoreCard` re-establishes the blob channel

**Files:**
- Modify: `apps/user-client/src/trash/trash-repo.ts` (`restoreCard`, lines ~180-264)
- Modify: `apps/user-client/src/sync/blob-transform.ts` (export the per-collection blob-field accessor — it exists internally for `readBlobBytesById`/`stripBlobsForSeal`; export, do not duplicate)
- Test: `apps/user-client/tests/trash/restore-blobs.test.ts` (create)

**Interfaces:**
- Produces: exported `blobFieldsOf(collection: SyncCollection): readonly string[]` (or the existing internal map's real name) from `blob-transform.ts`.
- Consumes: the outbox blob-op row shape (`op: 'blob-put' | 'blob-delete'`, `blobId`, `collection`, `key`) — mirror how `data/chats.ts` enqueues `blobOps` today (look at its `mutateSynced` call's `blobOps` callback for the canonical enqueue shape; reuse any existing helper such as the one `blob-transform`/`enqueue` exposes rather than hand-rolling the row literal).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/trash/restore-blobs.test.ts
describe('restore re-establishes the blob channel (audit finding #6)', () => {
  it('enqueues a blob-put under the PRESERVED blobId for a byte-bearing restored ref', async () => {
    // Arrange: a linked engine; soft-delete a chat whose artefact row carries
    // { blobRef: { blobId: X, bytes: N }, blob: <bytes> }; let the delete drain
    // fully (tombstone acked, blob-delete X executed, dead keys written).
    // Act: restoreCard(cardKey).
    // Assert: syncOutbox contains a blob-put with blobId X for the artefact's
    // NEW key; the restored row still carries blobId X (mint-once preserved).
  });

  it('cancels a pending blob-delete for a revived ref (restore before drain)', async () => {
    // Arrange: soft-delete the same chat but do NOT drain (blob-delete X still
    // queued). Act: restoreCard(cardKey).
    // Assert: no blob-delete row for X remains in syncOutbox; a blob-put for X
    // is NOT required in this variant IF the original put already acked —
    // assert specifically: zero blob-delete rows naming X.
  });

  it('enqueues nothing for a ref without local bytes (lazy original never fetched)', async () => {
    // A snapshot whose row has blobRef but empty/absent bytes → no blob-put.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/trash/restore-blobs.test.ts`
Expected: FAIL — no blob-put enqueued; the blob-delete survives.

- [ ] **Step 3: Implement**

Inside `restoreCard`'s existing transaction (the `RESTORE_SCOPE` must already
include `syncOutbox` — it does, `enqueueSync` runs there; verify and extend the
scope constant if the blob tables are missing):

```ts
// After the clone's puts + enqueueSync(upsert), per member:
if (linked) {
  for (const field of blobFieldsOf(m.collection as SyncCollection)) {
    const ref = (clone as Record<string, unknown>)[field];
    if (!isBlobRef(ref)) continue;
    // Audit #6a: cancel any queued blob-delete that raced this restore — the
    // revived reference is authoritative, the delete must lose.
    const pendingDeletes = await tx
      .table('syncOutbox')
      .filter((r) => r.op === 'blob-delete' && r.blobId === ref.blobId)
      .primaryKeys();
    if (pendingDeletes.length > 0) await tx.table('syncOutbox').bulkDelete(pendingDeletes);
    // Audit #6b: the server object may already be gone (delete drained before
    // the restore). Re-establish it with an idempotent repair PUT under the
    // PRESERVED id — the deterministic SIV re-seal makes a duplicate PUT a
    // byte-identical 200 on the server, so enqueueing unconditionally is safe.
    // Only when this device actually holds bytes to seal:
    if (rowHoldsBlobBytes(clone, field)) {
      enqueueBlobPut(tx, m.collection as SyncCollection, newId, ref.blobId);
    }
  }
}
```

Use the REAL helper names: `isBlobRef` exists in `recovery.ts` (move it to a
shared location or re-declare locally per the codebase's preference);
`rowHoldsBlobBytes`/`enqueueBlobPut` — check `blob-transform.ts` and
`enqueue.ts` for the existing bytes-presence predicate and the blob-op enqueue
used by the write-site sweeps, and call those. If no enqueue helper exists
(write sites inline the row literal via `blobOps` callbacks), add
`enqueueBlobPut(tx, collection, key, blobId)` beside `enqueueSync` in
`enqueue.ts` and use it here.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/trash/`
Expected: PASS incl. the existing restore/scenario suites.

- [ ] **Step 5: Commit**

```bash
git add -A apps/user-client/src apps/user-client/tests/trash
git commit -m "Re-establish the blob channel when restoring from the trashcan

Audit finding #6 (HIGH): restoreCard revived blobRefs without re-uploading
held bytes or cancelling pending blob-deletes — after delete→drain→restore
the record pointed at a destroyed server object forever (irreversible byte
loss once the restoring device is gone).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

### Task 9: Reference-aware phase-3 blob-delete gate

**Files:**
- Modify: `apps/user-client/src/sync/worker.ts` (the phase-3 blob-delete loop, lines ~446-462)
- Test: `apps/user-client/tests/sync/blob-delete-gate.test.ts` (create)

**Interfaces:**
- Consumes: `blobFieldsOf` from Task 8.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/sync/blob-delete-gate.test.ts
describe('phase-3 blob-delete reference re-check (audit finding #6, gate half)', () => {
  it('drops a queued blob-delete whose id a live row still references', async () => {
    // Arrange: a queued blob-delete for X under the DEAD old key; a live
    // artefact row (different key) whose blobRef.blobId === X (the restore).
    // Act: drainOutbox().
    // Assert: the transport's deleteBlob is NEVER called for X; the outbox
    // entry is dropped (not retried).
  });

  it('still executes an unreferenced blob-delete', async () => {
    // No live row references X → deleteBlob called, seq cleared on success.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/sync/blob-delete-gate.test.ts`
Expected: FAIL — deleteBlob fires for the referenced id.

- [ ] **Step 3: Implement**

In the phase-3 loop, before executing each delete:

```ts
// Audit #6: the ok-ack gate only sees THIS key; a restore revives the id under
// a NEW key. Re-check actual references before destroying the server object —
// a referenced id is authoritatively alive and the delete must drop. Blob
// deletes are rare, so a filtered table scan of the owning collection is fine.
if (del.blobId && (await blobIdIsReferenced(del.collection, del.blobId))) {
  if (del.seq !== undefined) seqsToDrop.push(del.seq);
  continue;
}
```

```ts
/** True when any live row of the collection references the blobId. */
async function blobIdIsReferenced(
  collection: SyncCollection,
  blobId: string,
): Promise<boolean> {
  const db = getClientDataDb();
  const fields = blobFieldsOf(collection);
  if (fields.length === 0) return false;
  const hit = await db
    .table(collection)
    .filter((row) =>
      fields.some((f) => {
        const ref = (row as Record<string, unknown>)[f];
        return isBlobRef(ref) && ref.blobId === blobId;
      }),
    )
    .first();
  return hit !== undefined;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/sync/`
Expected: PASS incl. `blob-drain.test.ts` (the M-2 deferred-delete matrix must be untouched).

- [ ] **Step 5: Commit + gate + PR**

```bash
git add apps/user-client/src/sync/worker.ts apps/user-client/tests/sync/blob-delete-gate.test.ts
git commit -m "Re-check live references before executing a queued blob-delete

Audit finding #6 (gate half): the ok-ack gate could not see a restore
reviving the blobId under a new key, so a deferred delete destroyed a
server object the restored record still references.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

Gate, then PR 4 ("Sync audit fixes 4/5: restore blob byte-safety"). If PR 3 already merged, rebase this branch onto the updated `full-backend-transition` first and re-run the gate (the `worker.ts` co-touch: PR 3 edits `coalesce`/missing-row, this PR edits phase 3 — textual conflicts are possible, semantic ones are not).

---

## PR 5 — Relink generation guard (finding #8)

### Task 10: `linkGeneration` + generation-guarded acks

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (`SyncStateRow.linkGeneration?: number` — type only)
- Modify: `apps/user-client/src/sync/watermark.ts` (`defaultState` gains `linkGeneration: 0`; export `getLinkGeneration(): Promise<number>`)
- Modify: `apps/user-client/src/sync/link-reset.ts` (both resets increment it; `resetEngineStateForNewLink` acquires the sync Web Lock)
- Modify: `apps/user-client/src/sync/worker.ts` (capture at `drainOutbox`/`runPullLoop` start; guard `applyOk`, `applyTombstoned`, `applyConflict`'s meta writes, and `advanceWatermark` calls)
- Test: `apps/user-client/tests/sync/link-generation.test.ts` (create)

**Interfaces:**
- Produces: `getLinkGeneration()` in `watermark.ts`; a module-internal `generationStillCurrent(captured: number): Promise<boolean>` in `worker.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/link-generation.test.ts
describe('relink generation guard (audit finding #8)', () => {
  it('increments linkGeneration on every engine reset', async () => {
    // resetEngineStateForNewLink() then resetEngineStateForLocalOnly() →
    // linkGeneration goes 0 → 1 → 2.
  });

  it('discards a stale drain ack after a relink (no syncRows re-insert)', async () => {
    // Arrange: an outbox upsert; start drainOutbox against a stub server whose
    // push response is DELAYED (a controllable promise). While it is in
    // flight, run resetEngineStateForNewLink(). Then release the response.
    // Assert: db.syncRows has NO meta for the key (the ack was discarded);
    // backfillPending is still true; the watermark was not advanced by the
    // stale cycle.
  });

  it('a stale pull page cannot advance the fresh watermark', async () => {
    // Same shape on the pull side: delay the pull response across a reset;
    // assert watermarkRev stays 0.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client vitest run tests/sync/link-generation.test.ts`
Expected: FAIL — the stale ack re-inserts syncRows.

- [ ] **Step 3: Implement**

`watermark.ts`:

```ts
// defaultState() gains: linkGeneration: 0,
/** The per-link engine generation (audit #8): bumped by every engine reset so
 *  in-flight drains/pulls from the previous link can be recognised and their
 *  acks discarded. */
export async function getLinkGeneration(): Promise<number> {
  return (await getSyncState()).linkGeneration ?? 0;
}
```

`link-reset.ts` — both reset transactions add
`linkGeneration: (state.linkGeneration ?? 0) + 1` to their update patch (read
the state row inside the transaction), and `resetEngineStateForNewLink` wraps
its body in the sync Web Lock:

```ts
export async function resetEngineStateForNewLink(): Promise<void> {
  // Audit #8: wait for any lock-respecting cycle to finish before resetting, so
  // its acks land against the OLD generation and the guarded writers below
  // discard anything still in flight (the immediate drain bypasses the lock —
  // the generation guard is what covers it).
  await navigator.locks.request('chatsundere-sync', async () => {
    await resetBody(); // the existing body, plus the generation bump
  });
}
```

(Match the actual lock name/helper used by `runSyncCycle` — find it with
`rg -n "locks.request" apps/user-client/src/sync` and reuse the exact constant.
Preserve the jsdom fallback pattern used elsewhere: when `navigator.locks` is
undefined in tests, run the body directly.)

`worker.ts` — capture + guard:

```ts
// At drainOutbox start:            const generation = await getLinkGeneration();
// At runPullLoop start:            const generation = await getLinkGeneration();

/** Audit #8: a write-back from a drain/pull that started before an engine
 *  reset must be discarded — it belongs to the previous account. */
async function generationStillCurrent(captured: number): Promise<boolean> {
  return (await getLinkGeneration()) === captured;
}
```

Thread `generation` into `applyOk`/`applyTombstoned`/`applyConflict` (add a
parameter) and, as the FIRST statement inside each one's transaction, re-read
the state row and bail out without writing when the generation moved. Guard the
pull loop identically: check `generationStillCurrent(generation)` immediately
before `advanceWatermark(nextWatermark)` and before each page's
`applyRecord` batch (a cheap read per page, not per record).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter user-client vitest run tests/sync/`
Expected: PASS.

- [ ] **Step 5: Commit + gate + PR**

```bash
git add -A apps/user-client/src apps/user-client/tests/sync
git commit -m "Discard in-flight sync acks across an engine reset via a link generation

Audit finding #8 (HIGH): a drain still in flight during a relink re-inserted
syncRows metas after the reset, so the backfill skipped those keys as
already-synced — rows silently stranded off the new account forever. The
reset also now waits on the sync Web Lock; the generation guard covers the
lock-bypassing immediate drain.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

Gate, then PR 5 ("Sync audit fixes 5/5: relink generation guard") — its branch
is the local integration of PR 3's and PR 4's tips (Operating rule 4); open the
PR against `full-backend-transition` and note the two parent branches in the body.

---

## Task 11: Final integrated verification (after PR 5, on its branch)

- [ ] `pnpm typecheck --force` → 14/14, 0 cached.
- [ ] `pnpm --filter user-client vitest run` → only the 8-test Node-localStorage baseline fails (a 9th failure that is the known `stream-manager-store` parallel-load flake must pass in isolation: `pnpm --filter user-client vitest run tests/state/stream-manager-store.test.ts`).
- [ ] `pnpm run build` → 9/9.
- [ ] `pnpm biome check apps/user-client` → clean (the pre-existing `index.css` `.blob-marker` quote nit excepted if still present).
- [ ] Confirm every commit landed on its intended branch: `git branch --contains <sha>` per commit.
- [ ] Write a summary comment on PR 5 listing: findings closed per PR, test files added, any deviation from this plan (deviations toward the spec are allowed and must be flagged; deviations from the spec are not).

## Post-run (human integrator — NOT the worker)

1. Liz reviews each PR; **Larissa audits the combined built diff** (mandatory path: `apps/user-client/src/sync/**` + trash) — focus: the two watermark-rewind sites, the suppression meta-write (zero-knowledge unchanged), the generation guard's discard polarity, the restore blob re-PUT (deterministic re-seal only, no re-mint).
2. **Laura pre-squash** on Task 6's "Upload them now" affordance (the one new user-reachable flow).
3. Merge order: PR 1 → 2 → 3, PR 4 (rebase if needed), PR 5.
4. Chris's device verification: spec §8's six two-browser scenarios.
5. STATUS-TRANSITION.md update + follow-ups-index entries for the audit's deferred MEDIUM/LOW findings (spec §7).
