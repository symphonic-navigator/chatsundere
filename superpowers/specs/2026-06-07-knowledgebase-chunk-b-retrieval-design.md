# Knowledgebase — Chunk B (Retrieval) — Design

**Date:** 2026-06-07
**Author:** Liz (with Chris, brainstormed end-to-end)
**Status:** Approved design, ready for implementation plan
**Roadmap:** Block 5 → v0.2.0 (knowledge base). Client-only.

---

## 1. Context & overall feature

Chatsundere's knowledgebase is built as three independently valuable chunks on the
value ladder *manage → use → automatic*:

- **Chunk A (shipped, `0ef499f`, device-confirmed) — Foundation.** Data model,
  on-device ingestion (chunking + embedding), the library/document management UI,
  the *My Knowledge* room. A user can create libraries, add documents, watch them
  embed locally — but nothing reaches a chat yet.
- **Chunk B (this spec) — Retrieval.** A companion can *use* the knowledgebase:
  the `query_knowledgebase` tool, persona ↔ library assignment, ad-hoc chat ↔
  library binding, and model awareness of which libraries are available. The model
  decides when to look something up; retrieval is scoped strictly to the assigned
  libraries.
- **Chunk C (later) — Lorebooks.** Phrase-triggered injection: trigger phrases on
  a document, scan the latest user message, inject the document as hidden context.

**Out of scope for Chunk B, by deliberate decision:**

- **Attach document** — attaching a single document's *full* content to a message
  (an attachment-like flow, not retrieval). Chris has UX ideas for it; it earns its
  own brainstorming session and ships as a separate small chunk afterwards.
- **Lorebooks / phrase-triggered injection** (Chunk C).
- A `tags`-set-membership filter in `packages/embeddings` (a later optimisation —
  see §9).
- A per-model tokeniser for sizing retrieved context (the existing heuristics
  suffice).

This is **not a Larissa change** (client-only plus a minimal `llm-unified`
addition; no auth/sync/proxy/crypto surface).

### Foundation this chunk builds on (verified)

- The `knowledge` vector collection already stores every chunk with
  `tags.{libraryId, documentId}`, `numeric.chunkIndex`, and
  `metadata.{text, headingPath}` (Chunk A, `start-ingestion.ts`).
- The retrieval call shape is verified live in the browser console (Chris's smoke
  probe, 2026-06-07):

  ```js
  const engine = await getEmbeddingEngine();
  const store = getKnowledgeVectorStore();
  const [vec] = await engine.embed([query], { kind: 'query' });
  const hits = await store.query({ collection: KNOWLEDGE_COLLECTION, vector: vec, topK: 5 });
  // hits[i] = { id, score, numeric, metadata: { text, headingPath } }
  ```

  Hit scores cluster ~0.57 for matching chunks vs ~0.10 for unrelated content —
  clean semantic separation, and the basis for the `minScore` floor in §4.
  Production differs from this probe in exactly one way: it adds a per-library
  `filter: { tags: { libraryId } }`.
- The tool spine (`resolveActiveTools(ctx)` + the tool-execution loop) and the
  banded system-prompt builder (`buildPrompt`) are both in place from earlier work.

---

## 2. Architecture — where `query_knowledgebase` plugs in

`query_knowledgebase` is **not** an `Integration`. An `Integration` (e.g.
`web-interfacing`) wraps a credential-gated external *Offering* (provider + API key
+ adapter + a `ServiceKind` capability). Knowledgebase retrieval is **purely local**:
no offering, no key, no adapter, no `ServiceKind`. It is *context-gated* (active only
when libraries are assigned) but never *provider-gated*.

It therefore becomes a **third tool category — context tools**: tools derived from
runtime context but built locally, without the Integration/Offering machinery.

```
resolveActiveTools(ctx)  =  STATIC_TOOLS               (calculate_js)
                          + INTEGRATIONS.contributeTools(ctx)   (web_*)
                          + contributeKnowledgeTools(kctx)      (query_knowledgebase)
```

Rejected alternatives:

- **Extend `ServiceKind` with `'knowledge'`** and model KB as an offering-less
  pseudo-Integration. Rejected: it lies about the semantics (Integrations are
  provider-keyed by definition) and forces an `llm-unified` type change for
  something that is not a service.
- **Make KB a second `STATIC_TOOL`** that self-disables on an empty library set.
  Rejected: it disguises a context-gated tool as always-on, so the model would see
  the tool even with no libraries assigned — against the gating pattern the web
  tools already follow.

### New / changed files

- `apps/user-client/src/knowledge/query-tool.ts` *(new)* — `contributeKnowledgeTools`,
  the retrieval execution, and the result formatter.
- `apps/user-client/src/knowledge/effective-libraries.ts` *(new)* — pure
  computation of the effective library set (union → existence → NSFW filter).
- `apps/user-client/src/tools/registry.ts` — `resolveActiveTools` gains the
  context-tools slot.
- `apps/user-client/src/state/stream-manager.store.ts` — builds the knowledge
  context per send (effective libraries + a `retrieve` closure) and threads it into
  `resolveActiveTools`; derives the awareness string for the prompt builder.
- `apps/user-client/src/boot/client-data-db.ts` — Dexie **v15** (`libraryIds` on
  personas and chats).
- `apps/user-client/src/data/knowledge.ts` — `deleteLibraryCascade` prunes bound IDs.
- `apps/user-client/src/data/personas.ts`, `.../chats.ts` — assignment mutations/hooks.
- `apps/user-client/src/routes/app/persona-editor.tsx` — a Knowledge assignment section.
- `apps/user-client/src/components/chat/Cockpit.tsx` (+ a new knowledge sheet
  component) — the ad-hoc chat-binding affordance.
- `packages/llm-unified/src/composition.ts` — a Band-2 `knowledgeLibraries` segment.

---

## 3. Data model (Dexie v15)

- `PersonaRow.libraryIds: string[]` — libraries **assigned** to the persona;
  available in every chat with it. Migration backfills `[]`.
- `ChatRow.libraryIds: string[]` — ad-hoc additions for *this chat only*. Backfill `[]`.
- No join table, no new vector store: Chunk A's `knowledge` collection already
  carries the `libraryId` tag.

**Deletion integrity.** `deleteLibraryCascade(id)` is extended to also prune `id`
from every persona's and chat's `libraryIds` (a scan of both tables, updating only
rows that contained it). Without this, deleting a library would leave dangling
references. The effective-set computation (§4) additionally ignores non-existent IDs
defensively, so a missed prune can never surface a phantom library.

---

## 4. Retrieval flow

### Effective library set (per send)

Computed in `effective-libraries.ts`, called by the stream-manager:

```
ids       = unique(persona.libraryIds ∪ chat.libraryIds)
existing  = ids ∩ { libraries that currently exist }
effective = nsfwAllowed ? existing : existing.filter(lib => !lib.nsfw)
```

If `effective` is empty → **no `query_knowledgebase` tool and no awareness segment**
(gating identical to the web tools).

### Execution — `query_knowledgebase({ query })`

The tool takes exactly one parameter: `query: string`. It searches the **union of
the effective libraries** — never the whole knowledgebase.

1. `vector = (await getEmbeddingEngine()).embed([query], { kind: 'query' })[0]`.
2. For each library in `effective`:
   `store.query({ collection: 'knowledge', filter: { tags: { libraryId } }, vector, topK, minScore, candidateK })`.
3. Merge all hits, sort by `score` descending, slice to the global `topK`.
4. Resolve provenance per hit: `libraryId → library.name` (known per query call),
   `documentId` (parsed from the chunk `id` `${documentId}#${chunkIndex}`) →
   `document.title`, and `metadata.headingPath`.

**Why per-library queries.** The store's `VectorFilter.tags` does tag *equality*
only, not set membership. With a handful of assigned libraries the repeated scans
are negligible at local scale. A `tags`-set filter in `packages/embeddings` is a
clean later optimisation (§9), not a Chunk-B blocker.

**Tuning defaults** (device-tunable knobs for Chris): `topK = 6`, `minScore ≈ 0.35`,
`candidateK` over-fetch per library (e.g. 24) before the global slice.

### Result format returned to the model

Markdown, one block per hit (mirrors chatsune's `RetrievedChunkDto`):

```
[Farblehre › Grundlagen › Farbkraft]  (0.57)
<chunk text>

---

[Reise-Japan › Kyoto › Tempel]  (0.41)
<chunk text>
```

Empty result → a constructive string rather than an error:
*"No relevant passages found in the assigned knowledge libraries."* (the *dere*
principle — every failure surfaces the next step).

**Persistence boundary.** The result is persisted in the pill payload for display,
but the tool exchange is **not** replayed across turns (consistent with
`calculate_js` and the web tools); the model's final answer carries the knowledge
forward.

---

## 5. Model awareness — Band-2 prompt segment

So the model knows *what* it can look up (and therefore reaches for the tool), the
effective libraries are surfaced in the system prompt.

- A new **Band-2** (Context & Knowledge) segment `knowledgeLibraries` in
  `composition.ts`, ordered after `memories` (band 2, order 3), `CHAT_ONLY`.
- Input: a pre-rendered string on `BuildPromptInputs`
  (`knowledgeLibrariesContext: string`), built client-side from the effective
  libraries' `{ name, description }` — consistent with how `aboutMe`/`memories` are
  passed as pre-rendered strings. Empty string → the segment drops out (existing
  whitespace-drop behaviour).
- Rendered shape, for example:

  > You can search the user's knowledge libraries with `query_knowledgebase`.
  > Available libraries:
  > - **Farblehre** — notes on colour theory.
  > - **Reise-Japan** — Japan travel documents.
  >
  > Search them when a question may be covered there rather than answering from
  > memory.

- The *when-to-use* tool nudge itself stays a **Band-3** tool instruction carried on
  the tool via `systemPromptInstruction` (the existing mechanism), so it appears
  only alongside the live tool.
- The same NSFW filter (§7) governs the awareness list: an SFW send never names an
  NSFW library.

The `llm-unified` change is minimal: one input field plus one segment registry
entry. **Not Larissa-relevant.**

---

## 6. UX (mechanics; styling is a separate pass by Chris)

### 6.1 Persona editor — assignment

A new **Knowledge** section in `persona-editor.tsx` (alongside context window,
avatar, etc.): the libraries listed with a toggle each, writing `persona.libraryIds`.
An SFW persona is offered only `!nsfw` libraries; an adult persona sees all (mirrors
`useFilteredLibraries` and chatsune's persona knowledge tab). Empty state → a
friendly note linking to *My Knowledge*.

### 6.2 Cockpit — ad-hoc binding + transparency

A compact knowledge affordance in the cockpit opens a bottom-sheet
(`.knowledge-sheet-root`, exempted from `InteractionMode`'s unpinned outside-tap
handler like the other sheet overlays):

- Persona-assigned libraries shown **locked-on** (visible for transparency, not
  deselectable — they show what the companion already draws on).
- The remaining (NSFW-filtered) libraries are toggleable, writing `chat.libraryIds`.
- Empty state → a note linking to *My Knowledge*.

The affordance carries a subtle active indicator (e.g. a count) when ≥1 library is
effective — **no permanent pill chrome**. The retrieval act itself shows as a tool
pill in the stream (§6.3), which is the "it looked something up" signal.

### 6.3 Retrieval pill (stream)

`query_knowledgebase` renders as a tool pill like `calculate_js`: tap-to-expand
shows the **query and the hits with provenance** (library › document › heading,
score, snippet) — the transparency surface for what the companion retrieved.

---

## 7. NSFW gating (three consistent layers)

1. **Assignment UI** offers NSFW libraries only to adult personas / in NSFW mode
   (persona editor and cockpit sheet both).
2. **Send-time filter:** the effective set is filtered by `nsfwAllowed`, so even a
   historically-bound NSFW library drops out in SFW mode — for **both** retrieval
   and the awareness segment.
3. **Tool gating:** the tool is not contributed at all when the filtered set is
   empty.

`nsfwAllowed` is the active persona's `adultPersona` flag, exactly as the existing
`IntegrationContext` already derives it.

---

## 8. Error handling & edge cases

- **Embedding engine fails to load / model not provisioned:** the tool returns a
  constructive `{ ok: false, error }`; the chat is unaffected. (The engine is
  self-hosted at `/model/`; if absent, the same surfacing as Chunk A applies.)
- **Document not `ready`:** its chunks are simply absent from the store and never
  matched — no special case.
- **Assigned-but-deleted library:** removed by the cascade prune (§3); the
  effective-set computation also ignores non-existent IDs defensively.
- **Unknown tool name / hallucinated args:** handled by the existing `dispatch`
  fallback (structured error, no throw).
- **Query with no effective libraries:** structurally impossible — the tool is not
  offered when the effective set is empty.

---

## 9. Deferred / follow-ups

- **Attach document** — separate UX session + chunk (Chris's ideas).
- **Lorebooks / phrase-triggered injection** — Chunk C.
- **`tags`-set-membership filter in `packages/embeddings`** — to replace the
  per-library queries with a single scored scan over the bound set. A clean
  optimisation once library counts grow; logged in `follow-ups-index`.
- **Per-model tokeniser** for sizing retrieved context against the persona window —
  the current heuristics suffice.

---

## 10. Testing

- **Unit:**
  - effective-library-set computation (union, existence intersection, NSFW filter).
  - `contributeKnowledgeTools` — empty effective set → no tool; non-empty → one tool
    with the correct definition.
  - retrieval merge + global top-K + provenance resolution; result formatter
    (including the empty-result constructive string).
  - `deleteLibraryCascade` prunes IDs from personas and chats.
  - Dexie v15 migration + backfill (verno assertions bumped 14 → 15).
  - the Band-2 `knowledgeLibraries` segment producer (rendered text, empty-drop,
    CHAT_ONLY, NSFW filtering of the list).
- **UX:** persona Knowledge section toggle; cockpit knowledge sheet (locked-on vs
  toggleable, NSFW filtering, empty state); retrieval pill expand.
- **Full verification:** `pnpm typecheck`, the full user-client vitest, llm-unified
  `bun test`, `pnpm run build`, biome. **No Larissa path.**

## 11. Manual verification (Chris, on device)

1. Assign a library to a persona in the persona editor; start a chat with it; ask a
   question the library covers → the model calls `query_knowledgebase` (a pill
   appears) and answers from the retrieved passage.
2. Expand the pill → see the query and the hits with provenance + scores.
3. Ask something the library does *not* cover → the model answers normally (no
   spurious retrieval, or a graceful "no relevant passages").
4. Open the cockpit knowledge sheet → persona libraries show locked-on; toggle an
   extra library for this chat → it becomes searchable; the persona's other chats
   are unaffected.
5. SFW persona: NSFW libraries are absent from both the persona editor and the
   cockpit sheet, and are never retrieved or named.
6. Delete a library that was assigned to a persona and added to a chat → both
   references disappear; no errors; the model is no longer told about it.
