# Knowledgebase — Chunk A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create libraries of Markdown documents that embed on-device, managed in a new *My Knowledge* room — the foundation the retrieval (Chunk B) and lorebook (Chunk C) features build on.

**Architecture:** Domain rows (`libraries`, `documents`) live in the existing Dexie `client-data-db` (new v14). Chunk vectors live in the already-built `packages/embeddings` vector store (a dedicated IndexedDB), with the on-device arctic-embed engine. A background ingestion queue chunks + embeds each document, tracking per-document status. The UI mirrors the Treasury's two-level room pattern. Client-only; **not a Larissa change**.

**Tech Stack:** TypeScript (strict), Dexie, `@chatsundere/embeddings` (transformers.js, int4 vector store), React 18 + react-router + TanStack Query, Zustand, Vitest (frontend) + Bun test (embeddings), Biome.

**Spec:** `superpowers/specs/2026-06-07-knowledgebase-chunk-a-foundation-design.md`

---

## File structure

**`packages/embeddings/`**
- Create `src/chunk/chunker.ts` — pure hierarchical Markdown chunker.
- Create `src/chunk/chunker.test.ts` — Bun tests.
- Modify `src/index.ts` — export the chunker.

**`apps/user-client/src/`**
- Modify `boot/client-data-db.ts` — `LibraryRow`, `DocumentRow`, tables, Dexie v14.
- Create `boot/knowledge-vectors-db.ts` — dedicated vectors Dexie + engine singleton + vector-store singleton + model-progress emitter.
- Modify `data/queryKeys.ts` — knowledge query keys.
- Create `data/knowledge.ts` — library + document data layer (hooks + cascade helpers).
- Create `knowledge/ingestion-queue.ts` — background chunk+embed queue (injected deps).
- Create `knowledge/start-ingestion.ts` — boot wiring (real deps, reset interrupted, drain).
- Create `state/model-progress.store.ts` — tiny Zustand store for the download banner.
- Create `components/knowledge/NewLibrarySheet.tsx`, `AddDocumentMenu.tsx`, `DocumentStatusBadge.tsx`, `DocumentEditor.tsx`, `ModelDownloadBanner.tsx`.
- Create `routes/app/knowledge.tsx` — library list.
- Create `routes/app/knowledge-library.tsx` — library detail (documents).
- Modify `App.tsx` — register the two routes + start ingestion at boot.
- Modify `routes/app/entrance-hall.tsx` — enable the *My Knowledge* tile.

**`apps/user-client/tests/`** — mirror under `tests/knowledge/`, `tests/data/`, `tests/routes/app/`, `tests/components/knowledge/`.

---

## Conventions for every task

- British English in all code, comments, commit subjects.
- Commit after each task with an imperative, capitalised subject, **no** Conventional-Commits prefix (repo style). These per-task commits are squashed into one feature unit at the end.
- IDs via `uuidv7()` (as in `data/personas.ts`).
- `KNOWLEDGE_COLLECTION = 'knowledge'` is the single vector-store collection; chunk vector id is `` `${documentId}#${chunkIndex}` ``.

---

### Task 1: Markdown chunker (packages/embeddings)

**Files:**
- Create: `packages/embeddings/src/chunk/chunker.ts`
- Test: `packages/embeddings/src/chunk/chunker.test.ts`
- Modify: `packages/embeddings/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/embeddings/src/chunk/chunker.test.ts
import { describe, expect, it } from 'bun:test';
import { type Chunk, chunkMarkdown } from './chunker.js';

describe('chunkMarkdown', () => {
  it('returns one chunk with an empty heading path for short headingless text', () => {
    const chunks = chunkMarkdown('Just a short paragraph.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ text: 'Just a short paragraph.', headingPath: [], chunkIndex: 0 });
  });

  it('tracks the heading hierarchy as a headingPath', () => {
    const md = '# Title\n\nIntro.\n\n## Section\n\nBody under section.';
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.headingPath)).toEqual([['Title'], ['Title', 'Section']]);
    expect(chunks[0]?.text).toContain('Intro.');
    expect(chunks[1]?.text).toContain('Body under section.');
  });

  it('assigns sequential chunkIndex values', () => {
    const md = '# A\n\nx\n\n# B\n\ny';
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it('splits an oversized section into multiple chunks by paragraph', () => {
    const para = 'word '.repeat(400).trim(); // ~400 tokens by the heuristic
    const md = `# Big\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = chunkMarkdown(md, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.headingPath).toEqual(['Big']);
  });

  it('hard-splits a single paragraph that exceeds the budget on word boundaries', () => {
    const huge = 'token '.repeat(2000).trim();
    const chunks = chunkMarkdown(huge, { maxTokens: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeGreaterThan(0);
  });

  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('exposes a Chunk type with the agreed shape', () => {
    const c: Chunk = { text: 'x', headingPath: [], chunkIndex: 0 };
    expect(c.chunkIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/embeddings && bun test src/chunk/chunker.test.ts`
Expected: FAIL — `Cannot find module './chunker.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/embeddings/src/chunk/chunker.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** A unit of a document ready for embedding. */
export interface Chunk {
  /** The chunk's text content. */
  text: string;
  /** The Markdown heading trail above this chunk, outermost first. */
  headingPath: string[];
  /** Zero-based position of this chunk within its document. */
  chunkIndex: number;
}

export interface ChunkOptions {
  /** Soft upper bound per chunk, in heuristic tokens (~4 chars each). Default 1000. */
  maxTokens?: number;
}

/** Rough token estimate — 4 characters per token. Sufficient for splitting decisions. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

interface Section {
  headingPath: string[];
  body: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Split into heading-bounded sections, tracking the live heading stack. */
function splitIntoSections(md: string): Section[] {
  const lines = md.split('\n');
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (body.length > 0) sections.push({ headingPath: stack.map((s) => s.title), body });
    buffer = [];
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      const level = m[1]?.length ?? 1;
      const title = (m[2] ?? '').trim();
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
      stack.push({ level, title });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Split a body into pieces no larger than maxTokens: paragraphs → sentences → words. */
function splitBody(body: string, maxTokens: number): string[] {
  if (estimateTokens(body) <= maxTokens) return [body];

  const out: string[] = [];
  let current = '';
  const push = (piece: string): void => {
    const candidate = current.length === 0 ? piece : `${current}\n\n${piece}`;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
    } else {
      if (current.length > 0) out.push(current);
      current = piece;
    }
  };

  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  for (const para of paragraphs) {
    if (estimateTokens(para) <= maxTokens) {
      push(para);
      continue;
    }
    // Paragraph too big → sentences.
    const sentences = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      if (estimateTokens(sentence) <= maxTokens) {
        push(sentence);
        continue;
      }
      // Sentence too big → hard word-boundary split.
      const words = sentence.split(/\s+/);
      let acc = '';
      for (const w of words) {
        const cand = acc.length === 0 ? w : `${acc} ${w}`;
        if (estimateTokens(cand) <= maxTokens) {
          acc = cand;
        } else {
          if (acc.length > 0) push(acc);
          acc = w;
        }
      }
      if (acc.length > 0) push(acc);
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Chunk a Markdown document hierarchically: by heading sections, then by
 * paragraph/sentence/word within an oversized section. Each chunk carries the
 * heading trail above it. Empty/whitespace input yields no chunks.
 */
export function chunkMarkdown(md: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 1000;
  const sections = splitIntoSections(md);
  const chunks: Chunk[] = [];
  let index = 0;
  for (const section of sections) {
    for (const piece of splitBody(section.body, maxTokens)) {
      chunks.push({ text: piece, headingPath: section.headingPath, chunkIndex: index++ });
    }
  }
  return chunks;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/embeddings/src/index.ts`, after the codec exports block (around line 45), add:

```ts
// Chunking — document text → embeddable chunks
export { type Chunk, type ChunkOptions, chunkMarkdown, estimateTokens } from './chunk/chunker.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/embeddings && bun test src/chunk/chunker.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Build the package so consumers see the new export**

Run: `cd packages/embeddings && pnpm run build`
Expected: tsc emits `dist/` with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/embeddings/src/chunk packages/embeddings/src/index.ts
git commit -m "Add Markdown chunker to embeddings package"
```

---

### Task 2: Dexie v14 — libraries + documents tables

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Test: `apps/user-client/tests/boot/knowledge-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/boot/knowledge-schema.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('knowledge schema (v14)', () => {
  it('opens at version 14', () => {
    expect(getClientDataDb().verno).toBe(14);
  });

  it('round-trips a library and a document', async () => {
    const db = getClientDataDb();
    await db.libraries.add({
      id: 'lib1',
      name: 'Lore',
      description: '',
      nsfw: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.documents.add({
      id: 'doc1',
      libraryId: 'lib1',
      title: 'Intro',
      content: 'Hello',
      embeddingStatus: 'pending',
      embeddingError: null,
      chunkCount: 0,
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const docs = await db.documents.where('libraryId').equals('lib1').toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe('Intro');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/boot/knowledge-schema.test.ts`
Expected: FAIL — `verno` is 13, and `db.libraries` is undefined.

- [ ] **Step 3: Add the row interfaces**

In `apps/user-client/src/boot/client-data-db.ts`, before the `// ===== Dexie subclass =====` marker (around line 207), add:

```ts
// ===== Knowledgebase (v14) =====

/** A library is a named container of documents. */
export interface LibraryRow {
  id: string;
  name: string;
  description: string;
  nsfw: boolean;
  createdAt: number;
  updatedAt: number;
}

export type EmbeddingStatus = 'pending' | 'embedding' | 'ready' | 'failed';

/** A document belongs to exactly one library; `content` is the source of truth. */
export interface DocumentRow {
  id: string;
  libraryId: string;
  title: string;
  content: string;
  embeddingStatus: EmbeddingStatus;
  embeddingError: string | null;
  chunkCount: number;
  /** Reserved for Chunk C (phrase-triggered injection). No UI in Chunk A. */
  triggerPhrases: string[];
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Declare the tables on the subclass**

In the `ClientDataDb` class, after `artefacts!: Table<ArtefactRow, string>;` (around line 220), add:

```ts
  libraries!: Table<LibraryRow, string>;
  documents!: Table<DocumentRow, string>;
```

- [ ] **Step 5: Add the v14 migration**

After the `this.version(13)...` block (around line 470, before the closing `}` of the constructor), add:

```ts
    // Version 14 — knowledgebase foundation. Two new tables: `libraries`
    // (named document containers) and `documents` (Markdown content + embedding
    // status). Chunk vectors live in the separate embeddings vector store, not
    // here. Fresh tables → no upgrade callback.
    this.version(14).stores({
      libraries: 'id, name, nsfw',
      documents: 'id, libraryId, embeddingStatus, [libraryId+createdAt]',
    });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/boot/knowledge-schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/boot/knowledge-schema.test.ts
git commit -m "Add libraries and documents tables (Dexie v14)"
```

---

### Task 3: Knowledge vectors DB + engine singletons

**Files:**
- Create: `apps/user-client/src/boot/knowledge-vectors-db.ts`
- Create: `apps/user-client/src/state/model-progress.store.ts`
- Test: `apps/user-client/tests/boot/knowledge-vectors-db.test.ts`

- [ ] **Step 1: Write the model-progress store**

```ts
// apps/user-client/src/state/model-progress.store.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

interface ModelProgressStore {
  /** True from the first embed request until the engine reports ready. */
  loading: boolean;
  /** 0..1 download/compile progress, or null when indeterminate. */
  progress: number | null;
  /** Set once the engine has loaded successfully (banner never shows again). */
  ready: boolean;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: number | null) => void;
  setReady: () => void;
}

export const useModelProgressStore = create<ModelProgressStore>((set) => ({
  loading: false,
  progress: null,
  ready: false,
  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setReady: () => set({ ready: true, loading: false, progress: 1 }),
}));
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/user-client/tests/boot/knowledge-vectors-db.test.ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_COLLECTION,
  _resetKnowledgeVectorsForTests,
  getKnowledgeVectorStore,
} from '../../src/boot/knowledge-vectors-db.js';

afterEach(async () => {
  await _resetKnowledgeVectorsForTests();
});

describe('knowledge vector store', () => {
  it('upserts and scans chunk vectors by document tag', async () => {
    const store = getKnowledgeVectorStore();
    await store.upsert([
      {
        id: 'doc1#0',
        collection: KNOWLEDGE_COLLECTION,
        vector: new Float32Array(768).fill(0.1),
        tags: { libraryId: 'lib1', documentId: 'doc1' },
        numeric: { chunkIndex: 0 },
        metadata: { text: 'hello', headingPath: [] },
        updatedAt: 1,
      },
    ]);
    const rows = await store.scan({
      collection: KNOWLEDGE_COLLECTION,
      filter: { tags: { documentId: 'doc1' } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ text: 'hello', headingPath: [] });
  });

  it('deleteWhere removes a document\'s vectors', async () => {
    const store = getKnowledgeVectorStore();
    await store.upsert([
      {
        id: 'doc2#0',
        collection: KNOWLEDGE_COLLECTION,
        vector: new Float32Array(768).fill(0.2),
        tags: { libraryId: 'lib1', documentId: 'doc2' },
        numeric: { chunkIndex: 0 },
        updatedAt: 1,
      },
    ]);
    const removed = await store.deleteWhere({
      collection: KNOWLEDGE_COLLECTION,
      filter: { tags: { documentId: 'doc2' } },
    });
    expect(removed).toBe(1);
    const rows = await store.scan({ collection: KNOWLEDGE_COLLECTION });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/boot/knowledge-vectors-db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// apps/user-client/src/boot/knowledge-vectors-db.ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type EmbeddingEngine,
  type VectorRow,
  type VectorStore,
  VECTORS_STORE_SCHEMA,
  createEmbeddingEngine,
  createVectorStore,
} from '@chatsundere/embeddings';
import Dexie, { type Table } from 'dexie';
import { useModelProgressStore } from '../state/model-progress.store.js';

/** The single vector-store collection for all knowledgebase chunks. */
export const KNOWLEDGE_COLLECTION = 'knowledge';

const VECTORS_DB_NAME = 'chatsundere-knowledge-vectors';

class KnowledgeVectorsDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor() {
    super(VECTORS_DB_NAME);
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

let dbHandle: KnowledgeVectorsDb | null = null;
let storeHandle: VectorStore | null = null;
let enginePromise: Promise<EmbeddingEngine> | null = null;

function db(): KnowledgeVectorsDb {
  if (!dbHandle) dbHandle = new KnowledgeVectorsDb();
  return dbHandle;
}

/**
 * The shared knowledge vector store. Engine-less: Chunk A only upserts/deletes/
 * scans (we embed manually during ingestion); text queries (Chunk B) pass a
 * pre-embedded vector, so the store never needs the engine itself.
 */
export function getKnowledgeVectorStore(): VectorStore {
  if (!storeHandle) storeHandle = createVectorStore({ db: db(), table: db().vectors });
  return storeHandle;
}

/**
 * The shared on-device embedding engine, created once. Surfaces load progress
 * to the model-progress store so the UI can show a one-time download banner.
 */
export function getEmbeddingEngine(): Promise<EmbeddingEngine> {
  if (!enginePromise) {
    const progress = useModelProgressStore.getState();
    progress.setLoading(true);
    enginePromise = createEmbeddingEngine({
      onProgress: (data: unknown) => {
        const d = data as { progress?: number };
        if (typeof d.progress === 'number') progress.setProgress(d.progress / 100);
      },
    }).then((engine) => {
      useModelProgressStore.getState().setReady();
      return engine;
    });
  }
  return enginePromise;
}

/** Test-only: drop the in-memory singletons and delete the IndexedDB database. */
export async function _resetKnowledgeVectorsForTests(): Promise<void> {
  if (dbHandle) {
    dbHandle.close();
    await dbHandle.delete();
  }
  dbHandle = null;
  storeHandle = null;
  enginePromise = null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/boot/knowledge-vectors-db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/boot/knowledge-vectors-db.ts apps/user-client/src/state/model-progress.store.ts apps/user-client/tests/boot/knowledge-vectors-db.test.ts
git commit -m "Add knowledge vector store and engine singletons"
```

---

### Task 4: Query keys

**Files:**
- Modify: `apps/user-client/src/data/queryKeys.ts`

- [ ] **Step 1: Add the keys**

In `apps/user-client/src/data/queryKeys.ts`, inside the `QK` object (before the closing `};`), add:

```ts
  libraries: ['libraries'] as const,
  library: (id: string) => ['libraries', id] as const,
  documents: (libraryId: string) => ['documents', 'library', libraryId] as const,
  document: (id: string) => ['documents', 'item', id] as const,
  documentCounts: ['documents', 'counts'] as const,
```

- [ ] **Step 2: Type-check**

Run: `cd apps/user-client && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/data/queryKeys.ts
git commit -m "Add knowledgebase query keys"
```

---

### Task 5: Data layer — libraries

**Files:**
- Create: `apps/user-client/src/data/knowledge.ts`
- Test: `apps/user-client/tests/data/knowledge-libraries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/data/knowledge-libraries.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { createLibrary, deleteLibraryCascade, listLibraries } from '../../src/data/knowledge.js';
import {
  KNOWLEDGE_COLLECTION,
  _resetKnowledgeVectorsForTests,
  getKnowledgeVectorStore,
} from '../../src/boot/knowledge-vectors-db.js';

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await _resetKnowledgeVectorsForTests();
});

describe('library data layer', () => {
  it('creates and lists libraries oldest-first', async () => {
    await createLibrary({ name: 'B', description: '', nsfw: false });
    await createLibrary({ name: 'A', description: 'desc', nsfw: true });
    const libs = await listLibraries();
    expect(libs.map((l) => l.name)).toEqual(['B', 'A']);
  });

  it('deleteLibraryCascade removes its documents and their vectors', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const db = getClientDataDb();
    await db.documents.add({
      id: 'd1',
      libraryId: lib.id,
      title: 't',
      content: 'c',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 1,
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await getKnowledgeVectorStore().upsert([
      {
        id: 'd1#0',
        collection: KNOWLEDGE_COLLECTION,
        vector: new Float32Array(768).fill(0.1),
        tags: { libraryId: lib.id, documentId: 'd1' },
        numeric: { chunkIndex: 0 },
        updatedAt: 1,
      },
    ]);

    await deleteLibraryCascade(lib.id);

    expect(await db.libraries.get(lib.id)).toBeUndefined();
    expect(await db.documents.where('libraryId').equals(lib.id).count()).toBe(0);
    expect(await getKnowledgeVectorStore().scan({ collection: KNOWLEDGE_COLLECTION })).toHaveLength(
      0,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/data/knowledge-libraries.test.ts`
Expected: FAIL — module `../../src/data/knowledge.js` not found.

- [ ] **Step 3: Write the libraries portion of the data layer**

```ts
// apps/user-client/src/data/knowledge.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import {
  type DocumentRow,
  type LibraryRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import {
  KNOWLEDGE_COLLECTION,
  type VectorStoreLike,
  getKnowledgeVectorStore,
} from '../boot/knowledge-vectors-db.js';
import { QK } from './queryKeys.js';
import { useAdultMode } from './settings.js';

// ---- Libraries: plain async helpers (used by hooks + tests) ----

export async function listLibraries(): Promise<LibraryRow[]> {
  const rows = await getClientDataDb().libraries.toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createLibrary(
  input: Omit<LibraryRow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<LibraryRow> {
  const now = Date.now();
  const row: LibraryRow = { id: uuidv7(), createdAt: now, updatedAt: now, ...input };
  await getClientDataDb().libraries.add(row);
  return row;
}

export async function updateLibrary(
  id: string,
  patch: Partial<Omit<LibraryRow, 'id' | 'createdAt'>>,
): Promise<void> {
  await getClientDataDb().libraries.update(id, { ...patch, updatedAt: Date.now() });
}

/** Delete every vector belonging to a document. */
export async function deleteDocumentVectors(
  documentId: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  await store.deleteWhere({
    collection: KNOWLEDGE_COLLECTION,
    filter: { tags: { documentId } },
  });
}

/** Delete a document row and its vectors. */
export async function deleteDocumentCascade(
  id: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  await deleteDocumentVectors(id, store);
  await getClientDataDb().documents.delete(id);
}

/** Delete a library, all its documents, and all their vectors. */
export async function deleteLibraryCascade(
  id: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  const db = getClientDataDb();
  const docs = await db.documents.where('libraryId').equals(id).toArray();
  for (const doc of docs) await deleteDocumentVectors(doc.id, store);
  await db.documents.where('libraryId').equals(id).delete();
  await db.libraries.delete(id);
}

// ---- Libraries: React-Query hooks ----

export function useLibraries() {
  return useQuery({ queryKey: QK.libraries, queryFn: listLibraries });
}

/**
 * Libraries filtered by the current adult-mode setting — the hook every list/
 * count surface must use (mirrors `useFilteredPersonas`). The empty state for an
 * all-NSFW list in SFW mode must render identically to "no libraries exist".
 */
export function useFilteredLibraries() {
  const libraries = useLibraries();
  const { mode } = useAdultMode();
  const data = libraries.data?.filter((l) => mode === 'nsfw' || !l.nsfw);
  return { ...libraries, data } as typeof libraries;
}

export function useCreateLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<LibraryRow, 'id' | 'createdAt' | 'updatedAt'>) => createLibrary(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.libraries }),
  });
}

export function useUpdateLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: Partial<Omit<LibraryRow, 'id' | 'createdAt'>> }) =>
      updateLibrary(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.libraries }),
  });
}

export function useDeleteLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLibraryCascade(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraries });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
```

- [ ] **Step 4: Add the `VectorStoreLike` alias to the vectors-db module**

In `apps/user-client/src/boot/knowledge-vectors-db.ts`, add an exported alias so the data layer can accept test doubles without importing the whole package type:

```ts
import type { VectorStore } from '@chatsundere/embeddings';
// ...
/** The subset of VectorStore the knowledge data layer + queue depend on. */
export type VectorStoreLike = Pick<VectorStore, 'upsert' | 'deleteWhere' | 'scan'>;
```

(Place the `export type` near `KNOWLEDGE_COLLECTION`. `VectorStore` is already imported in Task 3.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/data/knowledge-libraries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/data/knowledge.ts apps/user-client/src/boot/knowledge-vectors-db.ts apps/user-client/tests/data/knowledge-libraries.test.ts
git commit -m "Add library data layer with cascade deletion"
```

---

### Task 6: Data layer — documents

**Files:**
- Modify: `apps/user-client/src/data/knowledge.ts`
- Test: `apps/user-client/tests/data/knowledge-documents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/data/knowledge-documents.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addDocuments,
  createLibrary,
  documentCounts,
  listDocuments,
  updateDocument,
} from '../../src/data/knowledge.js';

const enqueue = vi.fn();
vi.mock('../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueue(id),
}));

beforeEach(async () => {
  await openClientDataDb();
  enqueue.mockClear();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('document data layer', () => {
  it('adds documents as pending and enqueues each', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const ids = await addDocuments(lib.id, [
      { title: 'A', content: 'alpha' },
      { title: 'B', content: 'beta' },
    ]);
    expect(ids).toHaveLength(2);
    const docs = await listDocuments(lib.id);
    expect(docs.every((d) => d.embeddingStatus === 'pending')).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('rejects empty/whitespace documents', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const ids = await addDocuments(lib.id, [{ title: 'Empty', content: '   ' }]);
    expect(ids).toHaveLength(0);
    expect(await listDocuments(lib.id)).toHaveLength(0);
  });

  it('content edit re-queues embedding; title-only edit does not', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [id] = await addDocuments(lib.id, [{ title: 'A', content: 'alpha' }]);
    await getClientDataDb().documents.update(id as string, { embeddingStatus: 'ready' });
    enqueue.mockClear();

    await updateDocument(id as string, { title: 'A2' });
    expect(enqueue).not.toHaveBeenCalled();
    expect((await getClientDataDb().documents.get(id as string))?.embeddingStatus).toBe('ready');

    await updateDocument(id as string, { content: 'changed' });
    expect(enqueue).toHaveBeenCalledWith(id);
    expect((await getClientDataDb().documents.get(id as string))?.embeddingStatus).toBe('pending');
  });

  it('documentCounts groups by libraryId', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    await addDocuments(lib.id, [{ title: 'A', content: 'a' }, { title: 'B', content: 'b' }]);
    const counts = await documentCounts();
    expect(counts[lib.id]).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/data/knowledge-documents.test.ts`
Expected: FAIL — `addDocuments` etc. not exported.

- [ ] **Step 3: Append the documents portion to `data/knowledge.ts`**

Add at the end of `apps/user-client/src/data/knowledge.ts`:

```ts
// ---- Documents ----

import { enqueueDocument } from '../knowledge/start-ingestion.js';

export async function listDocuments(libraryId: string): Promise<DocumentRow[]> {
  return getClientDataDb()
    .documents.where('[libraryId+createdAt]')
    .between([libraryId, Dexie.minKey], [libraryId, Dexie.maxKey])
    .toArray();
}

export async function getDocument(id: string): Promise<DocumentRow | undefined> {
  return getClientDataDb().documents.get(id);
}

/** Count documents per library, in one pass. */
export async function documentCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await getClientDataDb().documents.each((d) => {
    counts[d.libraryId] = (counts[d.libraryId] ?? 0) + 1;
  });
  return counts;
}

export interface NewDocumentInput {
  title: string;
  content: string;
}

/** Insert non-empty documents as `pending` and enqueue each for embedding. */
export async function addDocuments(
  libraryId: string,
  inputs: NewDocumentInput[],
): Promise<string[]> {
  const now = Date.now();
  const rows: DocumentRow[] = [];
  for (const input of inputs) {
    if (input.content.trim().length === 0) continue;
    rows.push({
      id: uuidv7(),
      libraryId,
      title: input.title.trim() || 'Untitled',
      content: input.content,
      embeddingStatus: 'pending',
      embeddingError: null,
      chunkCount: 0,
      triggerPhrases: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  if (rows.length === 0) return [];
  await getClientDataDb().documents.bulkAdd(rows);
  for (const row of rows) enqueueDocument(row.id);
  return rows.map((r) => r.id);
}

/** Update a document. A `content` change re-queues embedding; title-only does not. */
export async function updateDocument(
  id: string,
  patch: { title?: string; content?: string },
): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  if (patch.content !== undefined) {
    await db.documents.update(id, {
      ...patch,
      embeddingStatus: 'pending',
      embeddingError: null,
      updatedAt: now,
    });
    enqueueDocument(id);
  } else {
    await db.documents.update(id, { ...patch, updatedAt: now });
  }
}

// ---- Documents: React-Query hooks ----

function hasInFlight(docs: DocumentRow[] | undefined): boolean {
  return !!docs?.some((d) => d.embeddingStatus === 'pending' || d.embeddingStatus === 'embedding');
}

export function useDocuments(libraryId: string) {
  return useQuery({
    queryKey: QK.documents(libraryId),
    queryFn: () => listDocuments(libraryId),
    // Poll while anything is embedding so status badges update live.
    refetchInterval: (query) => (hasInFlight(query.state.data as DocumentRow[]) ? 800 : false),
  });
}

export function useDocumentCounts() {
  return useQuery({ queryKey: QK.documentCounts, queryFn: documentCounts });
}

export function useAddDocuments(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inputs: NewDocumentInput[]) => addDocuments(libraryId, inputs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.documents(libraryId) });
      qc.invalidateQueries({ queryKey: QK.documentCounts });
    },
  });
}

export function useUpdateDocument(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { title?: string; content?: string } }) =>
      updateDocument(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.documents(libraryId) }),
  });
}

export function useDeleteDocument(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocumentCascade(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.documents(libraryId) });
      qc.invalidateQueries({ queryKey: QK.documentCounts });
    },
  });
}

/** Manual retry for a failed document — reset to pending and re-enqueue. */
export function useRetryDocument(libraryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await getClientDataDb().documents.update(id, {
        embeddingStatus: 'pending',
        embeddingError: null,
        updatedAt: Date.now(),
      });
      enqueueDocument(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.documents(libraryId) }),
  });
}
```

Also add the Dexie import at the top of the file (needed for `Dexie.minKey`/`maxKey`):

```ts
import Dexie from 'dexie';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/data/knowledge-documents.test.ts`
Expected: PASS (4 tests). (The mock of `start-ingestion.js` stands in for the queue.)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/knowledge.ts apps/user-client/tests/data/knowledge-documents.test.ts
git commit -m "Add document data layer with re-embed on content edit"
```

---

### Task 7: Ingestion queue (state machine)

**Files:**
- Create: `apps/user-client/src/knowledge/ingestion-queue.ts`
- Test: `apps/user-client/tests/knowledge/ingestion-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/knowledge/ingestion-queue.test.ts
import { describe, expect, it, vi } from 'vitest';
import { type IngestionDeps, createIngestionQueue } from '../../src/knowledge/ingestion-queue.js';

function makeDoc(id: string, content = 'hello world') {
  return {
    id,
    libraryId: 'lib1',
    title: 't',
    content,
    embeddingStatus: 'pending' as const,
    embeddingError: null,
    chunkCount: 0,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeDeps(overrides: Partial<IngestionDeps> = {}): IngestionDeps {
  return {
    getDocument: vi.fn(async (id: string) => makeDoc(id)),
    setStatus: vi.fn(async () => {}),
    setReady: vi.fn(async () => {}),
    embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(768).fill(0.1))),
    writeChunks: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ingestion queue', () => {
  it('drives a document pending → embedding → ready', async () => {
    const deps = makeDeps();
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.setStatus).toHaveBeenCalledWith('d1', 'embedding');
    expect(deps.writeChunks).toHaveBeenCalledTimes(1);
    expect(deps.setReady).toHaveBeenCalledWith('d1', expect.any(Number));
  });

  it('marks a document failed when embedding throws', async () => {
    const deps = makeDeps({
      embed: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.setStatus).toHaveBeenCalledWith('d1', 'failed', 'boom');
    expect(deps.writeChunks).not.toHaveBeenCalled();
  });

  it('discards results when the document was deleted mid-flight', async () => {
    const getDocument = vi
      .fn()
      .mockResolvedValueOnce(makeDoc('d1')) // initial pick
      .mockResolvedValueOnce(undefined); // re-check after embed → gone
    const deps = makeDeps({ getDocument });
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.writeChunks).not.toHaveBeenCalled();
    expect(deps.setReady).not.toHaveBeenCalled();
  });

  it('serialises concurrent enqueues (one in flight at a time)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = makeDeps({
      embed: vi.fn(async (texts: string[]) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return texts.map(() => new Float32Array(768).fill(0.1));
      }),
    });
    const q = createIngestionQueue(deps);
    q.enqueue('d1');
    q.enqueue('d2');
    await q.idle();
    expect(maxInFlight).toBe(1);
  });

  it('skips embedding for a document with no chunkable content', async () => {
    const deps = makeDeps({ getDocument: vi.fn(async (id: string) => makeDoc(id, '   ')) });
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.embed).not.toHaveBeenCalled();
    expect(deps.setReady).toHaveBeenCalledWith('d1', 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/knowledge/ingestion-queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/knowledge/ingestion-queue.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type Chunk, chunkMarkdown } from '@chatsundere/embeddings';
import type { DocumentRow, EmbeddingStatus } from '../boot/client-data-db.js';

/** Side-effects the queue depends on. Injected so the state machine is testable. */
export interface IngestionDeps {
  getDocument(id: string): Promise<DocumentRow | undefined>;
  setStatus(id: string, status: EmbeddingStatus, error?: string): Promise<void>;
  setReady(id: string, chunkCount: number): Promise<void>;
  embed(texts: string[]): Promise<Float32Array[]>;
  writeChunks(doc: DocumentRow, chunks: Chunk[], vectors: Float32Array[]): Promise<void>;
}

export interface IngestionQueue {
  /** Add a document id to the queue and start draining if idle. */
  enqueue(id: string): void;
  /** Process exactly one document to completion (used in tests + the drain loop). */
  process(id: string): Promise<void>;
  /** Resolves when the queue has drained. */
  idle(): Promise<void>;
}

export function createIngestionQueue(deps: IngestionDeps): IngestionQueue {
  const queue: string[] = [];
  const seen = new Set<string>();
  let draining: Promise<void> | null = null;

  async function process(id: string): Promise<void> {
    const doc = await deps.getDocument(id);
    if (!doc) return; // already deleted
    await deps.setStatus(id, 'embedding');
    try {
      const chunks = chunkMarkdown(doc.content);
      if (chunks.length === 0) {
        // Re-check existence before any write-equivalent state change.
        if (await deps.getDocument(id)) await deps.setReady(id, 0);
        return;
      }
      const vectors = await deps.embed(chunks.map((c) => c.text));
      const still = await deps.getDocument(id);
      if (!still) return; // deleted mid-flight → discard
      await deps.writeChunks(still, chunks, vectors);
      await deps.setReady(id, chunks.length);
    } catch (err) {
      // Only record failure if the document still exists.
      if (await deps.getDocument(id)) {
        await deps.setStatus(id, 'failed', err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      seen.delete(id);
      await process(id);
    }
    draining = null;
  }

  return {
    enqueue(id) {
      if (seen.has(id)) return;
      seen.add(id);
      queue.push(id);
      if (!draining) draining = drain();
    },
    process,
    idle() {
      return draining ?? Promise.resolve();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/knowledge/ingestion-queue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/ingestion-queue.ts apps/user-client/tests/knowledge/ingestion-queue.test.ts
git commit -m "Add knowledge ingestion queue state machine"
```

---

### Task 8: Ingestion boot wiring

**Files:**
- Create: `apps/user-client/src/knowledge/start-ingestion.ts`
- Test: `apps/user-client/tests/knowledge/start-ingestion.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/knowledge/start-ingestion.test.ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { resetInterruptedDocuments } from '../../src/knowledge/start-ingestion.js';

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('resetInterruptedDocuments', () => {
  it('resets interrupted "embedding" rows back to "pending"', async () => {
    const db = getClientDataDb();
    await db.documents.bulkAdd([
      mkDoc('a', 'embedding'),
      mkDoc('b', 'ready'),
      mkDoc('c', 'pending'),
    ]);
    const requeued = await resetInterruptedDocuments();
    expect(requeued.sort()).toEqual(['a', 'c']); // embedding→pending plus the already-pending
    expect((await db.documents.get('a'))?.embeddingStatus).toBe('pending');
    expect((await db.documents.get('b'))?.embeddingStatus).toBe('ready');
  });
});

function mkDoc(id: string, status: 'pending' | 'embedding' | 'ready') {
  return {
    id,
    libraryId: 'l',
    title: 't',
    content: 'c',
    embeddingStatus: status,
    embeddingError: null,
    chunkCount: 0,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/knowledge/start-ingestion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/knowledge/start-ingestion.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type Chunk } from '@chatsundere/embeddings';
import {
  type DocumentRow,
  type EmbeddingStatus,
  getClientDataDb,
} from '../boot/client-data-db.js';
import {
  KNOWLEDGE_COLLECTION,
  getEmbeddingEngine,
  getKnowledgeVectorStore,
} from '../boot/knowledge-vectors-db.js';
import { type IngestionQueue, createIngestionQueue } from './ingestion-queue.js';

let queue: IngestionQueue | null = null;

function realQueue(): IngestionQueue {
  if (queue) return queue;
  const db = getClientDataDb();
  const store = getKnowledgeVectorStore();
  queue = createIngestionQueue({
    getDocument: (id) => db.documents.get(id),
    setStatus: async (id, status: EmbeddingStatus, error?: string) => {
      await db.documents.update(id, {
        embeddingStatus: status,
        embeddingError: error ?? null,
        updatedAt: Date.now(),
      });
    },
    setReady: async (id, chunkCount) => {
      await db.documents.update(id, {
        embeddingStatus: 'ready',
        embeddingError: null,
        chunkCount,
        updatedAt: Date.now(),
      });
    },
    embed: async (texts) => {
      const engine = await getEmbeddingEngine();
      return engine.embed(texts, { kind: 'document' });
    },
    writeChunks: async (doc: DocumentRow, chunks: Chunk[], vectors: Float32Array[]) => {
      await store.deleteWhere({
        collection: KNOWLEDGE_COLLECTION,
        filter: { tags: { documentId: doc.id } },
      });
      const now = Date.now();
      await store.upsert(
        chunks.map((c, i) => ({
          id: `${doc.id}#${c.chunkIndex}`,
          collection: KNOWLEDGE_COLLECTION,
          // biome-ignore lint/style/noNonNullAssertion: vectors and chunks are 1:1 by construction
          vector: vectors[i]!,
          tags: { libraryId: doc.libraryId, documentId: doc.id },
          numeric: { chunkIndex: c.chunkIndex },
          metadata: { text: c.text, headingPath: c.headingPath },
          updatedAt: now,
        })),
      );
    },
  });
  return queue;
}

/** Enqueue a document for embedding. Safe to call before the app has started. */
export function enqueueDocument(id: string): void {
  realQueue().enqueue(id);
}

/**
 * Reset any document left mid-embed (process interrupted by reload/crash) back
 * to `pending`. Returns the ids of all documents now needing embedding
 * (interrupted + already-pending).
 */
export async function resetInterruptedDocuments(): Promise<string[]> {
  const db = getClientDataDb();
  const interrupted = await db.documents.where('embeddingStatus').equals('embedding').toArray();
  for (const doc of interrupted) {
    await db.documents.update(doc.id, { embeddingStatus: 'pending', updatedAt: Date.now() });
  }
  const pending = await db.documents.where('embeddingStatus').equals('pending').toArray();
  return pending.map((d) => d.id);
}

/** Boot entry point: reset interrupted documents and enqueue all pending ones. */
export async function startKnowledgeIngestion(): Promise<void> {
  const ids = await resetInterruptedDocuments();
  for (const id of ids) enqueueDocument(id);
}

/** Test-only: drop the singleton queue. */
export function _resetIngestionQueueForTests(): void {
  queue = null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/knowledge/start-ingestion.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/start-ingestion.ts apps/user-client/tests/knowledge/start-ingestion.test.ts
git commit -m "Wire knowledge ingestion queue to real stores and boot"
```

---

### Task 9: Document status badge + model-download banner

**Files:**
- Create: `apps/user-client/src/components/knowledge/DocumentStatusBadge.tsx`
- Create: `apps/user-client/src/components/knowledge/ModelDownloadBanner.tsx`
- Test: `apps/user-client/tests/components/knowledge/DocumentStatusBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/components/knowledge/DocumentStatusBadge.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentStatusBadge } from '../../../src/components/knowledge/DocumentStatusBadge.js';

describe('DocumentStatusBadge', () => {
  it('renders a label per status', () => {
    const { rerender } = render(<DocumentStatusBadge status="pending" onRetry={() => {}} />);
    expect(screen.getByText(/pending/i)).toBeTruthy();
    rerender(<DocumentStatusBadge status="embedding" onRetry={() => {}} />);
    expect(screen.getByText(/embedding/i)).toBeTruthy();
    rerender(<DocumentStatusBadge status="ready" onRetry={() => {}} />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });

  it('offers retry only when failed', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<DocumentStatusBadge status="ready" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    rerender(<DocumentStatusBadge status="failed" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/knowledge/DocumentStatusBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the badge**

```tsx
// apps/user-client/src/components/knowledge/DocumentStatusBadge.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { EmbeddingStatus } from '../../boot/client-data-db.js';

const LABEL: Record<EmbeddingStatus, string> = {
  pending: 'Pending',
  embedding: 'Embedding…',
  ready: 'Ready',
  failed: 'Failed',
};

/** Inline status pill for a document; failed documents expose a Retry. */
export function DocumentStatusBadge(props: {
  status: EmbeddingStatus;
  onRetry: () => void;
}): JSX.Element {
  return (
    <span className="doc-status" data-status={props.status}>
      {LABEL[props.status]}
      {props.status === 'failed' ? (
        <button
          type="button"
          className="doc-status-retry"
          onClick={(e) => {
            e.stopPropagation();
            props.onRetry();
          }}
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 4: Write the model-download banner**

```tsx
// apps/user-client/src/components/knowledge/ModelDownloadBanner.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useModelProgressStore } from '../../state/model-progress.store.js';

/**
 * One-time notice while the on-device embedding model downloads/compiles. Hidden
 * once the engine is ready (it stays cached for future sessions).
 */
export function ModelDownloadBanner(): JSX.Element | null {
  const loading = useModelProgressStore((s) => s.loading);
  const ready = useModelProgressStore((s) => s.ready);
  const progress = useModelProgressStore((s) => s.progress);
  if (ready || !loading) return null;
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <div className="model-download-banner" role="status">
      Preparing the on-device knowledge engine{pct === null ? '' : ` … ${pct}%`} (downloads once,
      then cached).
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/knowledge/DocumentStatusBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/knowledge/DocumentStatusBadge.tsx apps/user-client/src/components/knowledge/ModelDownloadBanner.tsx apps/user-client/tests/components/knowledge/DocumentStatusBadge.test.tsx
git commit -m "Add document status badge and model-download banner"
```

---

### Task 10: New-library sheet + library list page + routes

**Files:**
- Create: `apps/user-client/src/components/knowledge/NewLibrarySheet.tsx`
- Create: `apps/user-client/src/routes/app/knowledge.tsx`
- Modify: `apps/user-client/src/App.tsx`
- Test: `apps/user-client/tests/routes/app/knowledge-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/routes/app/knowledge-list.test.tsx
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { KnowledgeList } from '../../../src/routes/app/knowledge.js';

beforeEach(async () => {
  await openClientDataDb();
  // Default settings seed leaves adultMode 'nsfw'; force SFW for the gating test.
  await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/knowledge']}>
        <Routes>
          <Route path="/app/knowledge" element={<KnowledgeList />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KnowledgeList', () => {
  it('shows an empty state when there are no libraries', async () => {
    wrap();
    expect(await screen.findByText(/no libraries yet/i)).toBeTruthy();
  });

  it('creates a library through the new-library sheet', async () => {
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /new library/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'World Lore' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText('World Lore')).toBeTruthy();
  });

  it('hides NSFW libraries in SFW mode', async () => {
    await getClientDataDb().libraries.add({
      id: 'n1',
      name: 'Adult Lore',
      description: '',
      nsfw: true,
      createdAt: 1,
      updatedAt: 1,
    });
    wrap();
    await waitFor(() => expect(screen.queryByText('Adult Lore')).toBeNull());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/app/knowledge-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the new-library sheet**

```tsx
// apps/user-client/src/components/knowledge/NewLibrarySheet.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

export interface NewLibraryValue {
  name: string;
  description: string;
  nsfw: boolean;
}

/** Bottom-sheet form to create a library: name (required) + description + NSFW. */
export function NewLibrarySheet(props: {
  onCreate: (value: NewLibraryValue) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nsfw, setNsfw] = useState(false);
  const canCreate = name.trim().length > 0;
  return (
    <div className="sheet-root knowledge-sheet-root">
      <div className="sheet-backdrop" onClick={props.onClose} />
      <div className="sheet-panel" role="dialog" aria-label="New library">
        <label className="sheet-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="sheet-field">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="sheet-toggle">
          <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
          <span>Adult (NSFW)</span>
        </label>
        <div className="sheet-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => props.onCreate({ name: name.trim(), description: description.trim(), nsfw })}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the library list page**

```tsx
// apps/user-client/src/routes/app/knowledge.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NewLibrarySheet } from '../../components/knowledge/NewLibrarySheet.js';
import { useCreateLibrary, useDocumentCounts, useFilteredLibraries } from '../../data/knowledge.js';

/** Library list — level 1 of the My Knowledge room. */
export function KnowledgeList(): JSX.Element {
  const navigate = useNavigate();
  const libraries = useFilteredLibraries();
  const counts = useDocumentCounts();
  const createLibrary = useCreateLibrary();
  const [sheetOpen, setSheetOpen] = useState(false);
  const rows = libraries.data ?? [];

  return (
    <section className="flex min-h-[80dvh] flex-col gap-4 px-4 pb-12 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl">My Knowledge</h1>
        <button type="button" className="knowledge-new-btn" onClick={() => setSheetOpen(true)}>
          New library
        </button>
      </header>

      {rows.length === 0 ? (
        <p className="text-paper-soft">No libraries yet — create one to add documents.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((lib) => (
            <li key={lib.id}>
              <button
                type="button"
                className="knowledge-library-row"
                onClick={() => navigate(`/app/knowledge/${lib.id}`)}
              >
                <span className="font-display">{lib.name}</span>
                {lib.description ? (
                  <span className="text-paper-soft text-sm">{lib.description}</span>
                ) : null}
                <span className="text-[11px] uppercase tracking-widest text-paper-soft">
                  {(counts.data?.[lib.id] ?? 0)} documents
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {sheetOpen ? (
        <NewLibrarySheet
          onClose={() => setSheetOpen(false)}
          onCreate={(value) => {
            createLibrary.mutate(value);
            setSheetOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Register the route**

In `apps/user-client/src/App.tsx`, add the import (near the other route imports, ~line 11):

```ts
import { KnowledgeList } from './routes/app/knowledge.js';
```

And add the route inside the `ProtectedRoute` block (after the treasury route, ~line 98):

```tsx
                  <Route path="/app/knowledge" element={<KnowledgeList />} />
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/app/knowledge-list.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/knowledge/NewLibrarySheet.tsx apps/user-client/src/routes/app/knowledge.tsx apps/user-client/src/App.tsx apps/user-client/tests/routes/app/knowledge-list.test.tsx
git commit -m "Add library list page and new-library sheet"
```

---

### Task 11: Library detail page + add-document menu + route

**Files:**
- Create: `apps/user-client/src/components/knowledge/AddDocumentMenu.tsx`
- Create: `apps/user-client/src/routes/app/knowledge-library.tsx`
- Modify: `apps/user-client/src/App.tsx`
- Test: `apps/user-client/tests/routes/app/knowledge-library.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/routes/app/knowledge-library.test.tsx
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { KnowledgeLibrary } from '../../../src/routes/app/knowledge-library.js';

vi.mock('../../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await openClientDataDb();
  await getClientDataDb().libraries.add({
    id: 'lib1',
    name: 'World Lore',
    description: '',
    nsfw: false,
    createdAt: 1,
    updatedAt: 1,
  });
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/knowledge/lib1']}>
        <Routes>
          <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibrary />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KnowledgeLibrary', () => {
  it('shows the library name and an empty document state', async () => {
    wrap();
    expect(await screen.findByText('World Lore')).toBeTruthy();
    expect(screen.getByText(/no documents yet/i)).toBeTruthy();
  });

  it('adds a document by paste, listed as pending', async () => {
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /add document/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /paste text/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Geography' } });
    fireEvent.change(screen.getByLabelText(/content/i), { target: { value: 'The northern reach.' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText('Geography')).toBeTruthy();
    expect(screen.getByText(/pending/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/app/knowledge-library.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the add-document menu (upload + paste)**

```tsx
// apps/user-client/src/components/knowledge/AddDocumentMenu.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { NewDocumentInput } from '../../data/knowledge.js';

/** Strip a trailing .md/.txt extension for a friendly default title. */
function titleFromFilename(name: string): string {
  return name.replace(/\.(md|markdown|txt)$/i, '');
}

/** Two-source document add: upload .md/.txt files, or paste a single document. */
export function AddDocumentMenu(props: { onAdd: (docs: NewDocumentInput[]) => void }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList): Promise<void> => {
    const docs: NewDocumentInput[] = [];
    for (const file of Array.from(files)) {
      docs.push({ title: titleFromFilename(file.name), content: await file.text() });
    }
    if (docs.length > 0) props.onAdd(docs);
  };

  return (
    <div className="add-document">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
        Add document
      </button>
      {menuOpen ? (
        <div className="add-document-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              fileInputRef.current?.click();
            }}
          >
            Upload files
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setPasteOpen(true);
            }}
          >
            Paste text
          </button>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="sheet-root knowledge-sheet-root">
          <div className="sheet-backdrop" onClick={() => setPasteOpen(false)} />
          <div className="sheet-panel" role="dialog" aria-label="Paste document">
            <label className="sheet-field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label className="sheet-field">
              <span>Content</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
              />
            </label>
            <div className="sheet-actions">
              <button type="button" onClick={() => setPasteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={content.trim().length === 0}
                onClick={() => {
                  props.onAdd([{ title, content }]);
                  setTitle('');
                  setContent('');
                  setPasteOpen(false);
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the library detail page**

```tsx
// apps/user-client/src/routes/app/knowledge-library.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AddDocumentMenu } from '../../components/knowledge/AddDocumentMenu.js';
import { DocumentEditor } from '../../components/knowledge/DocumentEditor.js';
import { DocumentStatusBadge } from '../../components/knowledge/DocumentStatusBadge.js';
import { ModelDownloadBanner } from '../../components/knowledge/ModelDownloadBanner.js';
import { useLibraries } from '../../data/knowledge.js';
import {
  useAddDocuments,
  useDeleteDocument,
  useDocuments,
  useRetryDocument,
} from '../../data/knowledge.js';

/** Library detail — level 2 of the My Knowledge room. */
export function KnowledgeLibrary(): JSX.Element {
  const { libraryId = '' } = useParams();
  const navigate = useNavigate();
  const libraries = useLibraries();
  const documents = useDocuments(libraryId);
  const addDocuments = useAddDocuments(libraryId);
  const retryDocument = useRetryDocument(libraryId);
  const deleteDocument = useDeleteDocument(libraryId);
  const [editingId, setEditingId] = useState<string | null>(null);

  const library = libraries.data?.find((l) => l.id === libraryId);
  const docs = documents.data ?? [];

  return (
    <section className="flex min-h-[80dvh] flex-col gap-4 px-4 pb-12 pt-6">
      <header className="flex items-center justify-between">
        <button type="button" className="knowledge-back" onClick={() => navigate('/app/knowledge')}>
          ← My Knowledge
        </button>
      </header>
      <h1 className="font-display text-2xl">{library?.name ?? 'Library'}</h1>

      <ModelDownloadBanner />
      <AddDocumentMenu onAdd={(d) => addDocuments.mutate(d)} />

      {docs.length === 0 ? (
        <p className="text-paper-soft">No documents yet — add one by upload or paste.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.id} className="knowledge-document-row">
              <button type="button" className="flex-1 text-left" onClick={() => setEditingId(doc.id)}>
                {doc.title}
              </button>
              <DocumentStatusBadge
                status={doc.embeddingStatus}
                onRetry={() => retryDocument.mutate(doc.id)}
              />
              <button
                type="button"
                aria-label={`Delete ${doc.title}`}
                onClick={() => deleteDocument.mutate(doc.id)}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      {editingId ? (
        <DocumentEditor
          libraryId={libraryId}
          documentId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </section>
  );
}
```

> Note: `DocumentEditor` is created in Task 12. To keep this task's test green before Task 12 lands, the subagent implementing Task 11 should create a minimal placeholder `DocumentEditor` that renders `null` if Task 12 is not yet done — but since tasks run in order, Task 12 follows immediately. If running strictly sequentially, temporarily comment the `DocumentEditor` import + usage, and restore them in Task 12. The test here never opens the editor.

- [ ] **Step 5: Register the route**

In `apps/user-client/src/App.tsx`, add the import:

```ts
import { KnowledgeLibrary } from './routes/app/knowledge-library.js';
```

And the route, right after the `/app/knowledge` route:

```tsx
                  <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibrary />} />
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/app/knowledge-library.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/knowledge/AddDocumentMenu.tsx apps/user-client/src/routes/app/knowledge-library.tsx apps/user-client/src/App.tsx apps/user-client/tests/routes/app/knowledge-library.test.tsx
git commit -m "Add library detail page with upload and paste document add"
```

---

### Task 12: Document editor (view + edit, re-embed on content change)

**Files:**
- Create: `apps/user-client/src/components/knowledge/DocumentEditor.tsx`
- Test: `apps/user-client/tests/components/knowledge/DocumentEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/components/knowledge/DocumentEditor.test.tsx
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { DocumentEditor } from '../../../src/components/knowledge/DocumentEditor.js';

const enqueue = vi.fn();
vi.mock('../../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueue(id),
}));

beforeEach(async () => {
  await openClientDataDb();
  enqueue.mockClear();
  await getClientDataDb().documents.add({
    id: 'd1',
    libraryId: 'lib1',
    title: 'Geo',
    content: 'old',
    embeddingStatus: 'ready',
    embeddingError: null,
    chunkCount: 1,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  });
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentEditor libraryId="lib1" documentId="d1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('DocumentEditor', () => {
  it('loads existing content and re-embeds on a content save', async () => {
    wrap();
    const content = (await screen.findByLabelText(/content/i)) as HTMLTextAreaElement;
    expect(content.value).toBe('old');
    fireEvent.change(content, { target: { value: 'new body' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(getClientDataDb().documents.get('d1')).resolves.toMatchObject({
        content: 'new body',
        embeddingStatus: 'pending',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('d1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/knowledge/DocumentEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the editor**

```tsx
// apps/user-client/src/components/knowledge/DocumentEditor.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDocument, useUpdateDocument } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';

/** Full-document editor: title + content. A content change re-queues embedding. */
export function DocumentEditor(props: {
  libraryId: string;
  documentId: string;
  onClose: () => void;
}): JSX.Element | null {
  const doc = useQuery({
    queryKey: QK.document(props.documentId),
    queryFn: () => getDocument(props.documentId),
  });
  const update = useUpdateDocument(props.libraryId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (doc.data && !loaded) {
      setTitle(doc.data.title);
      setContent(doc.data.content);
      setLoaded(true);
    }
  }, [doc.data, loaded]);

  if (!doc.data) return null;

  const save = (): void => {
    const patch: { title?: string; content?: string } = {};
    if (title !== doc.data?.title) patch.title = title;
    if (content !== doc.data?.content) patch.content = content;
    if (patch.title !== undefined || patch.content !== undefined) {
      update.mutate({ id: props.documentId, patch });
    }
    props.onClose();
  };

  return (
    <div className="sheet-root knowledge-sheet-root">
      <div className="sheet-backdrop" onClick={props.onClose} />
      <div className="sheet-panel" role="dialog" aria-label="Edit document">
        <label className="sheet-field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sheet-field">
          <span>Content</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} />
        </label>
        <div className="sheet-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Restore the `DocumentEditor` wiring in `knowledge-library.tsx`** (if it was commented out in Task 11). Confirm the import and the `{editingId ? <DocumentEditor .../> : null}` block are present.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/knowledge/DocumentEditor.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/knowledge/DocumentEditor.tsx apps/user-client/src/routes/app/knowledge-library.tsx apps/user-client/tests/components/knowledge/DocumentEditor.test.tsx
git commit -m "Add document editor with re-embed on content change"
```

---

### Task 13: Enable the My Knowledge tile + start ingestion at boot

**Files:**
- Modify: `apps/user-client/src/routes/app/entrance-hall.tsx`
- Modify: `apps/user-client/src/App.tsx`
- Test: `apps/user-client/tests/unit/entrance-hall.test.tsx` (update the existing stub assertion)

- [ ] **Step 1: Update the entrance-hall test expectation**

In `apps/user-client/tests/unit/entrance-hall.test.tsx`, the existing test `renders Knowledge + Integrations as disabled stubs` must change — Knowledge is no longer a stub. Replace that test with:

```tsx
  it('renders Integrations as a disabled stub and Knowledge as a live tile', async () => {
    wrap('/app');
    const integrations = await screen.findByText('My Integrations');
    expect(integrations.closest('[aria-disabled="true"]')).not.toBeNull();
    const knowledge = await screen.findByText('My Knowledge');
    expect(knowledge.closest('[aria-disabled="true"]')).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/unit/entrance-hall.test.tsx`
Expected: FAIL — Knowledge is still a disabled stub.

- [ ] **Step 3: Enable the tile**

In `apps/user-client/src/routes/app/entrance-hall.tsx`:

Add the hook import:

```ts
import { useFilteredLibraries } from '../../data/knowledge.js';
```

In `EntranceHall`, add near the other counts (after `const artefactCount = ...`):

```ts
  const libraryCount = useFilteredLibraries().data?.length ?? 0;
```

Replace the disabled My Knowledge tile with a live one:

```tsx
        <RoomTile
          label="My Knowledge"
          icon="❖"
          meta={libraryCount === 0 ? 'empty' : `${libraryCount} libraries`}
          to="/app/knowledge"
        />
```

(Leave the `My Integrations` tile as the disabled stub.)

- [ ] **Step 4: Start ingestion at app boot**

In `apps/user-client/src/App.tsx`, add the import:

```ts
import { startKnowledgeIngestion } from './knowledge/start-ingestion.js';
```

Add a one-time effect inside the `App` component body (before the returned JSX). If `App` is not already a function component with a body, add a small `useEffect` at the top level of the component that renders the router. Find the component that renders `<BrowserRouter>` and add:

```tsx
  useEffect(() => {
    void startKnowledgeIngestion();
  }, []);
```

Ensure `useEffect` is imported from `react`. (If the router is rendered by a component without a body, wrap the effect into the nearest top-level component such as `App`.)

- [ ] **Step 5: Run the entrance-hall test to verify it passes**

Run: `cd apps/user-client && pnpm exec vitest run tests/unit/entrance-hall.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/entrance-hall.tsx apps/user-client/src/App.tsx apps/user-client/tests/unit/entrance-hall.test.tsx
git commit -m "Enable My Knowledge tile and start ingestion at boot"
```

---

### Task 14: Styling (minimal, mechanics-first)

**Files:**
- Modify: `apps/user-client/src/index.css`

- [ ] **Step 1: Add minimal styles**

Append to `apps/user-client/src/index.css` (no test — visual; verified by build + manual). Keep it restrained; the opulent pass is the later design sweep.

```css
/* ===== Knowledgebase (Chunk A — minimal mechanics-first styling) ===== */
.knowledge-new-btn,
.knowledge-back {
  border: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 22%, transparent);
  border-radius: 0.5rem;
  padding: 0.35rem 0.75rem;
  background: color-mix(in srgb, var(--color-ink, #1a1a1a) 70%, transparent);
}
.knowledge-library-row,
.knowledge-document-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0.5rem;
  padding: 0.6rem 0.8rem;
  background: rgba(255, 255, 255, 0.02);
}
.knowledge-library-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
}
.doc-status {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}
.doc-status[data-status='failed'] {
  color: #ff8c8c;
}
.doc-status[data-status='ready'] {
  color: var(--color-accent, #c9a227);
}
.doc-status-retry {
  margin-left: 0.4rem;
  text-decoration: underline;
}
.model-download-banner {
  border: 1px solid color-mix(in srgb, var(--color-accent, #c9a227) 40%, transparent);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  background: color-mix(in srgb, var(--color-accent, #c9a227) 12%, var(--color-ink, #1a1a1a));
}
.knowledge-sheet-root .sheet-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.sheet-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.add-document-menu {
  display: flex;
  flex-direction: column;
}
```

> If `.sheet-root`/`.sheet-backdrop`/`.sheet-panel`/`.sheet-actions`/`.sheet-toggle` are not already defined in `index.css`, add minimal definitions for them too (a fixed full-screen root, a translucent backdrop, a centred panel, a right-aligned actions row). Search first: `rg -n "\.sheet-panel|\.sheet-backdrop" apps/user-client/src/index.css`.

- [ ] **Step 2: Build to verify CSS is valid**

Run: `cd apps/user-client && pnpm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Add minimal knowledgebase styling"
```

---

### Task 15: Full verification

- [ ] **Step 1: Type-check the whole repo**

Run: `cd /home/chris/workspace/chatsundere && pnpm typecheck`
Expected: all packages pass (14/14 or current count).

- [ ] **Step 2: Embeddings package tests**

Run: `cd packages/embeddings && bun test`
Expected: all pass (existing + the new chunker suite).

- [ ] **Step 3: Full user-client test suite**

Run: `cd apps/user-client && pnpm exec vitest run`
Expected: all new knowledge suites pass; the only failures are the pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (verify identical on master via `git stash` if in doubt).

- [ ] **Step 4: Build**

Run: `cd /home/chris/workspace/chatsundere && pnpm run build`
Expected: 9/9 (or current count); the engine worker emits as its own chunk.

- [ ] **Step 5: Biome**

Run: `cd /home/chris/workspace/chatsundere && pnpm exec biome check apps/user-client/src packages/embeddings/src`
Expected: clean (fix any reported issues).

- [ ] **Step 6: Hand back for manual verification**

Report the verification results and the manual-verification checklist (spec §8) for Chris to run on device. Do **not** squash yet — Chris device-tests first.

---

## Self-Review

**Spec coverage:**
- Data model (§3): Tasks 2 (Dexie), 3 (vector store). ✓
- Chunker (§4.1): Task 1. ✓
- Background queue + status + reload reset + mid-flight discard (§4.2, §4.4): Tasks 7, 8. ✓
- Model download UX (§4.3): Tasks 3 (progress wiring), 9 (banner). ✓
- My Knowledge room, list + detail, NSFW gating, upload+paste, editor, empty states (§5): Tasks 10, 11, 12, 13. ✓
- Cascade integrity (§3.3): Tasks 5 (library/document cascade), 8 (re-embed delete-then-write). ✓
- Error handling (§6): Task 6 (empty reject, re-embed), 7 (failed + discard), 9 (retry, banner). ✓
- Testing (§7): every code task is TDD; Task 15 runs the full suites. ✓
- Enable tile (§5): Task 13. ✓

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step contains real code. The one forward-reference (`DocumentEditor` used in Task 11, created in Task 12) is called out explicitly with a concrete interim instruction.

**Type consistency:** `Chunk { text, headingPath, chunkIndex }`, `LibraryRow`, `DocumentRow`, `EmbeddingStatus`, `KNOWLEDGE_COLLECTION`, `VectorStoreLike`, `IngestionDeps`, `NewDocumentInput`, and the data-layer function names (`addDocuments`, `updateDocument`, `deleteDocumentCascade`, `deleteLibraryCascade`, `enqueueDocument`, `resetInterruptedDocuments`, `startKnowledgeIngestion`) are used identically across tasks. Vector id format `` `${documentId}#${chunkIndex}` `` is consistent in Tasks 3, 5, 8. The `enqueueDocument` import path (`../knowledge/start-ingestion.js`) is mocked identically in Tasks 6, 11, 12.

**Note for the implementer:** Task 11's `knowledge-library.tsx` imports `DocumentEditor` (Task 12). Run Tasks in order; if a task must be green standalone, follow Task 11 Step 4's interim-comment instruction, restored in Task 12 Step 4.
