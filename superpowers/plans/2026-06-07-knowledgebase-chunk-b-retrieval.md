# Knowledgebase Chunk B (Retrieval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a companion *use* the knowledgebase — a `query_knowledgebase` tool that searches only the libraries assigned to the persona (plus ad-hoc chat additions), with the model made aware of what is available.

**Architecture:** A new third tool category — *context tools* — sits beside the static tools and the provider-Integrations in `resolveActiveTools`. Per send, the send-path computes the effective library set (persona ∪ chat, existence-checked, NSFW-filtered) and a `retrieve` closure; the stream-manager turns that into the `query_knowledgebase` tool and a Band-2 system-prompt awareness segment. Retrieval embeds the query on-device and runs one filtered `store.query` per assigned library, then merges.

**Tech Stack:** TypeScript (strict), Dexie, `@chatsundere/embeddings` (on-device vector store + arctic-embed engine), `@chatsundere/llm-unified` (prompt builder), React + Vitest, Bun test (llm-unified).

**Spec:** `superpowers/specs/2026-06-07-knowledgebase-chunk-b-retrieval-design.md`

**Conventions for every task:** British English in all artefacts. Each source file starts with its existing SPDX header (`AGPL-3.0-only` for `apps/*`, `LGPL-3.0-only` for `packages/llm-unified`). Commit messages are free-form imperative with the trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. This is **not** a Larissa change. Run the FULL vitest, not just the touched dir, when a task says so.

---

## Task 1: Band-2 `knowledgeLibraries` awareness segment (llm-unified)

**Files:**
- Modify: `packages/llm-unified/src/composition.ts`
- Test: `packages/llm-unified/src/composition.test.ts`

Make the input **optional** (`?? ''`) so existing `buildPrompt` callers (title-generator, chat-page gauge) need no change; only the chat send-path will pass a real value.

- [ ] **Step 1: Write the failing test**

Add to `composition.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { buildPrompt } from './composition.js';

const base = {
  tonalityEnabled: false,
  nsfwEnabled: false,
  globalInstructions: '',
  personaInstructions: 'You are Liz.',
  aboutMe: '',
  projectInstructions: '',
  memoryContext: '',
  toolsInstruction: '',
};

describe('knowledgeLibraries segment', () => {
  it('includes the knowledge awareness text in a chat prompt', () => {
    const out = buildPrompt(
      { ...base, knowledgeLibrariesContext: 'You can search: Farblehre — colour notes.' },
      'chat',
    );
    expect(out).toContain('You can search: Farblehre — colour notes.');
  });

  it('drops the segment when empty', () => {
    const out = buildPrompt({ ...base }, 'chat');
    expect(out).not.toContain('You can search');
  });

  it('drops the segment for the title job even when provided', () => {
    const out = buildPrompt(
      { ...base, knowledgeLibrariesContext: 'You can search: X.' },
      'title',
    );
    expect(out).not.toContain('You can search');
  });

  it('orders knowledge after memories', () => {
    const out = buildPrompt(
      { ...base, memoryContext: 'MEM', knowledgeLibrariesContext: 'KB' },
      'chat',
    );
    expect(out.indexOf('MEM')).toBeLessThan(out.indexOf('KB'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: FAIL — `knowledgeLibrariesContext` is not a known property / segment absent.

- [ ] **Step 3: Implement**

In `composition.ts`, add the optional input to `BuildPromptInputs` (after `memoryContext`):

```ts
  /** Reserved slot — no producer yet. */
  memoryContext: string;
  /** Band-2 knowledge-libraries awareness (chat only); empty when none assigned. */
  knowledgeLibrariesContext?: string;
```

Add `'knowledgeLibraries'` to the `SegmentId` union (after `'memories'`). Add the registry entry after the `memories` segment (band 2, order 3):

```ts
  { id: 'memories', band: 2, order: 2, jobs: CHAT_ONLY, resolve: (i) => i.memoryContext },
  {
    id: 'knowledgeLibraries',
    band: 2,
    order: 3,
    jobs: CHAT_ONLY,
    resolve: (i) => i.knowledgeLibrariesContext ?? '',
  },
  { id: 'tools', band: 3, order: 0, jobs: CHAT_ONLY, resolve: (i) => i.toolsInstruction },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: PASS (all four new cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts
git commit -m "Add Band-2 knowledge-libraries awareness segment

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Dexie v15 — `libraryIds` on personas and chats

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (interfaces + version 15)
- Test: `apps/user-client/src/boot/client-data-db.test.ts` (verno + backfill)

- [ ] **Step 1: Write the failing test**

Find the existing verno assertion (it asserts `db.verno === 14`) and bump it to `15`. Add a backfill test alongside the existing migration tests:

```ts
it('v15 backfills libraryIds to [] on personas and chats', async () => {
  const db = await openDb();
  const persona = await db.personas.toArray();
  const chats = await db.chats.toArray();
  for (const p of persona) expect(Array.isArray(p.libraryIds)).toBe(true);
  for (const c of chats) expect(Array.isArray(c.libraryIds)).toBe(true);
  expect(db.verno).toBe(15);
});
```

(If the existing suite seeds no personas/chats, the loops are vacuously true; the `verno` assertion is the load-bearing one. Match the file's existing `openDb`/reset helper.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/boot/client-data-db.test.ts`
Expected: FAIL — verno is 14, not 15.

- [ ] **Step 3: Implement**

Add the field to both interfaces:

```ts
// PersonaRow — after contextWindow:
  /** Knowledge libraries assigned to this persona (Chunk B). */
  libraryIds: string[];
```
```ts
// ChatRow — after draftInput:
  /** Ad-hoc knowledge libraries for this chat only (Chunk B). */
  libraryIds: string[];
```

Add version 15 after version 14 (re-state the personas/chats index strings — they are unchanged — to follow the existing convention):

```ts
    // Version 15 — knowledgebase Chunk B (retrieval). Personas and chats gain a
    // non-indexed `libraryIds` array binding them to knowledge libraries.
    this.version(15)
      .stores({
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (!Array.isArray(p.libraryIds)) p.libraryIds = [];
          });
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            if (!Array.isArray(c.libraryIds)) c.libraryIds = [];
          });
      });
```

**Type-fallout note:** making `libraryIds` required will surface `tsc` errors anywhere a `PersonaRow`/`ChatRow` literal is constructed in non-test code (e.g. `useCreatePersona` builds from `CreatePersonaArgs = Omit<PersonaRow,'id'|'createdAt'|'updatedAt'>`, and `useSendMessage`/`useCreateChat` build `ChatRow` literals). Fix each by adding `libraryIds: []` to the constructed literal:
- `apps/user-client/src/data/personas.ts` — the persona-editor passes a full `CreatePersonaArgs`; ensure the editor's create payload includes `libraryIds: []` (or default it in `useCreatePersona`). Simplest: in `useCreatePersona`, default it — `const row: PersonaRow = { id: uuidv7(), createdAt: now, updatedAt: now, libraryIds: [], ...args };`.
- `apps/user-client/src/data/chats.ts` `useCreateChat` — add `libraryIds: []` to the `db.chats.add({...})` literal.
- `apps/user-client/src/data/send-message.ts` `useSendMessage` lazy-chat `db.chats.add({...})` — add `libraryIds: []`.
- Any test fixtures building these rows — add `libraryIds: []`.

Run `pnpm typecheck` and fix each reported literal until clean (do not cast).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run src/boot/client-data-db.test.ts`
Then: `pnpm typecheck` (from repo root) — expect 0 errors.
Expected: PASS; verno 15; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src
git commit -m "Add libraryIds to personas and chats (Dexie v15)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: `deleteLibraryCascade` prunes persona + chat bindings

**Files:**
- Modify: `apps/user-client/src/data/knowledge.ts:59-68` (`deleteLibraryCascade`)
- Test: `apps/user-client/src/data/knowledge.test.ts` (or the existing knowledge data test)

- [ ] **Step 1: Write the failing test**

```ts
it('deleteLibraryCascade prunes the id from personas and chats', async () => {
  const db = getClientDataDb();
  const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
  const other = await createLibrary({ name: 'Other', description: '', nsfw: false });
  await db.personas.add(makePersona({ id: 'p1', libraryIds: [lib.id, other.id] }));
  await db.chats.add(makeChat({ id: 'c1', personaId: 'p1', libraryIds: [lib.id] }));

  await deleteLibraryCascade(lib.id);

  expect((await db.personas.get('p1'))?.libraryIds).toEqual([other.id]);
  expect((await db.chats.get('c1'))?.libraryIds).toEqual([]);
});
```

(Use the file's existing fixture helpers; if none, build minimal `PersonaRow`/`ChatRow` literals with all required fields incl. `libraryIds`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/data/knowledge.test.ts`
Expected: FAIL — persona/chat `libraryIds` still contain the deleted id.

- [ ] **Step 3: Implement**

Extend `deleteLibraryCascade` to prune bindings in the same logical operation:

```ts
/** Delete a library, all its documents and vectors, and prune the id from every
 *  persona and chat that referenced it. */
export async function deleteLibraryCascade(
  id: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  const db = getClientDataDb();
  const docs = await db.documents.where('libraryId').equals(id).toArray();
  for (const doc of docs) await deleteDocumentVectors(doc.id, store);
  await db.documents.where('libraryId').equals(id).delete();
  await db.libraries.delete(id);
  // Prune dangling bindings.
  await db.personas
    .filter((p) => p.libraryIds.includes(id))
    .modify((p) => {
      p.libraryIds = p.libraryIds.filter((l) => l !== id);
    });
  await db.chats
    .filter((c) => c.libraryIds.includes(id))
    .modify((c) => {
      c.libraryIds = c.libraryIds.filter((l) => l !== id);
    });
}
```

In `useDeleteLibrary`'s `onSuccess`, also invalidate persona + chat queries so bound UIs refresh:

```ts
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.libraries });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: QK.personas });
      qc.invalidateQueries({ queryKey: QK.chats });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/data/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/knowledge.ts apps/user-client/src/data/knowledge.test.ts
git commit -m "Prune library bindings from personas and chats on delete

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: `useSetChatLibraries` mutation

**Files:**
- Modify: `apps/user-client/src/data/chats.ts`
- Test: `apps/user-client/src/data/chats.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
it('setChatLibraries writes libraryIds and invalidates the chat query', async () => {
  const db = getClientDataDb();
  await db.chats.add(makeChat({ id: 'c1', personaId: 'p1', libraryIds: [] }));
  await setChatLibraries('c1', ['a', 'b']);
  expect((await db.chats.get('c1'))?.libraryIds).toEqual(['a', 'b']);
});
```

Export a plain async helper plus the hook so the helper is unit-testable without React:

```ts
export async function setChatLibraries(chatId: string, libraryIds: string[]): Promise<void> {
  await getClientDataDb().chats.update(chatId, { libraryIds });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/data/chats.test.ts`
Expected: FAIL — `setChatLibraries` undefined.

- [ ] **Step 3: Implement**

Add the helper (above) and the hook to `chats.ts`:

```ts
/** Set the ad-hoc knowledge libraries for a single chat. */
export function useSetChatLibraries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { chatId: string; libraryIds: string[] }) =>
      setChatLibraries(args.chatId, args.libraryIds),
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.chat(args.chatId) });
      qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/data/chats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/chats.ts apps/user-client/src/data/chats.test.ts
git commit -m "Add setChatLibraries mutation for ad-hoc chat knowledge binding

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: `computeEffectiveLibraries` (pure)

**Files:**
- Create: `apps/user-client/src/knowledge/effective-libraries.ts`
- Test: `apps/user-client/src/knowledge/effective-libraries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { LibraryRow } from '../boot/client-data-db.js';
import { computeEffectiveLibraries } from './effective-libraries.js';

const lib = (id: string, nsfw = false): LibraryRow => ({
  id,
  name: id.toUpperCase(),
  description: `${id} desc`,
  nsfw,
  createdAt: 0,
  updatedAt: 0,
});

describe('computeEffectiveLibraries', () => {
  const all = [lib('a'), lib('b'), lib('c'), lib('x', true)];

  it('unions persona and chat ids', () => {
    const out = computeEffectiveLibraries(['a'], ['b'], all, true);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('deduplicates overlap', () => {
    const out = computeEffectiveLibraries(['a', 'b'], ['b'], all, true);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('drops ids with no existing library row', () => {
    const out = computeEffectiveLibraries(['a', 'ghost'], [], all, true);
    expect(out.map((l) => l.id)).toEqual(['a']);
  });

  it('filters NSFW libraries when not allowed', () => {
    const out = computeEffectiveLibraries(['a', 'x'], [], all, false);
    expect(out.map((l) => l.id)).toEqual(['a']);
  });

  it('keeps NSFW libraries when allowed', () => {
    const out = computeEffectiveLibraries(['a', 'x'], [], all, true);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'x']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/effective-libraries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { LibraryRow } from '../boot/client-data-db.js';

/**
 * The libraries actually searchable for a send: the union of the persona's and
 * the chat's assigned ids, intersected with libraries that currently exist, then
 * NSFW-filtered. Order follows `allLibraries`. An empty result means the
 * knowledge tool must not be offered.
 */
export function computeEffectiveLibraries(
  personaLibraryIds: readonly string[],
  chatLibraryIds: readonly string[],
  allLibraries: readonly LibraryRow[],
  nsfwAllowed: boolean,
): LibraryRow[] {
  const wanted = new Set([...personaLibraryIds, ...chatLibraryIds]);
  return allLibraries.filter((l) => wanted.has(l.id) && (nsfwAllowed || !l.nsfw));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/effective-libraries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/effective-libraries.ts apps/user-client/src/knowledge/effective-libraries.test.ts
git commit -m "Add computeEffectiveLibraries pure helper

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: `retrieveFromLibraries` (embed + per-library query + merge)

**Files:**
- Create: `apps/user-client/src/knowledge/retrieval.ts`
- Test: `apps/user-client/src/knowledge/retrieval.test.ts`

Defines `RetrievedChunk` and the injectable retrieval. Deps are injected so the test needs no real engine/store.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { retrieveFromLibraries } from './retrieval.js';

const deps = {
  embed: vi.fn(async () => [new Float32Array([1, 0, 0])]),
  query: vi.fn(async ({ filter }: { filter: { tags: { libraryId: string } } }) => {
    const id = filter.tags.libraryId;
    if (id === 'a') return [{ id: 'doc1#0', score: 0.9, numeric: { chunkIndex: 0 }, metadata: { text: 'TA', headingPath: ['H'] } }];
    if (id === 'b') return [{ id: 'doc2#1', score: 0.5, numeric: { chunkIndex: 1 }, metadata: { text: 'TB', headingPath: [] } }];
    return [];
  }),
  getDocumentTitle: vi.fn(async (docId: string) => (docId === 'doc1' ? 'Doc One' : 'Doc Two')),
};

describe('retrieveFromLibraries', () => {
  it('merges hits across libraries, sorted by score, with provenance', async () => {
    const libs = [
      { id: 'a', name: 'LibA', description: '' },
      { id: 'b', name: 'LibB', description: '' },
    ];
    const hits = await retrieveFromLibraries(deps, libs, 'q', { topK: 6, minScore: 0.3, candidateK: 24 });
    expect(hits).toEqual([
      { libraryName: 'LibA', documentTitle: 'Doc One', headingPath: ['H'], text: 'TA', score: 0.9 },
      { libraryName: 'LibB', documentTitle: 'Doc Two', headingPath: [], text: 'TB', score: 0.5 },
    ]);
    expect(deps.embed).toHaveBeenCalledWith(['q'], { kind: 'query' });
  });

  it('applies the global topK after merge', async () => {
    const libs = [{ id: 'a', name: 'LibA', description: '' }, { id: 'b', name: 'LibB', description: '' }];
    const hits = await retrieveFromLibraries(deps, libs, 'q', { topK: 1, minScore: 0.3, candidateK: 24 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.libraryName).toBe('LibA');
  });

  it('returns [] for no libraries without embedding', async () => {
    const localEmbed = vi.fn();
    const hits = await retrieveFromLibraries({ ...deps, embed: localEmbed }, [], 'q', { topK: 6, minScore: 0.3, candidateK: 24 });
    expect(hits).toEqual([]);
    expect(localEmbed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/retrieval.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Candidate } from '@chatsundere/embeddings';
import { KNOWLEDGE_COLLECTION } from '../boot/knowledge-vectors-db.js';

/** A passage returned to the model, with its provenance. */
export interface RetrievedChunk {
  libraryName: string;
  documentTitle: string;
  headingPath: string[];
  text: string;
  score: number;
}

/** A library reference carrying just what retrieval and awareness need. */
export interface LibraryMeta {
  id: string;
  name: string;
  description: string;
}

export interface RetrievalOptions {
  topK: number;
  minScore: number;
  candidateK: number;
}

/** Injected I/O so the merge logic is unit-testable without engine/store/db. */
export interface RetrievalDeps {
  embed: (texts: string[], opts: { kind: 'query' }) => Promise<Float32Array[]>;
  query: (req: {
    collection: string;
    filter: { tags: { libraryId: string } };
    vector: Float32Array;
    topK: number;
    candidateK: number;
    minScore: number;
  }) => Promise<Candidate[]>;
  getDocumentTitle: (documentId: string) => Promise<string>;
}

function documentIdOf(chunkId: string): string {
  const hash = chunkId.lastIndexOf('#');
  return hash >= 0 ? chunkId.slice(0, hash) : chunkId;
}

/**
 * Embed the query once, run one filtered query per library, merge, sort by score
 * descending, slice to the global topK, and resolve provenance. Returns `[]`
 * (without embedding) when no libraries are given.
 */
export async function retrieveFromLibraries(
  deps: RetrievalDeps,
  libraries: readonly LibraryMeta[],
  query: string,
  opts: RetrievalOptions,
): Promise<RetrievedChunk[]> {
  if (libraries.length === 0) return [];
  const [vector] = await deps.embed([query], { kind: 'query' });
  if (!vector) return [];

  const perLibrary = await Promise.all(
    libraries.map(async (lib) => {
      const candidates = await deps.query({
        collection: KNOWLEDGE_COLLECTION,
        filter: { tags: { libraryId: lib.id } },
        vector,
        topK: opts.topK,
        candidateK: opts.candidateK,
        minScore: opts.minScore,
      });
      return candidates.map((c) => ({ c, libraryName: lib.name }));
    }),
  );

  const merged = perLibrary
    .flat()
    .sort((a, b) => b.c.score - a.c.score)
    .slice(0, opts.topK);

  return Promise.all(
    merged.map(async ({ c, libraryName }) => {
      const meta = (c.metadata ?? {}) as { text?: string; headingPath?: string[] };
      return {
        libraryName,
        documentTitle: await deps.getDocumentTitle(documentIdOf(c.id)),
        headingPath: meta.headingPath ?? [],
        text: meta.text ?? '',
        score: c.score,
      };
    }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/retrieval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/retrieval.ts apps/user-client/src/knowledge/retrieval.test.ts
git commit -m "Add retrieveFromLibraries merge logic

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: `query-tool.ts` — tool, formatter, awareness renderer

**Files:**
- Create: `apps/user-client/src/knowledge/query-tool.ts`
- Test: `apps/user-client/src/knowledge/query-tool.test.ts`

Defines the `KnowledgeContext` interface (libraries + a `retrieve` closure), `contributeKnowledgeTools`, `formatRetrieval`, and `renderKnowledgeAwareness`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { contributeKnowledgeTools, renderKnowledgeAwareness } from './query-tool.js';
import type { RetrievedChunk } from './retrieval.js';

const ctx = (hits: RetrievedChunk[]) => ({
  libraries: [{ id: 'a', name: 'Farblehre', description: 'colour notes' }],
  retrieve: vi.fn(async () => hits),
});

describe('contributeKnowledgeTools', () => {
  it('returns no tool when there are no libraries', () => {
    expect(contributeKnowledgeTools({ libraries: [], retrieve: vi.fn() })).toEqual([]);
  });

  it('contributes query_knowledgebase with a query param', () => {
    const [tool] = contributeKnowledgeTools(ctx([]));
    expect(tool?.name).toBe('query_knowledgebase');
    expect(tool?.parameters).toMatchObject({ required: ['query'] });
  });

  it('formats hits with provenance', async () => {
    const [tool] = contributeKnowledgeTools(
      ctx([{ libraryName: 'Farblehre', documentTitle: 'Grundlagen', headingPath: ['Farbkraft'], text: 'Chunk text', score: 0.57 }]),
    );
    const res = await tool!.execute({ query: 'farbkraft' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('Farblehre');
    expect(res.output).toContain('Grundlagen');
    expect(res.output).toContain('Farbkraft');
    expect(res.output).toContain('Chunk text');
    expect(res.output).toContain('0.57');
  });

  it('returns a constructive message when nothing matches', async () => {
    const [tool] = contributeKnowledgeTools(ctx([]));
    const res = await tool!.execute({ query: 'nope' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('No relevant passages');
  });

  it('returns an error result when retrieve throws', async () => {
    const c = { libraries: [{ id: 'a', name: 'A', description: '' }], retrieve: vi.fn(async () => { throw new Error('engine down'); }) };
    const [tool] = contributeKnowledgeTools(c);
    const res = await tool!.execute({ query: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('engine down');
  });
});

describe('renderKnowledgeAwareness', () => {
  it('lists names and descriptions', () => {
    const text = renderKnowledgeAwareness([
      { id: 'a', name: 'Farblehre', description: 'colour notes' },
      { id: 'b', name: 'Reise-Japan', description: 'travel docs' },
    ]);
    expect(text).toContain('query_knowledgebase');
    expect(text).toContain('Farblehre');
    expect(text).toContain('colour notes');
    expect(text).toContain('Reise-Japan');
  });

  it('returns empty string for no libraries', () => {
    expect(renderKnowledgeAwareness([])).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/query-tool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, ToolResult } from '../tools/types.js';
import type { LibraryMeta, RetrievedChunk } from './retrieval.js';

/** Per-send knowledge context: the searchable libraries and a retrieve closure. */
export interface KnowledgeContext {
  libraries: LibraryMeta[];
  retrieve: (query: string, signal?: AbortSignal) => Promise<RetrievedChunk[]>;
}

/** Format retrieved chunks for the model — one provenance-headed block each. */
export function formatRetrieval(hits: RetrievedChunk[]): string {
  if (hits.length === 0) return 'No relevant passages found in the assigned knowledge libraries.';
  return hits
    .map((h) => {
      const path = [h.libraryName, h.documentTitle, ...h.headingPath].join(' › ');
      return `[${path}]  (${h.score.toFixed(2)})\n${h.text}`;
    })
    .join('\n\n---\n\n');
}

/** Band-2 awareness text naming the available libraries, or '' when none. */
export function renderKnowledgeAwareness(libraries: LibraryMeta[]): string {
  if (libraries.length === 0) return '';
  const lines = libraries.map((l) =>
    l.description.trim() ? `- **${l.name}** — ${l.description.trim()}` : `- **${l.name}**`,
  );
  return [
    "You can search the user's knowledge libraries with `query_knowledgebase`. Available libraries:",
    ...lines,
    'Search them when a question may be covered there rather than answering from memory.',
  ].join('\n');
}

/** The context-tool family for the knowledgebase. Empty when no libraries. */
export function contributeKnowledgeTools(ctx: KnowledgeContext): Tool[] {
  if (ctx.libraries.length === 0) return [];
  return [
    {
      name: 'query_knowledgebase',
      description:
        "Search the user's assigned knowledge libraries for relevant passages. Use it when a question may be covered by the libraries listed in your context rather than answering from memory.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to look up.' } },
        required: ['query'],
      },
      systemPromptInstruction:
        'When a question may be answered from the user knowledge libraries, call query_knowledgebase before answering from memory.',
      async execute(args, signal): Promise<ToolResult> {
        try {
          const query = typeof args.query === 'string' ? args.query : '';
          const hits = await ctx.retrieve(query, signal);
          return { ok: true, output: formatRetrieval(hits), error: null };
        } catch (e) {
          return {
            ok: false,
            output: '',
            error: e instanceof Error ? e.message : 'Knowledge search failed.',
          };
        }
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/query-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/query-tool.ts apps/user-client/src/knowledge/query-tool.test.ts
git commit -m "Add query_knowledgebase tool, formatter and awareness renderer

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: `buildKnowledgeContext` — compose effective set + real retrieve

**Files:**
- Create: `apps/user-client/src/knowledge/knowledge-context.ts`
- Test: `apps/user-client/src/knowledge/knowledge-context.test.ts`

Wires the real engine/store/db into a `KnowledgeContext`, or returns `null` when the effective set is empty. The retrieval defaults live here.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ChatRow, PersonaRow } from '../boot/client-data-db.js';
import { buildKnowledgeContext } from './knowledge-context.js';

const persona = (libraryIds: string[], adult = true) =>
  ({ id: 'p', adultPersona: adult, libraryIds } as unknown as PersonaRow);
const chat = (libraryIds: string[]) => ({ id: 'c', libraryIds } as unknown as ChatRow);

const lib = (id: string, nsfw = false) => ({ id, name: id, description: '', nsfw, createdAt: 0, updatedAt: 0 });

describe('buildKnowledgeContext', () => {
  it('returns null when the effective set is empty', async () => {
    const deps = { listLibraries: vi.fn(async () => [lib('a')]), embed: vi.fn(), query: vi.fn(), getDocumentTitle: vi.fn() };
    const out = await buildKnowledgeContext(deps, persona([]), chat([]));
    expect(out).toBeNull();
  });

  it('builds a context over the union, NSFW-filtered', async () => {
    const deps = { listLibraries: vi.fn(async () => [lib('a'), lib('x', true)]), embed: vi.fn(async () => [new Float32Array([1])]), query: vi.fn(async () => []), getDocumentTitle: vi.fn(async () => 't') };
    const out = await buildKnowledgeContext(deps, persona(['a', 'x'], false), chat([]));
    expect(out?.libraries.map((l) => l.id)).toEqual(['a']);
    expect(typeof out?.retrieve).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/knowledge-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Candidate } from '@chatsundere/embeddings';
import type { ChatRow, LibraryRow, PersonaRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { getEmbeddingEngine, getKnowledgeVectorStore } from '../boot/knowledge-vectors-db.js';
import { computeEffectiveLibraries } from './effective-libraries.js';
import type { KnowledgeContext } from './query-tool.js';
import { type RetrievalDeps, retrieveFromLibraries } from './retrieval.js';

/** Retrieval tuning — device-tunable knobs (spec §4). */
export const KNOWLEDGE_RETRIEVAL_OPTS = { topK: 6, minScore: 0.35, candidateK: 24 };

/** Injectable I/O for the test; the default wires the live db + engine + store. */
export interface KnowledgeContextDeps {
  listLibraries: () => Promise<LibraryRow[]>;
  embed: RetrievalDeps['embed'];
  query: RetrievalDeps['query'];
  getDocumentTitle: (documentId: string) => Promise<string>;
}

function liveDeps(): KnowledgeContextDeps {
  const db = getClientDataDb();
  return {
    listLibraries: () => db.libraries.toArray(),
    embed: async (texts, opts) => (await getEmbeddingEngine()).embed(texts, opts),
    query: (req) => getKnowledgeVectorStore().query(req) as Promise<Candidate[]>,
    getDocumentTitle: async (documentId) => (await db.documents.get(documentId))?.title ?? 'Untitled',
  };
}

/**
 * Assemble the per-send knowledge context, or `null` when nothing is searchable.
 * NSFW gating uses the persona's `adultPersona` flag (mirrors IntegrationContext).
 */
export async function buildKnowledgeContext(
  deps: KnowledgeContextDeps = liveDeps(),
  persona: Pick<PersonaRow, 'adultPersona' | 'libraryIds'>,
  chat: Pick<ChatRow, 'libraryIds'>,
): Promise<KnowledgeContext | null> {
  const all = await deps.listLibraries();
  const effective = computeEffectiveLibraries(
    persona.libraryIds,
    chat.libraryIds,
    all,
    persona.adultPersona,
  );
  if (effective.length === 0) return null;

  const libraries = effective.map((l) => ({ id: l.id, name: l.name, description: l.description }));
  const retrievalDeps: RetrievalDeps = {
    embed: deps.embed,
    query: deps.query,
    getDocumentTitle: deps.getDocumentTitle,
  };
  return {
    libraries,
    retrieve: (query) => retrieveFromLibraries(retrievalDeps, libraries, query, KNOWLEDGE_RETRIEVAL_OPTS),
  };
}
```

Note the parameter order (`deps` first, with a live default) lets the test pass explicit deps while the call-site uses `buildKnowledgeContext(undefined, persona, chat)`; if you prefer call-site ergonomics, swap to `(persona, chat, deps = liveDeps())` and update the test accordingly. Keep whichever you choose consistent with Task 12.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/knowledge/knowledge-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/knowledge-context.ts apps/user-client/src/knowledge/knowledge-context.test.ts
git commit -m "Add buildKnowledgeContext composing effective set and retrieve

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: `resolveActiveTools` accepts the knowledge context

**Files:**
- Modify: `apps/user-client/src/tools/registry.ts:14-16`
- Test: `apps/user-client/src/tools/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('appends query_knowledgebase when a knowledge context has libraries', () => {
  const knowledge = { libraries: [{ id: 'a', name: 'A', description: '' }], retrieve: async () => [] };
  const tools = resolveActiveTools(emptyIntegrationCtx(), knowledge);
  expect(tools.some((t) => t.name === 'query_knowledgebase')).toBe(true);
});

it('omits query_knowledgebase when knowledge is null', () => {
  const tools = resolveActiveTools(emptyIntegrationCtx(), null);
  expect(tools.some((t) => t.name === 'query_knowledgebase')).toBe(false);
});

it('omits query_knowledgebase when knowledge has no libraries', () => {
  const tools = resolveActiveTools(emptyIntegrationCtx(), { libraries: [], retrieve: async () => [] });
  expect(tools.some((t) => t.name === 'query_knowledgebase')).toBe(false);
});
```

(Reuse the file's existing integration-context fixture; name the helper `emptyIntegrationCtx` if one isn't already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/tools/registry.test.ts`
Expected: FAIL — `resolveActiveTools` takes one arg.

- [ ] **Step 3: Implement**

```ts
import { INTEGRATIONS } from '../integrations/index.js';
import type { IntegrationContext } from '../integrations/types.js';
import { type KnowledgeContext, contributeKnowledgeTools } from '../knowledge/query-tool.js';
import { calculateJs } from './calculate-js.js';
import type { Tool, ToolResult } from './types.js';

/** Always-on tools (omakase — no per-tool toggle). */
const STATIC_TOOLS: readonly Tool[] = [calculateJs];

/** The active tool set for this send: static tools, every integration-contributed
 *  tool, and the local context tools (knowledgebase) when a context is present. */
export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/tools/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/tools/registry.ts apps/user-client/src/tools/registry.test.ts
git commit -m "Thread knowledge context into resolveActiveTools

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: `stream-engine` consumes `knowledgeLibrariesContext`

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts:27-52` (StartStreamArgs) and `:69-81` (buildPrompt call)
- Test: `apps/user-client/src/lib/stream-engine.test.ts` (extend if a system-prompt assertion exists; otherwise this is covered transitively — add a focused unit test)

- [ ] **Step 1: Write the failing test**

If `stream-engine.test.ts` already mocks `streamCompletion` and captures the system prompt, add:

```ts
it('passes knowledgeLibrariesContext into the system prompt', async () => {
  // ...arrange args with knowledgeLibrariesContext: 'You can search: A.'
  // capture the system message handed to streamCompletion
  expect(capturedSystemPrompt).toContain('You can search: A.');
});
```

If no such harness exists, skip a new engine test here (the segment is unit-tested in Task 1 and the wiring is covered by Task 11's stream-manager test); note that in the commit.

- [ ] **Step 2: Run / confirm**

Run: `cd apps/user-client && pnpm vitest run src/lib/stream-engine.test.ts`
Expected: FAIL (if a test was added) or PASS-baseline (if skipped).

- [ ] **Step 3: Implement**

Add the field to `StartStreamArgs` (after `toolsInstruction`):

```ts
  /** Band-2 knowledge-libraries awareness text (chat only); '' when none. */
  knowledgeLibrariesContext?: string;
```

Pass it into `buildPrompt`:

```ts
  const systemPrompt = buildPrompt(
    {
      tonalityEnabled: args.persona.chatsundereTonality,
      nsfwEnabled: args.persona.adultPersona,
      globalInstructions: args.globalInstructions,
      personaInstructions: args.persona.instructions,
      aboutMe,
      projectInstructions: '',
      memoryContext: '',
      knowledgeLibrariesContext: args.knowledgeLibrariesContext ?? '',
      toolsInstruction: args.toolsInstruction ?? '',
    },
    'chat',
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/lib/stream-engine.test.ts`
Then `pnpm typecheck`.
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/stream-engine.test.ts
git commit -m "Feed knowledge awareness into the chat system prompt

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 11: `stream-manager` derives knowledge tools + awareness

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (`StartArgs` extras `:48-61`; `runIntoDraft` `:321-381`)
- Test: `apps/user-client/src/state/stream-manager-store.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the store test to assert that when `start` is called with a `knowledge` context whose `libraries` is non-empty, the streamed args carry a non-empty `knowledgeLibrariesContext` and the offered tool defs include `query_knowledgebase`. Mirror the existing harness that already captures `runStreamEngine`/`runToolLoop` inputs (the suite already stubs these — follow its pattern; if it stubs `args.offering.profile`, keep `toolCalls.supported: true`).

```ts
it('offers query_knowledgebase and awareness when knowledge libraries are present', async () => {
  const knowledge = { libraries: [{ id: 'a', name: 'Farblehre', description: 'colour' }], retrieve: async () => [] };
  await startWith({ knowledge }); // helper that calls store.start with the standard args + knowledge
  expect(capturedToolDefs.some((d) => d.name === 'query_knowledgebase')).toBe(true);
  expect(capturedStreamArgs.knowledgeLibrariesContext).toContain('Farblehre');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/state/stream-manager-store.test.ts`
Expected: FAIL — `knowledge` not accepted / awareness empty.

- [ ] **Step 3: Implement**

Add to the `StartArgs` extras object (after `substituteOneShotBase`):

```ts
  /**
   * Per-send knowledge context (effective libraries + retrieve closure), resolved
   * in the send path. Absent/null = no libraries assigned → no knowledge tool.
   */
  knowledge?: import('../knowledge/query-tool.js').KnowledgeContext | null;
```

In `runIntoDraft`, after building `integrationCtx` and before/around the tool resolution:

```ts
  const knowledge = args.knowledge ?? null;
  const activeTools = toolsActive ? resolveActiveTools(integrationCtx, knowledge) : [];
  const activeToolDefs = toolDefs(activeTools);
  const toolsInstruction = systemPromptSegment(activeTools) ?? '';
  const knowledgeLibrariesContext = knowledge
    ? renderKnowledgeAwareness(knowledge.libraries)
    : '';
```

Add the import at the top:

```ts
import { renderKnowledgeAwareness } from '../knowledge/query-tool.js';
```

Thread the awareness into every `runStreamEngine` call inside `streamOnce`:

```ts
    streamOnce: (toolExchange, tools) =>
      runStreamEngine({
        ...args,
        toolsInstruction,
        knowledgeLibrariesContext,
        tools,
        toolExchange,
        signal: controller.signal,
        onChunk,
      }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/state/stream-manager-store.test.ts`
Then `pnpm typecheck`.
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/state/stream-manager-store.test.ts
git commit -m "Derive knowledge tool and awareness in the stream-manager

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 12: Send-path resolves and passes the knowledge context

**Files:**
- Modify: `apps/user-client/src/data/send-message.ts` (`resolvePersonaContext` + both `start`/`regenerate` call-sites)
- Test: `apps/user-client/src/data/send-message.test.ts` (extend if present; otherwise rely on Task 11's store test + manual verification — note in commit)

- [ ] **Step 1: Write the failing test (if a send-message harness exists)**

Assert that the args handed to `useStreamManagerStore.start` include a `knowledge` field built from the chat + persona libraryIds. If the suite has no such harness, skip and rely on manual verification §11.

- [ ] **Step 2: Run / confirm**

Run: `cd apps/user-client && pnpm vitest run src/data/send-message.test.ts`
Expected: FAIL (if added) or PASS-baseline (if skipped).

- [ ] **Step 3: Implement**

In `send-message.ts`, import and resolve the knowledge context. Add to `PersonaContext`:

```ts
  knowledge: import('../knowledge/query-tool.js').KnowledgeContext | null;
```

At the top:

```ts
import { buildKnowledgeContext } from '../knowledge/knowledge-context.js';
```

In `resolvePersonaContext`, before the `return`:

```ts
  const knowledge = await buildKnowledgeContext(undefined, persona, chat);
```

Add `knowledge` to the returned object. Then add `knowledge: ctx.knowledge` to BOTH the `start({...})` call (in `useSendMessage`) and the `regenerate({...})` call (in `useRegenerate`).

(If you swapped the `buildKnowledgeContext` signature in Task 8 to `(persona, chat, deps?)`, call it as `buildKnowledgeContext(persona, chat)` here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/data/send-message.test.ts`
Then `pnpm typecheck`.
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/send-message.ts apps/user-client/src/data/send-message.test.ts
git commit -m "Resolve knowledge context in the send path

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 13: Persona-editor Knowledge assignment section

**Files:**
- Create: `apps/user-client/src/components/persona-editor/KnowledgeSection.tsx`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (render the section; include `libraryIds` in the editor's draft state + save payload)
- Test: `apps/user-client/src/components/persona-editor/KnowledgeSection.test.tsx`

**First read** `persona-editor.tsx` to match its existing section pattern (how `contextWindow`/`adultPersona` are drafted and saved) and its styling primitives. Follow that pattern exactly; this task only adds a library multi-select.

- [ ] **Step 1: Write the failing test**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeSection } from './KnowledgeSection.js';

function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe('KnowledgeSection', () => {
  it('toggles a library id in and out of the selection', () => {
    const onChange = vi.fn();
    // mock useFilteredLibraries to return [{id:'a',name:'A',...},{id:'b',name:'B',...}]
    wrap(<KnowledgeSection selected={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('renders an empty-state hint when no libraries exist', () => {
    // mock useFilteredLibraries → []
    wrap(<KnowledgeSection selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/My Knowledge/i)).toBeTruthy();
  });
});
```

(Mock `useFilteredLibraries` from `../../data/knowledge.js` with `vi.mock`, matching how other component tests in this codebase mock data hooks.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/persona-editor/KnowledgeSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

A controlled component (`selected: string[]`, `onChange(next: string[])`) that lists `useFilteredLibraries()` rows with a toggle each (NSFW-filtering is already handled by `useFilteredLibraries`). Empty state links to *My Knowledge* (`/app/knowledge`). Match the editor's existing section chrome — do not invent new styling.

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { useFilteredLibraries } from '../../data/knowledge.js';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

export function KnowledgeSection({ selected, onChange }: Props) {
  const { data: libraries } = useFilteredLibraries();
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (!libraries || libraries.length === 0) {
    return (
      <p className="…match editor empty-state…">
        No knowledge libraries yet. Create one in <Link to="/app/knowledge">My Knowledge</Link>.
      </p>
    );
  }
  return (
    <ul>
      {libraries.map((lib) => (
        <li key={lib.id}>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(lib.id)}
              onChange={() => toggle(lib.id)}
            />
            {lib.name}
          </label>
        </li>
      ))}
    </ul>
  );
}
```

In `persona-editor.tsx`: add `libraryIds` to the draft state (initialise from the loaded persona's `libraryIds ?? []`), render `<KnowledgeSection selected={draft.libraryIds} onChange={(ids) => setDraft({...})} />` inside a section matching the others, and include `libraryIds` in the persona create/update payload.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/persona-editor/KnowledgeSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/persona-editor apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Add persona-editor knowledge assignment section

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 14: Cockpit knowledge affordance + ad-hoc sheet

**Files:**
- Create: `apps/user-client/src/components/chat/KnowledgeSheet.tsx`
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (knowledge button + sheet mount)
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx` (exempt `.knowledge-sheet-root` from the unpinned outside-tap close, mirroring the other sheet exemptions)
- Test: `apps/user-client/src/components/chat/KnowledgeSheet.test.tsx`

**First read** `Cockpit.tsx` and an existing sheet (e.g. the artefact picker or branch sheet) to match the bottom-sheet pattern, the `.X-sheet-root` exemption convention, and how the cockpit already mounts overlay sheets.

- [ ] **Step 1: Write the failing test**

```tsx
describe('KnowledgeSheet', () => {
  it('shows persona libraries locked-on and toggles chat libraries', () => {
    // mock useFilteredLibraries → [{id:'p',name:'Persona Lib'},{id:'c',name:'Chat Lib'}]
    const onToggleChat = vi.fn();
    render(<KnowledgeSheet personaLibraryIds={['p']} chatLibraryIds={[]} onToggleChat={onToggleChat} onClose={vi.fn()} />);
    // persona lib appears as locked (disabled control)
    expect((screen.getByLabelText('Persona Lib') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Chat Lib'));
    expect(onToggleChat).toHaveBeenCalledWith('c');
  });

  it('renders empty-state linking to My Knowledge', () => {
    // mock useFilteredLibraries → []
    render(<KnowledgeSheet personaLibraryIds={[]} chatLibraryIds={[]} onToggleChat={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/My Knowledge/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/chat/KnowledgeSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`KnowledgeSheet`: a bottom-sheet (root class `.knowledge-sheet-root`) listing `useFilteredLibraries()`. A library whose id is in `personaLibraryIds` renders **locked-on** (checked + disabled, with a subtle "from persona" hint); every other library renders a toggle reflecting `chatLibraryIds`, calling `onToggleChat(id)`. Empty state links to *My Knowledge*.

In `Cockpit.tsx`: add a compact knowledge button that opens the sheet. Wire it to the current chat: read `chat.libraryIds` and the persona's `libraryIds`; on toggle, compute the next chat list and call `useSetChatLibraries().mutate({ chatId, libraryIds })`. Give the button a subtle active marker (e.g. a count) when the effective set (`unique(persona ∪ chat)` after NSFW filter) is non-empty — reuse `computeEffectiveLibraries` for the count.

In `InteractionMode.tsx`: add `.knowledge-sheet-root` to the set of overlay roots exempt from the unpinned outside-tap handler (find where `.artefact-sheet-root`/`.lightbox-root` etc. are already exempted and add this class there).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/chat/KnowledgeSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat
git commit -m "Add cockpit knowledge affordance and ad-hoc binding sheet

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 15: Retrieval pill renders query + results

**Files:**
- Read first: the tool-call pill component (find via `rg -l "tool-call" apps/user-client/src/components`) and `apps/user-client/src/lib/tool-loop.ts` (pill payload shape)
- Modify: the tool-call pill component if its expand view is `calculate_js`-specific
- Test: the pill component's existing test (extend)

The tool-loop already creates a `tool-call` pill carrying the tool name, args, and result. `calculate_js` expands to show code + result. Confirm `query_knowledgebase` expands legibly (query + the formatted retrieval output). If the expand view hard-codes calculate_js fields, generalise it to show `args` (the query) and `result.output` for any tool.

- [ ] **Step 1: Write the failing test**

Add a case to the pill component test rendering a `query_knowledgebase` pill payload and asserting the query and a provenance line are visible when expanded:

```tsx
it('expands a query_knowledgebase pill to show the query and results', () => {
  // render the pill with payload { toolName: 'query_knowledgebase', args: { query: 'farbkraft' }, result: { output: '[Farblehre › Grundlagen]  (0.57)\\ntext' } }
  // click to expand
  expect(screen.getByText(/farbkraft/)).toBeTruthy();
  expect(screen.getByText(/Farblehre/)).toBeTruthy();
});
```

(Match the actual payload shape from `tool-loop.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run <pill test path>`
Expected: FAIL (or PASS already if the pill is generic — in which case keep the test as a regression guard and skip Step 3 changes).

- [ ] **Step 3: Implement (only if needed)**

Generalise the pill expand to render `args` + `result.output` for any tool name, with a small label per known tool (`calculate_js` → "Code"; `query_knowledgebase` → "Query"/"Results").

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run <pill test path>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components
git commit -m "Show query_knowledgebase query and results in the tool pill

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 16: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run (repo root): `pnpm typecheck`
Expected: all packages green (the project's standard count, currently 14/14).

- [ ] **Step 2: Full user-client vitest**

Run: `cd apps/user-client && pnpm vitest run`
Expected: all new tests pass; the only failures are the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline. **Verify that baseline is identical on `master`** before accepting any failure as pre-existing (per project rule).

- [ ] **Step 3: llm-unified bun test**

Run: `cd packages/llm-unified && bun test`
Expected: green (composition additions included).

- [ ] **Step 4: Build + biome**

Run (repo root): `pnpm run build` then `pnpm biome check .` (or the project's biome script)
Expected: build 9/9; biome clean.

- [ ] **Step 5: No commit** — verification only. Report results; do not squash (Liz owns the squash + STATUS update).

---

## Self-Review (run by the plan author before handing off)

**Spec coverage:**
- §2 context-tool category → Task 9 (`resolveActiveTools` third slot) ✓
- §3 Dexie v15 + deletion prune → Tasks 2, 3 ✓
- §4 retrieval flow (embed → per-library query → merge → format) → Tasks 6, 7, 8; tuning defaults in Task 8 ✓
- §5 Band-2 awareness → Tasks 1, 7 (renderer), 10, 11 (wiring) ✓
- §6.1 persona editor section → Task 13 ✓
- §6.2 cockpit sheet → Task 14 ✓
- §6.3 retrieval pill → Task 15 ✓
- §7 NSFW gating (3 layers) → Task 5 (send-time filter), 13/14 (`useFilteredLibraries` in UI), tool-gating via empty set (Tasks 7/9) ✓
- §8 error handling → Task 7 (constructive empty + try/catch); deleted-library defence → Tasks 3, 5 ✓
- §10 testing → every task is TDD; Task 16 full suite ✓

**Placeholder scan:** UI tasks (13–15) intentionally reference "match the existing pattern" with a read-first instruction because exact editor/cockpit chrome must follow live code; the component contracts, props, and test assertions are concrete. No `TBD`/`TODO`.

**Type consistency:** `KnowledgeContext` (libraries + retrieve) defined in Task 7, consumed in 8/9/11/12; `RetrievedChunk`/`LibraryMeta`/`RetrievalDeps` defined in Task 6, reused in 7/8; `knowledgeLibrariesContext` optional input defined in Task 1, set in Tasks 10/11; `libraryIds` added in Task 2, consumed in 3/5/8/12/13/14. Signatures align.
