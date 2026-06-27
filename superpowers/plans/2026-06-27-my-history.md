# My History Makeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/app/history` (My History) in the design language — `PageScaffold` + `cs-row` rows with persona avatars, NSFW badges, a `⋯` actions menu, and `ConfirmDialog` delete — without any data/schema change.

**Architecture:** Lift the route shell onto `PageScaffold`/`useHelp`/`cs-segmented`, rewrite `HistoryRow` and `BookmarksList` to the shared `cs-row` grammar, restyle the persona dropdown, and retire the bespoke `.history-*`/`.bookmark-*` chrome + `HistoryRowConfirmTray`. All query hooks and filter/search/URL logic are ported verbatim. Client-only; not a Larissa path.

**Tech Stack:** React 18, TypeScript (strict), Vite, Tailwind v4, Vitest + Testing Library, the existing `components/ui/*` primitives (`OverflowMenu`, `Badge`, `ConfirmDialog`, `PageScaffold`), `PersonaAvatar`.

**Spec:** `superpowers/specs/2026-06-27-my-history-makeover-design.md`

**Key facts the implementer must not get wrong:**
- The persona NSFW flag is **`persona.adultPersona`** (boolean), **not** `persona.nsfw` (`nsfw` is the *libraries* field).
- `.toc-entry-*` CSS classes are **shared with the in-chat Table-of-Contents** (`components/chat/TocSheet.tsx`) — **never retire them**. The current `BookmarksList` borrows them; the rewrite stops borrowing but the classes stay for `TocSheet`.
- All test files live under `apps/user-client/tests/`, not beside the source.
- Run all commands from `apps/user-client/`.

---

### Task 1: `historyCountLabel` pure helper

**Files:**
- Create: `apps/user-client/src/lib/history-count.ts`
- Test: `apps/user-client/tests/unit/history-count.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/unit/history-count.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { historyCountLabel } from '../../src/lib/history-count';

describe('historyCountLabel', () => {
  it('reads "empty" when there are no chats at all', () => {
    expect(historyCountLabel(0, 0)).toBe('empty');
  });

  it('reads "N chats" when nothing is filtered out', () => {
    expect(historyCountLabel(5, 5)).toBe('5 chats');
  });

  it('uses the singular for one chat', () => {
    expect(historyCountLabel(1, 1)).toBe('1 chat');
  });

  it('reads "N of M" when a filter narrows the set', () => {
    expect(historyCountLabel(8, 3)).toBe('3 of 8');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/history-count.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/history-count`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/user-client/src/lib/history-count.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The My History header count for the Chats tab. `total` is how many chats the
 * user could see (after NSFW persona gating); `shown` is how many survive the
 * active persona filter + title search.
 *
 * - `empty` when there are no chats at all,
 * - `N chats` (singular `1 chat`) when no filter hides anything,
 * - `N of M` when a filter narrows the set — so the header never reads
 *   "8 chats" above three rows.
 *
 * @param total Chats visible to the user (after NSFW gating).
 * @param shown How many of those survive the active filter + search.
 */
export function historyCountLabel(total: number, shown: number): string {
  if (total === 0) return 'empty';
  if (shown >= total) return `${total} ${total === 1 ? 'chat' : 'chats'}`;
  return `${shown} of ${total}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/history-count.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/history-count.ts apps/user-client/tests/unit/history-count.test.ts
git commit -m "Add historyCountLabel helper for My History"
```

---

### Task 2: My History help doc + registration

**Files:**
- Create: `apps/user-client/src/content/help/history.md`
- Modify: `apps/user-client/src/content/help/index.ts`

- [ ] **Step 1: Create the help doc**

Create `apps/user-client/src/content/help/history.md`:

```markdown
# My History

Every conversation you have collects here, the most recently active first. This
is the place to return to a chat, rename it, or clear out the ones you no longer
need — nothing is created on this page.

## Chats and bookmarks

The two tabs at the top switch between your **Chats** — every conversation, one
row each — and your **Bookmarks**, the individual messages you have starred,
grouped by the chat they live in.

## Finding a conversation

Search by title at any time, and narrow to a single companion with the persona
dropdown. The count tells you how many chats match. Tap any row to drop straight
back into that conversation.

## Per-chat actions

The **⋯** menu on a chat holds everything else: rename it, start a fresh chat
with the same companion, jump to that companion, or delete the chat. Deleting is
permanent, and if the chat owns any artefacts they go with it — you are told how
many before you confirm.

## Bookmarks

On the Bookmarks tab, tap a starred message to jump to it in its chat. The star
removes the bookmark; the **⋯** renames its label.
```

- [ ] **Step 2: Register the doc in `index.ts`**

In `apps/user-client/src/content/help/index.ts`:

Add the import (keep alphabetical, after the `changePassphrase` import):

```ts
import history from './history.md?raw';
```

Add `'history'` to the `HelpKey` union (after `'change-passphrase'`):

```ts
  | 'change-passphrase'
  | 'history'
```

Add the `HELP_DOCS` entry (after the `change-passphrase` entry):

```ts
  history: { title: 'My History — help', markdown: history },
```

- [ ] **Step 3: Verify it type-checks**

Run: `pnpm typecheck`
Expected: no errors (the `HelpKey` union now includes `'history'`, so `useHelp('history')` will resolve in Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/content/help/history.md apps/user-client/src/content/help/index.ts
git commit -m "Add My History help doc and register it"
```

---

### Task 3: Rewrite `HistoryRow` to the `cs-row` grammar

**Files:**
- Rewrite: `apps/user-client/src/components/history/HistoryRow.tsx`
- Modify: `apps/user-client/src/index.css` (add `.cs-row-title[data-compact]` + `.history-avatar` orb scoping)
- Rewrite test: `apps/user-client/tests/unit/history-row.test.tsx`
- Delete: `apps/user-client/src/components/history/HistoryRowConfirmTray.tsx` + `apps/user-client/tests/unit/history-row-confirm-tray.test.tsx`

- [ ] **Step 1: Add the CSS this row needs**

In `apps/user-client/src/index.css`, immediately AFTER the `.cs-row-title { … }` block (around line 4963), add:

```css
/* My History chat title sits 1px under the row default (spec §3). */
.cs-row-title[data-compact] {
  font-size: 12px;
}
/* Persona avatar wrapper in a history row — anchors the live-stream orb to the
   avatar's top-right corner instead of the row's. */
.history-avatar {
  position: relative;
  display: inline-flex;
}
.history-avatar .streaming-orb {
  top: -2px;
  right: -2px;
}
```

- [ ] **Step 2: Rewrite the failing test**

Replace `apps/user-client/tests/unit/history-row.test.tsx` ENTIRELY with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ChatRow, PersonaRow } from '../../src/boot/client-data-db';
import { HistoryRow } from '../../src/components/history/HistoryRow';

const persona: PersonaRow = {
  id: 'p1',
  name: 'Aurum',
  tagline: '',
  colour: '#c9a84c',
  font: 'serif',
  instructions: '',
  canonicalId: null,
  providerId: '',
  modelId: '',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  adultPersona: false,
  chatsundereTonality: true,
  contextWindow: null,
  libraryIds: [],
  askExpertDefault: false,
  mcpOverrides: {},
  roleplay: false,
  narration: 'first',
  greetingEnabled: false,
  greetingInstructions: '',
  voice: null,
  narratorVoice: null,
  createdAt: 0,
  updatedAt: 0,
};
const chat: ChatRow = {
  id: 'c1',
  personaId: 'p1',
  title: 'Topic here',
  resolvedMindspaceId: 'm1',
  createdAt: new Date('2026-05-26T10:00:00').getTime(),
  lastMessageAt: new Date('2026-05-26T11:55:00').getTime(),
  bookmarkedMessageCount: 0,
  draftInput: '',
  libraryIds: [],
};

function wrap(ui: React.ReactElement, recordPath?: (p: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/history']}>
        <Routes>
          <Route path="/app/history" element={ui} />
          <Route
            path="/app/chat/:chatId"
            element={<Probe label="chat" record={recordPath} />}
          />
          <Route path="/app/chat/new" element={<Probe label="new" record={recordPath} />} />
          <Route
            path="/app/persona/:id"
            element={<Probe label="persona" record={recordPath} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Probe({ label }: { label: string; record?: (p: string) => void }): JSX.Element {
  return <div data-testid={`route-${label}`}>{label}</div>;
}

describe('HistoryRow', () => {
  it('renders the persona avatar and the chat title', () => {
    render(wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />));
    expect(screen.getByLabelText('Aurum avatar')).toBeTruthy();
    expect(screen.getByText('Topic here')).toBeTruthy();
  });

  it('shows the NSFW badge only for an adult persona', () => {
    const { rerender } = render(
      wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />),
    );
    expect(screen.queryByText('NSFW')).toBeNull();
    rerender(
      wrap(
        <HistoryRow
          chat={chat}
          persona={{ ...persona, adultPersona: true }}
          onRename={() => {}}
          onDelete={() => {}}
        />,
      ),
    );
    expect(screen.getByText('NSFW')).toBeTruthy();
  });

  it('opens the chat when the row body is tapped', () => {
    render(wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />));
    fireEvent.click(screen.getByText('Topic here'));
    expect(screen.getByTestId('route-chat')).toBeTruthy();
  });

  it('lists the four actions in the overflow menu', () => {
    render(wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />));
    fireEvent.click(screen.getByLabelText('Chat actions'));
    expect(screen.getByText('Rename')).toBeTruthy();
    expect(screen.getByText('New chat with this persona')).toBeTruthy();
    expect(screen.getByText('Go to persona')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('enters inline rename mode from the menu', () => {
    render(wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={() => {}} />));
    fireEvent.click(screen.getByLabelText('Chat actions'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByDisplayValue('Topic here')).toBeTruthy();
  });

  it('opens a confirm dialog from the menu and deletes on confirm', () => {
    const onDelete = vi.fn();
    render(wrap(<HistoryRow chat={chat} persona={persona} onRename={() => {}} onDelete={onDelete} />));
    fireEvent.click(screen.getByLabelText('Chat actions'));
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete this chat?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/history-row.test.tsx`
Expected: FAIL (the current `HistoryRow` has no `Chat actions` menu / NSFW badge).

- [ ] **Step 4: Rewrite the component**

Replace `apps/user-client/src/components/history/HistoryRow.tsx` ENTIRELY with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatRow, PersonaRow } from '../../boot/client-data-db.js';
import { useChatArtefactCount } from '../../data/artefacts.js';
import { displayTitle } from '../../lib/chat-title.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';
import { PersonaAvatar } from '../PersonaAvatar.js';
import { StreamingOrb } from '../StreamingOrb.js';
import { Badge } from '../ui/Badge.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { HistoryRowRenameInput } from './HistoryRowRenameInput.js';

interface Props {
  chat: ChatRow;
  persona: PersonaRow;
  onRename: (next: string | null) => void;
  onDelete: () => void;
}

/**
 * One chat in My History, in the shared `cs-row` grammar: persona avatar leading
 * (with the live-stream orb pinned to its corner), the chat title (1px under the
 * row default) over `persona · age`, then an NSFW badge (adult personas only) +
 * a `⋯` menu trailing. Every secondary action — rename, new chat, go to persona,
 * delete — lives in the menu so the row body stays a single tap into the chat.
 */
export function HistoryRow({ chat, persona, onRename, onDelete }: Props): JSX.Element {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Only fetch the artefact count while the delete dialog is open — avoids
  // loading artefact content for every row just to render a warning count.
  const artefactCountQuery = useChatArtefactCount(chat.id, confirmDelete);
  const artefactCount = artefactCountQuery.data ?? 0;

  const leading = (
    <span className="cs-row-leading">
      <span className="history-avatar">
        <PersonaAvatar personaId={persona.id} name={persona.name} colour={persona.colour} size={40} />
        <StreamingOrb personaId={persona.id} colour={persona.colour} />
      </span>
    </span>
  );
  const subtitle = (
    <span className="cs-row-subtitle">
      <span style={{ color: persona.colour, opacity: 0.8 }}>{persona.name}</span>
      {' · '}
      {relativeTimeLabel(chat.lastMessageAt)}
    </span>
  );

  return (
    <div className="cs-row" data-history-row={chat.id}>
      {renaming ? (
        <div className="cs-row-main" style={{ cursor: 'default' }}>
          {leading}
          <span className="cs-row-body">
            <HistoryRowRenameInput
              initialValue={chat.title ?? ''}
              onCommit={(next) => {
                setRenaming(false);
                onRename(next);
              }}
              onCancel={() => setRenaming(false)}
            />
            {subtitle}
          </span>
        </div>
      ) : (
        <button
          type="button"
          data-row-body
          className="cs-row-main"
          onClick={() => navigate(`/app/chat/${chat.id}`)}
        >
          {leading}
          <span className="cs-row-body">
            <span className="cs-row-title" data-compact style={{ color: persona.colour }}>
              {displayTitle(chat)}
            </span>
            {subtitle}
          </span>
        </button>
      )}

      <span className="cs-row-trailing">
        {persona.adultPersona ? <Badge tone="danger">NSFW</Badge> : null}
        <OverflowMenu
          triggerLabel="Chat actions"
          items={[
            { label: 'Rename', onSelect: () => setRenaming(true) },
            {
              label: 'New chat with this persona',
              onSelect: () => navigate(`/app/chat/new?personaId=${persona.id}`),
            },
            {
              label: 'Go to persona',
              onSelect: () =>
                navigate(
                  `/app/persona/${persona.id}?return=${encodeURIComponent(
                    `/app/history?personaId=${persona.id}`,
                  )}`,
                ),
            },
            { label: 'Delete', tone: 'destructive', onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </span>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this chat?"
        body={
          artefactCount > 0
            ? `This will also delete ${artefactCount} artefact${artefactCount === 1 ? '' : 's'}. This cannot be undone.`
            : 'This cannot be undone.'
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Delete the retired confirm-tray + its test**

```bash
git rm apps/user-client/src/components/history/HistoryRowConfirmTray.tsx \
       apps/user-client/tests/unit/history-row-confirm-tray.test.tsx
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/history-row.test.tsx`
Expected: PASS (6 tests).

Run: `pnpm typecheck`
Expected: no errors. (Confirms nothing else imported `HistoryRowConfirmTray`.)

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/history/HistoryRow.tsx \
        apps/user-client/src/index.css \
        apps/user-client/tests/unit/history-row.test.tsx
git commit -m "Rebuild HistoryRow as a cs-row with avatar, NSFW badge, overflow menu"
```

---

### Task 4: Rewrite `BookmarksList` to the `cs-row` grammar

**Files:**
- Rewrite: `apps/user-client/src/components/history/BookmarksList.tsx`
- Create test: `apps/user-client/tests/unit/bookmarks-list.test.tsx`

The rewrite reuses existing primitives — `PersonaAvatar`, `cs-row`, `treasury-row-star` (the visible star), `OverflowMenu`, and `HistoryRowRenameInput` — so it needs **no new CSS** and stops borrowing `.toc-entry-*` (which stays for `TocSheet`). The grouped structure and `onJump` contract are preserved.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/unit/bookmarks-list.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkGroup } from '../../src/data/bookmarks';
import { BookmarksList } from '../../src/components/history/BookmarksList';

const mockToggle = vi.fn();
const mockSetLabel = vi.fn(() => Promise.resolve());
vi.mock('../../src/data/chats', () => ({
  useToggleBookmark: () => ({ mutateAsync: mockToggle }),
}));
vi.mock('../../src/data/bookmarks', async (orig) => {
  const actual = await orig<typeof import('../../src/data/bookmarks')>();
  return { ...actual, useSetBookmarkLabel: () => ({ mutateAsync: mockSetLabel }) };
});

function makeGroup(): BookmarkGroup {
  return {
    chat: {
      id: 'c1',
      personaId: 'p1',
      title: 'Long talk',
      resolvedMindspaceId: 'm1',
      createdAt: 0,
      lastMessageAt: 10,
      bookmarkedMessageCount: 1,
      draftInput: '',
      libraryIds: [],
    },
    persona: {
      id: 'p1',
      name: 'Aurum',
      colour: '#c9a84c',
      // biome-ignore lint/suspicious/noExplicitAny: test fixture only needs id/name/colour
    } as any,
    bookmarks: [{ message: { id: 'm-1' } as any, label: 'a key line' }],
  };
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BookmarksList', () => {
  it('renders a group header with the persona avatar and chat title', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    expect(screen.getByLabelText('Aurum avatar')).toBeTruthy();
    expect(screen.getByText('Long talk')).toBeTruthy();
    expect(screen.getByText('a key line')).toBeTruthy();
  });

  it('jumps to the message when an entry is tapped', () => {
    const onJump = vi.fn();
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={onJump} />));
    fireEvent.click(screen.getByText('a key line'));
    expect(onJump).toHaveBeenCalledWith('c1', 'm-1');
  });

  it('removes the bookmark when the visible star is tapped', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    fireEvent.click(screen.getByLabelText('Remove bookmark'));
    expect(mockToggle).toHaveBeenCalledWith('m-1');
  });

  it('renames inline from the overflow menu', () => {
    render(wrap(<BookmarksList groups={[makeGroup()]} onJump={() => {}} />));
    fireEvent.click(screen.getByLabelText('Bookmark actions'));
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByDisplayValue('a key line')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/bookmarks-list.test.tsx`
Expected: FAIL (no `Bookmark actions` menu / `Remove bookmark` label yet).

- [ ] **Step 3: Rewrite the component**

Replace `apps/user-client/src/components/history/BookmarksList.tsx` ENTIRELY with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { type BookmarkGroup, useSetBookmarkLabel } from '../../data/bookmarks.js';
import { useToggleBookmark } from '../../data/chats.js';
import { displayTitle } from '../../lib/chat-title.js';
import { PersonaAvatar } from '../PersonaAvatar.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { HistoryRowRenameInput } from './HistoryRowRenameInput.js';

interface Props {
  groups: BookmarkGroup[];
  /** Navigate into a chat focused on a message. */
  onJump: (chatId: string, messageId: string) => void;
}

/** Global bookmarks, grouped by chat (most-recently-active first), in the
 *  design language: an avatar-led group header per chat, then `cs-row` entries
 *  with a visible remove-star and a `⋯`-housed rename. */
export function BookmarksList(p: Props): JSX.Element {
  const setLabel = useSetBookmarkLabel();
  const toggleBookmark = useToggleBookmark();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      {p.groups.map((g) => (
        <section key={g.chat.id} className="flex flex-col gap-1.5">
          <header className="flex items-center gap-2 px-1">
            {g.persona ? (
              <PersonaAvatar
                personaId={g.persona.id}
                name={g.persona.name}
                colour={g.persona.colour}
                size={28}
              />
            ) : null}
            <h3
              className="truncate font-display text-sm"
              style={g.persona?.colour ? { color: g.persona.colour } : undefined}
            >
              {displayTitle(g.chat)}
            </h3>
          </header>

          {g.bookmarks.map((b) => (
            <div className="cs-row" key={b.message.id}>
              {editingId === b.message.id ? (
                <div className="cs-row-main" style={{ cursor: 'default' }}>
                  <span className="cs-row-body">
                    <HistoryRowRenameInput
                      initialValue={b.label}
                      maxLength={80}
                      onCommit={(next) => {
                        setEditingId(null);
                        void setLabel.mutateAsync({
                          messageId: b.message.id,
                          label: next === null || next.trim() === '' ? null : next.trim(),
                        });
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="cs-row-main"
                  data-role={b.message.role}
                  onClick={() => p.onJump(g.chat.id, b.message.id)}
                >
                  <span className="cs-row-body">
                    <span className="cs-row-title" data-compact>
                      {b.label}
                    </span>
                  </span>
                </button>
              )}

              <span className="cs-row-trailing">
                <button
                  type="button"
                  className="treasury-row-star"
                  data-active
                  aria-label="Remove bookmark"
                  onClick={() => void toggleBookmark.mutateAsync(b.message.id)}
                >
                  <span aria-hidden>★</span>
                </button>
                <OverflowMenu
                  triggerLabel="Bookmark actions"
                  items={[{ label: 'Rename', onSelect: () => setEditingId(b.message.id) }]}
                />
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

NOTE: this passes `maxLength` to `HistoryRowRenameInput`. Check the component's props at `apps/user-client/src/components/history/HistoryRowRenameInput.tsx`. If it does **not** already accept an optional `maxLength?: number`, add it: thread it onto the underlying `<input maxLength={maxLength}>` with a default of `80` (the previous bookmark cap) — a backward-compatible addition (the chat rename caller omits it). If it already supports it, leave it. Either way the empty-groups case is handled by the route (Task 6), so this component assumes `groups` is non-empty.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/bookmarks-list.test.tsx`
Expected: PASS (4 tests).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/history/BookmarksList.tsx \
        apps/user-client/src/components/history/HistoryRowRenameInput.tsx \
        apps/user-client/tests/unit/bookmarks-list.test.tsx
git commit -m "Rebuild BookmarksList in the cs-row grammar with avatar headers"
```

---

### Task 5: Restyle the persona filter dropdown to the `cs-*` token family

**Files:**
- Modify: `apps/user-client/src/index.css` (the `.persona-dropdown*` block, ~lines 2316–2395)

Markup, props, and behaviour are unchanged — this is a pure CSS reskin so the dropdown matches the design language (rounded-13px popover, `cs-*` dark surface, accent-highlighted selection). The persona colour dots stay.

- [ ] **Step 1: Reskin the dropdown CSS**

In `apps/user-client/src/index.css`, update the `.persona-dropdown*` rules so they read from the design tokens. Replace the existing `.persona-dropdown-trigger`, `.persona-dropdown-list`, and `.persona-dropdown-option` rules with these (keep `.persona-dropdown`, `-value`, `-chevron`, `-dot` as they are unless a value below supersedes them):

```css
.persona-dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--color-paper);
  font-family: var(--font-sans);
  font-size: 13px;
  cursor: pointer;
}
.persona-dropdown-trigger:hover {
  background: rgba(255, 255, 255, 0.05);
}
.persona-dropdown-list {
  margin-top: 6px;
  padding: 4px;
  border-radius: 13px;
  background: var(--color-ink, #14101c);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}
.persona-dropdown-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 9px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-paper-soft);
  text-align: left;
  cursor: pointer;
}
.persona-dropdown-option:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-paper);
}
.persona-dropdown-option[data-selected] {
  background: rgba(141, 109, 255, 0.12);
  color: var(--color-paper);
}
```

If `--color-ink` does not resolve in this codebase, use the literal `#14101c` fallback already inlined above (keep the `var(--color-ink, #14101c)` form so a real token wins if present). Confirm by grepping: `rg -n "color-ink" apps/user-client/src/index.css`.

- [ ] **Step 2: Verify the dropdown render test still passes**

The dropdown has no dedicated unit test; it is covered via the route test (Task 6). Run the build to confirm the CSS parses:

Run: `pnpm typecheck`
Expected: no errors (CSS is not type-checked, but this confirms nothing imports a now-missing token at TS level — it won't).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Restyle the persona filter dropdown to the design language"
```

---

### Task 6: Rewrite the My History route shell

**Files:**
- Rewrite: `apps/user-client/src/routes/app/history.tsx`
- Rewrite test: `apps/user-client/tests/unit/history-route.test.tsx`
- Modify: `apps/user-client/src/index.css` (retire `.history-tabs` / `.history-tab` — replaced by `cs-segmented`)

- [ ] **Step 1: Rewrite the route**

Replace `apps/user-client/src/routes/app/history.tsx` ENTIRELY with:

```tsx
// apps/user-client/src/routes/app/history.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarksList } from '../../components/history/BookmarksList.js';
import { HistoryRow } from '../../components/history/HistoryRow.js';
import { HistorySearchBar } from '../../components/history/HistorySearchBar.js';
import { PersonaFilterDropdown } from '../../components/history/PersonaFilterDropdown.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useBookmarks } from '../../data/bookmarks.js';
import { useChats, useDeleteChat, useUpdateChat } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useSettings } from '../../data/settings.js';
import { displayTitle } from '../../lib/chat-title.js';
import { historyCountLabel } from '../../lib/history-count.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { onHelp, helpOverlay } = useHelp('history');
  const chats = useChats();
  const personas = useFilteredPersonas();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const setMindspace = useMindspaceStore((s) => s.update);
  const updateChat = useUpdateChat();
  const deleteChat = useDeleteChat();

  const initialPersonaId = search.get('personaId');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(initialPersonaId);
  const [tab, setTab] = useState<'chats' | 'bookmarks'>('chats');
  const bookmarks = useBookmarks();

  // Reset mindspace to user-default on mount — History is a neutral surface.
  useEffect(() => {
    if (!settings.data || !mindspaces.data) return;
    setMindspace({
      persona: null,
      defaultMindspaceId: settings.data.defaultMindspaceId,
      defaultTexture: settings.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [settings.data, mindspaces.data, setMindspace]);

  // Auto-reset persona filter to All when the selected persona stops being
  // visible (e.g. NSFW → SFW flip while an NSFW persona was selected). When
  // `mode` flips, `personas.data` changes (via useFilteredPersonas), which
  // already re-triggers this effect.
  useEffect(() => {
    if (!filterPersonaId || !personas.data) return;
    const stillVisible = personas.data.some((p) => p.id === filterPersonaId);
    if (!stillVisible) {
      setFilterPersonaId(null);
      const next = new URLSearchParams(search);
      next.delete('personaId');
      setSearch(next, { replace: true });
    }
  }, [filterPersonaId, personas.data, search, setSearch]);

  // Mirror filterPersonaId state into the URL.
  useEffect(() => {
    const cur = search.get('personaId');
    if ((cur ?? null) === filterPersonaId) return;
    const next = new URLSearchParams(search);
    if (filterPersonaId) next.set('personaId', filterPersonaId);
    else next.delete('personaId');
    setSearch(next, { replace: true });
  }, [filterPersonaId, search, setSearch]);

  const visiblePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((p) => p.id)),
    [personas.data],
  );
  const personaById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof personas.data>[number]>();
    for (const p of personas.data ?? []) m.set(p.id, p);
    return m;
  }, [personas.data]);

  // Chats visible after NSFW gating — the count's denominator.
  const gatedChats = useMemo(
    () => (chats.data ?? []).filter((c) => visiblePersonaIds.has(c.personaId)),
    [chats.data, visiblePersonaIds],
  );
  const visibleChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return gatedChats
      .filter((c) => filterPersonaId === null || c.personaId === filterPersonaId)
      .filter((c) => q === '' || displayTitle(c).toLowerCase().includes(q));
  }, [gatedChats, filterPersonaId, searchQuery]);

  const filterPersonaName = filterPersonaId ? personaById.get(filterPersonaId)?.name : undefined;

  // Bookmarks filtered by the same persona selector + a label substring search,
  // NSFW-aware (groups whose persona is hidden in SFW mode drop out). Groups
  // with no surviving bookmarks after the label filter are removed.
  const visibleBookmarkGroups = useMemo(() => {
    const all = bookmarks.data ?? [];
    const q = searchQuery.trim().toLowerCase();
    return all
      .filter((g) => visiblePersonaIds.has(g.chat.personaId))
      .filter((g) => filterPersonaId === null || g.chat.personaId === filterPersonaId)
      .map((g) =>
        q === ''
          ? g
          : { ...g, bookmarks: g.bookmarks.filter((b) => b.label.toLowerCase().includes(q)) },
      )
      .filter((g) => g.bookmarks.length > 0);
  }, [bookmarks.data, visiblePersonaIds, filterPersonaId, searchQuery]);

  function clearFilter(): void {
    setFilterPersonaId(null);
    setSearchQuery('');
  }

  return (
    <PageScaffold crumbs={[{ label: 'My History' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-12 pt-4">
        <div className="cs-segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chats'}
            className="cs-seg"
            data-active={tab === 'chats' || undefined}
            onClick={() => setTab('chats')}
          >
            Chats
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bookmarks'}
            className="cs-seg"
            data-active={tab === 'bookmarks' || undefined}
            onClick={() => setTab('bookmarks')}
          >
            Bookmarks
          </button>
        </div>

        <HistorySearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={tab === 'chats' ? 'Search chats by title…' : 'Search bookmarks by title…'}
        />
        <PersonaFilterDropdown
          personas={personas.data ?? []}
          selectedId={filterPersonaId}
          onChange={setFilterPersonaId}
        />

        {tab === 'chats' ? (
          <>
            <span className="text-[11px] uppercase tracking-widest text-paper-soft">
              {historyCountLabel(gatedChats.length, visibleChats.length)}
            </span>
            {visibleChats.length === 0 ? (
              <ChatsEmptyState
                filterPersonaId={filterPersonaId}
                filterPersonaName={filterPersonaName}
                searchActive={searchQuery.trim() !== ''}
                onClearFilter={clearFilter}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {visibleChats.map((c) => {
                  const p = personaById.get(c.personaId);
                  if (!p) return null;
                  return (
                    <HistoryRow
                      key={c.id}
                      chat={c}
                      persona={p}
                      onRename={(next) =>
                        void updateChat.mutateAsync({ id: c.id, patch: { title: next } })
                      }
                      onDelete={() => void deleteChat.mutateAsync(c.id)}
                    />
                  );
                })}
              </div>
            )}
          </>
        ) : visibleBookmarkGroups.length === 0 ? (
          <div className="mt-8 grid place-items-center text-center text-paper-soft">
            <p className="font-display text-lg italic text-paper">
              {(bookmarks.data ?? []).length === 0
                ? 'No bookmarks yet.'
                : 'No bookmarks match your filter.'}
            </p>
            {(bookmarks.data ?? []).length === 0 ? (
              <p className="mt-2 max-w-xs text-sm">Star a message in any chat to find it here.</p>
            ) : (
              <button type="button" className="cs-btn mt-3" onClick={clearFilter}>
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <BookmarksList
            groups={visibleBookmarkGroups}
            onJump={(chatId, messageId) => navigate(`/app/chat/${chatId}?focus=${messageId}`)}
          />
        )}
      </div>
    </PageScaffold>
  );
}

function ChatsEmptyState({
  filterPersonaId,
  filterPersonaName,
  searchActive,
  onClearFilter,
}: {
  filterPersonaId: string | null;
  filterPersonaName?: string;
  searchActive: boolean;
  onClearFilter: () => void;
}): JSX.Element {
  if (searchActive) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No chats match your search.</p>
        <button type="button" className="cs-btn mt-3" onClick={onClearFilter}>
          Clear filter
        </button>
      </div>
    );
  }
  if (filterPersonaId && filterPersonaName) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">
          No chats with {filterPersonaName} yet.
        </p>
        <div className="mt-3 flex gap-2">
          <Link to={`/app/chat/new?personaId=${filterPersonaId}`} className="cs-btn">
            Start a new one
          </Link>
          <button type="button" className="cs-btn" onClick={onClearFilter}>
            Clear filter
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8 grid place-items-center text-center text-paper-soft">
      <p className="font-display text-lg italic text-paper">No chats yet.</p>
      <p className="mt-2 max-w-xs text-sm">Pick a persona and</p>
      <Link to="/app/circle" className="cs-btn mt-2">
        Start a conversation
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Update the route test to the new chrome**

Open `apps/user-client/tests/unit/history-route.test.tsx`. The previous test queried `.history-row` rows; the new list renders `.cs-row` rows with `data-history-row`. Update every row selector from `.history-row` to `[data-history-row]`, and keep the existing render/mocking harness. Specifically:
- Replace `document.querySelectorAll('.history-row')` with `document.querySelectorAll('[data-history-row]')` (all occurrences).
- Replace any `document.querySelector('.history-row')` with `document.querySelector('[data-history-row]')`.
- If the test renders `<HistoryPage />` directly under a `MemoryRouter`, it must now also tolerate the `PageScaffold`/`PageBar` chrome — these render fine in jsdom and need no extra providers. Leave the persona/chats mocks unchanged.

Run: `pnpm vitest run tests/unit/history-route.test.tsx`
Expected: initially FAIL on the selector mismatch; after the selector edits, PASS. Fix any remaining assertion that depended on retired markup (e.g. a `.history-tab` class → now `.cs-seg`).

- [ ] **Step 3: Retire the dead tab CSS**

In `apps/user-client/src/index.css`, delete the `.history-tabs` and `.history-tab` (and any `.history-tab[data-active]`) rules — the tabs are now `cs-segmented`/`cs-seg`. Confirm they are unused first:

Run: `rg -n "history-tab" apps/user-client/src`
Expected: no source references remain (only the deleted CSS). Then remove those CSS blocks.

- [ ] **Step 4: Run the route test + typecheck**

Run: `pnpm vitest run tests/unit/history-route.test.tsx`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/history.tsx \
        apps/user-client/src/index.css \
        apps/user-client/tests/unit/history-route.test.tsx
git commit -m "Rebuild the My History route shell on PageScaffold + cs-segmented"
```

---

### Task 7: Retire remaining dead CSS + full gates

**Files:**
- Modify: `apps/user-client/src/index.css` (retire `.history-row*`, `.bookmark-*`; KEEP `.toc-entry-*`)

- [ ] **Step 1: Find and retire the now-dead history/bookmark CSS**

Run: `rg -n "history-row|bookmark-group|bookmark-entry|bookmark-row" apps/user-client/src`
Expected: matches ONLY in `index.css` (no `.tsx` references — the rewrites dropped them). For each such CSS rule with no source consumer, delete it.

Then confirm the shared ToC classes are still owned by `TocSheet` and were NOT touched:

Run: `rg -n "toc-entry" apps/user-client/src --glob '*.tsx'`
Expected: matches in `components/chat/TocSheet.tsx` (the `.toc-entry-*` CSS stays).

- [ ] **Step 2: Run the full user-client test suite**

Run: `pnpm vitest run`
Expected: PASS at the known baseline (the project's standing baseline is "8 Node-localStorage" pre-existing failures; the new history-count / history-row / bookmarks-list / history-route tests are green). If any NON-baseline test fails, fix it before continuing.

- [ ] **Step 3: Typecheck (forced, full)**

Run: `pnpm typecheck --force`
Expected: 14/14 packages clean.

- [ ] **Step 4: Production build**

Run (from repo root): `pnpm run build`
Expected: full build succeeds (the design-language surfaces build to 9/9 as in prior makeover squashes).

- [ ] **Step 5: Biome**

Run: `pnpm biome check apps/user-client/src/routes/app/history.tsx apps/user-client/src/components/history/`
Expected: clean (no lint/format issues). Fix any reported issue.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Retire dead My History and bookmark CSS"
```

---

## Post-implementation (Liz, not a plan task)

After all seven tasks: **opus whole-branch review**, then **Laura pre-squash pass** (verify the built flow honours the spec intent; she will eyeball the 380 px trailing cluster — SOFT-3, and the title truncation with a long NSFW-persona name). Fold findings, then squash on a `feat/my-history` branch and update `obsidian/STATUS-CLIENT-ONLY.md`. **Liz does not push.** Not a Larissa path (client-only; no `packages/crypto`, auth/sync/proxy touch).

## Manual verification (Chris, on device)

See spec §11 — avatars per row, NSFW badge in adult mode only, the four `⋯` actions (incl. Go-to-persona returning to filtered History), ConfirmDialog artefact warning, smaller title, bookmarks grouped with avatars + visible star + `⋯` rename, restyled persona dropdown, `?`-help.
