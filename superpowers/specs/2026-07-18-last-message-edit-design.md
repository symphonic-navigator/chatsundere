# Mild message editing — design spec

**Date:** 2026-07-18
**Author:** Liz (with Chris)
**Status:** Draft — awaiting Chris's spec review + Laura spec-pass
**Roadmap:** Omnibus update, client-only. Not a version gate.

---

## 1. Motivation

Every other harness Chris relies on (LM Studio, OpenWebUI, SpicyWriter) gets
message editing subtly wrong, in ways that grate on a real, non-experimental
user:

- **In-place editing** — a cramped textarea grafted onto the message bubble,
  never with the full composing power the prompt input has.
- **A forced diff** — the editor refuses to re-run unless *something* changed, so
  "regenerate this exact prompt" becomes "append an emoji so the tool lets me".
- **Second-class functionality** — the edit path can never do what the composer
  can (attachments, the same affordances), so the user fights a lesser tool to
  reach the same goal. That is the opposite of *dere* toward the user.

We do it properly: editing a user message means **re-composing it in the real
prompt input**, with everything that entails, and every send is a first-class
regeneration.

The dominant real-world edit (Chris's own field experience: ~99%) is a
**same-session text fix** — a missing "not"/"or", or context the user forgot to
give the model. The design optimises for exactly that, and refuses to pay
complexity for the rare tail.

## 2. Goals

1. **Edit the last user message** by loading it — text **and attachments** —
   back into the composer, exactly as if freshly composed.
2. **No forced diff.** Every send of an edited message is treated as a change and
   regenerates; "regenerate as-is" is a first-class use, not a workaround.
3. **On send, choose the outcome:** *replace in place* or *branch to a new chat*.
4. **Bonus (in scope):** editing **older** user messages is allowed, but always
   **forces a branch** — never a silent destruction of the downstream chain.
5. Works correctly with **sync**, with **per-chat draft persistence**, and with
   the **cross-device continuation** edge case.

## 3. Non-goals

- **No in-chat variant tree.** "Branch" reuses the existing whole-chat fork into a
  new chat. No sibling/`‹ 2/3 ›` message-tree model — deliberately rejected as
  goldplating that produces user-facing state chaos (Chris's explicit call, from
  lived experience).
- **No in-place bubble editing.** The composer *is* the editor.
- **No attachment-change persistence across a reload.** The text draft and the
  edit target survive a reload; attachment add/remove made mid-edit is transient
  in-session state (see §8). Justified by the 99%-text-fix reality.
- **No new sync semantics, no Dexie version bump, no schema migration.**

## 4. Existing terrain (what we build on)

From a full code survey (`apps/user-client/`):

- **`MessageRow`** (`src/boot/client-data-db.ts:278`): `role: 'user' | 'persona'
  | 'system'`, `contentBlocks`, ordered by `createdAt` (uuidv7). **No
  parent/branch pointer** — a "branch" is a full chat copy, not a tree node.
  `updatedAt` is the LWW sync clock.
- **`useBranchChat`** (`src/data/chats.ts:328`): copies the chat + every message
  and pill **up to and including** a cut message into a brand-new `ChatRow` with
  fresh ids, rewriting `pillId` references; the source chat is untouched. It does
  **not** auto-generate — today's branch is "fork to explore".
- **`useRegenerate`** (`src/data/send-message.ts:680`) →
  `stream-manager.store.ts` `regenerate` (`:487`): re-rolls the **last persona**
  reply **in place** (reuses the persona row, `contentBlocks: []` +
  `streamingState: 'incomplete'`), never deletes downstream, never touches the
  user message.
- **Composer** `Cockpit.tsx`: controlled; draft text lives in `chat-page.tsx` as
  `ChatRow.draftInput` (**text only, device-local**, on the `chats` sync
  deny-list, `strip.ts:72`). Attachments are separate `AttachmentRow`s;
  "pending" (in the composer) = `messageId === null`, bound to the user message
  on send by `attachPendingToMessage` (`stream-manager.store.ts:469`).
- **Per-message actions** `MessageControls.tsx`: Branch (all messages),
  Regenerate (last persona only), Copy, Bookmark, Save. **No Edit/Delete today.**
- **Synced field edit** template: `setBookmarkLabel` (`src/data/bookmarks.ts:20`)
  — `mutateSynced({ collection: 'messages', … write: tx => tx.table('messages')
  .update(id, { …, updatedAt: Date.now() }) })`. Messages have **no** deny-list
  entry, so any message field syncs whole.

## 5. The edit flow

### 5.1 Entering edit

- A new **Edit** affordance appears in `MessageControls` on **real user
  messages** — `role === 'user' && !seedRole`. Not on persona/system messages,
  not on pre-seed rows.
- **Gated off while a stream is live** (same gate as Branch, `isStreamLive`).
- Tapping Edit:
  - Loads the message's text into the composer draft.
  - Presents the message's existing attachments as the composer's starting
    attachment set (see §8).
  - Records **`editingMessageId`** on the `ChatRow` (device-local, §7).
  - The composer enters an **editing state**: a calm banner ("You're editing your
    message" — final copy is Laura/Chris's) and a **Cancel** affordance.
  - The message being edited is **subtly marked** in the transcript.

### 5.2 The transcript stays put (Approach A)

The edited message **and its persona reply remain visible** in the transcript
while editing. Nothing is lifted out or hidden. Rationale:

1. Nothing disappears — ND-calm, Principle of Least Astonishment.
2. Branch needs the original intact anyway; lifting-then-restoring would be
   pure risk.
3. Cancel and reload are trivially safe — there is no half-dismantled state.

The still-visible old reply is correct: it *is* the current state until the user
sends.

### 5.3 Cancel

Cancel clears `editingMessageId` and the composer draft, discards any
transient attachment changes (§8), and returns the composer to its normal
new-message state. The original message and its reply are untouched throughout.

## 6. The send decision — replace vs branch

On sending an edited message, the two outcomes are offered, with availability
**derived live from the current transcript** (never from a stored flag):

- **Replace in place** — active **only if the edited message is *currently* the
  last user message** in the chat. Otherwise **disabled, with a visible reason**
  (house rule *disabled over hidden*, CLAUDE.md §11), e.g. *"There are newer
  messages after this — editing here starts a branch."*
- **Branch to a new chat** — always active.

Cancel is implicit (dismiss the surface / back).

**One mechanism, three problems solved:**

1. **Older-message edit** → not the last message → Replace disabled → Branch. No
   special case.
2. **Cross-device continuation** (device 2 added messages while device 1 held an
   unsent edit of what *was* the last message) → on device 1's send, the target
   is no longer last → Replace disabled with an honest reason. No silent chain
   loss, no stale-flag lie.
3. We **never** destroy a downstream chain without saying so.

### 6.1 Replace-in-place mechanics (last message only)

1. Persist the edited **text** onto the message row via `mutateSynced`
   (`collection: 'messages'`, bump `updatedAt` for LWW — template `bookmarks.ts`).
2. Apply the staged attachment changes to the real `AttachmentRow`s (§8):
   bind newly-added pending rows to the message, delete staged-removed rows.
3. **Regenerate the following persona reply** by reusing the existing
   `regenerate` path (`stream-manager.store.ts:487`): the persona row is reset
   (`contentBlocks: []`, `incomplete`) and re-streamed. Because the edited user
   text is on the same row (unchanged `createdAt`), the rebuilt wire context picks
   it up naturally.
4. The user message keeps its identity (`id`, `createdAt`); only its content and
   attachments changed. Ordering is preserved.

`start()` always inserts a persona row when a message is sent, so the last user
message always has a following persona row (complete, incomplete, or failed);
Replace resets whichever it is. No "no reply to regenerate" case exists.

### 6.2 Branch mechanics (either case)

A thin variant of `useBranchChat`:

1. Fork the chat **up to and including** the edited message into a new `ChatRow`
   (existing copy-forward logic; everything after the edited message is dropped —
   the old reply and any downstream chain).
2. On the copied edited message, **substitute** the edited `contentBlocks` (text)
   and the edited attachment set (§8) — the copy carries the new content, not the
   old.
3. Navigate to the new chat and **kick off generation** for the edited message
   (the new element vs today's branch, which does not auto-generate).
4. The **source chat is untouched** — its original message and reply survive.

## 7. Persistence — `editingMessageId`

- A new **`editingMessageId?: string`** field on `ChatRow`, alongside `draftInput`
  (which the edit flow reuses for the text).
- **Device-local:** added to `DENY_LISTS.chats` in `strip.ts` so it is **stripped
  before seal and never syncs** — it is transient compose state, exactly like
  `draftInput`. A new non-indexed field on an existing store ⇒ **no Dexie version
  bump**.
- **"Last-ness is never stored"** — it is derived at render and at send from the
  live message list. `editingMessageId` is the *only* new persisted state; the
  boolean "is this the last message" would drift after a cross-device
  continuation and is deliberately absent.
- Edits only exist on chats that already have a sent message, so the target is
  always a real `ChatRow` (never the lazy/localStorage draft path).

## 8. Attachments in edit mode

- On entering edit, the composer shows the message's **existing attachments**
  (`AttachmentRow`s with `messageId === editingMessageId`) as the starting set,
  and the user can **add and remove**.
- **The original rows are not mutated until send.** Add/remove during an edit is
  **transient in-session state** (staged-adds are ordinary pending
  `AttachmentRow`s with `messageId === null`; staged-removes are held in composer
  state). This keeps Branch's original intact and makes Cancel/reload safe.
- **Persisted across reload:** only `editingMessageId` + text draft. On a reload
  mid-edit, the target and text return; the attachment set falls back to the
  message's **originals** (a safe, non-destructive default). Attachment *changes*
  do not survive a reload — accepted (§3), honest (nothing silently lost; the
  originals are still attached to the still-visible message).
- **On commit:**
  - *Replace:* apply staged changes to the real rows (bind new pending →
    `editingMessageId`; delete staged-removed).
  - *Branch:* the fork copies the message's attachments; the staged view (skip
    removed, include new pending) is written onto the **new chat's** copied
    message; source rows untouched.
  - *Cancel:* discard staged-removes; delete the pending rows (and blobs) added
    during this edit.

## 9. Sync considerations

- **`editingMessageId`** never leaves the device (deny-list, §7).
- **Replace** edits the message row through `mutateSynced` with an `updatedAt`
  bump; LWW converges normally. No new collection, no new field on the wire beyond
  the already-synced message content.
- **Branch** creates new rows exactly as `useBranchChat` does today (Class-1
  creation inserts via `enqueueSync`), already an audited pattern.
- No change to `strip.ts` polarity, `mutateSynced`, or any server contract.

## 10. Edge cases

- **Live stream:** Edit affordance disabled (§5.1).
- **Pre-seed / opener rows:** excluded (`!seedRole`; openers are persona rows).
- **Lazy chat:** no sent message ⇒ nothing to edit ⇒ affordance absent. N/A.
- **Cross-device continuation:** handled by live derivation (§6) — Replace
  disabled with reason.
- **Reload mid-edit:** target + text restored; attachments fall back to originals
  (§8).
- **Editing the last message, then the other device also edited it:** both are
  `messages` LWW writes on the same row; last `updatedAt` wins — no corruption,
  standard convergence.

## 11. Two small open points (for spec review / Laura)

1. **Send surface shape.** Baseline: a compact decision surface on send (Replace
   / Branch, Replace disabled-with-reason when not last). Possible refinement: a
   context-aware **split send button** so the 99% case (Replace on the last
   message) is one tap, with Branch as the secondary. *Tendency: split-button for
   low friction — Laura's terrain.*
2. **Branch title.** Reuse the existing branch title dialog vs. auto-title the new
   chat (smoother, no second modal after the branch/replace choice). *Tendency:
   auto-title.*

## 12. Audit relevance

- **Larissa:** client-only (no `auth-service`/`sync-service`/`proxy-service`/
  `packages/crypto`). The one sync-adjacent touch is adding `editingMessageId` to
  the client **deny-list** — a *keep-local* change, not a new wire field.
  Warrants a light courtesy check that transient compose state stays device-local;
  not a mandated gate.
- **Laura:** a new user-reachable flow (edit → compose → decide) ⇒ **spec-pass is
  her main lever** and runs before the plan; pre-squash pass before the squash.

## 13. Files likely touched

- `src/components/chat/MessageControls.tsx` — new Edit affordance (user messages).
- `src/components/chat/Cockpit.tsx` — editing state (banner, cancel, attachment
  seed), send-decision surface.
- `src/routes/**/chat-page.tsx` — wire `editingMessageId`, enter/cancel edit,
  branch-vs-replace on send.
- `src/data/chats.ts` — `useBranchChat` variant (substitute content + attachments,
  auto-generate).
- `src/data/send-message.ts` / `src/data/stream-manager.store.ts` — replace path
  (edit row + rebind attachments + regenerate), attachment commit helpers.
- `src/boot/client-data-db.ts` — `editingMessageId?: string` on `ChatRow`.
- `src/sync/strip.ts` — `editingMessageId` on `DENY_LISTS.chats`.
- `src/lib/` — a small `lastUserMessage` / last-ness derivation helper (none
  exists today).

## 14. Manual verification (Chris, on device)

1. **Text fix, replace (the 99% case).** Send a message with a typo → Edit → fix
   the text → Replace. The user message updates in place, the reply regenerates,
   ordering and identity preserved. No forced diff: Edit → immediately Replace
   with no change also regenerates.
2. **Attachments come along.** Send a message with an image → Edit → the image is
   in the composer → add a second image, remove the first → Replace → the reply
   regenerates against the new attachment set.
3. **Branch from the last message.** Edit the last message → Branch → land in a
   new chat with the edited message + a fresh reply; the original chat still shows
   the old message and old reply.
4. **Older-message edit forces branch.** In a multi-turn chat, Edit an earlier
   user message → Replace is disabled with a visible reason → Branch → new chat
   forks up to (and including, with edits) that message, downstream dropped;
   original untouched.
5. **Cross-device.** Device 1: start editing the last message, don't send.
   Device 2: send a new message in the same chat. Device 1: send the edit →
   Replace is disabled with an honest reason → Branch works.
6. **Cancel.** Enter edit, change text and attachments, Cancel → composer returns
   to normal, message and reply unchanged.
7. **Reload mid-edit.** Enter edit, change text, reload → target + text restored;
   attachments show the originals.
8. **Stream gate.** While a reply is streaming, the Edit affordance is disabled.
