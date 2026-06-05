# Session Branching — Design Spec

**Date:** 2026-06-01
**Author:** Liz (with Chris)
**Status:** Approved, ready for implementation plan
**Scope:** `apps/user-client` only — purely client-side (IndexedDB). No `auth/sync/crypto/proxy` surface touched, so **no Larissa gate** required.

---

## 1. Goal

The per-message `✎ Branch` control (currently disabled in `MessageControls.tsx`) becomes live. Pressing it lets the user fork the conversation at that message into a brand-new, independent chat session: every message up to and including the branch point is duplicated with fresh IDs, and the user is dropped straight into the new branch.

A branch is a true copy, not a reference: editing or continuing the branch never touches the source chat, and vice versa.

## 2. Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Cut point | **Inclusive** — copy all messages up to *and including* the clicked message. |
| Active stream on source | **Lock the button** — `Branch` is disabled (visible, with tooltip) while a stream is live for that chat. |
| Name-input UX | **Bottom-sheet** (mirrors `TocSheet`), mobile-first at 380 px. |
| Empty name | **Confirm disabled** — the `Branch` button stays disabled until a non-empty (trimmed) name is entered. Name is mandatory. |
| Message roles | Branch is offered on **all** roles (user/persona/system). Inclusive cut from a user message yields a branch ending on that question (to "re-ask differently"). |

## 3. What is duplicated vs shared

- **Duplicated** (new IDs, new rows): the `ChatRow`, every copied `MessageRow`, every `PillRow` attached to those messages.
- **Shared** (referenced by ID, never copied): `PersonaRow`, `ProviderRow`, `MindspaceRow`, `SettingsRow`. The branch reuses the source chat's `personaId` and `resolvedMindspaceId`. Duplicating personas would litter the library with identical cards.

## 4. Data layer — `useBranchChat`

New mutation in `src/data/chats.ts`. It is the mirror image of `useDeleteChat`: the same `chats → messages → pills` transaction cascade, copying instead of deleting.

```ts
mutationFn: async (args: {
  sourceChatId: string;
  branchPointMessageId: string;
  title: string;
}): Promise<string>
```

Inside a single Dexie `rw` transaction over `chats, messages, pills`:

1. Load the source `ChatRow`; throw if absent.
2. Load source messages via `where('chatId').equals(sourceChatId).sortBy('createdAt')`.
3. Find the index of `branchPointMessageId`; throw if not found (race with delete). Slice `[0 .. idx]` **inclusive**.
4. `newChatId = uuidv7()`, `now = Date.now()`.
5. Build two ID maps up front, one `uuidv7()` per entity:
   - `oldMsgId → newMsgId` for each copied message.
   - `oldPillId → newPillId` for each pill belonging to a copied message.
6. Insert the new `ChatRow`:
   - `id: newChatId`
   - `personaId`, `resolvedMindspaceId` — **copied from source** (reference, not duplicate).
   - `title: args.title`
   - `createdAt: now`
   - `lastMessageAt:` `createdAt` of the **last copied message**.
   - `bookmarkedMessageCount:` count of `bookmarked === true` among copied messages.
   - `draftInput: ''` (do not carry the source's half-typed input).
7. For each copied message, insert a new `MessageRow`:
   - `id: newMsgId`, `chatId: newChatId`.
   - `createdAt` — **preserved** from the source (keeps `[chatId+createdAt]` ordering and timeline meaning).
   - `role`, `bookmarked`, `bookmarkLabel`, `streamingState` — copied (all `'complete'` thanks to the stream lock).
   - `contentBlocks` — `structuredClone`d, then **every `{ type: 'pill', pillId }` block rewritten** so `pillId` points at the new pill via the pill ID map. **This is the load-bearing correctness step** — without it, the branch's text references the source chat's pills, leaving orphaned/broken pills.
8. For each pill of the copied messages, insert a new `PillRow`:
   - `id: newPillId`, `messageId:` the new message ID (via the message ID map).
   - `kind`, `positionHint`, `status`, `createdAt` — copied.
   - `payload` — `structuredClone`d (no shared mutable reference with the source).
9. Return `newChatId`.

`onSuccess`: `qc.invalidateQueries({ queryKey: QK.chats })`.

## 5. UI components

### `BranchSheet.tsx` (new)
Mirrors `TocSheet.tsx`: a `toc-sheet-root`-style backdrop + `aside` bottom-sheet. Contents:
- Title: "Branch this chat".
- A single `<input>` (autofocus, `maxLength` 80) for the branch name.
- `Branch` button — `disabled` while `value.trim() === ''`.
- `Cancel` button.
- `Enter` confirms (when non-empty); `Escape` / backdrop tap dismisses.
- Calls `onConfirm(trimmedName)` / `onClose()`.

### Prop threading (follows the existing `onRegenerate` pattern)
- `MessageControls.tsx`: enable the branch button — remove `disabled`/`title`, add `onClick={p.onBranch}`. New props `onBranch?: () => void` and `branchDisabled?: boolean`. When `branchDisabled`, the button renders disabled with tooltip "Branching paused while replying" (*disabled over hidden*).
- `MessageBlock.tsx`: accept `onBranch` + `branchDisabled`, pass through to `MessageControls`.
- `ChatStream.tsx`: thread `onBranch(messageId)` through to each `MessageBlock`.
- `chat-page.tsx`: owns `branchPointId: string | null` state. Renders `BranchSheet` when set. Computes `branchDisabled` from "is a stream live for this chat" (stream-manager store / `isStreamingDraft`).

## 6. Confirmation flow (chat-page)

1. User taps `✎ Branch` on a message → `branchPointId` set → sheet opens.
2. User types a name → `Branch`.
3. `useBranchChat.mutateAsync({ sourceChatId, branchPointMessageId, title })` → `newChatId`.
4. Close sheet, `navigate('/app/chat/${newChatId}')` → user lands in the branch.

## 7. Error handling

- **Branch point missing** (raced against a delete): the transaction throws and aborts cleanly; the sheet surfaces an error state and does **not** navigate. The typed name is preserved so the user can retry (constructive error handling — the *dere* half).
- The whole copy is one transaction: a failure mid-copy leaves no partial branch.

## 8. Testing (Vitest + fake-indexeddb)

Data integrity is the priority even though this is security-uncritical:

- **`useBranchChat` unit test:**
  - All copied entities carry **new** IDs (chat, messages, pills) — none collide with source IDs.
  - **Pill references inside `contentBlocks` resolve to the new pills**, not the source pills.
  - Source chat, messages, and pills are **unchanged** after branching.
  - Inclusive cut: branch contains exactly messages `[0..branchPoint]`, last message is the branch point.
  - `bookmarkedMessageCount` and `lastMessageAt` on the new chat are correct.
  - `draftInput` is `''`; `personaId`/`resolvedMindspaceId` equal the source's.
- **`BranchSheet` component test:** `Branch` is disabled for empty/whitespace input, enabled once a real name is typed; `onConfirm` receives the trimmed name.

## 9. Manual verification (Chris, on device)

1. Open a chat with several messages including at least one tool-call/KB pill.
2. Expand a mid-conversation message, tap `✎ Branch`, enter a name, confirm.
3. Land in the new branch; confirm it ends at the branch point and the pills render correctly.
4. Continue the branch with a new message; confirm the source chat is untouched.
5. Confirm both chats appear separately in history with the right titles.
6. While a persona is mid-reply, confirm the `Branch` button is disabled with its tooltip.
7. Confirm `Cancel` and empty-name (disabled confirm) behave as specified.

## 10. Out of scope

- Visual branch-tree / lineage UI (no "this chat was branched from X" link). A flat independent copy only.
- Syncing branches across devices (backend is not live until Block 6).
- Branching multiple messages / ranges — single inclusive cut point only.
