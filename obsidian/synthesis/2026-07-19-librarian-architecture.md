# Synthesis — The Knowledge Librarian (2026-07-19, session 2)

Second vibing session, Chris + Liz, same day as [[2026-07-19-initial-idea-map]].
Chris returned from a walk with the frontloading idea (INDEX/PERSONA-style
convention files, modelled on this repo's own CLAUDE.md/STATUS.md schematic and
on Liz's harness memory directory) and asked for a ground-up understanding of
agentic loops. Both threads resolved into one architecture decision.

> **Revised same day** after an external architecture review (Codex, run by
> Chris as a "four AI eyes" pass; full text in
> [[librarian-architecture-codex-review]]). Verdict: no fatal conceptual
> contradiction — architecture direction **ready**, probe **ready once a probe
> contract exists**, product spec and implementation **not yet**. The review's
> load-bearing corrections are folded in below and marked *(review)*; its two
> code-level claims were verified against the real code before adoption
> (`tool-loop.ts` coupling and call accounting; the current `DocumentRow`
> shape — both confirmed). Three review recommendations that touch prior
> Chris decisions are **not** silently adopted; they sit in §7 for
> arbitration.

## 0. The pedagogical anchor: Chatsundere already ships an agentic loop

An agentic loop is a `for` loop around a model call: goal + tool list in, and
the model either answers (loop ends) or calls a tool (the harness executes it,
appends the result, calls the model again), until done or a round cap trips.

`runToolLoop()` in `apps/user-client/src/lib/tool-loop.ts` **is exactly this**
— stream one pass, execute tool-call pills via `dispatch`, append
`assistant(tool_calls)` + `tool` messages, re-stream, capped at
`MAX_TOOL_ROUNDS = 5` with a forced tools-free final answer. The persona is
already an agent every time it fires `generate_image` and keeps talking.

*(review, verified)* Reusable **in principle, not as a drop-in**: the current
loop is coupled to chat rendering — it accumulates every intermediate content
block and pill, reports token usage only from the last round, and logs the
first 100 characters of every tool argument to the console. The librarian
needs either a UI-independent agent-loop core or a librarian-specific wrapper
that returns at least `finalAnswer`, `executions[]`, `usageTotal`,
`roundsUsed`, `roundLimitReached`, `stoppedByAbort` — plus a distinct
final-round instruction for an honest partial report (not merely "no tools
now"), and internal tool pills kept out of the chat transcript while the one
outer pill shows progress.

## 1. Decision: the KB editor subagent becomes an agentic librarian

**Supersedes the "deliberately context-poor subagent" paragraph of
[[2026-07-19-initial-idea-map]] §4b** (marked there). Instead of the persona
curating context and a one-shot subagent writing a single nominated document:

- the persona **delegates** ("make an article out of what we just discussed"),
- the librarian orients itself from frontloaded material (§2), reads documents
  on demand, and edits/creates across the library in a multi-round tool loop
  (reusing the loop *mechanism* with its own deps — see the §0 caveat;
  `maxRounds` ≈ 6–8, spec decides),
- cost honesty *(corrected per review, verified against the loop)*: with
  `maxRounds` N the loop can make up to **N+1** model calls (each tool round
  plus the forced tools-free final pass) — 2–6 calls is a *typical* range,
  not the ceiling. A confirmed write needs at least two calls (the
  tool-producing pass and the report pass); a true one-call run performed no
  write. Accepted either way; the one-shot survives as the degenerate case.

The one-shot **remains** the shape of the memory side: `edit_memory_body`
stays loop-free as decided in §4a — the body is one small document the persona
already holds in context; there is nothing for a librarian to orchestrate.

Trigger unchanged (reaffirmed today): every run starts as a **visible tool
call in a live conversation** — the loop is internal, the trigger is never
background. The idea-map non-goal stands.

**Product-scope default *(review recommendation, leaning adopt)*: read
broadly, write narrowly.** The motivating request is singular; v1 defaults to
one primary document mutation per run. Multiple writes stay possible when the
brief explicitly asks for cross-document work, the conventions clearly require
a supporting document, or the librarian states why more than one mutation is
necessary. This keeps the agentic advantage (right target, no duplicates)
without a small request rewriting a library. Final call: Chris (§7).

## 2. Frontloading — what the librarian starts with

Placed into the librarian's fresh context at spawn, costing no loop rounds:

1. **A generated index** of the target library. *(reworded per review)* The
   index is **reconstructed from current database metadata at spawn and never
   maintained as a separate artefact** — that removes the stale-file failure
   mode of the harness MEMORY.md precedent, but is weaker than "structurally
   incapable of going stale": a user-authored summary can be semantically
   stale, and the snapshot can age *during* the run (another tab, a synced
   device, the librarian's own creations). One index row carries
   `documentId | currentVersionId | title | summary | role | origin |
   effectiveWritability | updatedAt` — IDs and revision tokens included, or
   the librarian cannot read or write safely without wasting rounds
   *(review)*. Index, conventions, permissions and initial revision set are
   assembled from one consistent read transaction where feasible. The hook
   comes from a new per-document **`summary` metadata field**, maintained by
   the librarian whenever it writes (and optionally by the user); length-
   capped and whitespace-normalised at the data layer. The same field feeds
   `list_knowledgebase_documents` and, later, Band-2 awareness for the
   deferred skills system.
2. **The library's conventions document** — Chris's "PERSONA.md" thought,
   landed as a **per-library** concern: a real KB document flagged
   `role: 'conventions'` (working name), carrying the styleguide, formalism
   rules (the Firsavaai use case), and where-does-what-go guidance. Being an
   ordinary document, it inherits versioning, writability, pills for free.
   Per-library because conventions are domain-scoped (a mythos styleguide has
   no business in a cooking library); a persona-global layer was considered
   and rejected for the prototype. *(review)* Conventions are **soft domain
   policy**: they shape style and filing but can never override permissions,
   tool limits, target scope, or the user's brief (authority order in §5);
   whether the persona may edit it by default is a Chris call (§7). Whether
   `role: 'conventions'` is excluded from normal semantic RAG and lore
   injection (a styleguide should not compete with world facts in retrieval)
   goes to the spec.
3. **The persona's brief** — the delegation argument, carrying the task and
   whatever conversational substance the persona chooses to pass along.
4. **A recent transcript window** *(added after Chris's practicality
   challenge, same day)* — the structural gap between the design and its
   inspiration: when Liz writes a vault note in the coding harness, she holds
   the full conversation in context; a librarian fed only a persona-distilled
   brief plays Chinese whispers, and a thin brief makes a thin article no
   matter how good the librarian is. Fix is cheap: frontload the recent
   conversation window alongside the brief. **Privacy honesty *(corrected per
   review)*:** the window's *origin* is local, but it is **sent to the
   librarian model's provider** — which, with a dedicated librarian slot, may
   be a *different* provider than the one the conversation itself runs on.
   The librarian-slot UI must say so plainly (the transcript slice and
   knowledge documents go to that model's provider); this is the
   artefact-expert privacy-note precedent, not a new invention. The window is
   **snapshotted at trigger time**, bounded by a **token budget** (not only a
   message count), and the spec decides which message types are included
   (whispers, roleplay-only material, tool results, attachments, compacted
   history). The model/deployment actually used is stored on the run and on
   every resulting document version.

## 3. Tool surface — two storeys

**Persona-facing (visible pills in the chat):**

- `synthesise_knowledge(library, brief)` — the single delegation tool that
  spawns the librarian.
- `list_knowledgebase_documents(library)` and
  `read_knowledgebase_document(id)` — kept persona-facing on Chris's explicit
  call: without them, user and persona hit the "what are we even talking
  about" wall — the persona needs first-class explicitness about what exists
  and what a document says, to ground the conversation and to discuss the
  librarian's output.
- Unchanged: `query_knowledgebase` (passage search), `write_memory_entry`
  (journal path).

**Librarian-facing (internal loop):** capability-scoped closures bound **in
code** to exactly one target `libraryId` — scope is never the model's to
preserve; a document ID from another library is rejected even if the persona
could otherwise read it *(review)*:

- `list_documents()`
- `search_documents(query, limit?)` *(added per review)* — the existing
  semantic retrieval, hard-bound to the target library, returning document
  ID, title, heading path, revision and passage provenance. An index of good
  summaries may carry a mature library; a legacy library with empty summaries
  would otherwise force the model to guess or read everything. List for
  orientation, search for candidate discovery, read for the full document —
  and **no replacement based on retrieved passages alone**; a full read of
  the expected current version comes first.
- `read_document(id)`
- `create_document(title, summary, body)`
- `replace_document(id, expectedVersionId, title, summary, body)` — the
  revision token is **required** *(review; also in the mocked probe tools)*.

Two separate write tools, not one with an optional id — the §4b
micro-question stays decided (distinct required parameters, clearer intent).
**Whole-body rewrite for v1** (Chris's call): the librarian emits the complete
new document — no exact-match edit failures, no retry rounds; document
versioning makes a bad rewrite *recoverable*. *(tempered per review)* It does
**not** by itself detect or prevent content loss, and "maximally robust for
weaker models" overstates it: the full Markdown body must travel inside a JSON
tool argument, which stresses tool-call formatting, provider output limits and
parsing on long documents. Consequences: the probe uses realistically long
fixtures (§5b); an explicit maximum safe replacement size per model context
budget; deterministic guards in the tool implementation (refuse or warn on
unexpected large shrinkage, vanished major headings, empty body — independent
of model behaviour); and write-body previews redacted from the loop's
console logging (today it prints the first 100 characters of the arguments).
String-replacement editing (the coding-harness Edit pattern) stays a possible
later optimisation. The "+/− lines" Chris values are a **display** concern
served by version diffs (idea map §5.3), not a write-mechanism concern.

No delete, no library creation — the §8 non-goals stand.

## 4. Report-back and visibility

The `synthesise_knowledge` call is **one pill** in the transcript. The loop's
forced final answer is the librarian's **report** — what it created/changed
and why. *(hardened per review)* That prose is **supplementary narrative
only**: the authoritative record is a harness-owned **execution ledger** —
every attempted tool execution with operation, target ID, resulting version
ID, success/failure and error reason, including **denied attempts**, so the
user-facing result cannot conceal them. Pill links and the changed-document
list render from the ledger, never from the model's own claims; the meta
channel carries the ledger's `documentId`s/`versionId`s (the
`write_memory_entry` → `entryId` precedent). Provider failure, abort and
round exhaustion after a partial mutation return the touched versions and an
honest `complete | partial | no-change` state. §4c of the idea map applies
unchanged, including query invalidation and the constructive deleted-document
fallback — with the refinement that the pill should link the exact resulting
version or diff, not merely the document's future current state (spec
decides). The report also states indexing status honestly: semantic retrieval
may lag a fresh write until re-ingestion completes.

## 5. Guard-rail wiring (previously decided, now placed)

- Two-level writability (§4a) is **shown** in the index/list output
  (disabled-over-hidden for the model, with provenance) and **enforced** on
  write: a denied write is a tool error with the reason, visible to the
  librarian inside the loop. *(sharpened per review)* **Denial is
  authoritative** — "seeing the reason" must never become "routing around
  it": no shadow copy of a read-only target; an alternative document only
  when the user asked for it or the brief makes it independently useful; and
  every denied attempt lands in the execution ledger (§4). If a library-level
  switch coexists with document-level overrides, name it
  `personaWriteDefault`, not "read-only".
- **Optimistic, versioned writes are the correctness mechanism** *(review —
  adopted)*: the per-library guard only prevents duplicate librarian runs (a
  Web Lock extends it across tabs); it cannot protect against a manual edit,
  another tab, a synced device, or a pulled remote update landing mid-run —
  which is exactly where whole-body replacement silently erases newer edits.
  Hence `expectedVersionId` on `replace_document`; existence, library
  membership, effective writability and the expected revision re-checked
  **inside the same transaction** that appends the version and updates the
  live document; a calm conflict error so the librarian re-reads and
  reconsiders. Version identity is designed for sync from day one: UUID
  version IDs plus `parentVersionId` (locally sequential numbers collide
  across devices); where practical, both competing snapshots survive even
  when conflict resolution picks one head.
- Every write lands as a new document version and re-enters the ingestion
  queue (chunk + embed) per decision 2. Version list = audit log (§5.3) —
  see §5c for the provenance split the review demanded.
- **Authority order** *(review — adopted)*: (1) hard system and tool
  constraints, (2) the explicit delegation brief, (3) the library conventions
  document, (4) transcript and ordinary knowledge documents as **untrusted
  source material, never instructions** — imported text with
  instruction-like content gets no policy weight (the probe tests this
  adversarially, §5b).
- Concurrency: the librarian does not take the per-persona *memory* mutex (it
  touches no memory); the per-library guard above covers duplicate runs.
- Unlocker parity (§5.6) is unchanged as an open spec question: the librarian
  system prompt must reuse the persona's content-axis unlockers verbatim;
  where they live in composable form is for the spec.
- Model resolution: the persona's own model by default, with the dedicated
  librarian slot of §5a. *(review challenge, Chris to arbitrate — §7)* The
  originally-decided **silent** background-helper fallback is contested: the
  background resolver's silence was designed for invisible best-effort
  chores, while synthesis is a visible action writing durable data — a
  silent provider change makes provenance *and* data disclosure surprising.
  Review's proposal: `explicit librarian slot → persona model → visible
  failure`, and if any fallback is kept, the pill discloses the actual
  model/provider while running and when done.

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
   our curated, freedom-oriented catalogue today. *(review caveat, accepted)*
   Vendor evidence and Terminal-Bench establish agentic tool use, **not**
   librarian quality (faithful prose synthesis, filing judgement,
   preservation under whole-document rewrites) — which is precisely why the
   probe of §5b, not benchmarks, decides.
2. **A separate librarian-model slot (decided, Chris 2026-07-19):** the
   librarian model can be set independently of the persona's — the
   artefact-expert is the exact precedent (dedicated strong model for the
   heavy lifting while the persona keeps the voice; for KB synthesis the
   voice argument is weak anyway, since the brief is persona-authored).
   Default remains the persona's own model. The librarian system prompt
   carries the corresponding tool-use nudges either way — diligence is
   prompted, not assumed. The slot UI carries the provider-disclosure note
   (§2.4).
3. **A curation leg, eventually:** librarian competence is a per-model
   capability like protocol compliance — the conversation-suite can grow a
   librarian leg, and a model that cannot hold the loop gets flagged,
   mirroring `unsuitableAsBackgroundWorker`. *(review refinement, adopted)*
   Qualification attaches to the concrete **model/provider/adapter
   deployment** where possible, not the canonical model alone — tool-call
   behaviour varies by route (our own curation history keeps proving this).
   Not prototype scope; noted so the capability-flag pattern is the expected
   home.

**Accepted honestly:** there is no automated quality oracle for prose (no
tests, no typecheck). The reviewer is the user, via pill link + version diff
+ rollback. The feature accelerates curation; it does not replace the
curator's last mile.

## 5b. De-risking before any spec: the synthesis probe

The open question "will results be good enough?" is measurable, not
guessable — empirical truth over docs, applied to our own design. Before a
spec exists, run a **synthesis probe** in the curation-harness style. This
probe is the agreed next concrete step before Brief/spec work.

*(expanded per review — "zero spec" means no product/UI spec, not no
experimental contract; freeze a short probe protocol first so results are
reproducible and comparable.)*

**Baselines — the load-bearing comparison.** Run at least: (1) a frontloaded
**one-shot writer** given the target explicitly, (2) the **agentic
librarian** with list/search/read/write tools, (3) optionally the persona
model without a dedicated slot. If the agentic version does not beat the
one-shot on target selection, duplicate avoidance, convention adherence or
preservation, the main use case is better served by the simpler design — the
probe, not attachment to the architecture, decides that boundary.

**Fixtures — several task shapes, not one favourable conversation:** create
(real conversation with side chatter and corrections + a styleguide); update
(merge into an existing document whose seeded facts and headings must
survive); discovery (create-vs-update among similarly named documents, some
summaries absent); permissions (a relevant read-only document, no shadow-copy
bypass); conflict (revision conflict → re-read → safe recovery); adversarial
authority (instruction-like text in an imported document gets no policy
weight); scale (a realistically long document whose body is a substantial
tool argument).

**Predeclared dimensions:** source-fact coverage; invented facts;
preservation of existing facts/structure; create-vs-update correctness;
duplicate avoidance; convention compliance; scope/permission compliance;
conflict recovery; rounds and tool calls; token cost and elapsed time;
agreement between model report and execution ledger; usefulness of the
resulting diff.

**Hard gates — automatic fail regardless of prose quality:** any
cross-library or unauthorised write; silent overwrite of a newer revision; a
final report claiming writes absent from the ledger; loss of executed version
IDs after partial failure; a silent provider fallback carrying transcript
data elsewhere; substantial content deletion without recovery evidence.

Serial runs (house rule), more than one run per candidate, recording exact
model, provider, adapter, reasoning configuration, system prompt, tool
schemas, tool trace and fixture version — one attractive output is evidence
of possibility, not reliability. Two or three models of different strength
(e.g. a GLM/Kimi/DeepSeek-class open frontier model vs a mid-tier one). An
afternoon, zero UI, and "is it good enough / from which model class up" has
data instead of feelings.

**P0 — folded into the probe contract before it runs** *(review)*: the
capability boundary and authority order frozen; IDs + revision tokens in the
index/read contract; `expectedVersionId` on replacement even in mocked tools;
model/provider resolution and transcript disclosure defined; the execution
ledger and partial-result behaviour defined; scoped search in the toolset;
the one-shot baseline and rubric above.

## 5c. Data-model implications *(review — acknowledged as real scope)*

The current `DocumentRow` (verified) has no summary, role, origin, permission
override or version history — so the feature is materially larger than "a
system prompt plus a few tools": data migration, sync semantics for versions,
version storage, rollback/diff UI. Named early so the spec does not
under-scope. Review's recommended shape, adopted as the working basis:

- **Document:** `id, libraryId, title, summary, role: normal|conventions,
  origin: user|persona|import|system, personaWriteOverride:
  default|allow|deny, currentVersionId, createdAt, updatedAt`.
- **DocumentVersion:** `id, documentId, parentVersionId, title, summary,
  body, actorKind: user|persona|import|system, personaId, modelRef,
  sourceChatId, sourceMessageId|synthesisRunId, createdAt`.

Principles: **`origin` and per-version actor are separate concepts** — a
document's origin stays stable when someone else edits it, while every
version records who/what wrote it (concrete persona ID, not just
`'persona'`); title, summary and body version **together** (rollback can
never restore a body under a mismatched title); rollback **appends** a
restoration version, never erases history; legacy documents backfill a
conservative origin (`user`/`import`) so existing content is not
persona-writable by default; whether lightweight audit metadata survives
pruning of old body snapshots is a spec question.

## 5d. One model-aware budget *(review — adopted)*

Index, conventions, transcript window, brief, read results, tool exchanges,
reasoning and complete replacement bodies all share one context window; each
was bounded informally, the total was not. The synthesis run computes a total
input/output budget from the resolved offering's **recommended** context (not
its advertised maximum), reserves output space for a whole-document write
plus final report *before* admitting frontloaded context, caps or paginates a
very large index with omissions signalled, bounds conventions and transcript
independently within the whole, and refuses unsafe whole-body editing when
the complete source document cannot fit. The exact source version used is
preserved for every write.

## 6. Open for the spec (new since session 1)

1. Exact `maxRounds` for the librarian, and what its forced final round says
   when it ran out of rounds mid-plan (honest partial report — now a
   first-class loop-wrapper requirement, §0).
2. Shape of the generated index line and the `summary` field (length budget;
   who backfills summaries for pre-existing documents — "empty until first
   librarian touch, user-editable" must not leave the librarian blind on
   legacy libraries indefinitely; `search_documents` (§3) is the mitigation,
   a deterministic body-derived fallback hook the alternative).
3. The `role: 'conventions'` flag mechanics: exactly one per library?
   Created by whom, when (lazily on first synthesis run vs by the user)?
   Whether the librarian may touch it without an explicit
   convention-maintenance brief; whether it is excluded from semantic RAG
   and lore injection (§2.2).
4. Whether the per-library run guard surfaces to the persona as a calm busy
   tool error (mirroring the memory-mutex busy toast) — probably yes.
5. Transcript-window token budget and included message types (whispers,
   roleplay, tool results, attachments, compacted history) — §2.4.
6. UI home of the librarian-model slot (§5a.2) — likely beside the
   background-helper and artefact-expert slots in the persona hub, with the
   same disabled-with-reason and freedom-filter conventions, plus the
   provider-disclosure note.
7. Multi-persona authorship on a shared library: may every assigned persona
   edit any persona-origin document, or only its own creations? *(review)*
8. Version/diff deep links from the pill (exact version vs current head) and
   the deleted-document fallback wording; progress, cancellation, round
   exhaustion and partial-completion UX. *(review)*
9. Sync conflict and version-branch behaviour for `DocumentVersion` rows
   (§5c), and pruning-vs-audit policy. *(review)*

## 7. Review points awaiting Chris's arbitration

Three places where the review challenges something previously decided or
still open at product level — deliberately **not** folded silently:

1. **Silent background-helper fallback for the librarian model** (§5).
   Decided in session 2 as "background-helper as silent fallback"; the review
   argues synthesis is a visible, durable-data action and proposes
   `slot → persona model → visible failure`, or at minimum disclosure of the
   actual model/provider in the pill. Liz's read: the review is right on the
   provider-boundary argument — this mirrors our own artefact-expert
   "no silent fallback" call (Chris's call, 2026-07-06) more than it mirrors
   the background chores.
2. **Conventions document persona-editability** (§2.2). Session 2 gave the
   conventions document full ordinary-document behaviour including persona
   editability; the review recommends persona read-only by default, with the
   user granting the document-level write override when persona maintenance
   is wanted.
3. **"Read broadly, write narrowly" as the v1 default** (§1). Recommended by
   the review, leaning adopt; it constrains the librarian's autonomy per run
   and deserves an explicit product call rather than a silent default.
