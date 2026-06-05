# Bookmarks & Table of Contents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every chat an auto-populated table-of-contents (all user messages, ChatGPT-style) plus named, starrable bookmarks surfaced through one unified data operation, reachable from a ghostly reading-mode floating control and aggregated in a global History tab.

**Architecture:** A message gains a `bookmarkLabel` (non-indexed, no Dexie migration) on top of the existing `bookmarked` flag, which *is* the star/global-bookmark. The per-chat ToC is **derived** (pure `buildToc()` over the chat's messages) — nothing new is stored for the timeline. A new reading-mode floating control opens a ToC overlay sheet; jumps land in Reading Mode via `data-msg-id` + `scrollIntoView`. The global view is a segmented tab inside `/app/history`.

**Tech Stack:** React 18 + TypeScript (strict), Zustand (`current-chat.store`), TanStack Query over Dexie v8, Vitest. Client-only — **no Larissa, no backend, no crypto path**.

---

## File structure

**Create:**
- `apps/user-client/src/lib/toc.ts` — pure `snippet()`, `labelFor()`, `buildToc()`.
- `apps/user-client/src/lib/scroll-to-message.ts` — `scrollToMessage()` jump helper.
- `apps/user-client/src/data/bookmarks.ts` — `useSetBookmarkLabel()`, `useBookmarks()`.
- `apps/user-client/src/components/chat/ReadingToolStrip.tsx` — the floating control.
- `apps/user-client/src/components/chat/TocSheet.tsx` — the per-chat ToC overlay.
- `apps/user-client/src/components/history/BookmarksList.tsx` — global grouped view.
- One test per file above. **Test-location convention (firm in this repo):**
  tests live under `apps/user-client/tests/<mirror>/…` (NOT co-located in
  `src/`), importing source via `../../src/…`. E.g. `lib/toc.ts` → test at
  `tests/lib/toc.test.ts`. The per-task `Test:` paths below say `src/…` for
  brevity but MUST be created under `tests/<mirror>/`.

**Modify:**
- `apps/user-client/src/boot/client-data-db.ts` — add `bookmarkLabel?: string | null` to `MessageRow` (type-only; no migration).
- `apps/user-client/src/data/queryKeys.ts` — add `bookmarks`.
- `apps/user-client/src/data/chats.ts` — `useToggleBookmark` also invalidates `QK.bookmarks`.
- `apps/user-client/src/state/current-chat.store.ts` — tool-strip state + actions.
- `apps/user-client/src/components/chat/ChatStream.tsx` — wire the real bookmark toggle.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — mount strip + sheet, `?focus=` jump.
- `apps/user-client/src/routes/app/history.tsx` — segmented `Chats | Bookmarks` tab.

**Commit convention:** free-form imperative, `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. These are task-commits to be squashed into one feature commit at the end.

---

## Task 1: ToC derivation (`lib/toc.ts`) + `MessageRow.bookmarkLabel`

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (MessageRow interface, ~line 102)
- Create: `apps/user-client/src/lib/toc.ts`
- Test: `apps/user-client/src/lib/toc.test.ts`

- [ ] **Step 1: Add the field to `MessageRow`**

In `client-data-db.ts`, extend the interface (no `.version()` change — non-indexed):

```ts
export interface MessageRow {
  id: string;
  chatId: string;
  role: 'user' | 'persona' | 'system';
  contentBlocks: ContentBlock[];
  createdAt: number;
  bookmarked: boolean;
  /** Custom bookmark name. `null`/absent ⇒ derive the default snippet from
   *  the message text. Non-indexed: Dexie stores it schemalessly, so adding
   *  it needs no version bump. */
  bookmarkLabel?: string | null;
  streamingState: 'complete' | 'incomplete';
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/user-client/src/lib/toc.test.ts
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../boot/client-data-db.js';
import { buildToc, labelFor, snippet } from './toc.js';

function msg(p: Partial<MessageRow> & { id: string }): MessageRow {
  return {
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello world' }],
    createdAt: 0,
    bookmarked: false,
    streamingState: 'complete',
    ...p,
  };
}

describe('snippet', () => {
  it('returns the full first line when short', () => {
    expect(snippet(msg({ id: 'a', contentBlocks: [{ type: 'text', text: 'short one' }] }))).toBe(
      'short one',
    );
  });
  it('trims on a word boundary with an ellipsis when long', () => {
    const long = 'the quick brown fox jumps over the lazy dog and keeps running forever';
    const out = snippet(msg({ id: 'a', contentBlocks: [{ type: 'text', text: long }] }));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).not.toMatch(/\s…$/);
  });
  it('uses only the first line', () => {
    expect(
      snippet(msg({ id: 'a', contentBlocks: [{ type: 'text', text: 'first\nsecond' }] })),
    ).toBe('first');
  });
});

describe('labelFor', () => {
  it('prefers a non-empty custom label', () => {
    expect(labelFor(msg({ id: 'a', bookmarkLabel: 'My note' }))).toBe('My note');
  });
  it('falls back to the snippet when label is null/empty/whitespace', () => {
    expect(labelFor(msg({ id: 'a', bookmarkLabel: null }))).toBe('hello world');
    expect(labelFor(msg({ id: 'a', bookmarkLabel: '   ' }))).toBe('hello world');
  });
});

describe('buildToc', () => {
  const messages: MessageRow[] = [
    msg({ id: 'u1', role: 'user', createdAt: 1, contentBlocks: [{ type: 'text', text: 'u-one' }] }),
    msg({ id: 'p1', role: 'persona', createdAt: 2, bookmarked: true, contentBlocks: [{ type: 'text', text: 'p-one' }] }),
    msg({ id: 'u2', role: 'user', createdAt: 3, bookmarked: true, bookmarkLabel: 'Named', contentBlocks: [{ type: 'text', text: 'u-two' }] }),
  ];

  it('timeline lists only user messages, in createdAt order', () => {
    const toc = buildToc(messages);
    expect(toc.timeline.map((e) => e.messageId)).toEqual(['u1', 'u2']);
  });
  it('pinned lists all starred messages (user + persona), in order', () => {
    const toc = buildToc(messages);
    expect(toc.pinned.map((e) => e.messageId)).toEqual(['p1', 'u2']);
  });
  it('marks isDefaultLabel correctly and carries the resolved label', () => {
    const toc = buildToc(messages);
    const u2Timeline = toc.timeline.find((e) => e.messageId === 'u2');
    expect(u2Timeline?.label).toBe('Named');
    expect(u2Timeline?.isDefaultLabel).toBe(false);
    const u1Timeline = toc.timeline.find((e) => e.messageId === 'u1');
    expect(u1Timeline?.label).toBe('u-one');
    expect(u1Timeline?.isDefaultLabel).toBe(true);
    expect(u1Timeline?.starred).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/lib/toc.test.ts`
Expected: FAIL — `Cannot find module './toc.js'`.

- [ ] **Step 4: Implement `lib/toc.ts`**

```ts
// apps/user-client/src/lib/toc.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow } from '../boot/client-data-db.js';
import { flattenAnswerText } from './content-blocks.js';

export interface TocEntry {
  messageId: string;
  label: string;
  role: MessageRow['role'];
  starred: boolean;
  /** True when `label` is the derived snippet (no custom bookmarkLabel). */
  isDefaultLabel: boolean;
}

export interface Toc {
  pinned: TocEntry[];
  timeline: TocEntry[];
}

const SNIPPET_MAX = 40;

/** Short, word-boundary-trimmed label derived from a message's answer text. */
export function snippet(message: MessageRow): string {
  const firstLine = (flattenAnswerText(message.contentBlocks).split('\n')[0] ?? '').trim();
  if (firstLine.length <= SNIPPET_MAX) return firstLine;
  const cut = firstLine.slice(0, SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${base}…`;
}

/** Resolved display label: a non-empty custom label, else the snippet. */
export function labelFor(message: MessageRow): string {
  const custom = message.bookmarkLabel ?? null;
  return custom && custom.trim() !== '' ? custom : snippet(message);
}

function toEntry(m: MessageRow): TocEntry {
  const custom = m.bookmarkLabel ?? null;
  const hasCustom = custom !== null && custom.trim() !== '';
  return {
    messageId: m.id,
    label: hasCustom ? custom : snippet(m),
    role: m.role,
    starred: m.bookmarked === true,
    isDefaultLabel: !hasCustom,
  };
}

/** Build the two-section ToC. Timeline = all user messages (ChatGPT-style
 *  auto-index); pinned = all starred messages (user + persona). Both ordered
 *  by createdAt. */
export function buildToc(messages: MessageRow[]): Toc {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  return {
    pinned: ordered.filter((m) => m.bookmarked === true).map(toEntry),
    timeline: ordered.filter((m) => m.role === 'user').map(toEntry),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/lib/toc.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/toc.ts apps/user-client/src/lib/toc.test.ts apps/user-client/src/boot/client-data-db.ts
git commit -m "Add ToC derivation and bookmarkLabel field

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Jump helper (`lib/scroll-to-message.ts`)

**Files:**
- Create: `apps/user-client/src/lib/scroll-to-message.ts`
- Test: `apps/user-client/src/lib/scroll-to-message.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/scroll-to-message.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollToMessage } from './scroll-to-message.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('scrollToMessage', () => {
  it('returns false when no element matches', () => {
    expect(scrollToMessage('missing')).toBe(false);
  });

  it('scrolls the matching element into view and pulses, then clears', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.setAttribute('data-msg-id', 'm1');
    const scrollSpy = vi.fn();
    // jsdom does not implement scrollIntoView — install a spy.
    (el as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;
    document.body.appendChild(el);

    expect(scrollToMessage('m1')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(el.classList.contains('msg-focus-pulse')).toBe(true);

    vi.runAllTimers();
    expect(el.classList.contains('msg-focus-pulse')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/lib/scroll-to-message.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/user-client/src/lib/scroll-to-message.ts
// SPDX-License-Identifier: AGPL-3.0-only

const HIGHLIGHT_CLASS = 'msg-focus-pulse';
const HIGHLIGHT_MS = 1600;

/** Scroll the message with the given id into view (centred) and play a brief
 *  highlight pulse. Returns false when the element is not currently in the
 *  DOM. `scrollIntoView` is guarded for jsdom, which omits it. */
export function scrollToMessage(messageId: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(messageId)}"]`);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/lib/scroll-to-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/scroll-to-message.ts apps/user-client/src/lib/scroll-to-message.test.ts
git commit -m "Add scroll-to-message jump helper

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Bookmark data layer (`data/bookmarks.ts`) + query key + invalidation

**Files:**
- Modify: `apps/user-client/src/data/queryKeys.ts`
- Modify: `apps/user-client/src/data/chats.ts` (`useToggleBookmark.onSuccess`, ~line 120-124)
- Create: `apps/user-client/src/data/bookmarks.ts`
- Test: `apps/user-client/src/data/bookmarks.test.ts`

- [ ] **Step 1: Add the query key**

In `queryKeys.ts`, inside the `QK` object:

```ts
  chat: (id: string) => ['chats', id] as const,
  bookmarks: ['bookmarks'] as const,
};
```

- [ ] **Step 2: Invalidate bookmarks on toggle**

In `chats.ts`, `useToggleBookmark.onSuccess` becomes:

```ts
    onSuccess: () => {
      // Broad invalidation — we don't know which chat query is mounted.
      void qc.invalidateQueries({ queryKey: QK.chats });
      void qc.invalidateQueries({ queryKey: ['chats'] });
      void qc.invalidateQueries({ queryKey: QK.bookmarks });
    },
```

- [ ] **Step 3: Write the failing test**

This test drives the DB directly (no React) — it exercises the query/mutation
functions through Dexie via `getClientDataDb()`. Follow the existing
`client-data-db` test setup (fake-indexeddb is already wired into the
user-client Vitest env).

```ts
// apps/user-client/src/data/bookmarks.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getClientDataDb } from '../boot/client-data-db.js';
import { bookmarkGroups, setBookmarkLabel } from './bookmarks.js';

async function seed() {
  const db = getClientDataDb();
  await db.chats.add({
    id: 'c1', personaId: 'p1', title: 'Chat one', resolvedMindspaceId: 'm1',
    createdAt: 10, lastMessageAt: 30, bookmarkedMessageCount: 1, draftInput: '',
  });
  await db.personas.add({
    // minimal persona row — extra required fields per PersonaRow get defaults
    // in the real schema; cast through unknown for the test fixture.
  } as never);
  await db.messages.bulkAdd([
    { id: 'u1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'first' }], createdAt: 11, bookmarked: false, streamingState: 'complete' },
    { id: 'u2', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'starred one' }], createdAt: 12, bookmarked: true, streamingState: 'complete' },
  ]);
}

beforeEach(async () => {
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.personas.clear();
  await seed();
});

describe('setBookmarkLabel', () => {
  it('writes a custom label and can clear it back to null', async () => {
    await setBookmarkLabel({ messageId: 'u2', label: 'Important' });
    expect((await getClientDataDb().messages.get('u2'))?.bookmarkLabel).toBe('Important');
    await setBookmarkLabel({ messageId: 'u2', label: null });
    expect((await getClientDataDb().messages.get('u2'))?.bookmarkLabel).toBe(null);
  });
});

describe('bookmarkGroups', () => {
  it('returns only starred messages, grouped by chat, label-resolved', async () => {
    const groups = await bookmarkGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.chat.id).toBe('c1');
    expect(groups[0]?.bookmarks.map((b) => b.message.id)).toEqual(['u2']);
    expect(groups[0]?.bookmarks[0]?.label).toBe('starred one');
  });

  it('reflects a custom label', async () => {
    await setBookmarkLabel({ messageId: 'u2', label: 'My pin' });
    const groups = await bookmarkGroups();
    expect(groups[0]?.bookmarks[0]?.label).toBe('My pin');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/data/bookmarks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `data/bookmarks.ts`**

The hooks wrap pure async helpers (`setBookmarkLabel`, `bookmarkGroups`) so the
DB logic is unit-testable without React.

```ts
// apps/user-client/src/data/bookmarks.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChatRow,
  type MessageRow,
  type PersonaRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { labelFor } from '../lib/toc.js';
import { QK } from './queryKeys.js';

export interface BookmarkGroup {
  chat: ChatRow;
  persona: PersonaRow | null;
  bookmarks: { message: MessageRow; label: string }[];
}

/** Set or clear a message's custom bookmark label. */
export async function setBookmarkLabel(args: {
  messageId: string;
  label: string | null;
}): Promise<void> {
  await getClientDataDb().messages.update(args.messageId, { bookmarkLabel: args.label });
}

/** All starred messages, grouped by chat (most-recently-active chat first),
 *  each bookmark carrying its resolved display label. */
export async function bookmarkGroups(): Promise<BookmarkGroup[]> {
  const db = getClientDataDb();
  const starred = await db.messages.filter((m) => m.bookmarked === true).toArray();
  if (starred.length === 0) return [];

  const byChat = new Map<string, MessageRow[]>();
  for (const m of starred) {
    const arr = byChat.get(m.chatId) ?? [];
    arr.push(m);
    byChat.set(m.chatId, arr);
  }

  const groups: BookmarkGroup[] = [];
  for (const [chatId, msgs] of byChat) {
    const chat = await db.chats.get(chatId);
    if (!chat) continue; // orphaned star (chat deleted) — skip defensively
    const persona = (await db.personas.get(chat.personaId)) ?? null;
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    groups.push({
      chat,
      persona,
      bookmarks: msgs.map((m) => ({ message: m, label: labelFor(m) })),
    });
  }
  groups.sort((a, b) => b.chat.lastMessageAt - a.chat.lastMessageAt);
  return groups;
}

/** Reactive list of all starred bookmarks grouped by chat. */
export function useBookmarks() {
  return useQuery({ queryKey: QK.bookmarks, queryFn: bookmarkGroups });
}

/** Set/clear a message's custom bookmark label; invalidates chat + bookmark caches. */
export function useSetBookmarkLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setBookmarkLabel,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
      void qc.invalidateQueries({ queryKey: QK.bookmarks });
    },
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/data/bookmarks.test.ts`
Expected: PASS. (If the `personas.add` fixture cast trips the schema, drop the
persona seed — `bookmarkGroups` tolerates a missing persona via `?? null`, and
the test does not assert on persona.)

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/data/bookmarks.ts apps/user-client/src/data/bookmarks.test.ts apps/user-client/src/data/queryKeys.ts apps/user-client/src/data/chats.ts
git commit -m "Add bookmark data layer (labels + grouped global query)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Tool-strip state in `current-chat.store`

**Files:**
- Modify: `apps/user-client/src/state/current-chat.store.ts`
- Test: `apps/user-client/src/state/current-chat.store.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/state/current-chat.store.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from './current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().reset());

describe('reading tool-strip state', () => {
  it('starts collapsed and unpinned', () => {
    const s = useCurrentChatStore.getState();
    expect(s.isToolStripExpanded).toBe(false);
    expect(s.isToolStripPinned).toBe(false);
  });

  it('setToolStripExpanded toggles expansion', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(true);
  });

  it('collapseToolStripIfUnpinned collapses when not pinned', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    useCurrentChatStore.getState().collapseToolStripIfUnpinned();
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(false);
  });

  it('collapseToolStripIfUnpinned is a no-op when pinned', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    useCurrentChatStore.getState().toggleToolStripPin(); // → pinned
    useCurrentChatStore.getState().collapseToolStripIfUnpinned();
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(true);
  });

  it('reset clears tool-strip state', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    useCurrentChatStore.getState().toggleToolStripPin();
    useCurrentChatStore.getState().reset();
    const s = useCurrentChatStore.getState();
    expect(s.isToolStripExpanded).toBe(false);
    expect(s.isToolStripPinned).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/state/current-chat.store.test.ts`
Expected: FAIL — `setToolStripExpanded is not a function`.

- [ ] **Step 3: Implement**

In `current-chat.store.ts`, add to the `CurrentChatStore` interface (after `isPinned`):

```ts
  /** Reading-mode floating tool-strip: separate from `isPinned` (the cockpit). */
  isToolStripExpanded: boolean;
  isToolStripPinned: boolean;
```

Add to the action declarations (after `togglePin`):

```ts
  setToolStripExpanded: (open: boolean) => void;
  toggleToolStripPin: () => void;
  /** Collapse the strip unless the user pinned it open. */
  collapseToolStripIfUnpinned: () => void;
```

Add both action names to the `InitialState` `Omit<...>` union:

```ts
  | 'setToolStripExpanded'
  | 'toggleToolStripPin'
  | 'collapseToolStripIfUnpinned'
```

Add to the `initial` object:

```ts
  isToolStripExpanded: false,
  isToolStripPinned: false,
```

Add the implementations inside `create(...)` (after `togglePin`):

```ts
  setToolStripExpanded: (open) => set({ isToolStripExpanded: open }),
  toggleToolStripPin: () => set((s) => ({ isToolStripPinned: !s.isToolStripPinned })),
  collapseToolStripIfUnpinned: () =>
    set((s) => (s.isToolStripPinned ? {} : { isToolStripExpanded: false })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/state/current-chat.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/current-chat.store.ts apps/user-client/src/state/current-chat.store.test.ts
git commit -m "Add reading-mode tool-strip state to current-chat store

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Floating control (`ReadingToolStrip.tsx`)

The strip is store-driven and self-contained: it owns the dismiss-on-outside-
interaction listener (pointerdown / keydown / wheel in capture phase). When
expanded and unpinned, any of those events whose target is outside the strip
collapses it — covering "click elsewhere, type, scroll, open the cockpit"
(the cockpit affordance is outside the strip).

**Files:**
- Create: `apps/user-client/src/components/chat/ReadingToolStrip.tsx`
- Test: `apps/user-client/src/components/chat/ReadingToolStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/src/components/chat/ReadingToolStrip.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import { ReadingToolStrip } from './ReadingToolStrip.js';

beforeEach(() => useCurrentChatStore.getState().reset());

describe('ReadingToolStrip', () => {
  it('collapsed: shows only the toggle, no actions', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    expect(screen.getByRole('button', { name: /show tools/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /bookmarks/i })).toBeNull();
  });

  it('expands on toggle and reveals pin + bookmark', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    expect(screen.getByRole('button', { name: /keep tools open/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /bookmarks/i })).toBeTruthy();
  });

  it('bookmark button calls onOpenToc', () => {
    const onOpenToc = vi.fn();
    render(<ReadingToolStrip onOpenToc={onOpenToc} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /bookmarks/i }));
    expect(onOpenToc).toHaveBeenCalledOnce();
  });

  it('collapses on an outside pointerdown when unpinned', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    fireEvent.pointerDown(document.body);
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(false);
  });

  it('stays open on an outside pointerdown when pinned', () => {
    render(<ReadingToolStrip onOpenToc={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep tools open/i })); // pin
    fireEvent.pointerDown(document.body);
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/components/chat/ReadingToolStrip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/user-client/src/components/chat/ReadingToolStrip.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import { useCurrentChatStore } from '../../state/current-chat.store.js';

interface Props {
  /** Open the per-chat ToC / bookmarks sheet. */
  onOpenToc: () => void;
}

/**
 * Ghostly, self-revealing reading-mode control, top-right. Collapsed it is a
 * single drop-down arrow; expanded it reveals a pin and the bookmark/ToC
 * button (more icons land here later). Unpinned, it collapses on the first
 * interaction outside the strip.
 */
export function ReadingToolStrip(p: Props): JSX.Element {
  const expanded = useCurrentChatStore((s) => s.isToolStripExpanded);
  const pinned = useCurrentChatStore((s) => s.isToolStripPinned);
  const setExpanded = useCurrentChatStore((s) => s.setToolStripExpanded);
  const togglePin = useCurrentChatStore((s) => s.toggleToolStripPin);
  const collapseIfUnpinned = useCurrentChatStore((s) => s.collapseToolStripIfUnpinned);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss-on-outside-interaction. Active only while expanded; pinned strips
  // ignore it (the store action guards). Capture phase so we see the event
  // before downstream handlers (e.g. opening the cockpit) consume it.
  useEffect(() => {
    if (!expanded) return undefined;
    const onOutside = (e: Event): void => {
      const target = e.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      collapseIfUnpinned();
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onOutside, true);
    document.addEventListener('wheel', onOutside, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onOutside, true);
      document.removeEventListener('wheel', onOutside, true);
    };
  }, [expanded, collapseIfUnpinned]);

  return (
    <div ref={rootRef} className="reading-tool-strip" data-expanded={expanded || undefined}>
      <button
        type="button"
        className="tool-strip-toggle"
        aria-label={expanded ? 'Hide tools' : 'Show tools'}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span aria-hidden>▾</span>
      </button>
      {expanded ? (
        <div className="tool-strip-actions">
          <button
            type="button"
            className="tool-strip-btn"
            data-active={pinned || undefined}
            aria-pressed={pinned}
            aria-label="Keep tools open"
            onClick={togglePin}
          >
            <span aria-hidden>📌</span>
          </button>
          <button
            type="button"
            className="tool-strip-btn"
            aria-label="Bookmarks and contents"
            onClick={p.onOpenToc}
          >
            <span aria-hidden>◈</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/components/chat/ReadingToolStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/ReadingToolStrip.tsx apps/user-client/src/components/chat/ReadingToolStrip.test.tsx
git commit -m "Add reading-mode floating tool-strip

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: ToC overlay sheet (`TocSheet.tsx`)

**Files:**
- Create: `apps/user-client/src/components/chat/TocSheet.tsx`
- Test: `apps/user-client/src/components/chat/TocSheet.test.tsx`

The sheet derives its content via `buildToc(messages)`. It wraps its mutating
actions in a QueryClientProvider at the call site (chat-page already has one);
the test provides its own.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/src/components/chat/TocSheet.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../boot/client-data-db.js';
import { TocSheet } from './TocSheet.js';

function wrap(ui: JSX.Element) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const messages: MessageRow[] = [
  { id: 'u1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello there' }], createdAt: 1, bookmarked: false, streamingState: 'complete' },
  { id: 'p1', chatId: 'c1', role: 'persona', contentBlocks: [{ type: 'text', text: 'persona reply' }], createdAt: 2, bookmarked: true, streamingState: 'complete' },
  { id: 'u2', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'second user' }], createdAt: 3, bookmarked: true, streamingState: 'complete' },
];

describe('TocSheet', () => {
  it('renders a pinned section and a full user-message timeline', () => {
    wrap(<TocSheet messages={messages} onClose={() => {}} onJump={() => {}} />);
    // timeline: both user messages
    expect(screen.getByText('hello there')).toBeTruthy();
    expect(screen.getByText('second user')).toBeTruthy();
    // pinned: the starred persona message appears (timeline has user-only)
    expect(screen.getByText('persona reply')).toBeTruthy();
  });

  it('jumps and closes when an entry is tapped', () => {
    const onJump = vi.fn();
    const onClose = vi.fn();
    wrap(<TocSheet messages={messages} onClose={onClose} onJump={onJump} />);
    fireEvent.click(screen.getByText('hello there'));
    expect(onJump).toHaveBeenCalledWith('u1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    wrap(<TocSheet messages={messages} onClose={onClose} onJump={() => {}} />);
    fireEvent.click(screen.getByTestId('toc-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/components/chat/TocSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/user-client/src/components/chat/TocSheet.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { MessageRow } from '../../boot/client-data-db.js';
import { useToggleBookmark } from '../../data/chats.js';
import { useSetBookmarkLabel } from '../../data/bookmarks.js';
import { type TocEntry, buildToc } from '../../lib/toc.js';

interface Props {
  messages: MessageRow[];
  onClose: () => void;
  /** Jump to a message — caller closes the sheet, drops to Reading Mode, scrolls. */
  onJump: (messageId: string) => void;
}

/** Per-chat bookmarks & table-of-contents overlay. */
export function TocSheet(p: Props): JSX.Element {
  const toc = buildToc(p.messages);
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
    p.onJump(messageId);
    p.onClose();
  }

  const renderEntry = (entry: TocEntry): JSX.Element => (
    <li key={`${entry.messageId}-${entry.role}`} className="toc-entry" data-starred={entry.starred || undefined}>
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
        <button type="button" className="toc-entry-label" onClick={() => jump(entry.messageId)}>
          {entry.label}
        </button>
      )}
      <div className="toc-entry-actions">
        <button
          type="button"
          className="toc-entry-rename"
          aria-label="Rename bookmark"
          onClick={() => startRename(entry)}
        >
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
    <div className="toc-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × button is the keyboard path */}
      <div className="toc-backdrop" data-testid="toc-backdrop" onClick={p.onClose} />
      <aside className="toc-sheet" aria-label="Bookmarks and contents">
        <header className="toc-sheet-header">
          <span className="toc-sheet-title">Bookmarks &amp; contents</span>
          <button type="button" className="toc-sheet-close" aria-label="Close" onClick={p.onClose}>
            <span aria-hidden>×</span>
          </button>
        </header>

        {toc.pinned.length > 0 ? (
          <section className="toc-section toc-pinned">
            <h3 className="toc-section-title">Pinned</h3>
            <ul className="toc-list">{toc.pinned.map(renderEntry)}</ul>
          </section>
        ) : null}

        <section className="toc-section toc-timeline">
          <h3 className="toc-section-title">In this chat</h3>
          {toc.timeline.length > 0 ? (
            <ul className="toc-list">{toc.timeline.map(renderEntry)}</ul>
          ) : (
            <p className="toc-empty">Your messages will appear here as you chat.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/components/chat/TocSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/TocSheet.tsx apps/user-client/src/components/chat/TocSheet.test.tsx
git commit -m "Add per-chat ToC and bookmarks overlay sheet

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: Wire the message-level bookmark toggle in `ChatStream`

The `◈ Bookmark` button in `MessageControls` is currently a no-op stub
(`ChatStream.tsx:171-173`). Wire it to `useToggleBookmark`.

**Files:**
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`
- Test: `apps/user-client/src/components/chat/ChatStream.bookmark.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/src/components/chat/ChatStream.bookmark.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import { ChatStream } from './ChatStream.js';

beforeEach(async () => {
  useCurrentChatStore.getState().reset();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1', personaId: 'p1', title: null, resolvedMindspaceId: 'm1',
    createdAt: 1, lastMessageAt: 1, bookmarkedMessageCount: 0, draftInput: '',
  });
  await db.messages.add({
    id: 'u1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1, bookmarked: false, streamingState: 'complete',
  });
});

describe('ChatStream bookmark wiring', () => {
  it('toggles the message bookmark via the message control', async () => {
    const qc = new QueryClient();
    const db = getClientDataDb();
    const messages = await db.messages.where('chatId').equals('c1').toArray();
    render(
      <QueryClientProvider client={qc}>
        <ChatStream chatId="c1" messages={messages} pills={[]} persona={null} displayName="Me" streamHandle={null} />
      </QueryClientProvider>,
    );
    // Expand the message so its controls render.
    useCurrentChatStore.getState().toggleExpanded('u1');
    fireEvent.click(await screen.findByText(/Bookmark/));
    await waitFor(async () => {
      expect((await db.messages.get('u1'))?.bookmarked).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/components/chat/ChatStream.bookmark.test.tsx`
Expected: FAIL — bookmark stays `false` (handler is the stub).

- [ ] **Step 3: Implement**

In `ChatStream.tsx`, add the import:

```ts
import { useToggleBookmark } from '../../data/chats.js';
```

Inside `ChatStream`, near the other hooks:

```ts
  const toggleBookmark = useToggleBookmark();
```

Replace the stubbed `onBookmark` (lines ~171-173):

```ts
                onBookmark={() => void toggleBookmark.mutateAsync(m.id)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/components/chat/ChatStream.bookmark.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/src/components/chat/ChatStream.bookmark.test.tsx
git commit -m "Wire message-level bookmark toggle in ChatStream

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Chat-page integration — mount strip + sheet, `?focus=` jump

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Test: `apps/user-client/src/routes/app/chat/chat-page.bookmarks.test.tsx`

- [ ] **Step 1: Implement the integration**

Add imports:

```ts
import { ReadingToolStrip } from '../../../components/chat/ReadingToolStrip.js';
import { TocSheet } from '../../../components/chat/TocSheet.js';
import { scrollToMessage } from '../../../lib/scroll-to-message.js';
```

The component already derives `messages` from `chatQuery.data` at line ~270
(`const messages = chatQuery.data?.messages ?? [];`) — reuse that variable.

First, **widen the existing `useSearchParams` line** (line 28) to capture the
setter — do **not** add a second `useSearchParams()` call:

```ts
  const [search, setSearchParams] = useSearchParams();
```

Then add local sheet state near the other `useState` declarations at the top of
the component body:

```ts
  const [tocOpen, setTocOpen] = useState(false);
```

Jump handler (drops to Reading Mode, then scrolls after layout settles):

```ts
  const jumpToMessage = (messageId: string): void => {
    setInteractionMode(false);
    requestAnimationFrame(() => {
      // one retry — the message row may mount a frame later
      if (!scrollToMessage(messageId)) {
        requestAnimationFrame(() => scrollToMessage(messageId));
      }
    });
  };
```

Cross-chat focus param — when arriving with `?focus=<id>` and messages are
loaded, jump once and clear the param so re-renders don't re-trigger. **Place
this effect *after* the `const messages = ...` declaration (line ~270)** — it
reads `messages.length` in its dependency array, which would hit a
temporal-dead-zone `ReferenceError` if placed earlier:

```ts
  const focusId = search.get('focus');
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot per focusId once messages are present
  useEffect(() => {
    if (!focusId || messages.length === 0) return;
    jumpToMessage(focusId);
    const next = new URLSearchParams(search);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [focusId, messages.length]);
```

Mount the strip + sheet in the reading-mode region. Next to the existing
`BottomAffordance` block (`!isInteractionMode && hasMessages`):

```tsx
      {!isInteractionMode && hasMessages ? (
        <ReadingToolStrip onOpenToc={() => setTocOpen(true)} />
      ) : null}

      {tocOpen ? (
        <TocSheet
          messages={messages}
          onClose={() => setTocOpen(false)}
          onJump={jumpToMessage}
        />
      ) : null}
```

- [ ] **Step 2: Write the test**

```tsx
// apps/user-client/src/routes/app/chat/chat-page.bookmarks.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { useCurrentChatStore } from '../../../state/current-chat.store.js';
import { ChatPage } from './chat-page.js';

async function seedChat() {
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1', personaId: 'p1', title: 'T', resolvedMindspaceId: 'm1',
    createdAt: 1, lastMessageAt: 2, bookmarkedMessageCount: 0, draftInput: '',
  });
  await db.messages.bulkAdd([
    { id: 'u1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'first q' }], createdAt: 1, bookmarked: false, streamingState: 'complete' },
    { id: 'u2', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'second q' }], createdAt: 2, bookmarked: false, streamingState: 'complete' },
  ]);
}

beforeEach(async () => {
  useCurrentChatStore.getState().reset();
  await seedChat();
});

function renderChat() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/chat/c1']}>
        <Routes>
          <Route path="/app/chat/:chatId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChatPage bookmarks integration', () => {
  it('opens the ToC from the reading tool-strip and lists user messages', async () => {
    renderChat();
    // leave interaction mode so the strip renders
    useCurrentChatStore.getState().setInteractionMode(false);
    fireEvent.click(await screen.findByRole('button', { name: /show tools/i }));
    fireEvent.click(screen.getByRole('button', { name: /bookmarks and contents/i }));
    await waitFor(() => {
      expect(screen.getByText('first q')).toBeTruthy();
      expect(screen.getByText('second q')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run src/routes/app/chat/chat-page.bookmarks.test.tsx`
Expected: PASS. (If the auto-open-interaction-on-mount effect keeps the strip
hidden, the explicit `setInteractionMode(false)` in the test forces reading
mode; assert against that state.)

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/src/routes/app/chat/chat-page.bookmarks.test.tsx
git commit -m "Mount reading tool-strip and ToC sheet, add focus-param jump

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: Global bookmarks view — History `Chats | Bookmarks` tab

**Files:**
- Create: `apps/user-client/src/components/history/BookmarksList.tsx`
- Modify: `apps/user-client/src/routes/app/history.tsx`
- Test: `apps/user-client/src/components/history/BookmarksList.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/src/components/history/BookmarksList.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkGroup } from '../../data/bookmarks.js';
import { BookmarksList } from './BookmarksList.js';

const groups: BookmarkGroup[] = [
  {
    chat: { id: 'c1', personaId: 'p1', title: 'My chat', resolvedMindspaceId: 'm1', createdAt: 1, lastMessageAt: 9, bookmarkedMessageCount: 1, draftInput: '' },
    persona: null,
    bookmarks: [
      { message: { id: 'u2', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'starred q' }], createdAt: 2, bookmarked: true, streamingState: 'complete' }, label: 'starred q' },
    ],
  },
];

describe('BookmarksList', () => {
  it('groups by chat with a chat-title header and the bookmark label', () => {
    render(<BookmarksList groups={groups} onJump={() => {}} />);
    expect(screen.getByText('My chat')).toBeTruthy();
    expect(screen.getByText('starred q')).toBeTruthy();
  });

  it('calls onJump with chatId + messageId when a bookmark is tapped', () => {
    const onJump = vi.fn();
    render(<BookmarksList groups={groups} onJump={onJump} />);
    fireEvent.click(screen.getByText('starred q'));
    expect(onJump).toHaveBeenCalledWith('c1', 'u2');
  });

  it('renders a constructive empty state for no bookmarks', () => {
    render(<BookmarksList groups={[]} onJump={() => {}} />);
    expect(screen.getByText(/star a message/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run src/components/history/BookmarksList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BookmarksList.tsx`**

```tsx
// apps/user-client/src/components/history/BookmarksList.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { BookmarkGroup } from '../../data/bookmarks.js';
import { displayTitle } from '../../lib/chat-title.js';

interface Props {
  groups: BookmarkGroup[];
  /** Navigate into a chat focused on a message. */
  onJump: (chatId: string, messageId: string) => void;
}

/** Global bookmarks, grouped by chat (most-recently-active first). */
export function BookmarksList(p: Props): JSX.Element {
  if (p.groups.length === 0) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No bookmarks yet.</p>
        <p className="mt-2 max-w-xs text-sm">Star a message in any chat to find it here.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {p.groups.map((g) => (
        <li key={g.chat.id} className="bookmark-group">
          <h3 className="bookmark-group-title" style={g.persona?.colour ? { color: g.persona.colour } : undefined}>
            {displayTitle(g.chat)}
          </h3>
          <ul className="bookmark-group-list">
            {g.bookmarks.map((b) => (
              <li key={b.message.id}>
                <button
                  type="button"
                  className="bookmark-row"
                  data-role={b.message.role}
                  onClick={() => p.onJump(g.chat.id, b.message.id)}
                >
                  {b.label}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the BookmarksList test**

Run: `pnpm --filter user-client exec vitest run src/components/history/BookmarksList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the segmented tab to History**

In `history.tsx`, add imports:

```ts
import { useBookmarks } from '../../data/bookmarks.js';
import { BookmarksList } from '../../components/history/BookmarksList.js';
```

Add tab state below the existing `useState` declarations:

```ts
  const [tab, setTab] = useState<'chats' | 'bookmarks'>('chats');
  const bookmarks = useBookmarks();
```

Insert a segmented control directly under `<EditorTopbar ... />`:

```tsx
      <div className="history-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chats'}
          className="history-tab"
          data-active={tab === 'chats' || undefined}
          onClick={() => setTab('chats')}
        >
          Chats
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bookmarks'}
          className="history-tab"
          data-active={tab === 'bookmarks' || undefined}
          onClick={() => setTab('bookmarks')}
        >
          Bookmarks
        </button>
      </div>
```

Wrap the existing search/chips/list block so it renders only on the `chats`
tab, and add the bookmarks branch. Replace the `<HistorySearchBar .../>`
through the closing of the chat-list ternary with:

```tsx
      {tab === 'chats' ? (
        <>
          <HistorySearchBar value={searchQuery} onChange={setSearchQuery} />
          <PersonaFilterChips
            personas={personas.data ?? []}
            selectedId={filterPersonaId}
            onChange={setFilterPersonaId}
          />
          {visibleChats.length === 0 ? (
            <EmptyState
              totalChats={(chats.data ?? []).length}
              filterPersonaId={filterPersonaId}
              filterPersonaName={filterPersonaName}
              searchActive={searchQuery.trim() !== ''}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleChats.map((c) => {
                const p = personaById.get(c.personaId);
                if (!p) return null;
                return (
                  <HistoryRow
                    key={c.id}
                    chat={c}
                    persona={p}
                    onRename={(next) => void updateChat.mutateAsync({ id: c.id, patch: { title: next } })}
                    onDelete={() => void deleteChat.mutateAsync(c.id)}
                  />
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <BookmarksList
          groups={bookmarks.data ?? []}
          onJump={(chatId, messageId) => navigate(`/app/chat/${chatId}?focus=${messageId}`)}
        />
      )}
```

- [ ] **Step 6: Run the full History test file (regression)**

Run: `pnpm --filter user-client exec vitest run src/routes/app/history`
Expected: PASS — existing history tests still green (the chats branch is
unchanged in behaviour, only wrapped).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/history/BookmarksList.tsx apps/user-client/src/components/history/BookmarksList.test.tsx apps/user-client/src/routes/app/history.tsx
git commit -m "Add global Bookmarks tab to History

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: Minimal ghostly styling hooks + full verification

Styling proper is Chris's separate pass, but the new class names need enough
CSS to be visible/usable for his device test. Add restrained, ND-calm defaults
(ghostly opacity, subtle reveal). Keep it minimal — Chris refines.

**Files:**
- Modify: `apps/user-client/src/index.css`

- [ ] **Step 1: Add baseline styles**

Append to `index.css` (values are placeholders for Chris's pass — functional,
not final):

```css
/* Reading-mode floating tool-strip — ghostly, top-right */
.reading-tool-strip {
  position: fixed;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
  opacity: 0.45;
  transition: opacity 160ms ease;
}
.reading-tool-strip:hover,
.reading-tool-strip[data-expanded] { opacity: 0.85; }
.tool-strip-toggle,
.tool-strip-btn {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--color-ink, #1a1a1a) 70%, transparent);
  color: var(--color-paper, #e6e6e6);
  border: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 14%, transparent);
  backdrop-filter: blur(4px);
}
.tool-strip-actions { display: flex; flex-direction: column; gap: 0.4rem; }
.tool-strip-btn[data-active] { color: var(--color-accent, #c9a227); }

/* ToC overlay */
.toc-sheet-root { position: fixed; inset: 0; z-index: 40; }
.toc-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(2px); }
.toc-sheet {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: min(88vw, 22rem);
  background: var(--color-ink, #1a1a1a);
  border-left: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 12%, transparent);
  padding: 1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.toc-sheet-header { display: flex; align-items: center; justify-content: space-between; }
.toc-section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
.toc-list { display: flex; flex-direction: column; gap: 0.15rem; }
.toc-entry { display: flex; align-items: center; gap: 0.5rem; }
.toc-entry-label { flex: 1; text-align: left; padding: 0.4rem 0; color: var(--color-paper, #e6e6e6); }
.toc-entry[data-starred] .toc-entry-label { font-style: italic; }
.toc-entry-actions { display: flex; gap: 0.25rem; opacity: 0.7; }

/* Jump highlight pulse */
.msg-focus-pulse { animation: msg-focus-pulse 1.6s ease-out; }
@keyframes msg-focus-pulse {
  0% { background: color-mix(in srgb, var(--color-accent, #c9a227) 22%, transparent); }
  100% { background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .msg-focus-pulse { animation: none; }
}

/* History segmented tabs */
.history-tabs { display: flex; gap: 0.25rem; }
.history-tab { padding: 0.35rem 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.55; }
.history-tab[data-active] { opacity: 1; border-bottom: 2px solid var(--color-accent, #c9a227); }
.bookmark-group-title { font-family: var(--font-display); font-size: 1rem; }
.bookmark-row { text-align: left; padding: 0.35rem 0; width: 100%; color: var(--color-paper, #e6e6e6); }
```

- [ ] **Step 2: Full verification suite**

Run each and confirm:

```bash
pnpm typecheck
```
Expected: all packages pass (13/13 projects per the current baseline).

```bash
pnpm --filter user-client exec vitest run
```
Expected: all new tests pass; the **pre-existing 8 localStorage-jsdom failures**
in `cockpit-draft`/`chat-page`/`chat-route` remain (unchanged baseline — confirm
the count did not grow).

```bash
pnpm --filter user-client run build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Add baseline styling for bookmarks, ToC, and reading tool-strip

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Manual verification (Chris, on device)

Per spec §9:

1. Open a long chat → tap the floating arrow (top-right) → strip slides out;
   tap the ◈ → ToC sheet lists every user message; tap an entry → lands in
   Reading Mode at that message with the highlight pulse.
2. Rename a timeline entry (🖎) → label changes; close + reopen → persists.
3. Star a renamed entry (☆→★) → it appears in the Pinned section, no name
   re-prompt.
4. Expand a persona message → ◈ Bookmark → it appears in the ToC's Pinned
   section (not in the timeline) and in History → Bookmarks.
5. Pin the strip (📌) → interact elsewhere → strip stays. Unpin → tap into the
   chat → strip collapses.
6. History → "Bookmarks" → grouped by chat → tap one → opens the chat scrolled
   to that message.

## Post-implementation

- **No Larissa** (client-only, no auth/sync/proxy/crypto path).
- Squash the ten task-commits into one feature commit:
  `Add bookmarks and table-of-contents`.
- Update `obsidian/STATUS-CLIENT-ONLY.md` (Done + Next) and commit alongside.
- Do **not** push — master is already ahead of origin; Chris pushes when ready.
```
