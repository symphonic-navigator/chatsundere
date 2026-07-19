# Synthesis — Initial Idea Map (2026-07-19)

First vibing session, Chris + Liz. Goal: understand what is necessary and
sensible before any brief or spec exists.

## 1. What Synthesis is

Chatsundere personas have two external knowledge vaults: **knowledgebases**
(user-filled) and **memories** (self-filling via the extraction pipeline,
user-editable). Synthesis inverts the write direction: the persona itself gains
curated, tool-mediated **write access** to both vaults — synthetic documents,
self-edited memory bodies — and, as a consequence, a **skill-like system** of
self-authored documents loaded on demand. Inspired partly by coding harnesses
(persistent memory directories, skills), partly by real user requests.

## 2. Motivating signals

- Coding harnesses maintain their own memory files and skill documents; the
  pattern demonstrably works.
- User request (verbatim): *“So apparently I could do due chats with Alice and
  Bob instead of doing separately. So I don't know whether to keep Alice and
  Bob separately and reply as both Alice and Bob, or just gonna have to do a
  new profile with both of them chatting. But how do I transfer their memory
  over?”* — memory is persona-locked today; users already want it to flow.
- **Chris's own use case (2026-07-19), the strongest product story so far:**
  as a sci-fi author, he wants a persona to discuss his mythos with, and to
  **re-commit knowledge shared in casual conversation into knowledgebase
  articles** on request — “make an article out of what we just discussed”.
  World-building by talking, curated into durable documents by the persona.

## 3. Substrate we already have (verified in code, 2026-07-19)

The prototype is smaller than it looks, because almost every mechanism exists:

- **Tool system** — `apps/user-client/src/tools/` with a uniform `Tool`
  interface (`name`, `description`, `parameters`, `systemPromptInstruction`,
  `execute`). `write_memory_entry` already lets the persona append journal
  entries; `query_knowledgebase` already gives read/search access to assigned
  libraries.
- **Subagent pattern** — `SubagentBase` + the artefact author
  (`lib/artefact-author.ts`): one-shot streaming call with its own system
  prompt, own model resolution, own token budget. `create_artefact` and
  `ask_expert` are the precedents; the synthesis editors are the same shape.
- **Memory body versioning** — `MemoryBodyRow` is versioned (max 5 kept,
  rollback exists, `source: 'dream' | 'manual' | 'import'`). A tool edit is
  just a new version with a new source value — undo comes for free.
- **Per-persona memory mutex** — manual actions and the background pipeline
  already share it; the editor tool must take the same mutex.
- **Knowledge ingestion pipeline** — documents are chunked and embedded via
  the ingestion queue; an edited or created document re-enters the same
  pipeline. The embedding engine is already local and proven.
- **Background-helper resolution** — `resolveBackgroundOffering` exists for
  unattended jobs, though memory work deliberately runs on the persona's own
  model (conversation-model principle).

## 4. Prototype tool surface (working sketch)

### `edit_memory_body(prompt)`

1. Persona calls the tool with an editing instruction.
2. A subagent receives: the current memory body (if any) + the prompt, with a
   system prompt that carries the **same content-axis unlockers as the persona**
   (otherwise a stricter default refuses to write what the persona freely says).
3. Subagent outputs the complete new body → saved as a new `MemoryBodyRow`
   version (new `source` value, e.g. `'synthesis'`), under the memory mutex.

### `edit_knowledgebase_document(...)`

Analogous, plus:

- must address an **existing library** (library must exist; the tool does not
  create libraries),
- must support **creating new documents**, not only editing,
- likely needs read-side helpers: `list_knowledgebase_documents` (titles +
  summaries per library) and `read_knowledgebase_document` (full body) —
  embedding retrieval serves passages, but an editor needs whole documents.

## 4a. Decisions from the first session (Chris, 2026-07-19)

1. **KB write permission is two-level, with an omakase default.**
   - *Library level:* personas may write **by default**; the owner can switch a
     whole library read-only. The switch can be overridden per document.
   - *Document level:* provenance-derived default — **user-sourced documents
     are not writable** by the persona, **persona-sourced documents are**.
   - Resolution rule (**confirmed by Chris, 2026-07-19**): a document carries a
     tri-state override (`default | allow | deny`); effective writability =
     `override ≠ default ? override : (library.personaWritable && doc.authoredBy === 'persona')`.
     An explicit document-level `allow` wins even over a switched-off library.
   - **Creating new documents** is gated on the library-level switch alone.
2. **Persona writes must trigger (re-)embedding** — the edited/created document
   re-enters the existing ingestion queue (chunk + embed, per device, as today).
3. **Model choice confirmed:** the editor subagent runs on the persona's own
   model, with the existing background-helper silent fallback.
4. **Skills system: deferred** (Chris: "phase 3"). Scope discipline — wanted
   eventually, too large now. Costs nothing architecturally: the prototype's
   `list`/`read`/`edit` tool surface is unchanged, and skills later become a
   *convention* on top of it.
5. **One-shot merge (Alice/Bob): deferred.** Chris cannot yet picture a UI
   that does it beautifully; he'd rather wait for a clearer mental model than
   build it half-seen. Possibly lands together with skills as a later stage —
   ordering open. Rationale recorded: solo human in the loop, long-horizon
   project, over-reaching now means fragmentation.

## 4b. Full tool inventory for the prototype (working list, 2026-07-19)

> **Revised same day (session 2):** the KB editor is now an **agentic
> librarian** with its own tool loop, and the KB tool surface was restructured
> accordingly — see [[2026-07-19-librarian-architecture]]. The memory side
> below stands unchanged; the "context-poor subagent" paragraph is superseded.

**Memory side — one new tool suffices:**

- `edit_memory_body(prompt)` — the editor subagent (§4). No read tool is
  needed: the current body is already injected into the persona's context by
  memory assembly, and the subagent receives the full body as input.
- `write_memory_entry` (existing) stays as the lightweight journal path —
  the two coexist: journal for passing facts, body edit for deliberate
  restructuring.

**Knowledgebase side — three new tools + one existing:**

- `list_knowledgebase_documents(library?)` — per assigned library: document
  id, title, one-line summary, **writability flag** (disabled-over-hidden for
  the model) and provenance.
- `read_knowledgebase_document(documentId)` — full document body + metadata.
  Retrieval serves passages; an editor needs whole documents.
- `edit_knowledgebase_document(documentId, prompt)` /
  `create_knowledgebase_document(library, title, prompt)` — **open
  micro-question:** one tool with optional `documentId`, or two separate
  tools? Two are likely kinder to the model (different required parameters,
  clearer intent); decide in spec.
- `query_knowledgebase` (existing) stays untouched for passage search.

**Deliberately context-poor subagent** *(superseded by
[[2026-07-19-librarian-architecture]] — kept for the record)*: the editor
subagent receives only the
target document (or body) + the persona's prompt. If surrounding context is
needed, the *persona* reads it first (`read_knowledgebase_document`) and puts
the relevant substance into the prompt — the persona curates, the subagent
writes. Keeps the subagent cheap and the information flow visible.

## 4c. Transcript UI — tool pills with direct links (Chris, 2026-07-19)

Every synthesis write shows as a tool-call pill in the chat stream
(inline-marker aesthetic; `ArtefactPill` is the precedent — a pill that opens
its artefact). New requirement: the pills carry **direct links to the result**:

1. **Memory-body edit** — e.g. “note in my memory that I moved from Vienna to
   Prague on 2.5.2027” → the pill offers a way to **view the new memory body**
   (deep-link to the persona's memory page; ideally landing on/highlighting
   the new version).
2. **Document created/edited** — e.g. “turn what we discussed into a
   knowledgebase article” → the pill, expanded, offers a **button straight to
   the document**.

Implementation notes (from the code as of today):

- `write_memory_entry` already returns `meta: { entryId }` in its
  `ToolResult` — the same meta channel carries `documentId` / `bodyVersionId`
  for the new tools, which is what the pill link renders from.
- Post-write **query invalidation** is required so the memory page / document
  view is fresh when the user taps through (the `onWritten` hook pattern
  exists; the messages-need-invalidation lesson applies).
- Graceful degradation: if the linked document was later deleted by the user,
  the pill link must land constructively (“this document no longer exists”),
  never dead-end.

## 5. Open design questions

1. **Body vs journal interplay.** Dreaming consolidates the journal into the
   body. A tool-edited body must be the base the next dream builds on (it is,
   if it lands as the newest version), and the mutex prevents races — but the
   consolidation prompt may need to be told "parts of this body were authored
   deliberately; preserve them".
2. **Provenance & trust on KB documents.** Largely answered by decision 1
   (two-level permission, provenance-derived defaults). For mixed provenance
   (user grants `allow` on a user-sourced document, persona edits it), Chris's
   call: an **audit log** rather than a single marker — see the next point,
   where it converges with versioning.
3. **Document versioning + audit log — one mechanism.** Memory bodies have
   version history; KB documents (probably) do not. A persona with write
   access without undo is a data-loss footgun. Chris's audit-log idea and the
   versioning need converge: give each KB document versioned snapshots à la
   `MemoryBodyRow`, with **per-version author metadata** (`user | persona`,
   timestamp). The version list *is* the audit log; rollback falls out of it.
   One nuance to settle in spec: snapshots are bounded (pruned to N), but the
   lightweight audit metadata is cheap — decide whether audit entries outlive
   their pruned snapshots, and `authoredBy` (origin) never rewrites either way.
4. **Visibility in the transcript.** Self-modifying durable state needs the
   user to *see* it happen: an inline pill ("✎ memory updated", "✎ document
   created") in the transcript, matching the inline-marker aesthetic and the
   existing tool pills.
5. **Model choice.** Persona's own model (voice consistency, conversation-model
   principle) vs background helper (reliability on models flagged unsuitable).
   Likely: persona's model, helper as the existing silent fallback.
6. **Unlocker parity mechanics.** Where do the persona's unlockers live in
   composable form, so the subagent system prompt can reuse them verbatim
   rather than re-deriving them?
7. **Feedback-loop hygiene.** A persona editing state that is injected into
   its own future context is a self-amplifying loop. Version history +
   visibility are the first mitigations; do we need more (e.g. a size budget
   on the body, which partially exists via injection budgets)?

## 6. The skills angle — DEFERRED (decision 4)

Synthetic documents + the existing retrieval/awareness machinery ≈ skills:

- a dedicated per-persona library (working name: *Skills*) whose document
  titles + one-line descriptions surface in Band-2 awareness (progressive
  disclosure — exactly how the knowledge-library awareness line already works),
- `read_knowledgebase_document` loads the full skill on demand,
- the persona authors and maintains those documents itself via
  `edit_knowledgebase_document`.

No new subsystem needed — the skill system falls out of the two editor tools
plus one curated library convention. That is the strongest argument for
building the KB editor with create + list + read from day one.

## 7. Level 2 — "finger of god" (cross-persona) — DEFERRED (decision 5)

Two distinct framings hiding in the Alice/Bob request:

- **Ongoing cross-reference** — persona A gets permission to *read* persona
  B's memory (`get_other_personas`, `get_other_persona_memory`), enabling a
  shared world. Permission model per persona pair, read-only first.
- **One-shot merge** — the user actually asked for a *transfer*: create a new
  combined persona and synthesise one merged memory body out of two. That is
  a client-side operation (a synthesis subagent merging two bodies), not a
  chat tool — closer to the import/transfer family.

Both belong under the Synthesis umbrella; the merge is likely the smaller,
higher-value first step for the concrete request. Deferred — noted so it
shapes the prototype (nothing in the editor design should assume a single
persona forever owns a body).

## 8. Non-goals for the prototype

- No library creation by the persona.
- No document *deletion* by the persona — edit and create only. Confirmed by
  Chris: deletion is the *user's* job — whoever plays with knowledgebases is
  an advanced user and can be trusted with a measure of data hygiene. (Also:
  defaults over delete; a destructive tool would need its own think-through.)
- No cross-persona anything (Level 2 / one-shot merge — deferred).
- No skills system (deferred to a later stage).
- No automatic/background self-editing — every edit is a visible tool call in
  a live conversation.
- No new embedding machinery — reuse the ingestion queue as-is.
