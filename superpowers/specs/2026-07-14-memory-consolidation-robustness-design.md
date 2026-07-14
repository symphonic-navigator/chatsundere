# Memory Consolidation Robustness — Design Spec

**Date:** 2026-07-14
**Author:** Liz
**Status:** Approved by Chris (2026-07-14). Laura spec-pass folded (2 HARD, 4 soft —
incl. the partial-aware error copy); the `no-credentials`→step-up reachability soft
is logged in `obsidian/insights/follow-ups-index.md`, not this unit.
**Trigger:** Field report from Sara & Soren (v0.1.4): "Consolidate now" fails persistently
with "That didn't work. Retry.", producing a ~24 h memory gap across sessions.

## 1. Problem

The memory consolidation ("dreaming") step regenerates the persona's whole memory body
(up to `MEMORY_BODY_MAX_TOKENS` = 3000 tokens) in a single non-streaming one-shot call.
Four compounding defects turn a slow provider into a permanent, self-worsening failure:

1. **The 30 s one-shot wall.** `runOneShotCompletion` defaults to a 30 000 ms overall
   timeout covering all retry attempts (`packages/llm-unified/src/one-shot-completion.ts:11`).
   The memory pipeline's `callModel` never overrides it (`apps/user-client/src/memory/pipeline.ts:48`).
   A mature body needs ~60 s+ of generation on a healthy provider and far more on an
   overloaded one (Sara's upstream is nano-gpt). Once the body matures, consolidation
   times out deterministically — "Retry" can never succeed.
2. **Unbounded committed backlog.** `runDreaming` feeds **all** committed journal entries
   into one prompt and archives them only on success. Every failure grows the next
   prompt, making the next attempt slower still — a death spiral with no self-healing.
3. **Injection drops the newest memories first.** `assembleMemoryContext` fills its
   6000-token budget with committed entries **oldest-first**, so when the backlog
   outgrows the budget, exactly the most recent memories (yesterday's) vanish from the
   chat context. The data is all present locally; the model just never sees it. This is
   the user-visible "memory gap".
4. **Dishonest error surface.** Every failure collapses to "That didn't work. Retry." —
   a lie in the deterministic-timeout state, and no help distinguishing a busy provider
   from a genuine defect. A consolidation whose output fails validation returns `false`
   silently: the manual button reports nothing at all.

Two adjacent latent defects found during the same investigation:

5. **Silent extraction loss at the uncommitted cap.** When the uncommitted journal is at
   `UNCOMMITTED_CAP`, `runExtraction` drops freshly extracted entries **but still
   advances the extraction cursor** (`pipeline.ts:106-109`) — those messages are never
   extractable again.
6. **Compaction shares the 30 s wall.** `compaction/runner.ts` generates up to
   `COMPACTION_MAX_OUTPUT_TOKENS` = 2000 tokens under the same default timeout.

## 2. Goals

- A saturated consolidation backlog drains itself; consolidation succeeds on providers
  as slow as a congested nano-gpt.
- A backlog degrades to "oldest memories temporarily out of context", never
  "yesterday forgotten".
- Failures tell the user what actually happened and what to do next (constructive
  error handling), with inputs and data always preserved.
- No schema/Dexie change; no server involvement (client-only unit).

## 3. Non-goals

- No per-model tokeniser, no backlog badge/counter UI, no title-generator changes
  (its output is tiny; 30 s is fine).
- No change to extraction thresholds (`EXTRACTION_MIN_NEW_MESSAGES` stays 6).
- No automatic background retry loop beyond the existing post-send pipeline cadence.

## 4. Design

### 4.A Long-output one-shot timeouts

New constants in `memory/config.ts` and `compaction/config.ts`, passed as `timeoutMs`:

| Call | Output budget | New timeout |
|---|---|---|
| Dreaming (`runDreaming`) | 4096 tokens | `DREAM_TIMEOUT_MS` = 180 000 |
| Extraction (`runExtraction`) | 1024 tokens | `EXTRACTION_TIMEOUT_MS` = 60 000 |
| Compaction (`summarise`) | 2000 tokens | `COMPACTION_TIMEOUT_MS` = 180 000 |

Rationale: a 3000-token body at a pessimistic 25 tok/s is 120 s; 180 s adds headroom
without letting a background job hang half an hour. The manual button already shows a
pending state ("Consolidating…") for the whole duration.

### 4.B Batched dreaming (self-draining backlog)

`runDreaming` consolidates in **slices of the oldest `DREAM_BATCH_SIZE` = 40 committed
entries**, looping until the backlog is drained:

```
while committed remain (and first iteration passed the threshold/force gate):
  slice   = oldest 40 committed
  newBody = consolidate(currentBody, slice)     ← one model call
  saveBody(newBody, slice.length, 'dream')      ← durable checkpoint
  archiveCommitted(slice)                        ← exactly these 40, by id
```

- **Crash/failure safety:** each slice archives only after its body version is saved.
  A mid-drain failure loses nothing — consolidated slices stay consolidated, the rest
  remain committed and visible. The loop aborts on the first failure and rethrows.
- **Visible progress (Laura HARD-1):** `runDreaming` accepts an optional `onSlice`
  callback fired after each slice's archive; `useMemoryActions` uses it to invalidate
  `QK.memory(personaId)` per slice, **and additionally invalidates on the error path**
  (today only the success path invalidates). The committed list therefore ticks down
  live during a drain and shows the true remainder after a mid-drain failure — the
  reassurance §4.B relies on is rendered, not merely true in the database.
- `archiveCommitted` gains an optional explicit id-list parameter (archive-all remains
  the default behaviour for compatibility).
- **Accepted trade-off:** draining a huge backlog writes one body version per slice;
  with `MAX_BODY_VERSIONS` = 5 a >5-slice drain prunes pre-drain history. Bumping the
  cap is deliberately not done (storage-versus-history call for Chris to overrule).
- Input maths: 40 entries ≈ ≤2000 tokens + body ≤3000 + instructions — comfortably
  inside every curated model's context window, which also removes defect 5's
  "prompt outgrows the context window" hard wall.

### 4.C Newest-first injection budget

`assembleMemoryContext` keeps its structure (body first, then `<journal>` with
committed before pending) but **selects entries for inclusion newest-first within each
group**, then emits the survivors in chronological order (stable reading order for the
model). When the budget runs out, the oldest journal lines drop first.

### 4.D Honest, constructive error states

`MemoryActionState.error` widens from `'no-credentials' | 'failed'` to:

| Code | Detection | Copy (draft — Laura reviews) |
|---|---|---|
| `no-credentials` | message contains "master key" | (unchanged) "Credentials unavailable — re-authenticate, then retry." |
| `timeout` | `TimeoutError`/`AbortError` from the timeout signal | "The model took too long to answer. Nothing was lost — it may be busy; try again in a little while." |
| `upstream-busy` | `err.status` ∈ {429, 500, 502, 503, 504} | "Your AI provider is having trouble right now. Nothing was lost — try again in a few minutes." |
| `invalid-output` | typed error from 4.F | "The model's answer couldn't be used. Nothing was lost — retrying usually helps." |
| `failed` | everything else | "That didn't work — but nothing was lost. Try again." *(Laura soft: keeps the reassurance floor the other four set)* |

Classification lives in a small pure helper (`memory/classify-error.ts`) shared by both
actions; the existing single error slot + Retry button layout is kept, with one pin
(Laura soft, folded): **the slot shows the most-recently-attempted action's error and
Retry targets that same action**, so copy and Retry can never refer to different
actions when both carry residual errors.

While an action is pending, a quiet sub-line under the buttons sets expectations for
the possibly-minutes-long drain (Laura soft, folded): "This can take a minute or two
for a large memory — you can leave this page; it keeps going." (Honest because §4.B
checkpoints per slice, so re-entry shows the drained state.)

**Partial-progress copy (Laura soft, Chris-approved):** when a consolidate drain fails
after ≥1 successful slice (the hook counts `onSlice` firings), the error slot shows
"Consolidated some of them — the rest are still below. Try again to finish." instead
of the classified copy (`no-credentials` keeps its own copy — a credential problem
must not be masked). A zero-slice failure shows the classified copy unchanged.

### 4.E Cursor honesty at the uncommitted cap

`runExtraction` advances `lastExtractedMessageId` **only when no freshly extracted
entry was dropped for lack of room** (`toAdd.length === fresh.length`). When entries
are dropped, the cursor stays put (a later run re-extracts; dedup tolerates the
overlap) and a `console.warn('[memory] uncommitted cap reached …')` records it.

### 4.F Validation failure surfaces as an error

`runDreaming` throws a typed `MemoryInvalidOutputError` when the model's output fails
`validateMemoryBody`, instead of returning `false`. The background pipeline's existing
catch-and-log absorbs it; the manual path maps it to `invalid-output` (4.D). `false`
remains the return only for the genuine "nothing to do" gates.

### 4.G Manual actions take the per-persona memory mutex

`learnNow`/`consolidateNow` currently bypass `tryAcquireMemoryLock`, so a manual
consolidation can interleave with the post-send background pipeline (double-dreaming,
duplicate bodies). Manual actions now acquire the same mutex; when it is busy they
surface a calm non-error notice rather than failing.

**Surface (Laura HARD-2):** the busy notice is a transient toast via the already-wired
`toastStore` — "Already working on this — give it a moment." (`tone: 'info'`). No new
`MemoryActionState` status; the action returns to `idle`. A toast fits the
transient-ops principle: the notice is ephemeral, not a navigable state, and a bare
return-to-idle would otherwise be an invisible dead interaction.

## 5. Touched files (expected)

- `apps/user-client/src/memory/config.ts` — new constants
- `apps/user-client/src/memory/pipeline.ts` — 4.A, 4.B, 4.E, 4.F
- `apps/user-client/src/memory/repo.ts` — `archiveCommitted` id-list parameter
- `apps/user-client/src/memory/assembly.ts` — 4.C
- `apps/user-client/src/memory/classify-error.ts` — new (4.D)
- `apps/user-client/src/lib/use-memory-actions.ts` — 4.D, 4.G, per-slice + error-path
  invalidation (4.B/HARD-1), busy toast (HARD-2)
- `apps/user-client/src/routes/app/persona-memory.tsx` — error copy rendering, error
  precedence pin, pending sub-line
- `apps/user-client/src/compaction/config.ts` + `runner.ts` — 4.A
- Tests alongside each (Vitest)

Not a Larissa path (client-only; no crypto/auth/sync/proxy-service change).
**Laura spec-pass done (2026-07-14): 2 HARD (both folded above — per-slice/error-path
invalidation; busy toast surface), 5 soft (three folded: `failed` reassurance copy,
error-slot precedence pin, pending sub-line; two open for Chris — the partial-aware
error variant "Consolidated some of them — the rest are still below. Try again to
finish.", and a glance at whether `no-credentials` Retry can reach step-up).**

## 6. Testing

- Batching: slice maths, per-slice archive coupling, mid-drain failure leaves
  consolidated slices archived + remainder committed, threshold/force gates unchanged.
- Assembly: newest-first selection, chronological emission, budget exhaustion drops
  oldest, body-only and empty cases byte-identical.
- Error classification: one table-driven test per code.
- Cursor: dropped-entry case does not advance; clean case advances as before.
- Mutex: manual action under a held lock shows the busy toast, does not run, and
  returns to idle.
- Invalidation: `onSlice` fires per slice; the error path invalidates the memory
  queries (assert on the query client, structurally).
- Existing memory/compaction suites stay green (structural assertions, no
  phrase-matching beyond the copy the UI actually renders).

## 7. Manual verification (Chris, on device)

1. Seed a persona with a large committed backlog (dev console helper or repeated
   chatting), model via nano-gpt → "Consolidate now" → the committed count ticks down
   per slice while pending; section empties, body updates, no error; the pending
   sub-line is visible during the drain.
2. Kill the network mid-drain → error names the provider problem; the committed list
   immediately shows only the true remainder (not the stale pre-drain list); Retry
   continues from there.
3. In a chat, verify yesterday-style recent memories are present in context (newest
   survive) when the backlog exceeds the injection budget.
4. Trigger a compaction on a slow model → no 30 s abort.
5. "Learn from this chat" while a background pipeline is running → calm busy notice,
   no duplicate entries.
