# Memory tuning, active recall, circle LRU & greeting continuity — design

**Date:** 2026-06-21
**Author:** Liz (with Chris)
**Status:** Draft — awaiting Chris's review
**Related:** [[2026-06-20-memory-design]], [[2026-06-21-memory-page-design]]

## Context

Memory shipped to master and was device-verified ("we have memory!"). In real
use Chris surfaced five adjustments — three to the memory system itself, two to
adjacent UX/prompt behaviour. All five are landed as one cohesive unit (one
spec, one plan, one squash). Three touch the same memory subsystem and share
context; the other two are small, self-contained changes that ride along.

None of this touches a Larissa path (client-only, no `apps/*-service` or
`packages/crypto`). Laura is in scope for points 3, 4 and 5 (they add or alter
user-reachable behaviour).

## Goals

1. **Lower the auto-consolidation thresholds** so memory formation is felt in
   real sessions rather than effectively never firing.
2. **Feed `persona.memoryInstructions` to extraction** as well as consolidation,
   so the user's "what to remember" steering shapes both stages.
3. **Add a `write_memory_entry` tool** so a persona can actively choose to
   remember something mid-conversation.
4. **Sort "My Circle" by last interaction** (when the user last *said* something
   to a persona), not by when she was last opened.
5. **Carry the auto-greeting into the system prompt** so the model has
   continuity with the opener it "spoke", without putting an assistant message
   first in the wire history.

## Non-goals (YAGNI)

- No new memory *category* taxonomy for the tool — `content` + a `correction`
  flag only.
- No global reorder of every persona list — point 4 is scoped to the Circle.
- No richer opener-echo than a single quoted block — no per-turn summarisation.
- No change to the extraction/dedup/dreaming algorithms beyond the threshold
  constants and the new guidance section.

---

## Point 1 — Lower the thresholds

Pure constant change in `apps/user-client/src/memory/config.ts`:

| Constant | Old | New |
|---|---|---|
| `AUTO_COMMIT_THRESHOLD` | 15 | **10** |
| `DREAM_THRESHOLD` | 20 | **12** |

`EXTRACTION_MIN_NEW_MESSAGES` (6), `EXTRACTION_WINDOW_CAP` (20),
`UNCOMMITTED_CAP` (50), `AUTO_COMMIT_KEEP_RECENT` (5) are unchanged. The comment
"Tunable after device testing" stays — these remain tunable.

**Test:** the existing pipeline tests assert behaviour relative to the
constants, not hard-coded counts where avoidable. Verify the suite still passes;
adjust any test that hard-codes 15/20 to read the constant or the new value.

---

## Point 2 — `memoryInstructions` to extraction

Today `buildConsolidationPrompt` takes `userGuidance` (`consolidation-prompt.ts:30`)
but `buildExtractionPrompt` (`extraction-prompt.ts:46`) does not, and the
pipeline does not pass it (`pipeline.ts:97`).

**Change:**
- `buildExtractionPrompt` gains an optional `userGuidance?: string` input.
- When present and non-empty, it renders a `## User Guidance` section
  immediately before `## User Messages to Process`, mirroring the consolidation
  wording: *"The user has asked you to focus on: &lt;guidance&gt;."*
- `runExtraction` passes `args.persona.memoryInstructions ?? ''` into it
  (`pipeline.ts`).

The guidance steers *what* gets extracted; it does not relax the durability bar
or the "do not invent" rule — those instructions still dominate the prompt.

**Test:** unit-test `buildExtractionPrompt` — guidance present → section
rendered with the expected phrasing; guidance empty/absent → no section, output
byte-identical to today.

---

## Point 3 — `write_memory_entry` tool

A persona can call a tool to persist a durable fact it judges worth keeping.
This proved useful in chatsune.

### Lands as `uncommitted`

The entry is written straight to the journal in the **`uncommitted`** state
(`repo.ts:addJournalEntries`, which already writes `uncommitted`). It therefore
flows through the normal triage: it appears on the Memory Page pending list, the
user can commit/edit/delete-with-undo it, and the ordinary auto-commit →
dreaming pipeline will promote and consolidate it over time. An intentional act
by the persona still gets the same user oversight as an auto-extracted entry.

### Tool surface

New file `apps/user-client/src/tools/write-memory.ts`:

```ts
export interface MemoryToolContext {
  personaId: string;
  /** Called after a successful write so the caller can invalidate the
   *  Memory-Page journal query (no useLiveQuery in this project). */
  onWritten?: () => void;
}
export function contributeMemoryTool(ctx: MemoryToolContext): Tool[];
```

- **name:** `write_memory_entry`
- **description:** "Save a durable fact, preference, or correction about the
  user to your long-term memory, so you still know it in future conversations.
  Use it when the user shares something lasting and worth remembering — not for
  momentary states or one-off requests."
- **parameters:** `{ content: string (required, non-empty),
  correction?: boolean }`
- **systemPromptInstruction:** one calm line — "You keep a long-term memory of
  the user. When they share a lasting fact, preference, or correction worth
  remembering, you may call `write_memory_entry` to save it." (Deliberately
  light to avoid over-eager calling; under-calling is acceptable
  nondeterminism, not a bug — cf. the MCP awareness stance.)
- **execute:**
  1. Trim `content`; if empty → `ok:false`, error "Nothing to remember."
  2. **Exact-duplicate guard:** if a non-archived journal entry with the same
     case-insensitive trimmed `content` already exists for the persona, return
     `ok:true` with output "Already remembered." and do not write (prevents the
     model spamming duplicates).
  3. Otherwise `addJournalEntries(personaId, [{ content, category: correction ?
     'correction' : 'fact', isCorrection: correction ?? false }])`. Writes
     regardless of `UNCOMMITTED_CAP` — an explicit act is not dropped on a full
     backlog; the page triage prunes.
  4. Call `ctx.onWritten?.()`.
  5. Return `ok:true`, output "Saved to memory.", `meta: { entryId }`.

### Wiring

- `resolveActiveTools` (`tools/registry.ts`) gains a
  `memory: MemoryToolContext | null = null` param; appends
  `contributeMemoryTool(memory)` when non-null.
- The send path passes a `MemoryToolContext` **only when the persona's
  `useMemory` is on** (omitted otherwise — the model cannot persist when memory
  is off, so no dead affordance). `onWritten` invalidates the Memory-Page
  journal query for that persona.

### Visibility — a pill

`write_memory_entry` is a normal client tool, so it renders through the existing
tool-call pill path (like `calculate_js` / `ask_expert`) — the act is visible in
the chat as it happens. The pill shows a friendly label ("Remembered …" with the
saved content elided) rather than the raw tool name. The exact pill copy/styling
is a light-touch polish item; the generic tool-call pill is the functional
baseline.

**Tests:** unit-test `contributeMemoryTool().execute` — happy path writes one
uncommitted row with the right `isCorrection`/`category`; duplicate guard
returns "Already remembered." without writing; empty content fails cleanly;
`onWritten` fires on success only. `resolveActiveTools` includes the tool iff a
memory context is passed.

---

## Point 4 — Circle sorted by last interaction

### Why a new field

`chats.lastMessageAt` is bumped by the opener finalise
(`stream-manager.store.ts:941`), so "last activity" today includes merely
*opening* a persona — exactly the "last opened" semantics to avoid. A
denormalised, send-only timestamp cleanly excludes the opener.

### Change

- **Dexie v28:** add optional `lastInteractionAt?: number` to `PersonaRow` (not
  indexed — Circle sorts in memory). Upgrade backfills each persona's
  `lastInteractionAt` to the max `lastMessageAt` across its chats (via the
  existing `[personaId+lastMessageAt]` index), falling back to `createdAt` when
  the persona has no chats. This seeds a sensible initial order without a
  message scan; going forward only real sends update it.
- **Write path:** in `send` (`stream-manager.store.ts`, the user-turn
  transaction at ~line 270), also `db.personas.update(personaId,
  { lastInteractionAt: now })` and add `db.personas` to the transaction tables.
  The opener path (`startOpener` / `runOpenerStream`) is **not** touched, so an
  opener never updates it. Invalidate `QK.personas` after the send so the Circle
  re-sorts.
- **Circle sort:** in `routes/app/circle.tsx`, sort the personas (descending) by
  `(p.lastInteractionAt ?? p.createdAt)`. The shared `usePersonas` hook keeps its
  `createdAt` order so Treasury / History / Entrance-Hall / Artefact-Picker are
  unchanged.

**Edge:** a persona never messaged sorts by `createdAt` and so sits where it does
today relative to others until first use. A newly created persona
(`lastInteractionAt` unset → `createdAt` = now) appears at the top of the Circle,
which is reasonable.

**Tests:** unit-test the sort comparator (interleaved interacted/never-interacted
personas order correctly; opener-only persona keeps its `createdAt` rank).
Migration test: backfill picks max chat `lastMessageAt`, falls back to
`createdAt`.

---

## Point 5 — Greeting carried into the system prompt

The opener is `kind:'opener'`, shown in the UI but never sent
(`content-blocks.ts:isContextMessage`, `stream-engine.ts:205`) — some models
refuse a history that starts with an assistant message. Result: the model never
knows what it "said" as a greeting. We echo it into the **system prompt**
instead.

### Change

- **`BuildPromptInputs`** (`packages/llm-unified/src/composition.ts`) gains an
  optional `openerContext?: string` (defaulting to '' like `loreContext`, so
  `title`/`memory` callers need no change).
- **New segment `openerEcho`:** Band 2, chat-only, placed immediately after
  `memories` (`lore`/`knowledgeLibraries` shift down one order). When
  `openerContext` is non-empty it renders:

  > You opened this conversation by greeting the user. You said:
  >
  > "&lt;opener text&gt;"
  >
  > The user has already seen this greeting — continue naturally from it.

- **`runStreamEngine`** (`apps/user-client/src/lib/stream-engine.ts`): for the
  `chat` job, find the opener in `priorMessages` (`m.kind === 'opener'`), flatten
  its text (`flattenAnswerText`), and pass it as `openerContext`. For the
  `greeting` job (and when no opener exists) it stays ''. Because the opener is
  never in wire history, this echo is the model's only continuity with it, so it
  is injected on **every** chat turn — not just the first.

### Caching

The opener text is the same on every turn, so the system prompt is stable and
upstream prompt-caching (keyed on `chat.id`) is unaffected in steady state.
**Regenerating the opener** changes the system prompt and therefore busts the
cache for that chat — accepted, and rare.

**Tests:** unit-test the `openerEcho` segment via `buildPrompt` — opener present
on a `chat` job → quoted echo in Band 2 after memories; `greeting`/`title` jobs →
absent; empty `openerContext` → absent. `runStreamEngine` test (or
`buildEngineWireMessages`-level): opener in `priorMessages` is still filtered out
of the wire history *and* its text reaches `openerContext`.

---

## Architecture summary — files touched

| Area | File | Change |
|---|---|---|
| 1 | `memory/config.ts` | two constants |
| 2 | `memory/extraction-prompt.ts` | `userGuidance` section |
| 2 | `memory/pipeline.ts` | pass `memoryInstructions` to extraction |
| 3 | `tools/write-memory.ts` *(new)* | `contributeMemoryTool` + tool |
| 3 | `tools/registry.ts` | wire `memory` context param |
| 3 | send path (`data/send-message.ts` / `stream-manager.store.ts`) | pass context when `useMemory`, invalidate journal query |
| 4 | `boot/client-data-db.ts` | Dexie v28 + `lastInteractionAt` + backfill |
| 4 | `state/stream-manager.store.ts` | set `lastInteractionAt` on send; invalidate `QK.personas` |
| 4 | `routes/app/circle.tsx` | LRU sort |
| 5 | `packages/llm-unified/src/composition.ts` | `openerContext` input + `openerEcho` segment |
| 5 | `lib/stream-engine.ts` | resolve opener text → `openerContext` |

## Quality gates

- `pnpm typecheck --force` clean (covers tests; Turbo caches typecheck — force).
- Full user-client vitest at the 8 Node-localStorage baseline; new unit tests
  green.
- Laura pre-squash pass (points 3/4/5 alter user-reachable behaviour).
- One squashed commit (memory + adjacent UX, one feature unit). Not pushed
  unless Chris says so; master is already ahead of origin.

## Manual verification (device — Chris)

1. **Thresholds:** in a real session, confirm auto-commit and a dream fire
   sooner than before (watch the Memory Page populate / a body version appear).
2. **Extraction guidance:** set a persona's memory instructions ("focus on my
   work projects"), chat, confirm extracted entries skew to that.
3. **Active recall:** tell the persona something and ask it to remember →
   `write_memory_entry` pill appears in chat → the entry shows pending on the
   Memory Page → committing/deleting works. Ask it to remember the same thing
   twice → no duplicate.
4. **Memory off:** a persona with memory off never offers the tool (the model
   cannot call it).
5. **Circle LRU:** open persona A (opener only, don't message) — it does **not**
   jump to the top. Send a message to persona B — B moves to the top of the
   Circle.
6. **Greeting continuity:** after an opener, ask "what did you just say to me?" —
   the model can refer to its greeting. Regenerate the opener, send again —
   continuity reflects the new greeting.
