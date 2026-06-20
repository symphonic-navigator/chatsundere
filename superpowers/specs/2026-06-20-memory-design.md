# Memory System — Design Spec

**Date:** 2026-06-20
**Author:** Liz (with Chris)
**Status:** Approved design, pending implementation plan
**Track:** Client-only (no backend; lives entirely in `apps/user-client` + `packages/llm-unified` for the prompt slot)

---

## 1. Context & Goal

Chatsundere needs a long-term memory system — the notable remaining gap in Block 1
(see [[STATUS-CLIENT-ONLY]]). A persona should accumulate an evolving understanding
of the user across conversations, so it stops feeling amnesiac between chats.

Chatsune already solved this, but **on a server**: a background worker extracted
facts from messages, and a cron "dreamt" every six hours, consolidating facts into
a prose memory body. Chatsundere is **local-first** — there is no backend, no cron,
no background worker. The only compute is the user's device during an active
session. The whole design problem is: **port chatsune's pipeline to a world with no
background scheduler.**

### Reality check: the pipeline transfers, the scheduler does not

We keep chatsune's proven pipeline shape verbatim:

```
extraction → uncommitted journal → committed journal → dreaming → memory body
```

What we replace is *how each stage is triggered*. Chatsune used time-based loops
(extraction every 15 min, auto-commit after 48 h, dreaming every 10 min checking a
≥25-entry hard limit OR a 10–24-entry + 6 h soft limit). The 6 h was never the real
trigger — it was a **time floor** for low-volume users; the hard volume limit fired
regardless. Chatsundere drops the time floors entirely and runs everything on
**volume thresholds, evaluated after a send, in the background.**

Memory is **distinct from and complementary to "About Me"**: About Me is what the
user *declares*; memory is what the persona *learns* over time.

---

## 2. Non-Goals (explicit)

- **No vector search for memory.** Unlike the knowledge base, memory is injected as
  a whole prose block (the consolidated body) plus the journal, token-budget-bounded.
  No embeddings, no second vector collection, deterministic. (Chatsune does the same.)
- **No background scheduler / Web Worker / service-worker timer.** Everything runs
  opportunistically off the back of a send. If the app is closed, nothing runs —
  and that is fine; it catches up on the next send.
- **No per-chat memory.** Memory is **per-persona** (see §3). All chats with a
  persona share one memory.
- **No server involvement.** This is not [[STATUS-BACKEND]] territory; no sync, no
  ciphertext, no auth. Pure client.

---

## 3. Scope & Data Model

### Scope: per-persona

Memory is keyed by `personaId` only. Chatsune keyed by `user_id + persona_id`; we
have no server user, so the persona is the unit. This is consistent with the
"one active chat at a time, many personas" model and with Chris's framing ("memory
für persona ist einfach").

### Dexie schema — bump to v27

Current `ClientDataDb` is v26 (`apps/user-client/src/boot/client-data-db.ts:845`).
Memory adds **two tables** and **two persona fields**.

**`memoryJournal`** — mirrors chatsune's `JournalEntryDocument`, minus server-only
fields (`user_id`, `source_session_id` — we have no sessions):

```ts
interface MemoryJournalRow {
  id: string;                 // uuidv7
  personaId: string;          // FK → personas
  content: string;
  category: 'preference' | 'fact' | 'correction' | 'goal' | 'context' | null;
  state: 'uncommitted' | 'committed' | 'archived';
  isCorrection: boolean;
  createdAt: number;
  committedAt: number | null;
  autoCommitted: boolean;     // true when promoted by the volume auto-commit
  archivedByDreamId: string | null;  // set when consolidated
  importedFrom?: string;      // chatsune origin marker (import idempotency, see §7)
}
```

Index: `id, personaId, [personaId+state], [personaId+createdAt]`.

**`memoryBody`** — mirrors chatsune's `MemoryBodyDocument`; keep max **5 versions**
per persona (prune oldest), so Body editing has a rollback target:

```ts
interface MemoryBodyRow {
  id: string;                 // uuidv7
  personaId: string;
  content: string;            // free-form consolidated prose
  tokenCount: number;
  version: number;            // auto-incremented per consolidation / per manual edit
  entriesProcessed: number;   // committed entries folded in by the dream that wrote it
  createdAt: number;
  source: 'dream' | 'manual' | 'import';  // provenance for the version list
}
```

Index: `id, personaId, [personaId+version]`.

**`PersonaRow` gains** (`client-data-db.ts:138`):

```ts
useMemory: boolean;                  // default true (see §6); per-persona on/off
memoryInstructions: string;          // optional "what should be remembered" guidance, '' default
lastViewedMemoryBodyVersion: number; // highest body version the user has seen; drives the Cockpit active-state (§6.1, HARD 1)
memoryIntroShown: boolean;           // one-shot first-run note already shown (§6.1)
```

The v27 migration backfills `useMemory: true`, `memoryInstructions: ''`,
`lastViewedMemoryBodyVersion: 0` and `memoryIntroShown: false` on every existing
persona.

**`ChatRow` gains** (`client-data-db.ts:180`) — the extraction cursor (see §4):

```ts
lastExtractedMessageId: string | null;  // id of the newest user message already fed to extraction, null default
```

Message ids are uuidv7 (time-ordered, lexicographically sortable), so "messages
newer than the cursor" is a simple id comparison. The cursor lives per-chat because
extraction reads a chat's messages, even though the memory it produces is
per-persona. The v27 migration backfills `lastExtractedMessageId: null`.

> **Dexie-version ownership note:** v27 is owned by *this* feature. If a parallel
> worktree also bumps Dexie, the merge is additive — verify no version collision and
> run the full gate on the merged state ([[project_parallel_feature_dexie_version_ownership]]).

---

## 4. The Pipeline — all post-send, all background

Every stage runs **after an assistant response finishes streaming**, off the
critical path, in the same place title-generation already fires
(`apps/user-client/src/lib/title-generator.ts` is the structural template). The
chat is never blocked; the user sees at most a discreet status / badge change.

```
send completes  →  [background, guarded by a per-persona mutex]:
   ① extraction   — if ≥6 user msgs newer than the chat cursor: LLM reads the unextracted msgs (cap ~20) → uncommitted entries; advance cursor
   ② auto-commit  — if uncommitted ≥ 15: promote oldest to committed, keep newest ~5 pending for review
   ③ dreaming     — if committed ≥ 20: LLM consolidates committed → new memoryBody version; entries → archived
```

### Thresholds (all tunable; these are the v1 defaults, derived from chatsune)

| Stage | Trigger | Detail |
|---|---|---|
| Extraction | **≥ 6** user messages newer than the chat cursor | process only **unextracted** messages (those after `lastExtractedMessageId`), cap the batch at **~20**, then advance the cursor to the newest processed; dedup vs body + journal; cap **50** uncommitted |
| Auto-commit | uncommitted **≥ 15** | promote oldest, keep newest **~5** pending in the review window; `autoCommitted = true` |
| Dreaming | committed **≥ 20** | consolidate all committed; body capped at **3000 tokens** (chatsune parity) |

These constants live in one module (`memory/config.ts`) so they are trivially
adjustable after device testing — exact values are expected to be tuned with Chris,
not frozen here.

### Precision & dedup are first-class, not incidental

Because the memory body has a hard token budget (3000) and is injected into **every**
send, low-quality extraction is not merely untidy — it directly spends the user's
context budget on noise and crowds out real signal. Two guards keep memory lean,
and they are **distinct**:

- **The cursor (primary):** a message is fed to extraction **exactly once**. There
  is no overlapping re-read of a sliding window, so the same statement is never
  re-extracted from the same message. This is the clean guard.
- **Dedup (secondary net):** the extractor is given the existing body + journal and
  told not to repeat; on top of that, new entries are dropped if they
  normalise-equal (lowercase, whitespace-collapsed) to an existing entry or body
  line. This catches the LLM restating an existing fact — but it is a **string**
  match, **not semantic**, so it will *not* catch paraphrases ("likes tea" vs
  "enjoys tea"). Dedup is therefore a backstop, never the reason re-reading would be
  safe. The cursor is what makes re-reading a non-issue.

The extraction prompt's quality bar (enduring traits only, no transient state) is
the third lever: the tighter it extracts, the less the body has to carry and the
less dedup has to catch. Getting extraction precise is the highest-leverage tuning
target during device testing.

### Concurrency guard

A **per-persona in-memory mutex** plus a `consolidating`/`extracting` guard replaces
chatsune's Redis slot lock. While a memory operation for a persona is running, a
second post-send trigger for the same persona is **dropped** (not queued). This
prevents two fast sends from double-running extraction or dreaming. The guard is
process-local (a `Map<personaId, boolean>`); a hard refresh resets it, which is safe
because each stage is idempotent on re-run (dedup at extraction, threshold re-check
at commit/dream).

### Model & call path — CRITICAL

Extraction and dreaming **reuse the persona's current offering** via
`runOneShotCompletion()` + `offeringToTarget()` — the exact background-job path
title-gen uses (`title-generator.ts:117`). Raw request bodies must **never** be
hand-built: they silently break reasoning models (empty content → invisible
fallback). This is the [[project_background_jobs_need_adapter_path]] lesson, and it
is the single most load-bearing implementation constraint in this spec.

Background memory calls go through the retry helper
(`packages/llm-unified/src/retry.ts`, via `runOneShotCompletion`) so transient
5xx/429s are handled and observable, consistent with the retry-observability work.

### Prompts

Two prompt builders, ported in spirit from chatsune (`_extraction.py`,
`_consolidation.py`), rewritten in British English:

- **Extraction prompt:** given the existing body, existing journal entries (for
  dedup), and the recent user messages, emit a JSON array of
  `{ content, category, isCorrection }`. Quality bar: enduring traits, tastes,
  relationships, biographical facts, recurring habits, long-term goals — **not**
  momentary states, in-progress tasks, one-off requests. Temperature 0.3. Input is
  pre-filtered to strip code fences / tracebacks / log dumps (chatsune's
  `strip_technical_content`). Output parsed by a **tolerant** parser (markdown
  fences, trailing commas, broken arrays) — never trust raw JSON.
- **Consolidation prompt:** given the existing body and the committed entries
  (`[CORRECTION]`-marked where `isCorrection`), produce the rewritten body. Rules:
  integrate all entries; corrections override conflicting prior info; drop transient
  facts; prefer newer info if the token budget is hit; plain prose only, ≤ 3000
  tokens, fully uncensored. The persona's `memoryInstructions` are injected here as
  user-authored guidance on what matters.

---

## 5. Retrieval — whole prose block

At send time, after building the rest of the system prompt, assemble a
`<usermemory>` block and pass it through the **existing-but-empty `memoryContext`
slot** of `buildPrompt()` (`title-generator.ts:101` shows the slot threaded as `''`
today; the live chat send path passes it identically).

Block contents, token-budget-bounded (mirrors chatsune's `_assembly.py`):

```xml
<usermemory>
  <memory-body>{current consolidated body}</memory-body>
  <journal>
    - [committed] {entry}
    - [pending] {uncommitted entry}
  </journal>
</usermemory>
```

Body first (it is the highest-value, max ~3000 tokens), then committed entries,
then uncommitted — dropping entries when the budget is exhausted. Only injected when
the persona's `useMemory` is true.

---

## 6. UI — two surfaces

### 6.1 Cockpit button + review overlay (in-chat triage)

A new icon button in the chat **Cockpit** controls row, next to Knowledge
(`apps/user-client/src/components/chat/Cockpit.tsx:490` is the pattern: icon +
count badge + sheet overlay, `useDismissOnOutside`).

**The button is ALWAYS rendered** (never hidden), exactly like the Knowledge button,
which renders unconditionally and only toggles its count badge
(`Cockpit.tsx:490-506`). Hiding it would make the on-demand actions inside
unreachable when their counts are zero (see below). [Laura HARD 2]

**Two signals, because one count is not enough** [Laura HARD 1]:

- **Badge** = count of *uncommitted* entries for the active persona (the triage
  backlog).
- **Active-state** (a subtle glow/dot, mirroring the Knowledge button's
  `effectiveCount > 0 ? ' active'`) = a memory body version newer than the persona's
  `lastViewedMemoryBodyVersion` has been written since the user last looked.

This matters because the badge alone goes to **zero in two opposite situations**:
nothing has been learned, *and* everything learned has been auto-committed and
dreamt into the body. Without the active-state, a user watching the badge rise to ~5
then fall to 0 (as auto-commit fires) would reasonably conclude memory "stopped" or
"was cleared" — when in fact a fact just **graduated into permanent memory**. Opening
the overlay sets `lastViewedMemoryBodyVersion = current body version`, clearing the
active-state. The badge reading identical for "amnesiac" and "fully remembered" is
the Principle-of-Least-Astonishment failure this guards against.

Tapping the button opens the **memory review overlay** — chatsune's
`UncommittedSection.tsx` is the direct template. Per uncommitted entry:
**commit / reject / edit**. This is the active "dere" surface — nothing slides into
long-term memory unseen if the user chooses to look. (Auto-commit still progresses
untouched entries — see §4 — so the overlay is an *option*, not an obligation.)

- **Reject = plain removal of the uncommitted entry**, with a lightweight
  **"rejected · undo" toast** (~5 s; it merely defers the actual delete, no archived
  state, no recoverable view). We deliberately do **not** build soft-delete /
  recovery machinery or a suppression list. Rationale: memory source material is
  **recurrent** — if a rejected fact genuinely matters, it resurfaces in later
  conversation and is re-extracted. Reject therefore means "not now / not this
  phrasing", not "never"; the only thing the undo-toast protects against is a
  fat-finger mis-tap next to *commit* on a 380 px row. A true permanent suppression
  would need a denylist, which is out of scope for v1 and arguably wrong (the user
  may change their mind). [Laura SOFT — reject; Chris-arbitrated]

The overlay also exposes two **on-demand actions**, both following
**disabled-over-hidden** [Laura HARD 2]:

- **"Learn from this chat now"** — runs an extraction pass immediately (the lever for
  a short, dense chat the user wants remembered *before* the 6-message threshold).
  Greyed with a reason when there is nothing new since the cursor ("Nothing new to
  learn yet — keep chatting").
- **"Consolidate now"** — runs a dream immediately (operates on *committed* entries,
  so it must not be gated on the *uncommitted* badge). Greyed with a reason when
  there are too few committed entries ("Not enough committed memories to consolidate
  yet").

**Failure handling for the on-demand actions** [Laura HARD 3]: because the user
*tapped* these, they are owed a verdict. Each gets a **pending** state (disabled +
spinner), a **success** acknowledgement (the count / version change is enough), and a
**failure** surface that names the actor and offers **Retry** — reuse the dictation
note pattern verbatim (`Cockpit.tsx:530-545`). This honours Chatsundere's
constructive-error-handling tenet. **Background** (non-user-initiated) extraction /
dreaming failures may stay silent and catch up on the next send (consistent with §2
and the retry helper) — the verdict obligation is only for actions the user invoked.

**First-run note** [Laura SOFT — adopted]: the first time memory produces anything
for a persona (and `memoryIntroShown` is false), show a **one-shot, dismissible**
line — "Fable is starting to remember you — manage this in the persona's Memory
section" — then set `memoryIntroShown = true`. It converts a silent, default-on,
token-spending process into a moment of delight and points at the off-switch. Not a
consent gate (omakase: the default is right), never recurring.

### 6.2 Persona-editor Memory section (the calm "how the persona sees you" surface)

A new accordion section in the persona editor, after Knowledge
(`apps/user-client/src/routes/app/persona-editor.tsx:973`, `KnowledgeSection.tsx`
is the component template). Contents:

- **Toggle** `useMemory` (default on), disabled-with-tooltip style per the UX rule
  "disabled over hidden".
- **`memoryInstructions` textarea** — "what should this persona remember about you".
- **The consolidated memory body, fully editable** — with a **version list +
  rollback** (up to 5 versions, `source` shown: dream / manual / import). A manual
  edit writes a new `memoryBody` version with `source: 'manual'`.
- A read-only view of committed entries (the journal already folded in / pending
  consolidation) for transparency.

The section bundles four distinct intents — *configure* (toggle), *instruct*
(textarea), *edit-with-history* (body + versions), *inspect* (committed entries). To
stay ND-calm and not read as a wall, give them a clear internal ordering: the toggle
+ instructions read as one "settings" group, the editable body + version list as a
visually distinct "the memory itself" block (it is a meaty interaction, akin to the
Mindspace override at `persona-editor.tsx:936`), and the committed-entries view as a
final read-only "inspect" block, with sub-headings / dividers between them. No extra
screen — collapsing-in-place is the established AccordionCard pattern and matches the
inline-over-hidden preference. [Laura SOFT — adopted]

### Deferred to the design-language pass [Laura SOFT — two-badge legibility]

The Memory button sits immediately right of the Knowledge button — two near-identical
affordances (icon + count + sheet) the user must learn to tell apart: "documents I
*gave* it" vs "things it *learned* about me" (mirroring About-Me vs Memory). The
distinction is real and good but not self-evident from two adjacent glyph+count
buttons, and the row is already dense at the 380 px floor. Making the learned-vs-given
split legible at a glance (glyph + aria-label, possibly a shared visual language so
they read as a pair) is a **visual** problem deferred to the later design-language
pass ([[project_next_session_laura_and_design_language]]), not pinned here.

### UX gate

Memory adds user-reachable flows (overlay + persona section) → **Laura spec-pass**
before the implementation plan, and a pre-squash pass on the built flow. Not a
Larissa path (client-only, no auth/crypto/sync/proxy).

---

## 7. Chatsune memory import (folded into this landing)

The chatsune persona importer already lands chats + persona core but **defers
memory** behind a three-anchor reminder
([[future-feature-couplings]]; `persona-parse.ts:25-28`,
`ChatsuneImportControl.tsx:111`). This landing **closes that coupling**.

Chatsune's export carries `memory.json` with exactly the shape our schema absorbs
(verified against `chatsune/backend/modules/persona/_export.py:195-206`):

```json
{
  "journal_entries": [
    { "content", "category", "state", "is_correction",
      "created_at", "committed_at", "auto_committed",
      "source_session_id", "archived_by_dream_id" }
  ],
  "memory_bodies": [
    { "content", "token_count", "version", "entries_processed", "created_at" }
  ]
}
```

Import mapping:

- `journal_entries[]` → `memoryJournal` rows. Map `is_correction → isCorrection`,
  `auto_committed → autoCommitted`, ISO datetimes → epoch ms. **Drop**
  `source_session_id` (no sessions here). `archived_by_dream_id` is kept verbatim
  if present (it is just an opaque marker). Set `importedFrom` to the chatsune
  origin marker for idempotency.
- `memory_bodies[]` → `memoryBody` rows with `source: 'import'`, preserving
  `version`, `token_count → tokenCount`, `entries_processed → entriesProcessed`.
  Keep at most the latest 5 by `version`.

Work in the importer:

1. `persona-parse.ts` currently decodes `memory.json` but only **counts** it
   (`memoryCount`, line 74). Extend the parser to **retain** the parsed
   `journal_entries` + `memory_bodies` (typed, replacing the `unknown[]`), behind
   the existing manifest `include_content` signal.
2. Add a `importChatsuneMemory(personaId, memory)` function alongside
   `importChatsuneSessions` / `importChatsuneLibrary`
   (`apps/user-client/src/data/chatsune-import.ts`).
3. Wire it into both import entry points (new persona **and** merge-into-existing),
   targeting the resolved `personaId`.
4. Idempotency: dedup journal rows by `importedFrom` so a re-import is lossless
   (matches the existing chat-merge behaviour). Bodies de-dup by
   `(personaId, version, source:'import')`.
5. Remove the three deferral anchors (the `FUTURE:` comment, the "re-import once
   memory lands" user note) and update [[future-feature-couplings]] to move this
   coupling to a "Closed" section.

---

## 8. Testing & Gates

- **Pure-function tests (Vitest):** the tolerant extraction-output parser, the
  technical-content stripper, the threshold/auto-commit/dream decision logic, the
  `<usermemory>` assembler (token budgeting + drop order), and the chatsune
  memory-import mapping (`memory.json` → rows, idempotency). These are the
  highest-value tests and carry the bulk of correctness.
- **RTL tests:** the cockpit review overlay (commit / reject-with-undo-toast / edit,
  badge count, button always-rendered, active-state on a newer-than-viewed body
  version, on-demand actions greyed-with-reason vs active, the named-cause + Retry
  failure surface on a user-invoked action, the one-shot first-run note) and the
  persona-editor Memory section (toggle, body edit → new version, rollback).
- **No live LLM in CI** — provider keys never enter CI (CLAUDE.md §10). Extraction
  and dreaming are validated against the real provider path **on device**, not in
  CI; the pipeline's LLM steps are mocked in unit tests at the
  `runOneShotCompletion` boundary.
- **Gates:** `pnpm typecheck --force` green; full user-client Vitest at the known
  8 Node-localStorage baseline ([[project_vitest_baseline_is_node_localstorage]]);
  Biome clean (no `!` non-null assertions — [[project_commit_gate_mechanics]]).
- **Catalogue/adapter note:** none here — memory reuses existing offerings, no
  catalogue change, so no dev-restart caveat.

---

## 9. Manual Verification (Chris, on device)

1. New persona, default `useMemory` on. The cockpit memory button is **present from
   the start** (not hidden), its on-demand actions greyed with reasons. Hold a short
   conversation revealing a few stable facts (a preference, a goal). After ~6 user
   messages, the badge shows a non-zero uncommitted count, and the **first-run note**
   appears once ("…starting to remember you…").
2. Open the overlay: extracted entries are sensible, not transient noise. Edit one;
   **reject** one and confirm the **"rejected · undo" toast** restores it within the
   window; commit one. Counts update.
3. Drive the conversation past the auto-commit threshold; confirm older uncommitted
   entries promote to committed without being touched, and the badge falls — but the
   button's **active-state** lights once a body version is written (HARD 1), and
   **clears** when you open the overlay.
4. Cross the dreaming threshold (or hit "consolidate now"); a memory body appears in
   the persona editor, integrating the committed facts; committed entries clear.
5. **On-demand reachability + failure (HARD 2/3):** with the badge at zero, confirm
   "learn from this chat now" and "consolidate now" are still reachable (greyed +
   reasoned when nothing to do, active when there is). Force a failure (provider off)
   on a user-invoked action and confirm it surfaces a named cause + **Retry**, not a
   silent dead-end.
6. Start a **fresh chat** with the same persona; confirm the body visibly informs
   the persona's responses (it "remembers"). Toggle `useMemory` off → it stops.
7. Edit the body manually; confirm a new version is written and rollback restores
   the previous one.
8. Reasoning-model check: run the whole pipeline on a reasoning offering (e.g. a
   thinking model) and confirm extraction/dreaming produce content — not the silent
   empty-content failure of the raw-body path.
9. Import a chatsune persona export that contains memories; confirm the journal +
   body arrive, the persona remembers immediately, and a **re-import is lossless**
   (no duplicate entries).

---

## 10. Deliberately not doing

These are not "deferred to v1.1"; they are conscious decisions with reasoning, so a
future reader does not naively re-open them.

- **No separate utility/cheap model for background memory calls.** The tempting
  token-cost lever is to run extraction + dreaming on a small cheap model instead of
  the persona's (possibly premium) offering. We deliberately **do not**, because
  memory must be produced by **the same model the user actually converses with**.
  Models differ enormously in how they interpret nuance — talking to DeepSeek vs GLM
  is "like two different cultures", and users *adapt* to their model. Memory written
  by a different model would describe the user through a foreign lens. Worse, a
  smaller model in the same family can carry **tighter RLHF guardrails** than its
  larger sibling (observed: GLM 4.7 already restrictive, GLM 4.7V markedly more so),
  so a "cheap helper" could quietly refuse or distort content the conversation model
  handles fine. Extraction + dreaming therefore always run on the persona's offering.
- **No global (cross-persona) user-memory layer.** Explicit no. Memory is
  per-persona; the user-authored "About Me" covers global self-description.
- **No project-scoped memory here.** Project memories *will* be needed, but they
  belong to the (sizeable) **project feature**, designed there, not bolted onto this
  spec.

## 11. Memory v2 — a later research project (out of scope)

A richer memory architecture (e.g. "memory palace" / `mempalace`-style structured
recall, semantic retrieval, per-category weighting, selective journal injection) is
explicitly a **separate, larger research effort** — Liz + Chris with a dedicated
"toy client" for running targeted conversations and evaluating approaches, sequenced
**parallel to the later federation work**, not part of this landing. v1 is the solid,
proven, whole-block chatsune port; v2 is the research. Nothing in v1 should be
gold-plated in anticipation of v2.
