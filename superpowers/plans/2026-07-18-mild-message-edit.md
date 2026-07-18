# Mild Message Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit any of their own messages by re-composing it in the real prompt composer; on send, either *replace in place* (only when it is still the last user message) or *branch to a new chat* — reusing the existing regenerate and send paths.

**Architecture:** A new device-local `editingMessageId` on `ChatRow` marks an edit-in-progress (text rides the existing `draftInput`; attachment changes are transient). *Replace* writes the edited text onto the message row (`mutateSynced`, LWW) and rebinds its attachments, then fires the existing `useRegenerate`. *Branch* copies the messages **before** the edited one into a fresh chat and re-issues the edited message through the existing `useSendMessage` — so the whole context/stream/attachment path is reused. Availability of *Replace* is derived live from the transcript (never stored), which folds the older-message rule and the cross-device case into one mechanism.

**Tech Stack:** TypeScript (strict), React 18, Zustand (`useCurrentChatStore`), TanStack Query, Dexie, Vitest + fake-indexeddb + @testing-library/react.

## Global Constraints

- **British English** in every artefact — code, comments, copy, tests, commit messages. No mixed-language strings.
- **TypeScript strict**, `noUncheckedIndexedAccess: true`. No `any` without an inline justification comment.
- **No Dexie version bump.** `editingMessageId` is an optional non-indexed field on `chats` (precedent: `importedFrom`, `useArtefactExpertModel` — same "no bump" rule). Adding it must not add a `this.version(37)`.
- **Device-local edit state.** `editingMessageId` goes on the `chats` sync **deny-list** (`src/sync/strip.ts`) — it never seals, never syncs. "Is this the last user message" is **never stored** — always derived at render/commit.
- **Reuse, don't re-implement.** Replace reuses `useRegenerate`; Branch reuses `useSendMessage`. Do not fork the stream/context-building logic.
- **Disabled over hidden.** Unavailable *Replace* is shown greyed with its reason, never removed. The Edit affordance while a stream is live is disabled-with-tooltip (mirrors Branch's `branchDisabled`), never hidden.
- **Every commit** ends with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>` and (doc-only commits) `[skip ci]`.
- **Verify gates** at the end: `pnpm typecheck --force` (14/14), full user-client vitest at the known **8** Node-localStorage baseline, `pnpm build` (9/9), Biome clean.

## Paths (repo-relative to `apps/user-client/`)

- `src/boot/client-data-db.ts` — `ChatRow` (227-266); no version bump.
- `src/sync/strip.ts` — `DENY_LISTS.chats` (71-81).
- `src/data/message-edit.ts` — **NEW** pure helpers + the two commit hooks.
- `src/data/attachments.ts` — attachment ops (`addAttachment`, `listPendingAttachments`, `attachPendingToMessage`).
- `src/data/send-message.ts` — `useSendMessage` (reused by Branch), `useRegenerate` (reused by Replace).
- `src/data/chats.ts` — `useBranchChat` (reference pattern for the copy helper).
- `src/state/stream-manager.store.ts` — `start` / `regenerate` (unchanged; reused).
- `src/state/current-chat.store.ts` — transient edit-session state (staged removals).
- `src/components/chat/MessageControls.tsx` — Edit affordance, Branch glyph, Save→overflow.
- `src/components/chat/Cockpit.tsx` — banner, split send button, attachment view, focus.
- `src/components/chat/InteractionMode.tsx` — prop threading.
- `src/routes/app/chat/chat-page.tsx` — enter/cancel edit orchestration + commit routing.

---

## Task 1: `editingMessageId` on `ChatRow` + `chats` deny-list

**Files:**
- Modify: `src/boot/client-data-db.ts` (`ChatRow`, ~227-266)
- Modify: `src/sync/strip.ts` (`DENY_LISTS.chats`, ~72-81)
- Test: `tests/sync/strip.test.ts` (add a case; if the file does not exist, create it mirroring `tests/data/bookmarks.test.ts` harness)

**Interfaces:**
- Produces: `ChatRow.editingMessageId?: string | null` — device-local marker of the message currently being edited in this chat's composer; `null`/absent ⇒ normal compose.

- [ ] **Step 1: Write the failing test** (add to `tests/sync/strip.test.ts`)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { patchTouchesSyncedField, restoreLocalFields, stripForSeal } from '../../src/sync/strip.js';

describe('chats deny-list — editingMessageId is device-local', () => {
  it('strips editingMessageId before seal', () => {
    const sealed = stripForSeal('chats', {
      id: 'c1',
      title: 'T',
      draftInput: 'half typed',
      editingMessageId: 'u7',
    }) as Record<string, unknown>;
    expect('editingMessageId' in sealed).toBe(false);
    expect('draftInput' in sealed).toBe(false);
    expect(sealed.title).toBe('T');
  });

  it('restores editingMessageId from the local row after a pull', () => {
    const restored = restoreLocalFields(
      'chats',
      { id: 'c1', title: 'T' },
      { id: 'c1', title: 'old', editingMessageId: 'u7' },
    ) as Record<string, unknown>;
    expect(restored.editingMessageId).toBe('u7');
  });

  it('a patch of only editingMessageId is not a synced mutation', () => {
    expect(patchTouchesSyncedField('chats', ['editingMessageId'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/sync/strip.test.ts`
Expected: FAIL — `editingMessageId` still present in `sealed` (not yet on the deny-list).

- [ ] **Step 3: Add the field to `ChatRow`**

In `src/boot/client-data-db.ts`, inside `interface ChatRow`, after the `useArtefactExpertModel?: boolean;` field, add:

```ts
  /** Message currently being re-composed in this chat's composer (spec
   *  2026-07-18). Device-local edit-in-progress marker — never synced (on the
   *  `chats` deny-list), never determines "is this the last message" (that is
   *  always derived live). Non-indexed (schemaless) — no Dexie version bump. */
  editingMessageId?: string | null;
```

- [ ] **Step 4: Add it to the `chats` deny-list**

In `src/sync/strip.ts`, in `DENY_LISTS.chats`, under the `// Device-local / transient` group, add `'editingMessageId',`:

```ts
  chats: [
    // Device-local / transient
    'draftInput',
    'editingMessageId',
    'openerPending',
    'compactionToastShown',
    // Locally derived (never synced — recomputed on this device)
    'lastMessageAt',
    'bookmarkedMessageCount',
    'activeCompactionId',
  ],
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/sync/strip.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Confirm no Dexie bump crept in**

Run: `git diff src/boot/client-data-db.ts` — verify the only change is the `ChatRow` field; **no new `this.version(37)`**, no `.stores({ chats: ... })` change.

- [ ] **Step 7: Commit**

```bash
git add src/boot/client-data-db.ts src/sync/strip.ts tests/sync/strip.test.ts
git commit -m "Add device-local editingMessageId to ChatRow and chats deny-list

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Pure derivation helper — last user message / replace-availability

**Files:**
- Create: `src/data/message-edit.ts`
- Test: `tests/data/message-edit.test.ts`

**Interfaces:**
- Produces:
  - `lastRealUserMessage(msgs: MessageRow[]): MessageRow | undefined` — the highest-`createdAt` message with `role === 'user' && !seedRole`.
  - `canReplaceInPlace(msgs: MessageRow[], editingMessageId: string): boolean` — true iff `editingMessageId` is the last real user message.
  - `messageText(msg: MessageRow): string` — concatenated text of the message's text blocks (mirrors `useRegenerate`'s extraction).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { canReplaceInPlace, lastRealUserMessage, messageText } from '../../src/data/message-edit.js';

function u(id: string, createdAt: number, extra: Partial<MessageRow> = {}): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: id }],
    createdAt,
    updatedAt: createdAt,
    bookmarked: false,
    streamingState: 'complete',
    ...extra,
  };
}
function persona(id: string, createdAt: number): MessageRow {
  return { ...u(id, createdAt), role: 'persona' };
}

describe('message-edit helpers', () => {
  it('lastRealUserMessage ignores persona and seed rows', () => {
    const msgs = [u('u1', 1), persona('p1', 2), u('u2', 3), u('seed', 4, { seedRole: 'body' })];
    expect(lastRealUserMessage(msgs)?.id).toBe('u2');
  });

  it('canReplaceInPlace is true only for the last user message', () => {
    const msgs = [u('u1', 1), persona('p1', 2), u('u2', 3), persona('p2', 4)];
    expect(canReplaceInPlace(msgs, 'u2')).toBe(true);
    expect(canReplaceInPlace(msgs, 'u1')).toBe(false);
  });

  it('canReplaceInPlace is false once a newer user message exists (cross-device continuation)', () => {
    const msgs = [u('u1', 1), persona('p1', 2), u('u2', 3)];
    expect(canReplaceInPlace(msgs, 'u1')).toBe(false);
  });

  it('messageText concatenates only text blocks', () => {
    const m = u('u1', 1, {
      contentBlocks: [
        { type: 'text', text: 'hello ' },
        { type: 'pill', pillId: 'x' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(messageText(m)).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/data/message-edit.test.ts`
Expected: FAIL — module `../../src/data/message-edit.js` not found.

- [ ] **Step 3: Write the helper**

Create `src/data/message-edit.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow } from '../boot/client-data-db.js';

/** The highest-createdAt real user message (role 'user', not a pre-seed row). */
export function lastRealUserMessage(msgs: MessageRow[]): MessageRow | undefined {
  let best: MessageRow | undefined;
  for (const m of msgs) {
    if (m.role !== 'user' || m.seedRole) continue;
    if (!best || m.createdAt > best.createdAt) best = m;
  }
  return best;
}

/**
 * Whether `editingMessageId` is *currently* the last real user message — the
 * sole condition under which Replace-in-place is offered. Derived live so an
 * older message, or one another device has since continued past, correctly
 * yields false (spec §6).
 */
export function canReplaceInPlace(msgs: MessageRow[], editingMessageId: string): boolean {
  return lastRealUserMessage(msgs)?.id === editingMessageId;
}

/** Concatenated text of a message's text blocks (mirrors the regenerate path). */
export function messageText(msg: MessageRow): string {
  return msg.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/data/message-edit.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/data/message-edit.ts tests/data/message-edit.test.ts
git commit -m "Add pure helpers for last-user-message and replace availability

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Attachment staging helpers (commit-to-message / copy-to-chat)

**Files:**
- Modify: `src/data/attachments.ts` (add two functions near `attachPendingToMessage`, ~231)
- Test: `tests/data/attachment-staging.test.ts`

**Interfaces:**
- Consumes: `addAttachment`, `attachPendingToMessage`, `listPendingAttachments` (existing, `attachments.ts`); `AttachmentRow` (client-data-db).
- Produces:
  - `commitEditAttachmentsToMessage(chatId: string, messageId: string, stagedRemovals: string[]): Promise<void>` — deletes the `stagedRemovals` (original rows the user removed while editing), then binds the chat's pending additions (`messageId === null`) to `messageId` via `attachPendingToMessage`. Used by Replace.
  - `copyEditAttachmentsToChat(sourceChatId: string, editingMessageId: string, stagedRemovals: string[], targetChatId: string): Promise<void>` — creates fresh **pending** rows on `targetChatId` for each surviving original (attachments bound to `editingMessageId`, minus `stagedRemovals`), and re-homes the source chat's pending additions onto `targetChatId`. Used by Branch before the re-send. Blobs are copied (a branch is a genuine fork).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addAttachment,
  commitEditAttachmentsToMessage,
  copyEditAttachmentsToChat,
  listPendingAttachments,
} from '../../src/data/attachments.js';

async function seedOriginal(chatId: string, messageId: string, name: string): Promise<string> {
  const id = await addAttachment({ chatId, kind: 'text', fileName: name, mime: 'text/plain', text: name });
  await getClientDataDb().attachments.update(id, { messageId });
  return id;
}

beforeEach(async () => {
  await openClientDataDb();
  await getClientDataDb().attachments.clear();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('commitEditAttachmentsToMessage', () => {
  it('deletes staged removals and binds pending additions to the message', async () => {
    const keep = await seedOriginal('c1', 'u1', 'keep');
    const drop = await seedOriginal('c1', 'u1', 'drop');
    const added = await addAttachment({ chatId: 'c1', kind: 'text', fileName: 'new', mime: 'text/plain', text: 'new' });

    await commitEditAttachmentsToMessage('c1', 'u1', [drop]);

    const db = getClientDataDb();
    expect(await db.attachments.get(drop)).toBeUndefined();
    expect((await db.attachments.get(keep))?.messageId).toBe('u1');
    expect((await db.attachments.get(added))?.messageId).toBe('u1');
    expect(await listPendingAttachments('c1')).toHaveLength(0);
  });
});

describe('copyEditAttachmentsToChat', () => {
  it('copies surviving originals as pending on the target chat and re-homes additions', async () => {
    const keep = await seedOriginal('c1', 'u1', 'keep');
    const drop = await seedOriginal('c1', 'u1', 'drop');
    const added = await addAttachment({ chatId: 'c1', kind: 'text', fileName: 'new', mime: 'text/plain', text: 'new' });

    await copyEditAttachmentsToChat('c1', 'u1', [drop], 'c2');

    const targetPending = await listPendingAttachments('c2');
    // one copied survivor (keep) + the re-homed addition = 2; 'drop' excluded.
    expect(targetPending).toHaveLength(2);
    expect(targetPending.map((a) => a.fileName).sort()).toEqual(['keep', 'new']);
    // original 'keep' row is untouched (still bound to u1 on c1).
    expect((await getClientDataDb().attachments.get(keep))?.messageId).toBe('u1');
    // the addition moved chats.
    expect((await getClientDataDb().attachments.get(added))?.chatId).toBe('c2');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/data/attachment-staging.test.ts`
Expected: FAIL — `commitEditAttachmentsToMessage`/`copyEditAttachmentsToChat` not exported.

- [ ] **Step 3: Implement the two helpers**

In `src/data/attachments.ts`, after `attachPendingToMessage` (~250), add:

```ts
/**
 * Commit an in-progress edit's attachment changes onto the edited message
 * (Replace path, spec §8). Deletes the originals the user staged for removal,
 * then binds the chat's pending additions to the message.
 */
export async function commitEditAttachmentsToMessage(
  chatId: string,
  messageId: string,
  stagedRemovals: string[],
): Promise<void> {
  const db = getClientDataDb();
  for (const id of stagedRemovals) await db.attachments.delete(id);
  await attachPendingToMessage(chatId, messageId);
}

/**
 * Stage an in-progress edit's attachments onto a fresh branch chat (Branch
 * path, spec §8): copy each surviving original (bound to `editingMessageId`,
 * minus `stagedRemovals`) as a new pending row on `targetChatId`, and re-home
 * the source chat's pending additions onto `targetChatId`. The subsequent
 * re-send binds them to the new user message. Blobs are duplicated — a branch
 * is a genuine fork.
 */
export async function copyEditAttachmentsToChat(
  sourceChatId: string,
  editingMessageId: string,
  stagedRemovals: string[],
  targetChatId: string,
): Promise<void> {
  const db = getClientDataDb();
  const removals = new Set(stagedRemovals);

  const originals = await db.attachments.where('messageId').equals(editingMessageId).toArray();
  for (const a of originals) {
    if (removals.has(a.id)) continue;
    await addAttachment({
      chatId: targetChatId,
      kind: a.kind,
      fileName: a.fileName,
      mime: a.mime,
      blob: a.blob,
      text: a.text,
      width: a.width,
      height: a.height,
      origin: a.origin,
      kbRef: a.kbRef,
    });
  }

  const additions = await listPendingAttachments(sourceChatId);
  for (const a of additions) await db.attachments.update(a.id, { chatId: targetChatId });
}
```

> Note: `db.attachments.where('messageId').equals(editingMessageId)` requires `messageId` to be indexed. If it is not, use `.filter((a) => a.messageId === editingMessageId)` over `.where('chatId').equals(sourceChatId)` instead (mirroring `listPendingAttachments`). Check the `attachments` store schema string in `client-data-db.ts` first and pick the matching form.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/data/attachment-staging.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/data/attachments.ts tests/data/attachment-staging.test.ts
git commit -m "Add edit-attachment staging helpers (commit-to-message, copy-to-chat)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Replace-in-place data path — `useEditAndReplace`

**Files:**
- Modify: `src/data/message-edit.ts` (add the hook)
- Test: `tests/data/edit-and-replace.test.ts`

**Interfaces:**
- Consumes: `mutateSynced` (`sync/enqueue.js`), `commitEditAttachmentsToMessage` (Task 3), `useRegenerate` (`send-message.js`), `getClientDataDb`.
- Produces: `useEditAndReplace()` → mutation `{ chatId: string; messageId: string; text: string; stagedRemovals: string[]; reasoning: ReasoningState }`. Writes the edited text (`contentBlocks: [{type:'text',text}]`, bumps `updatedAt`) via `mutateSynced`, commits staged attachments, then delegates to `useRegenerate` to re-roll the reply. Clears `editingMessageId` on success.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { queryClient } from '../../src/lib/queryClient.js';
import { useEditAndReplace } from '../../src/data/message-edit.js';
import * as sendMessage from '../../src/data/send-message.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1', personaId: 'p1', title: 'T', resolvedMindspaceId: 'm1',
    createdAt: 1, updatedAt: 1, lastMessageAt: 3, bookmarkedMessageCount: 0,
    draftInput: '', libraryIds: [], editingMessageId: 'u1',
  });
  await db.messages.bulkAdd([
    { id: 'u1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'orig' }], createdAt: 1, updatedAt: 1, bookmarked: false, streamingState: 'complete' },
    { id: 'p1m', chatId: 'c1', role: 'persona', contentBlocks: [{ type: 'text', text: 'reply' }], createdAt: 2, updatedAt: 2, bookmarked: false, streamingState: 'complete' },
  ]);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
  vi.restoreAllMocks();
});

describe('useEditAndReplace', () => {
  it('writes edited text, clears editingMessageId, and triggers regenerate', async () => {
    const regenerate = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(sendMessage, 'useRegenerate').mockReturnValue({ mutateAsync: regenerate } as never);

    const { result } = renderHook(() => useEditAndReplace(), { wrapper });
    await result.current.mutateAsync({
      chatId: 'c1', messageId: 'u1', text: 'edited', stagedRemovals: [], reasoning: 'off' as never,
    });

    const db = getClientDataDb();
    const u1 = await db.messages.get('u1');
    expect(u1?.contentBlocks).toEqual([{ type: 'text', text: 'edited' }]);
    expect(u1?.updatedAt).toBeGreaterThan(1);
    expect((await db.chats.get('c1'))?.editingMessageId).toBeNull();
    await waitFor(() => expect(regenerate).toHaveBeenCalledWith({ chatId: 'c1', reasoning: 'off' }));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/data/edit-and-replace.test.ts`
Expected: FAIL — `useEditAndReplace` not exported.

- [ ] **Step 3: Implement the hook**

Append to `src/data/message-edit.ts` (add imports at the top: `useMutation`, `useQueryClient` from `@tanstack/react-query`; `mutateSynced` from `../sync/enqueue.js`; `commitEditAttachmentsToMessage` from `./attachments.js`; `useRegenerate` from `./send-message.js`; `getClientDataDb` from `../boot/client-data-db.js`; `ReasoningState` type from wherever `send-message.ts` imports it):

```ts
export interface EditReplaceArgs {
  chatId: string;
  messageId: string;
  text: string;
  stagedRemovals: string[];
  reasoning: ReasoningState;
}

/** Replace-in-place (spec §6.1): overwrite the edited user message, commit its
 *  attachment changes, then re-roll the following reply via the existing
 *  regenerate path. Only valid when the message is the last user message. */
export function useEditAndReplace() {
  const qc = useQueryClient();
  const regenerate = useRegenerate();
  return useMutation({
    mutationFn: async (args: EditReplaceArgs): Promise<void> => {
      await mutateSynced({
        collection: 'messages',
        key: args.messageId,
        tables: ['messages'],
        write: async (tx) => {
          await tx.table('messages').update(args.messageId, {
            contentBlocks: [{ type: 'text', text: args.text }],
            updatedAt: Date.now(),
          });
        },
      });
      await commitEditAttachmentsToMessage(args.chatId, args.messageId, args.stagedRemovals);
      await getClientDataDb().chats.update(args.chatId, { editingMessageId: null });
      await regenerate.mutateAsync({ chatId: args.chatId, reasoning: args.reasoning });
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['chats', vars.chatId] });
      void qc.invalidateQueries({ queryKey: ['attachments', 'pending'] });
    },
  });
}
```

> `ReasoningState` is the type `useRegenerate`/`useSendMessage` already accept (`send-message.ts` `RegenerateArgs.reasoning`). Import it from the same module it is declared in — grep `export .*ReasoningState` — do not redefine it.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/data/edit-and-replace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/message-edit.ts tests/data/edit-and-replace.test.ts
git commit -m "Add useEditAndReplace — edit last message then regenerate in place

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Branch-on-edit data path — `useEditAndBranch`

**Files:**
- Modify: `src/data/message-edit.ts` (add the hook + a `copyPriorMessages` helper)
- Test: `tests/data/edit-and-branch.test.ts`

**Interfaces:**
- Consumes: `useSendMessage` (`send-message.js`), `copyEditAttachmentsToChat` (Task 3), `enqueueSync`/`isLinkedForSync`/`scheduleClass1Sync` + `uuidv7` + `getClientDataDb` (mirror `useBranchChat` in `chats.ts`), `structuredClone`, `ContentBlock`.
- Produces: `useEditAndBranch()` → mutation `{ sourceChatId: string; personaId: string; editingMessageId: string; text: string; stagedRemovals: string[]; reasoning: ReasoningState }` → returns `newChatId`. Copies the chat + every message **before** `editingMessageId` (exclusive) into a fresh chat (auto-title: `title: null`), copies attachments onto it, then re-issues the edited message via `useSendMessage` into the new chat. Clears `editingMessageId` on the source. Caller navigates to `newChatId`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { queryClient } from '../../src/lib/queryClient.js';
import { useEditAndBranch } from '../../src/data/message-edit.js';
import * as sendMessage from '../../src/data/send-message.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.messages.clear();
  await db.chats.clear();
  await db.chats.add({
    id: 'c1', personaId: 'p1', title: 'T', resolvedMindspaceId: 'm1',
    createdAt: 1, updatedAt: 1, lastMessageAt: 4, bookmarkedMessageCount: 0,
    draftInput: '', libraryIds: ['lib1'], editingMessageId: 'u2',
  });
  await db.messages.bulkAdd([
    { id: 'u1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'first' }], createdAt: 1, updatedAt: 1, bookmarked: false, streamingState: 'complete' },
    { id: 'p1m', chatId: 'c1', role: 'persona', contentBlocks: [{ type: 'text', text: 'r1' }], createdAt: 2, updatedAt: 2, bookmarked: false, streamingState: 'complete' },
    { id: 'u2', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'second' }], createdAt: 3, updatedAt: 3, bookmarked: false, streamingState: 'complete' },
    { id: 'p2m', chatId: 'c1', role: 'persona', contentBlocks: [{ type: 'text', text: 'r2' }], createdAt: 4, updatedAt: 4, bookmarked: false, streamingState: 'complete' },
  ]);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
  vi.restoreAllMocks();
});

describe('useEditAndBranch', () => {
  it('copies prior messages (exclusive of the edited one) and re-sends into the new chat', async () => {
    const send = vi.fn().mockResolvedValue('ignored');
    vi.spyOn(sendMessage, 'useSendMessage').mockReturnValue({ mutateAsync: send } as never);

    const { result } = renderHook(() => useEditAndBranch(), { wrapper });
    const newChatId = await result.current.mutateAsync({
      sourceChatId: 'c1', personaId: 'p1', editingMessageId: 'u2',
      text: 'second edited', stagedRemovals: [], reasoning: 'off' as never,
    });

    const db = getClientDataDb();
    // New chat exists, auto-titled (null), copies libraryIds.
    const branched = await db.chats.get(newChatId);
    expect(branched?.title).toBeNull();
    expect(branched?.libraryIds).toEqual(['lib1']);
    // Copied messages are u1 + p1m only (everything before u2). u2/p2m NOT copied.
    const copied = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    expect(copied.map((m) => m.contentBlocks)).toEqual([[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'r1' }]]);
    // The edited message is re-issued as a normal send into the new chat.
    expect(send).toHaveBeenCalledWith({ chatId: newChatId, personaId: 'p1', text: 'second edited', reasoning: 'off' });
    // Source edit marker cleared.
    expect((await db.chats.get('c1'))?.editingMessageId).toBeNull();
    // Source chat is untouched (still 4 messages).
    expect(await db.messages.where('chatId').equals('c1').count()).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/data/edit-and-branch.test.ts`
Expected: FAIL — `useEditAndBranch` not exported.

- [ ] **Step 3: Implement `copyPriorMessages` + the hook**

Append to `src/data/message-edit.ts` (add imports: `enqueueSync`, `scheduleClass1Sync`, `isLinkedForSync` — grep `useBranchChat` in `chats.ts` for their exact import paths; `uuidv7`; `useSendMessage` from `./send-message.js`; `copyEditAttachmentsToChat` from `./attachments.js`; `ContentBlock` from `../boot/client-data-db.js`):

```ts
/** Copy a chat + all messages/pills BEFORE `beforeMessageId` (exclusive) into a
 *  fresh chat. Returns the new chat id. Mirrors useBranchChat but stops before
 *  the cut and auto-titles (title: null). */
async function copyPriorMessages(sourceChatId: string, beforeMessageId: string): Promise<string> {
  const db = getClientDataDb();
  const newChatId = uuidv7();
  const now = Date.now();
  const linked = isLinkedForSync();

  await db.transaction('rw', [db.chats, db.messages, db.pills, db.syncOutbox], async (tx) => {
    const source = await db.chats.get(sourceChatId);
    if (!source) throw new Error(`copyPriorMessages: source chat ${sourceChatId} not found`);

    const allMsgs = await db.messages.where('chatId').equals(sourceChatId).sortBy('createdAt');
    const cutIdx = allMsgs.findIndex((m) => m.id === beforeMessageId);
    if (cutIdx === -1) throw new Error(`copyPriorMessages: cut ${beforeMessageId} not found`);
    const copied = allMsgs.slice(0, cutIdx); // EXCLUSIVE of the edited message

    const copiedIds = copied.map((m) => m.id);
    const pills = copiedIds.length ? await db.pills.where('messageId').anyOf(copiedIds).toArray() : [];
    const msgIdMap = new Map(copied.map((m) => [m.id, uuidv7()]));
    const pillIdMap = new Map(pills.map((pl) => [pl.id, uuidv7()]));
    const lastCopied = copied[copied.length - 1];

    await db.chats.add({
      id: newChatId,
      personaId: source.personaId,
      title: null,
      resolvedMindspaceId: source.resolvedMindspaceId,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: lastCopied?.createdAt ?? now,
      bookmarkedMessageCount: copied.filter((m) => m.bookmarked).length,
      draftInput: '',
      libraryIds: [...source.libraryIds],
    });
    if (linked) enqueueSync(tx, 'chats', newChatId, 'upsert');

    for (const m of copied) {
      const newMessageId = msgIdMap.get(m.id) ?? uuidv7();
      const blocks = (structuredClone(m.contentBlocks) as ContentBlock[]).map((b) =>
        b.type === 'pill' ? { ...b, pillId: pillIdMap.get(b.pillId) ?? b.pillId } : b,
      );
      await db.messages.add({
        id: newMessageId, chatId: newChatId, role: m.role, contentBlocks: blocks,
        createdAt: m.createdAt, updatedAt: m.updatedAt, bookmarked: m.bookmarked,
        bookmarkLabel: m.bookmarkLabel, kind: m.kind, streamingState: m.streamingState,
      });
      if (linked) enqueueSync(tx, 'messages', newMessageId, 'upsert');
    }
    for (const pl of pills) {
      const newPillId = pillIdMap.get(pl.id) ?? uuidv7();
      await db.pills.add({
        id: newPillId, messageId: msgIdMap.get(pl.messageId) ?? pl.messageId, kind: pl.kind,
        positionHint: pl.positionHint, status: pl.status, payload: structuredClone(pl.payload),
        createdAt: pl.createdAt,
      });
      if (linked) enqueueSync(tx, 'pills', newPillId, 'upsert');
    }
  });
  if (linked) scheduleClass1Sync();
  return newChatId;
}

export interface EditBranchArgs {
  sourceChatId: string;
  personaId: string;
  editingMessageId: string;
  text: string;
  stagedRemovals: string[];
  reasoning: ReasoningState;
}

/** Branch-on-edit (spec §6.2): fork the chat up to (exclusive of) the edited
 *  message, carry the edited attachments over, then re-issue the edited message
 *  through the normal send path into the new chat. Returns the new chat id. */
export function useEditAndBranch() {
  const qc = useQueryClient();
  const send = useSendMessage();
  return useMutation({
    mutationFn: async (args: EditBranchArgs): Promise<string> => {
      const newChatId = await copyPriorMessages(args.sourceChatId, args.editingMessageId);
      await copyEditAttachmentsToChat(args.sourceChatId, args.editingMessageId, args.stagedRemovals, newChatId);
      await getClientDataDb().chats.update(args.sourceChatId, { editingMessageId: null });
      await send.mutateAsync({
        chatId: newChatId, personaId: args.personaId, text: args.text, reasoning: args.reasoning,
      });
      return newChatId;
    },
    onSuccess: (newChatId) => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
      void qc.invalidateQueries({ queryKey: ['chats', newChatId] });
      void qc.invalidateQueries({ queryKey: ['attachments', 'pending'] });
    },
  });
}
```

> **Known limitation (matches existing `useBranchChat`):** copied prior messages do not carry their own attachments — only the edited message's attachments travel (via the re-send). This mirrors today's Branch button exactly, so it is no regression; a future improvement could copy prior-message attachments for both paths. Noted in the spec's watch item.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/data/edit-and-branch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/message-edit.ts tests/data/edit-and-branch.test.ts
git commit -m "Add useEditAndBranch — fork before the edited message then re-send

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: `MessageControls` — Edit affordance, Branch glyph, Save→overflow

**Files:**
- Modify: `src/components/chat/MessageControls.tsx`
- Test: `tests/components/chat/MessageControls.edit.test.tsx`

**Interfaces:**
- Consumes: `OverflowMenu` (existing), `MessageRow`.
- Produces: two new props on `MessageControls`:
  - `onEdit?: () => void` — present only for editable user messages.
  - `editDisabled?: boolean` — true while a stream is live (disabled-with-tooltip).
- Behaviour change: for **user** messages, `Save as artefact` moves into a `⋯` `OverflowMenu`; `Edit`/`Branch`/`Copy`/`Bookmark` stay flat. **Persona** messages are unchanged. Branch's glyph changes `✎` → `⎇`.

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import { MessageControls } from '../../../src/components/chat/MessageControls.js';

const userMsg: MessageRow = {
  id: 'u1', chatId: 'c1', role: 'user',
  contentBlocks: [{ type: 'text', text: 'hi' }],
  createdAt: 1, updatedAt: 1, bookmarked: false, streamingState: 'complete',
};
const base = { message: userMsg, onCopy: () => {}, onBookmark: () => {} };

describe('MessageControls — edit affordance (user messages)', () => {
  it('renders an Edit button that fires onEdit', () => {
    const onEdit = vi.fn();
    render(<MessageControls {...base} onEdit={onEdit} />);
    fireEvent.click(screen.getByText(/✎ Edit/));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('disables Edit with the live-stream tooltip', () => {
    render(<MessageControls {...base} onEdit={() => {}} editDisabled />);
    const btn = screen.getByText(/✎ Edit/).closest('button');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toMatch(/paused while replying/i);
  });

  it('moves Save into the overflow on a user message (not on the flat row)', () => {
    render(<MessageControls {...base} onEdit={() => {}} onSave={() => {}} canSave />);
    // No flat Save button.
    expect(screen.queryByText(/◆ Save/)).toBeNull();
    // It lives behind the ⋯ trigger.
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByText(/Save as artefact/i)).toBeTruthy();
  });

  it('Branch no longer uses the pencil glyph', () => {
    render(<MessageControls {...base} onBranch={() => {}} />);
    expect(screen.getByText(/⎇ Branch/)).toBeTruthy();
    expect(screen.queryByText(/✎ Branch/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/components/chat/MessageControls.edit.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `MessageControls.tsx`**

Replace the file body with the version below. Changes from current: (a) `onEdit`/`editDisabled` added to `Props`; (b) an `Edit` flat button rendered for user messages (before Branch); (c) Branch label `✎ Branch` → `⎇ Branch`; (d) the flat `Save` button is gated to persona messages; (e) a user-message `OverflowMenu` carrying `Save as artefact` (disabled-with-reason when `!canSave`).

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { MessageRow } from '../../boot/client-data-db.js';
import { syncCopy } from '../../sync/copy.js';
import { useClass2Gate } from '../../sync/gate.js';
import { OverflowMenu, type OverflowItem } from '../ui/OverflowMenu.js';

interface Props {
  message: MessageRow;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
  /** Re-compose this user message in the prompt composer (user messages only). */
  onEdit?: () => void;
  /** Disable editing (e.g. while a stream is live for this chat). */
  editDisabled?: boolean;
  /** Fork the chat at this message. */
  onBranch?: () => void;
  /** Disable branching (e.g. while a stream is live for this chat). */
  branchDisabled?: boolean;
  /** Save this message's visible text as a Markdown artefact. */
  onSave?: () => void;
  /** Whether the message has text to save (disabled-over-hidden otherwise). */
  canSave?: boolean;
  /** Save the conversation up to this persona message as a seed template.
   *  Lives in the overflow (⋯), not the flat row, to avoid crowding at 380px. */
  onSaveAsTemplate?: () => void;
  /** Start reading this message aloud (persona messages only). */
  onReadAloud?: () => void;
  readDisabledReason?: 'no-provider' | 'no-voice' | 'nothing' | null;
}

const READ_TOOLTIP: Record<'no-provider' | 'no-voice' | 'nothing', string> = {
  'no-provider': 'Set up a TTS provider in My Settings',
  'no-voice': 'Give this persona a voice in its editor',
  nothing: 'Nothing to read aloud in this message',
};

function stop(e: React.MouseEvent): void {
  e.stopPropagation();
}

export function MessageControls(p: Props): JSX.Element {
  const [readNote, setReadNote] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState(false);
  const bookmarkGate = useClass2Gate();
  const isUser = p.message.role === 'user';

  // On a user message the Save action lives in the overflow (spec §5.1 — keeps
  // the flat row calm at 380px, mirroring the persona row's "Save as template").
  const userOverflow: OverflowItem[] = [];
  if (isUser && p.onSave) {
    userOverflow.push({
      label: 'Save as artefact',
      onSelect: p.canSave ? p.onSave : undefined,
      disabled: !p.canSave,
      disabledReason: 'No text to save',
    });
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation wrapper div — buttons inside handle keyboard events
    <div className="msg-controls" onClick={stop}>
      {isUser && p.onEdit ? (
        <button
          type="button"
          data-ctrl="edit"
          onClick={p.editDisabled ? undefined : p.onEdit}
          disabled={p.editDisabled}
          title={p.editDisabled ? 'Editing paused while replying' : 'Edit this message'}
          className="ctrl-btn"
        >
          ✎ Edit
        </button>
      ) : null}
      <button
        type="button"
        data-ctrl="branch"
        onClick={p.onBranch}
        disabled={p.branchDisabled || !p.onBranch}
        title={p.branchDisabled ? 'Branching paused while replying' : 'Branch this chat from here'}
        className="ctrl-btn"
      >
        ⎇ Branch
      </button>
      {p.onRegenerate ? (
        <button
          type="button"
          data-ctrl="regenerate"
          onClick={p.onRegenerate}
          title={p.message.kind === 'opener' ? 'Re-roll the greeting' : 'Regenerate this reply'}
          className="ctrl-btn"
        >
          ↻ Regenerate
        </button>
      ) : null}
      <button type="button" data-ctrl="copy" onClick={p.onCopy} className="ctrl-btn">
        ⎘ Copy
      </button>
      <button
        type="button"
        data-ctrl="bookmark"
        data-active={p.message.bookmarked || undefined}
        data-disabled={bookmarkGate.disabled ? 'true' : undefined}
        aria-disabled={bookmarkGate.disabled ? true : undefined}
        onClick={() => {
          if (bookmarkGate.disabled) {
            setBookmarkNote(true);
            return;
          }
          setBookmarkNote(false);
          p.onBookmark();
        }}
        title={bookmarkGate.disabled ? syncCopy.offlineBookmark : 'Bookmark this message'}
        className="ctrl-btn"
      >
        ◈ Bookmark
      </button>
      {bookmarkNote && bookmarkGate.disabled ? (
        <output className="ctrl-note">{syncCopy.offlineBookmark}</output>
      ) : null}
      {!isUser ? (
        <button
          type="button"
          data-ctrl="save"
          onClick={p.onSave}
          disabled={!p.canSave || !p.onSave}
          title={p.canSave ? 'Save this message as an artefact' : 'No text to save'}
          className="ctrl-btn"
        >
          ◆ Save
        </button>
      ) : null}
      {isUser && userOverflow.length ? <OverflowMenu items={userOverflow} /> : null}
      {p.message.role === 'persona' ? (
        <>
          <button
            type="button"
            data-ctrl="read"
            data-disabled={!p.onReadAloud || p.readDisabledReason ? 'true' : undefined}
            aria-disabled={!p.onReadAloud || p.readDisabledReason ? true : undefined}
            onClick={() => {
              if (p.readDisabledReason) {
                setReadNote(true);
                return;
              }
              setReadNote(false);
              p.onReadAloud?.();
            }}
            title={p.readDisabledReason ? READ_TOOLTIP[p.readDisabledReason] : 'Read this message aloud'}
            className="ctrl-btn"
          >
            ▸ Read
          </button>
          {readNote && p.readDisabledReason ? (
            <output className="ctrl-note">{READ_TOOLTIP[p.readDisabledReason]}</output>
          ) : null}
          {p.onSaveAsTemplate ? (
            <OverflowMenu items={[{ label: 'Save as template', onSelect: p.onSaveAsTemplate }]} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/components/chat/MessageControls.edit.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Run the existing MessageControls tests for regressions**

Run: `pnpm --filter user-client test -- tests/components/chat/MessageControls`
Expected: PASS — if `MessageControls.branch.test.tsx` asserts the `✎ Branch` label, update that assertion to `⎇ Branch` (glyph change is intentional).

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/MessageControls.tsx tests/components/chat/MessageControls.edit.test.tsx
git commit -m "Add Edit control to user messages; re-glyph Branch; move Save to overflow

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: Edit-session transient state in `current-chat.store`

**Files:**
- Modify: `src/state/current-chat.store.ts`
- Test: `tests/state/current-chat-edit.test.ts` (or extend the existing store test)

**Interfaces:**
- Produces on `useCurrentChatStore`:
  - `editStagedRemovals: string[]` — attachment ids the user removed while editing (transient; not persisted).
  - `stageRemoval(id: string): void` — add an id.
  - `unstageRemoval(id: string): void` — remove an id (undo).
  - `resetEditSession(): void` — clear `editStagedRemovals` (called on enter-edit, cancel, and commit).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().resetEditSession());

describe('current-chat edit session', () => {
  it('stages and unstages attachment removals', () => {
    const s = () => useCurrentChatStore.getState();
    s().stageRemoval('a1');
    s().stageRemoval('a2');
    expect(s().editStagedRemovals).toEqual(['a1', 'a2']);
    s().unstageRemoval('a1');
    expect(s().editStagedRemovals).toEqual(['a2']);
    s().resetEditSession();
    expect(s().editStagedRemovals).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/state/current-chat-edit.test.ts`
Expected: FAIL — actions not defined.

- [ ] **Step 3: Add the state slice**

In `src/state/current-chat.store.ts`, add to the state type and the store creator (follow the existing shape of the store — grep the file first for its `create<...>()` block):

```ts
  // — Edit-session transient state (spec 2026-07-18 §8). Never persisted; the
  //   edit *target* lives on ChatRow.editingMessageId, but the staged attachment
  //   removals are in-session only. —
  editStagedRemovals: [] as string[],
  stageRemoval: (id: string) =>
    set((s) => (s.editStagedRemovals.includes(id) ? s : { editStagedRemovals: [...s.editStagedRemovals, id] })),
  unstageRemoval: (id: string) =>
    set((s) => ({ editStagedRemovals: s.editStagedRemovals.filter((x) => x !== id) })),
  resetEditSession: () => set({ editStagedRemovals: [] }),
```

Add matching entries to the store's TypeScript state interface: `editStagedRemovals: string[]; stageRemoval: (id: string) => void; unstageRemoval: (id: string) => void; resetEditSession: () => void;`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/state/current-chat-edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/current-chat.store.ts tests/state/current-chat-edit.test.ts
git commit -m "Add transient edit-session staged-removals to current-chat store

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Composer — edit banner, split send button, attachment view, focus

**Files:**
- Create: `src/components/chat/EditSendButton.tsx`
- Modify: `src/components/chat/Cockpit.tsx`
- Modify: `src/components/chat/InteractionMode.tsx` (thread new props)
- Test: `tests/components/chat/EditSendButton.test.tsx`, `tests/components/chat/Cockpit.edit.test.tsx`

**Interfaces:**
- Consumes: `usePendingAttachments`, `useCurrentChatStore` (Task 7), the message-edit hooks.
- Produces new `Cockpit`/`InteractionMode` props:
  - `editingMessageId: string | null`
  - `canReplace: boolean` — derived (Task 2) by the parent; drives the split button.
  - `editAttachments: AttachmentRow[]` — the computed edit view (originals − removals + additions); replaces `pending` in the strip while editing.
  - `onReplace: () => void`, `onBranch: () => void`, `onCancelEdit: () => void`.
- `EditSendButton` props: `{ canReplace: boolean; disabledReason: string | null; onReplace: () => void; onBranch: () => void; busy: boolean }`.

### 8a — `EditSendButton` (the split control)

- [ ] **Step 1: Write the failing test** (`tests/components/chat/EditSendButton.test.tsx`)

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditSendButton } from '../../../src/components/chat/EditSendButton.js';

describe('EditSendButton', () => {
  it('last message: primary Replace fires onReplace; Branch is the secondary', () => {
    const onReplace = vi.fn();
    const onBranch = vi.fn();
    render(<EditSendButton canReplace disabledReason={null} onReplace={onReplace} onBranch={onBranch} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/i }));
    expect(onReplace).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /more/i })); // open the caret menu
    fireEvent.click(screen.getByText(/Branch to a new chat/i));
    expect(onBranch).toHaveBeenCalledOnce();
  });

  it('not last: Replace is present but disabled with its reason; primary is Branch', () => {
    const onReplace = vi.fn();
    render(
      <EditSendButton
        canReplace={false}
        disabledReason="There are newer messages after this — editing here starts a branch."
        onReplace={onReplace}
        onBranch={() => {}}
        busy={false}
      />,
    );
    // Primary action is Branch.
    expect(screen.getByRole('button', { name: /^Branch/i })).toBeTruthy();
    // Replace is still visibly present, disabled, carrying the reason (never collapsed away).
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    const replace = screen.getByText(/^Replace$/i).closest('button');
    expect(replace?.disabled).toBe(true);
    expect(replace?.getAttribute('title')).toMatch(/newer messages/i);
    fireEvent.click(replace as Element);
    expect(onReplace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/components/chat/EditSendButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EditSendButton`**

Create `src/components/chat/EditSendButton.tsx`. Uses `OverflowMenu` for the caret secondary so the hard constraint (Replace visibly-present-but-disabled when not last; Branch always visible) is structural.

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { OverflowMenu, type OverflowItem } from '../ui/OverflowMenu.js';

interface Props {
  /** Whether the edited message is still the last user message. */
  canReplace: boolean;
  /** Reason Replace is unavailable, or null when it is. Shown on the disabled item. */
  disabledReason: string | null;
  onReplace: () => void;
  onBranch: () => void;
  busy: boolean;
}

/**
 * Context-aware split send control for an in-progress edit (spec §11.1).
 * Last message → primary Replace, caret → Branch. Not last → primary Branch,
 * caret → Replace shown *disabled with its reason* (never collapsed away — the
 * hard constraint that keeps the cross-device case honest).
 */
export function EditSendButton(p: Props): JSX.Element {
  if (p.canReplace) {
    const secondary: OverflowItem[] = [
      { label: 'Branch to a new chat instead', onSelect: p.onBranch },
    ];
    return (
      <div className="edit-send">
        <button
          type="button"
          className="edit-send-primary"
          onClick={p.onReplace}
          disabled={p.busy}
        >
          Replace
        </button>
        <OverflowMenu items={secondary} triggerLabel="More send options" />
      </div>
    );
  }
  const secondary: OverflowItem[] = [
    {
      label: 'Replace',
      disabled: true,
      disabledReason: p.disabledReason ?? 'Not available for an earlier message',
    },
  ];
  return (
    <div className="edit-send">
      <button type="button" className="edit-send-primary" onClick={p.onBranch} disabled={p.busy}>
        Branch to a new chat
      </button>
      <OverflowMenu items={secondary} triggerLabel="More send options" />
    </div>
  );
}
```

> Confirm `OverflowMenu` renders a disabled item's `disabledReason` as a `title` (the tests in `MessageControls` rely on tooltip copy; check `OverflowMenu.tsx` — it announces `disabledReason` via `aria-describedby`/`title`). If it only sets `aria-describedby`, add `title={disabledReason}` to the disabled item button in `OverflowMenu.tsx` so the tooltip assertion holds. Keep that change minimal.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter user-client test -- tests/components/chat/EditSendButton.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/EditSendButton.tsx tests/components/chat/EditSendButton.test.tsx
git commit -m "Add EditSendButton — context-aware Replace/Branch split control

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

### 8b — Wire the edit state into `Cockpit`

- [ ] **Step 6: Write the failing test** (`tests/components/chat/Cockpit.edit.test.tsx`)

Render `Cockpit` with `editingMessageId` set and assert: (a) the edit banner renders with the correct variant; (b) `EditSendButton` replaces the normal send control; (c) the attachment strip shows `editAttachments` not `pending`. Mirror the provider/DB harness from `tests/unit/chat-page.test.tsx` for any hooks Cockpit calls. Concretely assert banner copy:

```tsx
// (imports + a renderCockpit helper mirroring existing Cockpit tests)
it('shows the last-message edit banner and the split send button', () => {
  renderCockpit({ editingMessageId: 'u9', canReplace: true, editAttachments: [] });
  expect(screen.getByText(/editing your message/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Replace$/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
});
it('shows the earlier-message branch foreshadow banner', () => {
  renderCockpit({ editingMessageId: 'u2', canReplace: false, editAttachments: [] });
  expect(screen.getByText(/earlier message.*start a new branch/i)).toBeTruthy();
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/components/chat/Cockpit.edit.test.tsx`
Expected: FAIL.

- [ ] **Step 8: Add the edit props + render branches to `Cockpit.tsx`**

1. Extend the `Props` interface (after `onSend`):

```ts
  /** Non-null when this chat's composer is editing an existing message (spec 2026-07-18). */
  editingMessageId: string | null;
  /** Whether Replace-in-place is available (derived: the edited message is still last). */
  canReplace: boolean;
  /** The edit view of attachments (originals − staged removals + additions). */
  editAttachments: AttachmentRow[];
  onReplace: () => void;
  onBranchEdit: () => void;
  onCancelEdit: () => void;
```

2. Compute editing mode + the attachment list actually shown:

```ts
  const editing = p.editingMessageId !== null;
  const { data: pending = [] } = usePendingAttachments(p.chatId);
  const shownAttachments = editing ? p.editAttachments : pending;
```

Replace the `AttachmentStrip` feed (line ~552) `attachments={pending}` with `attachments={shownAttachments}`.

3. Render the banner above the input row when `editing` (choose copy by `p.canReplace`):

```tsx
  {editing ? (
    <div className="cockpit-edit-banner" role="status">
      <span>
        {p.canReplace
          ? 'Editing your message'
          : 'Editing an earlier message — sending will start a new branch.'}
      </span>
      <button type="button" className="cockpit-edit-cancel" onClick={p.onCancelEdit}>
        Cancel
      </button>
    </div>
  ) : null}
```

4. Swap the send control while editing. Where `DualActionBtn` renders the send button (line ~622), branch on `editing`:

```tsx
  {editing ? (
    <EditSendButton
      canReplace={p.canReplace}
      disabledReason={
        p.canReplace ? null : 'There are newer messages after this — editing here starts a branch.'
      }
      onReplace={p.onReplace}
      onBranch={p.onBranchEdit}
      busy={p.isStreamLive}
    />
  ) : (
    /* …existing DualActionBtn send button unchanged… */
  )}
```

5. Focus on enter-edit: add an effect that focuses + scrolls the input into view when `editingMessageId` transitions to non-null. The `AutoSizeTextarea` needs a ref; if it forwards one, use it, else wrap the input container in a ref and call `scrollIntoView` + focus the textarea DOM node:

```ts
  const editRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (p.editingMessageId === null) return;
    editRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    editRef.current?.querySelector('textarea')?.focus();
  }, [p.editingMessageId]);
```

Attach `ref={editRef}` to the `cockpit-row-input` container.

Add the imports: `EditSendButton` from `./EditSendButton.js`, `AttachmentRow` type from `../../boot/client-data-db.js`, `useEffect`/`useRef` from `react` (if not already imported).

- [ ] **Step 9: Thread the props through `InteractionMode.tsx`**

Add the six new props to `InteractionMode`'s `Props` and pass them straight through to `<Cockpit>` (lines ~193-209): `editingMessageId`, `canReplace`, `editAttachments`, `onReplace`, `onBranchEdit`, `onCancelEdit`. `InteractionMode` is a pure pass-through here.

- [ ] **Step 10: Run the tests to confirm they pass**

Run: `pnpm --filter user-client test -- tests/components/chat/Cockpit.edit.test.tsx`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/components/chat/Cockpit.tsx src/components/chat/InteractionMode.tsx tests/components/chat/Cockpit.edit.test.tsx
git commit -m "Wire edit banner, split send button and edit attachment view into the composer

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: `chat-page` orchestration — enter/cancel/commit + live derivation

**Files:**
- Modify: `src/routes/app/chat/chat-page.tsx`
- Modify: `src/components/chat/ChatStream.tsx` (pass `onEdit`/`editDisabled` to `MessageControls` for user messages) and its intermediaries (`MessageBlock.tsx`) as needed.
- Test: `tests/unit/chat-page-edit.test.tsx`

**Interfaces:**
- Consumes: `useEditAndReplace`, `useEditAndBranch` (Tasks 4/5), `canReplaceInPlace`, `lastRealUserMessage`, `messageText` (Task 2), `useCurrentChatStore` edit slice (Task 7), the existing `messages`, `draft`/`setDraft`, `updateChat`, `reasoning`, `isStreamLive`.
- Produces: full enter → compose → Replace/Branch/Cancel flow.

- [ ] **Step 1: Write the failing test**

A page-level test (provider-wrapped harness from `tests/unit/chat-page.test.tsx`): seed a chat with a user + persona message; render `ChatPage`; expand the last user message's controls; click Edit; assert the composer shows the message text as the draft and the split send button appears; click Cancel; assert `editingMessageId` cleared and the draft empty. Assert that entering edit sets `chats.editingMessageId` to the message id, and cancelling nulls it. Keep the network/stream mocked (spy `useEditAndReplace`/`useEditAndBranch` to observe args).

```tsx
it('enter → edit sets editingMessageId and loads the text; cancel clears both', async () => {
  const { chatId } = await seedChatWithUserMessage('hello world'); // helper seeds u+p rows
  render(<ChatPage />, { wrapper: makeWrapper(qc, `/app/chat/${chatId}`) });
  // expand controls on the user message and click Edit
  await userClicksEditOnLastUserMessage();
  await waitFor(() =>
    expect((getClientDataDb().chats.get(chatId)).then((c) => c?.editingMessageId)).resolves.toBe(theUserMsgId),
  );
  expect(screen.getByRole('button', { name: /^Replace$/i })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  await waitFor(async () => expect((await getClientDataDb().chats.get(chatId))?.editingMessageId).toBeNull());
});
```

> This test is integration-flavoured; if the full `ChatPage` render is too heavy to drive reliably, split the orchestration into a small pure module `src/routes/app/chat/use-edit-orchestration.ts` (enterEdit/cancelEdit/commit builders taking `{ setDraft, updateChat, reasoning, messages }`) and unit-test *that* directly, keeping `chat-page.tsx` a thin caller. Prefer the pure-module split — it is more reliable to test and keeps `chat-page.tsx` from growing.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter user-client test -- tests/unit/chat-page-edit.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the orchestration in `chat-page.tsx`**

Add near the other chat-page state/hooks:

```ts
  const editAndReplace = useEditAndReplace();
  const editAndBranch = useEditAndBranch();
  const { editStagedRemovals, stageRemoval, unstageRemoval, resetEditSession } =
    useCurrentChatStore();

  const editingMessageId = chatQuery.data?.chat?.editingMessageId ?? null;
  const canReplace = editingMessageId
    ? canReplaceInPlace(messages, editingMessageId)
    : false;

  // Edit view of attachments: originals bound to the edited message, minus
  // staged removals, plus pending additions. (Attachments are few; query both.)
  const editAttachments = useEditAttachments(activeChatId, editingMessageId, editStagedRemovals);

  const enterEdit = async (m: MessageRow): Promise<void> => {
    resetEditSession();
    setDraft(messageText(m));
    await updateChat.mutateAsync({ id: activeChatId, patch: { editingMessageId: m.id } });
  };

  const cancelEdit = async (): Promise<void> => {
    // Discard pending additions made during this edit; keep originals intact.
    await clearPendingAttachments(activeChatId);
    resetEditSession();
    setDraft('');
    await updateChat.mutateAsync({ id: activeChatId, patch: { editingMessageId: null } });
  };

  const onReplace = async (): Promise<void> => {
    if (!editingMessageId || !effectivePersona) return;
    await editAndReplace.mutateAsync({
      chatId: activeChatId,
      messageId: editingMessageId,
      text: draft,
      stagedRemovals: editStagedRemovals,
      reasoning,
    });
    resetEditSession();
    setDraft('');
  };

  const onBranchEdit = async (): Promise<void> => {
    if (!editingMessageId || !effectivePersona) return;
    const newChatId = await editAndBranch.mutateAsync({
      sourceChatId: activeChatId,
      personaId: effectivePersona.id,
      editingMessageId,
      text: draft,
      stagedRemovals: editStagedRemovals,
      reasoning,
    });
    resetEditSession();
    setDraft('');
    navigate(`/app/chat/${newChatId}`);
  };
```

Add a tiny `clearPendingAttachments(chatId)` in `attachments.ts` (delete rows where `messageId === null` for the chat) if one does not already exist — grep first; there may be a `removeAttachment` you can loop.

Add `useEditAttachments` — a small `useQuery` (co-locate in `attachments.ts`) that returns `[...originalsForMessage(editingMessageId).filter(a => !stagedRemovals.includes(a.id)), ...pending(chatId)]`, or `[]` when `editingMessageId` is null. Invalidate on the `['attachments','pending', chatId]` key so adds refresh it.

Thread the new values into `InteractionMode` (where it is rendered, ~1074): `editingMessageId={editingMessageId}`, `canReplace={canReplace}`, `editAttachments={editAttachments}`, `onReplace={() => void onReplace()}`, `onBranchEdit={() => void onBranchEdit()}`, `onCancelEdit={() => void cancelEdit()}`.

- [ ] **Step 4: Pass `onEdit`/`editDisabled` down to `MessageControls`**

In `ChatStream.tsx` (where `MessageControls` is rendered per message, ~232-273), for **user** messages pass:

```tsx
  onEdit={p.onEdit ? () => p.onEdit?.(message) : undefined}
  editDisabled={isStreamLive}
```

Thread an `onEdit?: (m: MessageRow) => void` prop through `ChatStream` → `MessageBlock` from `chat-page.tsx`, wiring it to `enterEdit`. Only pass it for `message.role === 'user' && !message.seedRole`.

- [ ] **Step 5: Attachment removal routing in edit mode**

The `AttachmentStrip`'s remove handler must, in edit mode, distinguish an *original* (stage its removal via `stageRemoval(id)`) from a *pending addition* (delete the row via the existing remove hook). Pass an `editing` flag + `stageRemoval` into the strip, or resolve it in `Cockpit`'s `onRemove`: if `editingMessageId` and the attachment's `messageId === editingMessageId` → `stageRemoval`; else → existing delete.

- [ ] **Step 6: Run the tests + typecheck**

Run: `pnpm --filter user-client test -- tests/unit/chat-page-edit.test.tsx`
Run: `pnpm typecheck --force`
Expected: PASS; 14/14.

- [ ] **Step 7: Commit**

```bash
git add src/routes/app/chat/chat-page.tsx src/components/chat/ChatStream.tsx src/components/chat/MessageBlock.tsx src/data/attachments.ts tests/unit/chat-page-edit.test.tsx
git commit -m "Wire edit orchestration into chat-page: enter, cancel, replace, branch

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: Full-gate verification + squash prep

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck --force`
Expected: 14/14, 0 cached.

- [ ] **Step 2: Full user-client test suite**

Run: `pnpm --filter user-client test`
Expected: the known **8** Node-localStorage baseline failures only (see [[project_vitest_baseline_is_node_localstorage]]); every new test green; no regressions. Investigate any 9th failure.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: 9/9.

- [ ] **Step 4: Biome**

Run: `pnpm biome check --write <changed files>` then `pnpm biome check <changed files>`
Expected: clean.

- [ ] **Step 5: Restart the dev stack and hand to manual verification**

Restart the dev stack before device testing — **Vite HMR ignores `packages/*`**, but more importantly a fresh boot ensures the Dexie/store changes load cleanly. Then run the spec §14 manual checklist (below). Do **not** squash until Chris's device pass + the Laura pre-squash pass are clean.

### Manual verification (spec §14 — Chris on device)

1. **Text fix, replace (the 99% case).** Typo in the last message → Edit → fix → Replace: message updates in place, reply regenerates, identity/order preserved. Edit → immediate Replace with no change also regenerates (no forced diff).
2. **Attachments travel.** Message with an image → Edit → image present in composer → add a second, remove the first → Replace → reply regenerates against the new set.
3. **Branch from the last message.** Edit the last message → Branch → new chat with the edited message + a fresh reply; original chat still shows the old message and reply.
4. **Older-message edit forces branch.** Edit an earlier user message → the composer banner foreshadows the branch → Replace is disabled with its reason in the caret → Branch → new chat forks up to (exclusive of) that message with the edit re-sent; original untouched.
5. **Cross-device.** Device 1: start editing the last message, don't send. Device 2: send a new message. Device 1: send → Replace disabled with honest reason → Branch works.
6. **Cancel.** Enter edit, change text + attachments, Cancel → composer back to normal, message + reply unchanged.
7. **Reload mid-edit.** Enter edit, change text, reload → target + text restored; attachments show originals.
8. **Stream gate.** While a reply streams, Edit is disabled with the tooltip.

---

## Self-review notes (author)

- **Spec coverage:** §5 (Task 6 controls, Task 8 banner/focus, Task 9 enter/cancel), §6 replace/branch derivation (Tasks 2/4/5/9), §7 `editingMessageId` device-local (Task 1), §8 attachments (Tasks 3/7/8/9), §11 split button + auto-title (Tasks 5/8). §10 edge cases covered by the derivation (Task 2) + gates (Task 10).
- **Reuse:** Replace → `useRegenerate`; Branch → `useSendMessage`. No stream/context logic forked.
- **Type consistency:** `ReasoningState` imported from `send-message.ts`, never redefined; `stagedRemovals: string[]` threaded identically through Tasks 3/4/5/7/9; `editingMessageId: string | null` consistent across ChatRow, Cockpit, chat-page.
- **Watch item:** prior-message attachments are not copied on branch (matches existing `useBranchChat`); documented, not a regression.
