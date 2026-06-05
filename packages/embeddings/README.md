# @chatsundere/embeddings

A reusable, corpus-agnostic, client-local semantic-search foundation for Chatsundere.

The package knows nothing about the domain model. Callers decide what to embed and how to tag it. The first domain consumers — a memory system and a knowledge base — are built as separate packages that depend on this one.

Two goals:

1. **Text → vector** (`EmbeddingEngine`): runs `snowflake-arctic-embed-m-v2.0` int8 inside a Web Worker, discovers the best available backend (WebGPU → WASM multi-thread → WASM single-thread), and exposes a simple `embed()` method.
2. **Vector → filtered ranked hits** (`VectorStore`): stores int8-quantised vectors in a caller-owned IndexedDB table (Dexie), supports tag/numeric filters, score floors, over-fetch + rerank, and an optional storage budget.

---

## Quick usage

### Engine — text → vector

```ts
import { createEmbeddingEngine } from '@chatsundere/embeddings';

const engine = await createEmbeddingEngine();
// engine.backend describes which execution path was selected (see ResolvedBackend).

// Embed documents (stored in the corpus)
const docVecs: Float32Array[] = await engine.embed(
  ['Hello world', 'Another chunk of text'],
  { kind: 'document' },
);

// Embed a query (prepends the arctic-embed v2.0 query prefix automatically)
const [queryVec] = await engine.embed(['What is the capital of France?'], { kind: 'query' });

// Inspect the selected backend
console.log(engine.backend.executionMode);  // 'webgpu' | 'wasm-multi' | 'wasm-single'

// Release the worker when done
engine.dispose();
```

`createEmbeddingEngine` accepts an optional `CreateEngineOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `executionMode` | `ExecutionMode` | `'auto'` | Force a specific backend (`'webgpu'`, `'wasm-multi'`, `'wasm-single'`) or let the engine discover. |
| `onProgress` | `(data: unknown) => void` | — | Called with transformers.js progress messages during model download / compilation. |

`EmbeddingEngine.backend` is a `ResolvedBackend` with fields: `executionMode`, `device`, `dtype`, `wasmThreadsConfigured`, `webgpuAvailable`, `crossOriginIsolated`, `fallbackTrail`.

---

### Store — vector → filtered ranked hits

The store is constructed with a **caller-owned** Dexie table. This keeps the vector rows in the same database as domain rows, enabling transactional upserts and future E2EE sync.

```ts
import Dexie, { type Table } from 'dexie';
import {
  createVectorStore,
  VECTORS_STORE_SCHEMA,
  type VectorRow,
} from '@chatsundere/embeddings';

// The consumer adds the vectors table to its own Dexie schema migration.
class MyDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor() {
    super('my-app');
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

const db = new MyDb();
const store = createVectorStore({ db, table: db.vectors, engine });
```

**Upsert**

```ts
await store.upsert([
  {
    id: 'note-1',
    collection: 'notes',
    vector: docVecs[0],  // Float32Array from engine.embed()
    tags: { type: 'note', authorId: 'u-abc' },
    numeric: { createdAt: Date.now() },
    metadata: { title: 'Hello world' },
    updatedAt: Date.now(),
  },
]);
```

**Query** (text or pre-computed vector)

```ts
// Text query — requires engine to be passed to createVectorStore({ engine })
const hits = await store.query({
  collection: 'notes',
  text: 'greeting',
  topK: 5,
  minScore: 0.3,
  filter: { tags: { type: 'note' } },
});

// Pre-computed vector — engine not required
const hits2 = await store.query({
  collection: 'notes',
  vector: queryVec,
  topK: 5,
  candidateK: 50,   // over-fetch before topK
  rerank: (cs) => cs.filter((c) => c.score > 0.25),
});
// hits2[0] → { id, score, numeric, metadata }
```

**Other store methods**

```ts
await store.update('note-1', { metadata: { title: 'Updated' } });
await store.delete(['note-1']);
const deleted = await store.deleteWhere({ collection: 'notes', filter: { tags: { type: 'draft' } } });
const rows = await store.scan({ collection: 'notes' });
const report = await store.usage();
// report → { count, bytes, perCollection: { notes: { count, bytes } } }
```

---

## Model assets

The model is served from the app's own origin — no call to huggingface.co at runtime.

**Download once** (into `public/model/`, which is gitignored):

```sh
pnpm --filter @chatsundere/embeddings run fetch-model
```

The script downloads `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, and `onnx/model_int8.onnx` from Hugging Face and prints the SHA256 digest of each file. After the first run, paste the printed hashes into `scripts/fetch-model.mjs` under `EXPECTED_SHA256` and pin `REVISION` to a specific commit SHA.

The engine loads the model from `/model/` (the default `localModelPath`). Your app must serve `public/model/` at that path.

**Model details**

| Property | Value |
|---|---|
| Model | `Snowflake/snowflake-arctic-embed-m-v2.0` |
| Format | ONNX, int8-quantised |
| Embedding dimension | 768 (`EMBED_DIM`) |
| Pooling | CLS token |
| Model licence | Apache-2.0 |

---

## Storage format

All vectors are stored as **per-vector max-abs int8** (one scale factor per vector). There is no fp16 or fp32 storage option — this is a deliberate Omakase decision. Cosine similarity cancels the per-vector scale, so retrieval quality is unaffected.

The `VECTORS_STORE_SCHEMA` string defines the Dexie indexes: primary key `id`, plus `collection` and `[collection+updatedAt]` for recency-windowed queries. Tag and numeric predicates are applied in-memory over the narrowed candidate set.

**Storage budget (optional)**

```ts
const store = createVectorStore({
  db, table: db.vectors, engine,
  budget: {
    maxCount: 10_000,
    maxBytes: 50 * 1024 * 1024,   // 50 MB
    onFull: async ({ table, usage, incoming }) => {
      // evict oldest rows before the upsert proceeds
      const oldest = await table.orderBy('updatedAt').limit(incoming.count).primaryKeys();
      await table.bulkDelete(oldest);
    },
  },
});
```

Without `onFull`, an upsert that would exceed the budget throws `BudgetExceededError`.

---

## Integration requirements for a consuming app

### COOP / COEP headers (required for multi-thread WASM)

Both dev and production must serve these headers, or `crossOriginIsolated` will be `false` and the engine will fall back to single-thread WASM:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For Vite dev, add them to `vite.config.ts`:

```ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

For production, set the equivalent headers in your reverse proxy (Nginx, Traefik, Caddy).

### Vite configuration

Add the following to the consuming app's `vite.config.ts`:

```ts
optimizeDeps: { exclude: ['@huggingface/transformers'] },
worker: { format: 'es' },
```

Without `exclude`, Vite will attempt to pre-bundle the transformers library and break the Web Worker.

### Dexie table

Add the `vectors` table to the consuming app's own Dexie schema migration using the exported `VECTORS_STORE_SCHEMA`:

```ts
import { VECTORS_STORE_SCHEMA } from '@chatsundere/embeddings';

// Inside your Dexie subclass, as a new version migration:
this.version(n).stores({ ...existingStores, vectors: VECTORS_STORE_SCHEMA });
```

This keeps vector rows in the same database as domain rows, which enables transactional upserts alongside domain writes and is required for future E2EE sync.

In `apps/user-client`, this Dexie migration (v7) is deferred to the first domain consumer (the memory system) — it is **not** part of this package.

### Model files

Serve the `public/model/` directory contents at `/model/` in both dev and production. No CDN or external network call is made at runtime.

---

## Licence

`@chatsundere/embeddings`: **LGPL-3.0-only**

The `snowflake-arctic-embed-m-v2.0` model: Apache-2.0 (see the [model card](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0)).

---

## Spec and plan

- Spec: [`superpowers/specs/2026-06-05-client-embeddings-engine-design.md`](../../superpowers/specs/2026-06-05-client-embeddings-engine-design.md)
- Plan: [`superpowers/plans/2026-06-05-client-embeddings-engine.md`](../../superpowers/plans/2026-06-05-client-embeddings-engine.md)
