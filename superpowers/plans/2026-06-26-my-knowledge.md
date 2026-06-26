# My Knowledge Makeover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the "My Knowledge" room (library list → library detail → document detail) in the established design language, without touching any knowledge-base logic.

**Architecture:** A three-level page tree mirroring the My Integrations list→detail precedent, extended one level deeper. All chrome moves to design-language primitives (`PageScaffold`, `ListRow`, `Badge`, `Pill`, `Button`, `OverflowMenu`, `ConfirmDialog`, `InlineEditRow`, `InlineEditTextarea`, `TagEditor`). Metadata edits are always-save; the document page is one explicit Save with a dirty-guard. The entire knowledge-base data layer (`data/knowledge.ts`, the ingestion queue, the embedding model, the Chatsune import, NSFW filtering) is consumed verbatim — no signature changes.

**Tech Stack:** React 18 + TypeScript (strict), React Router, TanStack Query, Tailwind v4, Vitest + React Testing Library. Bun is the server runtime; the user-client runs under Vite.

## Global Constraints

- **British English** in every string, comment, identifier, and commit message (CLAUDE.md §3.7).
- **No Dexie/schema change. No migration.** `LibraryRow` / `DocumentRow` shapes are immutable here.
- **Imports use the `.js` extension** (NodeNext resolution) — e.g. `import { Badge } from '../../components/ui/Badge.js'`.
- **No `any`** without an inline justification comment (CLAUDE.md §10).
- **Out of scope, do not touch:** `components/knowledge/DocumentPicker.tsx` (chat surface) and `components/persona-editor/KnowledgeSection.tsx` (persona editor). They keep their current chrome.
- **NSFW deep-link gating stays deferred:** the library detail looks up via the **unfiltered** `useLibraries()` (current behaviour); only the **list** uses `useFilteredLibraries()`.
- **`PageBar` has no actions slot** — page-level ⋯ overflow (delete) is rendered as an `OverflowMenu` at the top of the page content area.
- **Live status needs no new wiring:** `useDocuments(libraryId)` already polls at 800 ms while any document is `pending`/`embedding`.
- **Re-embed only on content change:** `updateDocument` re-queues embedding iff `content` is present in the patch. The document page must include `content` in its patch **only when it differs from the loaded value**.
- Each test run at the gate expects the **8 Node-localStorage baseline** failures; a 9th is real. Gate commands: `pnpm typecheck --force` (14/14), full user-client `pnpm vitest run`, `pnpm build`.
- Per-task commit message: free-form imperative, ending with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Tasks are squashed into one feature commit at the end (not by a subagent).

## Reference signatures (verbatim, for all tasks)

```ts
// components/ui/PageScaffold.tsx
interface PageScaffoldProps { crumbs: Crumb[]; back: string; onHelp?: (el: HTMLElement) => void; dirty?: boolean; children: ReactNode; }
// components/ui/PageBar.tsx
interface Crumb { label: string; to?: string; }
// components/ui/ListRow.tsx
interface ListRowProps { leading?: ReactNode; title: string; subtitle?: string; trailing?: ReactNode; onOpen?: () => void; overflow?: OverflowItem[]; }
// components/ui/Badge.tsx
type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'new';
interface BadgeProps { tone?: BadgeTone; count?: number; onTile?: boolean; children?: ReactNode; }
// components/ui/Pill.tsx
interface PillProps { variant?: 'filter' | 'tag' | 'add'; active?: boolean; onClick?: () => void; onRemove?: () => void; children: ReactNode; }
// components/ui/Button.tsx
type ButtonTone = 'primary' | 'neutral' | 'destructive';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { tone?: ButtonTone; priority?: boolean; }
// components/ui/OverflowMenu.tsx
interface OverflowItem { label: string; onSelect?: () => void; disabled?: boolean; disabledReason?: string; tone?: 'default' | 'destructive'; }
interface OverflowMenuProps { items: OverflowItem[]; triggerLabel?: string; }
// components/ui/ConfirmDialog.tsx
interface ConfirmDialogProps { open: boolean; title: string; body?: ReactNode; confirmLabel: string; cancelLabel?: string; destructive?: boolean; onConfirm: () => void; onCancel: () => void; triggerRef?: React.RefObject<HTMLElement>; }
// routes/app/account/InlineEditRow.tsx
interface InlineEditRowProps { label: string; value: string; placeholder?: string; validate?: (next: string) => string | null; onSave: (next: string) => Promise<void>; }
// routes/app/settings/InlineEditTextarea.tsx
interface InlineEditTextareaProps { label: string; value: string; placeholder?: string; helper?: string; minRows?: number; onSave: (next: string) => Promise<void>; }
// components/artefact/TagEditor.tsx
interface TagEditorProps { mode: 'edit' | 'pick'; value: string[]; suggestions: string[]; onChange: (next: string[]) => void; normalise?: (values: string[]) => string[]; }
// content/help/use-help.tsx
function useHelp(key: HelpKey): { onHelp: (el: HTMLElement) => void; helpOverlay: ReactNode };

// data/knowledge.ts (consumed verbatim)
function useLibraries(): UseQueryResult<LibraryRow[]>;
function useFilteredLibraries(): UseQueryResult<LibraryRow[]>;
function useCreateLibrary(): UseMutationResult<LibraryRow, Error, Omit<LibraryRow,'id'|'createdAt'|'updatedAt'>>;
function useUpdateLibrary(): UseMutationResult<void, Error, { id: string; patch: Partial<Omit<LibraryRow,'id'|'createdAt'>> }>;
function useDeleteLibrary(): UseMutationResult<void, Error, string>;
function useDocuments(libraryId: string): UseQueryResult<DocumentRow[]>;
function useDocumentCounts(): UseQueryResult<Record<string, number>>;
function useAddDocuments(libraryId: string): UseMutationResult<string[], Error, NewDocumentInput[]>; // NewDocumentInput = { title: string; content: string }
function useUpdateDocument(libraryId: string): UseMutationResult<void, Error, { id: string; patch: { title?: string; content?: string; triggerPhrases?: string[]; triggerOnCompanion?: boolean } }>;
function useDeleteDocument(libraryId: string): UseMutationResult<void, Error, string>;
function useRetryDocument(libraryId: string): UseMutationResult<void, Error, string>;
function normalisePhrases(values: string[]): string[]; // exported from data/knowledge.ts
// data/settings.ts
function useAdultMode(): { mode: 'sfw' | 'nsfw' };

// Dexie types (boot/client-data-db.ts) — DO NOT change
interface LibraryRow { id: string; name: string; description: string; nsfw: boolean; createdAt: number; updatedAt: number; }
type EmbeddingStatus = 'pending' | 'embedding' | 'ready' | 'failed';
interface DocumentRow { id: string; libraryId: string; title: string; content: string; embeddingStatus: EmbeddingStatus; embeddingError: string | null; chunkCount: number; triggerPhrases: string[]; triggerOnCompanion?: boolean; createdAt: number; updatedAt: number; }

// Chatsune import (consumed verbatim)
function readChatsuneArchive(file: File): Promise<...>;          // lib/chatsune-import/archive-reader.js
function parseKnowledgeExport(archive): { name: string; ... };   // lib/chatsune-import/knowledge-parse.js
function importChatsuneLibrary(parsed): Promise<void>;           // data/chatsune-import.js

// Model-loading signal (components/knowledge/ModelDownloadBanner.tsx — reused as-is)
// <ModelDownloadBanner /> reads useModelProgressStore internally; render it directly.
```

**The toggle markup** (mirror persona-editor.tsx:784–797) used for the NSFW and companion toggles:

```tsx
<button
  type="button"
  aria-label="…"
  aria-pressed={on}
  disabled={disabled}
  aria-disabled={disabled}
  onClick={() => { if (!disabled) onToggle(); }}
  className={`h-6 w-12 shrink-0 rounded-full border ${on ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'} ${disabled ? 'opacity-40' : ''}`}
>
  <span className={`block h-5 w-5 rounded-full bg-paper transition-transform ${on ? 'translate-x-6' : 'translate-x-0'}`} />
</button>
```

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `apps/user-client/src/content/help/index.ts` | Add 3 `HelpKey`s + register docs | 1 |
| `apps/user-client/src/content/help/knowledge.md` | List-level help | 1 |
| `apps/user-client/src/content/help/knowledge-library.md` | Library-detail help | 1 |
| `apps/user-client/src/content/help/knowledge-document.md` | Document-detail help | 1 |
| `apps/user-client/src/routes/app/knowledge.tsx` | **Rewrite** — library list (`KnowledgeList`) | 2 |
| `apps/user-client/src/routes/app/knowledge/library.tsx` | **New** — library detail + create (`KnowledgeLibraryPage`) | 3, 4 |
| `apps/user-client/src/routes/app/knowledge/document.tsx` | **New** — document detail + create (`KnowledgeDocumentPage`) | 5 |
| `apps/user-client/src/App.tsx` | Route registration | 6 |
| `apps/user-client/src/routes/app/knowledge-library.tsx` | **Delete** (replaced by `knowledge/library.tsx`) | 6 |
| `apps/user-client/src/components/knowledge/{AddDocumentMenu,DocumentEditor,DocumentStatusBadge,NewLibrarySheet,ChatsuneLibraryImport}.tsx` | **Delete** (retired chrome) | 6 |
| `apps/user-client/tests/component/knowledge-*.test.tsx` | New test suites | 2–5 |

`components/knowledge/ModelDownloadBanner.tsx`, `components/artefact/TagEditor.tsx`, `data/knowledge.ts`, `data/chatsune-import.ts`, `lib/chatsune-import/*` are **kept** and consumed.

---

## Task 1: Knowledge help docs + help-key registration

**Files:**
- Modify: `apps/user-client/src/content/help/index.ts`
- Create: `apps/user-client/src/content/help/knowledge.md`
- Create: `apps/user-client/src/content/help/knowledge-library.md`
- Create: `apps/user-client/src/content/help/knowledge-document.md`
- Test: `apps/user-client/tests/component/knowledge-help.test.tsx`

**Interfaces:**
- Consumes: the existing `HelpKey` union and `HELP_DOCS` map in `content/help/index.ts`.
- Produces: `HelpKey` now includes `'knowledge'`, `'knowledge-library'`, `'knowledge-document'`, each with a `{ title, markdown }` entry — consumed by Tasks 2/3/5 via `useHelp('knowledge' | …)`.

- [ ] **Step 1: Read the current help registry**

Open `apps/user-client/src/content/help/index.ts` and note the exact shape of the `HelpKey` union and the `HELP_DOCS` record (how an entry maps a key to `{ title, markdown }`, and how markdown is imported — inline string vs `?raw` import). Mirror the existing convention exactly.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/user-client/tests/component/knowledge-help.test.tsx
import { describe, it, expect } from 'vitest';
import { HELP_DOCS } from '../../src/content/help/index.js';

describe('knowledge help docs', () => {
  it('registers a help entry for each My Knowledge level', () => {
    for (const key of ['knowledge', 'knowledge-library', 'knowledge-document'] as const) {
      const entry = (HELP_DOCS as Record<string, { title: string; markdown: string }>)[key];
      expect(entry, `missing help for ${key}`).toBeTruthy();
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.markdown.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-help.test.tsx`
Expected: FAIL (keys not registered).

- [ ] **Step 4: Create the three markdown docs**

`knowledge.md` (concise, British English) — explains the room: libraries hold documents the companion can search; each library is a folder of notes; adult libraries are marked and hidden in sanitised mode; create with `+ Add` or import from Chatsune.

`knowledge-library.md` — explains a library page: edit name/description here (saved automatically); mark adult only in NSFW mode; add documents by uploading `.md`/`.txt` files or writing a new one; status badges show embedding progress.

`knowledge-document.md` — explains a document page: write the title and content, then Save; trigger phrases let the companion (or you) surface this note automatically; editing the content re-indexes it.

(Author full prose in each file; keep each to a few short paragraphs. Match the tone of the existing `integrations` help doc.)

- [ ] **Step 5: Register the keys**

Add `'knowledge'`, `'knowledge-library'`, `'knowledge-document'` to the `HelpKey` union and the corresponding `{ title, markdown }` entries to `HELP_DOCS`, importing each `.md` the same way existing docs are imported.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-help.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

```bash
git add apps/user-client/src/content/help apps/user-client/tests/component/knowledge-help.test.tsx
git commit -m "Add My Knowledge help docs and register help keys

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Library list (`/app/knowledge`)

**Files:**
- Modify (rewrite): `apps/user-client/src/routes/app/knowledge.tsx`
- Test: `apps/user-client/tests/component/knowledge-list.test.tsx`

**Interfaces:**
- Consumes: `useFilteredLibraries`, `useDocumentCounts`, the Chatsune import functions, `useHelp('knowledge')`, primitives.
- Produces: `export function KnowledgeList(): JSX.Element` (name unchanged — `App.tsx` already imports it). Navigates to `/app/knowledge/new` and `/app/knowledge/:id`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/knowledge-list.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { libsMock, countsMock } = vi.hoisted(() => ({
  libsMock: vi.fn(),
  countsMock: vi.fn(),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => libsMock(),
  useDocumentCounts: () => countsMock(),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { KnowledgeList } from '../../src/routes/app/knowledge.js';

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/app/knowledge']}>
      <Routes>
        <Route path="/app/knowledge" element={<KnowledgeList />} />
        <Route path="/app/knowledge/new" element={<div>create library screen</div>} />
        <Route path="/app/knowledge/:id" element={<div>library screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libsMock.mockReturnValue({ data: [] });
  countsMock.mockReturnValue({ data: {} });
});

describe('KnowledgeList', () => {
  it('shows the empty state and the Add affordance when there are no libraries', () => {
    wrap();
    expect(screen.getByText(/no libraries yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('renders a row per library with the NSFW badge and a document count', () => {
    libsMock.mockReturnValue({
      data: [
        { id: 'a', name: 'Lore', description: 'Worldbuilding', nsfw: false, createdAt: 1, updatedAt: 1 },
        { id: 'b', name: 'Adult', description: '', nsfw: true, createdAt: 1, updatedAt: 1 },
      ],
    });
    countsMock.mockReturnValue({ data: { a: 12, b: 3 } });
    wrap();
    expect(screen.getByText('Lore')).toBeInTheDocument();
    expect(screen.getByText('Worldbuilding')).toBeInTheDocument();
    expect(screen.getByText(/12 docs/i)).toBeInTheDocument();
    expect(screen.getByText('NSFW')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-list.test.tsx`
Expected: FAIL (current `KnowledgeList` renders the old chrome — no "no libraries yet" / "docs" text in the new shape).

- [ ] **Step 3: Rewrite the component**

```tsx
// apps/user-client/src/routes/app/knowledge.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { ListRow } from '../../components/ui/ListRow.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { OverflowMenu } from '../../components/ui/OverflowMenu.js';
import { useFilteredLibraries, useDocumentCounts } from '../../data/knowledge.js';
import { useHelp } from '../../content/help/use-help.js';
import { QK } from '../../data/queryKeys.js';
import { readChatsuneArchive } from '../../lib/chatsune-import/archive-reader.js';
import { parseKnowledgeExport } from '../../lib/chatsune-import/knowledge-parse.js';
import { importChatsuneLibrary } from '../../data/chatsune-import.js';
import { toastStore } from '../../state/toast.store.js';

export function KnowledgeList(): JSX.Element {
  const navigate = useNavigate();
  const libraries = useFilteredLibraries();
  const counts = useDocumentCounts();
  const { onHelp, helpOverlay } = useHelp('knowledge');
  const qc = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function onPickImport(file: File): Promise<void> {
    setImportError(null);
    try {
      const archive = await readChatsuneArchive(file);
      const parsed = parseKnowledgeExport(archive);
      await importChatsuneLibrary(parsed);
      await qc.invalidateQueries({ queryKey: QK.libraries });
      await qc.invalidateQueries({ queryKey: QK.documentCounts });
      toastStore.show({
        message: `Imported the "${parsed.name}" library — its documents are re-embedding now.`,
        tone: 'success',
        durationMs: 3500,
      });
    } catch (e) {
      setImportError((e as Error).message);
    }
  }

  const rows = libraries.data ?? [];

  return (
    <PageScaffold crumbs={[{ label: 'My Knowledge' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <input
        ref={importRef}
        type="file"
        accept=".gz,.tgz,application/gzip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickImport(f);
          e.target.value = '';
        }}
      />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <div className="flex items-center justify-between gap-3">
          <Button tone="primary" onClick={() => navigate('/app/knowledge/new')}>
            + Add
          </Button>
          <OverflowMenu
            items={[{ label: 'Import from Chatsune', onSelect: () => importRef.current?.click() }]}
          />
        </div>
        {importError ? (
          <p className="text-[11px] text-amber-300/80">Import failed: {importError}</p>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-paper-soft">No libraries yet — create one to add documents.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((lib) => (
              <ListRow
                key={lib.id}
                title={lib.name}
                subtitle={lib.description || undefined}
                trailing={
                  <span className="flex items-center gap-2">
                    {lib.nsfw ? <Badge tone="danger">NSFW</Badge> : null}
                    <Badge tone="neutral">{counts.data?.[lib.id] ?? 0} docs</Badge>
                  </span>
                }
                onOpen={() => navigate(`/app/knowledge/${lib.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean (old imports in `knowledge.tsx` removed; the now-unused `components/knowledge/*` are still referenced by `App.tsx`/`knowledge-library.tsx` and are deleted in Task 6).

```bash
git add apps/user-client/src/routes/app/knowledge.tsx apps/user-client/tests/component/knowledge-list.test.tsx
git commit -m "Rebuild the My Knowledge library list in the design language

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Library detail shell — metadata, create, delete (`/app/knowledge/library.tsx`)

**Files:**
- Create: `apps/user-client/src/routes/app/knowledge/library.tsx`
- Test: `apps/user-client/tests/component/knowledge-library.test.tsx`

**Interfaces:**
- Consumes: `useLibraries` (unfiltered lookup), `useCreateLibrary`, `useUpdateLibrary`, `useDeleteLibrary`, `useAdultMode`, `useHelp('knowledge-library')`, `InlineEditRow`, `InlineEditTextarea`, primitives.
- Produces: `export function KnowledgeLibraryPage(): JSX.Element`. Branches on `useParams().libraryId`: absent → create mode; present → edit mode. The **Documents section** is a placeholder here, filled in Task 4.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/knowledge-library.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { libsMock, createMock, updateMock, deleteMock, adultMock, docsMock } = vi.hoisted(() => ({
  libsMock: vi.fn(),
  createMock: vi.fn(() => ({ mutateAsync: vi.fn() })),
  updateMock: vi.fn(() => ({ mutateAsync: vi.fn() })),
  deleteMock: vi.fn(() => ({ mutate: vi.fn() })),
  adultMock: vi.fn(() => ({ mode: 'nsfw' })),
  docsMock: vi.fn(() => ({ data: [] })),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useLibraries: () => libsMock(),
  useCreateLibrary: () => createMock(),
  useUpdateLibrary: () => updateMock(),
  useDeleteLibrary: () => deleteMock(),
  useDocuments: () => docsMock(),
  useAddDocuments: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/settings.js', () => ({ useAdultMode: () => adultMock() }));
vi.mock('../../src/content/help/use-help.js', () => ({ useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }) }));

import { KnowledgeLibraryPage } from '../../src/routes/app/knowledge/library.js';

function wrapAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/knowledge" element={<div>list screen</div>} />
        <Route path="/app/knowledge/new" element={<KnowledgeLibraryPage />} />
        <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libsMock.mockReturnValue({
    data: [{ id: 'a', name: 'Lore', description: 'World', nsfw: false, createdAt: 1, updatedAt: 1 }],
    isLoading: false,
  });
  adultMock.mockReturnValue({ mode: 'nsfw' });
});

describe('KnowledgeLibraryPage', () => {
  it('create mode offers a name field and an explicit Create action', () => {
    wrapAt('/app/knowledge/new');
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('edit mode seeds the inline name field from the loaded library', () => {
    wrapAt('/app/knowledge/a');
    expect(screen.getByDisplayValue('Lore')).toBeInTheDocument();
  });

  it('shows a calm notice for an unknown library id', () => {
    wrapAt('/app/knowledge/zzz');
    expect(screen.getByText(/can.?t find that library/i)).toBeInTheDocument();
  });

  it('disables the NSFW toggle with a reason in SFW mode', () => {
    adultMock.mockReturnValue({ mode: 'sfw' });
    wrapAt('/app/knowledge/a');
    expect(screen.getByRole('button', { name: /adult library/i })).toBeDisabled();
    expect(screen.getByText(/switch to nsfw mode/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-library.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the page (create branch + edit branch + delete; Documents section stubbed)**

```tsx
// apps/user-client/src/routes/app/knowledge/library.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Button } from '../../../components/ui/Button.js';
import { OverflowMenu } from '../../../components/ui/OverflowMenu.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { InlineEditRow } from '../account/InlineEditRow.js';
import { InlineEditTextarea } from '../settings/InlineEditTextarea.js';
import {
  useLibraries,
  useCreateLibrary,
  useUpdateLibrary,
  useDeleteLibrary,
} from '../../../data/knowledge.js';
import { useAdultMode } from '../../../data/settings.js';
import { useHelp } from '../../../content/help/use-help.js';
import type { LibraryRow } from '../../../boot/client-data-db.js';

export function KnowledgeLibraryPage(): JSX.Element {
  const { libraryId } = useParams();
  return libraryId ? <EditLibrary libraryId={libraryId} /> : <CreateLibrary />;
}

function NsfwToggle(props: {
  on: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { mode } = useAdultMode();
  const disabled = mode === 'sfw';
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm text-paper">Adult library</div>
        {disabled ? (
          <p className="text-[11px] text-paper-soft">Switch to NSFW mode to mark this adult.</p>
        ) : (
          <p className="text-[11px] text-paper-soft">
            Marked libraries are hidden while sanitised mode is active.
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Adult library"
        aria-pressed={props.on}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => { if (!disabled) props.onToggle(); }}
        className={`h-6 w-12 shrink-0 rounded-full border ${
          props.on ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
        } ${disabled ? 'opacity-40' : ''}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
            props.on ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function CreateLibrary(): JSX.Element {
  const navigate = useNavigate();
  const create = useCreateLibrary();
  const { onHelp, helpOverlay } = useHelp('knowledge-library');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nsfw, setNsfw] = useState(false);

  async function onCreate(): Promise<void> {
    const row = await create.mutateAsync({ name: name.trim(), description: description.trim(), nsfw });
    navigate(`/app/knowledge/${row.id}`);
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: 'New library' }]}
      back="/app/knowledge"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Worldbuilding"
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>
        <NsfwToggle on={nsfw} onToggle={() => setNsfw((v) => !v)} />
        <div>
          <Button tone="primary" onClick={() => void onCreate()} disabled={name.trim().length === 0}>
            Create library
          </Button>
        </div>
      </div>
    </PageScaffold>
  );
}

function EditLibrary(props: { libraryId: string }): JSX.Element {
  const navigate = useNavigate();
  const libraries = useLibraries();
  const update = useUpdateLibrary();
  const del = useDeleteLibrary();
  const { onHelp, helpOverlay } = useHelp('knowledge-library');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const existing: LibraryRow | undefined = libraries.data?.find((l) => l.id === props.libraryId);

  if (libraries.isLoading) {
    return (
      <PageScaffold crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: '…' }]} back="/app/knowledge">
        <p className="px-4 pt-2 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }
  if (!existing) {
    return (
      <PageScaffold crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: 'Not found' }]} back="/app/knowledge">
        <p className="px-4 pt-2 text-sm text-paper-soft">
          We can&apos;t find that library — it may have been deleted. Head back to My Knowledge.
        </p>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: existing.name }]}
      back="/app/knowledge"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-5 px-4 pb-8 pt-2">
        <div className="flex justify-end">
          <OverflowMenu
            items={[
              {
                label: 'Delete library',
                tone: 'destructive',
                onSelect: () => setConfirmDelete(true),
              },
            ]}
          />
        </div>

        <InlineEditRow
          label="Name"
          value={existing.name}
          validate={(v) => (v.trim().length === 0 ? 'Name cannot be empty' : null)}
          onSave={(v) => update.mutateAsync({ id: existing.id, patch: { name: v.trim() } })}
        />
        <InlineEditTextarea
          label="Description"
          value={existing.description}
          minRows={2}
          onSave={(v) => update.mutateAsync({ id: existing.id, patch: { description: v.trim() } })}
        />
        <NsfwToggle
          on={existing.nsfw}
          onToggle={() => void update.mutateAsync({ id: existing.id, patch: { nsfw: !existing.nsfw } })}
        />

        {/* Documents section — filled in Task 4 */}
        <section className="flex flex-col gap-2" data-testid="documents-section">
          <h2 className="font-display text-sm text-paper">Documents</h2>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${existing.name}?`}
        body="The library and all its documents are removed. Personas lose access to its knowledge."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          del.mutate(existing.id);
          navigate('/app/knowledge');
        }}
      />
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-library.test.tsx`
Expected: PASS (4 tests). If `InlineEditRow`/`InlineEditTextarea` render their value in an `<input>`/`<textarea>` whose label is not wired via `htmlFor`, adjust the test's query to match how those primitives expose their value (check the primitive source) — keep the assertion on the seeded value.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

```bash
git add apps/user-client/src/routes/app/knowledge/library.tsx apps/user-client/tests/component/knowledge-library.test.tsx
git commit -m "Add My Knowledge library detail with always-save metadata and create mode

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Documents section in the library detail

**Files:**
- Modify: `apps/user-client/src/routes/app/knowledge/library.tsx` (replace the stubbed Documents section in `EditLibrary`)
- Test: `apps/user-client/tests/component/knowledge-library-documents.test.tsx`

**Interfaces:**
- Consumes: `useDocuments(libraryId)`, `useAddDocuments(libraryId)`, `ModelDownloadBanner`, `Badge`, `ListRow`, `OverflowMenu`.
- Produces: the live Documents list inside `EditLibrary`; `+ Add ▾` overflow (Upload files / New document); upload-failure notice. Navigates to `/app/knowledge/:libraryId/new` and `/app/knowledge/:libraryId/:documentId`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/knowledge-library-documents.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { libsMock, docsMock, addMock } = vi.hoisted(() => ({
  libsMock: vi.fn(),
  docsMock: vi.fn(),
  addMock: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useLibraries: () => libsMock(),
  useCreateLibrary: () => ({ mutateAsync: vi.fn() }),
  useUpdateLibrary: () => ({ mutateAsync: vi.fn() }),
  useDeleteLibrary: () => ({ mutate: vi.fn() }),
  useDocuments: () => docsMock(),
  useAddDocuments: () => addMock(),
}));
vi.mock('../../src/data/settings.js', () => ({ useAdultMode: () => ({ mode: 'nsfw' }) }));
vi.mock('../../src/content/help/use-help.js', () => ({ useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }) }));
vi.mock('../../src/components/knowledge/ModelDownloadBanner.js', () => ({ ModelDownloadBanner: () => null }));

import { KnowledgeLibraryPage } from '../../src/routes/app/knowledge/library.js';

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/app/knowledge/a']}>
      <Routes>
        <Route path="/app/knowledge" element={<div>list</div>} />
        <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
        <Route path="/app/knowledge/:libraryId/new" element={<div>new doc</div>} />
        <Route path="/app/knowledge/:libraryId/:documentId" element={<div>doc</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libsMock.mockReturnValue({
    data: [{ id: 'a', name: 'Lore', description: '', nsfw: false, createdAt: 1, updatedAt: 1 }],
    isLoading: false,
  });
});

describe('Library detail — documents section', () => {
  it('shows the empty state when the library has no documents', () => {
    docsMock.mockReturnValue({ data: [] });
    wrap();
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('renders a row per document with its status badge', () => {
    docsMock.mockReturnValue({
      data: [
        { id: 'd1', libraryId: 'a', title: 'Map', content: 'x', embeddingStatus: 'ready', embeddingError: null, chunkCount: 1, triggerPhrases: [], createdAt: 1, updatedAt: 1 },
        { id: 'd2', libraryId: 'a', title: 'Lore', content: 'y', embeddingStatus: 'failed', embeddingError: 'boom', chunkCount: 0, triggerPhrases: [], createdAt: 1, updatedAt: 1 },
      ],
    });
    wrap();
    expect(screen.getByText('Map')).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-library-documents.test.tsx`
Expected: FAIL (stub section has no documents UI).

- [ ] **Step 3: Implement the Documents section**

In `library.tsx`, add the status-label helper and a file-input ref + handlers to `EditLibrary`, and replace the stubbed `<section data-testid="documents-section">` with the real list. Add imports for `useRef`, `useNavigate` (already present), `useDocuments`, `useAddDocuments`, `ListRow`, `Badge`, and `ModelDownloadBanner`.

```tsx
// add near the other imports in library.tsx
import { useRef } from 'react';
import { ListRow } from '../../../components/ui/ListRow.js';
import { Badge } from '../../../components/ui/Badge.js';
import { useDocuments, useAddDocuments } from '../../../data/knowledge.js';
import { ModelDownloadBanner } from '../../../components/knowledge/ModelDownloadBanner.js';
import type { DocumentRow, EmbeddingStatus } from '../../../boot/client-data-db.js';

const STATUS_LABEL: Record<EmbeddingStatus, string> = {
  pending: 'Pending',
  embedding: 'Embedding…',
  ready: 'Ready',
  failed: 'Failed',
};
const STATUS_TONE: Record<EmbeddingStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  embedding: 'warning',
  ready: 'success',
  failed: 'danger',
};

async function readTextFiles(files: FileList): Promise<{ ok: { title: string; content: string }[]; failed: string[] }> {
  const ok: { title: string; content: string }[] = [];
  const failed: string[] = [];
  for (const file of Array.from(files)) {
    try {
      const content = await file.text();
      if (content.trim().length === 0) { failed.push(file.name); continue; }
      ok.push({ title: file.name.replace(/\.(md|markdown|txt)$/i, ''), content });
    } catch {
      failed.push(file.name);
    }
  }
  return { ok, failed };
}
```

Inside `EditLibrary`, after the existing hooks:

```tsx
  const docs = useDocuments(props.libraryId);
  const addDocs = useAddDocuments(props.libraryId);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onUpload(files: FileList): Promise<void> {
    setUploadError(null);
    const { ok, failed } = await readTextFiles(files);
    if (ok.length > 0) await addDocs.mutateAsync(ok);
    if (failed.length > 0) {
      setUploadError(`Could not read: ${failed.join(', ')}. Only non-empty .md/.markdown/.txt files are supported.`);
    }
  }

  const documents: DocumentRow[] = docs.data ?? [];
```

Replace the stubbed section with:

```tsx
        <ModelDownloadBanner />

        <input
          ref={uploadRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void onUpload(e.target.files);
            e.target.value = '';
          }}
        />

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm text-paper">Documents</h2>
            <OverflowMenu
              triggerLabel="Add ▾"
              items={[
                { label: 'Upload files', onSelect: () => uploadRef.current?.click() },
                { label: 'New document', onSelect: () => navigate(`/app/knowledge/${existing.id}/new`) },
              ]}
            />
          </div>
          {uploadError ? <p className="text-[11px] text-amber-300/80">{uploadError}</p> : null}
          {documents.length === 0 ? (
            <p className="text-sm text-paper-soft">No documents yet — add one by upload or paste.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {documents.map((doc) => (
                <ListRow
                  key={doc.id}
                  title={doc.title}
                  trailing={<Badge tone={STATUS_TONE[doc.embeddingStatus]}>{STATUS_LABEL[doc.embeddingStatus]}</Badge>}
                  onOpen={() => navigate(`/app/knowledge/${existing.id}/${doc.id}`)}
                />
              ))}
            </div>
          )}
        </section>
```

Note: `OverflowMenu` renders its trigger; confirm whether `triggerLabel` shows visible text or only an aria-label. If it only sets the aria-label (⋯ glyph trigger), the "Add ▾" intent is still met for screen readers; if a visible "Add ▾" is required and `triggerLabel` is aria-only, render a `Button` that toggles a small menu instead — but prefer `OverflowMenu` if `triggerLabel` is visible. (The list test asserts a button with an accessible name matching `/add/i`, which `triggerLabel="Add ▾"` satisfies either way.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-library-documents.test.tsx`
Expected: PASS. Also re-run Task 3's suite to confirm no regression:
Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-library.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

```bash
git add apps/user-client/src/routes/app/knowledge/library.tsx apps/user-client/tests/component/knowledge-library-documents.test.tsx
git commit -m "Add the documents section to the My Knowledge library detail

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Document detail + create page (`/app/knowledge/document.tsx`)

**Files:**
- Create: `apps/user-client/src/routes/app/knowledge/document.tsx`
- Test: `apps/user-client/tests/component/knowledge-document.test.tsx`

**Interfaces:**
- Consumes: `useDocuments(libraryId)` (find current + sibling suggestions), `useAddDocuments`, `useUpdateDocument`, `useDeleteDocument`, `useRetryDocument`, `normalisePhrases`, `TagEditor`, `ModelDownloadBanner`, primitives, `useHelp('knowledge-document')`.
- Produces: `export function KnowledgeDocumentPage(): JSX.Element`. Branches on `useParams().documentId`: absent → create; present → edit. Whole page is one explicit Save with `dirty` passed to `PageScaffold`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/component/knowledge-document.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { docsMock, addMock, updateMock, deleteMock, retryMock } = vi.hoisted(() => ({
  docsMock: vi.fn(),
  addMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(() => ({ mutate: vi.fn() })),
  retryMock: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useDocuments: () => docsMock(),
  useAddDocuments: () => ({ mutateAsync: addMock }),
  useUpdateDocument: () => ({ mutateAsync: updateMock }),
  useDeleteDocument: () => deleteMock(),
  useRetryDocument: () => retryMock(),
  normalisePhrases: (v: string[]) => v.map((s) => s.trim().toLowerCase()).filter(Boolean),
}));
vi.mock('../../src/content/help/use-help.js', () => ({ useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }) }));
vi.mock('../../src/components/knowledge/ModelDownloadBanner.js', () => ({ ModelDownloadBanner: () => null }));

import { KnowledgeDocumentPage } from '../../src/routes/app/knowledge/document.js';

const READY_DOC = { id: 'd1', libraryId: 'a', title: 'Map', content: 'old body', embeddingStatus: 'ready', embeddingError: null, chunkCount: 1, triggerPhrases: ['atlas'], triggerOnCompanion: false, createdAt: 1, updatedAt: 1 };
const FAILED_DOC = { ...READY_DOC, id: 'd2', title: 'Bad', embeddingStatus: 'failed', embeddingError: 'embed boom' };

function wrapAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/knowledge/:libraryId" element={<div>library screen</div>} />
        <Route path="/app/knowledge/:libraryId/new" element={<KnowledgeDocumentPage />} />
        <Route path="/app/knowledge/:libraryId/:documentId" element={<KnowledgeDocumentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  docsMock.mockReturnValue({ data: [READY_DOC, FAILED_DOC], isLoading: false });
  addMock.mockResolvedValue(['new-id']);
  updateMock.mockResolvedValue(undefined);
});

describe('KnowledgeDocumentPage', () => {
  it('edit mode seeds title and content from the loaded document', () => {
    wrapAt('/app/knowledge/a/d1');
    expect(screen.getByDisplayValue('Map')).toBeInTheDocument();
    expect(screen.getByDisplayValue('old body')).toBeInTheDocument();
  });

  it('a title-only edit saves without sending content (no re-embed)', async () => {
    const user = userEvent.setup();
    wrapAt('/app/knowledge/a/d1');
    const title = screen.getByDisplayValue('Map');
    await user.clear(title);
    await user.type(title, 'Atlas');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(updateMock).toHaveBeenCalledWith({ id: 'd1', patch: expect.not.objectContaining({ content: expect.anything() }) });
    expect(updateMock).toHaveBeenCalledWith({ id: 'd1', patch: expect.objectContaining({ title: 'Atlas' }) });
  });

  it('a content edit includes content in the patch (re-embed)', async () => {
    const user = userEvent.setup();
    wrapAt('/app/knowledge/a/d1');
    const body = screen.getByDisplayValue('old body');
    await user.clear(body);
    await user.type(body, 'new body');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(updateMock).toHaveBeenCalledWith({ id: 'd1', patch: expect.objectContaining({ content: 'new body' }) });
  });

  it('shows the failure cause and a Retry control on a failed document', () => {
    wrapAt('/app/knowledge/a/d2');
    expect(screen.getByText(/embed boom/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('disables the companion toggle with a reason when there are no phrases', () => {
    docsMock.mockReturnValue({ data: [{ ...READY_DOC, triggerPhrases: [] }], isLoading: false });
    wrapAt('/app/knowledge/a/d1');
    expect(screen.getByRole('button', { name: /let the companion trigger this/i })).toBeDisabled();
    expect(screen.getByText(/add a trigger phrase first/i)).toBeInTheDocument();
  });

  it('create mode adds the document then saves phrases, and offers Save', async () => {
    const user = userEvent.setup();
    wrapAt('/app/knowledge/a/new');
    await user.type(screen.getByLabelText(/title/i), 'Fresh');
    await user.type(screen.getByLabelText(/content/i), 'fresh body');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(addMock).toHaveBeenCalledWith([{ title: 'Fresh', content: 'fresh body' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-document.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the page**

```tsx
// apps/user-client/src/routes/app/knowledge/document.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Button } from '../../../components/ui/Button.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Pill } from '../../../components/ui/Pill.js';
import { OverflowMenu } from '../../../components/ui/OverflowMenu.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { TagEditor } from '../../../components/artefact/TagEditor.js';
import { ModelDownloadBanner } from '../../../components/knowledge/ModelDownloadBanner.js';
import {
  useDocuments,
  useAddDocuments,
  useUpdateDocument,
  useDeleteDocument,
  useRetryDocument,
  normalisePhrases,
} from '../../../data/knowledge.js';
import { useHelp } from '../../../content/help/use-help.js';
import type { DocumentRow, EmbeddingStatus } from '../../../boot/client-data-db.js';

const STATUS_LABEL: Record<EmbeddingStatus, string> = {
  pending: 'Pending',
  embedding: 'Embedding…',
  ready: 'Ready',
  failed: 'Failed',
};
const STATUS_TONE: Record<EmbeddingStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  embedding: 'warning',
  ready: 'success',
  failed: 'danger',
};

export function KnowledgeDocumentPage(): JSX.Element {
  const { libraryId, documentId } = useParams();
  const docs = useDocuments(libraryId ?? '');

  if (docs.isLoading) {
    return (
      <PageScaffold crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: '…' }]} back={`/app/knowledge/${libraryId}`}>
        <p className="px-4 pt-2 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }

  const all = docs.data ?? [];
  const existing = documentId ? all.find((d) => d.id === documentId) : undefined;

  if (documentId && !existing) {
    return (
      <PageScaffold crumbs={[{ label: 'My Knowledge', to: '/app/knowledge' }, { label: 'Not found' }]} back={`/app/knowledge/${libraryId}`}>
        <p className="px-4 pt-2 text-sm text-paper-soft">
          We can&apos;t find that document — it may have been deleted.
        </p>
      </PageScaffold>
    );
  }

  // Sibling phrases power TagEditor suggestions.
  const suggestions = Array.from(
    new Set(all.filter((d) => d.id !== documentId).flatMap((d) => d.triggerPhrases)),
  );

  return (
    <DocumentForm
      key={existing?.id ?? 'new'}
      libraryId={libraryId ?? ''}
      existing={existing}
      suggestions={suggestions}
    />
  );
}

function DocumentForm(props: {
  libraryId: string;
  existing: DocumentRow | undefined;
  suggestions: string[];
}): JSX.Element {
  const { libraryId, existing, suggestions } = props;
  const navigate = useNavigate();
  const add = useAddDocuments(libraryId);
  const update = useUpdateDocument(libraryId);
  const del = useDeleteDocument(libraryId);
  const retry = useRetryDocument(libraryId);
  const { onHelp, helpOverlay } = useHelp('knowledge-document');

  const [title, setTitle] = useState(existing?.title ?? '');
  const [content, setContent] = useState(existing?.content ?? '');
  const [phrases, setPhrases] = useState<string[]>(existing?.triggerPhrases ?? []);
  const [companion, setCompanion] = useState(existing?.triggerOnCompanion ?? false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreate = existing === undefined;
  const companionDisabled = phrases.length === 0;
  const backTo = `/app/knowledge/${libraryId}`;

  function mark(): void {
    setDirty(true);
  }

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      if (isCreate) {
        const [newId] = await add.mutateAsync([{ title: title.trim() || 'Untitled', content }]);
        if (newId && (phrases.length > 0 || companion)) {
          await update.mutateAsync({
            id: newId,
            patch: { triggerPhrases: phrases, triggerOnCompanion: companion },
          });
        }
      } else {
        const patch: { title?: string; content?: string; triggerPhrases?: string[]; triggerOnCompanion?: boolean } = {
          title: title.trim() || 'Untitled',
          triggerPhrases: phrases,
          triggerOnCompanion: companion,
        };
        // Include content ONLY when it actually changed — content presence triggers re-embed.
        if (content !== existing.content) patch.content = content;
        await update.mutateAsync({ id: existing.id, patch });
      }
      setDirty(false);
      navigate(backTo);
    } finally {
      setSaving(false);
    }
  }

  const crumbLabel = isCreate ? 'New document' : existing.title;

  return (
    <PageScaffold
      crumbs={[
        { label: 'My Knowledge', to: '/app/knowledge' },
        { label: 'Library', to: backTo },
        { label: crumbLabel },
      ]}
      back={backTo}
      onHelp={onHelp}
      dirty={dirty}
    >
      {helpOverlay}
      <div className="flex flex-col gap-5 px-4 pb-8 pt-2">
        <div className="flex items-center justify-between gap-2">
          {existing ? (
            <span className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[existing.embeddingStatus]}>
                {STATUS_LABEL[existing.embeddingStatus]}
              </Badge>
              {dirty ? <Badge tone="warning">● Unsaved</Badge> : null}
            </span>
          ) : (
            <span>{dirty ? <Badge tone="warning">● Unsaved</Badge> : null}</span>
          )}
          {existing ? (
            <OverflowMenu
              items={[
                { label: 'Delete document', tone: 'destructive', onSelect: () => setConfirmDelete(true) },
              ]}
            />
          ) : null}
        </div>

        {existing && existing.embeddingStatus === 'failed' ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-3">
            <p className="text-[12px] text-amber-200/90">
              Indexing failed: {existing.embeddingError ?? 'unknown error'}
            </p>
            <div>
              <Pill variant="add" onClick={() => retry.mutate(existing.id)}>
                Retry
              </Pill>
            </div>
          </div>
        ) : null}

        <ModelDownloadBanner />

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Title</span>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); mark(); }}
            placeholder="Untitled"
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Content</span>
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); mark(); }}
            rows={12}
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Trigger phrases</span>
          <TagEditor
            mode="edit"
            value={phrases}
            suggestions={suggestions}
            onChange={(next) => { setPhrases(next); mark(); }}
            normalise={normalisePhrases}
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Let the companion trigger this too</div>
            {companionDisabled ? (
              <p className="text-[11px] text-paper-soft">Add a trigger phrase first.</p>
            ) : (
              <p className="text-[11px] text-paper-soft">
                The companion may surface this note when a phrase matches.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Let the companion trigger this too"
            aria-pressed={companion}
            disabled={companionDisabled}
            aria-disabled={companionDisabled}
            onClick={() => { if (!companionDisabled) { setCompanion((v) => !v); mark(); } }}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              companion ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            } ${companionDisabled ? 'opacity-40' : ''}`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                companion ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div>
          <Button tone="primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {existing ? (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete ${existing.title}?`}
          body="This document is removed from the library."
          confirmLabel="Delete"
          cancelLabel="Keep"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            del.mutate(existing.id);
            navigate(backTo);
          }}
        />
      ) : null}
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client vitest run tests/component/knowledge-document.test.tsx`
Expected: PASS (6 tests). If `TagEditor` in `mode="edit"` requires specific DOM the test doesn't provide, the phrase-related assertions still hold via the toggle's disabled state; adjust only the query, not the behaviour.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean.

```bash
git add apps/user-client/src/routes/app/knowledge/document.tsx apps/user-client/tests/component/knowledge-document.test.tsx
git commit -m "Add My Knowledge document detail with one explicit save and dirty-guard

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Route wiring, retire old chrome, full gate

**Files:**
- Modify: `apps/user-client/src/App.tsx`
- Delete: `apps/user-client/src/routes/app/knowledge-library.tsx`
- Delete: `apps/user-client/src/components/knowledge/AddDocumentMenu.tsx`
- Delete: `apps/user-client/src/components/knowledge/DocumentEditor.tsx`
- Delete: `apps/user-client/src/components/knowledge/DocumentStatusBadge.tsx`
- Delete: `apps/user-client/src/components/knowledge/NewLibrarySheet.tsx`
- Delete: `apps/user-client/src/components/knowledge/ChatsuneLibraryImport.tsx`
- Keep: `components/knowledge/ModelDownloadBanner.tsx`, `components/knowledge/DocumentPicker.tsx` (chat, out of scope)

**Interfaces:**
- Consumes: `KnowledgeList` (Task 2), `KnowledgeLibraryPage` (Task 3/4), `KnowledgeDocumentPage` (Task 5).
- Produces: the wired route tree; the retired files removed.

- [ ] **Step 1: Update routes in `App.tsx`**

Replace the import line `import { KnowledgeLibrary } from './routes/app/knowledge-library.js';` and add the new page imports:

```tsx
import { KnowledgeList } from './routes/app/knowledge.js';
import { KnowledgeLibraryPage } from './routes/app/knowledge/library.js';
import { KnowledgeDocumentPage } from './routes/app/knowledge/document.js';
```

Replace the two existing knowledge `<Route>`s with:

```tsx
<Route path="/app/knowledge" element={<KnowledgeList />} />
<Route path="/app/knowledge/new" element={<KnowledgeLibraryPage />} />
<Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
<Route path="/app/knowledge/:libraryId/new" element={<KnowledgeDocumentPage />} />
<Route path="/app/knowledge/:libraryId/:documentId" element={<KnowledgeDocumentPage />} />
```

(Route order: `/new` must precede `/:libraryId`, and `/:libraryId/new` must precede `/:libraryId/:documentId`, so the literal segments win over the params.)

- [ ] **Step 2: Delete the retired files**

```bash
git rm apps/user-client/src/routes/app/knowledge-library.tsx \
  apps/user-client/src/components/knowledge/AddDocumentMenu.tsx \
  apps/user-client/src/components/knowledge/DocumentEditor.tsx \
  apps/user-client/src/components/knowledge/DocumentStatusBadge.tsx \
  apps/user-client/src/components/knowledge/NewLibrarySheet.tsx \
  apps/user-client/src/components/knowledge/ChatsuneLibraryImport.tsx
```

- [ ] **Step 3: Find and fix dangling references**

Run: `cd apps/user-client && rg -n "knowledge-library|AddDocumentMenu|DocumentEditor|DocumentStatusBadge|NewLibrarySheet|LibrarySheet|ChatsuneLibraryImport" src`
Expected: no hits except inside `components/knowledge/DocumentPicker.tsx` if it imports `DocumentStatusBadge` (verify — `DocumentPicker` uses its own checkbox UI, not the badge; if any retired symbol IS imported by `DocumentPicker`, stop and inline the minimal needed code into `DocumentPicker` rather than resurrecting the file). Fix any other hit by removing the dead import.

- [ ] **Step 4: Retire now-dead CSS (optional, low-risk)**

Run: `rg -n "knowledge-library-row|knowledge-document-row|knowledge-new-btn|knowledge-back|knowledge-sheet-root|doc-status|add-document-menu|add-document" src/index.css`
For each class with no remaining consumer (confirm via `rg "<class>" src` excluding `index.css` and `DocumentPicker.tsx`), delete the rule. Leave any class still used by `DocumentPicker` (the `.document-picker-*` family) untouched.

- [ ] **Step 5: Run the full gate**

```bash
pnpm typecheck --force
```
Expected: 14/14 (0 cached).

```bash
pnpm --filter @chatsundere/user-client vitest run
```
Expected: the 8 Node-localStorage baseline failures only; all new `knowledge-*` suites green.

```bash
pnpm --filter @chatsundere/user-client build
```
Expected: clean production build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Wire My Knowledge route tree and retire the pre-makeover chrome

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Post-implementation (Liz, not a subagent)

1. **Laura pre-squash pass** — verify the built three-level flow honours the approved UX intent (quiet list, NSFW badge, always-save metadata, NSFW-toggle-disabled-in-SFW, one-save-one-guard document page, failed→Retry on the detail page, ⋯ deletes). Fix hard defects; log conscious deferrals in `obsidian/insights/ux-deferrals.md`.
2. **opus whole-branch review** — merge-readiness; address Critical/Important.
3. **Squash** to one feature commit; verify `git diff --cached --name-only` carries no scratch/report pollution and the full tree is captured; `pnpm typecheck --force` on master post-squash.
4. **STATUS update** — move My Knowledge into Current on `STATUS-CLIENT-ONLY.md`.
5. Chris device-verifies (§12 of the spec), then pushes.

## Self-review notes (coverage check against the spec)

- Spec §3 tree → Tasks 2/3/5 + §6 wiring; breadcrumb create labels → Task 3/5 (`New library`/`New document`). ✓
- §4 list (rows, NSFW+count badges, `+ Add`, import in ⋯, empty) → Task 2. ✓
- §4.1 library create (explicit Create, then land on detail) → Task 3. ✓
- §5 detail (always-save metadata, NSFW-toggle SFW-disabled, documents list, `Add ▾` Upload/New, upload-failure notice, ModelDownloadBanner, delete ⋯) → Tasks 3+4. ✓
- §6 document (one explicit Save + dirty-guard, content-only-on-change re-embed, TagEditor phrases, companion toggle disabled-with-reason, status, failed→cause+Retry, delete ⋯, model notice on L3) → Task 5. ✓
- §7 status placement (badge in list, fix in detail; plain failed badge) → Tasks 4 (list badge) + 5 (cause+Retry). ✓
- §8 live status via existing 800 ms poll → no new wiring (noted in Global Constraints). ✓
- §9 cleanup (retire sheets, NewLibrarySheet alias, dead CSS) → Task 6. ✓
- §10 tests per level → Tasks 1–5; full gate → Task 6. ✓
- Out-of-scope (DocumentPicker, KnowledgeSection, NSFW deep-link gating) → preserved by Global Constraints + Task 6 Step 3 guard. ✓
