# Session Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-message `✎ Branch` control fork a conversation at that message into a brand-new, fully independent chat session (every message + pill up to and including the branch point duplicated with fresh IDs), then drop the user into the new branch.

**Architecture:** A single Dexie `rw` transaction (`useBranchChat`, the copying mirror of `useDeleteChat`) duplicates chat → messages → pills with new IDs, rewriting the `pillId` references inside copied `contentBlocks`. A bottom-sheet (`BranchSheet`, mirroring `TocSheet`) collects a mandatory name. `chat-page.tsx` owns the open/confirm/navigate flow; the button is disabled while a stream is live for the chat.

**Tech Stack:** TypeScript (strict), React 18, Dexie (IndexedDB), TanStack Query, Vitest + `fake-indexeddb`, Tailwind/`index.css`. Spec: `superpowers/specs/2026-06-01-session-branching-design.md`.

---

## File Structure

- **Modify** `apps/user-client/src/data/chats.ts` — add `useBranchChat` mutation (the copy cascade).
- **Create** `apps/user-client/tests/data/branch-chat.test.ts` — data-layer integrity tests.
- **Create** `apps/user-client/src/components/chat/BranchSheet.tsx` — name-input bottom-sheet.
- **Create** `apps/user-client/tests/components/chat/BranchSheet.test.tsx` — disabled-when-empty / trimmed-confirm tests.
- **Modify** `apps/user-client/src/index.css` — add `.branch-sheet*` styles (sibling of `.toc-sheet*`).
- **Modify** `apps/user-client/src/components/chat/MessageControls.tsx` — enable the branch button, add `onBranch` + `branchDisabled` props.
- **Modify** `apps/user-client/src/components/chat/MessageBlock.tsx` — thread `onBranch` + `branchDisabled`.
- **Modify** `apps/user-client/src/components/chat/ChatStream.tsx` — thread `onBranch(messageId)` + `branchDisabled` to every `MessageBlock`.
- **Modify** `apps/user-client/src/routes/app/chat/chat-page.tsx` — `branchPointId` state, render `BranchSheet`, confirm → `useBranchChat` → navigate.

All commands run from `apps/user-client/`. Test runner: `pnpm vitest run <path>`.

---

## Task 1: `useBranchChat` data-layer mutation

**Files:**
- Modify: `apps/user-client/src/data/chats.ts`
- Test: `apps/user-client/tests/data/branch-chat.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/data/branch-chat.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useBranchChat } from '../../src/data/chats.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.pills.clear();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: 'Source',
    resolvedMindspaceId: 'm1',
    createdAt: 100,
    lastMessageAt: 300,
    bookmarkedMessageCount: 1,
    draftInput: 'half typed',
  });
  // u1 (user, bookmarked) — createdAt 100
  await db.messages.add({
    id: 'u1',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'question' }],
    createdAt: 100,
    bookmarked: true,
    streamingState: 'complete',
  });
  // a1 (persona) — createdAt 200 — references pill pl1 inline
  await db.messages.add({
    id: 'a1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [
      { type: 'text', text: 'answer ' },
      { type: 'pill', pillId: 'pl1' },
    ],
    createdAt: 200,
    bookmarked: false,
    streamingState: 'complete',
  });
  // u2 (user) — createdAt 300 — AFTER the branch point, must NOT be copied
  await db.messages.add({
    id: 'u2',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'later' }],
    createdAt: 300,
    bookmarked: false,
    streamingState: 'complete',
  });
  await db.pills.add({
    id: 'pl1',
    messageId: 'a1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { tool: 'search', args: { q: 'x' } },
    createdAt: 200,
  });
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('useBranchChat', () => {
  it('forks at the branch point with fresh ids and remapped pill references', async () => {
    const { result } = renderHook(() => useBranchChat(), { wrapper });

    let newChatId = '';
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      branchPointMessageId: 'a1',
      title: 'My branch',
    });

    const db = getClientDataDb();

    // New chat exists and is distinct
    expect(newChatId).not.toBe('c1');
    const branch = await db.chats.get(newChatId);
    expect(branch).toBeTruthy();
    expect(branch?.title).toBe('My branch');
    expect(branch?.personaId).toBe('p1'); // referenced, not duplicated
    expect(branch?.resolvedMindspaceId).toBe('m1');
    expect(branch?.draftInput).toBe(''); // source draft NOT carried
    expect(branch?.bookmarkedMessageCount).toBe(1); // u1 is bookmarked
    expect(branch?.lastMessageAt).toBe(200); // createdAt of last copied message (a1)

    // Inclusive cut: u1 + a1 copied, u2 NOT copied
    const branchMsgs = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    expect(branchMsgs).toHaveLength(2);
    expect(branchMsgs.map((m) => m.id)).not.toContain('u1');
    expect(branchMsgs.map((m) => m.id)).not.toContain('a1');
    expect(branchMsgs.map((m) => m.createdAt)).toEqual([100, 200]); // preserved
    expect(branchMsgs.some((m) => m.contentBlocks.some((b) => b.type === 'text' && b.text === 'later'))).toBe(false);

    // Pill remapped: copied persona message references a NEW pill that belongs to it
    const copiedPersona = branchMsgs.find((m) => m.role === 'persona');
    const pillBlock = copiedPersona?.contentBlocks.find((b) => b.type === 'pill') as
      | { type: 'pill'; pillId: string }
      | undefined;
    expect(pillBlock).toBeTruthy();
    expect(pillBlock?.pillId).not.toBe('pl1'); // remapped
    const newPill = await db.pills.get(pillBlock?.pillId ?? '');
    expect(newPill).toBeTruthy();
    expect(newPill?.messageId).toBe(copiedPersona?.id);
    expect(newPill?.kind).toBe('tool-call');

    // Source is untouched
    const srcMsgs = await db.messages.where('chatId').equals('c1').toArray();
    expect(srcMsgs).toHaveLength(3);
    const srcPill = await db.pills.get('pl1');
    expect(srcPill?.messageId).toBe('a1');
  });

  it('throws when the branch point does not exist', async () => {
    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    await expect(
      result.current.mutateAsync({ sourceChatId: 'c1', branchPointMessageId: 'nope', title: 'X' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/data/branch-chat.test.ts`
Expected: FAIL — `useBranchChat` is not exported from `chats.ts`.

- [ ] **Step 3: Implement `useBranchChat`**

In `apps/user-client/src/data/chats.ts`, add the import of `ContentBlock` to the existing type import and append the mutation. The top import line becomes:

```ts
import { type ChatRow, type ContentBlock, getClientDataDb } from '../boot/client-data-db.js';
```

Append at the end of the file (before the final newline):

```ts
/**
 * Fork a chat at a given message into a new, fully independent session.
 * Copies the chat row plus every message and pill up to AND INCLUDING the
 * branch-point message, assigning fresh ids throughout. Pill-id references
 * inside copied `contentBlocks` are rewritten to point at the new pills.
 * Persona/provider/mindspace are referenced, never duplicated.
 *
 * Returns the new chat's id. Throws if the source chat or branch-point
 * message is absent (e.g. raced against a delete) — the transaction aborts
 * and leaves no partial branch.
 */
export function useBranchChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sourceChatId: string;
      branchPointMessageId: string;
      title: string;
    }): Promise<string> => {
      const db = getClientDataDb();
      const newChatId = uuidv7();
      const now = Date.now();

      await db.transaction('rw', db.chats, db.messages, db.pills, async () => {
        const source = await db.chats.get(args.sourceChatId);
        if (!source) throw new Error(`useBranchChat: source chat ${args.sourceChatId} not found`);

        const allMsgs = await db.messages
          .where('chatId')
          .equals(args.sourceChatId)
          .sortBy('createdAt');
        const cutIdx = allMsgs.findIndex((m) => m.id === args.branchPointMessageId);
        if (cutIdx === -1)
          throw new Error(`useBranchChat: branch point ${args.branchPointMessageId} not found`);
        const copied = allMsgs.slice(0, cutIdx + 1); // inclusive

        // Pills belonging to the copied messages.
        const copiedIds = copied.map((m) => m.id);
        const pills = copiedIds.length
          ? await db.pills.where('messageId').anyOf(copiedIds).toArray()
          : [];

        // Pre-assign fresh ids.
        const msgIdMap = new Map(copied.map((m) => [m.id, uuidv7()]));
        const pillIdMap = new Map(pills.map((pl) => [pl.id, uuidv7()]));

        const lastCopied = copied[copied.length - 1];
        await db.chats.add({
          id: newChatId,
          personaId: source.personaId,
          title: args.title,
          resolvedMindspaceId: source.resolvedMindspaceId,
          createdAt: now,
          lastMessageAt: lastCopied?.createdAt ?? now,
          bookmarkedMessageCount: copied.filter((m) => m.bookmarked).length,
          draftInput: '',
        });

        for (const m of copied) {
          const blocks = (structuredClone(m.contentBlocks) as ContentBlock[]).map((b) =>
            b.type === 'pill' ? { ...b, pillId: pillIdMap.get(b.pillId) ?? b.pillId } : b,
          );
          await db.messages.add({
            id: msgIdMap.get(m.id) ?? uuidv7(),
            chatId: newChatId,
            role: m.role,
            contentBlocks: blocks,
            createdAt: m.createdAt, // preserve ordering
            bookmarked: m.bookmarked,
            bookmarkLabel: m.bookmarkLabel,
            streamingState: m.streamingState,
          });
        }

        for (const pl of pills) {
          await db.pills.add({
            id: pillIdMap.get(pl.id) ?? uuidv7(),
            messageId: msgIdMap.get(pl.messageId) ?? pl.messageId,
            kind: pl.kind,
            positionHint: pl.positionHint,
            status: pl.status,
            payload: structuredClone(pl.payload),
            createdAt: pl.createdAt,
          });
        }
      });

      return newChatId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/data/branch-chat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/data/chats.ts apps/user-client/tests/data/branch-chat.test.ts
git commit -m "Add useBranchChat copy-cascade mutation"
```

---

## Task 2: `BranchSheet` component

**Files:**
- Create: `apps/user-client/src/components/chat/BranchSheet.tsx`
- Modify: `apps/user-client/src/index.css`
- Test: `apps/user-client/tests/components/chat/BranchSheet.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/chat/BranchSheet.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BranchSheet } from '../../../src/components/chat/BranchSheet.js';

describe('BranchSheet', () => {
  it('disables Branch until a non-empty name is entered, and confirms trimmed', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<BranchSheet onConfirm={onConfirm} onClose={onClose} />);

    const branchBtn = screen.getByRole('button', { name: 'Branch' });
    expect(branchBtn).toBeDisabled();

    const input = screen.getByLabelText('Branch name');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(branchBtn).toBeDisabled(); // whitespace only

    fireEvent.change(input, { target: { value: '  My fork  ' } });
    expect(branchBtn).toBeEnabled();

    fireEvent.click(branchBtn);
    expect(onConfirm).toHaveBeenCalledWith('My fork'); // trimmed
  });

  it('dismisses on Cancel', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<BranchSheet onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/chat/BranchSheet.test.tsx`
Expected: FAIL — cannot find module `BranchSheet.js`.

- [ ] **Step 3: Create the component**

Create `apps/user-client/src/components/chat/BranchSheet.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

interface Props {
  /** Receives the trimmed, non-empty branch name. */
  onConfirm: (name: string) => void;
  onClose: () => void;
}

/** Bottom-sheet that collects a mandatory name for a forked chat session. */
export function BranchSheet(p: Props): JSX.Element {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const canConfirm = trimmed !== '';

  const confirm = (): void => {
    if (canConfirm) p.onConfirm(trimmed);
  };

  return (
    <div className="branch-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; Cancel is the keyboard path */}
      <div className="branch-backdrop" data-testid="branch-backdrop" onClick={p.onClose} />
      <aside className="branch-sheet" aria-label="Branch this chat">
        <header className="branch-sheet-header">
          <span className="branch-sheet-title">Branch this chat</span>
        </header>
        <input
          className="branch-sheet-input"
          aria-label="Branch name"
          // biome-ignore lint/a11y/noAutofocus: naming the branch is the sole intent of this sheet
          autoFocus
          value={value}
          maxLength={80}
          placeholder="Name your branch"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm();
            else if (e.key === 'Escape') p.onClose();
          }}
        />
        <div className="branch-sheet-actions">
          <button type="button" className="branch-cancel" onClick={p.onClose}>
            Cancel
          </button>
          <button type="button" className="branch-confirm" disabled={!canConfirm} onClick={confirm}>
            Branch
          </button>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Add styles**

In `apps/user-client/src/index.css`, immediately after the `.toc-entry-actions { ... }` block (the block ending around the line before `/* Jump highlight pulse */`), insert:

```css
/* Branch-this-chat bottom-sheet — mirrors .toc-sheet structure */
.branch-sheet-root {
  position: absolute;
  inset: 0;
  z-index: 40;
}
.branch-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.branch-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-ink, #1a1a1a);
  border-top: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 12%, transparent);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.branch-sheet-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.6;
}
.branch-sheet-input {
  width: 100%;
  padding: 0.6rem 0.75rem;
  background: var(--color-surface-input, rgba(0, 0, 0, 0.3));
  border: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 14%, transparent);
  border-radius: 0.4rem;
  color: var(--color-paper, #e6e6e6);
}
.branch-sheet-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent, #c9a227) 55%, transparent);
}
.branch-sheet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.branch-cancel,
.branch-confirm {
  padding: 0.45rem 1rem;
  border-radius: 0.4rem;
  color: var(--color-paper, #e6e6e6);
}
.branch-confirm {
  background: color-mix(in srgb, var(--color-accent, #c9a227) 22%, transparent);
}
.branch-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/components/chat/BranchSheet.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/BranchSheet.tsx apps/user-client/tests/components/chat/BranchSheet.test.tsx apps/user-client/src/index.css
git commit -m "Add BranchSheet name-input bottom-sheet"
```

---

## Task 3: Thread `onBranch` + `branchDisabled` through the message components

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageControls.tsx`
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx`
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`
- Test: `apps/user-client/tests/components/chat/MessageControls.branch.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/chat/MessageControls.branch.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import { MessageControls } from '../../../src/components/chat/MessageControls.js';

const msg: MessageRow = {
  id: 'm1',
  chatId: 'c1',
  role: 'persona',
  contentBlocks: [{ type: 'text', text: 'hi' }],
  createdAt: 1,
  bookmarked: false,
  streamingState: 'complete',
};

describe('MessageControls branch button', () => {
  it('calls onBranch when enabled', () => {
    const onBranch = vi.fn();
    render(
      <MessageControls message={msg} onCopy={() => {}} onBookmark={() => {}} onBranch={onBranch} />,
    );
    const btn = screen.getByRole('button', { name: /Branch/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onBranch).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a stream is live', () => {
    const onBranch = vi.fn();
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onBranch={onBranch}
        branchDisabled
      />,
    );
    const btn = screen.getByRole('button', { name: /Branch/ });
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/chat/MessageControls.branch.test.tsx`
Expected: FAIL — the branch button is hard-disabled and has no `onBranch`.

- [ ] **Step 3: Update `MessageControls.tsx`**

Replace the entire contents of `apps/user-client/src/components/chat/MessageControls.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow } from '../../boot/client-data-db.js';

interface Props {
  message: MessageRow;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
  /** Fork the chat at this message. */
  onBranch?: () => void;
  /** Disable branching (e.g. while a stream is live for this chat). */
  branchDisabled?: boolean;
}

function stop(e: React.MouseEvent): void {
  e.stopPropagation();
}

export function MessageControls(p: Props): JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation wrapper div — not an interactive element, buttons inside handle keyboard events
    <div className="msg-controls" onClick={stop}>
      <button
        type="button"
        data-ctrl="branch"
        onClick={p.onBranch}
        disabled={p.branchDisabled || !p.onBranch}
        title={p.branchDisabled ? 'Branching paused while replying' : 'Branch this chat from here'}
        className="ctrl-btn"
      >
        ✎ Branch
      </button>
      {p.onRegenerate ? (
        <button type="button" data-ctrl="regenerate" onClick={p.onRegenerate} className="ctrl-btn">
          ↻ Regenerate
        </button>
      ) : null}
      <button type="button" data-ctrl="copy" onClick={p.onCopy} className="ctrl-btn">
        ⎘ Copy
      </button>
      <button
        type="button"
        data-ctrl="bookmark"
        onClick={p.onBookmark}
        data-active={p.message.bookmarked || undefined}
        className="ctrl-btn"
      >
        ◈ Bookmark
      </button>
      <button
        type="button"
        data-ctrl="read"
        disabled
        title="Voice arrives with Block 4"
        className="ctrl-btn"
      >
        ▸ Read
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the MessageControls test to verify it passes**

Run: `pnpm vitest run tests/components/chat/MessageControls.branch.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Thread props through `MessageBlock.tsx`**

In `apps/user-client/src/components/chat/MessageBlock.tsx`, add two fields to `MessageBlockProps` (immediately after the `onRegenerate?: () => void;` line):

```ts
  /** Fork the chat at this message. */
  onBranch?: () => void;
  /** Disable branching (stream live for this chat). */
  branchDisabled?: boolean;
```

Then in the JSX, extend the `<MessageControls ... />` element (currently passing `message`, `onCopy`, `onBookmark`, `onRegenerate`) to also pass the two new props:

```tsx
        <MessageControls
          message={p.message}
          onCopy={p.onCopy}
          onBookmark={p.onBookmark}
          onRegenerate={p.onRegenerate}
          onBranch={p.onBranch}
          branchDisabled={p.branchDisabled}
        />
```

- [ ] **Step 6: Thread props through `ChatStream.tsx`**

In `apps/user-client/src/components/chat/ChatStream.tsx`, add to `ChatStreamProps` (after the `onRegenerate?: () => void;` line):

```ts
  /** Fork the chat at a given message. Wired to every message. */
  onBranch?: (messageId: string) => void;
  /** Disable branching across all messages (stream live for this chat). */
  branchDisabled?: boolean;
```

Then in the `<MessageBlock ... />` element, add the two props alongside `onRegenerate`:

```tsx
                onRegenerate={isLastPersona ? p.onRegenerate : undefined}
                onBranch={p.onBranch ? () => p.onBranch?.(m.id) : undefined}
                branchDisabled={p.branchDisabled}
```

- [ ] **Step 7: Run the full chat-component test suite + typecheck**

Run: `pnpm vitest run tests/components/chat/`
Expected: PASS (existing ChatStream/MessageBlock tests still green, new branch test green).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/components/chat/MessageControls.tsx apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/tests/components/chat/MessageControls.branch.test.tsx
git commit -m "Enable branch control and thread onBranch through message components"
```

---

## Task 4: Wire the branch flow into `chat-page.tsx`

**Files:**
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`

- [ ] **Step 1: Add the import**

In `apps/user-client/src/routes/app/chat/chat-page.tsx`, add `useBranchChat` to the existing `chats.js` import and import `BranchSheet`. The two import lines become:

```ts
import { BranchSheet } from '../../../components/chat/BranchSheet.js';
```

(add alongside the other `components/chat/*` imports, e.g. just after the `ChatStream` import)

and

```ts
import { useBranchChat, useChat, useUpdateChat } from '../../../data/chats.js';
```

- [ ] **Step 2: Add state + mutation + handler**

After the existing `const updateChat = useUpdateChat();` line, add:

```ts
  const branchChat = useBranchChat();
```

After the `const [tocOpen, setTocOpen] = useState(false);` line, add:

```ts
  const [branchPointId, setBranchPointId] = useState<string | null>(null);
```

After the `onRegenerate` handler definition (the `const onRegenerate = ...` block), add:

```ts
  const onConfirmBranch = async (title: string): Promise<void> => {
    if (!activeChatId || !branchPointId) return;
    const newChatId = await branchChat.mutateAsync({
      sourceChatId: activeChatId,
      branchPointMessageId: branchPointId,
      title,
    });
    setBranchPointId(null);
    navigate(`/app/chat/${newChatId}`);
  };
```

- [ ] **Step 3: Pass branch props to `ChatStream`**

Extend the `<ChatStream ... />` element (the one inside the render's ternary, currently ending with `onRegenerate={onRegenerate}`) to also pass:

```tsx
          onRegenerate={onRegenerate}
          onBranch={(messageId) => setBranchPointId(messageId)}
          branchDisabled={isStreamLive}
```

- [ ] **Step 4: Render the `BranchSheet`**

Immediately after the `tocOpen` block in the render (the `{tocOpen ? ( ... ) : null}` expression), add:

```tsx
      {branchPointId ? (
        <BranchSheet
          onConfirm={(title) => void onConfirmBranch(title)}
          onClose={() => setBranchPointId(null)}
        />
      ) : null}
```

- [ ] **Step 5: Typecheck + full user-client test run**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm vitest run`
Expected: PASS — whole user-client suite green, including the three new test files.

- [ ] **Step 6: Build verification**

Run (from repo root): `pnpm run build`
Expected: build succeeds (full TS pipeline, per Quality Bar §10).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Wire session-branching flow into chat page"
```

---

## Manual Verification (Chris, on device)

1. Open a chat with several messages, including at least one tool-call/KB pill.
2. Expand a mid-conversation message, tap `✎ Branch`, enter a name, confirm.
3. Land in the new branch; confirm it ends at the branch point and the pills render correctly.
4. Continue the branch with a new message; confirm the source chat is untouched.
5. Confirm both chats appear separately in History with the right titles.
6. While a persona is mid-reply, confirm the `✎ Branch` button is disabled with its "Branching paused while replying" tooltip.
7. Confirm `Cancel` and empty-name (disabled `Branch`) behave as specified.

---

## Self-Review Notes

- **Spec coverage:** §4 data layer → Task 1; §5 `BranchSheet` → Task 2, prop threading → Task 3; §6 confirmation flow → Task 4; §7 error handling (throw + abort) → Task 1 test 2; §8 testing → Tasks 1–3; §9 manual verification → final section. All covered.
- **Shared-vs-duplicated (§3):** Task 1 copies `personaId`/`resolvedMindspaceId` by value (reference), asserted in the Task 1 test.
- **Type consistency:** `useBranchChat` args `{ sourceChatId, branchPointMessageId, title }` identical across Tasks 1 and 4. `onBranch`/`branchDisabled` prop names identical across Tasks 3 and 4.
- **Pre-existing `incomplete` recovery footer** is unaffected — branching is disabled (`branchDisabled`) only while a stream is *live*, which is the `isStreamLive` flag, not the `incomplete` recovery state.
