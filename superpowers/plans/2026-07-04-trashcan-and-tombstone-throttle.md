# Tombstone Throttle + Universal Trashcan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the data-losing tombstone panic-pause with a lossless throttle, and build a universal 30-day trashcan (delete → recoverable, restore, purge) for the four user-facing entity families.

**Architecture:** Two phases. Phase 1 is a self-contained pull-loop fix. Phase 2 adds a durable H-1 dead-key anchor, routes local deletes to `db.trash` with grouping metadata, and builds restore (new-identity cascade remap, modelled on the existing `useBranchChat`), purge, cross-device de-dup, and the "Recently deleted" surface.

**Tech Stack:** TypeScript (strict), Bun test runner (backend-style unit tests under `apps/user-client/tests/`), Vitest for React, Dexie (IndexedDB), TanStack Query, React 18 + Vite, Tailwind v4.

**Spec:** `superpowers/specs/2026-07-04-trashcan-and-tombstone-throttle-design.md` (v2, Chris-approved, Laura + Larissa spec-passed).

---

## Operating rules for the overnight worker (READ FIRST)

You are a context-less Claude executing this plan unattended. You do NOT have this
repo's CLAUDE.md, the prior session's memory, or a human to ask. Every rule you
need is in THIS document. These rules are binding and override your defaults.

1. **Branch & isolation.** Work on the branch **`full-backend-transition`** in the
   checkout you are launched in (do NOT create a new worktree; do NOT switch away
   from `full-backend-transition`). **Never switch branches. Never merge. Never
   push. Never touch `master`.** All paths in this plan are repo-relative — resolve
   them against your checkout root. Stop at the final hand-off task and report
   back; the human integrates.

2. **Execution model.** Use `superpowers:subagent-driven-development`: one fresh
   implementer subagent per task, then a task reviewer (spec compliance + code
   quality), fix loops for Critical/Important findings, then the next task.
   Subagents never merge/push/switch branches — say so in every dispatch. Do the
   tasks in order (Task 1 → 15). Phase 1 (Tasks 1-2) is independently shippable;
   do NOT let a Phase-2 problem block Phase-1's commits.

3. **TDD per task, always.** Failing test → run it, confirm it fails for the
   stated reason → minimal implementation → run, confirm pass → commit. Never
   write implementation before its test. Never skip the "confirm it fails" run.

4. **Language: British English in every artefact** — code, comments, identifiers,
   copy, log strings, commit messages, test names. `colour`, `behaviour`,
   `initialise`, `licence` (noun). No US spelling. No German anywhere in the repo.

5. **Quality bar.** TypeScript strict; `noUncheckedIndexedAccess` on; **no `any`**
   without an inline justifying comment; **no non-null `!`** (Biome bans it — use
   explicit guards). Every package-public function gets a one-line JSDoc. Comments
   explain non-obvious *why*, never restate *what*.

6. **Exact gate commands** (copy-paste; monorepo uses pnpm + Turborepo):
   - Frontend tests (this is the `user-client` app): from
     `apps/user-client/` run `pnpm vitest run <test-path>` (e.g.
     `pnpm vitest run tests/sync/apply.test.ts`). A single test:
     `pnpm vitest run <path> -t "<name substring>"`.
   - Typecheck (the CI gate): from the **repo root** run `pnpm typecheck --force`.
     `--force` is mandatory — Turbo caches typecheck and a stale cache hides
     breakage. Expected: `14 successful, 14 total`.
   - Lint/format: from the repo root run `pnpm biome check <space-separated files
     you touched>`. Biome also runs as a pre-commit hook (lefthook); a commit that
     fails Biome is rejected — fix and re-commit.
   - Full build verification (run once at the end, Task 15): from the repo root
     `pnpm run build`. It is stricter than typecheck alone; both must pass.

7. **Known-green test baseline.** The FULL `apps/user-client` Vitest suite has
   **exactly 8 pre-existing failures**, all environmental (Node's experimental
   `localStorage` is unavailable under the test runner): 6 in
   `tests/unit/cockpit-draft.test.ts`, 1 in `tests/unit/chat-page.test.tsx` ("lazy
   mode …"), 1 in `tests/unit/chat-route.test.tsx` ("lazy mode mounts without
   error"). They are DISJOINT from sync/trash. If you see exactly these 8, you are
   green. A 9th failure, or any failure in a `tests/sync/**`, `tests/trash/**`, or
   `tests/boot/**` file, is a real regression you introduced — fix it, do not
   paper over it. Confirm the baseline is pre-existing by checking these files are
   untouched by your diff; do not switch to `master` to check (never switch
   branches).

8. **Security gate (Larissa).** Both phases touch `apps/user-client/src/sync/**`
   (and the H-1 crypto-boundary logic) — this **triggers a security audit**. You
   cannot summon Larissa yourself. So: complete all tasks, run the final
   verification (Task 15), and in your hand-off report flag prominently that a
   Larissa pre-squash audit is OWED on the sync/trash diff before the human
   squashes. Do NOT squash-to-master yourself.

9. **UX gate (Laura).** Tasks 13-14 add a user-facing surface + delete flow →
   a Laura UX audit is owed pre-squash. Same handling: flag it in the report; do
   not self-approve.

10. **Dexie version ownership (critical coordination).** This plan owns Dexie
    version **34**. BEFORE Task 3, confirm the current max in
    `apps/user-client/src/boot/client-data-db.ts` is still `this.version(33)`. If
    it already contains `this.version(34)` (a parallel worktree claimed it), STOP
    Task 3 and report — do NOT guess a different number or edit around it. All
    other tasks must NOT add any `this.version(...)`.

11. **Commits.** One commit per task (the plan's tasks are the feature units).
    Free-form imperative subject, capitalised. Code commits do NOT get `[skip ci]`;
    a doc-only commit (e.g. the STATUS update) does. End every commit message with:
    `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`

12. **End-of-run STATUS update (Task 15's last step).** Prepend a dated entry to
    `STATUS-TRANSITION.md` (repo root — the sprint status file; newest entry on
    top, format: `**Last updated:** 2026-07-05 (overnight) — **HEADLINE.** body…`)
    summarising what shipped, the verification numbers, and the two owed audits
    (Larissa, Laura). Commit it with `[skip ci]`.

13. **Hand-off report (final action).** Report to the human: the commit list on
    the branch (`git log --oneline master..HEAD`), the verification numbers (every
    suite + `pnpm typecheck --force` + `pnpm run build`, with the 8-failure
    baseline noted), the two owed audits, and any task you could not complete with
    the reason. Then STOP. Do not push, merge, or squash.

### Codebase reference anchors (read these before the tasks that cite them)

- **New-identity cascade remap (Task 9 restore):** `apps/user-client/src/data/chats.ts`
  → `useBranchChat` (from ~L284) already copies a chat + messages + pills with
  fresh ids and rewrites pill-id references inside `contentBlocks`. Restore is
  "branch from the trash snapshot" — follow this remap approach.
- **Cascade delete set (Task 7 snapshot completeness):** `apps/user-client/src/data/chats.ts`
  → `deleteChatCascade` and `mutateSynced({ cascade: [...] })` (`enqueue.ts:191-192`).
  The snapshot must capture exactly this set.
- **Toast (Task 14 delete-time signal):** host is `apps/user-client/src/components/Toast.tsx`,
  backed by `apps/user-client/src/state/toast.store.ts` (`toastStore`), mounted in
  `apps/user-client/src/routes/root.tsx`. Push the delete toast (with Undo +
  "Delete permanently") through `toastStore`; follow an existing caller.
- **Account surface + tile (Task 13):** the account matrix is
  `apps/user-client/src/routes/app/account.tsx`; the "Recovery Key" tile is at
  ~L187 (`label="Recovery Key"`, `to="/app/account/biometric"`). Add the "Recently
  deleted" tile adjacent to it, and model `recently-deleted.tsx` on an existing
  account subpage under `apps/user-client/src/routes/app/account/` (read one for
  the layout/styling pattern; opulent, mobile-first 380 px, no sidebar). Register
  its route the same way the existing account sub-routes are registered.

---

## Global Constraints

- British English in every artefact (code, comments, copy, commit messages).
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`; no `any` without an inline justification; no non-null `!` (Biome bans it).
- Gate before every commit: `pnpm typecheck --force` (14/14) AND `pnpm biome check <touched files>` from repo root; run the full touched test dir with Vitest. Turbo caches typecheck — always `--force` on schema/type-touching tasks.
- Security-critical paths (`apps/user-client/src/sync/**`, `packages/crypto/**`) ship with tests from day one; Larissa audits Phase-2 sync changes pre-squash.
- One Dexie version bump for the whole plan: **34** (current tip is 33). Exactly one task owns it (Task 6). No other task adds a `this.version(...)`.
- Commit style: free-form imperative, capitalised subject; `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Code commits do NOT get `[skip ci]`.
- Subagents never merge, push, or switch branches. Work only on the `full-backend-transition` branch (see Operating Rule #1); all paths are repo-relative.
- Run all `pnpm` commands from `apps/user-client/` unless stated; typecheck/biome from repo root.

---

# Phase 1 — Tombstone throttle (the data-loss fix, independently shippable)

### Task 1: Rip out the panic pause

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (remove `TOMBSTONE_PANIC`, `tombstonePaused`, the `{ kind: 'tombstone-paused' }` outcome, the `tombstone_paused` raise; `applyTombstone` always applies)
- Modify: `packages/shared-types/src/sync.ts` (remove `| { kind: 'tombstone_paused'; count: number }` from `SyncAttention`) — NOTE: `SyncAttention` actually lives in `apps/user-client/src/boot/client-data-db.ts:609+`; confirm and edit there.
- Modify: `apps/user-client/src/sync/copy.ts` (remove `attention.tombstonePaused`)
- Modify: `apps/user-client/src/components/SyncStatusLine.tsx` (remove the `case 'tombstone_paused':`)
- Modify: `apps/user-client/src/sync/watermark.ts` (drop the now-dead `tombstone_paused` mention in `settleTombstoneNotice`'s comment; the guard is already `tombstone_threshold`-only)
- Test: `apps/user-client/tests/sync/apply.test.ts` (delete the panic-pause test; the threshold-notice test stays)

**Interfaces:**
- Produces: `ApplyOutcome` no longer includes `{ kind: 'tombstone-paused' }`. `applyTombstone` applies unconditionally (subject only to the existing per-row stale/`rev ≤ meta.rev` and H-1 checks). `TOMBSTONE_THRESHOLD = 20` stays; `TOMBSTONE_PANIC` is gone.

- [ ] **Step 1: Delete the panic-pause test.** In `apply.test.ts`, remove the `it('pauses tombstone application at the panic threshold...')` test. Keep `it('raises the calm notice at the threshold')`.

- [ ] **Step 2: Run the suite to see it green without the deleted test.**
Run (from `apps/user-client/`): `pnpm vitest run tests/sync/apply.test.ts`
Expected: PASS (the threshold-notice test still passes; panic test gone).

- [ ] **Step 3: Remove panic logic from `apply.ts`.** In `applyTombstone` (around L392-405), delete the `if (tombstoneCycleCount >= TOMBSTONE_PANIC) { … tombstonePaused = true }` branch and the `if (tombstonePaused) return { kind: 'tombstone-paused' }` line, keeping only:

```ts
  // §7.3a — count every pulled tombstone; a calm notice above the threshold.
  tombstoneCycleCount += 1;
  if (tombstoneCycleCount >= TOMBSTONE_THRESHOLD) {
    await setAttention({ kind: 'tombstone_threshold', count: tombstoneCycleCount });
  }
```

Delete the `TOMBSTONE_PANIC` const, the `let tombstonePaused = false;` module var, the `tombstonePaused = false;` resets in `resetTombstoneCounter` and `_resetApplyForTests`, and the `| { kind: 'tombstone-paused' }` arm of `ApplyOutcome`.

- [ ] **Step 4: Remove the `tombstone_paused` attention kind** from the `SyncAttention` union (`client-data-db.ts` — grep `tombstone_paused` to find it), from `copy.ts` (`tombstonePaused: (count) => …`), and the `case 'tombstone_paused':` in `SyncStatusLine.tsx`. In `watermark.ts` `settleTombstoneNotice`, simplify the doc comment to drop the paused-alarm reference (code already only clears `tombstone_threshold`).

- [ ] **Step 5: Gate.**
Run (repo root): `pnpm typecheck --force`
Expected: 14/14 (no dangling `tombstone_paused`/`tombstone-paused` references).
Run (repo root): `pnpm biome check apps/user-client/src/sync/apply.ts apps/user-client/src/sync/copy.ts apps/user-client/src/sync/watermark.ts apps/user-client/src/components/SyncStatusLine.tsx apps/user-client/src/boot/client-data-db.ts`
Expected: clean.
Run (from `apps/user-client/`): `pnpm vitest run tests/sync`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add -A
git commit -m "Remove the tombstone panic pause ahead of the throttle

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Throttle the pull loop (cap + monotone-safe watermark hold)

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (rename `TOMBSTONE_THRESHOLD` stays; export a `TOMBSTONE_CYCLE_CAP = 200` const; the loop reads it)
- Modify: `apps/user-client/src/sync/worker.ts` (`runPullLoop` around L879-937)
- Test: `apps/user-client/tests/sync/apply.test.ts` (throttle tests via `runPullLoop`, mirroring the existing `_setPullTransport` pattern)

**Interfaces:**
- Consumes: `TOMBSTONE_CYCLE_CAP` from `apply.ts`.
- Produces: `runPullLoop` applies ≤ `TOMBSTONE_CYCLE_CAP` tombstones per cycle, holds the watermark at `min(lowestDeferredRev) − 1` when it defers, breaks the page loop at the cap, and ignores `rev ≤ sinceRev` records. `applyRecord`'s return still carries `record.deleted` info via `ApplyOutcome`; the loop distinguishes tombstones by the pulled record's own `deleted` flag.

- [ ] **Step 1: Write the failing throttle tests.** Append to `apply.test.ts` (`pulledTombstone`/`_setPullTransport`/`getSyncState` helpers already exist):

```ts
describe('runPullLoop — §2.2 tombstone throttle (lossless)', () => {
  it('applies at most the cap per cycle and drains the rest next cycle', async () => {
    // 250 tombstones on one page, revs 1..250. Cap is 200.
    const recs = Array.from({ length: 250 }, (_v, i) => pulledTombstone('chats', `d${i}`, i + 1));
    let call = 0;
    _setPullTransport(async (since: number): Promise<SyncPullResponse> => {
      call += 1;
      // Return only records with rev > since, mimicking the server.
      const page = recs.filter((r) => r.rev > since).slice(0, 200);
      return { head: 250, epoch: 'E1', more: page.length > 0, records: page };
    });

    await runPullLoop();
    // Cap 200 applied; watermark held at lowestDeferredRev(201) - 1 = 200.
    expect((await getSyncState()).watermarkRev).toBe(200);

    await runPullLoop();
    // Remaining 50 applied; watermark reaches head 250.
    expect((await getSyncState()).watermarkRev).toBe(250);
  });

  it('normalises adversarial ordering by sorting, so no record stalls or is skipped', async () => {
    // A page whose LAST record has the LOWEST rev (adversarial). Without the
    // client-side sort, the cap-worth of high-rev records would consume the cap
    // first and the low-rev record would defer every cycle forever (progress
    // stall). Sorting ascending applies the low rev first → drains cleanly.
    const many = Array.from({ length: 200 }, (_v, i) => pulledTombstone('chats', `h${i}`, i + 10));
    const low = pulledTombstone('chats', 'low', 5); // rev 5, listed LAST
    let call = 0;
    _setPullTransport(async (since: number): Promise<SyncPullResponse> => {
      call += 1;
      const all = [...many, low].filter((r) => r.rev > since);
      if (all.length === 0) return { head: 209, epoch: 'E1', more: false, records: [] };
      return { head: 209, epoch: 'E1', more: true, records: all };
    });
    await runPullLoop(); // sorts → applies rev 5 + revs 10..208 (200 under cap), defers rev 209
    expect((await getSyncState()).watermarkRev).toBe(208); // held at lowestDeferredRev(209) - 1
    await runPullLoop(); // drains rev 209
    expect((await getSyncState()).watermarkRev).toBe(209);
  });

  it('ignores records with rev <= since', async () => {
    await advanceWatermark(100);
    _setPullTransport(async (): Promise<SyncPullResponse> => ({
      head: 100, epoch: 'E1', more: false,
      records: [pulledTombstone('chats', 'stale', 50)], // rev 50 <= watermark 100
    }));
    await runPullLoop();
    expect((await getSyncState()).watermarkRev).toBe(100); // unchanged, record ignored
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `pnpm vitest run tests/sync/apply.test.ts -t "throttle"`
Expected: FAIL (current loop applies all and over-advances the watermark).

- [ ] **Step 3: Add the cap const.** In `apply.ts`, next to `TOMBSTONE_THRESHOLD`:
```ts
/** §2.2 — max pulled tombstones APPLIED per cycle; the rest defer to the next cycle (lossless). */
export const TOMBSTONE_CYCLE_CAP = 200;
```

- [ ] **Step 4: Rewrite the `runPullLoop` page loop.** The tombstone cap is
  **per-cycle** (across pages), so `applied` is declared BEFORE the `while` loop;
  everything else stays per-page. Declare above the `while (more && pages < …)`:

```ts
  let applied = 0; // tombstones APPLIED this cycle, across pages — the cap is per-cycle
```

Then replace the per-page apply block (the `for (const record of response.records)`
… `advanceWatermark(Math.max(...))` region, ~L910-928) with:

```ts
      // Normalise ordering client-side (M-7: never trust the server's order).
      // Ascending rev means deferred tombstones are always the high-rev tail, so
      // the watermark advances through the applied prefix and progress is
      // guaranteed even against an adversarial page (no stall, no re-apply waste).
      const ordered = [...response.records].sort((a, b) => a.rev - b.rev);
      let lowestDeferredRev: number | null = null; // per PAGE
      let highestApplied = watermarkRev;            // per PAGE, seeded from this page's since
      let cappedThisCycle = false;                  // per PAGE (drives this page's `more`)
      for (const record of ordered) {
        if (record.rev <= watermarkRev) continue; // L-B: honest servers never send these
        if (record.deleted && applied >= TOMBSTONE_CYCLE_CAP) {
          lowestDeferredRev =
            lowestDeferredRev === null ? record.rev : Math.min(lowestDeferredRev, record.rev);
          cappedThisCycle = true;
          continue; // defer this tombstone; keep scanning the page for the true minimum
        }
        await applyRecord(record);
        if (record.deleted) applied += 1; // accumulates across pages (cycle-scoped `applied`)
        if (record.rev > highestApplied) highestApplied = record.rev;
      }
      // Watermark: hold below the lowest deferred rev, else advance to highest applied.
      const nextWatermark =
        lowestDeferredRev !== null ? lowestDeferredRev - 1 : highestApplied;
      await advanceWatermark(nextWatermark); // monotone clamp inside
      flushInvalidations();

      // L-A: once the cap trips, stop paging this cycle (the next trigger resumes).
      more = cappedThisCycle ? false : response.more;
```

Note: `watermarkRev` is the value the existing loop reads per page
(`const { watermarkRev } = await getSyncState();`) — keep it; it is the `sinceRev`
for the `rev <= watermarkRev` guard and the deferred-hold base. Because `applied`
is cycle-scoped, a page that fills the cap without deferring (exactly cap records,
no 201st) sets no `cappedThisCycle`; the NEXT page then defers its first tombstone
(`applied` already at cap) and stops — correct per-cycle capping.

- [ ] **Step 5: Run to verify pass.**
Run: `pnpm vitest run tests/sync/apply.test.ts`
Expected: PASS (all throttle tests green; existing watermark/threshold tests still green).

- [ ] **Step 6: Full gate + commit.**
Run (repo root): `pnpm typecheck --force` → 14/14; `pnpm biome check apps/user-client/src/sync/apply.ts apps/user-client/src/sync/worker.ts` → clean.
Run (from `apps/user-client/`): `pnpm vitest run tests/sync` → PASS.
```bash
git add -A
git commit -m "Throttle pulled tombstones per cycle without losing any

Replaces the panic pause: apply at most TOMBSTONE_CYCLE_CAP tombstones
per cycle, hold the watermark at (lowest deferred rev - 1) so deferred
records re-pull next cycle, break the page loop at the cap, and ignore
rev<=since records. M-7-safe under adversarial ordering.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

> **Phase 1 is independently shippable.** Summon Larissa on the Phase-1 diff (watermark M-7 + tombstone handling) before squashing to master, per the audit gate.

---

# Phase 2 — Universal trashcan

## File map (Phase 2)

- `apps/user-client/src/boot/client-data-db.ts` — Dexie v34: `TrashRow` fields, `deadKeys` store, upgrade backfill.
- `apps/user-client/src/sync/dead-keys.ts` *(new)* — durable H-1 anchor read/write.
- `apps/user-client/src/trash/trash-model.ts` *(new)* — entity hierarchy config + metadata derivation.
- `apps/user-client/src/trash/trash-repo.ts` *(new)* — grouped card listing, restore, purge, retire-on-restoredFrom.
- `apps/user-client/src/trash/delete-flow.ts` *(new)* — soft/permanent delete, snapshot, fast Undo.
- `apps/user-client/src/routes/app/recently-deleted.tsx` *(new)* — the surface.
- `apps/user-client/src/sync/apply.ts` — H-1 reads `deadKeys`; `applyTombstone` writes grouping meta + dead-key; `restoredFrom` retire.
- `apps/user-client/src/sync/worker.ts` — write dead-key at delete ack.
- `apps/user-client/src/data/{chats,personas,memory,documents}.ts` + `history.tsx` etc. — route deletes through `delete-flow`.
- `apps/user-client/src/routes/app/account.tsx` — the "Recently deleted" tile.

---

### Task 3: Dexie v34 — TrashRow fields, deadKeys store, backfill

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (add fields to `TrashRow`; add `DeadKeyRow` + `deadKeys` table; `this.version(34)` with a `.stores(...)` for `deadKeys` and an `.upgrade(...)` backfill)
- Modify: every test asserting `expect(db.verno).toBe(33)` → `34` (31 occurrences; grep `verno).toBe`)
- Test: `apps/user-client/tests/boot/client-data-db.*.test.ts` (a new test for the v34 upgrade backfill)

**Interfaces:**
- Produces:
```ts
interface TrashRow {
  id: string; collection: SyncCollection; key: string; row: unknown;
  deletedAt: number; purgeAt: number;
  entityKind: 'persona' | 'chat' | 'memory' | 'library' | 'document' | 'chatChild';
  rootGroup: string;                                   // `persona:<id>` | `library:<id>`
  parentRef: { field: string; id: string } | null;
}
interface DeadKeyRow { id: string; collection: SyncCollection; key: string; diedAt: number; }
// db.deadKeys!: Table<DeadKeyRow, string>;  store: 'id, collection'
```

- [ ] **Step 1: Write the failing upgrade test** in a new `tests/boot/trash-v34-upgrade.test.ts`: open a DB at v33 with a legacy `TrashRow` (a `chats` row whose snapshot has `personaId: 'p1'`), then open at v34 and assert the row now has `entityKind: 'chat'`, `rootGroup: 'persona:p1'`, `parentRef: {field:'personaId', id:'p1'}`, and that `deadKeys` contains `chats:<key>`. (Model the harness on existing `tests/boot/*` DB tests.)

- [ ] **Step 2: Run → FAIL** (`db.deadKeys` undefined). `pnpm vitest run tests/boot/trash-v34-upgrade.test.ts`

- [ ] **Step 3: Add the interfaces + table field** (`DeadKeyRow`, extend `TrashRow`, `deadKeys!: Table<DeadKeyRow, string>;`).

- [ ] **Step 4: Add version 34** after the `this.version(33)` block:
```ts
    this.version(34)
      .stores({ deadKeys: 'id, collection' })
      .upgrade(async (tx) => {
        const trash = tx.table('trash');
        const dead = tx.table('deadKeys');
        await trash.toCollection().modify((t: any) => {
          const { entityKind, rootGroup, parentRef } = deriveLegacyTrashMeta(t);
          t.entityKind = entityKind; t.rootGroup = rootGroup; t.parentRef = parentRef;
        });
        // Seed dead-key markers from existing trash keys (their death is server-authoritative).
        const rows = await trash.toArray();
        for (const t of rows) {
          await dead.put({ id: `${t.collection}:${t.key}`, collection: t.collection, key: t.key, diedAt: t.deletedAt ?? 0 });
        }
      });
```
Define `deriveLegacyTrashMeta` inline in `client-data-db.ts` (or import from `trash-model.ts` once Task 5 lands — for this task, inline a minimal version keyed off `collection` + the snapshot's `personaId`/`libraryId`/`chatId`; fall back to `entityKind` from collection and `rootGroup = \`${collection}:${key}\`` when no parent ref is present, per spec §3.10 L-C).

- [ ] **Step 5: Sweep the verno assertions.** Update all 31 `expect(db.verno).toBe(33)` → `toBe(34)`. Grep to confirm none remain at 33: `rg -n 'verno\).toBe\(33\)' apps/user-client/tests` → no results.

- [ ] **Step 6: Run → PASS**, then gate (`pnpm typecheck --force`, biome on `client-data-db.ts`), commit `"Add Dexie v34: trash grouping metadata and the durable deadKeys store"`.

---

### Task 4: Dead-key module + H-1 reads it

**Files:**
- Create: `apps/user-client/src/sync/dead-keys.ts`
- Modify: `apps/user-client/src/sync/apply.ts` (`applyUpsert` H-1 branch, ~L560-567, reads `isDeadKey` instead of `db.trash.get`)
- Test: `apps/user-client/tests/sync/dead-keys.test.ts`

**Interfaces:**
- Produces:
```ts
// dead-keys.ts
export async function markDead(collection: SyncCollection, key: string): Promise<void>;
export async function isDeadKey(collection: SyncCollection, key: string): Promise<boolean>;
```

- [ ] **Step 1: Failing test** — `markDead('chats','c1')` then `isDeadKey('chats','c1') === true`; unmarked key `=== false`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `dead-keys.ts`:**
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { getClientDataDb } from '../boot/client-data-db.js';

/** §3.9 — record a key's server-authoritative death; the permanent H-1 anchor. */
export async function markDead(collection: SyncCollection, key: string): Promise<void> {
  await getClientDataDb().deadKeys.put({
    id: `${collection}:${key}`, collection, key, diedAt: Date.now(),
  });
}

/** §3.9 — whether this key is a tombstoned identity that must never be re-inserted. */
export async function isDeadKey(collection: SyncCollection, key: string): Promise<boolean> {
  return (await getClientDataDb().deadKeys.get(`${collection}:${key}`)) !== undefined;
}
```
- [ ] **Step 4: Point H-1 at it.** In `apply.ts` `applyUpsert`, replace the `const trashRow = await db.trash.get(...); if (trashRow) { … tamper }` with `if (await isDeadKey(collection, key)) { await setAttention({ kind: 'tamper' }); return { kind: 'tamper' }; }`. Keep the L-3 pending-delete guard after it.
- [ ] **Step 5: Update the H-1 test** in `apply.test.ts` to seed `markDead(...)` instead of a trash row, and add a test that H-1 still fires **after** the trash row is gone (the durability win). Run → PASS.
- [ ] **Step 6: Gate + commit** `"Anchor H-1 on a durable dead-key marker, not the trash snapshot"`.

---

### Task 5: Write the dead-key marker at server-authoritative death

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (`applyTombstone` — after routing to trash, `await markDead(collection, key)`)
- Modify: `apps/user-client/src/sync/worker.ts` (`applyOk` for a `delete` op, and `applyTombstoned` — `await markDead(prep.collection, prep.key)`)
- Test: extend `apply.test.ts` / `worker.test.ts`

**Interfaces:** consumes `markDead` (Task 4). No new exports.

- [ ] **Step 1: Failing tests** — a pulled tombstone marks the key dead; a drained local `delete` (`applyOk` with `prep.op === 'delete'`) marks it dead; a `tombstoned` ack marks it dead.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add `await markDead(...)`** at the three ack points (pulled tombstone applied, delete ack, tombstoned ack). NOT at local-enqueue time (spec §3.9 — this is what lets fast-Undo stay identity-preserving).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Gate + commit** `"Mark keys dead at ack, so fast-Undo before drain keeps identity"`.

---

### Task 6: Trash model — hierarchy config + metadata derivation

**Files:**
- Create: `apps/user-client/src/trash/trash-model.ts`
- Test: `apps/user-client/tests/trash/trash-model.test.ts`

**Interfaces:**
- Produces:
```ts
export type TrashEntityKind = 'persona' | 'chat' | 'memory' | 'library' | 'document' | 'chatChild';
export interface TrashMeta { entityKind: TrashEntityKind; rootGroup: string; parentRef: { field: string; id: string } | null; }
/** Derive grouping metadata from a collection + its live row snapshot. */
export function deriveTrashMeta(collection: SyncCollection, key: string, row: unknown): TrashMeta;
/** The cascade descendant collections+keys for a root delete (mirrors mutateSynced cascade). */
export const TRASH_HIERARCHY: { /* parent collection -> child collections + fk field */ };
```

- [ ] **Step 1: Failing test** for `deriveTrashMeta`: a `chats` row `{id:'c1', personaId:'p1'}` → `{entityKind:'chat', rootGroup:'persona:p1', parentRef:{field:'personaId', id:'p1'}}`; a `personas` row `{id:'p1'}` → `{entityKind:'persona', rootGroup:'persona:p1', parentRef:null}`; a `documents` row `{id:'d1', libraryId:'l1'}` → `{entityKind:'document', rootGroup:'library:l1', parentRef:{field:'libraryId', id:'l1'}}`; a `messages` row `{id:'m1', chatId:'c1'}` → `{entityKind:'chatChild', rootGroup: (its chat's rootGroup — resolve via the chat's persona; if the chat is itself trashed, rootGroup is that persona), parentRef:{field:'chatId', id:'c1'}}`.
  - NOTE: a `chatChild`'s `rootGroup` must resolve to the **persona** group so it folds under the persona card. Since a message row only knows its `chatId`, `deriveTrashMeta` needs the chat's `personaId`. Pass an optional resolver: `deriveTrashMeta(collection, key, row, resolvePersonaForChat?)`. Document this in the interface.
- [ ] **Step 2–4:** implement `TRASH_HIERARCHY` (persona → {chats via personaId, memoryJournal/memoryBody via personaId}; chat → {messages, pills, compactionCheckpoints via chatId}; library → {documents via libraryId}) and `deriveTrashMeta`; make tests pass.
- [ ] **Step 5: Gate + commit** `"Add the trash hierarchy model and metadata derivation"`.

---

### Task 7: Route local deletes to trash with grouping (delete-flow, soft + permanent)

**Files:**
- Create: `apps/user-client/src/trash/delete-flow.ts`
- Modify: `apps/user-client/src/sync/enqueue.ts` (if the snapshot needs a shared cascade-collect helper; otherwise reuse `deleteChatCascade`'s pattern)
- Test: `apps/user-client/tests/trash/delete-flow.test.ts`

**Interfaces:**
- Produces:
```ts
export interface TrashUndoHandle { kind: 'in-place'; restore(): Promise<void>; } // Task 9 extends
export async function softDelete(collection: SyncCollection, key: string): Promise<TrashUndoHandle>;
export async function permanentDelete(collection: SyncCollection, key: string): Promise<void>;
```
- Consumes: `deriveTrashMeta`, `TRASH_HIERARCHY` (Task 6); `mutateSynced`/cascade (`enqueue.ts`).

- [ ] **Step 1: Failing test** — `softDelete('chats','c1')` (seed a chat + 2 messages) snapshots chat + both messages into `db.trash` with correct `entityKind`/`rootGroup`/`parentRef`, removes them from live tables, and leaves outbox `delete` entries for all three (cascade). `deadKeys` is NOT yet written (ack-time). `permanentDelete` removes live rows + enqueues deletes, writes NO trash snapshot.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `delete-flow.ts`.** `softDelete`: in one Dexie transaction, collect the cascade set via `TRASH_HIERARCHY` (the exact set `mutateSynced` will delete — spec I-2), snapshot each into `db.trash` with `deriveTrashMeta`, remove from live tables, and call the existing synced-delete path (`mutateSynced` with the cascade) so the outbox entries + propagation are identical to today. `permanentDelete`: same minus the snapshot. Neither writes `deadKeys` (that lands at ack, Task 5).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Gate + commit** `"Route soft-deletes to the trashcan; add permanent-delete"`.

---

### Task 8: Fast Undo (identity-preserving before drain)

**Files:**
- Modify: `apps/user-client/src/trash/delete-flow.ts` (`softDelete` returns a working `TrashUndoHandle`)
- Test: extend `delete-flow.test.ts`

**Interfaces:** `TrashUndoHandle.restore()` — if the delete's outbox entries are all still queued (undrained), cancel them, re-insert the snapshot rows with their ORIGINAL ids, delete the trash entries, in one transaction. No dead-key was written, so nothing to unwind there.

- [ ] **Step 1: Failing test** — after `softDelete('chats','c1')`, `handle.restore()` re-creates `c1` (same id) + its messages, removes the outbox delete entries, empties the trash entries. Assert `db.chats.get('c1')` exists with the original id and the outbox is empty.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement in-place restore** — capture the covered outbox seqs at `softDelete` time; `restore()` verifies they are still present (undrained), deletes them, re-inserts the snapshots at original ids, clears the trash rows. If any covered seq is already gone (partially drained), throw a sentinel so the caller falls back to Task 10's new-id restore (wire the fallback in Task 14).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Gate + commit** `"Add identity-preserving fast Undo for undrained deletes"`.

---

### Task 9: Restore (new-identity cascade remap) + restoredFrom

**Files:**
- Create/extend: `apps/user-client/src/trash/trash-repo.ts` (`restoreCard`)
- Test: `apps/user-client/tests/trash/restore.test.ts`

**Interfaces:**
- Produces: `export async function restoreCard(rootGroup: string): Promise<void>;`
- Pattern reference: `useBranchChat` in `apps/user-client/src/data/chats.ts:284+` already does new-id cascade-copy with pill-reference rewriting — restore is "branch from trash". Follow its remap approach.

- [ ] **Step 1: Failing test** — seed a trashed persona group (persona p1 + chat c1 [personaId p1] + message m1 [chatId c1] + memory mem1 [personaId p1], all in `db.trash`, `deadKeys` holding all four). `restoreCard('persona:p1')` → new ids for all four; the restored chat's `personaId` = the new persona id; the restored message's `chatId` = the new chat id; each restored row's sealed payload carries `restoredFrom` = its original key; fresh outbox `upsert` entries for all; the trash rows gone; `deadKeys` for the OLD ids still present; the new ids are NOT in `deadKeys`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `restoreCard`** in one Dexie rw transaction over `db.trash`, the affected live tables, and `syncOutbox` (spec I-4): collect the subtree from `db.trash` by `rootGroup`; mint new ids (build `oldId→newId`); rewrite each row's id + `parentRef` field (to the new parent id if in-set, else the existing live parent id) + cross-tree refs (message `kbRef`) per §3.5; attach `restoredFrom: <originalKey>` to each row (it rides inside the entity payload → sealed by the normal enqueue path); write live rows; enqueue synced upserts (`mutateSynced`/`enqueueSync` upsert per row); delete the trash entries; leave `deadKeys` intact.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Gate + commit** `"Restore trashcan entries as a new-identity cascade with remap"`.

---

### Task 10: Cross-device de-dup — retire a trash card on a matching restoredFrom

**Files:**
- Modify: `apps/user-client/src/sync/apply.ts` (`applyUpsert`, after a successful insert/resolve, check the decrypted row's `restoredFrom`)
- Modify: `apps/user-client/src/trash/trash-repo.ts` (`retireTrashByOriginalKey`)
- Test: extend `apply.test.ts`

**Interfaces:** `export async function retireTrashByOriginalKey(collection: SyncCollection, key: string): Promise<void>;` — deletes the `db.trash` entry `collection:key` (and its folded children? No — only the exact keyed entry; each restored descendant carries its own `restoredFrom`, so peers retire each as they pull).

- [ ] **Step 1: Failing test** — device holds `trash['chats:c1']`; a pulled upsert whose decrypted row has `restoredFrom: 'c1'` (collection `chats`) → after apply, `trash['chats:c1']` is gone; a pulled upsert with no `restoredFrom` leaves trash untouched.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in `applyUpsert`, after the row lands, if `row.restoredFrom` is a string, `await retireTrashByOriginalKey(collection, row.restoredFrom)`. Guard: only for the four trashable collections.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Gate + commit** `"Retire a peer's trash card when its restore is pulled"`.

---

### Task 11: Purge (cascade, local-only, leaves outbox + deadKeys)

**Files:**
- Modify: `apps/user-client/src/trash/trash-repo.ts` (`purgeCard`)
- Test: extend `restore.test.ts` or a new `purge.test.ts`

**Interfaces:** `export async function purgeCard(rootGroup: string): Promise<void>;`

- [ ] **Step 1: Failing test** — seed a trashed persona group + a queued outbox delete for one of its keys + `deadKeys` for all. `purgeCard('persona:p1')` removes all the group's `db.trash` rows; leaves `syncOutbox` untouched (spec I-3); leaves `deadKeys` intact (spec §3.9).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — delete every `db.trash` row whose `rootGroup` matches (one query), touching neither `syncOutbox` nor `deadKeys`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Gate + commit** `"Purge a trash card and its cascade, local-only"`.

---

### Task 12: Card listing (grouped)

**Files:**
- Modify: `apps/user-client/src/trash/trash-repo.ts` (`listTrashCards`)
- Test: extend the repo test

**Interfaces:**
```ts
export interface TrashCard { rootGroup: string; entityKind: TrashEntityKind; title: string; counts: { chats?: number; memories?: number; documents?: number; items: number }; deletedAt: number; }
export async function listTrashCards(): Promise<TrashCard[]>;
```

- [ ] **Step 1: Failing test** — a trashed persona with 2 chats (3 messages each) + 1 memory yields ONE card `{entityKind:'persona', counts:{chats:2, memories:1, items:9}}`; a trashed chat whose persona is LIVE yields its own card.
- [ ] **Step 2–4:** group `db.trash` rows by `rootGroup`; a group whose root entity is present is one card; a child whose parent is not in trash is its own card; derive counts + title (title from the root row's snapshot, e.g. persona name / chat title). Make tests pass.
- [ ] **Step 5: Gate + commit** `"List trashcan contents as grouped restore-unit cards"`.

---

### Task 13: The "Recently deleted" surface + account tile

**Files:**
- Create: `apps/user-client/src/routes/app/recently-deleted.tsx`
- Modify: `apps/user-client/src/routes/app/account.tsx` (add the tile next to "Recovery Key", ~L176 matrix) + the route registration (grep how account sub-routes are registered)
- Test: `apps/user-client/tests/routes/recently-deleted.test.tsx` (Vitest + Testing Library, mirror an existing route test)

**Interfaces:** consumes `listTrashCards`, `restoreCard`, `purgeCard`.

- [ ] **Step 1: Failing test** — the surface renders one card per `listTrashCards` entry with a Restore and a Delete-now button; empty state renders the calm copy; the Delete-now button opens a confirm naming the cascade counts. (Mock `listTrashCards`.)
- [ ] **Step 2–4:** build the surface following the existing account-subpage pattern (opulent styling, mobile-first 380 px, no sidebar). Card copy: "Fable · 3 chats · 12 memories · deleted 2 days ago". Restore → `restoreCard` + "Restored." toast. Delete-now → confirm ("Permanently delete this persona and its 3 chats and 12 memories? This cannot be undone.") → `purgeCard`. Empty: "Nothing here — deleted items rest here for 30 days before they're gone." Add the account tile "Recently deleted" / meta "restore or purge · 30 days" adjacent to Recovery Key.
- [ ] **Step 5: Gate + commit** `"Add the Recently deleted surface and its account tile"`.

---

### Task 14: Wire delete sites through delete-flow + the delete-time toast

**Files:**
- Modify: `apps/user-client/src/data/chats.ts` (`deleteChatCascade`/`useDeleteChat`), `personas.ts`, `memory/repo.ts` (memory delete), `documents.ts`/library delete — route through `softDelete` (default) with a `permanentDelete` option.
- Create: a delete-time toast with Undo + "Delete permanently" (reuse the app's existing toast/snackbar surface — grep for the current toast host; spec §3.4).
- Modify: `history.tsx` and the persona/memory/document delete affordances to call the new flow and show the toast.
- Test: Vitest on `useDeleteChat` (asserts soft-delete path + toast), plus a manual-verification note.

**Interfaces:** consumes `softDelete`, `permanentDelete`, `TrashUndoHandle`.

- [ ] **Step 1: Failing test** — `useDeleteChat` mutation calls `softDelete` (not a hard delete), returns a handle, and surfaces the toast copy "Moved to Recently deleted · recoverable for 30 days" with an Undo that calls `handle.restore()`; the toast's "Delete permanently" calls `permanentDelete`. On an already-drained delete, Undo falls back to `restoreCard`.
- [ ] **Step 2–4:** replace each family's hard-delete with `softDelete`; wire the toast (Undo + permanent). Keep `abortDiscard` for chats. Follow the existing toast host.
- [ ] **Step 5: Gate + commit** `"Route deletes through the trashcan with an Undo/permanent toast"`.

---

### Task 15: Integration scenarios + full gate

**Files:**
- Create: `apps/user-client/tests/trash/scenarios.test.ts`
- Test only.

- [ ] **Step 1: Write end-to-end scenarios** (drive the real repo/apply, mirror `tests/sync/scenarios.test.ts`):
  1. delete persona (with a chat+messages+memory) → one card → restore → subtree back with new ids, refs consistent, upserts enqueued.
  2. delete chat, then delete its persona → the chat has no own card (folded) → restore persona brings both back.
  3. > cap tombstones pulled → throttled drain, all land in trash grouped.
  4. restore on "device A" (enqueues restoredFrom upserts) → applying them on "device B" retires B's matching cards.
  5. purge persona → all descendants gone from trash; a subsequent malicious upsert on an old key trips tamper (deadKey durable).
- [ ] **Step 2: Run → iterate to green.**
- [ ] **Step 3: Full gate** — from repo root: `pnpm typecheck --force` (expect 14/14) AND `pnpm run build` (expect success — stricter than typecheck). From `apps/user-client/`: `pnpm vitest run` (full suite; expect ONLY the 8 known Node-localStorage baseline failures per Operating Rule #7, all disjoint from trash/sync). `pnpm biome check` on every touched file (clean).
- [ ] **Step 4: Commit** `"Add trashcan integration scenarios"`.
- [ ] **Step 5: STATUS update (Operating Rule #12).** Prepend a dated entry to `STATUS-TRANSITION.md` (repo root) summarising what shipped across Phases 1-2, the verification numbers, and the two owed audits. Commit `"Update STATUS: tombstone throttle + universal trashcan built [skip ci]"`.
- [ ] **Step 6: Hand-off report (Operating Rule #13).** Report the commit list (`git log --oneline master..HEAD`), all verification numbers with the baseline noted, the two owed audits, and any incomplete task. Then STOP — do not push/merge/squash.

> **Phase 2 audit gate (owed, human-triggered — you cannot summon these):** Larissa (sync integrity — dead-key durability, restoredFrom zero-knowledge boundary, single-transaction restore, purge-no-outbox) and Laura (the built surface + delete-time toast honour the approved intent) on the Phase-2 diff before the human squashes. Record any conscious deferrals in `security-deferrals.md` / `ux-deferrals.md` (the live-back-reference limitation, the deadKeys growth note, the concurrent-restore window). Flag both audits prominently in your hand-off report.

---

## Self-review notes (author)

- **Spec coverage:** §2 → Tasks 1-2. §3.9 dead-key → Tasks 3-5. §3.2/§3.3 grouping → Tasks 6, 12. §3.4 delete + toast + permanent → Tasks 7, 14. §3.4 Undo → Task 8. §3.5 restore → Task 9. §3.7 restoredFrom → Tasks 9, 10. §3.6 purge → Task 11. §3.8 surface → Task 13. §3.10 Dexie → Task 3. Build constraints §4 (I-2 snapshot completeness → Task 7; I-3 purge-no-outbox → Task 11; I-4 single-transaction restore → Task 9; L-A/L-B → Task 2) all covered.
- **Deferrals** (§7): folded into the Phase-2 audit-gate note (Task 15).
- **Type consistency:** `restoreCard`/`purgeCard` take a `rootGroup: string`; `listTrashCards` returns `TrashCard[]` carrying `rootGroup`; `softDelete`/`permanentDelete` take `(collection, key)`; `markDead`/`isDeadKey` take `(collection, key)`. Consistent across tasks.
