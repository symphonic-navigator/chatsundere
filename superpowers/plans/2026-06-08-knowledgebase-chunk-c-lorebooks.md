# Knowledgebase Chunk C (Lorebooks / phrase-triggered injection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a normalised trigger phrase appears in the current exchange, deterministically inject the matching knowledge document's full content into the prompt (budget-capped), surfaced as a transparent `kb-injection` pill — the automatic counterpart to retrieval.

**Architecture:** Mirror the Chunk B retrieval seam. A pure module `knowledge/lore.ts` (word-boundary matching + budget + formatting) feeds an I/O assembler `knowledge/lore-context.ts` (effective-library scope + document load), called per send in `data/send-message.ts`. The result threads a new Band-2 `lore` prompt segment through `buildPrompt` and a `kb-injection` pill through the stream-manager. No tool, no model decision, no new scope model, no migration.

**Tech Stack:** TypeScript (strict), React 18, Dexie, Zustand, TanStack Query; user-client tests via Vitest, `packages/llm-unified` tests via Bun's runner.

**Spec:** `superpowers/specs/2026-06-08-knowledgebase-chunk-c-lorebooks-design.md`

**Larissa:** Not required — client-only, no auth/sync/proxy/crypto, no new network egress.

---

## File Structure

**New**
- `apps/user-client/src/knowledge/lore.ts` — pure: types, `phraseMatches`, `selectLore`, `formatLore`, `KNOWLEDGE_LORE_OPTS`.
- `apps/user-client/src/knowledge/lore-context.ts` — I/O: `buildLoreContext` (effective libraries + documents → `selectLore`).
- `apps/user-client/tests/knowledge/lore.test.ts`
- `apps/user-client/tests/knowledge/lore-context.test.ts`

**Modified**
- `apps/user-client/src/lib/treasury-filter.ts` — `normalisePhraseText` + `normalisePhrases`.
- `apps/user-client/src/components/artefact/TagEditor.tsx` — optional `normalise` prop.
- `apps/user-client/src/boot/client-data-db.ts` — `triggerOnCompanion?: boolean` on `DocumentRow`.
- `apps/user-client/src/data/knowledge.ts` — extend `updateDocument`/`useUpdateDocument` patch type (no re-embed for phrases/toggle; normalise phrases).
- `packages/llm-unified/src/composition.ts` — `loreContext` input + `lore` Band-2 segment + re-order.
- `apps/user-client/src/lib/stream-engine.ts` — `loreContext` in `StartStreamArgs` → `buildPrompt`.
- `apps/user-client/src/state/stream-manager.store.ts` — thread `loreContext`/`lore`; build/seed/persist the `kb-injection` pill.
- `apps/user-client/src/data/send-message.ts` — `buildLoreContext` per send + preceding-companion extraction.
- `apps/user-client/src/components/chat/Pill.tsx` — render the `kb-injection` pill (label + expandable entries).
- `apps/user-client/src/components/knowledge/DocumentEditor.tsx` — phrase editor + companion toggle.

---

## Task 1: Phrase normalisation helpers

**Files:**
- Modify: `apps/user-client/src/lib/treasury-filter.ts`
- Test: `apps/user-client/tests/unit/treasury-filter.test.ts` (append; create if absent)

- [ ] **Step 1: Write the failing test**

Append to `apps/user-client/tests/unit/treasury-filter.test.ts` (create the file with the import if it does not exist):

```ts
import { describe, expect, it } from 'vitest';
import { normalisePhraseText, normalisePhrases } from '../../src/lib/treasury-filter.js';

describe('normalisePhraseText', () => {
  it('lowercases, trims, and collapses internal whitespace (incl. newlines)', () => {
    expect(normalisePhraseText('  Roter   Drache ')).toBe('roter drache');
    expect(normalisePhraseText('Roter\n Drache')).toBe('roter drache');
  });
});

describe('normalisePhrases', () => {
  it('normalises, drops empties, dedupes order-preserving', () => {
    expect(normalisePhrases(['Roter  Drache', 'roter drache', '  ', 'Drachenblut'])).toEqual([
      'roter drache',
      'drachenblut',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test treasury-filter`
Expected: FAIL — `normalisePhraseText`/`normalisePhrases` not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/user-client/src/lib/treasury-filter.ts`, directly below the existing `normaliseTags` function, add:

```ts
/** Normalise a single phrase: trim + lowercase + collapse all whitespace runs
 *  (incl. newlines) to one space. The whitespace-collapse is what `normaliseTags`
 *  lacks — a user typing "roter  drache" must match "roter drache". */
export function normalisePhraseText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Normalise a phrase list via `normalisePhraseText`: drop empties, dedupe
 *  (order-preserving). Used by the lore editor and the matcher. */
export function normalisePhrases(phrases: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of phrases) {
    const p = normalisePhraseText(raw);
    if (p !== '' && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test treasury-filter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/treasury-filter.ts apps/user-client/tests/unit/treasury-filter.test.ts
git commit -m "Add phrase normalisation helpers for lorebooks"
```

---

## Task 2: TagEditor optional `normalise` prop

**Files:**
- Modify: `apps/user-client/src/components/artefact/TagEditor.tsx`
- Test: `apps/user-client/tests/components/artefact/TagEditor.test.tsx` (append; create if absent)

- [ ] **Step 1: Write the failing test**

Append (or create) `apps/user-client/tests/components/artefact/TagEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagEditor } from '../../../src/components/artefact/TagEditor.js';
import { normalisePhrases } from '../../../src/lib/treasury-filter.js';

describe('TagEditor normalise prop', () => {
  it('uses the supplied normaliser (whitespace-collapsing) when adding', () => {
    const onChange = vi.fn();
    render(
      <TagEditor mode="edit" value={[]} suggestions={[]} onChange={onChange} normalise={normalisePhrases} />,
    );
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'Roter  Drache' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['roter drache']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test TagEditor`
Expected: FAIL — `normalise` not a prop; the default `normaliseTags` keeps the double space → `'roter  drache'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/user-client/src/components/artefact/TagEditor.tsx`, extend `Props` and the `add` callback:

```tsx
interface Props {
  /** 'edit' = free-text add + remove; 'pick' = choose from suggestions only. */
  mode: 'edit' | 'pick';
  value: string[];
  /** Existing tags to autocomplete / offer. */
  suggestions: string[];
  onChange: (next: string[]) => void;
  /** Normaliser applied on add. Defaults to `normaliseTags`; the lore editor
   *  passes `normalisePhrases` so internal whitespace is collapsed. */
  normalise?: (values: string[]) => string[];
}

export function TagEditor({ mode, value, suggestions, onChange, normalise = normaliseTags }: Props): JSX.Element {
  const [text, setText] = useState('');

  function add(tag: string): void {
    onChange(normalise([...value, tag]));
    setText('');
  }
```

(Leave the rest of the component unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test TagEditor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/artefact/TagEditor.tsx apps/user-client/tests/components/artefact/TagEditor.test.tsx
git commit -m "Add optional normalise prop to TagEditor"
```

---

## Task 3: Data model — `triggerOnCompanion` + no-re-embed phrase updates

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts:231-243` (DocumentRow)
- Modify: `apps/user-client/src/data/knowledge.ts:194-254` (updateDocument + useUpdateDocument)
- Test: `apps/user-client/tests/data/knowledge-libraries.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/user-client/tests/data/knowledge-libraries.test.ts` a block that exercises a phrase-only update not re-embedding. Match the file's existing setup (it already opens the test db and imports from `../../src/data/knowledge.js`). Add:

```ts
import { updateDocument } from '../../src/data/knowledge.js';

describe('updateDocument — trigger phrases', () => {
  it('a phrase/toggle-only change does NOT re-queue embedding', async () => {
    // Arrange: a ready document (reuse the file's helper that seeds a ready doc;
    // if none exists, add one via addDocuments then set embeddingStatus = 'ready').
    const db = getClientDataDb();
    const libraryId = (await createLibrary({ name: 'L', description: '', nsfw: false })).id;
    await addDocuments(libraryId, [{ title: 'D', content: 'body' }]);
    const doc = (await listDocuments(libraryId))[0];
    await db.documents.update(doc.id, { embeddingStatus: 'ready' });

    // Act: phrase-only update.
    await updateDocument(doc.id, { triggerPhrases: ['Roter  Drache'], triggerOnCompanion: true });

    // Assert: still ready (no re-embed), phrases normalised, toggle stored.
    const after = await db.documents.get(doc.id);
    expect(after?.embeddingStatus).toBe('ready');
    expect(after?.triggerPhrases).toEqual(['roter drache']);
    expect(after?.triggerOnCompanion).toBe(true);
  });

  it('a content change still re-queues embedding', async () => {
    const db = getClientDataDb();
    const libraryId = (await createLibrary({ name: 'L2', description: '', nsfw: false })).id;
    await addDocuments(libraryId, [{ title: 'D', content: 'body' }]);
    const doc = (await listDocuments(libraryId))[0];
    await db.documents.update(doc.id, { embeddingStatus: 'ready' });
    await updateDocument(doc.id, { content: 'new body' });
    const after = await db.documents.get(doc.id);
    expect(after?.embeddingStatus).toBe('pending');
  });
});
```

> Use the imports/helpers already present at the top of `knowledge-libraries.test.ts` (`getClientDataDb`, `createLibrary`, `addDocuments`, `listDocuments`). Only add what is missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test knowledge-libraries`
Expected: FAIL — `updateDocument` patch type rejects `triggerPhrases`/`triggerOnCompanion` (typecheck) and/or does not normalise.

- [ ] **Step 3: Write minimal implementation**

(a) In `apps/user-client/src/boot/client-data-db.ts`, add the field to `DocumentRow` (right after `triggerPhrases`):

```ts
  /** Reserved for Chunk C (phrase-triggered injection). No UI in Chunk A. */
  triggerPhrases: string[];
  /** Chunk C: when true, the immediately preceding companion message is also
   *  scanned for this document's trigger phrases. Non-indexed → no version bump.
   *  Absent ⇒ false (user-message-only triggering). */
  triggerOnCompanion?: boolean;
```

(b) In `apps/user-client/src/data/knowledge.ts`, import the normaliser at the top:

```ts
import { normalisePhrases } from '../lib/treasury-filter.js';
```

Replace `updateDocument` (lines 194-212) with:

```ts
/** Update a document. A `content` change re-queues embedding; everything else
 *  (title, trigger phrases, companion toggle) does not. Trigger phrases are
 *  normalised on write. */
export async function updateDocument(
  id: string,
  patch: {
    title?: string;
    content?: string;
    triggerPhrases?: string[];
    triggerOnCompanion?: boolean;
  },
): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  const normalised =
    patch.triggerPhrases !== undefined
      ? { ...patch, triggerPhrases: normalisePhrases(patch.triggerPhrases) }
      : patch;
  if (normalised.content !== undefined) {
    await db.documents.update(id, {
      ...normalised,
      embeddingStatus: 'pending',
      embeddingError: null,
      updatedAt: now,
    });
    enqueueDocument(id);
  } else {
    await db.documents.update(id, { ...normalised, updatedAt: now });
  }
}
```

Update `useUpdateDocument` (line 247) mutationFn patch type to match:

```ts
    mutationFn: (args: {
      id: string;
      patch: {
        title?: string;
        content?: string;
        triggerPhrases?: string[];
        triggerOnCompanion?: boolean;
      };
    }) => updateDocument(args.id, args.patch),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test knowledge-libraries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/data/knowledge.ts apps/user-client/tests/data/knowledge-libraries.test.ts
git commit -m "Add triggerOnCompanion field and no-re-embed phrase updates"
```

---

## Task 4: Pure lore module (matching + budget + format)

**Files:**
- Create: `apps/user-client/src/knowledge/lore.ts`
- Test: `apps/user-client/tests/knowledge/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/knowledge/lore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_LORE_OPTS,
  type LoreDocument,
  formatLore,
  phraseMatches,
  selectLore,
} from '../../src/knowledge/lore.js';

const lib = [{ id: 'L1', name: 'Story' }];
function doc(p: Partial<LoreDocument>): LoreDocument {
  return {
    id: 'd',
    libraryId: 'L1',
    title: 'Roter Drache',
    content: 'Der Rote Drache hütet das Tal.',
    triggerPhrases: ['roter drache'],
    triggerOnCompanion: false,
    createdAt: 1,
    ...p,
  };
}

describe('phraseMatches (Unicode word boundary)', () => {
  it('matches a whole word', () => {
    expect(phraseMatches('da kommt der roter drache näher', 'roter drache')).toBe(true);
  });
  it('does NOT match a substring inside a longer word (German compound)', () => {
    expect(phraseMatches('ich pflücke blumen', 'blume')).toBe(false);
  });
  it('respects umlaut boundaries', () => {
    expect(phraseMatches('müller kam', 'müller')).toBe(true);
    expect(phraseMatches('schmüller kam', 'müller')).toBe(false);
  });
  it('escapes regex metacharacters in the phrase', () => {
    expect(phraseMatches('verein blumenwiese e.v. tagt', 'blumenwiese e.v.')).toBe(true);
  });
});

describe('selectLore', () => {
  it('injects a matching document on the user message', () => {
    const r = selectLore([doc({})], lib, 'erzähl mir vom roter drache', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ libraryName: 'Story', documentTitle: 'Roter Drache' });
  });

  it('the blumenwiese-e.V. derailment case does not fire while discussing flowers', () => {
    const d = doc({ title: 'Verein', triggerPhrases: ['blumenwiese e.v.'], content: 'Vereinslore.' });
    const r = selectLore([d], lib, 'welche arten von blumen gibt es', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries).toHaveLength(0);
  });

  it('companion text only triggers when the document opts in', () => {
    const off = doc({ triggerOnCompanion: false });
    const on = doc({ id: 'd2', triggerOnCompanion: true });
    const userText = 'und dann?';
    const companion = 'Der roter drache erhob sich.';
    expect(selectLore([off], lib, userText, companion, KNOWLEDGE_LORE_OPTS).entries).toHaveLength(0);
    expect(selectLore([on], lib, userText, companion, KNOWLEDGE_LORE_OPTS).entries).toHaveLength(1);
  });

  it('orders by library order then createdAt', () => {
    const libs = [
      { id: 'L1', name: 'A' },
      { id: 'L2', name: 'B' },
    ];
    const a = doc({ id: 'a', libraryId: 'L2', title: 'A', createdAt: 5 });
    const b = doc({ id: 'b', libraryId: 'L1', title: 'B', createdAt: 9 });
    const c = doc({ id: 'c', libraryId: 'L1', title: 'C', createdAt: 2 });
    const r = selectLore([a, b, c], libs, 'der roter drache', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries.map((e) => e.documentTitle)).toEqual(['C', 'B', 'A']);
  });

  it('truncates the overflowing entry and omits the rest', () => {
    const big = doc({ id: 'big', title: 'Big', content: 'x'.repeat(20), createdAt: 1 });
    const next = doc({ id: 'nxt', title: 'Next', content: 'yyyy', createdAt: 2 });
    const r = selectLore([big, next], lib, 'der roter drache', null, {
      maxEntries: 8,
      maxTotalChars: 10,
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].injectedText).toBe(`${'x'.repeat(10)}…`);
    expect(r.truncatedCount).toBe(1);
    expect(r.omittedCount).toBe(1);
  });

  it('caps the entry count', () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      doc({ id: `d${i}`, title: `T${i}`, content: 'z', createdAt: i }),
    );
    const r = selectLore(docs, lib, 'der roter drache', null, { maxEntries: 2, maxTotalChars: 8000 });
    expect(r.entries).toHaveLength(2);
    expect(r.omittedCount).toBe(3);
  });

  it('ignores documents with no trigger phrases', () => {
    const r = selectLore([doc({ triggerPhrases: [] })], lib, 'der roter drache', null, KNOWLEDGE_LORE_OPTS);
    expect(r.entries).toHaveLength(0);
  });
});

describe('formatLore', () => {
  it('renders provenance-headed blocks, empty when none', () => {
    expect(formatLore([])).toBe('');
    const out = formatLore([{ libraryName: 'Story', documentTitle: 'Roter Drache', injectedText: 'X.' }]);
    expect(out).toContain("Relevant background from the user's knowledge:");
    expect(out).toContain('[Story › Roter Drache]\nX.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test knowledge/lore`
Expected: FAIL — module `../../src/knowledge/lore.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/user-client/src/knowledge/lore.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { normalisePhraseText } from '../lib/treasury-filter.js';

/** A knowledge document as the lore matcher needs it. */
export interface LoreDocument {
  id: string;
  libraryId: string;
  title: string;
  content: string;
  triggerPhrases: string[];
  triggerOnCompanion: boolean;
  createdAt: number;
}

/** A library reference carrying name + (implicit) order. */
export interface LoreLibraryMeta {
  id: string;
  name: string;
}

export interface LoreOptions {
  maxEntries: number;
  maxTotalChars: number;
}

/** One injected entry (post-budget, post-truncation). */
export interface LoreEntry {
  libraryName: string;
  documentTitle: string;
  injectedText: string;
}

export interface LoreResult {
  entries: LoreEntry[];
  omittedCount: number;
  truncatedCount: number;
}

/** Device-tunable lore budget (mirrors KNOWLEDGE_RETRIEVAL_OPTS). */
export const KNOWLEDGE_LORE_OPTS: LoreOptions = { maxEntries: 8, maxTotalChars: 8000 };

/** Escape regex metacharacters in a literal phrase. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a normalised phrase occurs in normalised text bounded by Unicode word
 * boundaries. NOT ASCII `\b` (that treats ö/ä/ü as non-word characters and
 * mis-bounds German words). Letters/digits on either side block a match, so
 * `blume` does not fire on `blumen`.
 */
export function phraseMatches(normalisedText: string, normalisedPhrase: string): boolean {
  if (normalisedPhrase === '') return false;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(normalisedPhrase)}(?![\\p{L}\\p{N}])`,
    'u',
  );
  return re.test(normalisedText);
}

/**
 * Select the lore to inject this turn. Each document is scanned against the
 * normalised user message; a document also sees the normalised preceding
 * companion message when its `triggerOnCompanion` is set. Matches are ordered by
 * library order then `createdAt`, then capped by the budget: whole entries until
 * the cap; the overflowing entry is truncated with an ellipsis; the rest omitted.
 */
export function selectLore(
  documents: readonly LoreDocument[],
  libraries: readonly LoreLibraryMeta[],
  userText: string,
  precedingCompanionText: string | null,
  opts: LoreOptions,
): LoreResult {
  const order = new Map(libraries.map((l, i) => [l.id, i] as const));
  const nameOf = new Map(libraries.map((l) => [l.id, l.name] as const));
  const userNorm = normalisePhraseText(userText);
  const companionNorm = precedingCompanionText ? normalisePhraseText(precedingCompanionText) : '';

  const matched = documents
    .filter((d) => order.has(d.libraryId) && d.triggerPhrases.length > 0)
    .filter((d) => {
      const scan =
        d.triggerOnCompanion && companionNorm ? `${userNorm} ${companionNorm}` : userNorm;
      return d.triggerPhrases.some((p) => phraseMatches(scan, normalisePhraseText(p)));
    })
    .sort(
      (a, b) =>
        (order.get(a.libraryId) ?? 0) - (order.get(b.libraryId) ?? 0) || a.createdAt - b.createdAt,
    );

  const entries: LoreEntry[] = [];
  let omittedCount = 0;
  let truncatedCount = 0;
  let totalChars = 0;

  for (const d of matched) {
    if (entries.length >= opts.maxEntries) {
      omittedCount++;
      continue;
    }
    const remaining = opts.maxTotalChars - totalChars;
    if (remaining <= 0) {
      omittedCount++;
      continue;
    }
    const libraryName = nameOf.get(d.libraryId) ?? '';
    if (d.content.length <= remaining) {
      entries.push({ libraryName, documentTitle: d.title, injectedText: d.content });
      totalChars += d.content.length;
    } else {
      entries.push({
        libraryName,
        documentTitle: d.title,
        injectedText: `${d.content.slice(0, remaining)}…`,
      });
      totalChars = opts.maxTotalChars;
      truncatedCount++;
    }
  }

  return { entries, omittedCount, truncatedCount };
}

/** Render the Band-2 lore segment, or '' when nothing fired. */
export function formatLore(entries: readonly LoreEntry[]): string {
  if (entries.length === 0) return '';
  const blocks = entries.map((e) => `[${e.libraryName} › ${e.documentTitle}]\n${e.injectedText}`);
  return ["Relevant background from the user's knowledge:", ...blocks].join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test knowledge/lore`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/lore.ts apps/user-client/tests/knowledge/lore.test.ts
git commit -m "Add pure lore matching, budget and formatting module"
```

---

## Task 5: Lore context assembler (effective libraries + documents)

**Files:**
- Create: `apps/user-client/src/knowledge/lore-context.ts`
- Test: `apps/user-client/tests/knowledge/lore-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/knowledge/lore-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DocumentRow, LibraryRow } from '../../src/boot/client-data-db.js';
import { buildLoreContext } from '../../src/knowledge/lore-context.js';

function lib(p: Partial<LibraryRow>): LibraryRow {
  return { id: 'L1', name: 'Story', description: '', nsfw: false, createdAt: 1, updatedAt: 1, ...p };
}
function docRow(p: Partial<DocumentRow>): DocumentRow {
  return {
    id: 'd',
    libraryId: 'L1',
    title: 'Roter Drache',
    content: 'Der Rote Drache hütet das Tal.',
    embeddingStatus: 'ready',
    embeddingError: null,
    chunkCount: 1,
    triggerPhrases: ['roter drache'],
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

const persona = { adultPersona: false, libraryIds: ['L1'] };
const chat = { libraryIds: [] as string[] };

describe('buildLoreContext', () => {
  it('returns formatted lore + result when a phrase fires in an assigned library', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(persona, chat, 'vom roter drache', null, deps);
    expect(out).not.toBeNull();
    expect(out?.loreContext).toContain('[Story › Roter Drache]');
    expect(out?.lore.entries).toHaveLength(1);
  });

  it('returns null when the library is not assigned (scope is the safety valve)', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext({ adultPersona: false, libraryIds: [] }, chat, 'roter drache', null, deps);
    expect(out).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(persona, chat, 'reden wir über das wetter', null, deps);
    expect(out).toBeNull();
  });

  it('NSFW library is excluded for a SFW persona', async () => {
    const deps = {
      listLibraries: async () => [lib({ nsfw: true })],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(persona, chat, 'roter drache', null, deps);
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test knowledge/lore-context`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/user-client/src/knowledge/lore-context.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, DocumentRow, LibraryRow, PersonaRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { computeEffectiveLibraries } from './effective-libraries.js';
import { KNOWLEDGE_LORE_OPTS, type LoreDocument, type LoreResult, formatLore, selectLore } from './lore.js';

/** Injectable I/O so matching is testable without a live db. */
export interface LoreContextDeps {
  listLibraries: () => Promise<LibraryRow[]>;
  listDocumentsInLibraries: (libraryIds: string[]) => Promise<DocumentRow[]>;
}

function liveDeps(): LoreContextDeps {
  const db = getClientDataDb();
  return {
    listLibraries: () => db.libraries.toArray(),
    listDocumentsInLibraries: (ids) => db.documents.where('libraryId').anyOf(ids).toArray(),
  };
}

export interface LoreContext {
  /** Band-2 prompt segment text. */
  loreContext: string;
  /** Pill payload source (entries + omitted/truncated counts). */
  lore: LoreResult;
}

/**
 * Build the per-send lore for a chat: effective-library-scoped (identical to
 * retrieval), phrase-matched, budgeted, formatted. `null` when nothing fired.
 */
export async function buildLoreContext(
  persona: Pick<PersonaRow, 'adultPersona' | 'libraryIds'>,
  chat: Pick<ChatRow, 'libraryIds'>,
  userText: string,
  precedingCompanionText: string | null,
  deps: LoreContextDeps = liveDeps(),
): Promise<LoreContext | null> {
  const all = await deps.listLibraries();
  const effective = computeEffectiveLibraries(
    persona.libraryIds ?? [],
    chat.libraryIds ?? [],
    all,
    persona.adultPersona,
  );
  if (effective.length === 0) return null;

  const rows = await deps.listDocumentsInLibraries(effective.map((l) => l.id));
  const loreDocs: LoreDocument[] = rows.map((d) => ({
    id: d.id,
    libraryId: d.libraryId,
    title: d.title,
    content: d.content,
    triggerPhrases: d.triggerPhrases,
    triggerOnCompanion: d.triggerOnCompanion ?? false,
    createdAt: d.createdAt,
  }));

  const result = selectLore(
    loreDocs,
    effective.map((l) => ({ id: l.id, name: l.name })),
    userText,
    precedingCompanionText,
    KNOWLEDGE_LORE_OPTS,
  );
  if (result.entries.length === 0) return null;

  return { loreContext: formatLore(result.entries), lore: result };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test knowledge/lore-context`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/knowledge/lore-context.ts apps/user-client/tests/knowledge/lore-context.test.ts
git commit -m "Add lore context assembler over effective libraries"
```

---

## Task 6: Band-2 `lore` prompt segment

**Files:**
- Modify: `packages/llm-unified/src/composition.ts`
- Test: `packages/llm-unified/src/composition.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/llm-unified/src/composition.test.ts` (it imports `buildPrompt` as the local name — match the existing test's import alias and `inputs()` helper):

```ts
  it('places the lore segment after memories and before knowledge awareness', () => {
    const out = buildPrompt(
      inputs({
        personaInstructions: 'P',
        memoryContext: 'MEM',
        loreContext: 'LORE',
        knowledgeLibrariesContext: 'KB',
      }),
      'chat',
    );
    expect(out.indexOf('MEM')).toBeLessThan(out.indexOf('LORE'));
    expect(out.indexOf('LORE')).toBeLessThan(out.indexOf('KB'));
  });

  it('omits the lore segment when empty', () => {
    const out = buildPrompt(inputs({ personaInstructions: 'P' }), 'chat');
    expect(out).toBe('P');
  });
```

> If the existing `inputs()` helper builds a fixed object, add `loreContext: ''` to its defaults so the new optional field is always present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test composition`
Expected: FAIL — `loreContext` not honoured; ordering assertion fails.

- [ ] **Step 3: Write minimal implementation**

In `packages/llm-unified/src/composition.ts`:

(a) Add to `BuildPromptInputs` (after `memoryContext`):

```ts
  /** Reserved slot — no producer yet. */
  memoryContext: string;
  /** Band-2 phrase-triggered lore (chat only); empty when nothing fired. */
  loreContext?: string;
```

(b) Add `'lore'` to the `SegmentId` union (after `'memories'`).

(c) In `SEGMENTS`, insert the lore segment after `memories` and bump `knowledgeLibraries` to order 4:

```ts
  { id: 'memories', band: 2, order: 2, jobs: CHAT_ONLY, resolve: (i) => i.memoryContext },
  { id: 'lore', band: 2, order: 3, jobs: CHAT_ONLY, resolve: (i) => i.loreContext ?? '' },
  {
    id: 'knowledgeLibraries',
    band: 2,
    order: 4,
    jobs: CHAT_ONLY,
    resolve: (i) => i.knowledgeLibrariesContext ?? '',
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test composition`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts
git commit -m "Add Band-2 lore prompt segment"
```

---

## Task 7: Thread `loreContext` through the stream engine

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts:27-54` (StartStreamArgs) and `:71-84` (buildPrompt call)
- Test: covered by Task 8's store test + Task 6; no standalone engine test needed (the engine has no isolated buildPrompt test). Verify via typecheck.

- [ ] **Step 1: Add the field + wire it**

In `apps/user-client/src/lib/stream-engine.ts`, add to `StartStreamArgs` (after `knowledgeLibrariesContext`):

```ts
  /** Band-2 knowledge-libraries awareness text (chat only); '' when none. */
  knowledgeLibrariesContext?: string;
  /** Band-2 phrase-triggered lore text (chat only); '' when nothing fired. */
  loreContext?: string;
```

In the `buildPrompt(...)` call, add the input (after `memoryContext: ''`):

```ts
      memoryContext: '',
      loreContext: args.loreContext ?? '',
      knowledgeLibrariesContext: args.knowledgeLibrariesContext ?? '',
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @chatsundere/user-client exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts
git commit -m "Thread loreContext through the stream engine"
```

---

## Task 8: Stream-manager — build, seed and persist the `kb-injection` pill

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (StartArgs `:53-71`, runIntoDraft `:306-332`, runStreamEngine call `:389-398`, persist `:434-446`)
- Test: `apps/user-client/tests/state/stream-manager-store.test.ts` (append; match existing setup)

- [ ] **Step 1: Write the failing test**

Append to `apps/user-client/tests/state/stream-manager-store.test.ts` a test that drives `start` with a `lore` result and asserts a persisted `kb-injection` pill. Reuse the file's existing `start` harness/mocks (offering, provider, fake stream). Add:

```ts
it('persists a kb-injection pill above the answer when lore fired', async () => {
  // Arrange the standard start args used elsewhere in this file, plus:
  const lore = {
    entries: [{ libraryName: 'Story', documentTitle: 'Roter Drache', injectedText: 'X.' }],
    omittedCount: 0,
    truncatedCount: 0,
  };
  await useStreamManagerStore.getState().start({ ...baseStartArgs, loreContext: 'LORE', lore });

  const db = getClientDataDb();
  const pills = await db.pills.toArray();
  const kb = pills.find((p) => p.kind === 'kb-injection');
  expect(kb).toBeDefined();
  expect((kb?.payload as { entries: unknown[] }).entries).toHaveLength(1);

  // The pill block precedes the answer text in the persisted message.
  const msg = (await db.messages.toArray()).find((m) => m.role === 'persona');
  const firstBlock = msg?.contentBlocks[0];
  expect(firstBlock).toEqual({ type: 'pill', pillId: kb?.id });
});
```

> `baseStartArgs` = whatever object the existing tests pass to `start`. If the file builds it inline per test, copy that shape and add `loreContext`/`lore`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test stream-manager-store`
Expected: FAIL — `lore`/`loreContext` not accepted; no kb pill persisted.

- [ ] **Step 3: Write minimal implementation**

(a) In `StartArgs` (the type around line 53-71), add after the `knowledge` field:

```ts
  knowledge?: import('../knowledge/query-tool.js').KnowledgeContext | null;
  /** Band-2 lore segment text for this send; '' when nothing fired. */
  loreContext?: string;
  /** Lore result driving the kb-injection pill; null/absent when nothing fired. */
  lore?: import('../knowledge/lore.js').LoreResult | null;
```

(b) In `runIntoDraft`, build the pill before the handle (after `const now = Date.now();`, before `const handle`):

```ts
  const now = Date.now();
  const controller = new AbortController();
  const lorePill: PillRow | null =
    args.lore && args.lore.entries.length > 0
      ? {
          id: uuidv7(),
          messageId: '',
          kind: 'kb-injection',
          positionHint: 'above-text',
          status: 'completed',
          payload: {
            entries: args.lore.entries,
            omittedCount: args.lore.omittedCount,
            truncatedCount: args.lore.truncatedCount,
          },
          createdAt: now,
        }
      : null;
  const handle: StreamHandle = {
    chatId: args.chatId,
    personaId: args.persona.id,
    draftMessageId,
    controller,
    status: 'streaming',
    contentBuffer: lorePill ? [{ type: 'pill', pillId: lorePill.id }] : [],
    pillBuffer: lorePill ? [lorePill] : [],
    startedAt: now,
    reusedDraft,
  };
```

(c) In the `runStreamEngine(...)` call object (around line 390), add `loreContext` after `knowledgeLibrariesContext`:

```ts
        toolsInstruction,
        knowledgeLibrariesContext,
        loreContext: args.loreContext ?? '',
        tools,
```

(d) In the `.then(async (result) => {...})` persistence block (around line 434), prepend the lore pill to both the pill rows and the final content blocks:

```ts
      const allPillRows = lorePill ? [lorePill, ...result.pillRows] : result.pillRows;
      const pillsWithMessageId = allPillRows.map((p) => ({
        ...p,
        messageId: draftMessageId,
      }));
      const finalContentBlocks = lorePill
        ? [{ type: 'pill' as const, pillId: lorePill.id }, ...result.finalContentBlocks]
        : result.finalContentBlocks;

      await db.transaction('rw', db.messages, db.pills, db.chats, async () => {
        await db.messages.update(draftMessageId, {
          contentBlocks: finalContentBlocks,
          streamingState: 'complete',
        });
        if (pillsWithMessageId.length) await db.pills.bulkAdd(pillsWithMessageId);
        await db.chats.update(args.chatId, { lastMessageAt: Date.now() });
      });
```

> `uuidv7` and `PillRow` are already imported in this file. `lorePill` is in scope inside the `.then` closure (it is declared in `runIntoDraft`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test stream-manager-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/state/stream-manager-store.test.ts
git commit -m "Build, seed and persist the kb-injection lore pill"
```

---

## Task 9: Send path — compute lore per send

**Files:**
- Modify: `apps/user-client/src/data/send-message.ts` (imports `:13-21`, useSendMessage `:236-273`, useRegenerate `:323-363`)
- Test: `apps/user-client/tests/data/send-message.test.ts` (append if the file exists; otherwise rely on the store + lore-context tests and add a focused companion-extraction unit test as below)

- [ ] **Step 1: Write the failing test**

Create/append `apps/user-client/tests/data/send-message.test.ts` with a unit test for the preceding-companion extractor (export it for testability):

```ts
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { lastCompanionText } from '../../src/data/send-message.js';

function msg(p: Partial<MessageRow>): MessageRow {
  return {
    id: 'm',
    chatId: 'c',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...p,
  };
}

describe('lastCompanionText', () => {
  it('returns the most recent complete persona message text', () => {
    const msgs = [
      msg({ id: 'a', role: 'persona', contentBlocks: [{ type: 'text', text: 'first' }], createdAt: 1 }),
      msg({ id: 'b', role: 'user', contentBlocks: [{ type: 'text', text: 'u' }], createdAt: 2 }),
      msg({ id: 'c', role: 'persona', contentBlocks: [{ type: 'text', text: 'second' }], createdAt: 3 }),
    ];
    expect(lastCompanionText(msgs)).toBe('second');
  });
  it('returns null when there is no complete persona message', () => {
    expect(lastCompanionText([msg({ role: 'user' })])).toBeNull();
    expect(lastCompanionText([msg({ streamingState: 'incomplete' })])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test send-message`
Expected: FAIL — `lastCompanionText` not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/user-client/src/data/send-message.ts`:

(a) Extend imports:

```ts
import { type ChatRow, type MessageRow, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { buildKnowledgeContext } from '../knowledge/knowledge-context.js';
import { buildLoreContext } from '../knowledge/lore-context.js';
```

(b) Add the exported helper (top-level, e.g. just below the imports):

```ts
/** The most recent complete persona message's text, or null. Used as the
 *  optional companion scan-source for lorebooks (only docs that opt in see it). */
export function lastCompanionText(messages: readonly MessageRow[]): string | null {
  const last = [...messages]
    .reverse()
    .find((m) => m.role === 'persona' && m.streamingState === 'complete');
  if (!last) return null;
  const text = last.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return text === '' ? null : text;
}
```

(c) In `useSendMessage`, after `const priorMessages = ...` (line 237) and the substitute-vision resolution, compute lore and pass it to `start`:

```ts
      const lore = await buildLoreContext(
        ctx.persona,
        ctx.chat,
        args.text,
        lastCompanionText(priorMessages),
      );

      await useStreamManagerStore.getState().start({
        // …existing fields unchanged…
        knowledge: ctx.knowledge,
        loreContext: lore?.loreContext ?? '',
        lore: lore?.lore ?? null,
        substituteVisionModel,
        substituteOneShotBase: substituteOneShotBase ?? undefined,
      });
```

(d) In `useRegenerate`, after `const priorMessages = msgs.filter(...)` (line 339) and `const ctx = await resolvePersonaContext(...)`, compute lore and pass it to `regenerate`:

```ts
      const lore = await buildLoreContext(
        ctx.persona,
        ctx.chat,
        userMessageText,
        lastCompanionText(priorMessages),
      );

      await useStreamManagerStore.getState().regenerate({
        // …existing fields unchanged…
        knowledge: ctx.knowledge,
        loreContext: lore?.loreContext ?? '',
        lore: lore?.lore ?? null,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test send-message`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/send-message.ts apps/user-client/tests/data/send-message.test.ts
git commit -m "Compute lorebook injection per send and regenerate"
```

---

## Task 10: Render the `kb-injection` pill

**Files:**
- Modify: `apps/user-client/src/components/chat/Pill.tsx`
- Test: `apps/user-client/tests/components/chat/Pill.test.tsx` (append; create if absent)

- [ ] **Step 1: Write the failing test**

Append/create `apps/user-client/tests/components/chat/Pill.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../../src/boot/client-data-db.js';
import { Pill } from '../../../src/components/chat/Pill.js';

function kbPill(): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'kb-injection',
    positionHint: 'inline',
    status: 'completed',
    payload: {
      entries: [{ libraryName: 'Story', documentTitle: 'Roter Drache', injectedText: 'Der Drache.' }],
      omittedCount: 1,
      truncatedCount: 0,
    },
    createdAt: 1,
  };
}

describe('Pill — kb-injection', () => {
  it('labels with the entry count and expands to show provenance + content', () => {
    render(<Pill row={kbPill()} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Lore · 1');
    fireEvent.click(btn);
    expect(screen.getByText('Story › Roter Drache')).toBeInTheDocument();
    expect(screen.getByText('Der Drache.')).toBeInTheDocument();
    expect(screen.getByText(/1 omitted/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test components/chat/Pill`
Expected: FAIL — label is `KB`, not expandable, no entry rendering.

- [ ] **Step 3: Write minimal implementation**

In `apps/user-client/src/components/chat/Pill.tsx`:

(a) Extend `PillPayloadShape`:

```ts
interface LoreEntryShape {
  libraryName: string;
  documentTitle: string;
  injectedText: string;
}

interface PillPayloadShape {
  name?: string;
  kbName?: string;
  expression?: string;
  argumentsJson?: string;
  result?: string;
  error?: string;
  entries?: LoreEntryShape[];
  omittedCount?: number;
  truncatedCount?: number;
}
```

(b) Update `labelFor` for kb-injection:

```ts
  if (row.kind === 'kb-injection') return `Lore · ${p?.entries?.length ?? 0}`;
```

(c) Make the kb-injection pill expandable and render its detail. Replace the `expandable` line and the detail block:

```ts
  const payload = row.payload as PillPayloadShape | undefined;
  const isLore = row.kind === 'kb-injection';
  const expandable =
    (row.kind === 'tool-call' && (!!codeOf(payload) || !!payload?.result || !!payload?.error)) ||
    (isLore && (payload?.entries?.length ?? 0) > 0);
  const code = codeOf(payload);
```

And the detail span (replace the existing `{expandable && expanded && (...)}` block body):

```tsx
      {expandable && expanded && (
        <span className="pill-detail">
          {isLore ? (
            <>
              {payload?.entries?.map((e, i) => (
                <span key={`${e.libraryName}-${e.documentTitle}-${i}`} className="pill-detail-lore">
                  <span className="pill-detail-lore-source">{`${e.libraryName} › ${e.documentTitle}`}</span>
                  <code className="pill-detail-result">{e.injectedText}</code>
                </span>
              ))}
              {(payload?.omittedCount || payload?.truncatedCount) ? (
                <span className="pill-detail-lore-note">
                  {`${payload?.truncatedCount ?? 0} truncated, ${payload?.omittedCount ?? 0} omitted (budget).`}
                </span>
              ) : null}
            </>
          ) : (
            <>
              {code !== null && <code className="pill-detail-code">{code}</code>}
              {payload?.result !== undefined && (
                <code className="pill-detail-result">{payload.result}</code>
              )}
              {payload?.error && <code className="pill-detail-error">{payload.error}</code>}
            </>
          )}
        </span>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test components/chat/Pill`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/Pill.tsx apps/user-client/tests/components/chat/Pill.test.tsx
git commit -m "Render the kb-injection lore pill with expandable entries"
```

---

## Task 11: DocumentEditor — phrase editor + companion toggle

**Files:**
- Modify: `apps/user-client/src/components/knowledge/DocumentEditor.tsx`
- Test: `apps/user-client/tests/components/knowledge/DocumentEditor.test.tsx` (append; the file already exists per repo `triggerPhrases` grep)

- [ ] **Step 1: Write the failing test**

Append to `apps/user-client/tests/components/knowledge/DocumentEditor.test.tsx` (reuse its existing render harness + db setup):

```tsx
it('edits trigger phrases and the companion toggle without re-embedding', async () => {
  // Arrange: seed a ready document via the file's existing helper, then render
  // <DocumentEditor libraryId=… documentId=… onClose=… /> inside its QueryClient wrapper.
  // (Follow the existing tests in this file for the exact harness.)

  // The companion toggle is disabled until a phrase exists.
  const toggle = screen.getByLabelText(/companion/i);
  expect(toggle).toBeDisabled();

  // Add a phrase via the chip editor.
  const input = screen.getByPlaceholderText('Add a tag…');
  fireEvent.change(input, { target: { value: 'Roter  Drache' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByText('#roter drache')).toBeInTheDocument();

  // Now the toggle is enabled; turn it on.
  expect(toggle).toBeEnabled();
  fireEvent.click(toggle);

  // Save → persists normalised phrases + toggle, stays ready (asserted via the db).
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  // …assert on the document row: triggerPhrases === ['roter drache'],
  //    triggerOnCompanion === true, embeddingStatus === 'ready'.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test DocumentEditor`
Expected: FAIL — no phrase editor / toggle in the component.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/user-client/src/components/knowledge/DocumentEditor.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TagEditor } from '../artefact/TagEditor.js';
import { getDocument, useDocuments, useUpdateDocument } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
import { normalisePhrases } from '../../lib/treasury-filter.js';

/** Full-document editor: title + content + trigger phrases + companion toggle.
 *  A content change re-queues embedding; phrase/toggle changes do not. */
export function DocumentEditor(props: {
  libraryId: string;
  documentId: string;
  onClose: () => void;
}): JSX.Element | null {
  const doc = useQuery({
    queryKey: QK.document(props.documentId),
    queryFn: () => getDocument(props.documentId),
  });
  const siblings = useDocuments(props.libraryId);
  const update = useUpdateDocument(props.libraryId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [phrases, setPhrases] = useState<string[]>([]);
  const [triggerOnCompanion, setTriggerOnCompanion] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (doc.data && !loaded) {
      setTitle(doc.data.title);
      setContent(doc.data.content);
      setPhrases(doc.data.triggerPhrases);
      setTriggerOnCompanion(doc.data.triggerOnCompanion ?? false);
      setLoaded(true);
    }
  }, [doc.data, loaded]);

  if (!doc.data) return null;

  // Phrases used by OTHER documents in the same library — lightweight reuse.
  const suggestions = Array.from(
    new Set(
      (siblings.data ?? [])
        .filter((d) => d.id !== props.documentId)
        .flatMap((d) => d.triggerPhrases),
    ),
  );

  const save = (): void => {
    const patch: {
      title?: string;
      content?: string;
      triggerPhrases?: string[];
      triggerOnCompanion?: boolean;
    } = {};
    if (title !== doc.data?.title) patch.title = title;
    if (content !== doc.data?.content) patch.content = content;
    const nextPhrases = normalisePhrases(phrases);
    if (JSON.stringify(nextPhrases) !== JSON.stringify(doc.data?.triggerPhrases)) {
      patch.triggerPhrases = nextPhrases;
    }
    if (triggerOnCompanion !== (doc.data?.triggerOnCompanion ?? false)) {
      patch.triggerOnCompanion = triggerOnCompanion;
    }
    if (Object.keys(patch).length > 0) update.mutate({ id: props.documentId, patch });
    props.onClose();
  };

  return (
    <div className="sheet-root knowledge-sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={props.onClose} />
      <dialog open className="sheet-panel" aria-label="Edit document">
        <label className="sheet-field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sheet-field">
          <span>Content</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} />
        </label>
        <div className="sheet-field">
          <span>Trigger phrases</span>
          <TagEditor
            mode="edit"
            value={phrases}
            suggestions={suggestions}
            onChange={setPhrases}
            normalise={normalisePhrases}
          />
        </div>
        <label className="sheet-field sheet-field-inline">
          <input
            type="checkbox"
            checked={triggerOnCompanion}
            disabled={phrases.length === 0}
            onChange={(e) => setTriggerOnCompanion(e.target.checked)}
            aria-label="Let the companion trigger this lore too"
            title={
              phrases.length === 0
                ? 'Add a trigger phrase first'
                : 'Also scan the companion’s last message for these phrases'
            }
          />
          <span>Let the companion trigger this too</span>
        </label>
        <div className="sheet-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
        </div>
      </dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test DocumentEditor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/knowledge/DocumentEditor.tsx apps/user-client/tests/components/knowledge/DocumentEditor.test.tsx
git commit -m "Add trigger-phrase editor and companion toggle to DocumentEditor"
```

---

## Task 12: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: all packages pass (14/14 historically).

- [ ] **Step 2: Run the user-client suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: all new tests pass; the only failures are the known unchanged `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline. **Verify that baseline is byte-identical on master** — do not accept any new failure.

- [ ] **Step 3: Run the llm-unified suite**

Run: `cd packages/llm-unified && bun test`
Expected: green (composition additions pass).

- [ ] **Step 4: Build + lint**

Run: `pnpm run build && pnpm exec biome check apps/user-client/src packages/llm-unified/src`
Expected: build 9/9; biome clean on touched files.

- [ ] **Step 5: Commit any lint fixups**

```bash
git add -A
git commit -m "Tidy lorebook lint/format" || echo "nothing to fix"
```

---

## Self-Review notes (for the implementer)

- **Spec §5 word-boundary** is Task 4's `phraseMatches` (Unicode lookarounds, not `\b`). The `blume`/`blumen` and `blumenwiese e.v.` cases are explicit tests.
- **Spec §6 ordering** (lore after memories, before awareness) is Task 6's segment order 3/4 with an ordering assertion.
- **Spec §6 pill stores the injected (post-truncation) text** — Task 8 payload uses `args.lore.entries` whose `injectedText` is already truncated by Task 4's `selectLore`.
- **Spec §7 no re-embed on phrase/toggle change** is Task 3 (re-embed stays keyed on `patch.content`) with a regression test.
- **Spec §3 shared scope** is Task 5 reusing `computeEffectiveLibraries`; the unassigned-library and NSFW cases are tested.
- **Manual verification (spec §10)** stays Chris's device pass after the suite is green.
