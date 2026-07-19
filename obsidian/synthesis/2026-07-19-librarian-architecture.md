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
4. **A recent transcript window** *(added after Chris's practicality
   challenge, same day)* — the structural gap between the design and its
   inspiration: when Liz writes a vault note in the coding harness, she holds
   the full conversation in context; a librarian fed only a persona-distilled
   brief plays Chinese whispers, and a thin brief makes a thin article no
   matter how good the librarian is. Fix is cheap: frontload the recent
   conversation window alongside the brief (all local, no privacy surface,
   input tokens only). "Make an article out of what we just discussed"
   becomes literal rather than brief-mediated. Window size is a spec knob.

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
- Model resolution: the persona's own model by default, background-helper as
  silent fallback — **plus the synthesis-expert option below (§5a)**.

## 5a. Model quality is the load-bearing wall — and the plan for it

*(Added after Chris's practicality challenge: "is this actually going to
produce good results, or is it tools-plus-hope?")*

Everything the design imitates (Liz in Claude Code, Claude Desktop + Obsidian
as "extreme AI memory") runs on frontier-class models. Chatsundere personas
run on arbitrary models, and a model can be a wonderful conversationalist and
a poor librarian at once (whole-body rewrites that drop content, muddled
filing decisions). The feature's result quality will track librarian-model
quality. Three-part plan:

1. **Chris's read of the model landscape (2026-07-19):** the open frontier —
   GLM 5.2, Kimi from 2.5, DeepSeek from 3.2 — scores well on terminal-bench
   and knowledge-work benchmarks and uses tools diligently; not
   Claude/ChatGPT-class curated, but genuinely agentic. The counter-example
   is also known first-hand: Gemma 4's notorious tool-call laziness
   (reportedly fixed in newer versions). In an ideal world Opus would be the
   librarian; that train has left for now — see
   [[../FREEDOM-CRITERIA|freedom criteria]] — unless an "AI perestroika"
   reaches San Francisco. Conclusion: viable librarian models exist within
   our curated, freedom-oriented catalogue today.
2. **A separate librarian-model slot (decided, Chris 2026-07-19):** the
   librarian model can be set independently of the persona's — the
   artefact-expert is the exact precedent (dedicated strong model for the
   heavy lifting while the persona keeps the voice; for KB synthesis the
   voice argument is weak anyway, since the brief is persona-authored).
   Default remains the persona's own model. The librarian system prompt
   carries the corresponding tool-use nudges either way — diligence is
   prompted, not assumed.
3. **A curation leg, eventually:** librarian competence is a per-model
   capability like protocol compliance — the conversation-suite can grow a
   librarian leg, and a model that cannot hold the loop gets flagged,
   mirroring `unsuitableAsBackgroundWorker`. Not prototype scope; noted so
   the capability-flag pattern is the expected home.

**Accepted honestly:** there is no automated quality oracle for prose (no
tests, no typecheck). The reviewer is the user, via pill link + version diff
+ rollback. The feature accelerates curation; it does not replace the
curator's last mile.

## 5b. De-risking before any spec: the synthesis probe

The open question "will results be good enough?" is measurable, not
guessable — empirical truth over docs, applied to our own design. Before a
spec exists, run a **synthesis probe** in the curation-harness style: take a
real slice of mythos conversation, hand a candidate model the frontloading
package (generated index + conventions document + brief + transcript window)
with mocked tools, and judge the output — serially, on two or three models of
different strength (e.g. a GLM/Kimi/DeepSeek-class open frontier model vs a
mid-tier one). An afternoon, zero UI, and the "is it good enough / from which
model class up" question has data instead of feelings. This probe is the
agreed next concrete step before Brief/spec work.

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
5. Transcript-window size for the librarian's frontloading (§2.4), and
   whether whisper/roleplay filtering rules apply to that window.
6. UI home of the librarian-model slot (§5a.2) — likely beside the
   background-helper and artefact-expert slots in the persona hub, with the
   same disabled-with-reason and freedom-filter conventions.
