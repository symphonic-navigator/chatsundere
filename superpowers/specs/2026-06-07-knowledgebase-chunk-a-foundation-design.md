# Knowledgebase — Chunk A (Foundation) — Design

**Date:** 2026-06-07
**Author:** Liz (with Chris, brainstormed end-to-end)
**Status:** Approved design, ready for implementation plan
**Roadmap:** Block 5 → v0.2.0 (knowledge base). Client-only.

---

## 1. Context & overall feature

Chatsundere gains a **knowledgebase**: user-owned **libraries** of **documents** that
a companion can draw on. The full feature has three independently valuable parts,
each its own spec → plan → build chunk (the value ladder *manage → use → automatic*):

- **Chunk A (this spec) — Foundation.** Data model, on-device ingestion
  (chunking + embedding), the library/document management UI, and the
  *My Knowledge* room. After Chunk A a user can create libraries, add documents,
  and watch them embed locally — but nothing reaches a chat yet.
- **Chunk B — Retrieval.** The `query_knowledgebase` tool, persona ↔ library
  binding, ad-hoc chat ↔ library binding, and *attach document*.
- **Chunk C — Lorebooks.** Phrase-triggered injection: trigger phrases on a
  document, scan the latest user message, inject the document as hidden context.

Reference implementation studied: chatsune's `knowledge` subsystem
(`/home/chris/workspace/chatsune`, MongoDB-backed). Chatsundere is **local-first
and zero-knowledge**, so the same shape is rebuilt client-side: domain rows in
Dexie, chunk vectors in the on-device `packages/embeddings` vector store.

**Key fortunate fact:** `packages/embeddings` already ships the same embedding
model chatsune uses (`Snowflake/snowflake-arctic-embed-m-v2.0`, 768-dim, cosine),
fully on-device via transformers.js, with an int4 storage codec (ADR 0030,
97.2 % recall@10 vs fp32, `<12 ms` per 1000 candidates). It is built, tested, and
**not yet wired to any consumer** — Chunk A is its first. Only a **chunker** is
missing; we port chatsune's hierarchical splitter to TypeScript.

This is **not a Larissa change** (client-only; no auth/sync/proxy/crypto surface).

---

## 2. Scope of Chunk A

In scope:

1. Dexie **v14**: `libraries` + `documents` tables.
2. A **chunker** (pure, in `packages/embeddings`).
3. A **background ingestion queue** (chunk + embed, per-document status).
4. The **My Knowledge room** (`/app/knowledge` + `/app/knowledge/:libraryId`).
5. Enabling the existing **My Knowledge** entrance-hall tile.
6. NSFW flag per library + room-level gating.

Explicitly **out of scope** (later chunks):

- `query_knowledgebase` tool, persona/chat binding, *attach document* → Chunk B.
- Phrase-trigger editor UI + injection → Chunk C. (The `triggerPhrases` field
  lands in the v14 model now, so Chunk C needs **no further migration**.)
- Retrieval-time NSFW filtering (no adult lore into a SFW chat) → Chunk B/C,
  using the `nsfw` flag this chunk introduces.
- PDF / non-text formats. All content is treated as **Markdown** (a practical
  superset of plain text — plain text is valid Markdown input; for chunking and
  for feeding the model as text the distinction is moot).

---

## 3. Data model

### 3.1 Dexie (domain) — version 14

```
libraries
  id          string (uuid)
  name        string
  description string            (optional, short)
  nsfw        boolean
  createdAt   number
  updatedAt   number
  Dexie index: 'id, name, nsfw'
  documentCount is NOT stored — derived via a count query (no drift).

documents
  id              string (uuid)
  libraryId       string  → libraries.id
  title           string
  content         string            (full text — the source of truth)
  embeddingStatus 'pending' | 'embedding' | 'ready' | 'failed'
  embeddingError  string | null
  chunkCount      number            (0 until first successful embed)
  triggerPhrases  string[]          (default []; RESERVED for Chunk C, no UI yet)
  createdAt       number
  updatedAt       number
  Dexie index: 'id, libraryId, embeddingStatus, [libraryId+createdAt]'
```

Fresh tables → the v14 migration adds the stores with **no `.upgrade()`** backfill.

### 3.2 Vector store (chunks) — `packages/embeddings` IndexedDB

Chunk vectors live in the embeddings package's own store, **not** Dexie:

```
collection: 'knowledge'
chunk row:
  id        `${documentId}#${chunkIndex}`
  vector    Float32Array (768)  — the store encodes to int4 (ADR 0030)
  tags      { libraryId, documentId }     ← equality filters at retrieval (Chunk B)
  numeric   { chunkIndex }
  metadata  { text: string, headingPath: string[] }
```

Document title and library name are **not** duplicated into metadata — Chunk B
resolves them from Dexie by `documentId` / `libraryId`, keeping a single source of
truth.

### 3.3 Cascade integrity (the one cross-store concern)

Two stores must stay consistent. All coordination is encapsulated in the data
layer (`apps/user-client/src/data/knowledge.ts`) so no caller touches both stores:

- **Delete document** → delete the document row **and** every vector row with
  `tags.documentId === id`.
- **Delete library** → cascade-delete each of its documents (and their vectors),
  then the library row.
- **Re-embed** is idempotent: the queue deletes a document's existing chunk
  vectors before writing the new set (keyed by `documentId`).

---

## 4. Ingestion pipeline

### 4.1 Chunker (pure, `packages/embeddings`)

Ported from chatsune's hierarchical splitter. Splits in descending preference:

1. Markdown headings (`#`–`######`) → section structure, tracked as a `headingPath`.
2. Paragraphs (blank-line separated).
3. Sentences (`. ! ?` boundaries).
4. Word boundary (hard fallback when a single unit still exceeds the budget).

Each emitted chunk carries `{ text, headingPath, chunkIndex }`. Default target
size ~**1000 tokens** per chunk (chatsune-like; the plan may tune); token counting
uses the existing lightweight ~4-chars heuristic (sufficient for splitting). Pure
and unit-tested with Bun.

### 4.2 Background queue

A single app-level processor (not page-scoped — it survives navigation), one
document at a time:

1. Pick a document with `embeddingStatus === 'pending'` (or `'failed'` on a manual
   retry).
2. Set `'embedding'`.
3. Chunk `content` → embed chunks via `engine.embed(texts, { kind: 'document' })`
   (worker-backed, on-device).
4. **Re-check the document still exists** (guard against mid-flight deletion); if
   gone, discard the result.
5. Delete the document's old chunk vectors, write the new ones.
6. Set `chunkCount` and `embeddingStatus = 'ready'`.

On any failure: `embeddingStatus = 'failed'` + `embeddingError`; the UI offers a
**Retry** (constructive error handling).

### 4.3 Model download

The engine lazy-loads the model on the first `embed`; transformers.js exposes
download progress. The room surfaces a one-time banner
*"Preparing the on-device knowledge engine… (downloads once, then cached)"* with
progress. WebGPU is preferred; the engine falls back to WASM when WebGPU is
absent. A download failure leaves the document `pending`/`failed` with retry.

> **CORRECTED (2026-06-07) — the original note here was based on a false premise.**
> The embeddings engine is configured **self-hosted only** (`env.allowRemoteModels =
> false`, `env.localModelPath = '/model/'`): the runtime loads the model + ONNX
> runtime assets exclusively from the app's own origin under `/model/`, and **never
> contacts huggingface.co**. There is no runtime CDN privacy exposure. The real
> requirement (missed by this spec and surfaced in device testing) is **operational**:
> the ~310 MB int8 weights must be **provisioned at `/model/`** at build/deploy time —
> `pnpm --filter @chatsundere/user-client fetch-model` (fetches from HF on the
> operator's machine at setup, gitignored under `apps/user-client/public/model/`; the
> Vite build copies `public/model` → `dist/model`). Outstanding: prod deployment must
> serve `/model/`, and `fetch-model.mjs` should pin file SHA256s. Tracked in
> [[follow-ups-index]]; see [[security-deferrals]] 2026-06-07 (corrected).

### 4.4 Reload robustness

Status lives in the DB, so a reload resumes `pending` documents. A document left
in `'embedding'` (process interrupted by reload/crash) is reset to `'pending'` on
startup — no ghost state.

---

## 5. UI — the My Knowledge room

The **My Knowledge** entrance-hall tile (currently a disabled stub) is enabled →
route `/app/knowledge`; its meta shows the library count. Two levels, mirroring
the Treasury patterns; mobile-first 380 px; disabled-over-hidden; **no
drag-and-drop** (§11/§14) — upload via the file picker + paste. Styling stays
minimal (mechanics-first; the opulent pass is the later design sweep).

### 5.1 Library list (`/app/knowledge`)

- Rows: name, short description, derived document count.
- **NSFW gating** via a `useFilteredLibraries` hook (mirrors `useFilteredPersonas`)
  — adult libraries are hidden in SFW mode.
- **New library**: name + description + NSFW toggle.
- Empty state: constructive prompt to create the first library.

### 5.2 Library detail (`/app/knowledge/:libraryId`)

- Header: library name; edit / delete (delete cascades documents + vectors with an
  inline confirm).
- Document list with a per-document **status badge**:
  `pending` / `embedding…` / `ready` / `failed` (failed shows Retry).
- **Add document** = a two-source menu (mirrors the cockpit `(+)`):
  - **Upload**: `.md` / `.txt`, multiple — each file → one document, title from the
    filename.
  - **Paste**: title + body → one document.
- Tap a document → **editor** (title + content textarea). Saving changed **content**
  re-queues embedding (`pending`); a title-only change does **not** re-embed.
- Delete document → cascade-deletes its vectors.
- Empty state: prompt to add the first document.

---

## 6. Error handling

- Ingestion failure → `failed` + `embeddingError`, per-document **Retry**.
- Empty / whitespace document rejected at add time.
- Model-download failure → clear message in the status banner; WASM fallback when
  WebGPU is unavailable; document stays `pending`/`failed` with retry.
- Mid-flight deletion → queue discards its result (existence re-checked before
  write); no ghost vectors.
- Re-embed is idempotent (old chunk vectors removed before new ones written).
- IndexedDB quota errors on write surface a constructive message (hard quota
  management deferred — noted, low risk at expected sizes).

---

## 7. Testing (quality bar §10)

- **Chunker** (Bun, pure): heading hierarchy, paragraph/sentence/word fallback,
  `headingPath` correctness, edge cases (no headings, oversized paragraph, empty).
- **Ingestion queue** (mocked `engine.embed`): `pending→embedding→ready`,
  `failure→failed→retry`, reload reset of interrupted `embedding→pending`,
  content-edit deletes old vectors before writing new.
- **Data layer** (`data/knowledge.ts`, fake-indexeddb + a vector-store test
  double): CRUD; cascade delete (document delete removes its vectors; library
  delete cascades).
- **UI** (vitest): room lists libraries; NSFW gating hides adult libraries in SFW
  mode; add-document (upload + paste) creates `pending` documents; status badges
  render; retry calls the queue; empty states.
- **Full** user-client vitest run (not just touched dirs) + `pnpm typecheck` +
  `pnpm run build` + biome.
- **Not in CI:** any live model download / on-device embedding. The chunker and
  queue are tested with a mocked engine; real embedding is manual verification.

---

## 8. Manual verification (device-tested by Chris)

1. Open *My Knowledge* from the entrance hall; create a library.
2. Add a real `.md` document by upload; watch the one-time model-download banner,
   then the status go `pending → embedding… → ready`.
3. Add a second document by paste (title + body); it embeds too.
4. Edit the first document's content; it returns to `pending` and re-embeds.
5. Edit only a title; it stays `ready` (no re-embed).
6. Create a library marked NSFW; confirm it is hidden in SFW mode and visible in
   adult mode.
7. Delete a document, then a library; both vanish (and their vectors — verified in
   Chunk B retrieval, or via a dev check now).
8. Reload mid-embed; the interrupted document resumes from `pending`.

---

## 9. Deferred (recorded so nothing is lost)

- Self-host the embedding-model weights (drop the HuggingFace-CDN dependency) —
  **urgent**, see §4.3 and [[follow-ups-index]].
- PDF / non-text ingestion.
- Hard IndexedDB-quota management.
- Everything in Chunks B and C (retrieval, binding, attach-document, lorebooks).
- Future: documents become part of the encrypted sync vault (Block 6).

---

## 10. Decisions (Chris's calls, this session)

1. Three build chunks (manage → use → automatic).
2. Document input: **upload + paste**.
3. Ingestion: **background queue with per-document status** (non-blocking).
4. **NSFW flag per library** + room gating, consistent with personas/treasury.
5. Storage: **Dexie for domain, embeddings vector store for chunks** (Approach 1).
6. **No `mediaType`** — everything is Markdown.
7. **No `refresh`/cooldown** ("haben wir schon") — dropped as needless moving parts
   (its effect belongs to Chunk C, where phrase matches simply inject).
