# Memory: early body authoring & hub-reachable consolidation — design

**Date:** 2026-07-19
**Author:** Liz (with Chris, walk-through)
**Status:** Approved (design), pending Laura spec-pass
**Surface:** `apps/user-client` only — no backend, no `packages/*`, no Dexie bump

---

## 1. Context & problem

Two small UX gaps in the persona memory page
(`apps/user-client/src/routes/app/persona-memory.tsx`), both around the state
*before a persona has ever consolidated*:

1. **The memory body cannot be authored from scratch.** While no body version
   exists (`versions.length === 0`, `persona-memory.tsx:411`), the "The memory
   itself" section shows the dead placeholder *"Nothing remembered yet."* and
   hides the editor entirely. The user cannot seed a body by hand before the
   first "dreaming" run — even though a hand-written body would be carried into
   the next consolidation exactly like a dreamt one
   (`pipeline.ts:180-185`, `getCurrentBody` → `buildConsolidationPrompt`'s
   `existingBody`).

2. **Consolidation cannot be triggered from the persona hub.** "Consolidate
   now" is *not* gated on the body — its UI gate is `committed.length < 1`
   (`persona-memory.tsx:328`) and the engine floor is `committedCount === 0`
   under `force` (`pipeline.ts:171-173`). But the whole chat-actions block sits
   inside `{chatId ? … : …}` (`persona-memory.tsx:316`), so when the page is
   opened from the persona hub's Memory tile (no `?chat=`) there is **no
   consolidate control at all** — only the orient copy *"Open a chat with … to
   learn new memories or consolidate."* Committed entries can pile up with no
   way to consolidate them until the user happens to open a chat.

Both are pure client-side reachability/gating issues. Verified feasibility
(see §3): consolidation is **conceptually persona-scoped** — `runDreaming` and
its `callModel` read only `args.persona` and the model bundle, never
`args.chat`. Only `runExtraction` ("Learn from this chat") needs the chat.

## 2. Goals / non-goals

**Goals**

- The user can write and save a memory body before the first consolidation has
  ever run, from **both** the hub and a chat.
- The user can trigger consolidation whenever **≥ 1 committed journal entry**
  exists, from **both** the hub and a chat — no body required.
- Honour "disabled over hidden": the consolidate control is always visible; when
  there is nothing to consolidate it is shown disabled with a reason.

**Non-goals**

- No change to *auto*-consolidation thresholds or the background pipeline
  (`DREAM_THRESHOLD`, auto-commit) — only the manual, on-demand path.
- No change to "Learn from this chat" reachability — it is genuinely chat-scoped
  and stays gated on `chatId`.
- No Class-2 gating change on consolidation (pre-existing behaviour: the
  consolidate button is gated on committed count only, not `class2`; manual body
  save remains `class2`-gated as today). Out of scope.
- No Dexie/schema change.

## 3. Feasibility (verified against the code)

- `resolve-args.ts:21-67` — `resolveMemoryPipelineArgs(chatId)` loads the chat
  only to reach `chat.personaId`; **provider, offering, apiKey, background
  bundle all derive from the persona.** The returned `chat` field is passed
  through to `MemoryPipelineArgs`.
- `pipeline.ts:60-85` — `callModel(args, …)` reads `args.provider`,
  `args.providerConfig`, `args.apiKey`, `args.offering`. **Never `args.chat`.**
- `pipeline.ts:163-207` — `runDreaming(args, …)` reads `args.persona.id`,
  `args.persona.memoryInstructions`, and the model bundle via `callModel`.
  **Never `args.chat`.**
- `pipeline.ts:88-140` — `runExtraction(args, …)` **is** the only consumer of
  `args.chat` (`args.chat.id`).

Therefore consolidation can run from a persona alone; the chat dependency is
incidental wiring, not a semantic requirement.

## 4. Design

### 4.1 Gap 1 — body editable from empty

In "The memory itself" (`persona-memory.tsx:409-458`), drop the
`versions.length === 0` early-return placeholder. Always render the
`AutoSizeTextarea` + "Save memory" button + version list. The version list
`<ul>` is naturally empty when no versions exist; after the first manual save,
`v1 · manual` appears and the section behaves exactly as it does today.

- `bodyDraft` already initialises to `currentBody?.content ?? ''`
  (`persona-memory.tsx:91-94`), so the from-empty draft starts blank.
- The save gate (`persona-memory.tsx:425-429`) already tolerates a nonexistent
  body: `bodyDraft === (currentBody?.content ?? '')` is `''` when no body, so any
  typed text enables Save. `saveBody` auto-increments from `(current?.version ??
  0) + 1` → clean `v1` (`memory/repo.ts:132-177`).
- The textarea gains a guiding `placeholder` (empty state only) — exact wording
  is Laura/Chris copy territory; the mechanic is: an empty-but-editable body with
  a hint that what you write becomes the seed for the next consolidation.

No behavioural change when a body already exists.

### 4.2 Gap 2 — persona-scoped, hub-reachable consolidation

**Args resolution (`memory/resolve-args.ts`).** Extract the shared model/
credential resolution into a helper and add a persona-based resolver:

- `resolvePersonaModelBundle(persona, { db, mk })` → `{ provider,
  providerConfig, apiKey, offering }` (the body of the current resolver from the
  provider lookup through `resolveBackgroundBundle`).
- `resolveMemoryPipelineArgs(chatId, who)` — unchanged signature; loads chat →
  persona, returns `{ persona, chat, ...bundle }`.
- `resolveMemoryConsolidationArgs(personaId, who)` — **new**; loads the persona
  directly (no chat lookup), returns `{ persona, ...bundle }`. Throws the same
  honest `${who}: …` errors (master key unavailable / persona / provider /
  offering missing).

**Types (`memory/pipeline.ts`).** Introduce a chat-free args type and narrow the
two consolidation-path functions:

- `MemoryConsolidationArgs = Omit<MemoryPipelineArgs, 'chat'>` (or an equivalent
  base type that `MemoryPipelineArgs` extends).
- `callModel(args: MemoryConsolidationArgs, …)` and
  `runDreaming(args: MemoryConsolidationArgs, …)` take the narrow type.
  `MemoryPipelineArgs` remains assignable, so `runExtraction`/`runMemoryPipeline`
  callers are unaffected. `runExtraction` keeps `MemoryPipelineArgs`.

**Hook (`lib/use-memory-actions.ts`).** Change the signature to
`useMemoryActions(personaId: string, chatId: string)`:

- `consolidateNow` resolves via `resolveMemoryConsolidationArgs(personaId, …)`
  and runs `runDreaming(args, { force: true, … })`. Works with an empty
  `chatId`.
- `learnNow` resolves via `resolveMemoryPipelineArgs(chatId, …)` and runs
  `runExtraction`. Only ever invoked when a chat is present.
- The `finally` query invalidations key off the now-directly-available
  `personaId` for `QK.memory(personaId)`; `QK.unextractedCount(chatId)` stays
  (harmless no-op when `chatId` is empty).
- **Remove `lastAttempted`** and its shared-slot machinery — no longer needed
  once the two actions have separate error surfaces (§4.3). Each action's error
  state is owned by its own control, so its Retry and copy can never refer to a
  different action (this was the exact invariant `lastAttempted` maintained by
  hand; the split makes it structural).

### 4.3 UI layout (Option B2)

- **"Learn from this chat"** stays inside the `{chatId ? …}` block and becomes
  the *only* action there, with its own error slot + "Show the model's answer"
  inspect button + pending copy. The `else` orient copy is shortened to
  *"Open a chat with {persona.name} to learn new memories."* (drop "or
  consolidate").

- **"Consolidate now"** moves to the memory-body / committed region as an
  **always-rendered** control (B2 — "disabled over hidden"):
  - Rendered regardless of `chatId` and regardless of committed count.
  - `disabled={committed.length < 1 || consolidateState.status === 'pending'}`
    (unchanged gate); `title` when disabled: *"No committed memories to
    consolidate yet."* (unchanged copy).
  - Its own error slot (`memoryErrorCopy(consolidateState)` + Retry +
    "Show the model's answer") + the "this can take a minute" pending copy,
    relocated with it.
  - Positioned at the "Committed, awaiting consolidation" section. The section's
    **list** (`<ul>` of committed rows) stays gated on `visibleCommitted.length
    > 0`; the **consolidate control** is always present so the affordance never
    vanishes. Exact heading/framing when the list is empty (e.g. a compact
    "Consolidate memory" control above/within the section) is Laura/Chris copy
    territory; the mechanic is: control always visible, list conditional.

### 4.4 Interaction between the two gaps

A user can hand-author a body (§4.1) and then consolidate (§4.2) from the hub;
the dream reads the manual body as `existingBody` and folds committed entries
in, saving `v2 · dream`. No ordering constraint, no data-model conflict.

## 5. Files touched

- `apps/user-client/src/memory/resolve-args.ts` — shared bundle helper + new
  persona resolver.
- `apps/user-client/src/memory/pipeline.ts` — `MemoryConsolidationArgs` type;
  narrow `callModel` + `runDreaming` params.
- `apps/user-client/src/lib/use-memory-actions.ts` — `(personaId, chatId)`
  signature; persona-based consolidate; drop `lastAttempted`.
- `apps/user-client/src/routes/app/persona-memory.tsx` — pass `personaId` to the
  hook; relocate "Consolidate now" + its error/pending slots to the committed
  region as an always-rendered control; shorten the orient copy; render the body
  editor when `versions.length === 0`; add the empty-state placeholder.
- CSS (`index.css` or the memory-page styles) — only if the relocated control /
  empty-body state needs layout; reuse existing `memory-page-*` classes where
  possible.

## 6. Audits

- **Larissa:** not her path — client-only; no `auth-service` / `sync-service` /
  `proxy-service` / `packages/crypto` change. Body save and consolidation write
  through existing Class-2 / pipeline paths; no new wire field, no polarity
  change.
- **Laura:** **spec-pass required** — the reachability of a function changes
  (consolidation now reachable from the hub; body authorable from empty) and a
  dead affordance ("Nothing remembered yet.") is replaced by an active one. Run
  the spec-pass on this document before the plan; pre-squash pass before squash.

## 7. Testing

- **Unit — `resolve-args`:** `resolveMemoryConsolidationArgs` resolves
  persona/provider/offering/apiKey/background-bundle from a personaId with no
  chat; throws the honest `${who}` errors on missing master key / persona /
  provider / offering.
- **Unit — `pipeline` types:** `runDreaming` accepts `MemoryConsolidationArgs`
  (no chat) and drains committed slices (existing dreaming coverage holds; add a
  chat-free args case).
- **Hook — `use-memory-actions`:** `consolidateNow` runs with an empty `chatId`
  (persona resolver path); `learnNow` unaffected; error state populates the
  consolidate slot.
- **Component — `persona-memory`:**
  - From the hub (no `chatId`): the consolidate control renders, disabled with
    the tooltip at zero committed, enabled at ≥ 1 committed; "Learn from this
    chat" is absent, orient copy present.
  - From a chat: "Learn from this chat" present; consolidate control in the
    committed region.
  - Body editor renders and saves from an empty state (`versions.length === 0`),
    producing `v1 · manual`.

Full user-client vitest at the known **8** Node-localStorage baseline; expect no
regression. `pnpm typecheck --force` 14/14; `pnpm run build` 9/9; Biome clean.

## 8. Manual verification (Chris, on device)

Restart the dev stack first (Vite HMR ignores `packages/*`; a clean boot avoids
stale state). Use a persona whose model is reachable (e.g. via `./dev.sh`).

1. **New persona, hub path:** open the persona hub → Memory (no chat). The body
   section shows an **empty editable** field (not "Nothing remembered yet."),
   and the **Consolidate** control is visible but **disabled** with the "no
   committed memories" tooltip.
2. **Author a body from empty:** type into the body field → **Save memory** →
   `v1 · manual` appears; the field now holds the saved text.
3. **Grow committed entries:** chat a little, "Learn from this chat", let/commit
   entries so ≥ 1 committed exists (or use the auto-commit path).
4. **Consolidate from the hub:** back in the hub Memory page (no chat), the
   Consolidate control is now **enabled**; trigger it → the committed count ticks
   down, the body updates to `v… · dream` that reflects the hand-written seed +
   the committed entries.
5. **Consolidate from a chat:** open the same persona's chat → Memory; confirm
   "Learn from this chat" is present and the Consolidate control lives in the
   committed region and works identically.
6. **Error surface:** kill the network mid-consolidate → the consolidate slot
   (not learn) shows honest copy + Retry; Retry continues.
7. **Offline linked (Class-2):** while offline on a linked account, "Save memory"
   is disabled with its Class-2 tooltip (unchanged); consolidation is unaffected
   by the Class-2 gate (pre-existing).
