# Memory Consolidation Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make memory consolidation survive slow/overloaded providers and large backlogs: long-output timeouts, batched self-draining dreaming with per-slice checkpoints, newest-first injection budget, honest error states, cursor honesty at the uncommitted cap, and a mutex on manual actions.

**Architecture:** All changes are client-side inside `apps/user-client` (memory pipeline, assembly, action hook, memory route) plus one timeout constant in the compaction runner. No schema/Dexie change, no server involvement, no `packages/*` change. Spec: `superpowers/specs/2026-07-14-memory-consolidation-robustness-design.md` (Chris-approved, Laura spec-pass folded).

**Tech Stack:** TypeScript strict, React 18, TanStack Query, Dexie (via existing repo layer), Vitest + fake-indexeddb + Testing Library.

## Global Constraints

- Every artefact in British English (code, comments, copy, commit messages). No emojis.
- New files start with `// SPDX-License-Identifier: AGPL-3.0-only`.
- TS `strict: true` + `noUncheckedIndexedAccess: true`; Biome bans the `!` non-null assertion — never use it.
- No comments that restate code; comments only for non-obvious why.
- Work happens on branch `feat/memory-consolidation-robustness` in its own worktree. Subagents never merge, push, or switch branches.
- Test runner: Vitest. Run per-file during tasks; the FULL user-client suite runs at the gate (Task 9). Expected environmental baseline: exactly 8 Node-localStorage failures (a 9th failure is real).
- Copy strings below are Laura-reviewed and Chris-approved — implement them byte-exactly.

---

### Task 1: Long-output timeout constants, threaded into memory + compaction one-shot calls

**Files:**
- Modify: `apps/user-client/src/memory/config.ts`
- Modify: `apps/user-client/src/memory/pipeline.ts` (`callModel` + both call sites)
- Modify: `apps/user-client/src/compaction/config.ts`
- Modify: `apps/user-client/src/compaction/runner.ts` (both `runOneShotCompletion` calls in `summarise`)
- Test: `apps/user-client/tests/memory/pipeline.test.ts`, `apps/user-client/tests/compaction/runner.test.ts`

**Interfaces:**
- Consumes: `runOneShotCompletion`'s existing optional `timeoutMs` option (`packages/llm-unified/src/one-shot-completion.ts` — already implemented, do not touch the package).
- Produces: `EXTRACTION_TIMEOUT_MS = 60_000`, `DREAM_TIMEOUT_MS = 180_000`, `DREAM_BATCH_SIZE = 40` (in `memory/config.ts`); `COMPACTION_TIMEOUT_MS = 180_000` (in `compaction/config.ts`); `callModel(args, systemPrompt, userPrompt, maxTokens, timeoutMs)` — the new 5th parameter is required. `DREAM_BATCH_SIZE` is consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `apps/user-client/tests/memory/pipeline.test.ts`, add to the existing `describe('runMemoryPipeline', …)` (mock + seed helpers already exist in the file):

```ts
it('passes the extraction timeout to the one-shot call', async () => {
  await seedUserMessages(8);
  runOneShotCompletion.mockResolvedValue('[]');
  await runMemoryPipeline(args());
  expect(runOneShotCompletion.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 60_000 });
});
```

In `apps/user-client/tests/compaction/runner.test.ts`, locate the existing mocked `runOneShotCompletion` (same `vi.mock('@chatsundere/llm-unified', …)` pattern) and add a test asserting the summarise call carries the timeout. Follow the file's existing arrange helpers for a minimal compaction run; the assertion core is:

```ts
expect(runOneShotCompletion.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 180_000 });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/pipeline.test.ts tests/compaction/runner.test.ts`
Expected: the two new tests FAIL (`timeoutMs` is `undefined`); all pre-existing tests PASS.

- [ ] **Step 3: Implement**

`apps/user-client/src/memory/config.ts` — append:

```ts
/** One-shot call budgets. Dreaming regenerates a whole body (≤3000 tokens) —
 *  the library's 30 s default is structurally too short for that output size. */
export const EXTRACTION_TIMEOUT_MS = 60_000;
export const DREAM_TIMEOUT_MS = 180_000;
/** Committed entries consolidated per dreaming slice (bounds prompt and drain step). */
export const DREAM_BATCH_SIZE = 40;
```

`apps/user-client/src/memory/pipeline.ts` — extend `callModel` with a required `timeoutMs` parameter and pass it through:

```ts
async function callModel(
  args: MemoryPipelineArgs,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const messages: WireMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  return runOneShotCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    target: offeringToTarget(args.offering),
    messages,
    timeoutMs,
    // Reasoning off: extraction/dreaming need the answer in `content`, not the
    // reasoning channel (see title-generator.ts). Fixed-on models still survive.
    bodyExtras: { temperature: 0.3, max_tokens: maxTokens, reasoning: { enabled: false } },
    onRetry: (e) => console.warn(formatRetryEvent(e)),
  });
}
```

Update the two call sites (imports extend the existing `./config.js` import):
- in `runExtraction`: `callModel(args, system, 'Extract now and return only the JSON array.', 1024, EXTRACTION_TIMEOUT_MS)`
- in `runDreaming`: `callModel(args, system, 'Output only the new memory body text now.', 4096, DREAM_TIMEOUT_MS)`

`apps/user-client/src/compaction/config.ts` — append:

```ts
/** Summariser one-shot timeout — 2000-token outputs outgrow the 30 s library default. */
export const COMPACTION_TIMEOUT_MS = 180_000;
```

`apps/user-client/src/compaction/runner.ts` — add `timeoutMs: COMPACTION_TIMEOUT_MS` to BOTH `runOneShotCompletion` argument objects inside `summarise` (the first call and the retry-with-reminder call), importing `COMPACTION_TIMEOUT_MS` from `./config.js` alongside the existing config imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/pipeline.test.ts tests/compaction/runner.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/config.ts apps/user-client/src/memory/pipeline.ts apps/user-client/src/compaction/config.ts apps/user-client/src/compaction/runner.ts apps/user-client/tests/memory/pipeline.test.ts apps/user-client/tests/compaction/runner.test.ts
git commit -m "Thread long-output timeouts into memory and compaction one-shot calls"
```

---

### Task 2: `archiveCommitted` gains an explicit id-list parameter

**Files:**
- Modify: `apps/user-client/src/memory/repo.ts:98-116`
- Test: `apps/user-client/tests/memory/repo.test.ts`

**Interfaces:**
- Produces: `archiveCommitted(personaId: string, dreamId: string, ids?: string[]): Promise<number>` — with `ids` present, archives only the committed rows whose id is in the list; without it, behaviour is byte-identical to today (archive all committed). Task 3 consumes the 3-arg form.

- [ ] **Step 1: Write the failing test**

In `apps/user-client/tests/memory/repo.test.ts`, follow the file's existing seeding helpers/style and add:

```ts
it('archiveCommitted with an id list archives only those rows', async () => {
  const db = getClientDataDb();
  for (const id of ['a', 'b', 'c']) {
    await db.memoryJournal.add({
      id,
      personaId: 'p1',
      content: `fact ${id}`,
      category: null,
      state: 'committed',
      isCorrection: false,
      createdAt: 1,
      committedAt: 1,
      autoCommitted: true,
      archivedByDreamId: null,
    } as never);
  }
  const n = await archiveCommitted('p1', 'dream-1', ['a', 'b']);
  expect(n).toBe(2);
  expect(await countJournal('p1', 'archived')).toBe(2);
  expect(await countJournal('p1', 'committed')).toBe(1);
  expect((await db.memoryJournal.get('c'))?.state).toBe('committed');
});
```

(Import `archiveCommitted` and `countJournal` from `../../src/memory/repo.js` if not already imported in the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/repo.test.ts`
Expected: new test FAILS (all three rows archived → committed count is 0, not 1).

- [ ] **Step 3: Implement**

In `apps/user-client/src/memory/repo.ts`, change `archiveCommitted`:

```ts
export async function archiveCommitted(
  personaId: string,
  dreamId: string,
  ids?: string[],
): Promise<number> {
  const committed = await listJournal(personaId, 'committed');
  const idSet = ids ? new Set(ids) : null;
  const targets = idSet ? committed.filter((r) => idSet.has(r.id)) : committed;
  if (!targets.length) return 0;
  const db = getClientDataDb();
  // Class-2-by-background-job journal transition (spec §5): offline-defer, same
  // shape as the auto-commit above — coupled to the dream's `memoryBody` save.
  const linked = isClass2Allowed();
  await db.transaction('rw', [db.memoryJournal, db.syncOutbox], async (tx) => {
    for (const r of targets) {
      await db.memoryJournal.update(r.id, {
        state: 'archived',
        archivedByDreamId: dreamId,
      });
      if (linked) enqueueSync(tx, 'memoryJournal', r.id, 'upsert');
    }
  });
  if (linked) scheduleClass1Sync();
  return targets.length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/repo.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/repo.ts apps/user-client/tests/memory/repo.test.ts
git commit -m "Allow archiveCommitted to target an explicit id list"
```

---

### Task 3: Batched, self-draining dreaming with per-slice checkpoints and a typed invalid-output error

**Files:**
- Modify: `apps/user-client/src/memory/pipeline.ts` (`runDreaming`)
- Test: `apps/user-client/tests/memory/pipeline.test.ts`

**Interfaces:**
- Consumes: `DREAM_BATCH_SIZE`, `DREAM_TIMEOUT_MS` (Task 1); `archiveCommitted(personaId, dreamId, ids)` (Task 2).
- Produces: `runDreaming(args, opts?: { force?: boolean; onSlice?: () => void }): Promise<boolean>` — loops over slices of the oldest `DREAM_BATCH_SIZE` committed entries until drained; fires `opts.onSlice` after each slice's archive; throws `MemoryInvalidOutputError` (new exported class in `pipeline.ts`) when a slice's output fails `validateMemoryBody`; returns `true` iff ≥1 body version was written. Tasks 6 and 7 consume `MemoryInvalidOutputError` and `onSlice`.

- [ ] **Step 1: Write the failing tests**

In `apps/user-client/tests/memory/pipeline.test.ts`, add a helper and a new describe block (reuse the file's existing `args` helper and mocks; import `runDreaming` and `MemoryInvalidOutputError` from `../../src/memory/pipeline.js`, and `DREAM_BATCH_SIZE` from `../../src/memory/config.js`):

```ts
async function seedCommitted(n: number): Promise<void> {
  const db = getClientDataDb();
  for (let i = 0; i < n; i++) {
    await db.memoryJournal.add({
      id: `j${String(i).padStart(3, '0')}`,
      personaId: 'p1',
      content: `fact ${i}`,
      category: null,
      state: 'committed',
      isCorrection: false,
      createdAt: i,
      committedAt: i,
      autoCommitted: true,
      archivedByDreamId: null,
    } as never);
  }
}

describe('runDreaming (batched)', () => {
  it('drains a large backlog in DREAM_BATCH_SIZE slices, firing onSlice per slice', async () => {
    await seedCommitted(DREAM_BATCH_SIZE * 2 + 20); // 100 → slices of 40/40/20
    runOneShotCompletion.mockResolvedValue('Consolidated body prose.');
    const onSlice = vi.fn();
    const wrote = await runDreaming(args(), { force: true, onSlice });
    expect(wrote).toBe(true);
    expect(runOneShotCompletion).toHaveBeenCalledTimes(3);
    expect(onSlice).toHaveBeenCalledTimes(3);
    expect(await countJournal('p1', 'committed')).toBe(0);
    expect(await countJournal('p1', 'archived')).toBe(DREAM_BATCH_SIZE * 2 + 20);
  });

  it('consolidates oldest-first: the first slice carries the oldest entries', async () => {
    await seedCommitted(DREAM_BATCH_SIZE + 1);
    runOneShotCompletion.mockResolvedValue('Consolidated body prose.');
    await runDreaming(args(), { force: true });
    const firstSystem = (runOneShotCompletion.mock.calls[0]?.[0] as { messages: { content: string }[] })
      .messages[0]?.content;
    expect(firstSystem).toContain('fact 0');
    expect(firstSystem).not.toContain(`fact ${DREAM_BATCH_SIZE}`);
  });

  it('a mid-drain failure keeps checkpointed slices archived and the remainder committed', async () => {
    await seedCommitted(DREAM_BATCH_SIZE + 10); // 50 → slices of 40/10
    runOneShotCompletion
      .mockResolvedValueOnce('Consolidated body prose.')
      .mockRejectedValueOnce(new Error('upstream exploded'));
    const onSlice = vi.fn();
    await expect(runDreaming(args(), { force: true, onSlice })).rejects.toThrow('upstream exploded');
    expect(onSlice).toHaveBeenCalledTimes(1);
    expect(await countJournal('p1', 'archived')).toBe(DREAM_BATCH_SIZE);
    expect(await countJournal('p1', 'committed')).toBe(10);
    expect((await getCurrentBody('p1'))?.content).toBe('Consolidated body prose.');
  });

  it('throws MemoryInvalidOutputError when the model output fails validation', async () => {
    await seedCommitted(5);
    runOneShotCompletion.mockResolvedValue('   ');
    await expect(runDreaming(args(), { force: true })).rejects.toBeInstanceOf(
      MemoryInvalidOutputError,
    );
    expect(await countJournal('p1', 'committed')).toBe(5);
  });

  it('respects the threshold gate without force', async () => {
    await seedCommitted(DREAM_THRESHOLD - 1);
    expect(await runDreaming(args())).toBe(false);
    expect(runOneShotCompletion).not.toHaveBeenCalled();
  });
});
```

Also update the existing `'auto-commits then dreams once committed entries cross the threshold'` test only if it fails structurally (it should still pass: one slice, full archive).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/pipeline.test.ts`
Expected: the new batched tests FAIL (single-shot dreaming: 1 call instead of 3, `false` return instead of `MemoryInvalidOutputError`, no `onSlice`).

- [ ] **Step 3: Implement**

Replace `runDreaming` in `apps/user-client/src/memory/pipeline.ts` (imports: add `DREAM_BATCH_SIZE`, `DREAM_TIMEOUT_MS` to the config import):

```ts
/** Thrown when a consolidation slice's output fails validateMemoryBody — the
 *  manual path surfaces it as `invalid-output`; the background pipeline logs it. */
export class MemoryInvalidOutputError extends Error {
  constructor() {
    super('memory consolidation output failed validation');
    this.name = 'MemoryInvalidOutputError';
  }
}

/**
 * Consolidate committed entries into new body versions, in slices of the oldest
 * DREAM_BATCH_SIZE entries, looping until the backlog is drained. Each slice is
 * checkpointed (saveBody + archive) before the next starts, so a mid-drain
 * failure loses nothing. Returns true when at least one body was written.
 */
export async function runDreaming(
  args: MemoryPipelineArgs,
  opts: { force?: boolean; onSlice?: () => void } = {},
): Promise<boolean> {
  const committedCount = await countJournal(args.persona.id, 'committed');
  if (committedCount === 0) return false;
  if (!opts.force && committedCount < DREAM_THRESHOLD) return false;

  let wrote = false;
  for (;;) {
    const committed = await listJournal(args.persona.id, 'committed');
    if (!committed.length) break;
    const slice = committed.slice(0, DREAM_BATCH_SIZE);
    const body = await getCurrentBody(args.persona.id);
    const system = buildConsolidationPrompt({
      existingBody: body?.content ?? null,
      entries: slice.map((c) => ({ content: c.content, isCorrection: c.isCorrection })),
      userGuidance: args.persona.memoryInstructions ?? '',
    });
    const raw = await callModel(
      args,
      system,
      'Output only the new memory body text now.',
      4096,
      DREAM_TIMEOUT_MS,
    );
    const newBody = raw.trim();
    if (!validateMemoryBody(newBody, MEMORY_BODY_MAX_TOKENS)) throw new MemoryInvalidOutputError();

    await saveBody(args.persona.id, newBody, slice.length, 'dream');
    await archiveCommitted(
      args.persona.id,
      uuidv7(),
      slice.map((s) => s.id),
    );
    wrote = true;
    opts.onSlice?.();
  }
  return wrote;
}
```

(`listJournal` returns oldest-first — the slice is the oldest entries by construction. The loop terminates because every iteration archives its slice or throws.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/pipeline.test.ts`
Expected: ALL PASS (including the pre-existing dreaming test).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/pipeline.ts apps/user-client/tests/memory/pipeline.test.ts
git commit -m "Batch dreaming into self-draining slices with per-slice checkpoints"
```

---

### Task 4: Cursor honesty at the uncommitted cap

**Files:**
- Modify: `apps/user-client/src/memory/pipeline.ts` (`runExtraction`, the cursor advance at the end)
- Test: `apps/user-client/tests/memory/pipeline.test.ts`

**Interfaces:**
- Consumes: `UNCOMMITTED_CAP` (existing config).
- Produces: no signature change — `runExtraction` no longer advances `lastExtractedMessageId` when extracted entries were dropped for lack of room.

- [ ] **Step 1: Write the failing test**

Add to `tests/memory/pipeline.test.ts` (import `UNCOMMITTED_CAP` from `../../src/memory/config.js` and `runExtraction` from `../../src/memory/pipeline.js`; `seedUserMessages` exists):

```ts
describe('runExtraction cursor honesty', () => {
  it('holds the cursor when the uncommitted cap drops fresh entries', async () => {
    await seedUserMessages(8);
    const db = getClientDataDb();
    for (let i = 0; i < UNCOMMITTED_CAP; i++) {
      await db.memoryJournal.add({
        id: `u${String(i).padStart(3, '0')}`,
        personaId: 'p1',
        content: `existing ${i}`,
        category: null,
        state: 'uncommitted',
        isCorrection: false,
        createdAt: i,
        committedAt: null,
        autoCommitted: false,
        archivedByDreamId: null,
      } as never);
    }
    runOneShotCompletion.mockResolvedValue('[{"content":"Brand new fact"}]');
    const added = await runExtraction(args(), { force: true });
    expect(added).toBe(0);
    expect((await db.chats.get('c1'))?.lastExtractedMessageId ?? null).toBeNull();
    expect(await countJournal('p1', 'uncommitted')).toBe(UNCOMMITTED_CAP);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/pipeline.test.ts`
Expected: FAILS — `lastExtractedMessageId` is `'m007'` (cursor advanced despite the drop).

- [ ] **Step 3: Implement**

In `runExtraction`, replace the tail

```ts
  const room = Math.max(0, UNCOMMITTED_CAP - (await countJournal(args.persona.id, 'uncommitted')));
  const toAdd = fresh.slice(0, room);
  if (toAdd.length) await addJournalEntries(args.persona.id, toAdd);
  if (newCursor) await advanceCursor(args.chat.id, newCursor);
  return toAdd.length;
```

with

```ts
  const room = Math.max(0, UNCOMMITTED_CAP - (await countJournal(args.persona.id, 'uncommitted')));
  const toAdd = fresh.slice(0, room);
  if (toAdd.length) await addJournalEntries(args.persona.id, toAdd);
  if (toAdd.length < fresh.length) {
    // Cursor held: advancing would silently lose the dropped entries forever.
    // A later run re-extracts the window; dedup tolerates the overlap.
    console.warn('[memory] uncommitted cap reached — cursor held for re-extraction');
    return toAdd.length;
  }
  if (newCursor) await advanceCursor(args.chat.id, newCursor);
  return toAdd.length;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/pipeline.test.ts`
Expected: ALL PASS (the existing cursor-advance test still passes — nothing is dropped there).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/pipeline.ts apps/user-client/tests/memory/pipeline.test.ts
git commit -m "Hold the extraction cursor when the uncommitted cap drops entries"
```

---

### Task 5: Newest-first injection budget in `assembleMemoryContext`

**Files:**
- Modify: `apps/user-client/src/memory/assembly.ts`
- Test: `apps/user-client/tests/memory/assembly.test.ts`

**Interfaces:**
- Produces: same signature; selection within each group (committed, then pending) is newest-first, emission order stays chronological. Body-only / all-fits cases remain byte-identical.

- [ ] **Step 1: Write the failing test**

Add to `tests/memory/assembly.test.ts` (match the file's import/describe style):

```ts
describe('newest-first budget selection', () => {
  it('drops the oldest committed lines when the budget is tight, keeping the newest', () => {
    // Each line "- [committed] <item>" costs ~7 tokens; budget for ~2 lines.
    const out = assembleMemoryContext({
      memoryBody: '',
      committed: ['oldest entry text', 'middle entry text', 'newest entry text'],
      uncommitted: [],
      maxTokens: 15,
    });
    expect(out).toContain('newest entry text');
    expect(out).not.toContain('oldest entry text');
  });

  it('emits survivors in chronological order', () => {
    const out = assembleMemoryContext({
      memoryBody: '',
      committed: ['first entry', 'second entry'],
      uncommitted: [],
      maxTokens: 6000,
    });
    const first = out.indexOf('first entry');
    const second = out.indexOf('second entry');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });

  it('pending entries also keep newest under a tight budget', () => {
    const out = assembleMemoryContext({
      memoryBody: '',
      committed: [],
      uncommitted: ['old pending entry', 'new pending entry'],
      maxTokens: 8,
    });
    expect(out).toContain('new pending entry');
    expect(out).not.toContain('old pending entry');
  });
});
```

(Calibrate `maxTokens` values against `estimateTokens` = `ceil(length / 4)` if a boundary is off by one — the assertion intent is fixed: newest survives, oldest drops.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/assembly.test.ts`
Expected: the tight-budget tests FAIL (oldest currently survives); the chronological test passes.

- [ ] **Step 3: Implement**

In `assembly.ts`, replace the `push` helper:

```ts
  const journalLines: string[] = [];
  // Select newest-first so a large backlog degrades to "oldest out of context",
  // never "yesterday forgotten"; emit survivors in chronological reading order.
  const push = (marker: string, items: string[]): void => {
    const kept: string[] = [];
    for (const item of [...items].reverse()) {
      const line = `- [${marker}] ${item}`;
      const cost = estimateTokens(line);
      if (cost <= remaining) {
        remaining -= cost;
        kept.unshift(line);
      }
    }
    journalLines.push(...kept);
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/assembly.test.ts`
Expected: ALL PASS (pre-existing assembly tests included).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/assembly.ts apps/user-client/tests/memory/assembly.test.ts
git commit -m "Fill the memory injection budget newest-first"
```

---

### Task 6: Pure error classifier `classify-error.ts`

**Files:**
- Create: `apps/user-client/src/memory/classify-error.ts`
- Test: `apps/user-client/tests/memory/classify-error.test.ts` (new)

**Interfaces:**
- Consumes: `MemoryInvalidOutputError` (Task 3, from `./pipeline.js`).
- Produces: `type MemoryActionError = 'no-credentials' | 'timeout' | 'upstream-busy' | 'invalid-output' | 'failed'` and `classifyMemoryActionError(e: unknown): MemoryActionError`. Task 7 consumes both.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/memory/classify-error.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyMemoryActionError } from '../../src/memory/classify-error.js';
import { MemoryInvalidOutputError } from '../../src/memory/pipeline.js';

function statusError(status: number): Error & { status: number } {
  const e = new Error(`one-shot upstream returned ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

describe('classifyMemoryActionError', () => {
  it.each([
    [new Error('memory-learn: master key unavailable — re-authenticate'), 'no-credentials'],
    [new MemoryInvalidOutputError(), 'invalid-output'],
    [new DOMException('The operation timed out.', 'TimeoutError'), 'timeout'],
    [new DOMException('Aborted', 'AbortError'), 'timeout'],
    [statusError(429), 'upstream-busy'],
    [statusError(500), 'upstream-busy'],
    [statusError(503), 'upstream-busy'],
    [statusError(400), 'failed'],
    [new Error('anything else'), 'failed'],
    ['not even an error', 'failed'],
  ])('classifies %s as %s', (input, expected) => {
    expect(classifyMemoryActionError(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/classify-error.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/user-client/src/memory/classify-error.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { MemoryInvalidOutputError } from './pipeline.js';

export type MemoryActionError =
  | 'no-credentials'
  | 'timeout'
  | 'upstream-busy'
  | 'invalid-output'
  | 'failed';

const BUSY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** Map a memory-action failure to an honest, user-facing error code. Both
 *  timeout-signal shapes (TimeoutError, the pre-flight AbortError) mean the
 *  overall time budget ran out — there is no user-initiated abort on this path. */
export function classifyMemoryActionError(e: unknown): MemoryActionError {
  if (e instanceof Error && e.message.includes('master key')) return 'no-credentials';
  if (e instanceof MemoryInvalidOutputError) return 'invalid-output';
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError'))
    return 'timeout';
  const status = (e as { status?: unknown }).status;
  if (typeof status === 'number' && BUSY_STATUSES.has(status)) return 'upstream-busy';
  return 'failed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/memory/classify-error.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/classify-error.ts apps/user-client/tests/memory/classify-error.test.ts
git commit -m "Add pure classifier for memory action errors"
```

---

### Task 7: `useMemoryActions` — mutex + busy toast, classification, per-slice and error-path invalidation, partial-progress counting

**Files:**
- Modify: `apps/user-client/src/lib/use-memory-actions.ts` (full rework of `run`)
- Test: `apps/user-client/tests/lib/use-memory-actions.test.tsx`

**Interfaces:**
- Consumes: `classifyMemoryActionError` + `MemoryActionError` (Task 6); `runDreaming` `onSlice` option (Task 3); `tryAcquireMemoryLock`/`releaseMemoryLock` (`../memory/mutex.js`); `toastStore` (`../state/toast.store.js`); `QK.memory`, `QK.unextractedCount`.
- Produces (Task 8 consumes exactly this):

```ts
export interface MemoryActionState {
  status: 'idle' | 'pending' | 'error';
  error?: MemoryActionError;
  /** Consolidation slices checkpointed before a failure (partial progress). */
  partialSlices?: number;
}
export function useMemoryActions(chatId: string): {
  learnState: MemoryActionState;
  consolidateState: MemoryActionState;
  learnNow: () => Promise<void>;
  consolidateNow: () => Promise<void>;
  /** The action the user most recently triggered — pins error-slot precedence. */
  lastAttempted: 'learn' | 'consolidate' | null;
};
```

- [ ] **Step 1: Write the failing tests**

Extend `tests/lib/use-memory-actions.test.tsx`. Add mocks for the mutex and toast modules next to the existing ones, and make the queryClient mock inspectable:

```ts
const tryAcquireMemoryLock = vi.fn();
const releaseMemoryLock = vi.fn();
vi.mock('../../src/memory/mutex.js', () => ({
  tryAcquireMemoryLock: (...a: unknown[]) => tryAcquireMemoryLock(...a),
  releaseMemoryLock: (...a: unknown[]) => releaseMemoryLock(...a),
}));
const toastShow = vi.fn();
vi.mock('../../src/state/toast.store.js', () => ({ toastStore: { show: (...a: unknown[]) => toastShow(...a) } }));
const invalidateQueries = vi.fn();
vi.mock('../../src/lib/queryClient.js', () => ({ queryClient: { invalidateQueries: (...a: unknown[]) => invalidateQueries(...a) } }));
```

New tests (keep the two existing ones; the resolution-failure one now also asserts the code):

```ts
it('shows the busy toast and stays idle when the mutex is held', async () => {
  resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
  tryAcquireMemoryLock.mockReturnValue(false);
  const { result } = renderHook(() => useMemoryActions('c1'));
  await act(async () => {
    await result.current.consolidateNow();
  });
  expect(toastShow).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Already working on this — give it a moment.' }),
  );
  expect(runDreaming).not.toHaveBeenCalled();
  expect(result.current.consolidateState.status).toBe('idle');
});

it('acquires and releases the mutex around a successful consolidate', async () => {
  resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
  tryAcquireMemoryLock.mockReturnValue(true);
  runDreaming.mockResolvedValue(true);
  const { result } = renderHook(() => useMemoryActions('c1'));
  await act(async () => {
    await result.current.consolidateNow();
  });
  expect(tryAcquireMemoryLock).toHaveBeenCalledWith('p1');
  expect(releaseMemoryLock).toHaveBeenCalledWith('p1');
});

it('invalidates the memory queries per slice via onSlice', async () => {
  resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
  tryAcquireMemoryLock.mockReturnValue(true);
  runDreaming.mockImplementation(async (_a: unknown, opts: { onSlice?: () => void }) => {
    opts.onSlice?.();
    opts.onSlice?.();
    return true;
  });
  const { result } = renderHook(() => useMemoryActions('c1'));
  await act(async () => {
    await result.current.consolidateNow();
  });
  const memoryInvalidations = invalidateQueries.mock.calls.filter(
    (c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['memory', 'p1'] }),
  );
  expect(memoryInvalidations.length).toBeGreaterThanOrEqual(2);
});

it('classifies the failure, counts partial slices, and still invalidates on error', async () => {
  resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
  tryAcquireMemoryLock.mockReturnValue(true);
  runDreaming.mockImplementation(async (_a: unknown, opts: { onSlice?: () => void }) => {
    opts.onSlice?.();
    throw new DOMException('The operation timed out.', 'TimeoutError');
  });
  const { result } = renderHook(() => useMemoryActions('c1'));
  await act(async () => {
    await result.current.consolidateNow();
  });
  await waitFor(() => expect(result.current.consolidateState.status).toBe('error'));
  expect(result.current.consolidateState.error).toBe('timeout');
  expect(result.current.consolidateState.partialSlices).toBe(1);
  expect(releaseMemoryLock).toHaveBeenCalledWith('p1');
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['memory', 'p1'] });
});

it('records lastAttempted for error-slot precedence', async () => {
  resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
  tryAcquireMemoryLock.mockReturnValue(true);
  runExtraction.mockResolvedValue(1);
  const { result } = renderHook(() => useMemoryActions('c1'));
  expect(result.current.lastAttempted).toBeNull();
  await act(async () => {
    await result.current.learnNow();
  });
  expect(result.current.lastAttempted).toBe('learn');
});
```

Also adjust the pre-existing success test: `tryAcquireMemoryLock.mockReturnValue(true)` in an `beforeEach`-style arrange or per test (the existing tests will otherwise fail on an undefined mock return).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/use-memory-actions.test.tsx`
Expected: new tests FAIL (no mutex/toast/lastAttempted yet).

- [ ] **Step 3: Implement**

Rewrite `apps/user-client/src/lib/use-memory-actions.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';
import { QK } from '../data/queryKeys.js';
import { type MemoryActionError, classifyMemoryActionError } from '../memory/classify-error.js';
import { releaseMemoryLock, tryAcquireMemoryLock } from '../memory/mutex.js';
import { runDreaming, runExtraction } from '../memory/pipeline.js';
import { resolveMemoryPipelineArgs } from '../memory/resolve-args.js';
import { toastStore } from '../state/toast.store.js';
import { queryClient } from './queryClient.js';

export interface MemoryActionState {
  status: 'idle' | 'pending' | 'error';
  error?: MemoryActionError;
  /** Consolidation slices checkpointed before a failure (partial progress). */
  partialSlices?: number;
}

const IDLE: MemoryActionState = { status: 'idle' };

/** On-demand "learn from this chat" / "consolidate now" actions for the memory
 *  page. Resolves credentials lazily on click; never on render. Takes the same
 *  per-persona mutex as the background pipeline so the two never interleave. */
export function useMemoryActions(chatId: string): {
  learnState: MemoryActionState;
  consolidateState: MemoryActionState;
  learnNow: () => Promise<void>;
  consolidateNow: () => Promise<void>;
  lastAttempted: 'learn' | 'consolidate' | null;
} {
  const [learnState, setLearnState] = useState<MemoryActionState>(IDLE);
  const [consolidateState, setConsolidateState] = useState<MemoryActionState>(IDLE);
  const [lastAttempted, setLastAttempted] = useState<'learn' | 'consolidate' | null>(null);

  const run = useCallback(
    async (
      kind: 'learn' | 'consolidate',
      setState: (s: MemoryActionState) => void,
    ): Promise<void> => {
      setLastAttempted(kind);
      let personaId: string | null = null;
      let slices = 0;
      try {
        const args = await resolveMemoryPipelineArgs(chatId, `memory-${kind}`);
        personaId = args.persona.id;
        if (!tryAcquireMemoryLock(personaId)) {
          toastStore.show({
            message: 'Already working on this — give it a moment.',
            tone: 'info',
            durationMs: 4000,
          });
          return;
        }
        setState({ status: 'pending' });
        try {
          if (kind === 'learn') {
            await runExtraction(args, { force: true });
          } else {
            const id = personaId;
            await runDreaming(args, {
              force: true,
              onSlice: () => {
                slices += 1;
                void queryClient.invalidateQueries({ queryKey: QK.memory(id) });
              },
            });
          }
          setState(IDLE);
        } finally {
          releaseMemoryLock(personaId);
        }
      } catch (e) {
        setState({ status: 'error', error: classifyMemoryActionError(e), partialSlices: slices });
      } finally {
        // Error paths must refresh too: a mid-drain failure has already archived
        // slices, and the committed list must show the true remainder (Laura HARD-1).
        if (personaId) void queryClient.invalidateQueries({ queryKey: QK.memory(personaId) });
        void queryClient.invalidateQueries({ queryKey: QK.unextractedCount(chatId) });
      }
    },
    [chatId],
  );

  const learnNow = useCallback(() => run('learn', setLearnState), [run]);
  const consolidateNow = useCallback(() => run('consolidate', setConsolidateState), [run]);

  return { learnState, consolidateState, learnNow, consolidateNow, lastAttempted };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/use-memory-actions.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/use-memory-actions.ts apps/user-client/tests/lib/use-memory-actions.test.tsx
git commit -m "Guard manual memory actions with the mutex and surface honest progress"
```

---

### Task 8: Memory page — error copy map, precedence pin, partial-progress copy, pending sub-line

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx` (the chat-actions block, currently lines ~284-326)
- Test: `apps/user-client/tests/routes/persona-memory.test.tsx`

**Interfaces:**
- Consumes: the Task-7 hook shape (`lastAttempted`, `MemoryActionState.partialSlices`, `MemoryActionError`).
- Produces: user-facing copy — implement these strings byte-exactly:
  - `no-credentials`: `Credentials unavailable — re-authenticate, then retry.`
  - `timeout`: `The model took too long to answer. Nothing was lost — it may be busy; try again in a little while.`
  - `upstream-busy`: `Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes.`
  - `invalid-output`: `The model's answer couldn't be used. Nothing was lost — retrying usually helps.`
  - `failed`: `That didn't work — but nothing was lost. Try again.`
  - partial (≥1 slice, any code except `no-credentials`): `Consolidated some of them — the rest are still below. Try again to finish.`
  - pending sub-line: `This can take a minute or two for a large memory — you can leave this page; it keeps going.`

- [ ] **Step 1: Write the failing tests**

In `tests/routes/persona-memory.test.tsx`, follow the file's existing mock arrangement for `useMemoryActions` (it is already mocked there for the button-state tests — extend the mock's return value with `lastAttempted`). Add:

```ts
it('renders the timeout copy for a consolidate timeout', () => {
  mockMemoryActions({
    consolidateState: { status: 'error', error: 'timeout', partialSlices: 0 },
    lastAttempted: 'consolidate',
  });
  renderPage({ chat: 'c1' });
  expect(
    screen.getByText(
      'The model took too long to answer. Nothing was lost — it may be busy; try again in a little while.',
    ),
  ).toBeInTheDocument();
});

it('renders the partial-progress copy when slices were checkpointed', () => {
  mockMemoryActions({
    consolidateState: { status: 'error', error: 'timeout', partialSlices: 2 },
    lastAttempted: 'consolidate',
  });
  renderPage({ chat: 'c1' });
  expect(
    screen.getByText('Consolidated some of them — the rest are still below. Try again to finish.'),
  ).toBeInTheDocument();
});

it('error slot and Retry follow the most recently attempted action', async () => {
  const learnNow = vi.fn();
  const consolidateNow = vi.fn();
  mockMemoryActions({
    learnState: { status: 'error', error: 'failed' },
    consolidateState: { status: 'error', error: 'upstream-busy' },
    lastAttempted: 'consolidate',
    learnNow,
    consolidateNow,
  });
  renderPage({ chat: 'c1' });
  expect(
    screen.getByText(
      'Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes.',
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(consolidateNow).toHaveBeenCalled();
  expect(learnNow).not.toHaveBeenCalled();
});

it('shows the long-run sub-line while consolidating', () => {
  mockMemoryActions({ consolidateState: { status: 'pending' }, lastAttempted: 'consolidate' });
  renderPage({ chat: 'c1' });
  expect(
    screen.getByText(
      'This can take a minute or two for a large memory — you can leave this page; it keeps going.',
    ),
  ).toBeInTheDocument();
});
```

(`mockMemoryActions` / `renderPage` refer to the file's existing helpers — reuse their actual names; if the file inlines the mock per test, inline these the same way. Defaults for unspecified fields: idle states, `vi.fn()` actions, `lastAttempted: null`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/persona-memory.test.tsx`
Expected: new tests FAIL (old copy / no sub-line / learn-first precedence).

- [ ] **Step 3: Implement**

In `persona-memory.tsx`:

Destructure the new hook field: `const { learnState, consolidateState, learnNow, consolidateNow, lastAttempted } = useMemoryActions(chatId);`

Add above the component (module scope):

```tsx
const ERROR_COPY: Record<MemoryActionError, string> = {
  'no-credentials': 'Credentials unavailable — re-authenticate, then retry.',
  timeout:
    'The model took too long to answer. Nothing was lost — it may be busy; try again in a little while.',
  'upstream-busy':
    'Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes.',
  'invalid-output': "The model's answer couldn't be used. Nothing was lost — retrying usually helps.",
  failed: "That didn't work — but nothing was lost. Try again.",
};

function memoryErrorCopy(state: MemoryActionState): string {
  if ((state.partialSlices ?? 0) > 0 && state.error !== 'no-credentials')
    return 'Consolidated some of them — the rest are still below. Try again to finish.';
  return ERROR_COPY[state.error ?? 'failed'];
}
```

(Import `MemoryActionState` and `MemoryActionError`: `import type { MemoryActionState } from '../../lib/use-memory-actions.js';` and `import type { MemoryActionError } from '../../memory/classify-error.js';`.)

Replace the error slot block (the `learnState.status === 'error' || consolidateState.status === 'error' ? … : null` branch) with a precedence-pinned version, and add the pending sub-line after the two buttons:

```tsx
{learnState.status === 'pending' || consolidateState.status === 'pending' ? (
  <p className="text-[11px] text-paper-soft">
    This can take a minute or two for a large memory — you can leave this page; it keeps
    going.
  </p>
) : null}
{(() => {
  // The slot shows the most-recently-attempted action's error, and Retry fires
  // that same action — copy and button can never refer to different actions.
  const candidates =
    lastAttempted === 'consolidate'
      ? ([
          [consolidateState, consolidateNow],
          [learnState, learnNow],
        ] as const)
      : ([
          [learnState, learnNow],
          [consolidateState, consolidateNow],
        ] as const);
  const active = candidates.find(([s]) => s.status === 'error');
  if (!active) return null;
  const [state, retry] = active;
  return (
    <div className="memory-page-action-error" role="alert">
      <span>{memoryErrorCopy(state)}</span>
      <button type="button" onClick={() => void retry()}>
        Retry
      </button>
    </div>
  );
})()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/routes/persona-memory.test.tsx`
Expected: ALL PASS. Pre-existing error-copy tests in this file that assert the old `"That didn't work."` string must be updated to the new `failed` copy — update them, do not delete them.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-memory.tsx apps/user-client/tests/routes/persona-memory.test.tsx
git commit -m "Render honest memory-action errors with precedence and progress copy"
```

---

### Task 9: Full gates

**Files:** none new — verification only.

- [ ] **Step 1: Typecheck (uncached)**

Run from the worktree root: `pnpm typecheck --force`
Expected: 14/14 green, 0 cached.

- [ ] **Step 2: Full user-client suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: pass with exactly the 8-failure Node-localStorage environmental baseline (a 9th failure is a real regression — investigate, do not wave through).

- [ ] **Step 3: Build**

Run: `pnpm run build`
Expected: 9/9 green.

- [ ] **Step 4: Biome on changed files**

Run: `pnpm exec biome check apps/user-client/src/memory apps/user-client/src/lib/use-memory-actions.ts apps/user-client/src/routes/app/persona-memory.tsx apps/user-client/src/compaction`
Expected: clean.

- [ ] **Step 5: Report**

No commit — report gate results back to Liz for the pre-squash review (Laura pre-squash pass, then squash; not a Larissa path).

---

## Manual verification (Chris, on device — from spec §7)

1. Seed a persona with a large committed backlog, model via nano-gpt → "Consolidate now" → committed count ticks down per slice while pending; section empties, body updates, no error; the pending sub-line is visible during the drain.
2. Kill the network mid-drain → error names the provider problem; the committed list immediately shows the true remainder; Retry continues from there.
3. In a chat, verify recent memories survive in context when the backlog exceeds the injection budget.
4. Trigger a compaction on a slow model → no 30 s abort.
5. "Learn from this chat" while a background pipeline runs → calm busy toast, no duplicate entries.
