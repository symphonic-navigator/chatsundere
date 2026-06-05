# Client-Local Embeddings Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/embeddings` — a corpus-agnostic, client-local semantic-search backend: text → vector (Web Worker + arctic-embed-m-v2.0 int8 via transformers.js/ONNX-WASM) and vector → filtered ranked hits (Dexie vector store, per-vector max-abs int8 quant, filter-then-rank retrieval). No GUI.

**Architecture:** Two independent units behind narrow interfaces — an **Engine** (owns the worker + model + capability discovery) and a **Store** (owns quantisation, filtering, ranking, CRUD, operating on a consumer-provided Dexie table). The package ships as **source** consumed by the user-client's Vite (which bundles the worker + WASM); tests run under **Vitest** with `fake-indexeddb`. The hard, novel logic (max-abs int8 quant where cosine cancels the scale; filter-then-rank with `candidateK`+`rerank`) is built test-first; the engine/worker/caps-discovery are faithful ports of the working PoC at `~/Projekte/browser_embed`.

**Tech Stack:** TypeScript (strict), `@huggingface/transformers` v4, ONNX Runtime Web (WASM), Dexie 4, Vitest, `fake-indexeddb`, pnpm + Turborepo.

**Spec:** `superpowers/specs/2026-06-05-client-embeddings-engine-design.md`

**Source for ports:** `~/Projekte/browser_embed/src/` — `lib/similarity.ts`, `lib/execution.ts`, `lib/executionModes.ts`, `embeddingWorker.ts`. Read these before porting; this plan reproduces or adapts them with exact paths.

**Important scope notes:**
- **No user-client schema change in this plan.** The spec's Dexie v7 `vectors` migration lands with the *future memory consumer*. Here the store operates on ANY provided Dexie table; the dev smoke page supplies its own demo table. This keeps scope tight and avoids a premature migration for a feature not yet built. The package README documents the integration requirements (spec §8) for that future consumer.
- **British English** everywhere (identifiers, comments, commit messages) per CLAUDE.md §7.
- **SPDX header** `// SPDX-License-Identifier: LGPL-3.0-only` at the top of every `.ts` source file (match the `packages/llm-unified` convention).
- **No Larissa gate** — this package touches none of `auth-service`, `sync-service`, `proxy-service`, `packages/crypto`.

---

## File Structure

```
packages/embeddings/
├── package.json                 name @chatsundere/embeddings, LGPL-3.0-only, exports ./src, dexie peerDep
├── tsconfig.json                extends ../../tsconfig.base.json
├── tsconfig.test.json           includes test files for typecheck
├── vitest.config.ts             node env, fake-indexeddb setup
├── vitest.setup.ts              imports 'fake-indexeddb/auto'
├── README.md                    usage + integration requirements (spec §8)
├── LICENSE                      LGPL-3.0
├── .gitignore                   public/model
├── scripts/
│   └── fetch-model.mjs          download int8 ONNX + tokenizer, SHA256 verify
├── public/
│   └── model/                   (gitignored) self-hosted model assets
├── index.html                   dev smoke page entry (not shipped)
├── dev/
│   └── main.ts                  dev smoke harness (not shipped)
└── src/
    ├── index.ts                 public API barrel
    ├── lib/
    │   ├── similarity.ts        dot / l2Norm / cosine (port)
    │   └── similarity.test.ts
    ├── store/
    │   ├── quantise.ts          int8 max-abs codec (NEW, the heart)
    │   ├── quantise.test.ts
    │   ├── schema.ts            VectorRow type + Dexie store-string + record types
    │   ├── retrieval.ts         matchesFilter + scoreAndRank (NEW)
    │   ├── retrieval.test.ts
    │   ├── vector-store.ts      CRUD + budget over a provided Dexie table (NEW)
    │   └── vector-store.test.ts
    └── engine/
        ├── execution-modes.ts   ExecutionMode / ResolvedBackend types (port)
        ├── model-config.ts      MODEL_ID, EMBED_DIM, prefixes, pooling (NEW)
        ├── model-config.test.ts
        ├── execution.ts         caps discovery + fallback (port)
        ├── execution.test.ts    pure decision helpers (NEW tests)
        ├── worker.ts            model load + embed (port/adapt)
        └── engine.ts            main-thread facade (NEW)
```

---

## Task 0: Package scaffold

**Files:**
- Create: `packages/embeddings/package.json`
- Create: `packages/embeddings/tsconfig.json`
- Create: `packages/embeddings/tsconfig.test.json`
- Create: `packages/embeddings/vitest.config.ts`
- Create: `packages/embeddings/vitest.setup.ts`
- Create: `packages/embeddings/.gitignore`
- Create: `packages/embeddings/LICENSE` (copy from `packages/llm-unified/LICENSE`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@chatsundere/embeddings",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "LGPL-3.0-only",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "fetch-model": "node scripts/fetch-model.mjs",
    "dev": "vite",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "@huggingface/transformers": "^4.2.0",
    "dexie": "^4.0.0"
  },
  "devDependencies": {
    "@huggingface/transformers": "^4.2.0",
    "@types/node": "^22.0.0",
    "dexie": "^4.0.0",
    "fake-indexeddb": "^6.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

Note: exports point at **source** (`./src/index.ts`) — there is no `build` step; the consuming Vite app transpiles and bundles the worker + WASM. This is a deliberate divergence from `llm-unified`'s pre-built `dist` (which has no worker/WASM).

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "types": ["node"]
  },
  "include": ["src/**/*", "dev/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "dev/**/*", "scripts/**/*", "vitest.setup.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 5: Create `vitest.setup.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import 'fake-indexeddb/auto';
```

- [ ] **Step 6: Create `.gitignore`**

```
public/model
```

- [ ] **Step 7: Copy the LICENCE**

Run: `cp packages/llm-unified/LICENSE packages/embeddings/LICENSE`

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: lockfile updates, `@chatsundere/embeddings` recognised as a workspace package (it matches `packages/*` in `pnpm-workspace.yaml`).

- [ ] **Step 9: Commit**

```bash
git add packages/embeddings pnpm-lock.yaml
git commit -m "Scaffold packages/embeddings (Vitest, source-exported, dexie peer)"
```

---

## Task 1: Similarity helpers (port)

**Files:**
- Create: `packages/embeddings/src/lib/similarity.ts`
- Test: `packages/embeddings/src/lib/similarity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cosineSimilarity, dot, l2Norm } from './similarity.js';

describe('similarity', () => {
  it('dot computes the inner product', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('l2Norm computes the Euclidean length', () => {
    expect(l2Norm([3, 4])).toBe(5);
  });

  it('cosineSimilarity is 1 for identical direction', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });

  it('cosineSimilarity is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('cosineSimilarity returns 0 when either vector is zero-length', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/embeddings test src/lib/similarity.test.ts`
Expected: FAIL — cannot resolve `./similarity.js`.

- [ ] **Step 3: Write the implementation** (ported verbatim from `~/Projekte/browser_embed/src/lib/similarity.ts`, with SPDX header added)

```ts
// SPDX-License-Identifier: LGPL-3.0-only

export type Vector = ArrayLike<number>;

export function dot(a: Vector, b: Vector): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

export function l2Norm(v: Vector): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: Vector, b: Vector): number {
  const denom = l2Norm(a) * l2Norm(b);
  return denom === 0 ? 0 : dot(a, b) / denom;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/embeddings test src/lib/similarity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/src/lib
git commit -m "Add similarity helpers to embeddings package"
```

---

## Task 2: int8 max-abs quantisation codec (the heart)

**Files:**
- Create: `packages/embeddings/src/store/quantise.ts`
- Test: `packages/embeddings/src/store/quantise.test.ts`

This is the novel core: per-vector max-abs int8 where cosine cancels the scale, with the no-clip invariant.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../lib/similarity.js';
import { cosineFromQuant, dequantise, quantiseMaxAbs } from './quantise.js';

function randomUnitVector(dim: number, seed: number): Float32Array {
  // Deterministic pseudo-random unit vector (no Math.random — reproducible tests).
  const v = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v[i] = (s / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i]! /= norm;
  return v;
}

describe('quantiseMaxAbs', () => {
  it('maps the largest-magnitude component to exactly ±127 — no clipping', () => {
    const v = new Float32Array([0.1, -0.5, 0.25, 0.05]);
    const { q } = quantiseMaxAbs(v);
    expect(Math.max(...Array.from(q, Math.abs))).toBe(127);
    for (const x of q) expect(Math.abs(x)).toBeLessThanOrEqual(127);
    expect(q[1]).toBe(-127); // the max-abs component
  });

  it('round-trips a unit vector with high cosine fidelity', () => {
    const v = randomUnitVector(768, 42);
    const back = dequantise(quantiseMaxAbs(v));
    expect(cosineSimilarity(v, back)).toBeGreaterThan(0.999);
  });

  it('cosineFromQuant matches true cosine within int8 tolerance (scale cancels)', () => {
    const a = randomUnitVector(768, 1);
    const b = randomUnitVector(768, 2);
    const trueCos = cosineSimilarity(a, b);
    const quantCos = cosineFromQuant(quantiseMaxAbs(a), quantiseMaxAbs(b));
    expect(Math.abs(quantCos - trueCos)).toBeLessThan(0.01);
  });

  it('handles the zero vector without NaN', () => {
    const z = new Float32Array(8);
    const qv = quantiseMaxAbs(z);
    expect(qv.norm).toBe(0);
    expect(qv.scale).toBe(0);
    expect(cosineFromQuant(qv, quantiseMaxAbs(randomUnitVector(8, 3)))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/embeddings test src/store/quantise.test.ts`
Expected: FAIL — cannot resolve `./quantise.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * A vector stored as symmetric per-vector max-abs int8.
 * `scale` dequantises (v ≈ scale · q); `norm` is the L2 length of `q`
 * in integer space, precomputed so cosine divides by it directly.
 */
export interface QuantVector {
  q: Int8Array;
  scale: number;
  norm: number;
}

/**
 * Quantise a float vector to symmetric per-vector max-abs int8.
 * The component with the largest magnitude maps to exactly ±127, so
 * nothing is ever clipped — an outlier defines the scale rather than
 * being truncated.
 */
export function quantiseMaxAbs(v: ArrayLike<number>): QuantVector {
  let max = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]!);
    if (a > max) max = a;
  }
  const q = new Int8Array(v.length);
  if (max === 0) return { q, scale: 0, norm: 0 };

  const inv = 127 / max;
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    let qi = Math.round(v[i]! * inv);
    // Defensive clamp for floating-point edge cases only; the true max maps to ±127.
    if (qi > 127) qi = 127;
    else if (qi < -127) qi = -127;
    q[i] = qi;
    sumSq += qi * qi;
  }
  return { q, scale: max / 127, norm: Math.sqrt(sumSq) };
}

/** Reconstruct an approximate float vector (used by the future "dreaming" merge pass). */
export function dequantise(qv: QuantVector): Float32Array {
  const out = new Float32Array(qv.q.length);
  for (let i = 0; i < qv.q.length; i++) out[i] = qv.q[i]! * qv.scale;
  return out;
}

/**
 * Cosine similarity directly from two int8 vectors. The per-vector scales
 * cancel: cosine = Σ(qaᵢ·qbᵢ) / (‖qa‖·‖qb‖). Integer dot product, divided
 * by the precomputed norms.
 */
export function cosineFromQuant(a: QuantVector, b: QuantVector): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const qa = a.q;
  const qb = b.q;
  const n = Math.min(qa.length, qb.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += qa[i]! * qb[i]!;
  return dot / (a.norm * b.norm);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/embeddings test src/store/quantise.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/src/store/quantise.ts packages/embeddings/src/store/quantise.test.ts
git commit -m "Add int8 max-abs quantisation codec (cosine cancels the scale)"
```

---

## Task 3: Store schema & record types

**Files:**
- Create: `packages/embeddings/src/store/schema.ts`

No test — pure type and constant declarations.

- [ ] **Step 1: Write `schema.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

/** Caller-facing record handed to the store. `vector` is a float embedding; the store quantises it. */
export interface VectorInput {
  id: string;
  collection: string;
  vector: Float32Array;
  tags?: Record<string, string>;
  numeric?: Record<string, number>;
  metadata?: unknown;
  updatedAt: number;
}

/** The row as persisted in IndexedDB: quantised int8 plus scale/norm and precomputed byte size. */
export interface VectorRow {
  id: string;
  collection: string;
  q: Int8Array;
  scale: number;
  norm: number;
  tags: Record<string, string>;
  numeric: Record<string, number>;
  metadata?: unknown;
  updatedAt: number;
  bytes: number;
}

/**
 * Dexie store-string for the `vectors` table. The primary key is `id`;
 * `collection` and the compound `[collection+updatedAt]` are indexed for the
 * common recency-windowed filter. Tag/numeric predicates are applied in-memory
 * over the narrowed candidate set (spec §5.3).
 */
export const VECTORS_STORE_SCHEMA = 'id, collection, [collection+updatedAt]';

/** Approximate persisted size of a row in bytes (int8 vector dominates). */
export function rowBytes(q: Int8Array, tags: Record<string, string>, numeric: Record<string, number>, metadata: unknown): number {
  const tagBytes = JSON.stringify(tags).length;
  const numBytes = JSON.stringify(numeric).length;
  const metaBytes = metadata === undefined ? 0 : JSON.stringify(metadata).length;
  return q.byteLength + 16 + tagBytes + numBytes + metaBytes; // +16 for scale/norm/updatedAt overhead
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/embeddings/src/store/schema.ts
git commit -m "Add embeddings store schema and record types"
```

---

## Task 4: Retrieval — filter + rank (NEW)

**Files:**
- Create: `packages/embeddings/src/store/retrieval.ts`
- Test: `packages/embeddings/src/store/retrieval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { quantiseMaxAbs } from './quantise.js';
import { type Candidate, matchesFilter, scoreAndRank } from './retrieval.js';
import type { VectorRow } from './schema.js';

function row(id: string, vec: number[], tags = {}, numeric = {}, metadata?: unknown): VectorRow {
  const { q, scale, norm } = quantiseMaxAbs(new Float32Array(vec));
  return { id, collection: 'c', q, scale, norm, tags, numeric, metadata, updatedAt: 0, bytes: 0 };
}

describe('matchesFilter', () => {
  const r = row('1', [1, 0], { persona: 'p1', mode: 'sfw' }, { createdAt: 100, salience: 5 });

  it('passes when all tag equalities and numeric predicates hold', () => {
    expect(matchesFilter(r, { tags: { persona: 'p1' }, numeric: { createdAt: { gte: 50 } } })).toBe(true);
  });
  it('fails on a tag mismatch', () => {
    expect(matchesFilter(r, { tags: { persona: 'p2' } })).toBe(false);
  });
  it('fails on a numeric range miss', () => {
    expect(matchesFilter(r, { numeric: { createdAt: { lt: 100 } } })).toBe(false);
  });
  it('fails when a filtered numeric key is absent on the record', () => {
    expect(matchesFilter(r, { numeric: { missing: { gte: 0 } } })).toBe(false);
  });
  it('passes with no filter', () => {
    expect(matchesFilter(r)).toBe(true);
  });
});

describe('scoreAndRank', () => {
  const query = quantiseMaxAbs(new Float32Array([1, 0]));
  const rows = [
    row('near', [0.99, 0.14]),
    row('mid', [0.7, 0.7]),
    row('far', [0, 1]),
  ];

  it('ranks by cosine descending and respects topK', () => {
    const out = scoreAndRank(query, rows, { topK: 2 });
    expect(out.map((c) => c.id)).toEqual(['near', 'mid']);
  });

  it('applies minScore as a floor before ranking', () => {
    const out = scoreAndRank(query, rows, { topK: 10, minScore: 0.5 });
    expect(out.map((c) => c.id)).toEqual(['near', 'mid']); // 'far' (cos 0) excluded
  });

  it('over-fetches candidateK then lets rerank reorder before topK', () => {
    const rerank = (cands: Candidate[]) => [...cands].reverse();
    const out = scoreAndRank(query, rows, { topK: 2, candidateK: 3, rerank });
    expect(out.map((c) => c.id)).toEqual(['far', 'mid']); // reversed pool [far,mid,near] → topK 2
  });

  it('exposes numeric and metadata on candidates for the rerank hook', () => {
    const withMeta = [row('x', [1, 0], {}, { salience: 9 }, { note: 'hi' })];
    const [c] = scoreAndRank(query, withMeta, { topK: 1 });
    expect(c!.numeric.salience).toBe(9);
    expect(c!.metadata).toEqual({ note: 'hi' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/embeddings test src/store/retrieval.test.ts`
Expected: FAIL — cannot resolve `./retrieval.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { cosineFromQuant, type QuantVector } from './quantise.js';
import type { VectorRow } from './schema.js';

export interface NumericPredicate {
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
  eq?: number;
}

export interface VectorFilter {
  tags?: Record<string, string>;
  numeric?: Record<string, NumericPredicate>;
}

export interface Candidate {
  id: string;
  score: number; // cosine similarity
  numeric: Record<string, number>;
  metadata?: unknown;
}

export interface RankOptions {
  topK: number;
  candidateK?: number;
  minScore?: number;
  rerank?: (candidates: Candidate[]) => Candidate[];
}

/** True iff the row satisfies every tag equality and numeric predicate in the filter. */
export function matchesFilter(
  row: Pick<VectorRow, 'tags' | 'numeric'>,
  filter?: VectorFilter,
): boolean {
  if (!filter) return true;
  if (filter.tags) {
    for (const [k, v] of Object.entries(filter.tags)) {
      if (row.tags[k] !== v) return false;
    }
  }
  if (filter.numeric) {
    for (const [k, p] of Object.entries(filter.numeric)) {
      const x = row.numeric[k];
      if (x === undefined) return false;
      if (p.eq !== undefined && x !== p.eq) return false;
      if (p.gte !== undefined && !(x >= p.gte)) return false;
      if (p.lte !== undefined && !(x <= p.lte)) return false;
      if (p.gt !== undefined && !(x > p.gt)) return false;
      if (p.lt !== undefined && !(x < p.lt)) return false;
    }
  }
  return true;
}

/**
 * Score candidate rows against a query vector and rank them.
 * Order of operations (spec §5.4): cosine score → minScore floor →
 * sort desc → over-fetch candidateK → rerank hook → final topK.
 */
export function scoreAndRank(
  query: QuantVector,
  rows: VectorRow[],
  opts: RankOptions,
): Candidate[] {
  let pool: Candidate[] = rows.map((r) => ({
    id: r.id,
    score: cosineFromQuant(query, r),
    numeric: r.numeric,
    metadata: r.metadata,
  }));

  if (opts.minScore !== undefined) {
    pool = pool.filter((c) => c.score >= opts.minScore!);
  }
  pool.sort((a, b) => b.score - a.score);
  if (opts.candidateK !== undefined) {
    pool = pool.slice(0, opts.candidateK);
  }
  if (opts.rerank) {
    pool = opts.rerank(pool);
  }
  return pool.slice(0, opts.topK);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/embeddings test src/store/retrieval.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/src/store/retrieval.ts packages/embeddings/src/store/retrieval.test.ts
git commit -m "Add filter-then-rank retrieval with candidateK + rerank"
```

---

## Task 5: Vector store — CRUD + budget over a provided Dexie table

**Files:**
- Create: `packages/embeddings/src/store/vector-store.ts`
- Test: `packages/embeddings/src/store/vector-store.test.ts`

The store operates on a consumer-provided Dexie table (spec §3.1). For tests we construct a throwaway Dexie DB backed by `fake-indexeddb` (loaded in `vitest.setup.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import Dexie, { type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quantiseMaxAbs } from './quantise.js';
import { type VectorRow, VECTORS_STORE_SCHEMA } from './schema.js';
import { BudgetExceededError, createVectorStore } from './vector-store.js';

class TestDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

let db: TestDb;
let counter = 0;

function input(id: string, vec: number[], tags = {}, numeric = {}, metadata?: unknown) {
  return { id, collection: 'memory', vector: new Float32Array(vec), tags, numeric, metadata, updatedAt: 1 };
}

beforeEach(async () => {
  db = new TestDb(`test-${counter++}`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('vector store CRUD', () => {
  it('upserts and queries by vector, ranking by cosine', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0]), input('b', [0, 1])]);
    const hits = await store.query({ collection: 'memory', vector: new Float32Array([0.9, 0.1]), topK: 1 });
    expect(hits[0]!.id).toBe('a');
  });

  it('upsert replaces an existing id', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0], { v: '1' })]);
    await store.upsert([input('a', [1, 0], { v: '2' })]);
    const rows = await store.scan({ collection: 'memory' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tags.v).toBe('2');
  });

  it('filters by tags and numeric range before ranking', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([
      input('old', [1, 0], { persona: 'p1' }, { createdAt: 10 }),
      input('new', [1, 0], { persona: 'p1' }, { createdAt: 100 }),
      input('other', [1, 0], { persona: 'p2' }, { createdAt: 100 }),
    ]);
    const hits = await store.query({
      collection: 'memory',
      vector: new Float32Array([1, 0]),
      filter: { tags: { persona: 'p1' }, numeric: { createdAt: { gte: 50 } } },
      topK: 10,
    });
    expect(hits.map((h) => h.id)).toEqual(['new']);
  });

  it('update mutates numeric/metadata without re-embedding', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0], {}, { salience: 1 })]);
    const before = (await store.scan({ collection: 'memory' }))[0]!;
    await store.update('a', { numeric: { salience: 9 } });
    const after = (await store.scan({ collection: 'memory' }))[0]!;
    expect(after.numeric.salience).toBe(9);
    expect(Array.from(after.q)).toEqual(Array.from(before.q)); // vector untouched
  });

  it('delete and deleteWhere remove rows', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0], { k: 'x' }), input('b', [0, 1], { k: 'y' })]);
    await store.delete(['a']);
    expect(await store.scan({ collection: 'memory' })).toHaveLength(1);
    const removed = await store.deleteWhere({ collection: 'memory', filter: { tags: { k: 'y' } } });
    expect(removed).toBe(1);
    expect(await store.scan({ collection: 'memory' })).toHaveLength(0);
  });

  it('usage reports count and bytes', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0]), input('b', [0, 1])]);
    const u = await store.usage();
    expect(u.count).toBe(2);
    expect(u.bytes).toBeGreaterThan(0);
  });
});

describe('storage budget', () => {
  it('rejects on full by default with a typed error', async () => {
    const store = createVectorStore({ db, table: db.vectors, budget: { maxCount: 1 } });
    await store.upsert([input('a', [1, 0])]);
    await expect(store.upsert([input('b', [0, 1])])).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('invokes the eviction hook instead of rejecting when provided', async () => {
    const evicted: string[] = [];
    const store = createVectorStore({
      db,
      table: db.vectors,
      budget: {
        maxCount: 1,
        onFull: async ({ table }) => {
          const all = await table.toArray();
          const victim = all[0]!.id;
          await table.delete(victim);
          evicted.push(victim);
        },
      },
    });
    await store.upsert([input('a', [1, 0])]);
    await store.upsert([input('b', [0, 1])]);
    expect(evicted).toEqual(['a']);
    expect(await store.scan({ collection: 'memory' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/embeddings test src/store/vector-store.test.ts`
Expected: FAIL — cannot resolve `./vector-store.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type Dexie from 'dexie';
import type { Table } from 'dexie';
import type { EmbeddingEngine } from '../engine/engine.js';
import { quantiseMaxAbs } from './quantise.js';
import { type Candidate, matchesFilter, type RankOptions, scoreAndRank, type VectorFilter } from './retrieval.js';
import { rowBytes, type VectorInput, type VectorRow } from './schema.js';

/** Thrown when an upsert would exceed the configured storage budget and no eviction hook is set. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface EvictionContext {
  table: Table<VectorRow, string>;
  usage: { count: number; bytes: number };
  incoming: { count: number; bytes: number };
}

export type EvictionHook = (ctx: EvictionContext) => Promise<void>;

export interface Budget {
  maxCount?: number;
  maxBytes?: number;
  onFull?: EvictionHook; // default: reject with BudgetExceededError
}

export interface VectorStoreConfig {
  db: Dexie;
  table: Table<VectorRow, string>;
  engine?: EmbeddingEngine;
  budget?: Budget;
}

export interface QueryRequest extends Omit<RankOptions, never> {
  collection: string;
  filter?: VectorFilter;
  text?: string;
  vector?: Float32Array;
  topK: number;
  candidateK?: number;
  minScore?: number;
  rerank?: (candidates: Candidate[]) => Candidate[];
}

export interface ScanRequest {
  collection: string;
  filter?: VectorFilter;
}

export interface VectorStore {
  upsert(records: VectorInput[]): Promise<void>;
  update(id: string, patch: { numeric?: Record<string, number>; metadata?: unknown }): Promise<void>;
  delete(ids: string[]): Promise<void>;
  deleteWhere(req: ScanRequest): Promise<number>;
  scan(req: ScanRequest): Promise<VectorRow[]>;
  query(req: QueryRequest): Promise<Candidate[]>;
  usage(): Promise<{ count: number; bytes: number; perCollection: Record<string, { count: number; bytes: number }> }>;
}

function toRow(input: VectorInput): VectorRow {
  const { q, scale, norm } = quantiseMaxAbs(input.vector);
  const tags = input.tags ?? {};
  const numeric = input.numeric ?? {};
  return {
    id: input.id,
    collection: input.collection,
    q,
    scale,
    norm,
    tags,
    numeric,
    metadata: input.metadata,
    updatedAt: input.updatedAt,
    bytes: rowBytes(q, tags, numeric, input.metadata),
  };
}

/** Narrow to a collection via the Dexie index, then apply tag/numeric predicates in memory. */
async function loadCandidates(
  table: Table<VectorRow, string>,
  collection: string,
  filter?: VectorFilter,
): Promise<VectorRow[]> {
  const rows = await table.where('collection').equals(collection).toArray();
  return filter ? rows.filter((r) => matchesFilter(r, filter)) : rows;
}

export function createVectorStore(config: VectorStoreConfig): VectorStore {
  const { db, table, engine, budget } = config;

  async function currentUsage(): Promise<{ count: number; bytes: number }> {
    let count = 0;
    let bytes = 0;
    await table.each((r) => {
      count++;
      bytes += r.bytes;
    });
    return { count, bytes };
  }

  async function enforceBudget(rows: VectorRow[]): Promise<void> {
    if (!budget) return;
    const usage = await currentUsage();
    const incoming = { count: rows.length, bytes: rows.reduce((s, r) => s + r.bytes, 0) };
    const overCount = budget.maxCount !== undefined && usage.count + incoming.count > budget.maxCount;
    const overBytes = budget.maxBytes !== undefined && usage.bytes + incoming.bytes > budget.maxBytes;
    if (!overCount && !overBytes) return;
    if (budget.onFull) {
      await budget.onFull({ table, usage, incoming });
      return;
    }
    throw new BudgetExceededError(
      `Storage budget exceeded (count ${usage.count}+${incoming.count}/${budget.maxCount ?? '∞'}, bytes ${usage.bytes}+${incoming.bytes}/${budget.maxBytes ?? '∞'})`,
    );
  }

  return {
    async upsert(records) {
      const rows = records.map(toRow);
      await enforceBudget(rows);
      await db.transaction('rw', table, async () => {
        await table.bulkPut(rows);
      });
    },

    async update(id, patch) {
      await table.update(id, {
        ...(patch.numeric !== undefined ? { numeric: patch.numeric } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      });
    },

    async delete(ids) {
      await table.bulkDelete(ids);
    },

    async deleteWhere(req) {
      const rows = await loadCandidates(table, req.collection, req.filter);
      const ids = rows.map((r) => r.id);
      await table.bulkDelete(ids);
      return ids.length;
    },

    async scan(req) {
      return loadCandidates(table, req.collection, req.filter);
    },

    async query(req) {
      let queryVec: Float32Array;
      if (req.vector) {
        queryVec = req.vector;
      } else if (req.text) {
        if (!engine) throw new Error('Text queries require an Engine — construct the store with { engine }.');
        const [embedded] = await engine.embed([req.text], { kind: 'query' });
        queryVec = embedded!;
      } else {
        throw new Error('query requires exactly one of { text, vector }.');
      }
      const rows = await loadCandidates(table, req.collection, req.filter);
      return scoreAndRank(quantiseMaxAbs(queryVec), rows, {
        topK: req.topK,
        candidateK: req.candidateK,
        minScore: req.minScore,
        rerank: req.rerank,
      });
    },

    async usage() {
      const perCollection: Record<string, { count: number; bytes: number }> = {};
      let count = 0;
      let bytes = 0;
      await table.each((r) => {
        count++;
        bytes += r.bytes;
        const c = (perCollection[r.collection] ??= { count: 0, bytes: 0 });
        c.count++;
        c.bytes += r.bytes;
      });
      return { count, bytes, perCollection };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/embeddings test src/store/vector-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/src/store/vector-store.ts packages/embeddings/src/store/vector-store.test.ts
git commit -m "Add vector store CRUD with budget and eviction hook"
```

---

## Task 6: Execution-mode types (port)

**Files:**
- Create: `packages/embeddings/src/engine/execution-modes.ts`

Ported from `~/Projekte/browser_embed/src/lib/executionModes.ts`. No test (types + label maps).

- [ ] **Step 1: Write `execution-modes.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

export type ExecutionMode = 'auto' | 'webgpu' | 'wasm-multi' | 'wasm-single';

export interface ResolvedBackend {
  executionMode: ExecutionMode;
  device: string;
  dtype: string;
  wasmThreadsConfigured: number;
  webgpuAvailable: boolean;
  crossOriginIsolated: boolean;
  fallbackTrail: string[];
}

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  auto: 'Auto (WebGPU → WASM multi → WASM single)',
  webgpu: 'WebGPU (forced)',
  'wasm-multi': 'WASM multi-thread',
  'wasm-single': 'WASM single-thread',
};

export function formatBackendLabel(backend: ResolvedBackend): string {
  const threads =
    backend.executionMode === 'webgpu' ? '' : ` · ${backend.wasmThreadsConfigured} WASM thread(s)`;
  return `${backend.executionMode} (${backend.device})${threads}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/embeddings/src/engine/execution-modes.ts
git commit -m "Add execution-mode types to embeddings package"
```

---

## Task 7: Model config + query/document prefix (NEW)

**Files:**
- Create: `packages/embeddings/src/engine/model-config.ts`
- Test: `packages/embeddings/src/engine/model-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { applyPrefix, DOC_PREFIX, QUERY_PREFIX } from './model-config.js';

describe('applyPrefix', () => {
  it('prepends the query prefix for queries', () => {
    expect(applyPrefix('what is snowflake?', 'query')).toBe(`${QUERY_PREFIX}what is snowflake?`);
  });
  it('leaves documents unprefixed', () => {
    expect(applyPrefix('The Data Cloud!', 'document')).toBe(`${DOC_PREFIX}The Data Cloud!`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/embeddings test src/engine/model-config.test.ts`
Expected: FAIL — cannot resolve `./model-config.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

export const MODEL_ID = 'Snowflake/snowflake-arctic-embed-m-v2.0';
export const EMBED_DIM = 768;

/**
 * arctic-embed v2.0 prepends a prompt to queries but not to documents.
 * NOTE: the exact prefix string is verified empirically against the model-card
 * reference scores (0.327 / 0.070) in the dev smoke page; adjust here if the
 * probe disagrees with this default. (Spec §4, §9.)
 */
export const QUERY_PREFIX = 'query: ';
export const DOC_PREFIX = '';

export const POOLING = 'cls' as const;

export type EmbedKind = 'query' | 'document';

export function applyPrefix(text: string, kind: EmbedKind): string {
  return (kind === 'query' ? QUERY_PREFIX : DOC_PREFIX) + text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/embeddings test src/engine/model-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/src/engine/model-config.ts packages/embeddings/src/engine/model-config.test.ts
git commit -m "Add model config and query/document prefix logic"
```

---

## Task 8: Execution — capability discovery + fallback (port, with tests on the pure helpers)

**Files:**
- Create: `packages/embeddings/src/engine/execution.ts`
- Test: `packages/embeddings/src/engine/execution.test.ts`

Port `~/Projekte/browser_embed/src/lib/execution.ts` with these adaptations:
1. Add `// SPDX-License-Identifier: LGPL-3.0-only` header.
2. Replace the inline `const MODEL_ID = '…'` with `import { MODEL_ID } from './model-config.js'`.
3. Change imports from `./executionModes` to `./execution-modes.js`.
4. Configure transformers.js for self-hosted local models at module top (spec §2): set `env.allowRemoteModels = false` and `env.localModelPath` to the served `public/model/` path. Add near the top, after the import of `env`:

```ts
import { env } from '@huggingface/transformers';
// Self-hosted only — never call huggingface.co at runtime (spec §2).
env.allowRemoteModels = false;
env.localModelPath = '/model/';
```

5. Translate the remaining German error/trail strings to British English (e.g. `'übersprungen'` → `'skipped'`, `'fehlgeschlagen'` → `'failed'`, `'Timeout nach'` → `'timeout after'`, `'nicht vorhanden'` → `'not present'`, `'ist null'` → `'is null'`, `'Kein Backend verfügbar'` → `'No backend available'`, `'Pipeline-Init'` → `'pipeline init'`, `'Smoke-Test'` → `'smoke test'`, `'Laufzeit'` → `'runtime'`). Keep all logic identical.

Export, in addition to the ported functions, these pure helpers (factored out so they can be unit-tested without WASM): `buildAttemptList`, `shouldRetryWithWasmFallback`, `wasmFallbackSkipModes` already exist in the PoC — ensure they are exported. Also export `probeWebGpu`.

- [ ] **Step 1: Write the failing test** (covers the pure decision logic; WASM/model loading is verified manually via the dev page)

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildAttemptList, shouldRetryWithWasmFallback, wasmFallbackSkipModes } from './execution.js';
import type { ResolvedBackend } from './execution-modes.js';

describe('buildAttemptList', () => {
  it('auto mode yields the full fallback chain in order', () => {
    expect(buildAttemptList('auto').map((a) => a.mode)).toEqual(['webgpu', 'wasm-multi', 'wasm-single']);
  });
  it('a forced mode yields only that mode', () => {
    expect(buildAttemptList('wasm-multi').map((a) => a.mode)).toEqual(['wasm-multi']);
  });
  it('skipModes removes attempts (e.g. after a WebGPU runtime failure)', () => {
    expect(buildAttemptList('auto', ['webgpu']).map((a) => a.mode)).toEqual(['wasm-multi', 'wasm-single']);
  });
});

describe('shouldRetryWithWasmFallback', () => {
  const webgpuBackend: ResolvedBackend = {
    executionMode: 'webgpu', device: 'webgpu', dtype: 'int8', wasmThreadsConfigured: 0,
    webgpuAvailable: true, crossOriginIsolated: true, fallbackTrail: [],
  };
  it('retries only in auto mode after a webgpu backend failed', () => {
    expect(shouldRetryWithWasmFallback('auto', webgpuBackend)).toBe(true);
  });
  it('does not retry in a forced mode', () => {
    expect(shouldRetryWithWasmFallback('webgpu', webgpuBackend)).toBe(false);
  });
  it('does not retry when the backend was not webgpu', () => {
    expect(shouldRetryWithWasmFallback('auto', { ...webgpuBackend, executionMode: 'wasm-multi' })).toBe(false);
  });
});

describe('wasmFallbackSkipModes', () => {
  it('skips webgpu', () => {
    expect(wasmFallbackSkipModes()).toEqual(['webgpu']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/embeddings test src/engine/execution.test.ts`
Expected: FAIL — cannot resolve `./execution.js`.

- [ ] **Step 3: Port the implementation** as described above (copy `~/Projekte/browser_embed/src/lib/execution.ts`, apply adaptations 1–5, ensure the four helpers are exported). The full ported file is large; reproduce it faithfully from the source — the logic must be byte-for-byte equivalent except for the listed string/import/env changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/embeddings test src/engine/execution.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/src/engine/execution.ts packages/embeddings/src/engine/execution.test.ts
git commit -m "Port capability discovery + backend fallback (self-hosted, en strings)"
```

---

## Task 9: Worker — model load + embed (port/adapt)

**Files:**
- Create: `packages/embeddings/src/engine/worker.ts`

Adapt `~/Projekte/browser_embed/src/embeddingWorker.ts`. Keep the `EmbeddingPipeline` class, the load/fallback machinery, and the error/unhandledrejection handlers. Changes:
1. SPDX header; British-English strings.
2. Import `createFeatureExtractor`, helpers from `./execution.js`; `applyPrefix`, `POOLING`, type `EmbedKind` from `./model-config.js`.
3. Replace the PoC's `benchmark`/multi-purpose message protocol with our minimal one:
   - `InitRequest { type: 'init'; executionMode: ExecutionMode }` → loads (dtype is always `'int8'`).
   - `EmbedRequest { type: 'embed'; id: number; texts: string[]; kind: EmbedKind }`.
   - Responses: `ReadyMessage { type: 'ready'; backend }`, `EmbedResult { type: 'result'; id; embeddings: number[][] }`, `ErrorMessage { type: 'error'; id?: number; message; stack? }`.
4. In `embed`, map each text through `applyPrefix(text, kind)` before calling the extractor; call with `{ normalize: true, pooling: POOLING }`; return `output.tolist()` normalised to `number[][]` (reuse the PoC `normalizeEmbeddings` helper).
5. Keep `dtype` fixed to `'int8'`.

- [ ] **Step 1: Write `worker.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
/// <reference lib="webworker" />
import type { FeatureExtractionPipeline, ProgressCallback } from '@huggingface/transformers';
import {
  createFeatureExtractor,
  shouldRetryWithWasmFallback,
  wasmFallbackSkipModes,
} from './execution.js';
import type { ExecutionMode, ResolvedBackend } from './execution-modes.js';
import { applyPrefix, type EmbedKind, POOLING } from './model-config.js';

interface InitRequest {
  type: 'init';
  executionMode: ExecutionMode;
}
interface EmbedRequest {
  type: 'embed';
  id: number;
  texts: string[];
  kind: EmbedKind;
}
type WorkerRequest = InitRequest | EmbedRequest;

let activeBackend: ResolvedBackend | null = null;

class EmbeddingPipeline {
  static instance: FeatureExtractionPipeline | null = null;
  static executionMode: ExecutionMode = 'auto';

  static reset() {
    this.instance = null;
  }

  static async load(
    progress_callback?: ProgressCallback,
    skipModes: Exclude<ExecutionMode, 'auto'>[] = [],
  ): Promise<ResolvedBackend> {
    this.reset();
    const { extractor, backend } = await createFeatureExtractor('int8', this.executionMode, {
      progress_callback,
      skipModes,
    });
    this.instance = extractor;
    activeBackend = backend;
    return backend;
  }

  static async getInstance(): Promise<FeatureExtractionPipeline> {
    if (!this.instance) await this.load();
    return this.instance!;
  }

  static async reloadWasmFallback(): Promise<ResolvedBackend> {
    const trail = [...(activeBackend?.fallbackTrail ?? []), 'runtime: WebGPU inference failed → WASM fallback'];
    const backend = await this.load(undefined, wasmFallbackSkipModes());
    activeBackend = { ...backend, fallbackTrail: trail };
    return activeBackend;
  }
}

function normalizeEmbeddings(raw: number[] | number[][]): number[][] {
  if (!raw.length) return [];
  if (typeof raw[0] === 'number') return [raw as number[]];
  return raw as number[][];
}

async function embedBatch(
  extractor: FeatureExtractionPipeline,
  texts: string[],
  kind: EmbedKind,
): Promise<number[][]> {
  const prefixed = texts.map((t) => applyPrefix(t, kind));
  const output = await extractor(prefixed, { normalize: true, pooling: POOLING });
  return normalizeEmbeddings(output.tolist());
}

async function embedWithRuntimeFallback(texts: string[], kind: EmbedKind): Promise<number[][]> {
  try {
    const extractor = await EmbeddingPipeline.getInstance();
    return await embedBatch(extractor, texts, kind);
  } catch (firstErr) {
    if (!shouldRetryWithWasmFallback(EmbeddingPipeline.executionMode, activeBackend)) throw firstErr;
    await EmbeddingPipeline.reloadWasmFallback();
    const extractor = await EmbeddingPipeline.getInstance();
    return await embedBatch(extractor, texts, kind);
  }
}

const postProgress: ProgressCallback = (data) => {
  self.postMessage(data);
};

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      EmbeddingPipeline.executionMode = msg.executionMode;
      const backend = await EmbeddingPipeline.load(postProgress);
      self.postMessage({ type: 'ready', backend });
      return;
    }
    if (msg.type === 'embed') {
      const embeddings = await embedWithRuntimeFallback(msg.texts, msg.kind);
      self.postMessage({ type: 'result', id: msg.id, embeddings });
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.type === 'embed' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
});

self.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  self.postMessage({
    type: 'error',
    message: `Unhandled: ${reason instanceof Error ? reason.message : String(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/embeddings typecheck`
Expected: PASS (no type errors). (Worker behaviour is verified manually via the dev page — Task 12.)

- [ ] **Step 3: Commit**

```bash
git add packages/embeddings/src/engine/worker.ts
git commit -m "Add embedding worker (init + embed with query/doc prefix)"
```

---

## Task 10: Engine — main-thread facade (NEW)

**Files:**
- Create: `packages/embeddings/src/engine/engine.ts`

The facade spawns the worker, performs init, and exposes `embed`/`backend`/`dispose`. It correlates `embed` responses by an incrementing id.

- [ ] **Step 1: Write `engine.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ExecutionMode, ResolvedBackend } from './execution-modes.js';
import type { EmbedKind } from './model-config.js';

export interface EmbeddingEngine {
  readonly backend: ResolvedBackend;
  embed(texts: string[], opts: { kind: EmbedKind }): Promise<Float32Array[]>;
  dispose(): void;
}

export interface CreateEngineOptions {
  executionMode?: ExecutionMode;
  /** Progress callback during model load (download/compile). */
  onProgress?: (data: unknown) => void;
}

interface PendingEmbed {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}

export function createEmbeddingEngine(opts: CreateEngineOptions = {}): Promise<EmbeddingEngine> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, PendingEmbed>();
  let nextId = 1;

  return new Promise<EmbeddingEngine>((resolveInit, rejectInit) => {
    let backend: ResolvedBackend | null = null;

    worker.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'ready') {
        backend = msg.backend as ResolvedBackend;
        resolveInit(engine);
        return;
      }
      if (msg?.type === 'result') {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.resolve((msg.embeddings as number[][]).map((row) => Float32Array.from(row)));
        }
        return;
      }
      if (msg?.type === 'error') {
        const err = new Error(msg.message);
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          pending.get(msg.id)!.reject(err);
          pending.delete(msg.id);
        } else if (!backend) {
          rejectInit(err);
        }
        return;
      }
      if (opts.onProgress && msg?.status) opts.onProgress(msg);
    });

    worker.addEventListener('error', (e) => {
      if (!backend) rejectInit(new Error(`Worker error: ${e.message}`));
    });

    const engine: EmbeddingEngine = {
      get backend() {
        if (!backend) throw new Error('Engine not ready');
        return backend;
      },
      embed(texts, embedOpts) {
        return new Promise<Float32Array[]>((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ type: 'embed', id, texts, kind: embedOpts.kind });
        });
      },
      dispose() {
        worker.terminate();
        pending.clear();
      },
    };

    worker.postMessage({ type: 'init', executionMode: opts.executionMode ?? 'auto' });
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/embeddings typecheck`
Expected: PASS. (Runtime behaviour verified via the dev page — Task 12.)

- [ ] **Step 3: Commit**

```bash
git add packages/embeddings/src/engine/engine.ts
git commit -m "Add main-thread engine facade over the worker"
```

---

## Task 11: Public API barrel

**Files:**
- Create: `packages/embeddings/src/index.ts`

- [ ] **Step 1: Write `index.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

// Engine — goal (a): text → vector
export { createEmbeddingEngine, type CreateEngineOptions, type EmbeddingEngine } from './engine/engine.js';
export { type EmbedKind, EMBED_DIM, MODEL_ID } from './engine/model-config.js';
export {
  type ExecutionMode,
  type ResolvedBackend,
  EXECUTION_MODE_LABELS,
  formatBackendLabel,
} from './engine/execution-modes.js';

// Store — goal (b): vector → filtered ranked hits
export {
  BudgetExceededError,
  type Budget,
  type EvictionHook,
  createVectorStore,
  type VectorStore,
  type VectorStoreConfig,
  type QueryRequest,
  type ScanRequest,
} from './store/vector-store.js';
export {
  type VectorInput,
  type VectorRow,
  VECTORS_STORE_SCHEMA,
} from './store/schema.js';
export {
  type Candidate,
  type NumericPredicate,
  type VectorFilter,
} from './store/retrieval.js';

// Quant + similarity helpers (for "dreaming"/dedup consumers)
export { cosineFromQuant, dequantise, quantiseMaxAbs, type QuantVector } from './store/quantise.js';
export { cosineSimilarity, dot, l2Norm } from './lib/similarity.js';
```

- [ ] **Step 2: Typecheck the whole package**

Run: `pnpm --filter @chatsundere/embeddings typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm --filter @chatsundere/embeddings test`
Expected: PASS (all suites green: similarity, quantise, retrieval, vector-store, model-config, execution).

- [ ] **Step 4: Commit**

```bash
git add packages/embeddings/src/index.ts
git commit -m "Add public API barrel for embeddings package"
```

---

## Task 12: Model fetch script

**Files:**
- Create: `packages/embeddings/scripts/fetch-model.mjs`

Downloads the int8 ONNX + tokenizer/config at a pinned revision and verifies SHA256. The exact file list and hashes are filled in on first run (see Step 2).

- [ ] **Step 1: Write `fetch-model.mjs`**

```js
// SPDX-License-Identifier: LGPL-3.0-only
// Downloads the self-hosted arctic-embed-m-v2.0 int8 assets and verifies SHA256.
// Usage: node scripts/fetch-model.mjs
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Snowflake/snowflake-arctic-embed-m-v2.0';
const REVISION = 'main'; // PIN to a commit SHA once known (spec §7).
const BASE = `https://huggingface.co/${REPO}/resolve/${REVISION}`;

// transformers.js expects this on-disk layout under localModelPath ('/model/'):
//   <root>/<REPO>/{config,tokenizer,tokenizer_config,special_tokens_map}.json
//   <root>/<REPO>/onnx/model_int8.onnx
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_int8.onnx',
];

// Filled in after the first run prints the computed hashes (Step 2).
const EXPECTED_SHA256 = {
  // 'onnx/model_int8.onnx': '…',
};

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, '..', 'public', 'model', REPO);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

for (const rel of FILES) {
  const url = `${BASE}/${rel}`;
  process.stdout.write(`Fetching ${rel} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = sha256(buf);
  const expected = EXPECTED_SHA256[rel];
  if (expected && expected !== digest) {
    throw new Error(`SHA256 mismatch for ${rel}: expected ${expected}, got ${digest}`);
  }
  const dest = join(outRoot, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`ok (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${digest.slice(0, 12)}…)`);
}
console.log('\nDone. If EXPECTED_SHA256 is empty, paste the printed hashes into the script to pin them.');
```

- [ ] **Step 2: Run it, pin the revision and hashes**

Run: `pnpm --filter @chatsundere/embeddings run fetch-model`
Expected: downloads all files into `packages/embeddings/public/model/Snowflake/snowflake-arctic-embed-m-v2.0/…` and prints each SHA256.
Then: replace `REVISION = 'main'` with the current commit SHA from the model repo, paste the printed hashes into `EXPECTED_SHA256`, and re-run — the second run must pass the SHA256 checks. Also confirm the model's LICENSE (Apache-2.0) and add it under `public/model/` (spec §11).

- [ ] **Step 3: Commit** (the model blob itself is gitignored)

```bash
git add packages/embeddings/scripts/fetch-model.mjs
git commit -m "Add deterministic model fetch script with SHA256 verification"
```

---

## Task 13: Dev smoke page (manual verification harness)

**Files:**
- Create: `packages/embeddings/index.html`
- Create: `packages/embeddings/dev/main.ts`
- Create: `packages/embeddings/vite.config.ts`

Unstyled, not shipped. Exercises the engine + store end-to-end with COOP/COEP set so WASM threads work (spec §8). Implements the spec §9 manual checks: model-card sanity + int8-delta, multilingual exploration, filter round-trip, backend report.

- [ ] **Step 1: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

// COOP/COEP enable crossOriginIsolated → WASM threads (spec §8).
export default defineConfig({
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

- [ ] **Step 2: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>embeddings dev smoke</title>
  </head>
  <body>
    <pre id="out">loading…</pre>
    <script type="module" src="/dev/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `dev/main.ts`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import Dexie, { type Table } from 'dexie';
import {
  createEmbeddingEngine,
  createVectorStore,
  formatBackendLabel,
  quantiseMaxAbs,
  cosineFromQuant,
  type VectorRow,
  VECTORS_STORE_SCHEMA,
} from '../src/index.js';

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += `\n${s}`;
};

class DemoDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor() {
    super('embeddings_dev_demo');
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

async function main() {
  out.textContent = 'creating engine…';
  const engine = await createEmbeddingEngine({ onProgress: (d) => log(`progress: ${JSON.stringify(d)}`) });
  log(`backend: ${formatBackendLabel(engine.backend)}`);
  log(`crossOriginIsolated: ${globalThis.crossOriginIsolated}`);

  // 1) Model-card sanity + int8 delta.
  const [q] = await engine.embed(['what is snowflake?'], { kind: 'query' });
  const docs = await engine.embed(['The Data Cloud!', 'Mexico City of Course!'], { kind: 'document' });
  const fp32Cos = (a: Float32Array, b: Float32Array) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
    return d / (Math.sqrt(na) * Math.sqrt(nb));
  };
  const int8Cos = (a: Float32Array, b: Float32Array) => cosineFromQuant(quantiseMaxAbs(a), quantiseMaxAbs(b));
  for (const [i, label] of ['The Data Cloud!', 'Mexico City of Course!'].entries()) {
    const fp = fp32Cos(q!, docs[i]!);
    const q8 = int8Cos(q!, docs[i]!);
    log(`sanity "${label}": fp32 ${fp.toFixed(4)} | int8 ${q8.toFixed(4)} | Δ ${(q8 - fp).toFixed(4)}`);
  }
  log('(expected fp32 references ~0.327 and ~0.070; int8 Δ should be small)');

  // 2) Multilingual exploration — degenerate-output + cross-lingual retrieval.
  const multilingual = [
    { lang: 'en', text: 'The cat sleeps on the warm windowsill.' },
    { lang: 'de', text: 'Die Katze schläft auf der warmen Fensterbank.' },
    { lang: 'ru', text: 'Кошка спит на тёплом подоконнике.' },
    { lang: 'ja', text: '猫が暖かい窓辺で眠っている。' },
    { lang: 'zh', text: '猫在温暖的窗台上睡觉。' },
    { lang: 'en2', text: 'Quarterly revenue exceeded all forecasts.' },
  ];
  const mvecs = await engine.embed(multilingual.map((m) => m.text), { kind: 'document' });
  mvecs.forEach((v, i) => {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const finite = v.every(Number.isFinite);
    log(`[${multilingual[i]!.lang}] finite=${finite} norm=${norm.toFixed(3)}`);
  });
  const [enQuery] = await engine.embed(['A feline rests by the sunny window.'], { kind: 'query' });
  const ranked = multilingual
    .map((m, i) => ({ lang: m.lang, cos: int8Cos(enQuery!, mvecs[i]!) }))
    .sort((a, b) => b.cos - a.cos);
  log(`cross-lingual ranking for "cat by window": ${ranked.map((r) => `${r.lang}:${r.cos.toFixed(2)}`).join(' ')}`);
  log('(the 5 cat sentences should outrank the revenue sentence regardless of script)');

  // 3) Filter + query round-trip through the store.
  const db = new DemoDb();
  await db.open();
  const store = createVectorStore({ db, table: db.vectors, engine });
  await store.upsert(
    multilingual.map((m, i) => ({
      id: m.lang,
      collection: 'demo',
      vector: mvecs[i]!,
      tags: { script: ['ru', 'ja', 'zh'].includes(m.lang) ? 'non-latin' : 'latin' },
      numeric: { idx: i },
      updatedAt: Date.now(),
    })),
  );
  const latinHits = await store.query({
    collection: 'demo',
    text: 'A feline rests by the sunny window.',
    filter: { tags: { script: 'latin' } },
    topK: 3,
  });
  log(`store query (latin only): ${latinHits.map((h) => `${h.id}:${h.score.toFixed(2)}`).join(' ')}`);
  log(`usage: ${JSON.stringify(await store.usage())}`);
  await Dexie.delete('embeddings_dev_demo');

  engine.dispose();
  log('\n✅ smoke complete');
}

main().catch((e) => log(`\n❌ ${e.stack ?? e}`));
```

- [ ] **Step 4: Run the dev page (manual)**

Run: `pnpm --filter @chatsundere/embeddings run fetch-model` (if not already done), then `pnpm --filter @chatsundere/embeddings dev`
Open the printed URL. Expected: backend reported (ideally WASM-multi with `crossOriginIsolated: true`); sanity scores near 0.327/0.070 with a small int8 Δ; all multilingual vectors finite with normal norms; the five cat sentences outrank the revenue sentence; the store query returns only latin-tagged hits. If the query prefix looks wrong (sanity scores far off), adjust `QUERY_PREFIX` in `model-config.ts` and re-run (spec §9 step 1).

- [ ] **Step 5: Commit**

```bash
git add packages/embeddings/index.html packages/embeddings/dev packages/embeddings/vite.config.ts
git commit -m "Add dev smoke page (sanity, multilingual, filter round-trip)"
```

---

## Task 14: README + final verification

**Files:**
- Create: `packages/embeddings/README.md`

- [ ] **Step 1: Write `README.md`** — cover: what the package is (corpus-agnostic client-local semantic search), the two goals, a minimal usage example for `createEmbeddingEngine` + `createVectorStore`, the `fetch-model` step, and the **integration requirements for a consuming app** (spec §8): COOP/COEP headers in dev and prod, `optimizeDeps.exclude` + `worker.format: 'es'`, serving `public/model/`, and the future Dexie v7 `vectors` table migration in `apps/user-client` using `VECTORS_STORE_SCHEMA`. British English throughout.

- [ ] **Step 2: Full monorepo verification**

Run: `pnpm --filter @chatsundere/embeddings test && pnpm --filter @chatsundere/embeddings typecheck && pnpm lint`
Expected: all green. (A full `pnpm build` does not build this package — it has no build step — but `pnpm typecheck` and `pnpm test` cover it.)

- [ ] **Step 3: Commit**

```bash
git add packages/embeddings/README.md
git commit -m "Add embeddings package README with integration requirements"
```

- [ ] **Step 4: Update STATUS-CLIENT-ONLY.md**

Add a short entry recording that `packages/embeddings` (client-local semantic-search BFF) landed: engine (arctic-embed int8, worker, caps-discovery) + vector store (max-abs int8 quant, filter-then-rank, budget). Note the deferred user-client Dexie v7 `vectors` migration (lands with the memory consumer). Update the `Last updated:` line. Commit:

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Record embeddings engine in client status [skip ci]"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- §2 model/trust (self-hosted, no HF call) → Task 8 (env config), Task 12 (fetch script). ✓
- §3 architecture / two units → Tasks 1–11. ✓
- §3.1 DB ownership (consumer table), sync-ready record → Task 5, Task 3. ✓ (v7 migration deferred — documented.)
- §4 engine, caps-discovery, query/doc prefix → Tasks 6–10. ✓
- §5.1 record shape → Task 3. ✓
- §5.2 max-abs int8, cosine cancels scale, no-clip → Task 2. ✓
- §5.3 filter-then-rank → Tasks 4, 5. ✓
- §5.4 query, candidateK, rerank → Tasks 4, 5. ✓
- §5.5 CRUD, dreaming primitives, budget/eviction/usage → Task 5. ✓
- §6 public API → Task 11. ✓
- §7 model delivery → Task 12. ✓
- §8 integration requirements → Task 13 (vite config), Task 14 (README). ✓
- §9 testing + manual (multilingual, int8 delta) → all `*.test.ts` tasks + Task 13. ✓
- §10 YAGNI → respected (no ANN, single format, no GUI). ✓

**Placeholder scan:** the only deliberate fill-in-on-run values are the model fetch revision SHA and SHA256 hashes (Task 12 Step 2 — these genuinely cannot be known until the first fetch) and the empirically-verified `QUERY_PREFIX` (Task 7 / Task 13 — verified against model-card scores). Both are explicitly flagged. No silent placeholders.

**Type consistency:** `QuantVector{q,scale,norm}` used identically in quantise/retrieval/store; `Candidate{id,score,numeric,metadata}` consistent across retrieval and store; `EmbeddingEngine.embed(texts,{kind})` matches worker protocol and store usage; `VECTORS_STORE_SCHEMA` shared by tests, dev page, README guidance.
