# Client-Local Embeddings Engine — Design Spec

**Date:** 2026-06-05
**Author:** Liz (Claude Code), brainstormed with Chris
**Status:** Approved for planning
**Package:** `packages/embeddings` (new), LGPLv3
**Larissa gate:** Not required — touches none of `auth-service`, `sync-service`, `proxy-service`, `packages/crypto`.

---

## 1. Purpose

A reusable, client-local semantic-search foundation: turn text into vector
embeddings entirely in the browser, and retrieve the closest stored vectors
under arbitrary metadata filters. The engine is **corpus-agnostic** — it knows
nothing about Chatsundere's domain model (memories, messages, personas). Any
caller decides what to embed and how to tag it.

This spec covers the **backend-for-frontend only**. There is deliberately **no
GUI and no chat wiring** in scope. The first consumer (the Block-3 memory
system / `kb-injection`) is out of scope and will be designed separately.

Two concrete goals:

- **(a) Text → vector.** Send a string, get its embedding back.
- **(b) Vector → hits.** Given a query (text or vector) plus filter criteria,
  find the closest stored records in IndexedDB.

## 2. Model & Trust Posture

- **Model:** [`Snowflake/snowflake-arctic-embed-m-v2.0`](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0),
  **int8** ONNX quantisation (~311 MB). Multilingual, 768-dimensional, CLS
  pooling. Quality is sufficient for our retrieval needs — this is not meant to
  be a high-end model.
- **Runtime:** `@huggingface/transformers` v4 → ONNX Runtime Web.
- **Self-hosted from our own origin.** transformers.js runs with
  `allowRemoteModels = false` and a local model path. The browser **never calls
  huggingface.co** at runtime — consistent with the zero-knowledge / Proton
  trust bar and with offline-first operation.
- **Licence:** arctic-embed-m-v2.0 is Apache-2.0, compatible with bundling and
  redistribution in our AGPL/LGPL stack. (Verify the exact licence file during
  the model-fetch step.)

## 3. Architecture

Two independent units behind narrow interfaces:

- **Engine** — text → vector. Owns the Web Worker, the model, and
  capability discovery. Knows nothing about storage.
- **Store** — vector + tags in, filtered ranked hits out. Owns its own
  IndexedDB database. Knows nothing about the model (it may optionally hold an
  Engine reference purely to embed text queries on the caller's behalf).

```
packages/embeddings/
├── src/
│   ├── index.ts                 public API barrel
│   ├── engine/
│   │   ├── engine.ts            main-thread facade → Worker via postMessage
│   │   ├── worker.ts            loads model, embeds (ported from PoC)
│   │   ├── execution.ts         caps discovery + backend fallback (ported)
│   │   ├── execution-modes.ts   ExecutionMode / ResolvedBackend types
│   │   └── model-config.ts      MODEL_ID, dim, query/doc prefix, pooling
│   ├── store/
│   │   ├── vector-store.ts      Dexie DB `chatsundere_vectors`, CRUD + query
│   │   └── retrieval.ts         filter-then-rank (pure functions)
│   └── lib/
│       └── similarity.ts        dot / l2Norm / cosine (ported from PoC)
├── public/model/                self-hosted ONNX + tokenizer (gitignored)
├── scripts/fetch-model.mjs      deterministic download + SHA256 verify
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── index.html + dev/main.ts     minimal dev smoke page (not shipped)
└── README.md
```

Reference implementation to port from: `~/Projekte/browser_embed` (working
PoC — worker, execution fallback chain, WebGPU probe, similarity helpers).

## 4. Embedding Engine

Ported from the PoC, which already works across browsers.

- **Worker-borne model.** The main-thread facade exposes a slim `Promise` API;
  all heavy work runs in a Web Worker so the UI thread never blocks.
- **Capability discovery with fallback chain.** `auto` mode tries, in order:
  1. **WebGPU** — only after a guarded probe: `navigator.gpu.requestAdapter()`
     wrapped in `try/catch` **and** a 4 s timeout, because merely asking can
     hard-fail on Linux/Vulkan setups. A null adapter (typical without
     `--enable-unsafe-webgpu`) is treated as "skip", not "error".
  2. **WASM multi-thread** — `numThreads = min(4, ⌈hardwareConcurrency / 2⌉)`.
     Requires `crossOriginIsolated` (COOP/COEP — see §8).
  3. **WASM single-thread** — always-available floor.
- **Runtime fallback.** If WebGPU initialises but inference later throws (rare,
  mostly Linux without flags), reload once without WebGPU. Auto-mode only.
- **Inference config:** int8 dtype, `pooling: 'cls'`, `normalize: true`. Because
  vectors are L2-normalised, cosine similarity reduces to a dot product.
- **Query vs document prefix.** arctic-embed v2.0 prepends a prompt to *queries*
  (`"query: "`) but not to documents. The engine applies the correct prefix per
  call via `kind: 'query' | 'document'`. **The exact prefix string is verified
  empirically against the model-card reference scores during implementation**
  (see §9) — empirical truth over docs.

`ResolvedBackend` (execution mode, device, dtype, WASM threads, WebGPU
availability, `crossOriginIsolated`, fallback trail) is surfaced for diagnostics.

## 5. Vector Store & Retrieval (goal b)

A dedicated Dexie database `chatsundere_vectors`, **separate** from the
app's `chatsundere_client_data`, so the engine stays self-contained and
corpus-agnostic.

### Record shape

```ts
interface VectorRecord {
  id: string;                    // caller-supplied (e.g. a memoryId)
  collection: string;            // namespace, e.g. 'memory' | 'chat-messages'
  vector: Float32Array;          // 768-dim, L2-normalised
  tags: Record<string, string>;  // indexable equality filter axes
  metadata?: unknown;            // arbitrary payload, NOT filtered on
  createdAt: number;
}
```

- **Storage format:** fp32 `Float32Array` (768 floats ≈ 3 KB/vector). Exact and
  simple. int8 vector quantisation is a deferred optimisation (§10), not v1.
- **Tags are flat string→string** so they map cleanly onto Dexie indexes. The
  store indexes `collection` plus a multi-entry index over tag entries (exact
  index strategy decided in the plan; the contract is equality filtering on
  `collection` + any subset of tags).

### Retrieval = filter-then-rank

1. **Cheap filter via Dexie indexes** — narrow to candidates by `collection`
   and tag equality. Uses real indexes, touches no vectors.
2. **Brute-force cosine (dot product) over the filtered subset only** — rank,
   apply `topK` and `minScore`.

Rationale: Chatsundere is personal-scale (thousands to ~tens of thousands of
vectors). Brute force over the *filtered* subset is well under ~50 ms and needs
**no ANN/HNSW index** — that would be over-engineering. If a corpus ever
outgrows this, int8 scan + ANN are the documented next steps (§10).

### Query API

```ts
store.query({
  collection: 'memory',
  filter: { personaId: 'p1', mode: 'sfw' },  // equality on tags
  text?: string,           // embedded internally as a query, or …
  vector?: Float32Array,   // … pass a ready vector directly
  topK: 8,
  minScore: 0.3,
}); // → { id: string; score: number; metadata?: unknown }[]
```

Exactly one of `text` / `vector` is required. `text` requires the store to hold
an Engine reference.

## 6. Public API (the BFF surface)

```ts
// Engine — goal (a)
const engine = await createEmbeddingEngine(opts?);   // caps-discovery + load
engine.backend;                                       // ResolvedBackend
await engine.embed(texts: string[], { kind }): Promise<Float32Array[]>;
engine.dispose();

// Store — goal (b)
const store = createVectorStore({ engine? });
await store.upsert(records: VectorRecord[]): Promise<void>;
await store.delete(ids: string[]): Promise<void>;
await store.deleteWhere({ collection, filter? }): Promise<number>;
await store.query(q): Promise<QueryHit[]>;
```

No React components, no chat wiring — this is the entire deliverable.

## 7. Model Delivery into the Build

`scripts/fetch-model.mjs`:

- Downloads the int8 ONNX + tokenizer/config from HF at a **pinned revision**.
- **Verifies SHA256** of each file against checked-in expected hashes.
- Writes them into `public/model/` (gitignored).

Dev: Vite serves `public/model/`. Prod: the files are baked into the Docker
image during build. Git stays lean; the build is deterministic and, after the
first fetch, offline-reproducible via the Docker layer cache. (Alternative
considered and rejected for v1: Git-LFS-vendored blob — heavier repo, but fully
offline from `clone`. Revisit only if the fetch step proves fragile in CI.)

## 8. Integration Requirements (for the consuming app)

These are **prerequisites the consumer must satisfy**, documented in the
package README; the package itself does not configure the host app.

- **COOP/COEP headers** for WASM threads: `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, in **both**
  dev (`vite.config` `server.headers`) and prod (the static host / reverse
  proxy). Without them `crossOriginIsolated` is false and the engine silently
  drops to WASM single-thread.
- **Vite:** `optimizeDeps.exclude: ['@huggingface/transformers']` and
  `worker.format: 'es'`.
- **Static assets:** `public/model/` served at a path the engine's
  `localModelPath` points to.

## 9. Testing & Manual Verification

**Vitest** on the pure cores (model inference is not loadable in jsdom):

- `similarity` — dot / l2Norm / cosine numerics.
- `retrieval` — filter-then-rank correctness, topK/minScore boundaries, empty
  candidate sets.
- `vector-store` CRUD against `fake-indexeddb` — upsert/replace, delete,
  deleteWhere, filter-by-tags.
- Query-prefix selection logic (`kind` → prefix).
- Caps-discovery decision tree with `navigator.gpu` / `crossOriginIsolated`
  mocked — asserts the fallback ordering and skip-vs-error behaviour without
  loading WASM.

**Manual smoke** via the minimal dev page (`pnpm --filter embeddings dev`),
unstyled, not part of the app and never shipped:

1. **Model-card sanity:** query `"what is snowflake?"` against documents
   `"The Data Cloud!"` and `"Mexico City of Course!"` → similarities land near
   the fp32 references **0.327** and **0.070** within int8 tolerance. This run
   also **pins the correct query prefix** (try with/without; pick what matches).
2. **Filter + query round-trip:** upsert a handful of tagged records across two
   collections, query with a tag filter, confirm the filter excludes
   off-tag records and the ranking is sensible.
3. **Backend report:** the page shows the resolved `ResolvedBackend` so Chris
   can confirm WASM-multi vs WebGPU vs single-thread on his hardware.

## 10. Out of Scope / YAGNI

ANN / HNSW index · int8 vector quantisation · Matryoshka (MRL) dimension
truncation · GUI / chat wiring · server-side sync of vectors · cross-collection
search · re-ranking · the Block-3 memory consumer itself.

These are the documented next steps **if** scale or features ever demand them;
they are not built now.

## 11. Open Items to Resolve During Implementation

- **Exact query prefix string** — verify empirically (§9 step 1).
- **Tag index strategy in Dexie** — multi-entry index vs compound; chosen in
  the plan to match the equality-filter contract.
- **Model licence file** — confirm Apache-2.0 and vendor the LICENSE alongside
  the model assets.

## 12. Manual Verification (Chris runs these)

1. `pnpm --filter @chatsundere/embeddings run fetch-model` succeeds and SHA256
   checks pass.
2. `pnpm --filter @chatsundere/embeddings dev` → dev page loads the model,
   reports a backend, and the §9 sanity scores are within tolerance.
3. Filter + query round-trip behaves as described.
4. `pnpm --filter @chatsundere/embeddings test` green; full
   `pnpm typecheck && pnpm lint && pnpm build` clean.
