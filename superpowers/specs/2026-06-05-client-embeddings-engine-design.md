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
GUI and no chat wiring** in scope. The first consumers — a Block-3
MemGPT/Letta-style memory system and a knowledge base (`kb-injection`) — are
out of scope and designed separately. This spec only ensures the foundation can
carry them.

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
- **Model licence:** arctic-embed-m-v2.0 is Apache-2.0, compatible with bundling
  and redistribution in our AGPL/LGPL stack. Vendor the LICENSE alongside the
  model assets (confirm during the fetch step).

## 3. Architecture

Two independent units behind narrow interfaces:

- **Engine** — text → vector. Owns the Web Worker, the model, and capability
  discovery. Knows nothing about storage.
- **Store** — vector + tags in, filtered ranked hits out. Owns the
  quantisation, filtering, ranking, and CRUD logic — but **does not own the
  database**. It operates on a Dexie table the consumer provides, inside the
  consumer's transactions (see §3.1). Optionally holds an Engine reference to
  embed text queries on the caller's behalf.

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
│   │   ├── vector-store.ts      operates on a consumer-provided Dexie table
│   │   ├── retrieval.ts         filter-then-rank + rerank (pure functions)
│   │   ├── quantise.ts          int8 max-abs / fp16 / fp32 codecs (pure)
│   │   └── schema.ts            VectorRecord type + Dexie store-string helper
│   └── lib/
│       └── similarity.ts        dot / l2Norm / cosine (ported from PoC)
├── public/model/                self-hosted ONNX + tokenizer (gitignored)
├── scripts/fetch-model.mjs      deterministic download + SHA256 verify
├── package.json                 dexie as peerDependency
├── tsconfig.json
├── vitest.config.ts
├── index.html + dev/main.ts     minimal dev smoke page (not shipped)
└── README.md
```

Reference to port from: `~/Projekte/browser_embed` (working PoC — worker,
execution fallback chain, WebGPU probe, similarity helpers).

### 3.1 Database ownership & transactional unity

The `vectors` table lives in the consumer's **existing**
`chatsundere_client_data` Dexie database (a new migration, v7 — added in
`apps/user-client`), **not** in a separate DB. Rationale: Dexie transactions
span multiple tables of the *same* database, so a memory and its vector can be
written or deleted atomically — `db.transaction('rw', db.memories, db.vectors,
…)`. A separate DB could not offer this.

The package therefore defines the **schema and logic** but is handed the Dexie
table (and DB handle for transactions) at construction. `dexie` is a
`peerDependency` so versions align with the host app.

**Sync-ready, out of scope today.** A `VectorRecord` is a self-contained,
serialisable unit: a compact int8 blob plus small JSON. When sync lands
(Phase 1), exactly this blob is E2EE-encrypted against the backend via
`packages/crypto` — the vector is a lossy projection of plaintext, hence
sensitive, hence ciphertext-only on the server (hard rule §3.1). We build none
of that now; we only avoid precluding it: stable serialisation plus `updatedAt`
for later last-write-wins conflict resolution.

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
- **Inference config:** int8 dtype, `pooling: 'cls'`, `normalize: true`.
- **Query vs document prefix.** arctic-embed v2.0 prepends a prompt to *queries*
  (`"query: "`) but not to documents. The engine applies the correct prefix per
  call via `kind: 'query' | 'document'`. **The exact prefix string is verified
  empirically against the model-card reference scores** (§9) — empirical truth
  over docs.

`ResolvedBackend` (execution mode, device, dtype, WASM threads, WebGPU
availability, `crossOriginIsolated`, fallback trail) is surfaced for diagnostics.

## 5. Vector Store & Retrieval (goal b)

### 5.1 Record shape

```ts
interface VectorRecord {
  id: string;                    // caller-supplied (e.g. a memoryId)
  collection: string;            // namespace, e.g. 'memory' | 'kb'
  vector: Int8Array;             // 768-dim, quantised (default format; see 5.2)
  scale: number;                 // per-vector max-abs scale (for reconstruction)
  norm: number;                  // L2 norm of the stored vector (for exact cosine)
  tags: Record<string, string>;  // indexable equality filter axes
  numeric: Record<string, number>; // range+equality filter axes (createdAt, salience, …)
  metadata?: unknown;            // arbitrary payload, NOT filtered on
  updatedAt: number;             // for sync conflict resolution
}
```

### 5.2 Quantisation — per-vector max-abs int8 (default)

The default storage format is **symmetric per-vector max-abs int8**, the same
idea as GGUF k-block quant (a scale per unit) applied per vector:

```
s   = max(|vⱼ|)                       // this vector's own maximum
qᵢ  = round(vᵢ / s · 127)             // the largest component lands exactly on ±127
```

- **No clamping, by construction** — the maximum *defines* the scale, so nothing
  exceeds ±127. An outlier component does not get clipped; it simply sets the
  scale. This directly removes the "clipping breaks the unit vector" risk.
- **Cosine is computed correctly, not by assuming unit length.** We store each
  vector's actual `norm` and divide by it. Cosine is magnitude-invariant, so any
  length error from quantisation cancels — only direction matters. For int8 the
  per-vector scale `s` cancels entirely in cosine:

  ```
  cosine(a,b) = Σ(qaᵢ·qbᵢ) / (‖qa‖ · ‖qb‖)   // pure int8 vectors + stored norms
  ```

  → integer dot product in an int32 accumulator, divided by two precomputed
  norms. The scale is stored only so "dreaming" can reconstruct an approximate
  real vector for merging; scoring never needs it.
- **Size:** ~772 B/vector (768 B int8 + scale + norm) — 4× smaller than fp32.

**Configurable format** at store construction: `'int8' | 'fp16' | 'fp32'`, one
format per store, recorded in store metadata. Regardless of format we always
store `norm` and compute cosine as `dot / (normA · normB)`.

- `fp16` — 1536 B/vector, ~lossless; floating point *is* a non-linear quantiser
  (finer absolute resolution near zero, for free). Stored as `Uint16`, widened
  to fp32 on read (no native fp16 arithmetic in JS).
- `fp32` — 3072 B/vector, exact and simplest, but 4× int8.

**Measured upgrade paths (not built on spec — built only if the smoke-test delta
demands; see §9, §10):** the one honest weakness of per-vector max-abs is that a
genuine *outlier dimension* (consistently large in one of the 768 dims) inflates
the scale and squashes the resolution of the bulk. If arctic-embed-m-v2.0 shows
this, the documented upgrades are **(i)** a robust globally-calibrated scale
(99.9th-percentile clip + renormalise-on-read), and **(ii)** sub-block scales
(scale per block of e.g. 64 dims, GGUF-style) which localise an outlier dim to
its own block. **Zero-point / asymmetric quant is explicitly *not* pursued**:
embedding components are ~zero-mean and symmetric, so the gain is single-digit %
while it breaks the clean cosine-scale cancellation. All upgrades are additive
and format-tagged, never a breaking change.

### 5.3 Filtering

```ts
filter: {
  tags?:    Record<string, string>;                          // equality
  numeric?: Record<string, { gte?; lte?; gt?; lt?; eq? }>;   // range + equality
}
```

**Filter-then-rank.** Dexie narrows candidates cheaply via indexes — by
`collection` (plus an optional compound index such as `[collection+createdAt]`
for the common recency window). Any remaining tag/numeric predicates are
evaluated **in-memory** over the (small, personal-scale) candidate set — no
index explosion. Only then does the vector scan run.

**Brute-force cosine over the filtered subset only.** Personal scale (thousands
to ~tens of thousands of vectors, kept in check by the storage budget in §5.5)
makes this well under ~50 ms. No ANN/HNSW index — that would be over-engineering
(documented next step in §10 if scale ever demands it).

### 5.4 Query & re-rank

```ts
store.query({
  collection: 'memory',
  filter?: { tags?, numeric? },
  text?: string,            // embedded internally as a query (needs an Engine), or …
  vector?: Float32Array,    // … pass a ready vector directly
  topK: 8,
  candidateK?: 64,          // over-fetch this many vector-ranked candidates …
  minScore?: 0.3,
  rerank?: (cands: ScoredCandidate[]) => ScoredCandidate[], // … reorder before topK
}); // → { id, score, numeric, metadata }[]
```

Exactly one of `text` / `vector` is required.

`candidateK` + `rerank` exist so a consumer (e.g. the MemGPT-style memory layer)
can fold **salience and recency** into the final ordering without the engine
knowing those concepts. Over-fetching is essential: pure cosine top-K would cut
a high-salience but semantically-average memory before the consumer could
re-weight it. The engine stays generic; MemGPT/Letta semantics live in the
consumer.

### 5.5 CRUD, "dreaming" support & storage budget

```ts
store.upsert(records: VectorRecord[]): Promise<void>;
store.update(id, patch: { numeric?, metadata? }): Promise<void>; // mutate WITHOUT re-embedding
store.delete(ids: string[]): Promise<void>;
store.deleteWhere({ collection, filter? }): Promise<number>;
store.scan({ collection, filter? }): Promise<VectorRecord[]>;     // full records for dedup/merge
store.usage(): Promise<{ count: number; bytes: number; perCollection: … }>;
```

- **"Dreaming" (consolidation) is the consumer's job**, built on these
  primitives: `scan` to read, the exported `cosine()`/quant helpers for
  vector-vs-vector dedup, `update` to adjust salience without re-embedding,
  `delete` to drop duplicates — all runnable inside consumer transactions.
- **Storage budget.** Configurable cap (max vector count and/or bytes, per
  collection or global). IndexedDB's own quota fails writes ugly; a self-imposed
  soft cap is better UX. Default policy on "full" = **reject with a typed
  error** (self-responsibility — the caller sees the wall coming). An optional
  **eviction hook** lets the memory layer evict by salience/LRU instead, tying
  into dreaming. `usage()` exposes consumption (disabled-over-hidden: the app
  can surface it).

## 6. Public API (the BFF surface)

```ts
// Engine — goal (a)
const engine = await createEmbeddingEngine(opts?);   // caps-discovery + load
engine.backend;                                       // ResolvedBackend
await engine.embed(texts: string[], { kind }): Promise<Float32Array[]>;
engine.dispose();

// Store — goal (b). Constructed with the consumer's Dexie table + DB handle.
const store = createVectorStore({
  db, table,                 // consumer-owned (chatsundere_client_data.vectors)
  engine?,                   // enables text queries
  format?: 'int8',           // default int8 max-abs
  budget?: { maxBytes?, maxCount?, onFull?: 'reject' | EvictionHook },
});
store.upsert / update / delete / deleteWhere / scan / query / usage  // see §5
```

No React components, no chat wiring — this is the entire deliverable.

## 7. Model Delivery into the Build

`scripts/fetch-model.mjs`:

- Downloads the int8 ONNX + tokenizer/config from HF at a **pinned revision**.
- **Verifies SHA256** of each file against checked-in expected hashes.
- Writes them into `public/model/` (gitignored).

Dev: Vite serves `public/model/`. Prod: baked into the Docker image at build.
Git stays lean; the build is deterministic and, after the first fetch,
offline-reproducible via the Docker layer cache. (Alternative considered and
rejected for v1: Git-LFS-vendored blob — heavier repo, fully offline from
`clone`. Revisit only if the fetch step proves fragile in CI.)

## 8. Integration Requirements (for the consuming app)

Prerequisites the consumer must satisfy, documented in the package README; the
package does not configure the host app.

- **COOP/COEP headers** for WASM threads: `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, in **both** dev
  (`vite.config` `server.headers`) and prod (static host / reverse proxy).
  Without them `crossOriginIsolated` is false and the engine silently drops to
  WASM single-thread.
- **Vite:** `optimizeDeps.exclude: ['@huggingface/transformers']` and
  `worker.format: 'es'`.
- **Static assets:** `public/model/` served where the engine's `localModelPath`
  points.
- **Dexie v7 migration** in `apps/user-client` adds the `vectors` table; the app
  hands `db` + `db.vectors` to `createVectorStore`.

## 9. Testing & Manual Verification

**Vitest** on the pure cores (model inference is not loadable in jsdom):

- `quantise` — int8 max-abs round-trip, scale/norm correctness, cosine-scale
  cancellation, fp16/fp32 codecs.
- `similarity` — dot / l2Norm / cosine numerics.
- `retrieval` — filter-then-rank, tag equality + numeric range predicates,
  `candidateK`/`rerank` ordering, topK/minScore boundaries, empty candidate
  sets.
- `vector-store` CRUD against `fake-indexeddb` — upsert/replace, update (no
  re-embed), delete, deleteWhere, scan, budget reject + eviction hook, usage.
- Query-prefix selection logic (`kind` → prefix).
- Caps-discovery decision tree with `navigator.gpu` / `crossOriginIsolated`
  mocked — fallback ordering and skip-vs-error behaviour, without loading WASM.

**Manual smoke** via the minimal dev page (`pnpm --filter embeddings dev`),
unstyled, not shipped:

1. **Model-card sanity & quant delta.** Query `"what is snowflake?"` against
   `"The Data Cloud!"` / `"Mexico City of Course!"` → near the fp32 references
   **0.327** / **0.070** within int8 tolerance. Show the **int8-vs-fp32 cosine
   delta** — this is the measurement that decides whether per-vector max-abs is
   enough or whether a §5.2 upgrade path is warranted. Also pins the correct
   query prefix (try with/without; pick what matches).
2. **Multilingual exploration.** Embed short texts across Latin, **Cyrillic**,
   and **CJK** scripts. Assert **(a) degenerate-output check** — finite,
   non-NaN embeddings with normal magnitudes (no all-zero / collapsed vectors)
   for non-Latin scripts; **(b) cross-lingual retrieval** — a query in one
   language ranks a semantically-matching document in another language above
   unrelated ones. "Trust the probe, not the model card's multilingual claim."
3. **Filter + query round-trip.** Upsert tagged records across two collections
   with `numeric` fields; query with tag + numeric-range filters; confirm
   filters exclude off-criteria records and ranking is sensible; exercise
   `candidateK`+`rerank`.
4. **Backend report.** The page shows the resolved `ResolvedBackend` so Chris
   can confirm WASM-multi vs WebGPU vs single-thread on his hardware.

## 10. Out of Scope / YAGNI (measured upgrade paths, not built now)

ANN / HNSW index · int8 zero-point/asymmetric quant · sub-block scales · robust
globally-calibrated scale · Matryoshka (MRL) dimension truncation · GUI / chat
wiring · server-side sync of vectors · cross-collection search · re-ranking
*inside* the engine · the Block-3 memory / KB consumers themselves.

The quant upgrades (§5.2) and ANN are **built only if a measurement demands
them**, and are additive, format-tagged changes — never breaking.

## 11. Open Items to Resolve During Implementation

- **Exact query prefix string** — verify empirically (§9 step 1).
- **int8 sufficiency** — measure the §9-step-1 delta; if outlier dimensions
  squash resolution, take a §5.2 upgrade path.
- **Dexie index strategy** for `collection` + compound `[collection+createdAt]`
  vs in-memory predicate filtering — finalise in the plan to match the
  equality+range contract.
- **Model licence file** — confirm Apache-2.0 and vendor the LICENSE with the
  model assets.

## 12. Manual Verification (Chris runs these)

1. `pnpm --filter @chatsundere/embeddings run fetch-model` succeeds; SHA256
   checks pass.
2. `pnpm --filter @chatsundere/embeddings dev` → dev page loads the model,
   reports a backend; §9 step-1 sanity scores within tolerance and the int8
   delta is acceptable.
3. Multilingual exploration (§9 step 2): non-Latin embeddings are well-formed
   and cross-lingual retrieval is sensible.
4. Filter + query round-trip (§9 step 3) behaves as described.
5. `pnpm --filter @chatsundere/embeddings test` green; full
   `pnpm typecheck && pnpm lint && pnpm build` clean.
