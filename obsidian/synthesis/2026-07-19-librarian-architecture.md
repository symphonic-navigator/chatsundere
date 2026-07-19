# Synthesis — The Knowledge Librarian (2026-07-19, session 2)

Second vibing session, Chris + Liz, same day as [[2026-07-19-initial-idea-map]].
Chris returned from a walk with the frontloading idea (INDEX/PERSONA-style
convention files, modelled on this repo's own CLAUDE.md/STATUS.md schematic and
on Liz's harness memory directory) and asked for a ground-up understanding of
agentic loops. Both threads resolved into one architecture decision.

## 0. The pedagogical anchor: Chatsundere already ships an agentic loop

An agentic loop is a `for` loop around a model call: goal + tool list in, and
the model either answers (loop ends) or calls a tool (the harness executes it,
appends the result, calls the model again), until done or a round cap trips.

`runToolLoop()` in `apps/user-client/src/lib/tool-loop.ts` **is exactly this**
— stream one pass, execute tool-call pills via `dispatch`, append
`assistant(tool_calls)` + `tool` messages, re-stream, capped at
`MAX_TOOL_ROUNDS = 5` with a forced tools-free final answer. The persona is
already an agent every time it fires `generate_image` and keeps talking. The
synthesis subagent needs no new loop mechanism — only its own system prompt,
tool list and context (the isolation pattern `SubagentBase` +
`artefact-author.ts` already provide, minus tools).

## 1. Decision: the KB editor subagent becomes an agentic librarian

**Supersedes the "deliberately context-poor subagent" paragraph of
[[2026-07-19-initial-idea-map]] §4b** (marked there). Instead of the persona
curating context and a one-shot subagent writing a single nominated document:

- the persona **delegates** ("make an article out of what we just discussed"),
- the librarian orients itself from frontloaded material (§2), reads documents
  on demand, and edits/creates across the library in a multi-round tool loop
  (reusing `runToolLoop` with its own deps; `maxRounds` ≈ 6–8, spec decides),
- cost honesty: 2–6 model calls per synthesis instead of 1 — accepted; the
  one-shot survives as the degenerate case (a loop that finishes in one round).

The one-shot **remains** the shape of the memory side: `edit_memory_body`
stays loop-free as decided in §4a — the body is one small document the persona
already holds in context; there is nothing for a librarian to orchestrate.

Trigger unchanged (reaffirmed today): every run starts as a **visible tool
call in a live conversation** — the loop is internal, the trigger is never
background. The idea-map non-goal stands.

## 2. Frontloading — what the librarian starts with

Placed into the librarian's fresh context at spawn, costing no loop rounds:

1. **A generated index** of the target library — one line per document: title,
   one-line hook, writability, provenance. Built fresh from the DB each run,
   so it is **structurally incapable of going stale** — deliberately unlike
   the harness MEMORY.md precedent, which the agent must maintain by hand and
   which lies when neglected (the stale-STATUS failure mode). The hook comes
   from a new per-document **`summary` metadata field**, maintained by the
   librarian whenever it writes (and optionally by the user on user-sourced
   documents). The same field feeds `list_knowledgebase_documents` and, later,
   Band-2 awareness for the deferred skills system.
2. **The library's conventions document** — Chris's "PERSONA.md" thought,
   landed as a **per-library** concern: a real KB document flagged
   `role: 'conventions'` (working name), carrying the styleguide, formalism
   rules (the Firsavaai use case), and where-does-what-go guidance. Being an
   ordinary document, it inherits everything for free: versioning, writability,
   pills, user *and* persona editability. Per-library because conventions are
   domain-scoped (a mythos styleguide has no business in a cooking library);
   a persona-global layer was considered and rejected for the prototype.
3. **The persona's brief** — the delegation argument, carrying the task and
   whatever conversational substance the persona chooses to pass along.

## 3. Tool surface — two storeys

**Persona-facing (visible pills in the chat):**

- `synthesise_knowledge(library, brief)` — the single delegation tool that
  spawns the librarian.
- `list_knowledgebase_documents(library)` and
  `read_knowledgebase_document(id)` — kept persona-facing on Chris's explicit
  call: without them, user and persona hit the "what are we even talking
  about" wall — the persona needs first-class explicitness about what exists
  ("which documents are in KB y, with summaries") and what a document says,
  to ground the conversation and to discuss the librarian's output.
- Unchanged: `query_knowledgebase` (passage search), `write_memory_entry`
  (journal path).

**Librarian-facing (internal loop):** the same `list`/`read` implementations
(shared code, offered in both contexts) plus the write tools:

- `create_document(title, summary, body)`
- `replace_document(id, summary, body)`

Two separate tools, not one with an optional id — the §4b micro-question is
hereby decided (distinct required parameters, clearer intent). **Whole-body
rewrite for v1** (Chris's call): the librarian emits the complete new
document. Maximally robust for weaker models (no exact-match edit failures,
no retry rounds); the token cost on long documents and the weak-model
content-loss risk are accepted because document versioning catches the
latter. String-replacement editing (the coding-harness Edit pattern) is a
possible later optimisation, not prototype scope. The "+/− lines" Chris
values are a **display** concern served by version diffs (idea map §5.3),
not a write-mechanism concern.

No delete, no library creation — the §8 non-goals stand.

## 4. Report-back and visibility

The `synthesise_knowledge` call is **one pill** in the transcript. The loop's
forced final answer is the librarian's **report** — what it created/changed
and why. That report becomes the tool result (so the persona can talk about
it) and carries the touched `documentId`s over the existing `meta` channel
(the `write_memory_entry` → `entryId` precedent), from which the pill renders
**direct links to every touched document** — §4c of the idea map applies
unchanged, including query invalidation and the constructive
deleted-document fallback.

## 5. Guard-rail wiring (previously decided, now placed)

- Two-level writability (§4a) is **shown** in the index/list output
  (disabled-over-hidden for the model, with provenance) and **enforced** on
  write: a denied write is a tool error with the reason, visible to the
  librarian inside the loop so it can route around it.
- Every write lands as a new document version, `authoredBy: 'persona'`
  (version list = audit log, §5.3) and re-enters the ingestion queue
  (chunk + embed) per decision 2.
- Concurrency: the librarian does not take the per-persona *memory* mutex (it
  touches no memory), but an analogous per-library guard prevents two
  concurrent librarian runs on one library.
- Unlocker parity (§5.6) is unchanged as an open spec question: the librarian
  system prompt must reuse the persona's content-axis unlockers verbatim;
  where they live in composable form is for the spec.
- Model resolution as decided: the persona's own model, background-helper as
  silent fallback.

## 6. Open for the spec (new since session 1)

1. Exact `maxRounds` for the librarian, and what its forced final round says
   when it ran out of rounds mid-plan (honest partial report).
2. Shape of the generated index line and the `summary` field (length budget;
   who backfills summaries for pre-existing documents — likely "empty until
   first librarian touch, user-editable").
3. The `role: 'conventions'` flag mechanics: exactly one per library?
   Created by whom, when (lazily on first synthesis run vs by the user)?
4. Whether the per-library run guard surfaces to the persona as a calm busy
   tool error (mirroring the memory-mutex busy toast) — probably yes.
