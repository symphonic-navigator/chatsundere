# Memory Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clipped, unstyled cockpit memory `<dialog>` overlay with a single dedicated route `/app/persona/:id/memory` where the user can see, edit, delete (with undo), and commit all journal entries and view/edit the memory body.

**Architecture:** A new persona-scoped route component `PersonaMemory` becomes the one home for memory. It reads `:id` from the route and an optional `?chat=<chatId>` query param. The cockpit ◌ button stops opening an overlay and pure-navigates to it; the persona editor's `MemorySection` is trimmed to settings + a "Manage memory →" link. The broken `MemorySheet` overlay and its body/committed displays are removed. All data hooks already exist — this is a presentation/IA change only.

**Tech Stack:** React 18, react-router-dom, TanStack Query, Zustand (toast store), Tailwind v4, Dexie, Vitest + React Testing Library + fake-indexeddb.

## Global Constraints

- **British English** in all code, comments, copy, commit messages (CLAUDE.md §3.7).
- **TypeScript strict**, `noUncheckedIndexedAccess`. No `any` without an inline justification. No non-null `!` (Biome bans it; the pre-commit hook runs Biome).
- **SPDX header** on every new source file: `// SPDX-License-Identifier: AGPL-3.0-only`.
- **Mobile-first 380 px**, single `lg` breakpoint. This task ships **minimal functional CSS only** — no design-language pass.
- **Run `pnpm typecheck --force` from the repo root before every commit** (Turbo caches typecheck; a test-touching change can get a stale pass). Biome runs in the pre-commit hook.
- Frontend tests via **Vitest**: `cd apps/user-client && pnpm vitest run <path>`.
- Known baseline: exactly **8** pre-existing `localStorage` failures in the full suite (Node 26 environmental). A 9th is real.
- Commit co-author: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `apps/user-client/src/routes/app/persona-memory.tsx` — the `PersonaMemory` page (header + actions + pending + committed + body).
- **Create** `apps/user-client/tests/routes/persona-memory.test.tsx` — page behaviour tests.
- **Modify** `apps/user-client/src/App.tsx` — register the route.
- **Modify** `apps/user-client/src/components/chat/Cockpit.tsx` — ◌ pure-navigates; remove `memoryOpen`, `openMemory`, `MemorySheet` mount + import.
- **Modify** `apps/user-client/src/components/persona-editor/MemorySection.tsx` — keep settings (group 1) + add "Manage memory →" link; remove `SavedPersonaMemory` (groups 2 + 3).
- **Modify** `apps/user-client/tests/components/memory-section.test.tsx` — adjust to the trimmed section.
- **Modify** `apps/user-client/src/index.css` — minimal functional `.memory-page-*` rules.
- **Delete** `apps/user-client/src/components/chat/MemorySheet.tsx` and `apps/user-client/tests/components/chat/memory-sheet.test.tsx`.

Data layer is unchanged — see the spec §6 table for the hook inventory.

---

### Task 1: PersonaMemory page skeleton + route + back affordance

**Files:**
- Create: `apps/user-client/src/routes/app/persona-memory.tsx`
- Create: `apps/user-client/tests/routes/persona-memory.test.tsx`
- Modify: `apps/user-client/src/App.tsx`

**Interfaces:**
- Produces: `export function PersonaMemory(): JSX.Element` — route component for `/app/persona/:id/memory`. Reads `id` via `useParams<{ id?: string }>()` and `chat` via `useSearchParams()`. Back target is context-derived: chat path (`chat` present) → `/app/chat/<chat>`; editor path → `/app/persona/<id>`.
- Consumes: `usePersona` from `../../data/personas.js`, `useMarkMemoryViewed`, `useCurrentBody` from `../../data/memory.js`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/routes/persona-memory.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { PersonaMemory } from '../../src/routes/app/persona-memory.js';

function setup(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/persona/:id/memory" element={<PersonaMemory />} />
          <Route path="/app/persona/:id" element={<div data-testid="editor-sentinel">editor</div>} />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel">chat</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  // Minimal persona row — only fields the page reads must be present.
  await getClientDataDb().personas.add({ id: 'p1', name: 'Fable' } as never);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('PersonaMemory — shell', () => {
  it('renders the persona name and Memory heading', async () => {
    setup('/app/persona/p1/memory');
    expect(await screen.findByRole('heading', { name: /memory/i })).toBeInTheDocument();
    expect(screen.getByText('Fable')).toBeInTheDocument();
  });

  it('back goes to the chat when ?chat= is present', async () => {
    setup('/app/persona/p1/memory?chat=c1');
    fireEvent.click(await screen.findByRole('button', { name: /back to chat/i }));
    expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
  });

  it('back goes to the persona editor when no ?chat= is present', async () => {
    setup('/app/persona/p1/memory');
    fireEvent.click(await screen.findByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.getByTestId('editor-sentinel')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: FAIL — cannot resolve `../../src/routes/app/persona-memory.js` (module does not exist).

- [ ] **Step 3: Create the page skeleton**

```tsx
// apps/user-client/src/routes/app/persona-memory.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCurrentBody, useMarkMemoryViewed } from '../../data/memory.js';
import { usePersona } from '../../data/personas.js';

/** The single home for a persona's memory: review/triage journal entries and
 *  view/edit the consolidated body. Reached from the chat cockpit (with ?chat=)
 *  and from the persona editor's "Manage memory" link. */
export function PersonaMemory(): JSX.Element | null {
  const { id } = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const chatId = search.get('chat') ?? '';
  const navigate = useNavigate();

  const personaId = id ?? '';
  const { data: persona } = usePersona(personaId || null);
  const { data: currentBody } = useCurrentBody(personaId);
  const markViewed = useMarkMemoryViewed(personaId);
  const bodyVersion = currentBody?.version ?? 0;

  // Mark the current body version viewed on entry — relocated from the cockpit's
  // open-overlay trigger. Fires from both entry points (deliberate, spec §3.4).
  useEffect(() => {
    if (personaId && bodyVersion > 0) markViewed.mutate(bodyVersion);
    // markViewed is a stable mutation object; depend only on the value that gates the call.
  }, [personaId, bodyVersion]);

  if (!persona) return null;

  const back = (): void =>
    navigate(chatId ? `/app/chat/${chatId}` : `/app/persona/${personaId}`);

  return (
    <section className="memory-page">
      <header className="memory-page-header">
        <button type="button" className="memory-page-back" onClick={back}>
          {chatId ? '← Back to chat' : `← ${persona.name}`}
        </button>
        <h1 className="memory-page-title">Memory</h1>
        <span className="memory-page-persona">{persona.name}</span>
      </header>
    </section>
  );
}
```

- [ ] **Step 4: Register the route**

In `apps/user-client/src/App.tsx`, add the import near the other route imports (alongside `import { PersonaEditor } from './routes/app/persona-editor.js';`):

```tsx
import { PersonaMemory } from './routes/app/persona-memory.js';
```

And add the route inside the `ProtectedRoute` group, immediately after the `/app/persona/:id` line:

```tsx
                  <Route path="/app/persona/:id" element={<PersonaEditor />} />
                  <Route path="/app/persona/:id/memory" element={<PersonaMemory />} />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck --force` (repo root). Expected: 14/14 successful.

```bash
git add apps/user-client/src/routes/app/persona-memory.tsx \
        apps/user-client/tests/routes/persona-memory.test.tsx \
        apps/user-client/src/App.tsx
git commit -m "Add PersonaMemory page shell and route

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Pending + committed entry lists (Commit / Edit / Delete+Undo)

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx`
- Modify: `apps/user-client/tests/routes/persona-memory.test.tsx`

**Interfaces:**
- Consumes: `useJournalEntries`, `useCommittedEntries`, `useCommitEntry`, `useRejectEntry`, `useUpdateEntry` from `../../data/memory.js`; `toastStore` from `../../state/toast.store.js`. Repo seed helper `addJournalEntries` from `../../src/memory/repo.js` (test only).
- Produces: pending entries (Commit · Edit · Delete) and committed entries (Edit · Delete). Delete is immediate with a 5 s Undo toast.

- [ ] **Step 1: Write the failing tests** (append inside the test file)

```tsx
// add these imports at the top of tests/routes/persona-memory.test.tsx
import userEvent from '@testing-library/user-event';
import { addJournalEntries } from '../../src/memory/repo.js';
import { commitEntry } from '../../src/memory/repo.js';

// append after the existing describe block:
describe('PersonaMemory — entries', () => {
  it('lists a pending entry and commits it', async () => {
    await addJournalEntries('p1', [
      { content: 'Likes hiking', category: 'preference', isCorrection: false },
    ]);
    setup('/app/persona/p1/memory?chat=c1');
    expect(await screen.findByText('Likes hiking')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /commit/i }));
    await waitFor(() => expect(screen.queryByText('Likes hiking')).not.toBeInTheDocument());
  });

  it('edits a pending entry', async () => {
    await addJournalEntries('p1', [
      { content: 'old text', category: 'fact', isCorrection: false },
    ]);
    setup('/app/persona/p1/memory?chat=c1');
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const box = screen.getByLabelText(/edit memory/i);
    await userEvent.clear(box);
    await userEvent.type(box, 'new text');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('new text')).toBeInTheDocument();
  });

  it('deletes a pending entry but Undo restores it', async () => {
    await addJournalEntries('p1', [
      { content: 'fragile', category: 'fact', isCorrection: false },
    ]);
    setup('/app/persona/p1/memory?chat=c1');
    await userEvent.click(await screen.findByRole('button', { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText('fragile')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: /undo/i }));
    expect(await screen.findByText('fragile')).toBeInTheDocument();
  });

  it('shows committed entries with edit + delete', async () => {
    await addJournalEntries('p1', [
      { content: 'already known', category: 'fact', isCorrection: false },
    ]);
    const [row] = await import('../../src/memory/repo.js').then((m) =>
      m.listJournal('p1', 'uncommitted'),
    );
    if (row) await commitEntry(row.id);
    setup('/app/persona/p1/memory?chat=c1');
    expect(await screen.findByText('already known')).toBeInTheDocument();
    expect(screen.getByText(/awaiting consolidation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: FAIL — entries are not rendered yet.

- [ ] **Step 3: Implement the entry lists**

Add imports to `persona-memory.tsx`:

```tsx
import { useRef, useState } from 'react';
import {
  useCommitEntry,
  useCommittedEntries,
  useCurrentBody,
  useJournalEntries,
  useMarkMemoryViewed,
  useRejectEntry,
  useUpdateEntry,
} from '../../data/memory.js';
import { toastStore } from '../../state/toast.store.js';
```

(Keep the existing `usePersona`, router and effect imports.) Inside the component, after the existing hooks, add the entry state and the shared delete-with-undo helper:

```tsx
  const { data: uncommitted = [] } = useJournalEntries(personaId, 'uncommitted');
  const { data: committed = [] } = useCommittedEntries(personaId);
  const commit = useCommitEntry(personaId);
  const reject = useRejectEntry(personaId);
  const update = useUpdateEntry(personaId);

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  // Reject = deferred delete + undo. Hide locally, commit the delete after the window.
  // No unmount cleanup: a pending delete must complete; the toast closure keeps
  // clearTimeout reachable even after navigation (relocated from MemorySheet).
  const UNDO_MS = 5000;
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const deleteWithUndo = (id: string): void => {
    setPendingDelete((s) => new Set(s).add(id));
    const t = setTimeout(() => {
      reject.mutate(id);
      timers.current.delete(id);
      setPendingDelete((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, UNDO_MS);
    timers.current.set(id, t);
    toastStore.show({
      message: 'Set aside for now',
      tone: 'info',
      durationMs: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const handle = timers.current.get(id);
          if (handle) clearTimeout(handle);
          timers.current.delete(id);
          setPendingDelete((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        },
      },
    });
  };

  const visiblePending = uncommitted.filter((e) => !pendingDelete.has(e.id));
  const visibleCommitted = committed.filter((e) => !pendingDelete.has(e.id));
```

Add a small inline row renderer just above the `return` (shared by both lists so commit-vs-not is the only difference):

```tsx
  const renderRow = (e: { id: string; content: string }, canCommit: boolean): JSX.Element => (
    <li key={e.id} className="memory-page-entry">
      {editing?.id === e.id ? (
        <>
          <textarea
            aria-label="Edit memory"
            className="memory-page-edit"
            value={editing.text}
            onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })}
          />
          <div className="memory-page-entry-actions">
            <button
              type="button"
              onClick={() => {
                update.mutate({ id: e.id, content: editing.text });
                setEditing(null);
              }}
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="memory-page-entry-content">{e.content}</span>
          <div className="memory-page-entry-actions">
            {canCommit ? (
              <button type="button" onClick={() => commit.mutate(e.id)}>
                Commit
              </button>
            ) : null}
            <button type="button" onClick={() => setEditing({ id: e.id, text: e.content })}>
              Edit
            </button>
            <button type="button" onClick={() => deleteWithUndo(e.id)}>
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
```

Extend the returned JSX (inside `<section className="memory-page">`, after `</header>`):

```tsx
      <div className="memory-page-section">
        <h2 className="memory-page-subhead">Pending</h2>
        {visiblePending.length === 0 ? (
          <p className="memory-page-empty">
            {chatId
              ? `No pending memories. Keep chatting and ${persona.name} will start to remember you.`
              : 'No pending memories yet.'}
          </p>
        ) : (
          <ul className="memory-page-list">{visiblePending.map((e) => renderRow(e, true))}</ul>
        )}
      </div>

      {visibleCommitted.length > 0 ? (
        <div className="memory-page-section">
          <h2 className="memory-page-subhead">Committed, awaiting consolidation</h2>
          <ul className="memory-page-list">{visibleCommitted.map((e) => renderRow(e, false))}</ul>
        </div>
      ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: PASS (all shell + entries tests).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck --force`. Expected: 14/14.

```bash
git add apps/user-client/src/routes/app/persona-memory.tsx \
        apps/user-client/tests/routes/persona-memory.test.tsx
git commit -m "Add pending + committed entry lists to memory page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: The memory body (view/edit/save + versions/restore)

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx`
- Modify: `apps/user-client/tests/routes/persona-memory.test.tsx`

**Interfaces:**
- Consumes: `useBodyVersions`, `useSaveBodyManual`, `useRollbackBody` from `../../data/memory.js`; `AutoSizeTextarea` from `../../components/AutoSizeTextarea.js`; `saveBody` from `../../src/memory/repo.js` (test seed).
- Produces: a body block — editable current body + Save, version list with Restore + a "current" marker.

- [ ] **Step 1: Write the failing tests** (append a describe block)

```tsx
// add at the top of the test file:
import { saveBody } from '../../src/memory/repo.js';

describe('PersonaMemory — body', () => {
  it('shows the current body and saves an edit as a new version', async () => {
    await saveBody('p1', 'remembers v1', 0, 'manual');
    setup('/app/persona/p1/memory');
    const box = await screen.findByLabelText(/memory body/i);
    expect(box).toHaveValue('remembers v1');
    await userEvent.clear(box);
    await userEvent.type(box, 'remembers v2');
    await userEvent.click(screen.getByRole('button', { name: /save memory/i }));
    await waitFor(() => expect(screen.getByText(/v2 ·/i)).toBeInTheDocument());
  });

  it('restores an older version', async () => {
    await saveBody('p1', 'first', 0, 'manual'); // v1
    await saveBody('p1', 'second', 0, 'manual'); // v2
    setup('/app/persona/p1/memory');
    await screen.findByText(/v2 ·/i);
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    // restore re-saves the chosen version as a new newest version (v3)
    await waitFor(() => expect(screen.getByText(/v3 ·/i)).toBeInTheDocument());
  });

  it('shows an empty state when nothing is remembered yet', async () => {
    setup('/app/persona/p1/memory');
    expect(await screen.findByText(/nothing remembered yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: FAIL — body block not rendered.

- [ ] **Step 3: Implement the body block**

Add imports to `persona-memory.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import {
  useBodyVersions,
  useCommitEntry,
  useCommittedEntries,
  useCurrentBody,
  useJournalEntries,
  useMarkMemoryViewed,
  useRejectEntry,
  useRollbackBody,
  useSaveBodyManual,
  useUpdateEntry,
} from '../../data/memory.js';
```

(Replace the existing `data/memory.js` import line with the expanded one above, and merge the `react` import so `useEffect`, `useRef`, `useState` are all imported once.) Add the body hooks + draft state alongside the others:

```tsx
  const { data: versions = [] } = useBodyVersions(personaId);
  const saveBodyManual = useSaveBodyManual(personaId);
  const rollback = useRollbackBody(personaId);

  const [bodyDraft, setBodyDraft] = useState(currentBody?.content ?? '');
  useEffect(() => {
    setBodyDraft(currentBody?.content ?? '');
  }, [currentBody?.content]);
```

Append the body block to the returned JSX, after the committed section:

```tsx
      <div className="memory-page-section">
        <h2 className="memory-page-subhead">The memory itself</h2>
        {versions.length === 0 ? (
          <p className="memory-page-empty">Nothing remembered yet.</p>
        ) : (
          <>
            <AutoSizeTextarea
              aria-label="Memory body"
              minRows={4}
              maxRows={30}
              value={bodyDraft}
              onChange={setBodyDraft}
            />
            <button
              type="button"
              className="memory-page-save-body"
              disabled={bodyDraft.trim() === '' || bodyDraft === (currentBody?.content ?? '')}
              onClick={() => saveBodyManual.mutate(bodyDraft)}
            >
              Save memory
            </button>
            <ul className="memory-page-version-list">
              {versions.map((v) => (
                <li key={v.id}>
                  <span>
                    v{v.version} · {v.source}
                  </span>
                  {v.version !== (currentBody?.version ?? 0) ? (
                    <button type="button" onClick={() => rollback.mutate(v.version)}>
                      Restore
                    </button>
                  ) : (
                    <span className="memory-page-version-current">current</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: PASS (all describes).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck --force`. Expected: 14/14.

```bash
git add apps/user-client/src/routes/app/persona-memory.tsx \
        apps/user-client/tests/routes/persona-memory.test.tsx
git commit -m "Add memory body view/edit/restore to memory page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Actions block (Learn / Consolidate), chat-path only

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx`
- Modify: `apps/user-client/tests/routes/persona-memory.test.tsx`

**Interfaces:**
- Consumes: `useMemoryActions` from `../../lib/use-memory-actions.js`, `useUnextractedCount` from `../../data/memory.js`. Both are **called unconditionally** (rules of hooks) but the block **renders only when `chatId` is truthy**. On the editor path, a single orientation line renders in its place.
- `useMemoryActions(chatId)` resolves credentials lazily **on click**, so rendering it with `chatId=''` is safe and never touches the network.

- [ ] **Step 1: Write the failing tests** (append a describe block)

```tsx
describe('PersonaMemory — actions gating', () => {
  it('shows the actions block on the chat path', async () => {
    setup('/app/persona/p1/memory?chat=c1');
    expect(await screen.findByRole('button', { name: /learn from this chat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /consolidate now/i })).toBeInTheDocument();
  });

  it('omits the actions block and shows an orientation line on the editor path', async () => {
    setup('/app/persona/p1/memory');
    await screen.findByRole('heading', { name: /memory/i });
    expect(screen.queryByRole('button', { name: /learn from this chat/i })).not.toBeInTheDocument();
    expect(screen.getByText(/open a chat with fable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: FAIL — no actions block / orientation line yet.

- [ ] **Step 3: Implement the actions block**

Add imports:

```tsx
import { useMemoryActions } from '../../lib/use-memory-actions.js';
```

Add `useUnextractedCount` to the `data/memory.js` import list. Add the hooks (called unconditionally):

```tsx
  const { data: unextracted = 0 } = useUnextractedCount(chatId);
  const { learnState, consolidateState, learnNow, consolidateNow } = useMemoryActions(chatId);
```

Insert this block into the returned JSX, immediately after `</header>` and before the Pending section:

```tsx
      {chatId ? (
        <div className="memory-page-actions">
          <button
            type="button"
            disabled={unextracted < 1 || learnState.status === 'pending'}
            title={unextracted < 1 ? 'Nothing new to learn yet — keep chatting.' : undefined}
            onClick={() => void learnNow()}
          >
            {learnState.status === 'pending' ? 'Learning…' : 'Learn from this chat'}
          </button>
          <button
            type="button"
            disabled={committed.length < 1 || consolidateState.status === 'pending'}
            title={committed.length < 1 ? 'No committed memories to consolidate yet.' : undefined}
            onClick={() => void consolidateNow()}
          >
            {consolidateState.status === 'pending' ? 'Consolidating…' : 'Consolidate now'}
          </button>
          {learnState.status === 'error' || consolidateState.status === 'error' ? (
            <div className="memory-page-action-error" role="alert">
              <span>
                {learnState.error === 'no-credentials' ||
                consolidateState.error === 'no-credentials'
                  ? 'Credentials unavailable — re-authenticate, then retry.'
                  : "That didn't work."}
              </span>
              <button
                type="button"
                onClick={() =>
                  void (learnState.status === 'error' ? learnNow() : consolidateNow())
                }
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="memory-page-orient">Open a chat with {persona.name} to learn new memories or consolidate.</p>
      )}
```

Note: `committed` is already in scope from Task 2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/routes/persona-memory.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck --force`. Expected: 14/14.

```bash
git add apps/user-client/src/routes/app/persona-memory.tsx \
        apps/user-client/tests/routes/persona-memory.test.tsx
git commit -m "Gate Learn/Consolidate actions to the chat path on memory page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Cockpit ◌ pure-navigates; delete MemorySheet

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Delete: `apps/user-client/src/components/chat/MemorySheet.tsx`
- Delete: `apps/user-client/tests/components/chat/memory-sheet.test.tsx`
- Create/Modify: `apps/user-client/tests/components/chat/cockpit.memory-nav.test.tsx` (new focused test)

**Interfaces:**
- Consumes: `useNavigate` (already imported in Cockpit). The ◌ button now calls `navigate(\`/app/persona/${p.persona.id}/memory?chat=${p.chatId}\`)`.
- The uncommitted-count badge and the `memoryActive` highlight stay. `aria-expanded` is removed.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/components/chat/cockpit.memory-nav.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
  type PersonaRow,
} from '../../../src/boot/client-data-db.js';
import { Cockpit } from '../../../src/components/chat/Cockpit.js';

// NB: import the real Cockpit. If Cockpit needs many props, prefer asserting on the
// memory button's navigation. Keep the persona minimal.
const persona = { id: 'p1', name: 'Fable', useMemory: true } as PersonaRow;

function renderCockpit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/chat/c1']}>
        <Routes>
          <Route
            path="/app/chat/:chatId"
            element={
              <Cockpit
                persona={persona}
                chatId="c1"
                draftValue=""
                onDraftChange={() => {}}
                onSend={() => {}}
                onStop={() => {}}
                isStreamLive={false}
                onOpenToc={() => {}}
                onOpenArtefacts={() => {}}
                onTogglePin={() => {}}
                voiceUnavailable={null}
                dictation={
                  {
                    uiState: 'idle',
                    failed: false,
                    captureError: null,
                    retry: () => {},
                    discard: () => {},
                  } as never
                }
              />
            }
          />
          <Route
            path="/app/persona/:id/memory"
            element={<div data-testid="memory-sentinel">memory</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('Cockpit memory button', () => {
  it('navigates to the persona memory page with the chat id', async () => {
    renderCockpit();
    fireEvent.click(screen.getByRole('button', { name: /chat memory/i }));
    expect(await screen.findByTestId('memory-sentinel')).toBeInTheDocument();
  });
});
```

> Implementer note: `Cockpit`'s prop surface may differ slightly from the stub above — open `Cockpit.tsx`'s `Props` interface and supply exactly the required props (TypeScript will tell you which are missing). The behavioural assertion (clicking "Chat memory" lands on the memory route) is what matters; adjust the prop scaffold to satisfy the type, do not change the assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/cockpit.memory-nav.test.tsx`
Expected: FAIL — the button still toggles the overlay; no navigation occurs.

- [ ] **Step 3: Rewire the ◌ button and remove the overlay**

In `apps/user-client/src/components/chat/Cockpit.tsx`:

1. Remove the import line `import { MemorySheet } from './MemorySheet.js';` (line ~36).
2. Remove `const [memoryOpen, setMemoryOpen] = useState(false);` (line ~116).
3. Remove the `openMemory` helper (lines ~234–240). Keep `markViewed`, `useCurrentBody`, `usePersona`, `useUncommittedCount`, `bodyVersion`, `lastViewed`, `memoryActive` — they still drive the badge/highlight. The mark-viewed-on-open behaviour moves to the page (Task 1), so `markViewed` is no longer called here; remove the now-unused `markViewed` binding (line ~229) to avoid an unused-variable lint error.
4. Replace the memory button (lines ~512–528) with:

```tsx
        <button
          type="button"
          className={`cockpit-icon-btn${uncommittedCount > 0 || memoryActive ? ' active' : ''}`}
          data-control="memory"
          aria-label="Chat memory"
          onClick={() => navigate(`/app/persona/${p.persona.id}/memory?chat=${p.chatId}`)}
        >
          <span className="cockpit-glyph" aria-hidden="true">
            ◌
          </span>
          {uncommittedCount > 0 ? (
            <span className="cockpit-control-count" aria-hidden="true">
              {uncommittedCount}
            </span>
          ) : null}
        </button>
```

5. Remove the overlay mount (lines ~638–640):

```tsx
      {memoryOpen && (
        <MemorySheet persona={p.persona} chatId={p.chatId} onClose={() => setMemoryOpen(false)} />
      )}
```

- [ ] **Step 4: Delete the dead overlay + its test**

```bash
git rm apps/user-client/src/components/chat/MemorySheet.tsx \
       apps/user-client/tests/components/chat/memory-sheet.test.tsx
```

- [ ] **Step 5: Run the new test + verify nothing imports MemorySheet**

Run: `cd apps/user-client && pnpm vitest run tests/components/chat/cockpit.memory-nav.test.tsx`
Expected: PASS.

Run: `rg -n "MemorySheet" apps/user-client/src apps/user-client/tests`
Expected: no matches.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck --force`. Expected: 14/14 (catches any leftover `memoryOpen`/`markViewed` reference).

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx \
        apps/user-client/tests/components/chat/cockpit.memory-nav.test.tsx
git commit -m "Navigate to memory page from cockpit; remove MemorySheet overlay

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Trim MemorySection to settings + "Manage memory →" link

**Files:**
- Modify: `apps/user-client/src/components/persona-editor/MemorySection.tsx`
- Modify: `apps/user-client/tests/components/memory-section.test.tsx`

**Interfaces:**
- `MemorySection` keeps its existing props (`personaId`, `useMemory`, `memoryInstructions`, `onChange`). It retains **only group 1** (toggle + instructions) and adds a `Link` to `/app/persona/<personaId>/memory` for a saved persona; the unsaved-persona hint is unchanged. `SavedPersonaMemory` and its imports (`useBodyVersions`, `useCommittedEntries`, `useCurrentBody`, `useRollbackBody`, `useSaveBodyManual`, `AutoSizeTextarea`) are removed.

- [ ] **Step 1: Update the test**

Open `apps/user-client/tests/components/memory-section.test.tsx` and replace any assertions about the body/committed display with the trimmed contract. The section must be rendered inside a router because it now uses `Link`. Representative tests:

```tsx
// ensure these imports exist:
import { MemoryRouter } from 'react-router-dom';

// wrap render in a MemoryRouter, e.g.:
//   render(<MemoryRouter><MemorySection {...props} /></MemoryRouter>)

it('shows a Manage memory link for a saved persona', () => {
  render(
    <MemoryRouter>
      <MemorySection
        personaId="p1"
        useMemory={true}
        memoryInstructions=""
        onChange={() => {}}
      />
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: /manage memory/i });
  expect(link).toHaveAttribute('href', '/app/persona/p1/memory');
});

it('shows the build-as-you-chat hint for an unsaved persona', () => {
  render(
    <MemoryRouter>
      <MemorySection personaId={null} useMemory={true} memoryInstructions="" onChange={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/available after you save/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /manage memory/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/components/memory-section.test.tsx`
Expected: FAIL — no "Manage memory" link yet.

- [ ] **Step 3: Trim the component**

Replace the entire body of `apps/user-client/src/components/persona-editor/MemorySection.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { AutoSizeTextarea } from '../AutoSizeTextarea.js';

interface Props {
  personaId: string | null;
  useMemory: boolean;
  memoryInstructions: string;
  onChange: (patch: { useMemory?: boolean; memoryInstructions?: string }) => void;
}

/** Memory settings for the persona editor: the on/off toggle, the
 *  "what to remember" instructions, and a link into the full memory page.
 *  The memory content itself (entries, body, versions) lives on
 *  /app/persona/:id/memory — a single home, not duplicated here. */
export function MemorySection({
  personaId,
  useMemory,
  memoryInstructions,
  onChange,
}: Props): JSX.Element {
  return (
    <div className="memory-section">
      <div className="memory-section-settings">
        <div className="memory-toggle-row">
          <span>Remember across conversations</span>
          <button
            type="button"
            aria-label="Memory"
            aria-pressed={useMemory}
            onClick={() => onChange({ useMemory: !useMemory })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              useMemory ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                useMemory ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        <AutoSizeTextarea
          aria-label="What to remember"
          placeholder="e.g. remember my projects, my tone preferences, the people I mention"
          minRows={2}
          maxRows={10}
          value={memoryInstructions}
          onChange={(v) => onChange({ memoryInstructions: v })}
        />
      </div>

      {personaId == null ? (
        <p className="memory-section-hint">
          Memory builds as you chat — available after you save this companion.
        </p>
      ) : (
        <Link className="memory-section-link" to={`/app/persona/${personaId}/memory`}>
          Manage memory →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/components/memory-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck --force`. Expected: 14/14.

```bash
git add apps/user-client/src/components/persona-editor/MemorySection.tsx \
        apps/user-client/tests/components/memory-section.test.tsx
git commit -m "Trim MemorySection to settings plus Manage-memory link

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Minimal functional CSS + full-suite verification

**Files:**
- Modify: `apps/user-client/src/index.css`

**Interfaces:** none (presentation). This is the one task with no unit test — styling is verified by build + manual device check (spec §9). Deliberately minimal; the design-language pass is separate.

- [ ] **Step 1: Add the CSS block**

Append to `apps/user-client/src/index.css` (place near the other sheet/route blocks):

```css
/* ===== Memory page (functional placeholder; design-language pass deferred) ==== */
.memory-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem 1rem 3rem;
  max-width: 48rem;
  margin: 0 auto;
}
.memory-page-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.memory-page-back {
  align-self: flex-start;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.8;
  cursor: pointer;
  padding: 0.25rem 0;
}
.memory-page-title {
  font-size: 1.5rem;
}
.memory-page-persona {
  opacity: 0.7;
  font-size: 0.9rem;
}
.memory-page-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.memory-page-subhead {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.6;
}
.memory-page-empty,
.memory-page-orient {
  opacity: 0.6;
  font-size: 0.9rem;
}
.memory-page-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.memory-page-entry {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.5rem;
}
.memory-page-entry-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.memory-page-entry-actions button,
.memory-page-actions button,
.memory-page-save-body {
  padding: 0.35rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.375rem;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  cursor: pointer;
}
.memory-page-entry-actions button:disabled,
.memory-page-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.memory-page-edit,
.memory-page-entry textarea {
  width: 100%;
  min-height: 4rem;
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.375rem;
  padding: 0.5rem;
}
.memory-page-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.memory-page-action-error {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
}
.memory-page-version-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  opacity: 0.85;
}
.memory-page-version-list li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}
.memory-page-version-current {
  opacity: 0.6;
}
.memory-section-link {
  align-self: flex-start;
  opacity: 0.85;
  text-decoration: underline;
}
```

- [ ] **Step 2: Build to verify the CSS compiles**

Run: `pnpm --filter @chatsundere/user-client build` (or `pnpm run build` at repo root).
Expected: build succeeds.

- [ ] **Step 3: Run the FULL user-client suite**

Run: `cd apps/user-client && pnpm vitest run`
Expected: all green **except** the known 8 `localStorage` baseline failures. Confirm the count is exactly 8 and that none of the failures are memory-related. If a memory test fails, fix it before committing.

- [ ] **Step 4: Final typecheck + commit**

Run: `pnpm typecheck --force`. Expected: 14/14.

```bash
git add apps/user-client/src/index.css
git commit -m "Add minimal functional CSS for the memory page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3.1 new route + page → Task 1 ✓
- §3.2 entry points (cockpit nav + editor link) → Task 5 (cockpit) + Task 6 (editor link) ✓
- §3.3 removals (MemorySheet, SavedPersonaMemory out of MemorySection, group 3 not orphaned) → Task 5 + Task 6 (full component replacement removes groups 2 & 3) ✓
- §3.4 mark-viewed relocated to page, fires from both paths → Task 1 (effect) + Task 5 (removed from cockpit) ✓
- §4.1 explicit context-derived back → Task 1 ✓
- §4.2 actions chat-path only + editor orientation line → Task 4 ✓
- §4.3 pending entries commit/edit/delete+undo, path-aware empty state → Task 2 ✓
- §4.4 committed entries edit/delete → Task 2 ✓
- §4.5 body view/edit/save + versions/restore → Task 3 ✓
- §4.6 uniform delete-with-undo → Task 2 (shared `deleteWithUndo`) ✓
- §5 minimal functional CSS → Task 7 ✓
- §7 testing (each behaviour) → Tasks 1–6 tests; full-suite + 8-baseline check → Task 7 ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one judgement call (Cockpit prop scaffold in Task 5) is flagged with an explicit implementer note because the `Props` interface is large and the behavioural assertion is what matters.

**Type consistency:** Hook names match `src/data/memory.ts` exactly (`useJournalEntries`, `useCommittedEntries`, `useCommitEntry`, `useRejectEntry`, `useUpdateEntry`, `useCurrentBody`, `useBodyVersions`, `useSaveBodyManual`, `useRollbackBody`, `useMarkMemoryViewed`, `useUnextractedCount`). `useMemoryActions(chatId)` matches `src/lib/use-memory-actions.ts`. Repo seeds (`addJournalEntries`, `commitEntry`, `listJournal`, `saveBody`) match `src/memory/repo.ts`. `deleteWithUndo` is defined and used only in Task 2. CSS class names used in JSX (Tasks 1–4) all appear in the Task 7 stylesheet.
