# Knowledgebase Chunk B2 (Attach document) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach a single knowledge-library document's full content to a chat message as a first-class attachment — copy-on-write (a live reference until edited or sent), picked through an accordion-tree multi-select picker, behaving exactly like an uploaded file.

**Architecture:** Reuse the existing `attachments` pipeline (the path "Artefacts as attachments" already established). A library attachment is a normal `kind:'text'`, `origin:'library'` `AttachmentRow` carrying a `kbRef:{libraryId,documentId}`. While `text` is unset the content is read **live** from the document (copy-on-write); editing materialises a copy; sending freezes a snapshot, so sent history is decoupled from the knowledgebase (WYSIWYG). A new accordion-tree `DocumentPicker` (sibling to `ArtefactPicker`) feeds it; the cockpit `(+)` menu gains a third source.

**Tech Stack:** TypeScript (strict), React 18, Dexie, TanStack Query, Vitest (`fake-indexeddb`), Biome.

**Spec:** `superpowers/specs/2026-06-07-knowledgebase-chunk-b2-attach-document-design.md`

**Conventions for every task:**
- British English in all code, comments, copy, commit messages.
- Run a single test file with: `pnpm --filter @chatsundere/user-client test -- <path>`
- Typecheck with: `pnpm --filter @chatsundere/user-client typecheck`
- Commit message footer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
- **No Dexie version bump** — `origin` and `kbRef` are non-indexed fields (the `attachments` index stays `id, chatId, messageId, [chatId+messageId]`). Adding optional non-indexed fields needs no migration.

---

## Task 1: Data model — `origin:'library'` + `kbRef`, extend `addAttachment`

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (`AttachmentOrigin` line 138; `AttachmentRow` lines 170-192)
- Modify: `apps/user-client/src/data/attachments.ts` (`AddAttachmentInput` lines 12-21; `addAttachment` lines 24-54)
- Test: `apps/user-client/tests/unit/attachments-data.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe('attachment data ops', …)` block in `attachments-data.test.ts`:

```ts
  it('stores a library-origin attachment with a kbRef and defaults kbRef to null otherwise', async () => {
    const upload = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'plain.md',
      mime: 'text/markdown',
      text: 'hi',
    });
    const libRef = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'Doc.md',
      mime: 'text/markdown',
      origin: 'library',
      kbRef: { libraryId: 'lib1', documentId: 'doc1' },
    });
    const rows = await listPendingAttachments('c1');
    const u = rows.find((r) => r.id === upload);
    const l = rows.find((r) => r.id === libRef);
    expect(u?.origin).toBe('upload');
    expect(u?.kbRef).toBeNull();
    expect(l?.origin).toBe('library');
    expect(l?.kbRef).toEqual({ libraryId: 'lib1', documentId: 'doc1' });
    expect(l?.text).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-data.test.ts`
Expected: FAIL — `origin`/`kbRef` not accepted by `AddAttachmentInput`, `kbRef` not on the row.

- [ ] **Step 3: Extend the types** in `boot/client-data-db.ts`.

Change line 138 from:
```ts
export type AttachmentOrigin = 'upload' | 'generated';
```
to:
```ts
export type AttachmentOrigin = 'upload' | 'generated' | 'library';
```

Add this field to `AttachmentRow` (immediately after the `visionDescription?` line, before the closing brace at line 192):
```ts
  /** origin === 'library' — copy-on-write reference into the knowledgebase. While
   *  `text` is unset the content is read live from this document; editing or
   *  sending freezes a snapshot into `text`. Retained for provenance after that. */
  kbRef?: { libraryId: string; documentId: string } | null;
```

- [ ] **Step 4: Extend `AddAttachmentInput` and `addAttachment`** in `data/attachments.ts`.

Add to `AddAttachmentInput` (after `height?: number;`, line 20):
```ts
  origin?: AttachmentOrigin;
  kbRef?: { libraryId: string; documentId: string } | null;
```
Add the import of `AttachmentOrigin` to the existing type import block (lines 4-9):
```ts
  type AttachmentOrigin,
```
In `addAttachment`, change `origin: 'upload',` (line 38) to:
```ts
      origin: input.origin ?? 'upload',
```
and add, just after the `origin` line:
```ts
      kbRef: input.kbRef ?? null,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-data.test.ts`
Expected: PASS (all cases, including the new one).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/data/attachments.ts apps/user-client/tests/unit/attachments-data.test.ts
git commit -m "Add library-origin attachment kbRef to the data model

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: `addDocumentReference` + `useAddDocumentReferences`

**Files:**
- Modify: `apps/user-client/src/data/attachments.ts`
- Test: `apps/user-client/tests/unit/attachments-data.test.ts`

- [ ] **Step 1: Write the failing test** — append a new `describe` block to `attachments-data.test.ts`. Add the import at the top alongside the existing attachments imports:

```ts
import { addDocumentReference } from '../../src/data/attachments.js';
```

and the block:

```ts
describe('document references (attach document)', () => {
  it('creates a copy-on-write pending reference: no text, kbRef set, .md filename', async () => {
    const id = await addDocumentReference('c1', {
      id: 'doc1',
      libraryId: 'lib1',
      title: 'Brand Guidelines',
      content: 'the full markdown body',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 3,
      triggerPhrases: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const [row] = await listPendingAttachments('c1');
    expect(row?.id).toBe(id);
    expect(row?.origin).toBe('library');
    expect(row?.kind).toBe('text');
    expect(row?.fileName).toBe('Brand Guidelines.md');
    expect(row?.mime).toBe('text/markdown');
    expect(row?.kbRef).toEqual({ libraryId: 'lib1', documentId: 'doc1' });
    expect(row?.text).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-data.test.ts`
Expected: FAIL — `addDocumentReference` is not exported.

- [ ] **Step 3: Implement** in `data/attachments.ts`. Add `DocumentRow` to the type import from `boot/client-data-db.js`:
```ts
  type DocumentRow,
```
Add, just after `addArtefactSnapshot` (after line 70):
```ts
/**
 * Attach a knowledge-library document to the chat as a *copy-on-write* pending
 * reference: no content is copied — `kbRef` points at the live document and the
 * content is resolved live until the user edits it or the message is sent. Mirrors
 * `addArtefactSnapshot` in shape, but references instead of snapshotting.
 */
export async function addDocumentReference(chatId: string, doc: DocumentRow): Promise<string> {
  return addAttachment({
    chatId,
    kind: 'text',
    fileName: `${doc.title}.md`,
    mime: 'text/markdown',
    origin: 'library',
    kbRef: { libraryId: doc.libraryId, documentId: doc.id },
    // text intentionally omitted — copy-on-write (see snapshotPendingDocumentReferences).
  });
}
```
Add the hook near `useAddArtefactSnapshots` (after line 187):
```ts
/**
 * Mutation hook: add a batch of documents as copy-on-write references to the chat's
 * pending set, then invalidate the pending query once.
 */
export function useAddDocumentReferences(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docs: DocumentRow[]) => {
      for (const d of docs) await addDocumentReference(chatId, d);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/attachments.ts apps/user-client/tests/unit/attachments-data.test.ts
git commit -m "Add addDocumentReference + useAddDocumentReferences (copy-on-write)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Defensive materialisation on source-document delete

**Files:**
- Modify: `apps/user-client/src/data/attachments.ts`
- Modify: `apps/user-client/src/data/knowledge.ts` (`deleteDocumentCascade` lines 50-56; `deleteLibraryCascade` lines 60-80)
- Test: `apps/user-client/tests/unit/knowledge-attach-materialise.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `apps/user-client/tests/unit/knowledge-attach-materialise.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addDocumentReference, listPendingAttachments } from '../../src/data/attachments.js';
import { addDocuments, createLibrary, deleteDocumentCascade, getDocument } from '../../src/data/knowledge.js';

// The ingestion queue would otherwise try to load the embedding engine.
vi.mock('../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('defensive materialisation on document delete', () => {
  it('freezes the live content into a still-referenced pending attachment before deleting', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'body text' }]);
    const doc = await getDocument(docId as string);
    await addDocumentReference('c1', doc!);

    // Sanity: the reference carries no copied text yet.
    expect((await listPendingAttachments('c1'))[0]?.text).toBeUndefined();

    await deleteDocumentCascade(docId as string, { deleteWhere: async () => {} } as never);

    const [row] = await listPendingAttachments('c1');
    expect(row?.text).toBe('body text');
    expect(await getDocument(docId as string)).toBeUndefined();
  });

  it('leaves an already-materialised (edited) attachment untouched', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'body text' }]);
    const doc = await getDocument(docId as string);
    const attId = await addDocumentReference('c1', doc!);
    // Simulate a user edit (materialise).
    const { updateAttachmentText } = await import('../../src/data/attachments.js');
    await updateAttachmentText(attId, 'edited note');

    await deleteDocumentCascade(docId as string, { deleteWhere: async () => {} } as never);

    const [row] = await listPendingAttachments('c1');
    expect(row?.text).toBe('edited note');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/knowledge-attach-materialise.test.ts`
Expected: FAIL — `materialiseReferencesForDocument` not wired; the reference still has `text === undefined` after delete.

- [ ] **Step 3: Add the helper** in `data/attachments.ts` (after `addDocumentReference`):

```ts
/**
 * Freeze a document's content into any *pending* attachment that still references it
 * as a live copy-on-write reference (`text` unset). Called when the source document is
 * about to be deleted, so an in-progress attachment does not break. Reads the
 * attachments table directly (no knowledge.ts import) to avoid an import cycle.
 */
export async function materialiseReferencesForDocument(
  documentId: string,
  content: string,
): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.attachments, async () => {
    const refs = await db.attachments
      .filter((a) => a.messageId === null && a.kbRef?.documentId === documentId && a.text === undefined)
      .toArray();
    await Promise.all(refs.map((a) => db.attachments.update(a.id, { text: content })));
  });
}
```

- [ ] **Step 4: Wire it into the delete paths** in `data/knowledge.ts`.

Add the import (after the existing imports, around line 12):
```ts
import { materialiseReferencesForDocument } from './attachments.js';
```

Replace `deleteDocumentCascade` (lines 50-56) with:
```ts
/** Delete a document row and its vectors, materialising any pending references first. */
export async function deleteDocumentCascade(
  id: string,
  store: VectorStoreLike = getKnowledgeVectorStore(),
): Promise<void> {
  const doc = await getClientDataDb().documents.get(id);
  if (doc) await materialiseReferencesForDocument(id, doc.content);
  await deleteDocumentVectors(id, store);
  await getClientDataDb().documents.delete(id);
}
```

In `deleteLibraryCascade`, replace the loop at lines 65-67:
```ts
  const docs = await db.documents.where('libraryId').equals(id).toArray();
  for (const doc of docs) await deleteDocumentVectors(doc.id, store);
  await db.documents.where('libraryId').equals(id).delete();
```
with:
```ts
  const docs = await db.documents.where('libraryId').equals(id).toArray();
  for (const doc of docs) {
    await materialiseReferencesForDocument(doc.id, doc.content);
    await deleteDocumentVectors(doc.id, store);
  }
  await db.documents.where('libraryId').equals(id).delete();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/knowledge-attach-materialise.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Guard against an import cycle + typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean. (`attachments.ts` must NOT import from `knowledge.ts`; the dependency is one-way `knowledge.ts → attachments.ts`.)

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/data/attachments.ts apps/user-client/src/data/knowledge.ts apps/user-client/tests/unit/knowledge-attach-materialise.test.ts
git commit -m "Materialise pending document references before source delete

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Snapshot-on-send + stream-manager wiring

**Files:**
- Modify: `apps/user-client/src/data/attachments.ts`
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (import line 18; transaction line 126; before bind line 159)
- Test: `apps/user-client/tests/unit/attachments-snapshot-on-send.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `apps/user-client/tests/unit/attachments-snapshot-on-send.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addDocumentReference,
  listPendingAttachments,
  snapshotPendingDocumentReferences,
  updateAttachmentText,
} from '../../src/data/attachments.js';
import { addDocuments, createLibrary, getDocument } from '../../src/data/knowledge.js';

vi.mock('../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('snapshotPendingDocumentReferences', () => {
  it('freezes live content for unmaterialised references and leaves edited ones alone', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [refId] = await addDocuments(lib.id, [{ title: 'Ref', content: 'live body' }]);
    const [editId] = await addDocuments(lib.id, [{ title: 'Edited', content: 'original' }]);
    const refDoc = await getDocument(refId as string);
    const editDoc = await getDocument(editId as string);

    await addDocumentReference('c1', refDoc!);
    const editAtt = await addDocumentReference('c1', editDoc!);
    await updateAttachmentText(editAtt, 'my note'); // materialised

    await snapshotPendingDocumentReferences('c1');

    const rows = await listPendingAttachments('c1');
    const ref = rows.find((r) => r.kbRef?.documentId === refId);
    const edited = rows.find((r) => r.id === editAtt);
    expect(ref?.text).toBe('live body');
    expect(edited?.text).toBe('my note');
  });

  it('degrades a vanished document to empty content rather than throwing', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Gone', content: 'x' }]);
    const doc = await getDocument(docId as string);
    await addDocumentReference('c1', doc!);
    await getClientDataDb_delete(docId as string);

    await snapshotPendingDocumentReferences('c1');
    const [row] = await listPendingAttachments('c1');
    expect(row?.text).toBe('');
  });
});

// Local helper to delete the document row directly without touching attachment refs.
async function getClientDataDb_delete(id: string): Promise<void> {
  const { getClientDataDb } = await import('../../src/boot/client-data-db.js');
  await getClientDataDb().documents.delete(id);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-snapshot-on-send.test.ts`
Expected: FAIL — `snapshotPendingDocumentReferences` not exported.

- [ ] **Step 3: Implement** in `data/attachments.ts` (after `materialiseReferencesForDocument`):

```ts
/**
 * Snapshot-on-send: freeze the current live content of every still-referenced pending
 * document attachment into its row, decoupling the sent message from the knowledgebase
 * (WYSIWYG). A vanished document degrades to empty content rather than throwing. Safe to
 * call inside an existing rw transaction that scopes `attachments` + `documents` (it does
 * not open its own transaction, so it can join the send transaction).
 */
export async function snapshotPendingDocumentReferences(chatId: string): Promise<void> {
  const db = getClientDataDb();
  const refs = await db.attachments
    .where('chatId')
    .equals(chatId)
    .filter((a) => a.messageId === null && a.kbRef != null && a.text === undefined)
    .toArray();
  for (const a of refs) {
    const doc = a.kbRef ? await db.documents.get(a.kbRef.documentId) : undefined;
    await db.attachments.update(a.id, { text: doc?.content ?? '' });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-snapshot-on-send.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the send transaction** in `state/stream-manager.store.ts`.

Add `snapshotPendingDocumentReferences` to the import on line 18:
```ts
import {
  attachPendingToMessage,
  listMessageAttachments,
  snapshotPendingDocumentReferences,
} from '../data/attachments.js';
```
On line 126, add `db.documents` to the transaction scope:
```ts
    await db.transaction('rw', db.messages, db.chats, db.attachments, db.documents, async () => {
```
Immediately before `await attachPendingToMessage(args.chatId, userMessageId);` (line 159), add:
```ts
      // Snapshot-on-send: freeze any still-referenced knowledge documents so the sent
      // message is decoupled from later edits/deletes of the source (WYSIWYG).
      await snapshotPendingDocumentReferences(args.chatId);
```

- [ ] **Step 6: Typecheck + the existing stream-manager store test**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/stream-manager-store.test.ts`
Expected: clean + PASS (the added table scope and call must not regress existing send behaviour).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/data/attachments.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/unit/attachments-snapshot-on-send.test.ts
git commit -m "Snapshot pending document references on send

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Live-content resolver for the preview

**Files:**
- Modify: `apps/user-client/src/data/attachments.ts`
- Test: `apps/user-client/tests/unit/attachments-ref-contents.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `apps/user-client/tests/unit/attachments-ref-contents.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addDocumentReference, listPendingAttachments, loadPendingDocumentContents } from '../../src/data/attachments.js';
import { addDocuments, createLibrary, getDocument } from '../../src/data/knowledge.js';

vi.mock('../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('loadPendingDocumentContents', () => {
  it('maps attachment id → live content for unmaterialised references only', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'live body' }]);
    const doc = await getDocument(docId as string);
    const refAtt = await addDocumentReference('c1', doc!);

    const rows = await listPendingAttachments('c1');
    const map = await loadPendingDocumentContents(rows);
    expect(map.get(refAtt)).toBe('live body');
  });

  it('omits materialised references (text already set)', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'live body' }]);
    const doc = await getDocument(docId as string);
    const refAtt = await addDocumentReference('c1', doc!);
    const { updateAttachmentText } = await import('../../src/data/attachments.js');
    await updateAttachmentText(refAtt, 'edited');

    const rows = await listPendingAttachments('c1');
    const map = await loadPendingDocumentContents(rows);
    expect(map.has(refAtt)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-ref-contents.test.ts`
Expected: FAIL — `loadPendingDocumentContents` not exported.

- [ ] **Step 3: Implement** in `data/attachments.ts` (after `snapshotPendingDocumentReferences`):

```ts
/**
 * Resolve the live content of every still-referenced pending document attachment,
 * keyed by attachment id, so the lightbox can preview a copy-on-write document before
 * it is materialised or sent. Materialised rows (text already set) are omitted.
 */
export async function loadPendingDocumentContents(
  rows: AttachmentRow[],
): Promise<Map<string, string>> {
  const db = getClientDataDb();
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.kbRef != null && r.text === undefined) {
      const doc = await db.documents.get(r.kbRef.documentId);
      if (doc) map.set(r.id, doc.content);
    }
  }
  return map;
}
```

Add the React hook (after `usePendingAttachments`, near line 126):
```ts
/**
 * Query hook wrapping `loadPendingDocumentContents`; re-runs only when the set of
 * unmaterialised references changes (keyed by attachment+document id signature).
 */
export function usePendingDocumentContents(rows: AttachmentRow[]) {
  const sig = rows
    .filter((r) => r.kbRef != null && r.text === undefined)
    .map((r) => `${r.id}:${(r.kbRef as { documentId: string }).documentId}`)
    .join(',');
  return useQuery({
    queryKey: ['attachments', 'ref-contents', sig],
    queryFn: () => loadPendingDocumentContents(rows),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/attachments-ref-contents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/attachments.ts apps/user-client/tests/unit/attachments-ref-contents.test.ts
git commit -m "Add loadPendingDocumentContents resolver for document-reference preview

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Viewable mapping — effectiveText, provenance, library remove cap

**Files:**
- Modify: `apps/user-client/src/components/lightbox/viewable-item.ts`
- Modify: `apps/user-client/src/components/lightbox/Lightbox.tsx` (titlebar block around lines 264-343)
- Test: `apps/user-client/tests/unit/viewable-item.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `apps/user-client/tests/unit/viewable-item.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { attachmentToViewable } from '../../src/components/lightbox/viewable-item.js';

function libRow(over: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'a1',
    chatId: 'c1',
    messageId: null,
    origin: 'library',
    kind: 'text',
    fileName: 'Doc.md',
    mime: 'text/markdown',
    order: 0,
    state: 'active',
    createdAt: 0,
    kbRef: { libraryId: 'lib1', documentId: 'doc1' },
    ...over,
  };
}

describe('attachmentToViewable — library origin', () => {
  it('uses effectiveText when the row has no copied text yet, and is removable while pending', () => {
    const v = attachmentToViewable(libRow(), {
      pending: true,
      effectiveText: 'live body',
      provenance: 'My Library › Doc',
    });
    expect(v.text).toBe('live body');
    expect(v.caps.remove).toBe(true);
    expect(v.caps.editSource).toBe(true);
    expect(v.provenance).toBe('My Library › Doc');
  });

  it('prefers the row text once materialised', () => {
    const v = attachmentToViewable(libRow({ text: 'edited' }), {
      pending: true,
      effectiveText: 'live body',
    });
    expect(v.text).toBe('edited');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/viewable-item.test.ts`
Expected: FAIL — `effectiveText`/`provenance` not accepted; `remove` is false for `library` origin.

- [ ] **Step 3: Implement** in `viewable-item.ts`.

Add to the `ViewableItem` interface (after `tags?: string[];`, line 37):
```ts
  /** Human-readable origin label, e.g. "My Library › Doc" — present for library refs. */
  provenance?: string;
```

Replace the `attachmentToViewable` signature + body (lines 69-91) with:
```ts
export function attachmentToViewable(
  row: AttachmentRow,
  opts: { pending: boolean; objectUrl?: string; effectiveText?: string; provenance?: string },
): ViewableItem {
  const isText = row.kind === 'text';
  const removable = (row.origin === 'upload' || row.origin === 'library') && opts.pending;
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mime: row.mime,
    imageUrl: row.kind === 'image' ? opts.objectUrl : undefined,
    text: isText ? (opts.effectiveText ?? row.text) : undefined,
    provenance: opts.provenance,
    caps: {
      rename: true,
      remove: removable,
      copy: isText,
      download: isText,
      delete: row.origin === 'generated',
      editSource: isText && opts.pending,
      editTags: false,
    },
  };
}
```

- [ ] **Step 4: Render provenance in the lightbox** in `Lightbox.tsx`. Find the `<div className="lightbox-titlebar">` block (opens line 264). Immediately **after** that titlebar `</div>` closes (before the next sibling element in the header), add:
```tsx
            {item.provenance ? (
              <p className="lightbox-provenance" aria-label="Source">
                {item.provenance}
              </p>
            ) : null}
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/viewable-item.test.ts`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/lightbox/viewable-item.ts apps/user-client/src/components/lightbox/Lightbox.tsx apps/user-client/tests/unit/viewable-item.test.ts
git commit -m "Carry effectiveText + provenance for library attachments in the lightbox

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: Cockpit — live preview content, provenance, and the third (+) source

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Test: `apps/user-client/tests/unit/cockpit-source-menu.test.tsx`

- [ ] **Step 1: Write the failing tests** — append to `cockpit-source-menu.test.tsx`. First seed a library so the item is enabled; add the import:
```ts
import { createLibrary } from '../../src/data/knowledge';
```
Add inside the `describe('Cockpit (+) source menu', …)` block:
```ts
  it('shows a third "Attach from knowledge" item, enabled when libraries exist', async () => {
    await createLibrary({ name: 'L', description: '', nsfw: false });
    const onAttachFromLibrary = vi.fn();
    const { container, findByText } = renderCockpit({
      onAttachFromTreasury: vi.fn(),
      onAttachFromLibrary,
    });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    const item = container.querySelector('[data-source="library"]') as HTMLButtonElement;
    await findByText('Attach from knowledge');
    expect(item).toBeInTheDocument();
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onAttachFromLibrary).toHaveBeenCalledTimes(1);
  });

  it('disables the knowledge item with a tooltip when no libraries exist', () => {
    const { container } = renderCockpit({
      onAttachFromTreasury: vi.fn(),
      onAttachFromLibrary: vi.fn(),
    });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    const item = container.querySelector('[data-source="library"]') as HTMLButtonElement;
    expect(item).toBeInTheDocument();
    expect(item.disabled).toBe(true);
    expect(item.getAttribute('title')).toBe('Create a library first');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/cockpit-source-menu.test.tsx`
Expected: FAIL — no `data-source="library"` item, no `onAttachFromLibrary` prop.

- [ ] **Step 3: Implement** in `Cockpit.tsx`.

Add the import (with the other `data/attachments` imports, lines 8-14):
```ts
  usePendingDocumentContents,
```
Add the prop to `Props` (after `onAttachFromTreasury?`, line 47):
```ts
  /** Open the knowledge document picker (omitted → no "Attach from knowledge" item). */
  onAttachFromLibrary?: () => void;
```

Remove the existing `items` computation (lines 140-142) — it must move below the `allLibraries` declaration. Delete:
```ts
  const items = pending.map((row) =>
    attachmentToViewable(row, { pending: true, objectUrl: objectUrls.get(row.id) }),
  );
```

After the knowledge block (after `effectiveCount` is computed, i.e. after line 206), add:
```ts
  // Live content for copy-on-write document references (preview before send), plus a
  // provenance label sourced from the (already NSFW-filtered) library list.
  const { data: refContents } = usePendingDocumentContents(pending);
  const libraryNameById = useMemo(
    () => new Map(allLibraries.map((l) => [l.id, l.name])),
    [allLibraries],
  );
  const items = pending.map((row) => {
    const provenance = row.kbRef
      ? `${libraryNameById.get(row.kbRef.libraryId) ?? 'Library'} › ${row.fileName.replace(/\.md$/, '')}`
      : undefined;
    return attachmentToViewable(row, {
      pending: true,
      objectUrl: objectUrls.get(row.id),
      effectiveText: refContents?.get(row.id),
      provenance,
    });
  });
```

Introduce a combined source-menu flag. Replace the `(+)` button `onClick` (lines 264-267) and `aria-expanded` (line 263):
```tsx
            aria-expanded={hasSourceMenu ? sourceMenuOpen : undefined}
            onClick={() => {
              if (hasSourceMenu) setSourceMenuOpen((v) => !v);
              else fileInputRef.current?.click();
            }}
```
Just before the `return (` (e.g. after the `onToggleChatLibrary` definition, line 214), add:
```ts
  const hasSourceMenu = !!p.onAttachFromTreasury || !!p.onAttachFromLibrary;
```

Replace the source-menu render condition + body (lines 281-308). Change the guard to `hasSourceMenu`, make the Treasury item conditional, and add the knowledge item:
```tsx
          {sourceMenuOpen && hasSourceMenu ? (
            <div className="cockpit-menu" role="menu">
              <button
                type="button"
                className="cockpit-menu-item"
                role="menuitem"
                data-source="upload"
                onClick={() => {
                  setSourceMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span aria-hidden>📎</span> Upload from device
              </button>
              {p.onAttachFromTreasury ? (
                <button
                  type="button"
                  className="cockpit-menu-item"
                  role="menuitem"
                  data-source="treasury"
                  onClick={() => {
                    setSourceMenuOpen(false);
                    p.onAttachFromTreasury?.();
                  }}
                >
                  <span aria-hidden>⬡</span> Attach from Treasury
                </button>
              ) : null}
              {p.onAttachFromLibrary ? (
                <button
                  type="button"
                  className="cockpit-menu-item"
                  role="menuitem"
                  data-source="library"
                  disabled={allLibraries.length === 0}
                  title={allLibraries.length === 0 ? 'Create a library first' : undefined}
                  onClick={() => {
                    setSourceMenuOpen(false);
                    p.onAttachFromLibrary?.();
                  }}
                >
                  <span aria-hidden>❖</span> Attach from knowledge
                </button>
              ) : null}
            </div>
          ) : null}
```

- [ ] **Step 4: Run the source-menu test + the existing cockpit-attachments test**

Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/cockpit-source-menu.test.tsx`
Run: `pnpm --filter @chatsundere/user-client test -- tests/unit/cockpit-attachments.test.tsx`
Expected: PASS (both — the moved `items` must not regress attachment preview).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/tests/unit/cockpit-source-menu.test.tsx
git commit -m "Add Attach-from-knowledge source + live document preview to the cockpit

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: InteractionMode — thread the prop + sheet outside-tap exemption

**Files:**
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx` (Props line 10-27; exemption selector line 97; Cockpit usage line 174-184)

- [ ] **Step 1: Add the prop** to `InteractionMode` `Props` (after `onAttachFromTreasury?` line 26):
```ts
  onAttachFromLibrary?: () => void;
```

- [ ] **Step 2: Add the picker root to the outside-tap exemption** — line 97, change:
```ts
          '.artefact-sheet-root, .toc-sheet-root, .branch-sheet-root, .artefact-picker-root, .knowledge-sheet-root',
```
to:
```ts
          '.artefact-sheet-root, .toc-sheet-root, .branch-sheet-root, .artefact-picker-root, .knowledge-sheet-root, .document-picker-root',
```

- [ ] **Step 3: Pass it to the Cockpit** — after `onAttachFromTreasury={p.onAttachFromTreasury}` (line 184), add:
```tsx
          onAttachFromLibrary={p.onAttachFromLibrary}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/InteractionMode.tsx
git commit -m "Thread onAttachFromLibrary + exempt the document picker from outside-tap close

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: The `DocumentPicker` accordion-tree multi-select sheet

**Files:**
- Create: `apps/user-client/src/components/knowledge/DocumentPicker.tsx`
- Test: `apps/user-client/tests/components/knowledge/document-picker.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — create `apps/user-client/tests/components/knowledge/document-picker.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db';
import { DocumentPicker } from '../../../src/components/knowledge/DocumentPicker';
import { listPendingAttachments } from '../../../src/data/attachments';
import { addDocuments, createLibrary } from '../../../src/data/knowledge';

vi.mock('../../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

async function seed() {
  const sfw = await createLibrary({ name: 'Work', description: '', nsfw: false });
  await addDocuments(sfw.id, [
    { title: 'Brand', content: 'brand body' },
    { title: 'Palette', content: 'palette body' },
  ]);
  const nsfw = await createLibrary({ name: 'Private', description: '', nsfw: true });
  await addDocuments(nsfw.id, [{ title: 'Secret', content: 'secret body' }]);
  return { sfw, nsfw };
}

describe('DocumentPicker', () => {
  it('expands a library inline and attaches selected documents as references', async () => {
    await seed();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const { findByText, getByText, container } = render(
      <DocumentPicker chatId="c1" onClose={onClose} />,
      { wrapper: wrap(qc) },
    );

    // Adult mode defaults to SFW → the NSFW library is hidden.
    await findByText('Work');
    expect(container.textContent).not.toContain('Private');

    fireEvent.click(getByText('Work')); // expand the accordion group
    const brand = await findByText('Brand.md');
    fireEvent.click(brand);
    fireEvent.click(container.querySelector('.document-picker-attach') as HTMLElement);

    await waitFor(async () => {
      const pending = await listPendingAttachments('c1');
      expect(pending.map((p) => p.fileName)).toEqual(['Brand.md']);
      expect(pending[0]?.origin).toBe('library');
      expect(pending[0]?.text).toBeUndefined();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test -- tests/components/knowledge/document-picker.test.tsx`
Expected: FAIL — `DocumentPicker` does not exist.

- [ ] **Step 3: Implement** — create `apps/user-client/src/components/knowledge/DocumentPicker.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { LibraryRow } from '../../boot/client-data-db.js';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { useAddDocumentReferences } from '../../data/attachments.js';
import { listDocuments, useFilteredLibraries } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
import { HistorySearchBar } from '../history/HistorySearchBar.js';

interface Props {
  chatId: string;
  onClose: () => void;
}

/**
 * Accordion-tree picker: attach knowledge-library documents (their full content) to
 * the chat's next message. Libraries expand in place to reveal their documents (no
 * drill-down — Chris's call); selection is multi-select across libraries, mirroring the
 * Treasury ArtefactPicker. Source is all libraries, NSFW-gated via useFilteredLibraries.
 * Documents are attached as copy-on-write references regardless of embedding status.
 */
export function DocumentPicker(p: Props): JSX.Element {
  const { data: libraries = [] } = useFilteredLibraries();
  const addRefs = useAddDocumentReferences(p.chatId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function attach(): Promise<void> {
    if (selected.size === 0) return;
    const db = getClientDataDb();
    const docs = (await Promise.all([...selected].map((id) => db.documents.get(id)))).filter(
      (d): d is NonNullable<typeof d> => d != null,
    );
    if (docs.length > 0) await addRefs.mutateAsync(docs);
    p.onClose();
  }

  return (
    <div className="document-picker-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div className="document-picker-backdrop" onClick={p.onClose} />
      <aside className="document-picker" aria-label="Attach from knowledge">
        <header className="document-picker-header">
          <span className="document-picker-title">Attach from knowledge</span>
          <button
            type="button"
            className="document-picker-close"
            aria-label="Close"
            onClick={p.onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <HistorySearchBar value={query} onChange={setQuery} placeholder="Search documents…" />
        {libraries.length > 0 ? (
          <ul className="document-picker-list">
            {libraries.map((lib) => (
              <LibraryAccordion
                key={lib.id}
                library={lib}
                query={query}
                selected={selected}
                onToggle={toggle}
              />
            ))}
          </ul>
        ) : (
          <p className="document-picker-empty">No libraries yet.</p>
        )}
        <div className="document-picker-actions">
          <button
            type="button"
            className="document-picker-attach"
            disabled={selected.size === 0 || addRefs.isPending}
            onClick={() => void attach()}
          >
            Attach ({selected.size})
          </button>
        </div>
      </aside>
    </div>
  );
}

function LibraryAccordion(props: {
  library: LibraryRow;
  query: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
}): JSX.Element {
  const { library, query, selected, onToggle } = props;
  const [open, setOpen] = useState(false);
  // A search query force-opens every group so its documents load and filter.
  const expanded = open || query.trim().length > 0;
  const { data: docs = [] } = useQuery({
    queryKey: QK.documents(library.id),
    queryFn: () => listDocuments(library.id),
    enabled: expanded,
  });
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs),
    [docs, q],
  );

  return (
    <li className="document-picker-group" data-open={expanded || undefined}>
      <button
        type="button"
        className="document-picker-group-head"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="document-picker-caret" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="document-picker-group-name">{library.name}</span>
      </button>
      {expanded ? (
        filtered.length > 0 ? (
          <ul className="document-picker-docs">
            {filtered.map((d) => {
              const on = selected.has(d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className="document-picker-doc"
                    aria-pressed={on}
                    data-selected={on || undefined}
                    onClick={() => onToggle(d.id)}
                  >
                    <span className="document-picker-check" data-on={on || undefined} aria-hidden>
                      {on ? '☑' : '☐'}
                    </span>
                    <span className="document-picker-doc-name">{d.title}.md</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="document-picker-group-empty">
            {q ? 'No matches.' : 'No documents yet.'}
          </p>
        )
      ) : null}
    </li>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test -- tests/components/knowledge/document-picker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/knowledge/DocumentPicker.tsx apps/user-client/tests/components/knowledge/document-picker.test.tsx
git commit -m "Add the accordion-tree DocumentPicker (multi-select, NSFW-gated)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: Wire the picker into the chat page

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (import line 8; picker state line 79; ArtefactPicker render lines 497-503; InteractionMode props line 556-571)

- [ ] **Step 1: Add the import** (after the `ArtefactPicker` import, line 8):
```ts
import { DocumentPicker } from '../../../components/knowledge/DocumentPicker.js';
```

- [ ] **Step 2: Add picker state** (after `const [pickerOpen, setPickerOpen] = useState(false);`, line 79):
```ts
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
```

- [ ] **Step 3: Render the picker** — after the `ArtefactPicker` block (lines 497-502, the `{pickerOpen ? (…) : null}`), add (the chat-id expression matches the one `ArtefactPicker`/`InteractionMode` already use):
```tsx
      {documentPickerOpen ? (
        <DocumentPicker
          chatId={chat?.id ?? activeChatId ?? ''}
          onClose={() => setDocumentPickerOpen(false)}
        />
      ) : null}
```

- [ ] **Step 4: Pass the handler to `InteractionMode`** — after `onAttachFromTreasury={() => setPickerOpen(true)}` (line 571), add:
```tsx
          onAttachFromLibrary={() => setDocumentPickerOpen(true)}
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Run: `pnpm --filter @chatsundere/user-client build`
Expected: clean + the build emits successfully.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Wire the DocumentPicker into the chat page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 11: Styling — document picker + accordion + provenance

**Files:**
- Modify: `apps/user-client/src/index.css` (or the stylesheet where `.artefact-picker*` lives — locate with `rg -n "artefact-picker" apps/user-client/src/index.css`)

- [ ] **Step 1: Locate the artefact-picker styles**

Run: `rg -n "\.artefact-picker" apps/user-client/src/index.css`
Expected: a block of bottom-sheet styles to mirror.

- [ ] **Step 2: Add the document-picker styles** — append a parallel block (reusing the artefact-picker visual language: fixed bottom sheet, backdrop, header, list, sticky actions). Add:

```css
/* Knowledge document picker — accordion-tree, mirrors the artefact picker sheet. */
.document-picker-root { position: fixed; inset: 0; z-index: 60; }
.document-picker-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }
.document-picker {
  position: absolute; left: 0; right: 0; bottom: 0;
  max-height: 75vh; display: flex; flex-direction: column;
  background: var(--surface, #1b1726); border-top-left-radius: 16px; border-top-right-radius: 16px;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
}
.document-picker-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.document-picker-title { font-weight: 600; }
.document-picker-close { background: none; border: 0; font-size: 20px; line-height: 1; color: inherit; }
.document-picker-list { list-style: none; margin: 8px 0 0; padding: 0; overflow-y: auto; }
.document-picker-group { border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.document-picker-group-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: none; border: 0; color: inherit; padding: 10px 4px; text-align: left;
}
.document-picker-caret { width: 1em; opacity: 0.6; }
.document-picker-group-name { font-weight: 500; }
.document-picker-docs { list-style: none; margin: 0 0 6px; padding: 0 0 0 22px; }
.document-picker-doc {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: none; border: 0; color: inherit; padding: 7px 4px; text-align: left;
}
.document-picker-doc[data-selected] { background: rgba(180, 150, 255, 0.16); border-radius: 8px; }
.document-picker-check { opacity: 0.85; }
.document-picker-group-empty,
.document-picker-empty { opacity: 0.55; font-size: 13px; padding: 8px 4px; }
.document-picker-actions { margin-top: 10px; }
.document-picker-attach {
  width: 100%; padding: 11px; border-radius: 10px; border: 0;
  background: rgba(180, 150, 255, 0.28); color: inherit; font-weight: 600;
}
.document-picker-attach:disabled { opacity: 0.4; }
.lightbox-provenance { margin: 2px 0 0; font-size: 12px; opacity: 0.6; }
```
(If `--surface` is not a defined token, substitute the value the artefact-picker block uses for its sheet background.)

- [ ] **Step 3: Verify the build still compiles**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Style the document picker accordion + lightbox provenance line

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 12: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full user-client vitest**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: all new tests pass. The only acceptable failures are the known, pre-existing `cockpit-draft` / `chat-page` / `chat-route` localStorage-jsdom baseline — **verify they are identical on master** (`git stash` is not needed; compare against the documented baseline in STATUS-CLIENT-ONLY). If any *other* test fails, fix it before proceeding.

- [ ] **Step 2: Typecheck (covers tests too)**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

- [ ] **Step 3: Build**

Run: `pnpm --filter @chatsundere/user-client build`
Expected: clean.

- [ ] **Step 4: Biome**

Run: `pnpm --filter @chatsundere/user-client lint` (or the repo's biome command — `rg -n '"lint"' apps/user-client/package.json package.json`)
Expected: clean on all touched files.

- [ ] **Step 5: Report** — summarise pass/fail counts for typecheck, full vitest, build, biome. Do NOT squash or push (Liz handles that with Chris). Hand back for the holistic review + device test.

---

## Notes for the implementer

- **No Larissa path** — client-only; no auth/sync/proxy/crypto; no new network egress (the attached content rides the existing outbound text-attachment wire path).
- **Import direction is one-way:** `knowledge.ts → attachments.ts`. Never import `knowledge.ts` from `attachments.ts` (it would cycle). `attachments.ts` reads the `documents` table directly via `getClientDataDb()`.
- **Copy-on-write invariant:** `text === undefined` ⇒ live reference; `text` set ⇒ materialised. Rename never sets `text`; content-edit and send do.
- After all tasks, the full vitest run is the gate — per the standing lesson, never trust a touched-dir-only run.
```
