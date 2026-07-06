# Sync Backfill, Fresh-Join Guard, and 401 Degrade-to-Offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill pre-link local data into the sync vault on the invitation late-link path, make the fresh-join flow structurally unable to overwrite an existing local account, and stop background 401s from destroying the local session.

**Architecture:** Three stacked PRs against `full-backend-transition`. PR 1 adds a `sync/backfill.ts` pump (mirrors `recovery.ts`: worker hands off via a registered setter) driven by a persistent `backfillPending` flag, plus a link-time engine-state reset and a minimal global sync line. PR 2 adds a two-layer fresh-join guard (UI routing + crypto backstop), login `?return=` handling, a replace-link confirm, and a start-over exit. PR 3 adds a refusal classifier and single-flight to the token refresh, an `origin` option on `apiFetch`, and a persistent `auth_degraded` attention state.

**Tech Stack:** TypeScript strict, React 18, Dexie (v33 — NO bump), Zustand, vitest (user-client), Bun test (crypto), Biome.

**Spec:** `superpowers/specs/2026-07-04-sync-backfill-design.md` (v2, audit-folded). Section references (§n) below point there.

## Operating rules for the overnight worker (READ FIRST)

These rules are binding. They override your defaults. If a rule here conflicts
with anything you would normally do, the rule wins.

1. **Language.** Every artefact you write into this repo — code, comments,
   test names, commit messages, user-facing copy, PR titles and bodies — is
   **British English** (`colour`, `initialise`, `behaviour`). Never US
   spelling, never German, no mixed-language strings.
2. **Branches and PRs.** The base branch is **`full-backend-transition`**.
   You NEVER touch `master` — not a checkout, not a commit, not a merge, not
   a push. Deliver **three stacked PRs, numbered in the title**:
   - PR 1 (Tasks 1–10): branch cut from `full-backend-transition`,
     title `Backfill 1/3: Sync backfill for the late-link path`.
   - PR 2 (Tasks 11–15): branch cut from PR 1's branch tip,
     title `Backfill 2/3: Fresh-join guard`.
   - PR 3 (Tasks 16–18): branch cut from PR 2's branch tip,
     title `Backfill 3/3: 401 degrade-to-offline`.
   Every PR's **base is `full-backend-transition`** (GitHub will show
   stacked diffs shrink as predecessors merge — that is expected). If your
   environment can only produce a single branch/PR, deliver ONE PR containing
   the three task groups as clearly separated commit sequences and say so in
   the PR body — never collapse the grouping.
   **You never merge anything.** The human reviews, device-tests, and merges.
3. **TDD per task, in the plan's step order.** Failing test → run it and
   CONFIRM it fails → minimal implementation → run it and CONFIRM it passes →
   commit. Do not write implementation before its test. Do not batch commits
   across tasks.
4. **Execution discipline.** Use subagent-driven development where available
   (one fresh subagent per task, review between tasks). Subagents never
   merge, push, or switch branches — only the top-level session handles git
   integration.
5. **Verification is FULL-suite, never touched-dirs-only.** Per-PR gates
   (also listed at each PR boundary):
   - `pnpm typecheck --force` → **14/14 tasks green, 0 cached**. The
     `--force` matters: Turbo caches typecheck and a cached pass on
     test-touching work is meaningless here.
   - `pnpm --filter user-client test` → full vitest.
   - `cd packages/crypto && bun test` (PR 2 especially) → all pass.
   - `pnpm build` → 9/9.
   Do NOT declare a task or PR done on a partial run.
6. **Known-green baseline (memorise this).** On the base branch, the
   user-client vitest suite has **exactly 8 known environmental failures** —
   the Node-experimental-localStorage trio-cluster (`localStorage.clear()`
   undefined). They are NOT yours to fix and NOT cover for regressions:
   expect exactly 8; a 9th failure is either the known load-dependent
   `stream-manager-store` flake (re-run it in isolation — it passes) or a
   REAL regression you introduced. Confirm the baseline on your base branch
   BEFORE starting if in doubt. Everything else (crypto, typecheck, build)
   is fully green at baseline.
7. **No Dexie version bump.** The schema is at v33 and this plan needs no
   bump (all new fields are non-indexed). If you conclude you need one, STOP
   that task, leave a written note in the PR body, and move on — a bump is
   v34 plus a ~27-assertion `db.verno` sweep and is a human decision.
8. **Security boundary.** PR 2 touches `packages/crypto` and PR 1/3 touch the
   sync engine and auth handling — ALL THREE PRs get a security audit
   (Larissa) **after** your run, by the integrating session. You do not run
   or simulate that audit; you write auditable code (no secrets in logs, no
   plaintext key material crossing any wire, comments explaining non-obvious
   security-relevant choices) and flag anything you are unsure about in the
   PR body under a heading `## For the security audit`.
9. **Commit style.** Free-form imperative, capitalised subject, no
   Conventional-Commits prefix (`Add the late-link backfill pump`, not
   `feat: ...`). Code commits do NOT get `[skip ci]`; doc-only commits do.
   End every commit message with exactly:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
10. **Do not edit** `STATUS-TRANSITION.md`, `obsidian/STATUS-*.md`,
    `CLAUDE.md`, or anything under `obsidian/` — the integrating session owns
    orientation files; a remote edit only manufactures merge conflicts.
11. **When blocked, do not improvise around the plan.** If a verified code
    fact below turns out wrong (a moved file, a changed signature), adapt the
    mechanical details but keep the task's contract; note the deviation in
    the task's commit body and the PR body. If a task's contract itself
    cannot be met, skip the task, document why in the PR body, and continue —
    an honest gap beats a silent workaround.
12. **End-of-run hand-off (the last thing you do).** For each PR, the body
    lists: the task numbers it covers, the verification numbers (every gate
    from rule 5, with the 8-failure baseline explicitly noted), any
    deviations (rule 11), and the `## For the security audit` section. Then
    report back in your final message: the three PR links, the combined
    verification numbers, and the commit list per branch. Do not merge. Do
    not touch `master`. Stop there.

## Global Constraints

- Branch base: `full-backend-transition`. PR 1 cuts from it; PR 2 stacks on PR 1; PR 3 stacks on PR 2. NEVER touch `master`.
- Every artefact in British English (code, comments, copy, commit messages).
- NO Dexie version bump. All new `SyncStateRow`/`SyncOutboxRow` fields are non-indexed. If you believe you need a bump, STOP and flag it — do not improvise (it would be v34 plus a ~27-assertion `db.verno` sweep).
- Subagents never merge, push, or switch branches.
- Licence headers: `// SPDX-License-Identifier: AGPL-3.0-only` for `apps/user-client` files, `LGPL-3.0-only` for `packages/crypto` files.
- Gates per PR (run before declaring the PR done): `pnpm typecheck --force` (14/14), full user-client vitest (`pnpm --filter user-client test` — expect EXACTLY the known 8-test Node-experimental-localStorage baseline, nothing else), `pnpm --filter @chatsundere/crypto test` for PR 2 (189+ pass), Biome via lefthook on commit.
- Test placement: user-client tests under `apps/user-client/tests/**` mirroring `src/`; crypto tests under `packages/crypto/tests/**`. Test structurally, never by log-phrase matching.
- Commit style: free-form imperative, capitalised subject, no Conventional-Commits prefix.

## Verified code facts (do not re-derive)

- Outbox rows are payload-free; sealing reads live rows at drain time (`src/sync/enqueue.ts:32`).
- `syncRows` is `Table<SyncRowMeta, [string, string]>` keyed `[collection+key]`; written on push-`ok` (`worker.ts` `applyOk`) and pull-apply.
- `drainOutbox()` (`src/sync/worker.ts:266`) does the WS-D phase order; `runSyncCycle()` (`worker.ts:655`) gates via `canRunCycle()` (`worker.ts:680`) and runs under `withSingleFlight`.
- `batchByBytes(prepared, maxBatchBytes)` (`src/sync/seal-batch.ts`) splits by bytes ONLY; comment at `seal-batch.ts:16` says "never by count". Server rejects >100 records per request (`apps/sync-service/src/routes/changes.ts:132`).
- `enqueueFullRepush()` (`src/sync/recovery.ts:380`) has NO `builtIn` filter. `recoverBlobs()` (`recovery.ts:276`) is the blob re-upload model. `isEnginePaused()` is exported from `recovery.ts`.
- Registration point for engine callbacks: `src/boot/server-foundation.ts:29` (`_setRecovery(runRecovery); initSyncTriggers();`).
- Vectors live in `chatsundere-knowledge-vectors` DB (`src/boot/knowledge-vectors-db.ts:19`); `getKnowledgeVectorRow(key)` exists; the store type has `scan`.
- Sync keys: `syncKeyOfRow(collection, row)` (`src/sync/sync-keys.ts`); vectors key is `` `${documentId}#${chunkIndex}` ``.
- `SyncStatusLine` + `deriveSyncStatus` live in `src/components/SyncStatusLine.tsx`; sole mount `src/routes/app/account/server-linking.tsx:106`. Status copy in `src/sync/copy.ts` (`syncCopy.status.*`, `syncCopy.attention.*`).
- Global mount point: `src/routes/root.tsx` renders `<SyncSurfaceHost />` at line 223.
- `apiFetch` + `refreshAccessToken` in `src/lib/fetch.ts`; refresh destroys the session on ANY failure (`fetch.ts:119`/`126`). The auth service's refresh endpoint emits exactly ONE refusal: HTTP 401 with envelope code `'unauthorized'` (`apps/auth-service/src/routes/token.ts:14,22`). Error envelopes parse via `safeReadError` (`fetch.ts:143`).
- `finishJoinByInvitation` (`packages/crypto/src/flows/join-by-invitation.ts:148`) mints the MK at line 154 and persists via `putLocalAndLinkedAccount` at line 254. `getLocalAccount` is in `packages/crypto/src/db/local-account.ts`. `CryptoErrorCode` union in `packages/crypto/src/errors.ts:3`.
- Login navigates `/app` unconditionally (`src/routes/login/index.tsx:144` passphrase, `:222` biometric). Return-URL helpers exist only in `src/routes/onboarding/invitation/_return-url.ts`.
- Invitation flow routes: `src/routes/onboarding/invitation/form.tsx` (input), `confirm.tsx`, `scan.tsx` (QR). Late-link detection `confirm.tsx:99` (`isLateLink = !!localSession && !!localMk`).
- IndexedDB names for the wipe: crypto `'chatsundere'` (`packages/crypto/src/db/schema.ts:3`), client data `'chatsundere_client_data'` (`client-data-db.ts:12`), vectors `'chatsundere-knowledge-vectors'` (`knowledge-vectors-db.ts:19`).
- `useAccountLinkStore`, `useSessionStore`, `useConnectivityStore`, `useDiscoveryStore` from `@chatsundere/ui-shared`.

---

# PR 1 — Sync backfill (Tasks 1–10)

### Task 1: `SyncStateRow` backfill fields + link-time engine reset

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (the `SyncStateRow` interface, ~line 568)
- Create: `apps/user-client/src/sync/link-reset.ts`
- Test: `apps/user-client/tests/sync/link-reset.test.ts`

**Interfaces:**
- Produces: `resetEngineStateForNewLink(): Promise<void>` — clears `syncRows` + `syncOutbox`, resets `syncState` (`watermarkRev: 0`, `epoch: null`, `attention: null`, `pulling: null`, `lastSyncAt: null`), sets `backfillPending: true`, `backfillTotal: null`, `backfillDone: null`. Consumed by Task 6 (confirm.tsx) and Task 14 (replace-link).
- Produces: `SyncStateRow` gains `backfillPending?: boolean; backfillTotal?: number | null; backfillDone?: number | null` (optional — existing rows lack them; `defaultState()` in `watermark.ts` seeds them).

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/sync/link-reset.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { getClientDataDb, _resetClientDataDbForTests } from '../../src/boot/client-data-db.js';
import { resetEngineStateForNewLink } from '../../src/sync/link-reset.js';
import { getSyncState } from '../../src/sync/watermark.js';

describe('resetEngineStateForNewLink', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('clears syncRows, syncOutbox, and resets state to a fresh-link posture', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 7, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'chats', key: 'c1', op: 'upsert', enqueuedAt: 1 });
    await db.syncState.put({
      id: 'state',
      epoch: 'old-epoch',
      watermarkRev: 99,
      lastSyncAt: 123,
      pulling: null,
      attention: { kind: 'record_too_large' },
    });

    await resetEngineStateForNewLink();

    expect(await db.syncRows.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
    const state = await getSyncState();
    expect(state.watermarkRev).toBe(0);
    expect(state.epoch).toBeNull();
    expect(state.attention).toBeNull();
    expect(state.lastSyncAt).toBeNull();
    expect(state.backfillPending).toBe(true);
    expect(state.backfillTotal).toBeNull();
    expect(state.backfillDone).toBeNull();
  });

  it('is idempotent on a fresh database (first-ever link costs nothing)', async () => {
    await resetEngineStateForNewLink();
    const state = await getSyncState();
    expect(state.backfillPending).toBe(true);
    expect(state.watermarkRev).toBe(0);
  });
});
```

Note: if `_resetClientDataDbForTests` does not exist, look at how existing sync tests (e.g. `apps/user-client/tests/sync/enqueue.test.ts`) reset the DB between tests and use that exact pattern instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/sync/link-reset.test.ts`
Expected: FAIL — `link-reset.js` module not found.

- [ ] **Step 3: Implement**

In `client-data-db.ts`, extend `SyncStateRow` (non-indexed fields — NO schema change):

```ts
/** The singleton sync-engine state row. */
export interface SyncStateRow {
  id: 'state';
  epoch: string | null;
  watermarkRev: number;
  lastSyncAt: number | null;
  pulling: { pages: number; startedAt: number } | null;
  attention: SyncAttention | null;
  /** §3.1 — set by the late-link path; the worker hands off to the backfill pump. */
  backfillPending?: boolean;
  /** §3.7 — one-off snapshot of rows to upload, counted at first pump run. */
  backfillTotal?: number | null;
  /** §3.7 — rows enqueued-and-drained so far. */
  backfillDone?: number | null;
}
```

(Adapt to the existing interface body — keep existing fields verbatim, append the three new ones with the comments above.)

Create `apps/user-client/src/sync/link-reset.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
import { getSyncState } from './watermark.js';

/**
 * Per-link engine-state reset (spec §3.2, Larissa L-1). An invitation join
 * ALWAYS binds to a fresh, empty server account, so on every link success the
 * per-account engine state must be discarded: stale `syncRows` would make the
 * backfill predicate skip rows the OLD account had synced (silent data
 * stranding), a stale watermark draws 400 `bad_since` on the first pull, and
 * stale CAS bases are meaningless against the new account. Also arms the
 * backfill flag — the two always travel together.
 */
export async function resetEngineStateForNewLink(): Promise<void> {
  const db = getClientDataDb();
  await getSyncState(); // ensure the singleton exists before update()
  await db.transaction('rw', db.syncRows, db.syncOutbox, db.syncState, async () => {
    await db.syncRows.clear();
    await db.syncOutbox.clear();
    await db.syncState.update('state', {
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: true,
      backfillTotal: null,
      backfillDone: null,
    });
  });
}
```

Also update `defaultState()` in `src/sync/watermark.ts` to seed the new fields:

```ts
function defaultState(): SyncStateRow {
  return {
    id: STATE_ID,
    epoch: null,
    watermarkRev: 0,
    lastSyncAt: null,
    pulling: null,
    attention: null,
    backfillPending: false,
    backfillTotal: null,
    backfillDone: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run tests/sync/link-reset.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/sync/link-reset.ts apps/user-client/src/sync/watermark.ts apps/user-client/tests/sync/link-reset.test.ts
git commit -m "Add backfill state fields and the link-time engine reset"
```

---

### Task 2: Record-count ceiling in `batchByBytes`

**Files:**
- Modify: `apps/user-client/src/sync/seal-batch.ts`
- Test: extend the existing seal-batch test file (find it: `rg -l batchByBytes apps/user-client/tests/`)

**Interfaces:**
- `batchByBytes(prepared: PreparedRecord[], maxBytes: number, maxRecords?: number): Batch[]` — new optional third parameter, default `100`. Existing call sites need no change.

- [ ] **Step 1: Write the failing test** (append to the existing seal-batch test file, matching its fixture helpers)

```ts
it('splits by record count even when bytes fit — the server rejects >100 records wholesale', () => {
  // 250 tiny records, all fitting one byte budget.
  const prepared = Array.from({ length: 250 }, (_, i) => makePrepared(`key-${i}`, 10));
  const batches = batchByBytes(prepared, 4 * 1024 * 1024);
  expect(batches.length).toBe(3);
  for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(100);
  expect(batches.flat().length).toBe(250);
});
```

(`makePrepared` — reuse the file's existing PreparedRecord fixture helper; if it has none, build the minimal `PreparedRecord` literal the existing tests construct.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/sync/seal-batch.test.ts` (adjust path to the real file)
Expected: FAIL — one batch of 250.

- [ ] **Step 3: Implement**

In `seal-batch.ts`: change the doc comment at line 16 from "never by count" to reflect the dual ceiling, and add the count check to the split loop:

```ts
/** Server-mirroring per-request record ceiling (sync-service MAX_PUSH_RECORDS). */
export const MAX_RECORDS_PER_BATCH = 100;

export function batchByBytes(
  prepared: PreparedRecord[],
  maxBytes: number,
  maxRecords: number = MAX_RECORDS_PER_BATCH,
): PreparedRecord[][] {
  // ... existing accumulation loop; where it decides to start a new batch on
  // byte overflow, ALSO start one when `current.length >= maxRecords`:
  //   if (current.length >= maxRecords || (bytes + size > maxBytes && current.length > 0)) { flush(); }
}
```

Adapt to the function's real body — the invariant to add is: no emitted batch may exceed `maxRecords` entries. Keep the byte logic untouched.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/seal-batch.test.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/seal-batch.ts apps/user-client/tests/sync/seal-batch.test.ts
git commit -m "Cap push batches at 100 records to mirror the server ceiling"
```

---

### Task 3: Terminal-refusal sentinel on outbox entries

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (`SyncOutboxRow`, ~line 548)
- Modify: `apps/user-client/src/sync/worker.ts` (`drainOutbox` selection, the push-result loop, `applyOk`)
- Test: `apps/user-client/tests/sync/terminal-refusal.test.ts`

**Interfaces:**
- `SyncOutboxRow` gains `terminal?: true` (non-indexed).
- Drain behaviour: entries with `terminal` are excluded from every drain phase. A push result with `code === 'record_too_large'` marks the prepared entry's seqs terminal (instead of leaving them hot). `applyOk` additionally deletes any terminal entries for the acked key (a later smaller edit clears the sentinel).
- Consumed by Task 5: the backfill remainder predicate treats keys with ANY outbox row (terminal or not) as not-a-candidate, so terminal keys do not block completion.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/sync/terminal-refusal.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Use the existing worker-test harness (see tests/sync/worker.test.ts for the
// setup pattern: _setPushTransport, _setCryptoDeps stubs, linked store state,
// session mk). Reuse its helpers verbatim.
import { describe, expect, it } from 'vitest';

describe('terminal refusal (record_too_large)', () => {
  it('marks the outbox entry terminal and skips it on the next drain', async () => {
    // Arrange: one outbox upsert for chats:c1 with a live row; push transport
    // returns { status: 'error', code: 'record_too_large' } for it.
    // Act: drainOutbox() once.
    const db = getClientDataDb();
    const rows = await db.syncOutbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.terminal).toBe(true);
    // Attention raised (existing behaviour, preserved):
    const state = await getSyncState();
    expect(state.attention?.kind).toBe('record_too_large');

    // Act: drain again with a spy transport.
    let pushed = 0;
    _setPushTransport(async (records) => { pushed += records.length; /* unreachable */ throw new Error('no push expected'); });
    await drainOutbox();
    expect(pushed).toBe(0); // terminal entry not re-pushed
  });

  it('applyOk clears leftover terminal entries for the same key on a later successful push', async () => {
    // Arrange: a terminal entry for chats:c1 AND a fresh non-terminal entry for
    // chats:c1 (the user edited the row smaller). Push transport acks 'ok'.
    // Act: drainOutbox().
    // Assert: NO outbox rows remain for chats:c1 (terminal leftovers swept).
    const remaining = await getClientDataDb().syncOutbox.where('[collection+key]').equals(['chats', 'c1']).count();
    expect(remaining).toBe(0);
  });
});
```

Flesh the arrange sections out with the worker test file's real harness — the assertions above are the contract.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client exec vitest run tests/sync/terminal-refusal.test.ts`
Expected: FAIL — `terminal` undefined / entry re-pushed.

- [ ] **Step 3: Implement**

`client-data-db.ts`:

```ts
export interface SyncOutboxRow {
  seq?: number;
  collection: SyncCollection;
  key: string;
  op: 'upsert' | 'delete' | 'blob-put' | 'blob-delete';
  /** WS-D §5 — set for `blob-put`/`blob-delete` only; the blob the op acts on. */
  blobId?: string;
  enqueuedAt: number;
  /**
   * Backfill spec §3.4 (Larissa L-6): the server refused this record terminally
   * (`record_too_large`). Excluded from every drain phase and from the backfill
   * remainder, so a doomed record can neither hot-loop nor wedge completion.
   * Swept by `applyOk` when a later (smaller) edit of the same key lands.
   */
  terminal?: true;
}
```

`worker.ts` — three edits:

1. In `drainOutbox`, right after reading the outbox, exclude terminal entries:

```ts
const outbox = (await db.syncOutbox.orderBy('seq').toArray()).filter((r) => r.terminal !== true);
```

2. In the push-result loop, route `record_too_large` to a marking function (the `else` branch currently calls `applyError(result)`):

```ts
} else {
  if (result.code === 'record_too_large') await markTerminal(prep);
  await applyError(result);
}
```

with:

```ts
/**
 * §3.4 terminal disposition: a `record_too_large` refusal is permanent for this
 * payload — mark the covered outbox entries so they stop draining. The
 * attention state (raised by `applyError`) names the condition; a later smaller
 * edit enqueues afresh and `applyOk` sweeps the sentinel.
 */
async function markTerminal(prep: PreparedRecord): Promise<void> {
  const db = getClientDataDb();
  for (const seq of prep.seqs) {
    await db.syncOutbox.update(seq, { terminal: true as const });
  }
}
```

3. In `applyOk`'s transaction, after `bulkDelete(prep.seqs)`, sweep terminal leftovers for the key (do NOT delete non-terminal rows — a racing live edit's entry must survive):

```ts
await db.syncOutbox
  .where('[collection+key]')
  .equals([prep.collection, prep.key])
  .and((r) => r.terminal === true)
  .delete();
```

- [ ] **Step 4: Run the worker + terminal tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/`
Expected: new tests PASS; zero regressions in the existing sync suite.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/sync/worker.ts apps/user-client/tests/sync/terminal-refusal.test.ts
git commit -m "Add terminal-refusal sentinel so record_too_large cannot wedge the drain"
```

---

### Task 4: Built-in mindspaces — recovery filter and apply-side guard

**Files:**
- Modify: `apps/user-client/src/sync/recovery.ts` (`enqueueFullRepush`, line ~380)
- Modify: `apps/user-client/src/sync/apply.ts` (`applyUpsert` — the guard goes after the record is opened/decrypted, before application)
- Test: `apps/user-client/tests/sync/builtin-mindspaces.test.ts`

**Interfaces:**
- Push side: `enqueueFullRepush` skips `mindspaces` rows with `builtIn: true`.
- Apply side: a pulled `mindspaces` upsert whose opened row carries `builtIn: true` is ignored — use the SAME outcome the §7.1 inert-rejection path returns (read `applyUpsert` and reuse its existing early-return shape; do not invent a new outcome kind).

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/sync/builtin-mindspaces.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

describe('built-in mindspaces never sync (engine spec §12.5, two-sided)', () => {
  it('enqueueFullRepush skips builtIn rows and enqueues user-created ones', async () => {
    // Arrange: mindspaces table with one builtIn:true row and one builtIn:false row.
    // Act: run recovery's repush enumeration (drive it via the recovery test
    // harness in tests/sync/recovery.test.ts — reuse its performRecovery setup,
    // or export/enqueue via the same seam that file uses).
    // Assert:
    const outbox = await getClientDataDb().syncOutbox.where('collection').equals('mindspaces').toArray();
    // (syncOutbox has no 'collection' index — use .filter() on toArray() instead.)
    const keys = (await getClientDataDb().syncOutbox.toArray())
      .filter((r) => r.collection === 'mindspaces')
      .map((r) => r.key);
    expect(keys).toEqual(['user-created-id']);
  });

  it('a pulled builtIn mindspace record is ignored by the apply pipeline', async () => {
    // Arrange: seal a mindspaces row { id: 'remote-builtin', builtIn: true, ... }
    // with the test MK (reuse the apply test harness in tests/sync/apply.test.ts —
    // it already seals fixture records for applyRecord).
    // Act: applyRecord(pulledRecord).
    // Assert: the local mindspaces table does NOT contain 'remote-builtin'.
    expect(await getClientDataDb().mindspaces.get('remote-builtin')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client exec vitest run tests/sync/builtin-mindspaces.test.ts`
Expected: FAIL — built-in enqueued / built-in row applied.

- [ ] **Step 3: Implement**

`recovery.ts`, inside `enqueueFullRepush`'s per-collection loop (after `const rows = await db.table(collection).toArray();`):

```ts
for (const row of rows) {
  // Built-in mindspaces never sync (engine spec §12.5): their uuids are minted
  // per device, so pushing them seeds cross-device duplicates.
  if (collection === 'mindspaces' && (row as { builtIn?: boolean }).builtIn === true) continue;
  const key = syncKeyOfRow(collection, row);
  await db.syncOutbox.add({ collection, key, op: 'upsert', enqueuedAt: now });
}
```

`apply.ts`, in `applyUpsert`, immediately after the pulled record is opened into a row object (find the `openRecord`/open call; the opened row variable is in scope) and before any table write:

```ts
// Built-in mindspaces never sync (engine spec §12.5, apply side): a sealed
// built-in from another device (or from a pre-fix recovery) is inert — its
// uuid is device-local by construction and applying it would duplicate the
// seeded seven.
if (collection === 'mindspaces' && (opened as { builtIn?: boolean }).builtIn === true) {
  return { kind: 'rejected' };
}
```

(Use the exact variable name and the exact inert-outcome literal that `applyUpsert`'s existing §7.1 inert-rejection early-return uses — read the function first.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/recovery.ts apps/user-client/src/sync/apply.ts apps/user-client/tests/sync/builtin-mindspaces.test.ts
git commit -m "Enforce built-in mindspaces never sync on both push and apply sides"
```

---

### Task 5: The backfill pump — `sync/backfill.ts`

**Files:**
- Create: `apps/user-client/src/sync/backfill.ts`
- Modify: `apps/user-client/src/boot/knowledge-vectors-db.ts` (add `listKnowledgeVectorSyncKeys`)
- Test: `apps/user-client/tests/sync/backfill.test.ts`

**Interfaces:**
- Produces: `runBackfillIfPending(): Promise<void>` — no-op unless `backfillPending`; otherwise pumps chunks until done/aborted. Consumed by Task 6 (worker handoff).
- Produces: `BACKFILL_CHUNK = 100`, `BACKFILL_ORDER: readonly SyncCollection[]` (the §3.3 order).
- Produces: `_setBackfillDrain(fn: (() => Promise<unknown>) | null)`, `_resetBackfillForTests()` test seams (mirror `recovery.ts` seam style).
- Produces (knowledge DB): `listKnowledgeVectorSyncKeys(): Promise<string[]>` — every vector row's sync key via `syncKeyOfRow('vectors', row)` equivalent (`${documentId}#${chunkIndex}`), built on the store's `scan`.
- Consumes: `drainOutbox` (from `worker.ts`, like `recovery.ts` does), `getSyncState`/`setAttention` (watermark.ts), `isEnginePaused` (recovery.ts), `enqueueBlobPut` (enqueue.ts), `blobFieldsOf` (blob-transform.ts), `syncKeyOfRow` (sync-keys.ts), `isSyncAvailable` (gate.ts).

**Behaviour contract (spec §3.3–§3.4):**
1. Guards: `backfillPending` true, MK present, `isSyncAvailable()`, `!isEnginePaused()` — else return.
2. First run: compute `backfillTotal` = sum over `BACKFILL_ORDER` of un-synced candidates; persist.
3. Candidate predicate (per collection): local row exists, AND `syncRows` has no `[collection+key]` entry, AND `syncOutbox` has no row for `[collection+key]` (any op, terminal or not — pending entries are in flight, terminal ones are excluded by design), AND (mindspaces only) `builtIn !== true`.
4. Per chunk (≤ `BACKFILL_CHUNK` keys of ONE collection): one `rw` transaction on `syncOutbox` adding an `upsert` entry per key, plus for blob-bearing collections (`personaAvatars`, `artefacts`, `attachments`) a `blob-put` entry for every `blobFieldsOf` ref whose row holds local bytes AND whose `oversizedField` is not `true` (read rows BEFORE the transaction; the entries commit atomically). Then `await drain()` (the seam, default `drainOutbox`). Then `backfillDone += chunkSize`, persisted.
5. A drain throw aborts the pump (catch, return) — flag survives, next cycle resumes. Re-check the guards between chunks.
6. Completion: when no collection yields candidates AND `syncOutbox` holds no non-terminal entries → `backfillPending: false`, `backfillTotal: null`, `backfillDone: null`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/sync/backfill.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Harness: reuse the sync test setup (linked account-link store, session MK,
// discovery config with syncUrl+sync feature, connectivity linked_online) from
// tests/sync/worker.test.ts. Vectors: stub listKnowledgeVectorSyncKeys via the
// module seam below OR seed the real store if the harness supports it — prefer
// the seam (_setVectorKeysSource) to keep the test light.
import { beforeEach, describe, expect, it } from 'vitest';

describe('backfill pump', () => {
  it('enqueues only un-synced rows, chunked at 100, and clears the flag when done', async () => {
    // Arrange: 130 chats rows; 30 of them already have syncRows entries.
    // Drain seam: simulate success by moving every outbox entry into syncRows
    // (write meta, delete entries) — the applyOk contract.
    // Act: runBackfillIfPending().
    // Assert: two drain invocations (100 + trailing >0), all 100 remaining rows
    // now in syncRows, flag cleared, counters nulled.
    const state = await getSyncState();
    expect(state.backfillPending).toBe(false);
    expect(state.backfillTotal).toBeNull();
    expect(drainCalls).toBe(2);
  });

  it('skips built-in mindspaces and keys with pending outbox entries', async () => {
    // Arrange: 2 mindspaces (one builtIn), 1 chat with a live outbox entry.
    // Assert: enqueued keys exclude the builtIn id and the pending chat key;
    // backfillTotal === 2 (user mindspace + nothing else... adapt to fixture).
  });

  it('aborts on a drain failure and resumes idempotently on the next run', async () => {
    // Arrange: 150 chats; drain seam throws on the second call.
    // Act: runBackfillIfPending() — swallows, flag still true, done === 100.
    // Re-arm drain to succeed; run again.
    // Assert: completes; no key was enqueued twice (track enqueued keys in the
    // drain seam and assert uniqueness); flag cleared.
  });

  it('enqueues blob-puts atomically with their records for blob-bearing rows', async () => {
    // Arrange: one artefacts row with a BlobRef + local bytes Blob.
    // Act: one pump chunk (drain seam records the outbox snapshot it saw).
    // Assert: the drain observed BOTH the record upsert AND the blob-put row
    // for that key in the same drain call.
  });

  it('counts total once and leaves M stable while N advances', async () => {
    // Arrange: 120 messages; first drain call adds 50 NEW local messages
    // (mid-backfill user activity) before succeeding.
    // Assert: backfillTotal stays 120 (snapshot semantics, spec §3.7/U-8).
  });
});
```

Write the arrange bodies against the real harness; the assertions are the contract. Track drain calls/keys via `_setBackfillDrain`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client exec vitest run tests/sync/backfill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `listKnowledgeVectorSyncKeys`**

In `knowledge-vectors-db.ts` (follow the file's existing style; the store exposes `scan`):

```ts
/**
 * Every vector row's sync key (`${documentId}#${chunkIndex}`), for the backfill
 * pump's enumeration (spec §3.6). Kept beside `getKnowledgeVectorRow` so the
 * embeddings engine stays lazily loaded from the sync side.
 */
export async function listKnowledgeVectorSyncKeys(): Promise<string[]> {
  const store = getKnowledgeVectorStore();
  const keys: string[] = [];
  // Use the store's scan exactly as the knowledge data layer does (see its
  // existing scan call sites for the iteration shape).
  for await (const row of store.scan(KNOWLEDGE_COLLECTION)) {
    keys.push(`${row.documentId}#${row.chunkIndex}`);
  }
  return keys;
}
```

(Adapt the `scan` invocation to the real `VectorStore.scan` signature — check `getKnowledgeVectorRow`'s implementation in the same file for how rows are read; the key format is pinned by `sync-keys.ts:33`.)

- [ ] **Step 4: Implement `sync/backfill.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import type { SyncOutboxRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { blobFieldsOf } from './blob-transform.js';
import { isSyncAvailable } from './gate.js';
import { isEnginePaused } from './recovery.js';
import { syncKeyOfRow } from './sync-keys.js';
import { getSyncState } from './watermark.js';
import { drainOutbox } from './worker.js';

/**
 * The late-link backfill pump (spec §3.3). Runs at the end of a sync cycle when
 * `backfillPending` is set: enumerates rows the CURRENT link has never synced
 * (no `syncRows` entry — sound because the link-time reset cleared stale
 * state, §3.2), enqueues them chunk-wise as payload-free outbox upserts, and
 * drains between chunks. Interleaving bounds outbox size, sealing memory, and
 * gives the server's rate limits natural backpressure.
 *
 * Resumable by construction: the predicate is recomputed every run, a crash
 * mid-chunk leaves outbox rows for the boot-reconcile drain, and a double push
 * would be an idempotent CAS push anyway (§3.4).
 */

/** ≤ the server's MAX_PUSH_RECORDS — a bigger chunk is rejected wholesale (L-2). */
export const BACKFILL_CHUNK = 100;

/** §3.3 — structural parents before bulk children; vectors last. */
export const BACKFILL_ORDER: readonly SyncCollection[] = [
  'settings',
  'providers',
  'mcpServers',
  'mindspaces',
  'personas',
  'personaAvatars',
  'seedTemplates',
  'libraries',
  'documents',
  'chats',
  'artefacts',
  'attachments',
  'messages',
  'pills',
  'memoryJournal',
  'memoryBody',
  'compactionCheckpoints',
  'vectors',
];

const BLOB_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'personaAvatars',
  'artefacts',
  'attachments',
]);

// ===== Test seams (mirror recovery.ts) =====

type DrainFn = () => Promise<unknown>;
let drainOverride: DrainFn | null = null;
let vectorKeysOverride: (() => Promise<string[]>) | null = null;

/** Test seam: intercept the between-chunks drain (defaults to `drainOutbox`). */
export function _setBackfillDrain(fn: DrainFn | null): void {
  drainOverride = fn;
}
/** Test seam: replace the knowledge-DB vector key enumeration. */
export function _setVectorKeysSource(fn: (() => Promise<string[]>) | null): void {
  vectorKeysOverride = fn;
}
/** Test seam: clear every override. */
export function _resetBackfillForTests(): void {
  drainOverride = null;
  vectorKeysOverride = null;
}

// ===== Enumeration =====

/** All sync keys for a collection's local rows (built-ins already excluded). */
async function listLocalKeys(collection: SyncCollection): Promise<string[]> {
  const db = getClientDataDb();
  if (collection === 'settings') {
    return (await db.settings.get(1)) ? ['1'] : [];
  }
  if (collection === 'vectors') {
    if (vectorKeysOverride) return vectorKeysOverride();
    const { listKnowledgeVectorSyncKeys } = await import('../boot/knowledge-vectors-db.js');
    return listKnowledgeVectorSyncKeys();
  }
  const rows = await db.table(collection).toArray();
  return rows
    .filter(
      (row) =>
        !(collection === 'mindspaces' && (row as { builtIn?: boolean }).builtIn === true),
    )
    .map((row) => syncKeyOfRow(collection, row));
}

/**
 * Candidates = local keys with NO `syncRows` meta and NO outbox row (pending
 * entries are already in flight; terminal ones are excluded by design, §3.4).
 */
async function listUnsyncedKeys(collection: SyncCollection): Promise<string[]> {
  const db = getClientDataDb();
  const keys = await listLocalKeys(collection);
  if (keys.length === 0) return [];
  const metas = await db.syncRows.bulkGet(keys.map((k) => [collection, k] as [string, string]));
  const outboxKeys = new Set(
    (await db.syncOutbox.toArray())
      .filter((r) => r.collection === collection)
      .map((r) => r.key),
  );
  return keys.filter((key, i) => metas[i] === undefined && !outboxKeys.has(key));
}

// ===== The pump =====

function canContinue(): boolean {
  return (
    useSessionStore.getState().mk !== null && isSyncAvailable() && !isEnginePaused()
  );
}

/**
 * Run the pump if armed (spec §3.3). Invoked by the worker at the end of every
 * cycle, inside the single-flight lock; registered via `_setBackfill` so
 * neither module imports the other's cycle entry point.
 */
export async function runBackfillIfPending(): Promise<void> {
  const db = getClientDataDb();
  let state = await getSyncState();
  if (state.backfillPending !== true) return;
  if (!canContinue()) return;

  // First run: snapshot the total (§3.7 — M is existing data, not live work).
  if (state.backfillTotal === null || state.backfillTotal === undefined) {
    let total = 0;
    for (const collection of BACKFILL_ORDER) {
      total += (await listUnsyncedKeys(collection)).length;
    }
    await db.syncState.update('state', { backfillTotal: total, backfillDone: 0 });
    state = await getSyncState();
  }

  const drain = drainOverride ?? drainOutbox;
  let done = state.backfillDone ?? 0;

  for (const collection of BACKFILL_ORDER) {
    for (;;) {
      if (!canContinue()) return; // flag survives; next trigger resumes
      const chunk = (await listUnsyncedKeys(collection)).slice(0, BACKFILL_CHUNK);
      if (chunk.length === 0) break;

      await enqueueChunk(collection, chunk);
      try {
        await drain();
      } catch {
        // Offline / 429 / quota mid-drain: the outbox retains what did not land
        // (those keys now have pending entries and drop out of the predicate);
        // the existing attention mechanics own the messaging. Resume next cycle.
        return;
      }
      done += chunk.length;
      await db.syncState.update('state', { backfillDone: done });
    }
  }

  // Completion (§3.3 step 5): nothing left anywhere, and no non-terminal outbox
  // entries still in flight (a live edit pending briefly holds the flag — it
  // drains within the same cycle cadence and completion lands next cycle).
  const pending = (await db.syncOutbox.toArray()).filter((r) => r.terminal !== true).length;
  if (pending === 0) {
    await db.syncState.update('state', {
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
    });
  }
}

/**
 * One chunk in ONE transaction (§3.3): record upserts plus, for blob-bearing
 * collections, a `blob-put` per ref whose bytes this device still holds. Rows
 * are read before the transaction; only the outbox writes need atomicity.
 */
async function enqueueChunk(collection: SyncCollection, keys: string[]): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  const entries: SyncOutboxRow[] = [];

  for (const key of keys) {
    entries.push({ collection, key, op: 'upsert', enqueuedAt: now });
    if (!BLOB_COLLECTIONS.has(collection)) continue;
    const row = (await db.table(collection).get(key)) as Record<string, unknown> | undefined;
    if (!row) continue;
    for (const spec of blobFieldsOf(collection)) {
      if (row[spec.oversizedField] === true) continue; // server-terminal (§3.6)
      const ref = row[spec.refField] as { blobId?: string } | null | undefined;
      const bytes = row[spec.bytesField];
      if (ref?.blobId && bytes instanceof Blob && bytes.size > 0) {
        entries.push({ collection, key, op: 'blob-put', blobId: ref.blobId, enqueuedAt: now });
      }
    }
  }

  await db.transaction('rw', db.syncOutbox, async () => {
    await db.syncOutbox.bulkAdd(entries);
  });
}
```

Check `blobFieldsOf`'s real return shape (`refField`/`bytesField`/`oversizedField` — verified names from `recovery.ts:288-296`) and `syncKeyOfRow`'s signature before wiring; adjust property access to match.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/backfill.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/sync/backfill.ts apps/user-client/src/boot/knowledge-vectors-db.ts apps/user-client/tests/sync/backfill.test.ts
git commit -m "Add the late-link backfill pump"
```

---

### Task 6: Worker handoff, boot registration, and the confirm.tsx trigger

**Files:**
- Modify: `apps/user-client/src/sync/worker.ts` (cycle handoff + seam)
- Modify: `apps/user-client/src/boot/server-foundation.ts` (registration, line ~29)
- Modify: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` (late-link success branch, lines 119–138)
- Test: `apps/user-client/tests/sync/backfill-trigger.test.ts`

**Interfaces:**
- Produces (worker): `_setBackfill(fn: () => Promise<void>): void` seam; `runSyncCycle` awaits the registered backfill AFTER the drain/pull handoff, inside the single-flight lock. Default: no-op (mirrors `recovery`/`pullLoop`).
- Produces (confirm.tsx): the late-link success branch calls `await resetEngineStateForNewLink()` after `linkToServer` succeeds and before navigation, then fires `void runSyncCycle()`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/sync/backfill-trigger.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { _setBackfill, runSyncCycle, _resetWorkerForTests } from '../../src/sync/worker.js';

describe('cycle → backfill handoff', () => {
  it('runs the registered backfill after drain+pull within the same cycle', async () => {
    // Arrange: worker harness with linked/unlocked/online stores (reuse
    // tests/sync/worker.test.ts setup), empty outbox, stub pull loop.
    const calls: string[] = [];
    _setPullLoop(async () => { calls.push('pull'); });
    _setBackfill(async () => { calls.push('backfill'); });
    await runSyncCycle();
    expect(calls).toEqual(['pull', 'backfill']);
  });

  it('does not run backfill when recovery was handed off instead', async () => {
    // Arrange: drain reports needsRecovery (push transport returns a mismatched
    // epoch — reuse the worker test's recovery-handoff fixture).
    // Assert: backfill seam NOT called this cycle.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client exec vitest run tests/sync/backfill-trigger.test.ts`
Expected: FAIL — `_setBackfill` not exported.

- [ ] **Step 3: Implement**

`worker.ts` — beside the `pullLoop`/`recovery` defaults:

```ts
/** Task 6 registers the backfill pump here; defaults to a no-op until then. */
let backfill: () => Promise<void> = async () => undefined;

/** Boot seam: register the backfill pump the cycle runs after drain+pull (§3.3). */
export function _setBackfill(fn: () => Promise<void>): void {
  backfill = fn;
}
```

In `runSyncCycle`, inside `withSingleFlight`, after the recovery/pull branch (recovery returns early — backfill deliberately skips a recovery cycle):

```ts
if (result.needsPull || result.head === null) {
  await pullLoop();
}
// §3.3 — the backfill pump rides the tail of the cycle, inside the lock.
await backfill();
```

Reset it in `_resetWorkerForTests` (`backfill = async () => undefined;`).

`server-foundation.ts` (beside `_setRecovery(runRecovery)`):

```ts
import { runBackfillIfPending } from '../sync/backfill.js';
import { _setBackfill } from '../sync/worker.js';
// ...
_setBackfill(runBackfillIfPending);
```

`confirm.tsx` late-link branch — after `linkToServer` succeeds and `setLinked(linkedRow)` ran (keep the existing order; insert before `navigate('/app', ...)`):

```ts
// Spec §3.2: a link ALWAYS binds a fresh server account — reset the per-link
// engine state and arm the backfill, then kick the first cycle.
await resetEngineStateForNewLink();
void runSyncCycle();
navigate('/app', { replace: true });
```

Imports: `import { resetEngineStateForNewLink } from '../../../sync/link-reset.js';` and `import { runSyncCycle } from '../../../sync/worker.js';`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/worker.ts apps/user-client/src/boot/server-foundation.ts apps/user-client/src/routes/onboarding/invitation/confirm.tsx apps/user-client/tests/sync/backfill-trigger.test.ts
git commit -m "Wire the backfill pump into the cycle and arm it on late-link success"
```

---

### Task 7: `bad_since` → recovery handoff

**Files:**
- Modify: `apps/user-client/src/sync/worker.ts` (`runPullLoop`)
- Test: `apps/user-client/tests/sync/bad-since.test.ts`

**Interfaces:**
- A pull page that throws `HttpError` with `code === 'bad_since'` hands off to the registered `recovery()` and ends the loop — exactly like an authenticated epoch mismatch (spec §3.2). Any other pull error propagates unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/sync/bad-since.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/lib/fetch.js';

describe('bad_since handling (spec §3.2, Larissa L-1 defence-in-depth)', () => {
  it('hands off to recovery when the pull rejects the watermark', async () => {
    // Arrange: worker harness; watermark 500; pull transport throws
    // new HttpError(400, 'bad_since', '400 Bad Request').
    let recovered = false;
    _setRecovery(async () => { recovered = true; });
    _setPullTransport(async () => { throw new HttpError(400, 'bad_since', '400 Bad Request'); });
    await runPullLoop();
    expect(recovered).toBe(true);
  });

  it('propagates any other pull error unchanged', async () => {
    _setPullTransport(async () => { throw new HttpError(500, undefined, '500'); });
    await expect(runPullLoop()).rejects.toMatchObject({ status: 500 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter user-client exec vitest run tests/sync/bad-since.test.ts`
Expected: FAIL — recovery not invoked (error propagates).

- [ ] **Step 3: Implement**

In `runPullLoop`, wrap the per-page `pull(...)` call:

```ts
let response: SyncPullResponse;
try {
  response = await pull(watermarkRev, PULL_PAGE_LIMIT);
} catch (err) {
  // 400 bad_since: the watermark is ahead of this account's head — an
  // authenticated signal of account-level divergence (a relink or a server
  // account reset). Same remedy as an epoch mismatch: full recovery (§3.2).
  if (err instanceof HttpError && err.code === 'bad_since') {
    await recovery();
    return;
  }
  throw err;
}
```

Import `HttpError` from `../lib/fetch.js` (worker.ts already imports `apiFetch` from there).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/bad-since.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/worker.ts apps/user-client/tests/sync/bad-since.test.ts
git commit -m "Hand off to recovery on a bad_since pull rejection"
```

---

### Task 8: Status vocabulary — the backfill entry and pinned precedence

**Files:**
- Modify: `apps/user-client/src/sync/copy.ts` (`syncCopy.status`)
- Modify: `apps/user-client/src/components/SyncStatusLine.tsx` (`StatusView`, `deriveSyncStatus`)
- Test: extend `apps/user-client/tests/components/sync-status-line.test.ts` (find the real path: `rg -l deriveSyncStatus apps/user-client/tests/`)

**Interfaces:**
- `syncCopy.status.backfill(done: number, total: number): string` → `` `Uploading your existing data… ${done} of ${total}` ``
- `syncCopy.status.offlineBackfill: string` → `Offline — your upload will pick up where it left off.`
- `deriveSyncStatus` gains kind `'backfill'`; precedence (spec §3.7, U-5 pinned): Recovery → Attention → Pulling → Offline → **Backfill** → Waiting → Fetching → Synced. When offline AND `backfillPending`, the offline state uses `offlineBackfill` copy (U-6).

- [ ] **Step 1: Write the failing tests** (in the existing `deriveSyncStatus` test file, using its state-fixture helpers)

```ts
it('ranks backfill above waiting but below attention (U-5: quota must not be masked)', () => {
  const base = makeState({ backfillPending: true, backfillTotal: 500, backfillDone: 120 });
  expect(deriveSyncStatus({ state: base, outboxCount: 80, online: true, recovering: false }).kind)
    .toBe('backfill');
  const withAttention = { ...base, attention: { kind: 'quota_exceeded', usedBytes: 1, quotaBytes: 2 } as const };
  expect(deriveSyncStatus({ state: withAttention, outboxCount: 80, online: true, recovering: false }).kind)
    .toBe('attention');
});

it('renders progress numbers', () => {
  const state = makeState({ backfillPending: true, backfillTotal: 500, backfillDone: 120 });
  const view = deriveSyncStatus({ state, outboxCount: 0, online: true, recovering: false });
  expect(view.text).toBe('Uploading your existing data… 120 of 500');
});

it('offline during backfill reassures about resumption (U-6)', () => {
  const state = makeState({ backfillPending: true, backfillTotal: 500, backfillDone: 120 });
  const view = deriveSyncStatus({ state, outboxCount: 0, online: false, recovering: false });
  expect(view.kind).toBe('offline');
  expect(view.text).toBe('Offline — your upload will pick up where it left off.');
});
```

Caution: the pulling branch fires on `watermarkRev === 0 && online` — a fresh link has watermark 0, so set `watermarkRev` in the backfill fixtures to a non-zero value OR accept pulling's precedence (it IS above backfill by spec). Set `watermarkRev: 1` in `makeState` for the backfill tests and add one test asserting pulling outranks backfill at watermark 0.

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — kind `'waiting'`/missing copy.

- [ ] **Step 3: Implement**

`copy.ts`, in `status`:

```ts
backfill: (done: number, total: number) => `Uploading your existing data… ${done} of ${total}`,
offlineBackfill: 'Offline — your upload will pick up where it left off.',
```

`SyncStatusLine.tsx`: add `'backfill'` to `StatusView['kind']`; in `deriveSyncStatus`, replace branch 4 (offline) and insert the backfill branch between it and waiting:

```ts
// 4. Offline — linked but unreachable; a paused backfill reassures (U-6).
if (!online) {
  const text =
    state.backfillPending === true ? syncCopy.status.offlineBackfill : syncCopy.status.offline;
  return { kind: 'offline', tone: 'neutral', text };
}

// 5. Backfill — the one-off upload of pre-link data (§3.7). Above waiting
//    (the pump keeps the outbox at a misleading constant ~100), below
//    attention (quota during bulk upload must never be masked, U-5).
if (state.backfillPending === true) {
  return {
    kind: 'backfill',
    tone: 'active',
    text: syncCopy.status.backfill(state.backfillDone ?? 0, state.backfillTotal ?? 0),
  };
}
```

(Renumber the trailing comment labels — waiting/fetching/synced become 6/7/8.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/components/` (adjust to the real test path)
Expected: PASS incl. all pre-existing precedence tests.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/copy.ts apps/user-client/src/components/SyncStatusLine.tsx apps/user-client/tests/
git commit -m "Add the backfill status vocabulary with pinned precedence"
```

---

### Task 9: The minimal global sync line

**Files:**
- Create: `apps/user-client/src/components/GlobalSyncLine.tsx`
- Modify: `apps/user-client/src/routes/root.tsx` (mount beside `<SyncSurfaceHost />`, line ~223)
- Test: `apps/user-client/tests/components/global-sync-line.test.tsx`

**Interfaces:**
- Renders ONLY (spec §3.7): the backfill progress entry and attention states. Renders `null` for every other status, for local-only users, and outside `/app` routes. Deliberately plain; collapsible to a dot (local state). Reuses `deriveSyncStatus` + the same poll pattern as `SyncStatusLine` (2 s interval, no `useLiveQuery` in this project).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/components/global-sync-line.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Harness: reuse the SyncStatusLine test's store/DB setup (linked store,
// seeded syncState) and MemoryRouter with an /app initial entry.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('GlobalSyncLine (spec §3.7 — backfill + attention only)', () => {
  it('shows backfill progress while pending', async () => {
    // seed syncState { backfillPending: true, backfillTotal: 500, backfillDone: 120, watermarkRev: 1 }
    render(withAppRouter(<GlobalSyncLine />));
    await waitFor(() =>
      expect(screen.getByText('Uploading your existing data… 120 of 500')).toBeInTheDocument(),
    );
  });

  it('shows an attention state with its action', async () => {
    // seed syncState { attention: { kind: 'recovery_paused' } }
    render(withAppRouter(<GlobalSyncLine />));
    await waitFor(() => expect(screen.getByText(/paused/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders nothing when synced/waiting/local-only', async () => {
    // seed a plain synced state; assert container is empty after a poll tick.
    const { container } = render(withAppRouter(<GlobalSyncLine />));
    await new Promise((r) => setTimeout(r, 10));
    expect(container.firstChild).toBeNull();
  });

  it('collapses to a dot and expands back on tap', async () => {
    // backfill pending; click the collapse control; expect the dot (aria-label
    // 'Show sync status'); click it; expect the full text again.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/user-client/src/components/GlobalSyncLine.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { SyncStateRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { isRecovering, subscribeRecovering, getSyncState } from '../sync/watermark.js';
import { deriveSyncStatus } from './SyncStatusLine.js';

/**
 * The minimal global sync line (spec §3.7 — Chris's conscious revision of the
 * WS-C SOFT-3 deferral). One deliberately plain, calm line in the app chrome
 * that renders ONLY the two signals whose value depends on being seen where
 * the user actually is: backfill progress and attention states (incl. PR 3's
 * auth_degraded). Everything else stays on the server-linking page's
 * SyncStatusLine — this line renders nothing and the chat keeps its centre.
 * Collapsible to a dot; the design-language pass restyles it later.
 */
const POLL_MS = 2_000;

export function GlobalSyncLine(): JSX.Element | null {
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const connectivityKind = useConnectivityStore((s) => s.state.kind);
  const { pathname } = useLocation();
  const [state, setState] = useState<SyncStateRow | null>(null);
  const [outboxCount, setOutboxCount] = useState(0);
  const [recovering, setRecovering] = useState(() => isRecovering());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => subscribeRecovering(setRecovering), []);

  useEffect(() => {
    if (linkStatus !== 'linked') return undefined;
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const db = getClientDataDb();
        const [s, count] = await Promise.all([getSyncState(), db.syncOutbox.count()]);
        if (!cancelled) {
          setState(s);
          setOutboxCount(count);
        }
      } catch {
        // Transiently closed DB (logout/teardown) — the next poll recovers.
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [linkStatus]);

  if (linkStatus !== 'linked' || !state || !pathname.startsWith('/app')) return null;

  const view = deriveSyncStatus({
    state,
    outboxCount,
    online: connectivityKind === 'linked_online',
    recovering,
  });
  // §3.7 — this surface carries ONLY backfill and attention.
  if (view.kind !== 'backfill' && view.kind !== 'attention') return null;

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Show sync status"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-16 right-3 z-40 h-2.5 w-2.5 rounded-full bg-aurora-400/80"
      />
    );
  }

  return (
    <div
      className="fixed bottom-16 inset-x-3 z-40 mx-auto flex max-w-sm items-center gap-2 rounded-[var(--radius-card)] bg-ink-soft/95 px-3 py-2 text-[11px] ring-1 ring-inset ring-aurora-700/20"
      aria-live="polite"
      data-global-sync-status={view.kind}
    >
      <span className={view.tone === 'attention' ? 'text-warning' : 'text-aurora-200'}>
        {view.text}
      </span>
      {view.action ? (
        <button
          type="button"
          onClick={view.action.onClick}
          className="rounded-md border border-white/10 px-2 py-0.5 text-paper-soft hover:text-paper"
        >
          {view.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Collapse sync status"
        onClick={() => setCollapsed(true)}
        className="ml-auto text-paper-soft hover:text-paper"
      >
        ·
      </button>
    </div>
  );
}
```

Mount in `root.tsx` directly beside `<SyncSurfaceHost />`:

```tsx
<SyncSurfaceHost />
<GlobalSyncLine />
```

Check the surrounding layout in `root.tsx` — if `<SyncSurfaceHost />` sits outside the router context, mount `<GlobalSyncLine />` at the nearest point INSIDE it (`useLocation` needs the router). Positioning: `bottom-16` clears the chat input bar at 380 px — verify against the app's actual bottom chrome and adjust the offset class if it overlaps.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/components/global-sync-line.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/GlobalSyncLine.tsx apps/user-client/src/routes/root.tsx apps/user-client/tests/components/global-sync-line.test.tsx
git commit -m "Add the minimal global sync line for backfill progress and attention"
```

---

### Task 10: PR 1 integration scenarios + gates

**Files:**
- Test: `apps/user-client/tests/sync/backfill-scenarios.test.ts`

- [ ] **Step 1: Write the scenario tests** (worker harness; drain via REAL `drainOutbox` with a stubbed push transport that acks `ok` with incrementing revs)

```ts
describe('backfill scenarios (spec §3.4, §6)', () => {
  it('relink after server account loss re-uploads EVERYTHING (L-1)', async () => {
    // Arrange: 20 chats; simulate a prior link: syncRows entries for all 20
    // (old account), watermark 500, epoch 'a'.
    // Act: resetEngineStateForNewLink(); run cycles until flag clears.
    // Assert: push transport received all 20 records; watermark restarted from
    // pull; syncRows repopulated with the NEW revs.
  });

  it('resumes across a simulated crash between chunks', async () => {
    // Arrange: 250 messages; run one pump invocation with a drain seam that
    // succeeds once then throws (simulating the tab dying mid-run is
    // equivalent to the pump aborting — state is all in Dexie).
    // Act: fresh runBackfillIfPending() (as the boot cycle would).
    // Assert: completes; every message pushed exactly once (count pushed keys).
  });

  it('quota attention survives and the flag stays armed', async () => {
    // Arrange: push transport returns quota_exceeded error results.
    // Assert: attention quota_exceeded set; backfillPending still true;
    // deriveSyncStatus shows attention (not backfill) — the U-5 masking test
    // at the integration level.
  });
});
```

- [ ] **Step 2: Run the new file, then the full gates**

Run: `pnpm --filter user-client exec vitest run tests/sync/backfill-scenarios.test.ts` → PASS
Run: `pnpm typecheck --force` → 14/14
Run: `pnpm --filter user-client test` → only the known 8-test localStorage baseline fails
Expected: exactly that; anything else is a regression to fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/tests/sync/backfill-scenarios.test.ts
git commit -m "Add backfill integration scenarios"
```

**PR 1 boundary.** Deliverable: backfill green end-to-end on the branch.

---

# PR 2 — Fresh-join guard (Tasks 11–15) — stacks on PR 1

### Task 11: Crypto backstop — `local_account_exists`

**Files:**
- Modify: `packages/crypto/src/errors.ts` (union, line 3)
- Modify: `packages/crypto/src/flows/join-by-invitation.ts` (`finishJoinByInvitation`, line ~150)
- Modify: `apps/user-client/src/routes/onboarding/pairing/confirm.tsx` (line ~34 — correct the stale comment claiming "Phase 0 accepts the local-data replacement"; the refusal lives in `join-by-pairing.ts:152`)
- Test: `packages/crypto/tests/flows/join-by-invitation.test.ts` (extend)

**Interfaces:**
- `CryptoErrorCode` gains `'local_account_exists'`.
- `finishJoinByInvitation` throws `CryptoError('local_account_exists', …)` BEFORE minting any key material and BEFORE any server call, when `getLocalAccount(args.db)` returns a row.

- [ ] **Step 1: Write the failing test** (extend the existing join test file, reusing its fake-IDB + stub serverClient fixtures)

```ts
it('refuses to run over an existing local account — before any server call (spec §4.2)', async () => {
  // Arrange: a db that already holds a local_account row (reuse the fixture the
  // link.test.ts file uses to seed one); a serverClient whose joinFinish spies.
  await expect(
    finishJoinByInvitation({ db, serverClient, baseUrl, joinState, username: 'u', passphrase: 'p' }),
  ).rejects.toMatchObject({ code: 'local_account_exists' });
  expect(joinFinishSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/crypto && bun test tests/flows/join-by-invitation.test.ts`
Expected: FAIL — the flow proceeds (spy called or a different error).

- [ ] **Step 3: Implement**

`errors.ts`: add `| 'local_account_exists'` to the union.

`join-by-invitation.ts` — first statement of `finishJoinByInvitation`, before `opaqueServerIdentity`:

```ts
import { getLocalAccount } from '../db/local-account.js';
// ...
export async function finishJoinByInvitation(
  args: FinishJoinByInvitationArgs,
): Promise<FinishJoinByInvitationResult> {
  // Stop-the-line backstop (spec §4.2): this flow mints a NEW master key and
  // overwrites the local account row. On a device that already holds one, that
  // silently destroys the existing crypto domain — refuse before any key
  // material exists and before any server call (the invitation code burns only
  // at /join/finish, so a refused attempt costs nothing).
  const existing = await getLocalAccount(args.db);
  if (existing) {
    throw new CryptoError(
      'local_account_exists',
      'a local account already exists on this device; unlock it and link instead',
    );
  }
  const serverId = opaqueServerIdentity(args.baseUrl);
  // ... unchanged
```

`pairing/confirm.tsx:34`: rewrite the stale comment to state that the refusal is enforced in `join-by-pairing.ts` (the crypto guard), not accepted.

- [ ] **Step 4: Run tests**

Run: `cd packages/crypto && bun test`
Expected: all pass (189+).

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src/errors.ts packages/crypto/src/flows/join-by-invitation.ts packages/crypto/tests/flows/join-by-invitation.test.ts apps/user-client/src/routes/onboarding/pairing/confirm.tsx
git commit -m "Refuse invitation fresh-join over an existing local account"
```

---

### Task 12: Login honours a validated `?return=`

**Files:**
- Modify: `apps/user-client/src/routes/login/index.tsx` (lines ~144 and ~222)
- Test: `apps/user-client/tests/routes/login-return.test.tsx`

**Interfaces:**
- Produces: exported pure helper `safeReturnTarget(raw: string | null): string` — returns `raw` iff it starts with `/` and not `//` (same-origin relative path), else `'/app'`. Both login success paths navigate to it. Consumed by Task 13's guard screen (it builds the `?return=` the login consumes).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/routes/login-return.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { safeReturnTarget } from '../../src/routes/login/index.js';

describe('safeReturnTarget (spec §4.1, U-3)', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeReturnTarget('/onboarding/invitation/confirm?return=%2Fapp')).toBe(
      '/onboarding/invitation/confirm?return=%2Fapp',
    );
  });
  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeReturnTarget('//evil.example')).toBe('/app');
    expect(safeReturnTarget('https://evil.example')).toBe('/app');
  });
  it('defaults to /app', () => {
    expect(safeReturnTarget(null)).toBe('/app');
  });
});
```

Plus a component-level test if the login route has an existing test harness (check `rg -l 'login' apps/user-client/tests/routes/`): passphrase unlock with `?return=/onboarding/invitation/confirm` lands there, not `/app`. If no harness exists, the pure-helper tests + manual verification carry it — do NOT build a bespoke WebAuthn mock just for this.

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — export missing.

- [ ] **Step 3: Implement**

In `login/index.tsx`:

```ts
/**
 * Validate a ?return= target (spec §4.1): only a same-origin relative path may
 * round-trip through the unlock — anything else falls back to /app. Guards the
 * guard: a crafted link must not turn the login into an open redirect.
 */
export function safeReturnTarget(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/app';
}
```

In the component, read it once (`useSearchParams` is already imported? if not, add it):

```ts
const [searchParams] = useSearchParams();
const returnTarget = safeReturnTarget(searchParams.get('return'));
```

Replace BOTH `navigate('/app', { replace: true });` success navigations (`:144` passphrase, `:222` biometric) with:

```ts
navigate(returnTarget, { replace: true });
```

(Only the two SUCCESS paths — error paths keep their behaviour.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/routes/login-return.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/login/index.tsx apps/user-client/tests/routes/login-return.test.tsx
git commit -m "Honour a validated return target after unlock"
```

---

### Task 13: The unlock-first guard on the invitation routes

**Files:**
- Create: `apps/user-client/src/routes/onboarding/invitation/_account-guard.tsx`
- Modify: `apps/user-client/src/routes/onboarding/invitation/form.tsx` (wrap)
- Modify: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` (wrap)
- Test: `apps/user-client/tests/routes/invitation-account-guard.test.tsx`

**Interfaces:**
- Produces: `<InvitationAccountGuard>{children}</InvitationAccountGuard>` — three states: `checking` (renders nothing), `guard` (local account exists AND no unlocked session → renders the unlock-first screen), `pass` (renders children). The guard screen's CTA navigates to `` `/login?return=${encodeURIComponent(pathname + search)}` ``.
- The detection: `getLocalAccount(getDb())` non-null AND `useSessionStore.getState().mk === null`. An unlocked session (late-link, incl. the already-linked case Task 14 handles) passes through.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/routes/invitation-account-guard.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Harness: MemoryRouter at /onboarding/invitation?return=..., fake-IDB with/
// without a local account row (reuse whatever open-db test doubles the
// onboarding route tests already use — check tests/routes/ for the pattern).
describe('InvitationAccountGuard (spec §4.1)', () => {
  it('shows the unlock-first screen when a local account exists without a session', async () => {
    // account present, session store mk null
    render(guarded(<div>join form</div>));
    await waitFor(() =>
      expect(screen.getByText(/already holds an account/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText('join form')).not.toBeInTheDocument();
    // CTA carries the return URL:
    const cta = screen.getByRole('link', { name: /unlock/i });
    expect(cta).toHaveAttribute('href', expect.stringContaining('/login?return=%2Fonboarding%2Finvitation'));
  });

  it('passes through on a fresh device', async () => {
    // no local account
    render(guarded(<div>join form</div>));
    await waitFor(() => expect(screen.getByText('join form')).toBeInTheDocument());
  });

  it('passes through for an unlocked session (late-link)', async () => {
    // account present, mk set
    render(guarded(<div>join form</div>));
    await waitFor(() => expect(screen.getByText('join form')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/user-client/src/routes/onboarding/invitation/_account-guard.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { getLocalAccount } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getDb } from '../../../boot/open-db.js';

/**
 * The fresh-join guard's door (spec §4.1): on a device that already holds a
 * local account but has no unlocked session, the invitation flow must lead
 * through the local login (which preserves the MK and turns the join into a
 * late-link) instead of the join form (whose fresh path would mint a new MK —
 * the 2026-07-03 data-loss class). Wraps BOTH the input and confirm routes so
 * the QR deep-link path is covered too. An unlocked session passes through:
 * that IS the late-link.
 */
export function InvitationAccountGuard({ children }: { children: ReactNode }): JSX.Element | null {
  const mk = useSessionStore((s) => s.mk);
  const location = useLocation();
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLocalAccount(getDb()).then((row) => {
      if (!cancelled) setHasAccount(row !== null && row !== undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (hasAccount === null) return null; // checking — a flash of form would mislead
  if (!hasAccount || mk !== null) return <>{children}</>;

  const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <h1 className="mt-4 font-display text-2xl italic">This device already holds an account</h1>
      <p className="mt-2 text-sm text-paper-soft">
        Unlock it first, then connect it to the server — your chats and settings stay exactly as
        they are.
      </p>
      <Link
        to={`/login?return=${returnTo}`}
        className="mt-6 block w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        Unlock and connect →
      </Link>
    </main>
  );
}
```

Wrap the exported components in `form.tsx` and `confirm.tsx` (in `confirm.tsx`, wrap OUTSIDE the existing bounce guard so the guard wins):

```tsx
export function InvitationConfirm() {
  return (
    <InvitationAccountGuard>
      <InvitationConfirmGuarded />
    </InvitationAccountGuard>
  );
}
// rename the existing InvitationConfirm body to InvitationConfirmGuarded
```

(Verify `getLocalAccount` is exported from `@chatsundere/crypto`'s index — `rg 'getLocalAccount' packages/crypto/src/index.ts`; if not, export it there.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/routes/invitation-account-guard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/onboarding/invitation/ apps/user-client/tests/routes/invitation-account-guard.test.tsx
git commit -m "Route the invitation flow through unlock when a local account exists"
```

---

### Task 14: Replace-link confirmation for an already-linked device

**Files:**
- Modify: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx`
- Test: `apps/user-client/tests/routes/invitation-replace-link.test.tsx`

**Interfaces:**
- In the late-link case (`isLateLink === true`), if `getLinkedAccount(getDb())` returns a row, the confirm screen first renders a replace-link acknowledgement naming BOTH servers (`linkedRow.base_url` → `storeCtx.baseUrl`); only after the user confirms does the normal form render. The late-link submit path already runs `resetEngineStateForNewLink()` (Task 6) — that composes: new link, fresh predicate, full backfill (spec §4.4).

- [ ] **Step 1: Write the failing test**

```tsx
describe('replace-link confirmation (spec §4.4, Larissa L-7)', () => {
  it('interposes an acknowledgement naming both servers', async () => {
    // Arrange: unlocked session + linked account row (base_url https://old.example),
    // onboarding store invitation_confirm with baseUrl https://new.example.
    render(routed(<InvitationConfirm />));
    await waitFor(() => expect(screen.getByText(/currently connected to/i)).toBeInTheDocument());
    expect(screen.getByText(/old\.example/)).toBeInTheDocument();
    expect(screen.getByText(/new\.example/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
    // Confirm reveals the normal late-link form:
    await userEvent.click(screen.getByRole('button', { name: /replace/i }));
    expect(await screen.findByLabelText(/passphrase/i)).toBeInTheDocument();
  });

  it('does not interpose for a late-link with no existing link', async () => {
    // linked row absent → straight to the form.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — form renders immediately.

- [ ] **Step 3: Implement**

In `InvitationConfirmInner` (the guarded inner component): add state and a mount-effect reading `getLinkedAccount(getDb())` (import exists at `confirm.tsx:5`); store `existingLink: LinkedAccountRow | null`. Add `const [replaceAcknowledged, setReplaceAcknowledged] = useState(false);`. Before the ready/submitting render, insert:

```tsx
if (isLateLink && existingLink && !replaceAcknowledged) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to={navTarget('/onboarding/invitation')} className="text-2xl text-paper-soft" aria-label="Back">
        ←
      </Link>
      <h1 className="mt-4 font-display text-2xl italic">Replace this device's server?</h1>
      <p className="mt-2 text-sm text-paper-soft">
        This device is currently connected to{' '}
        <span className="font-mono">{existingLink.base_url}</span>. Connecting to{' '}
        <span className="font-mono">{storeCtx.baseUrl}</span> replaces that link and uploads your
        data there instead. Your local data is not touched.
      </p>
      <button
        type="button"
        onClick={() => setReplaceAcknowledged(true)}
        className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        Replace and connect →
      </button>
    </main>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/routes/invitation-replace-link.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/onboarding/invitation/confirm.tsx apps/user-client/tests/routes/invitation-replace-link.test.tsx
git commit -m "Ask before replacing an existing server link"
```

---

### Task 15: The start-over exit at login + PR 2 gates

**Files:**
- Create: `apps/user-client/src/lib/wipe-device.ts`
- Create: `apps/user-client/src/routes/login/start-over.tsx`
- Modify: `apps/user-client/src/routes/login/index.tsx` (add the restrained link)
- Modify: the router registration (find where `/login/recovery` is registered: `rg -n 'login/recovery' apps/user-client/src` — add `/login/start-over` beside it)
- Test: `apps/user-client/tests/routes/start-over.test.tsx`

**Interfaces:**
- `wipeDevice(): Promise<void>` — closes open DB handles, then deletes IndexedDB databases `'chatsundere'` (crypto), `'chatsundere_client_data'` (Dexie client data), `'chatsundere-knowledge-vectors'` (vectors), clears the session store, then `window.location.assign('/onboarding')` (full reload guarantees no stale in-memory state).
- The screen requires typing `start over` exactly; the copy states what is erased and that a synced server account is separate and untouched (spec §4.3).
- The login screen gains a restrained footer link "Start over on this device" → `/login/start-over`.

- [ ] **Step 1: Write the failing test**

```tsx
describe('start-over exit (spec §4.3, Laura U-4)', () => {
  it('demands the typed phrase before enabling the erase button', async () => {
    render(routed(<StartOver />));
    const btn = screen.getByRole('button', { name: /erase and start over/i });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/type/i), 'start over');
    expect(btn).toBeEnabled();
  });

  it('names what is erased and what is not', () => {
    render(routed(<StartOver />));
    expect(screen.getByText(/erases everything on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/server account .* not touched/i)).toBeInTheDocument();
  });

  it('wipes the three databases on confirm', async () => {
    // Stub the wipe seam (export a _setWipeForTests or inject via prop — prefer
    // module seam consistent with the codebase's _set* convention) and assert
    // it is invoked once after typing + click.
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// apps/user-client/src/lib/wipe-device.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';

/**
 * The start-over erase (spec §4.3): the named, constructive exit for the
 * lost-both-keys terminal state. Deletes every local database — the crypto
 * account store, the client data, and the knowledge vectors — then reloads
 * into onboarding. A synced server account is a separate thing and is NOT
 * touched (no server call is made; no token exists in this state anyway).
 */
const DB_NAMES = ['chatsundere', 'chatsundere_client_data', 'chatsundere-knowledge-vectors'];

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best-effort: a failed delete must not strand the reload
    req.onblocked = () => resolve(); // open handles elsewhere — the reload releases them
  });
}

export async function wipeDevice(): Promise<void> {
  useSessionStore.getState().closeAndForget();
  for (const name of DB_NAMES) await deleteDatabase(name);
  window.location.assign('/onboarding');
}
```

Before finalising, check whether `client-data-db.ts` / `open-db.ts` keep open connections that would block deletion — if they expose a `close()` helper, call it before deleting (`rg -n 'close' apps/user-client/src/boot/client-data-db.ts apps/user-client/src/boot/open-db.ts`). `onblocked → resolve` plus the full reload is the backstop either way.

```tsx
// apps/user-client/src/routes/login/start-over.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { wipeDevice } from '../../lib/wipe-device.js';

const CONFIRM_PHRASE = 'start over';

/** Spec §4.3 — the honest exit for the lost-both-keys state. Typed confirmation. */
export function StartOver(): JSX.Element {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const armed = typed.trim().toLowerCase() === CONFIRM_PHRASE;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/login" className="text-2xl text-paper-soft" aria-label="Back">
        ←
      </Link>
      <h1 className="mt-4 font-display text-2xl italic">Start over on this device</h1>
      <p className="mt-2 text-sm text-paper-soft">
        This erases everything on this device — chats, personas, settings, and the local account —
        and starts over. There is no way back without your passphrase or recovery key.
      </p>
      <p className="mt-2 text-sm text-paper-soft">
        A synced server account is separate and is not touched: you can rejoin it later with a new
        invitation and its passphrase.
      </p>
      <label htmlFor="confirm-phrase" className="mt-6 block text-xs font-medium uppercase tracking-wider text-paper-soft">
        Type “{CONFIRM_PHRASE}” to confirm
      </label>
      <input
        id="confirm-phrase"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
      />
      <button
        type="button"
        disabled={!armed || busy}
        onClick={() => {
          setBusy(true);
          void wipeDevice();
        }}
        className="mt-6 w-full rounded-[var(--radius-card)] bg-danger/80 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Erasing…' : 'Erase and start over'}
      </button>
    </main>
  );
}
```

Login link (footer area of `login/index.tsx`, styled like the existing "Forgot passphrase?" link — find it and place beside/below):

```tsx
<Link to="/login/start-over" className="text-xs text-paper-soft underline-offset-2 hover:underline">
  Start over on this device
</Link>
```

Register the route beside `/login/recovery` in the router file.

- [ ] **Step 4: Run tests + PR 2 gates**

Run: `pnpm --filter user-client exec vitest run tests/routes/` → PASS
Run: `pnpm typecheck --force` → 14/14
Run: `pnpm --filter user-client test` → only the 8-test baseline
Run: `cd packages/crypto && bun test` → all pass

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/wipe-device.ts apps/user-client/src/routes/login/ apps/user-client/tests/routes/start-over.test.tsx
git commit -m "Add the start-over exit for the lost-keys terminal state"
```

**PR 2 boundary.**

---

# PR 3 — 401 degrade-to-offline (Tasks 16–18) — stacks on PR 2

### Task 16: Refusal classifier + single-flight refresh + `auth_degraded` state

**Files:**
- Modify: `apps/user-client/src/lib/fetch.ts`
- Modify: `apps/user-client/src/boot/client-data-db.ts` (`SyncAttention` union, ~line 588)
- Create: `apps/user-client/src/lib/auth-degrade.ts`
- Test: `apps/user-client/tests/lib/fetch-refresh.test.ts`

**Interfaces:**
- `SyncAttention` gains `| { kind: 'auth_degraded' }`.
- `lib/auth-degrade.ts` produces: `isAuthDegraded(): boolean`, `setAuthDegraded(v: boolean): Promise<void>` (in-memory flag + persists/clears the `auth_degraded` attention via `setAttention`), `armAuthDegradeFromBoot(): Promise<void>` (reads persisted attention at boot and re-arms the flag).
- `fetch.ts` produces: `type FetchOrigin = 'user' | 'background'`; `ApiFetchOptions.origin?: FetchOrigin` (default `'user'`); `refreshAccessToken(baseUrl: string, origin?: FetchOrigin): Promise<boolean>` — single-flighted; classifier: HTTP 401 **with parsed envelope code `'unauthorized'`** (the auth service's only refusal shape, `token.ts:14,22`) → *refused*; everything else (network throw, 5xx, 429, unparseable body, other 4xx) → *unreachable*. Actions: refused+user → `closeAndForget()`; refused+background → `setAuthDegraded(true)`, no destruction; unreachable+ANY → no destruction. Success → token updated AND `setAuthDegraded(false)` if set.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/user-client/tests/lib/fetch-refresh.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Stub global fetch per test; seed the session store with a session+mk; use the
// existing fetch test file's patterns if one exists (rg -l refreshAccessToken
// apps/user-client/tests/) — extend it instead of duplicating setup.
describe('refreshAccessToken classifier (spec §5.2)', () => {
  it('definitive refusal + background → degrade, session survives', async () => {
    stubFetch(401, { error: { code: 'unauthorized' } });
    const ok = await refreshAccessToken('https://auth.example', 'background');
    expect(ok).toBe(false);
    expect(useSessionStore.getState().session).not.toBeNull(); // NOT destroyed
    expect(isAuthDegraded()).toBe(true);
    expect((await getSyncState()).attention?.kind).toBe('auth_degraded');
  });

  it('definitive refusal + user → logout semantics unchanged', async () => {
    stubFetch(401, { error: { code: 'unauthorized' } });
    await refreshAccessToken('https://auth.example', 'user');
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('unreachable classes destroy nothing for EITHER origin (L-5)', async () => {
    for (const arrange of [
      () => stubFetchThrow(new TypeError('network')),
      () => stubFetch(503, undefined),
      () => stubFetch(429, undefined),
      () => stubFetch(404, '<html>not json</html>'), // misrouted proxy (L-3)
    ]) {
      arrange();
      seedSession();
      await refreshAccessToken('https://auth.example', 'user');
      expect(useSessionStore.getState().session).not.toBeNull();
      await refreshAccessToken('https://auth.example', 'background');
      expect(useSessionStore.getState().session).not.toBeNull();
      expect(isAuthDegraded()).toBe(false);
    }
  });

  it('single-flights concurrent refreshes (L-4)', async () => {
    let calls = 0;
    stubFetchFn(async () => { calls += 1; await tick(); return okResponse(); });
    await Promise.all([
      refreshAccessToken('https://auth.example', 'background'),
      refreshAccessToken('https://auth.example', 'background'),
      refreshAccessToken('https://auth.example', 'user'),
    ]);
    expect(calls).toBe(1);
  });

  it('a successful refresh clears the degraded state', async () => {
    await setAuthDegraded(true);
    stubFetch(200, { access_token: 't', expires_in: 900 });
    await refreshAccessToken('https://auth.example', 'user');
    expect(isAuthDegraded()).toBe(false);
    expect((await getSyncState()).attention).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — signature/behaviour missing.

- [ ] **Step 3: Implement**

`client-data-db.ts`: append to `SyncAttention`:

```ts
| { kind: 'auth_degraded' }
```

```ts
// apps/user-client/src/lib/auth-degrade.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { setAttention, getSyncState } from '../sync/watermark.js';

/**
 * The auth-degraded latch (spec §5.2): set when the auth service DEFINITIVELY
 * refused a token refresh on a background path. While set, the sync engine
 * stays stopped (worker/gate/doorbell consult it synchronously) and the
 * persistent `auth_degraded` attention carries the relink affordance. Local
 * work continues — the server never had authority over the local session.
 */
let degraded = false;

export function isAuthDegraded(): boolean {
  return degraded;
}

export async function setAuthDegraded(value: boolean): Promise<void> {
  degraded = value;
  if (value) {
    await setAttention({ kind: 'auth_degraded' });
  } else {
    const state = await getSyncState();
    if (state.attention?.kind === 'auth_degraded') await setAttention(null);
  }
}

/** Boot re-arm: the attention persists in Dexie; the in-memory latch does not. */
export async function armAuthDegradeFromBoot(): Promise<void> {
  const state = await getSyncState();
  degraded = state.attention?.kind === 'auth_degraded';
}

/** Test seam. */
export function _resetAuthDegradeForTests(): void {
  degraded = false;
}
```

`fetch.ts` — rework `refreshAccessToken`:

```ts
export type FetchOrigin = 'user' | 'background';

/** Thrown to background callers whose refresh was definitively refused (§5.2). */
export class AuthDegradedError extends Error {
  constructor() {
    super('The server no longer recognises this session.');
    this.name = 'AuthDegradedError';
  }
}

type RefreshOutcome = 'ok' | 'refused' | 'unreachable';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * One classification, one flight (spec §5.2, Larissa L-3/L-4/L-5).
 * REFUSED means: HTTP 401 whose parsed error envelope carries the auth
 * service's refusal code 'unauthorized' (apps/auth-service/src/routes/token.ts
 * emits exactly this for a missing/invalid/reused refresh cookie). Anything
 * else — network throw, 5xx, 429, an unparseable body from a misrouted proxy —
 * is UNREACHABLE and destroys nothing: the existing connectivity handling owns
 * it. Refresh tokens rotate on every refresh, so concurrent callers MUST share
 * one flight — the loser of a race would otherwise manufacture a genuine-
 * looking reuse refusal against itself.
 */
async function classifyRefresh(baseUrl: string): Promise<RefreshOutcome> {
  try {
    const url = joinUrl(baseUrl, '/api/v1/token/refresh');
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      const body = (await res.json()) as { access_token: string; expires_in: number };
      useSessionStore.getState().updateAccessToken(body.access_token);
      return 'ok';
    }
    if (res.status === 401) {
      const envelope = await safeReadError(res);
      if (envelope?.code === 'unauthorized') return 'refused';
    }
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Refresh the access token via the HTTP-only refresh cookie. Returns true on
 * success. Only a DEFINITIVE refusal acts (§5.2): user-origin logs out (the
 * user actively hit a dead session), background-origin degrades (the engine
 * stops; the local session is not the server's to destroy). Non-definitive
 * failures destroy nothing for either origin.
 */
export async function refreshAccessToken(
  baseUrl: string,
  origin: FetchOrigin = 'user',
): Promise<boolean> {
  refreshInFlight ??= classifyRefresh(baseUrl).finally(() => {
    refreshInFlight = null;
  });
  const outcome = await refreshInFlight;

  if (outcome === 'ok') {
    if (isAuthDegraded()) await setAuthDegraded(false);
    return true;
  }
  if (outcome === 'refused') {
    if (origin === 'background') {
      await setAuthDegraded(true);
      return false;
    }
    useSessionStore.getState().closeAndForget();
    return false;
  }
  return false; // unreachable: connectivity handling owns this; nothing is destroyed
}
```

Add `origin?: FetchOrigin` to `ApiFetchOptions` (doc comment: "Background callers — the sync engine's transports — mark themselves so a refresh refusal degrades instead of destroying the session (§5.2). Default 'user'.") and thread it at `apiFetch`'s refresh call: `await refreshAccessToken(authBase, opts.origin ?? 'user')`.

Imports: `import { isAuthDegraded, setAuthDegraded } from './auth-degrade.js';` — verify no import cycle (`auth-degrade.ts` imports `sync/watermark.ts` which imports only `boot/client-data-db.ts`; `fetch.ts` gains no cycle).

Check `lib/proxy-auth.ts` (it shares `refreshAccessToken` per `fetch.ts:107`) — its calls keep the default `'user'` origin (LLM sends are user-initiated); confirm nothing breaks with the new signature.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/lib/fetch-refresh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/fetch.ts apps/user-client/src/lib/auth-degrade.ts apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/lib/fetch-refresh.test.ts
git commit -m "Classify refresh refusals, single-flight the refresh, add the degrade latch"
```

---

### Task 17: Background-origin sweep + engine stop + boot re-arm

**Files:**
- Modify: `apps/user-client/src/sync/worker.ts` (`defaultPush`, `defaultPull`, `canRunCycle`)
- Modify: `apps/user-client/src/sync/recovery.ts` (`defaultPull`)
- Modify: `apps/user-client/src/sync/doorbell.ts` (its `apiFetch` ticket call + a degrade check before connect)
- Modify: `apps/user-client/src/sync/blob-transport.ts` (every `apiFetch`/fetch-with-refresh call)
- Modify: `apps/user-client/src/sync/quota-signal.ts` (its `apiFetch` call, if any — verify with `rg -n apiFetch apps/user-client/src/sync/quota-signal.ts`)
- Modify: `apps/user-client/src/sync/gate.ts` (`isClass2Allowed`)
- Modify: `apps/user-client/src/boot/server-foundation.ts` (call `armAuthDegradeFromBoot()`)
- Test: `apps/user-client/tests/sync/auth-degrade-engine.test.ts`

**Interfaces:**
- Every engine transport passes `origin: 'background'`.
- `canRunCycle()` and `isClass2Allowed()` return false while `isAuthDegraded()`.
- The doorbell does not (re)connect while degraded.
- Boot re-arms the latch from the persisted attention BEFORE `initSyncTriggers()` fires the first cycle.

- [ ] **Step 1: Write the failing tests**

```ts
describe('degraded engine stop (spec §5.2)', () => {
  it('canRunCycle is false while degraded — no cycle work happens', async () => {
    await setAuthDegraded(true);
    let drained = false;
    _setPushTransport(async () => { drained = true; throw new Error('unreachable'); });
    // seed one outbox row + full linked/online/unlocked harness
    await runSyncCycle();
    expect(drained).toBe(false);
  });

  it('isClass2Allowed is false while degraded (disable-over-hide upstream)', async () => {
    await setAuthDegraded(true);
    expect(isClass2Allowed()).toBe(false);
  });

  it('boot re-arms the latch from the persisted attention', async () => {
    await setAttention({ kind: 'auth_degraded' });
    _resetAuthDegradeForTests();
    await armAuthDegradeFromBoot();
    expect(isAuthDegraded()).toBe(true);
  });
});
```

Plus one origin-threading test: stub `fetch` to 401 + refusal envelope on the sync push AND on the refresh; run `drainOutbox` with one entry; assert the session survives and `isAuthDegraded()` is true (proves the worker's transport carries `'background'` end-to-end).

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — cycle drains while degraded / origin not threaded.

- [ ] **Step 3: Implement**

Sweep every engine `apiFetch` call (find them: `rg -n 'apiFetch' apps/user-client/src/sync/`) adding `origin: 'background'`:
- `worker.ts` `defaultPush` + `defaultPull`
- `recovery.ts` `defaultPull`
- `doorbell.ts` ticket request
- `blob-transport.ts` all calls (it may use its own refresh wrapper — if it calls `refreshAccessToken` directly, pass `'background'` there)
- `quota-signal.ts` if it fetches

`worker.ts` `canRunCycle` — add:

```ts
if (isAuthDegraded()) return false; // §5.2: a degraded engine sends nothing
```

`gate.ts` `isClass2Allowed` — add the same check in the linked branch:

```ts
return online && unlocked && !isRecovering() && !isAuthDegraded();
```

`doorbell.ts` — add the check where the connect/reconnect decision is made (find the guard that already checks link/online state and extend it).

`server-foundation.ts` — before `initSyncTriggers()`:

```ts
await armAuthDegradeFromBoot();
```

(If the function is not async, follow the file's existing pattern for async boot steps — check how it awaits other initialisation.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter user-client exec vitest run tests/sync/auth-degrade-engine.test.ts` → PASS
Run: `pnpm --filter user-client exec vitest run tests/sync/` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/ apps/user-client/src/boot/server-foundation.ts apps/user-client/tests/sync/auth-degrade-engine.test.ts
git commit -m "Stop the engine while auth-degraded and mark engine transports background"
```

---

### Task 18: Degrade UX — attention copy, relink affordance, clear-on-auth + PR 3 gates

**Files:**
- Modify: `apps/user-client/src/sync/copy.ts` (`syncCopy.attention` + `syncCopy.actions`)
- Modify: `apps/user-client/src/components/SyncStatusLine.tsx` (`attentionView` case)
- Modify: `apps/user-client/src/components/GlobalSyncLine.tsx` (relink action navigation)
- Modify: `apps/user-client/src/routes/login/index.tsx` (clear the latch on successful unlock)
- Test: `apps/user-client/tests/components/auth-degraded-ux.test.tsx`

**Interfaces:**
- Copy (spec §5.2 verbatim): `authDegraded: "This server no longer recognises this device. Your data is safe here — reconnect with a new invitation when you're ready."`; action label `reconnect: 'Reconnect'`.
- `attentionView` gains the `auth_degraded` case returning that text; the ACTION is supplied by the rendering component (it needs the router): both `SyncStatusLine` and `GlobalSyncLine` render a Reconnect button navigating to `/onboarding/invitation`. Implement by letting `attentionView` return `{ text, wantsReconnect: true }` for this kind, and having both components map `wantsReconnect` to a `useNavigate()`-backed action — pure `deriveSyncStatus` stays router-free.
- Login: after a successful unlock (both paths, before navigate) — `if (isAuthDegraded()) void setAuthDegraded(false);` (a fresh login proves the auth path works again; spec §5.2 recovery).

- [ ] **Step 1: Write the failing tests**

```tsx
describe('auth_degraded attention UX (spec §5.2)', () => {
  it('renders the dere copy and a Reconnect action on the global line', async () => {
    // seed syncState { attention: { kind: 'auth_degraded' } }, linked, /app route
    render(withAppRouter(<GlobalSyncLine />));
    await waitFor(() =>
      expect(screen.getByText(/no longer recognises this device/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/your data is safe here/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    // MemoryRouter: assert location is /onboarding/invitation (render a probe route).
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — unknown attention kind (switch falls through / type error).

- [ ] **Step 3: Implement**

`copy.ts`:

```ts
// in attention:
authDegraded:
  "This server no longer recognises this device. Your data is safe here — reconnect with a new invitation when you're ready.",
// in actions:
reconnect: 'Reconnect',
```

`SyncStatusLine.tsx` `attentionView` — new case:

```ts
case 'auth_degraded':
  return { text: syncCopy.attention.authDegraded, wantsReconnect: true };
```

Extend the `attentionView` return type with `wantsReconnect?: boolean`; in BOTH components, after deriving the view, map it:

```ts
const navigate = useNavigate();
const action = view.action ?? (viewWantsReconnect
  ? { label: syncCopy.actions.reconnect, onClick: () => navigate('/onboarding/invitation') }
  : undefined);
```

(Thread `wantsReconnect` through `deriveSyncStatus`'s attention branch onto `StatusView` — add `wantsReconnect?: boolean` to `StatusView` and set it from the attention view. Keep `deriveSyncStatus` pure.)

`login/index.tsx` — in both success paths, before `navigate(returnTarget, …)`:

```ts
if (isAuthDegraded()) void setAuthDegraded(false);
```

- [ ] **Step 4: Run tests + FULL PR 3 gates**

Run: `pnpm --filter user-client exec vitest run tests/components/auth-degraded-ux.test.tsx` → PASS
Run: `pnpm typecheck --force` → 14/14
Run: `pnpm --filter user-client test` → only the 8-test baseline
Run: `cd packages/crypto && bun test` → all pass

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/sync/copy.ts apps/user-client/src/components/ apps/user-client/src/routes/login/index.tsx apps/user-client/tests/components/auth-degraded-ux.test.tsx
git commit -m "Surface the auth-degraded attention with a reconnect affordance"
```

**PR 3 boundary.**

---

### Task 19 (final): Hand-off

- [ ] **Step 1: Re-run ALL gates on the PR 3 branch tip** (rule 5): `pnpm typecheck --force` (14/14, 0 cached), `pnpm --filter user-client test` (exactly the 8-failure baseline), `cd packages/crypto && bun test` (all pass), `pnpm build` (9/9).
- [ ] **Step 2: Write the three PR bodies** per rule 12 — task coverage, verification numbers with the baseline noted, deviations, and the `## For the security audit` section.
- [ ] **Step 3: Report back** (rule 12): the three PR links, combined verification numbers, commit list per branch. Do NOT merge anything. Do NOT touch `master`. Do NOT edit STATUS files. Stop.

---

## Post-plan (Liz, NOT the overnight worker)

- Larissa re-audit of the three built diffs (PR 1: sync boundary + engine reset; PR 2: crypto flow + return-URL validation; PR 3: refusal classifier + single-flight).
- Laura pre-squash (global line, guard screen, start-over exit, replace-link confirm, degrade attention).
- Chris's manual verification: spec §8 (8 steps, incl. the single-account-deletion degrade scenario — NOT a full dev reset).
- STATUS-TRANSITION.md update.
