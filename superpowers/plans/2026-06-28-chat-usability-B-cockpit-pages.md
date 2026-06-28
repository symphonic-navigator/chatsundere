# Chat Usability Pass — Slice B (Cockpit Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bookmarks, artefacts and knowledge cockpit buttons into full chat-scoped pages (mirroring the memory page), reached by navigation with the unified-experience zoom, replacing the three overlay sheets.

**Architecture:** Three new chat-scoped routes (`/app/chat/:chatId/{bookmarks,artefacts,knowledge}`) render `PageScaffold` pages that port the logic of `TocSheet`/`ArtefactSheet`/`KnowledgeSheet` and reuse the makeover list primitives (`PageScaffold`, `ListRow`/`cs-row`, `TreasuryRow`, `Lightbox`). The cockpit's four buttons become uniform navigations; the sheets and their state are retired. **Depends on Slice A Task 3** (exact-route chat-chrome predicate) so the sub-pages render standard chrome, not the chat brand bar.

**Tech Stack:** React 18, react-router v6, TanStack Query, Zustand, Vitest. Reuse existing data hooks; no Dexie/schema change.

**Spec:** `superpowers/specs/2026-06-28-chat-usability-pass-design.md` (Area 4). British English. Client-only — not a Larissa path.

**Confirmed building blocks (read these before starting):**
- Memory page to mirror: `routes/app/persona-memory.tsx` (PageScaffold + `useHelp('persona-memory')` → `{ onHelp, helpOverlay }`, crumbs `[{label,to}]`, `back` prop).
- `useChat(chatId)` → `{ chat, messages }` (`data/chats.ts`); `chat.libraryIds`, `chat.personaId`, `chat.title`.
- Bookmarks: `buildToc(messages)` (`lib/toc.ts`), `useToggleBookmark()` (`data/chats.ts`), `useSetBookmarkLabel()` (`data/bookmarks.ts`). The chat-page already honours `?focus=<messageId>` (chat-page.tsx:632–640).
- Artefacts: `useChatArtefacts(chatId)`, `useSetArtefactFavourite(chatId)`, `useRenameArtefact`, `useUpdateArtefactContent`, `useDeleteArtefact` (`data/artefacts.ts`), `buildArtefactSections` + `formatGlyph` (`lib/artefact-sections.ts`), `artefactToViewable`, `TreasuryRow` (`components/treasury/TreasuryRow.tsx`), `Lightbox` (`components/lightbox/Lightbox.tsx`). Lightbox wiring to port: chat-page.tsx:623–630, 860–880.
- Knowledge: `useFilteredLibraries()` (`data/knowledge.ts`), `useSetChatLibraries()` (`data/chats.ts`), `computeEffectiveLibraries` (`knowledge/effective-libraries.ts`), persona `libraryIds`/`adultPersona`. Wiring to port: Cockpit.tsx:236–255, KnowledgeSheet.tsx.
- Routes table: `App.tsx` (react-router `<Route>` elements under the protected block, ~lines 121–168).
- Cockpit buttons: `Cockpit.tsx:476–534` (toc/artefacts gated behind `toolsAvailable`, knowledge toggles a sheet, memory already navigates).

---

## File structure

- Create: `src/routes/app/chat/bookmarks-page.tsx` — `/app/chat/:chatId/bookmarks`.
- Create: `src/routes/app/chat/artefacts-page.tsx` — `/app/chat/:chatId/artefacts`.
- Create: `src/routes/app/chat/knowledge-page.tsx` — `/app/chat/:chatId/knowledge`.
- Create: help docs under `src/content/help/` (mirror the existing help keys, e.g. `chat-bookmarks`, `chat-artefacts`, `chat-knowledge`).
- Modify: `src/App.tsx` — register the three routes.
- Modify: `src/components/chat/Cockpit.tsx` — buttons navigate; drop the `toolsAvailable` gate; remove sheet props/state.
- Modify: `src/routes/app/chat/chat-page.tsx` — remove `TocSheet`/`ArtefactSheet`/sheet state passed to cockpit.
- Delete: `src/components/chat/TocSheet.tsx`, `ArtefactSheet.tsx`, `KnowledgeSheet.tsx` + their dead CSS in `index.css`.

---

## Task 1: Register the three routes (stub pages)

**Files:**
- Create: `src/routes/app/chat/bookmarks-page.tsx`, `artefacts-page.tsx`, `knowledge-page.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.routes.test.tsx` (append/create)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { BookmarksPage } from './routes/app/chat/bookmarks-page.js';

it('bookmarks page renders its crumb', () => {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/bookmarks']}>
      <Routes><Route path="/app/chat/:chatId/bookmarks" element={<BookmarksPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('Bookmarks')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/App.routes.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the three stub pages**

Each mirrors `persona-memory.tsx`'s PageScaffold shell. Stub `bookmarks-page.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';

/** This chat's bookmarks + table of contents. */
export function BookmarksPage(): JSX.Element {
  const { chatId = '' } = useParams();
  const { onHelp, helpOverlay } = useHelp('chat-bookmarks');
  return (
    <PageScaffold
      crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Bookmarks' }]}
      back={`/app/chat/${chatId}`}
      onHelp={onHelp}
    >
      {helpOverlay}
      {/* list lands in Task 2 */}
    </PageScaffold>
  );
}
```

Create `artefacts-page.tsx` (crumb `Artefacts`, help `chat-artefacts`) and `knowledge-page.tsx` (crumb `Knowledge`, help `chat-knowledge`) with the same shell. Match `PageScaffold`'s real prop names by copying `persona-memory.tsx`'s usage (crumb objects, `back`, and however it threads `onHelp`/`helpOverlay`). Add the three help docs so `useHelp('chat-bookmarks'|…)` resolves (copy an existing help file as a template; write British-English copy explaining the page is *this chat's* bookmarks/artefacts/knowledge — reinforcing the "this chat" scope per spec §5.0).

- [ ] **Step 4: Register routes in App.tsx**

Add imports and, beneath `<Route path="/app/chat/:chatId" … />` (line ~134):

```tsx
<Route path="/app/chat/:chatId/bookmarks" element={<BookmarksPage />} />
<Route path="/app/chat/:chatId/artefacts" element={<ArtefactsPage />} />
<Route path="/app/chat/:chatId/knowledge" element={<KnowledgePage />} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/App.routes.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/chat/*-page.tsx apps/user-client/src/App.tsx apps/user-client/src/content/help apps/user-client/src/App.routes.test.tsx
git commit -m "Add chat bookmarks/artefacts/knowledge page routes (stubs)"
```

---

## Task 2: Bookmarks page — Pinned + In-this-chat, jump-back

**Files:**
- Modify: `src/routes/app/chat/bookmarks-page.tsx`
- Test: `src/routes/app/chat/bookmarks-page.test.tsx`

Port `TocSheet.tsx` logic into the page. Two sections (`toc.pinned`, `toc.timeline`) via `buildToc(messages)`; inline rename (`useSetBookmarkLabel`) + star (`useToggleBookmark`); row tap navigates to the chat with `?focus`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { BookmarksPage } from './bookmarks-page.js';

// Mock useChat to return two messages, one starred.
vi.mock('../../../data/chats.js', async (orig) => ({
  ...(await orig()),
  useChat: () => ({ data: { chat: { id: 'c1' }, messages: [
    { id: 'm1', role: 'user', contentBlocks: [{ type: 'text', text: 'Wie alles begann' }], starred: true },
    { id: 'm2', role: 'user', contentBlocks: [{ type: 'text', text: 'Die Frage' }], starred: false },
  ] } }),
  useToggleBookmark: () => ({ mutateAsync: vi.fn() }),
}));

function LocationProbe() { const l = useLocation(); return <div data-testid="loc">{l.pathname}{l.search}</div>; }

it('tapping an entry navigates to the chat with ?focus', () => {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/bookmarks']}>
      <Routes>
        <Route path="/app/chat/:chatId/bookmarks" element={<><BookmarksPage /><LocationProbe /></>} />
        <Route path="/app/chat/:chatId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('Die Frage'));
  expect(screen.getByTestId('loc').textContent).toContain('/app/chat/c1?focus=m2');
});
```

(Adjust the mock to match `buildToc`'s real input shape — inspect `lib/toc.ts` and `data/bookmarks.ts` first; the test's job is to pin the jump-to-`?focus` behaviour.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/chat/bookmarks-page.test.tsx`
Expected: FAIL — no rows rendered / no navigation.

- [ ] **Step 3: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useChat, useToggleBookmark } from '../../../data/chats.js';
import { useSetBookmarkLabel } from '../../../data/bookmarks.js';
import { type TocEntry, buildToc } from '../../../lib/toc.js';

export function BookmarksPage(): JSX.Element {
  const { chatId = '' } = useParams();
  const navigate = useNavigate();
  const { onHelp, helpOverlay } = useHelp('chat-bookmarks');
  const { data } = useChat(chatId || null);
  const toc = buildToc(data?.messages ?? []);
  const toggleBookmark = useToggleBookmark();
  const setLabel = useSetBookmarkLabel();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function startRename(entry: TocEntry): void {
    setDraft(entry.isDefaultLabel ? '' : entry.label);
    setEditingId(entry.messageId);
  }
  function commitRename(messageId: string): void {
    const next = draft.trim();
    void setLabel.mutateAsync({ messageId, label: next === '' ? null : next });
    setEditingId(null);
  }
  function jump(messageId: string): void {
    // push (not replace) so system Back returns to this list — spec §5.1
    navigate(`/app/chat/${chatId}?focus=${messageId}`);
  }

  const renderEntry = (entry: TocEntry): JSX.Element => (
    <li key={`${entry.messageId}-${entry.role}`} className="cs-row" data-starred={entry.starred || undefined}>
      {editingId === entry.messageId ? (
        <input
          className="toc-entry-input"
          // biome-ignore lint/a11y/noAutofocus: inline rename — focus is the intent
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(entry.messageId);
            else if (e.key === 'Escape') setEditingId(null);
          }}
          onBlur={() => commitRename(entry.messageId)}
        />
      ) : (
        <button type="button" className="cs-row-title" onClick={() => jump(entry.messageId)}>
          {entry.label}
        </button>
      )}
      <div className="toc-entry-actions">
        <button type="button" className="toc-entry-rename" aria-label="Rename bookmark" onClick={() => startRename(entry)}>
          <span aria-hidden>🖎</span>
        </button>
        <button
          type="button"
          className="toc-entry-star"
          aria-label={entry.starred ? 'Remove bookmark' : 'Add bookmark'}
          data-active={entry.starred || undefined}
          onClick={() => void toggleBookmark.mutateAsync(entry.messageId)}
        >
          <span aria-hidden>{entry.starred ? '★' : '☆'}</span>
        </button>
      </div>
    </li>
  );

  return (
    <PageScaffold crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Bookmarks' }]} back={`/app/chat/${chatId}`} onHelp={onHelp}>
      {helpOverlay}
      {toc.pinned.length > 0 ? (
        <section className="toc-section">
          <h3 className="toc-section-title">Pinned</h3>
          <ul className="toc-list">{toc.pinned.map(renderEntry)}</ul>
        </section>
      ) : null}
      <section className="toc-section">
        <h3 className="toc-section-title">In this chat</h3>
        {toc.timeline.length > 0 ? (
          <ul className="toc-list">{toc.timeline.map(renderEntry)}</ul>
        ) : (
          <p className="toc-empty">Your messages will appear here as you chat.</p>
        )}
      </section>
    </PageScaffold>
  );
}
```

Keep the `.toc-entry-*`/`.toc-list`/`.toc-section*` CSS (it already exists and is owned here now). Match `PageScaffold`'s real `onHelp`/help-overlay threading to `persona-memory.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/chat/bookmarks-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/chat/bookmarks-page.tsx apps/user-client/src/routes/app/chat/bookmarks-page.test.tsx
git commit -m "Implement chat bookmarks page with jump-back"
```

---

## Task 3: Artefacts page — TreasuryRow + Lightbox

**Files:**
- Modify: `src/routes/app/chat/artefacts-page.tsx`
- Test: `src/routes/app/chat/artefacts-page.test.tsx`

Reuse `TreasuryRow` (with `selectMode={false}`); tap → `Lightbox`; rename/delete handled in the Lightbox (port chat-page.tsx:623–630, 860–880).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ArtefactsPage } from './artefacts-page.js';

vi.mock('../../../data/artefacts.js', async (orig) => ({
  ...(await orig()),
  useChatArtefacts: () => ({ data: [
    { id: 'a1', chatId: 'c1', personaId: 'p1', title: 'gedicht.md', format: 'markdown', favourite: false, sizeBytes: 1024, createdAt: 1 },
  ] }),
  useSetArtefactFavourite: () => ({ mutate: vi.fn() }),
  useRenameArtefact: () => ({ mutate: vi.fn() }),
  useUpdateArtefactContent: () => ({ mutate: vi.fn() }),
  useDeleteArtefact: () => ({ mutate: vi.fn() }),
}));

it('renders chat artefacts', () => {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/artefacts']}>
      <Routes><Route path="/app/chat/:chatId/artefacts" element={<ArtefactsPage />} /></Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('gedicht.md')).toBeInTheDocument();
});
```

(Inspect `data/artefacts.ts` for the exact `ArtefactRow` field names + `artefactToViewable` shape, and adjust the mock fixture to match before running.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/chat/artefacts-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Lightbox } from '../../../components/lightbox/Lightbox.js';
import { TreasuryRow } from '../../../components/treasury/TreasuryRow.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  useChatArtefacts, useSetArtefactFavourite, useRenameArtefact,
  useUpdateArtefactContent, useDeleteArtefact, artefactToViewable,
} from '../../../data/artefacts.js';
import { useChat } from '../../../data/chats.js';
import { buildArtefactSections } from '../../../lib/artefact-sections.js';
import { useCurrentChatStore } from '../../../state/current-chat.store.js';

export function ArtefactsPage(): JSX.Element {
  const { chatId = '' } = useParams();
  const { onHelp, helpOverlay } = useHelp('chat-artefacts');
  const { data: chatData } = useChat(chatId || null);
  const persona = chatData?.chat; // personaName/colour resolved below from chatHeader/persona query
  const { data: rows = [] } = useChatArtefacts(chatId);
  const setFav = useSetArtefactFavourite(chatId);
  const renameArtefact = useRenameArtefact(chatId);
  const editArtefactContent = useUpdateArtefactContent(chatId);
  const removeArtefact = useDeleteArtefact(chatId);
  const sections = buildArtefactSections(rows);
  const items = rows.map(artefactToViewable);
  const openArtefactId = useCurrentChatStore((s) => s.openArtefactId);
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const closeArtefact = useCurrentChatStore((s) => s.closeArtefact);
  const index = openArtefactId ? items.findIndex((i) => i.id === openArtefactId) : -1;

  const chatHeader = useCurrentChatStore((s) => s.chatHeader);
  const personaName = chatHeader?.name ?? '—';
  const personaColour = chatHeader?.colour ?? '#8d6dff';

  const renderRow = (r: (typeof rows)[number]): JSX.Element => (
    <TreasuryRow
      key={r.id}
      row={r}
      personaName={personaName}
      personaColour={personaColour}
      selectMode={false}
      selected={false}
      onOpen={openArtefact}
      onToggleSelect={() => undefined}
      onToggleFavourite={(id) => setFav.mutate({ id, favourite: !r.favourite })}
    />
  );

  return (
    <PageScaffold crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Artefacts' }]} back={`/app/chat/${chatId}`} onHelp={onHelp}>
      {helpOverlay}
      {sections.favourites.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="cs-section-title">★ Favourites</h3>
          {sections.favourites.map(renderRow)}
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3 className="cs-section-title">In this chat</h3>
        {sections.inChat.length > 0 ? sections.inChat.map(renderRow) : (
          <p className="cs-empty">Artefacts you create appear here.</p>
        )}
      </section>
      {index >= 0 ? (
        <Lightbox
          items={items}
          index={index}
          onClose={closeArtefact}
          onRename={(id, patch) => renameArtefact.mutate({ id, patch })}
          onEditText={(id, text) => editArtefactContent.mutate({ id, content: text })}
          onDelete={(id) => { removeArtefact.mutate(id); closeArtefact(); }}
        />
      ) : null}
    </PageScaffold>
  );
}
```

Verify the `Lightbox` prop names/shape against chat-page.tsx:860–880 (e.g. how `index`/`items`/close are passed) and adjust to match exactly. Use the established section-title/empty classes the other makeover pages use (copy from `treasury.tsx`). Persona label redundancy on this single-persona page is accepted as-is (spec §5.2, Laura soft — do not modify the shared `TreasuryRow`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/chat/artefacts-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/chat/artefacts-page.tsx apps/user-client/src/routes/app/chat/artefacts-page.test.tsx
git commit -m "Implement chat artefacts page with TreasuryRow + lightbox"
```

---

## Task 4: Knowledge page — binding toggles

**Files:**
- Modify: `src/routes/app/chat/knowledge-page.tsx`
- Test: `src/routes/app/chat/knowledge-page.test.tsx`

Port `KnowledgeSheet.tsx` + the toggle wiring from Cockpit.tsx:236–255. Persona libraries locked-on; others toggle the chat's ad-hoc set via `useSetChatLibraries` (always-save). Link to My Knowledge.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { KnowledgePage } from './knowledge-page.js';

const mutate = vi.fn();
vi.mock('../../../data/knowledge.js', async (orig) => ({
  ...(await orig()),
  useFilteredLibraries: () => ({ data: [
    { id: 'l1', name: 'Harbour lore', nsfw: false },
    { id: 'l2', name: 'Recipes', nsfw: false },
  ] }),
}));
vi.mock('../../../data/chats.js', async (orig) => ({
  ...(await orig()),
  useChat: () => ({ data: { chat: { id: 'c1', personaId: 'p1', libraryIds: [] } } }),
  useSetChatLibraries: () => ({ mutate }),
}));
// persona query mock providing libraryIds:['l1'], adultPersona:false — match the page's persona source.

it('toggling a non-persona library persists immediately', () => {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/knowledge']}>
      <Routes><Route path="/app/chat/:chatId/knowledge" element={<KnowledgePage />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText('Recipes'));
  expect(mutate).toHaveBeenCalledWith({ chatId: 'c1', libraryIds: ['l2'] });
});
```

(Resolve how the page reads the persona — mirror `Cockpit.tsx` which receives `p.persona`; here load the persona via the same persona query chat-page/Cockpit use. Adjust the mock accordingly before running.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/chat/knowledge-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useChat, useSetChatLibraries } from '../../../data/chats.js';
import { useFilteredLibraries } from '../../../data/knowledge.js';
import { usePersona } from '../../../data/personas.js'; // confirm the real persona hook name

export function KnowledgePage(): JSX.Element {
  const { chatId = '' } = useParams();
  const { onHelp, helpOverlay } = useHelp('chat-knowledge');
  const { data: chatData } = useChat(chatId || null);
  const personaId = chatData?.chat.personaId ?? '';
  const { data: persona } = usePersona(personaId);
  const setChatLibraries = useSetChatLibraries();

  const adultPersona = persona?.adultPersona ?? false;
  const personaLibraryIds = persona?.libraryIds ?? [];
  const chatLibraryIds = chatData?.chat.libraryIds ?? [];
  const libraries = (useFilteredLibraries().data ?? []).filter((l) => adultPersona || !l.nsfw);
  const personaSet = new Set(personaLibraryIds);
  const chatSet = new Set(chatLibraryIds);

  function toggle(id: string): void {
    const next = chatLibraryIds.includes(id) ? chatLibraryIds.filter((l) => l !== id) : [...chatLibraryIds, id];
    setChatLibraries.mutate({ chatId, libraryIds: next });
  }

  return (
    <PageScaffold crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Knowledge' }]} back={`/app/chat/${chatId}`} onHelp={onHelp}>
      {helpOverlay}
      {libraries.length === 0 ? (
        <p className="cs-empty">No libraries yet. Create one in <Link to="/app/knowledge">My Knowledge</Link>.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {libraries.map((library) => {
            const fromPersona = personaSet.has(library.id);
            const checked = fromPersona || chatSet.has(library.id);
            return (
              <li key={library.id} className="cs-row">
                <label className="flex w-full items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={library.name}
                    checked={checked}
                    disabled={fromPersona}
                    onChange={() => { if (!fromPersona) toggle(library.id); }}
                  />
                  <span className="cs-row-title">{library.name}</span>
                  {fromPersona ? <span className="cs-row-hint">from persona</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/app/knowledge" className="cs-link mt-3 inline-block">Manage in My Knowledge</Link>
    </PageScaffold>
  );
}
```

Confirm the persona hook name (`usePersona`/`usePersonaQuery`) by grepping `data/personas.ts`; the persona query already used by Cockpit/chat-page is the canonical source. NSFW filtering reuses `useFilteredLibraries` exactly (conscious hide exception, spec §5.3). Use the real `cs-*` classes the other pages use for rows/hints/links.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/routes/app/chat/knowledge-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/chat/knowledge-page.tsx apps/user-client/src/routes/app/chat/knowledge-page.test.tsx
git commit -m "Implement chat knowledge binding page"
```

---

## Task 5: Cockpit buttons navigate; drop the gate

**Files:**
- Modify: `src/components/chat/Cockpit.tsx`
- Test: `src/components/chat/Cockpit.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```tsx
// Render the cockpit (mirror an existing Cockpit test's harness) and assert all
// four resource buttons are present even when toolsAvailable is false, and that
// clicking bookmarks navigates to /app/chat/<id>/bookmarks.
it('shows all four resource buttons and navigates to the bookmarks page', () => {
  // …render with toolsAvailable={false}…
  expect(screen.getByLabelText('Bookmarks and contents')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Bookmarks and contents'));
  // assert navigation target /app/chat/<id>/bookmarks via a LocationProbe
});
```

Copy the harness/mocks from the existing `Cockpit.test.tsx`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && pnpm vitest run src/components/chat/Cockpit.test.tsx`
Expected: FAIL — buttons hidden when `toolsAvailable` false; no navigation.

- [ ] **Step 3: Implement**

In `Cockpit.tsx`:
- Remove the `p.toolsAvailable && p.onOpenToc && p.onOpenArtefacts ?` wrapper (lines 476–501) so the toc + artefacts buttons always render.
- Bookmarks button `onClick`: `navigate(\`/app/chat/${p.chatId}/bookmarks\`)`.
- Artefacts button `onClick`: `navigate(\`/app/chat/${p.chatId}/artefacts\`)`.
- Knowledge button `onClick`: `navigate(\`/app/chat/${p.chatId}/knowledge\`)`; remove `aria-expanded={knowledgeOpen}` and the `setKnowledgeOpen` toggle; delete the `<KnowledgeSheet … />` block (lines ~627–636) and the `knowledgeOpen` state + the knowledge sheet wiring (`personaLibraryIds`/`chatLibraryIds`/`onToggleChatLibrary`/`setChatLibraries`/`useFilteredLibraries`/`computeEffectiveLibraries` may now be unused here — but `effectiveCount` for the badge still needs `computeEffectiveLibraries`; keep only what the badge count requires).
- Remove now-unused props `onOpenToc`, `onOpenArtefacts`, `toolsAvailable` from the `Cockpit` props type and all call sites in `chat-page.tsx`.

Keep the memory button as-is (already navigates). All four now navigate uniformly.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/user-client && pnpm vitest run src/components/chat/Cockpit.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck (catches unused-prop fallout)**

Run: `cd apps/user-client && pnpm typecheck --force`
Expected: clean — fix any now-unused imports/props in `Cockpit.tsx` and `chat-page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/src/components/chat/Cockpit.test.tsx
git commit -m "Cockpit resource buttons navigate to pages; drop tools gate"
```

---

## Task 6: Retire the three sheets + dead CSS

**Files:**
- Delete: `src/components/chat/TocSheet.tsx`, `ArtefactSheet.tsx`, `KnowledgeSheet.tsx`
- Modify: `src/routes/app/chat/chat-page.tsx` (remove sheet rendering + `tocOpen`/`isArtefactSheetOpen` usage)
- Modify: `src/state/current-chat.store.ts` (remove `isArtefactSheetOpen` + `setArtefactSheetOpen` if now unused; keep `openArtefactId`/`openArtefact`/`closeArtefact` — the lightbox uses them)
- Modify: `src/index.css` (remove `.toc-sheet*`, `.artefact-sheet*`, `.knowledge-sheet*` blocks; **keep** `.toc-entry*`/`.toc-list`/`.toc-section*` — now owned by the bookmarks page)

- [ ] **Step 1: Remove sheet rendering in chat-page**

Delete the `{tocOpen ? <TocSheet … /> : null}` and `{isArtefactSheetOpen ? <ArtefactSheet … /> : null}` blocks and the `tocOpen` state + handlers. `jumpToMessage` stays (used by the `?focus` effect). The `<Lightbox>` in chat-page stays (in-chat artefact opening still works).

- [ ] **Step 2: Delete the sheet files + grep for stragglers**

```bash
rm apps/user-client/src/components/chat/TocSheet.tsx apps/user-client/src/components/chat/ArtefactSheet.tsx apps/user-client/src/components/chat/KnowledgeSheet.tsx
cd apps/user-client && rg -n "TocSheet|ArtefactSheet|KnowledgeSheet|isArtefactSheetOpen|setArtefactSheetOpen|tocOpen" src
```

Resolve every hit (imports, store fields, tests). Remove `isArtefactSheetOpen`/`setArtefactSheetOpen` from the store + its tests only if no remaining consumer.

- [ ] **Step 3: Remove dead CSS**

In `index.css` delete the `.toc-sheet*`, `.artefact-sheet*`, `.knowledge-sheet*` rule blocks. Keep `.toc-entry*`/`.toc-list`/`.toc-section*`.

- [ ] **Step 4: Full gates**

Run:
```bash
cd apps/user-client && pnpm typecheck --force && pnpm build && pnpm vitest run
```
Expected: typecheck 0 errors; build green; vitest at/above the established baseline (new page suites added, sheet suites removed).

- [ ] **Step 5: Commit**

```bash
git add -A apps/user-client/src
git commit -m "Retire chat sheets in favour of cockpit pages"
```

---

## Slice B self-review checklist

- [ ] Spec §5.0 routing/chrome: three routes under `/app/chat/:chatId/*`; rely on Slice A Task 3 exact-route predicate (verify the brand bar shows standard chrome on these pages, not the chat topbar).
- [ ] §5.1 bookmarks: Pinned + In-this-chat, inline rename/star, push-nav `?focus` jump-back — Task 2.
- [ ] §5.2 artefacts: TreasuryRow + Lightbox rename/delete, favourites/in-chat sections — Task 3.
- [ ] §5.3 knowledge: persona locked-on + chat toggle always-save + My Knowledge link; NSFW hide exception preserved — Task 4.
- [ ] §5.4 cockpit: all four navigate, gate dropped, sheets retired — Tasks 5–6.
- [ ] Hook/type names verified against source before each task (useChat/useChatArtefacts/useSetChatLibraries/usePersona/TreasuryRow/Lightbox props).

## Gates before squash

```bash
cd apps/user-client && pnpm typecheck --force && pnpm build && pnpm vitest run
cd ../.. && pnpm biome check apps/user-client/src
```

Then: **Laura pre-squash pass** on the diff (verify all three pages honour the spec-pass intent — reachability, return paths, "this chat" scope clarity, no dead-ends), fold/defer, squash as one unit ("Add chat cockpit pages; retire sheets"). **opus whole-branch review** across both slices before squashing. Branches kept until Chris pushes. Update `obsidian/STATUS-CLIENT-ONLY.md`.
