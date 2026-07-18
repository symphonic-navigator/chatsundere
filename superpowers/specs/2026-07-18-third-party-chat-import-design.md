# Third-Party Chat Import (ChatGPT & Grok) — Design

**Date:** 2026-07-18
**Status:** Draft — awaiting Laura spec-pass + Chris review
**Scope:** `apps/user-client` only (client-only; no server, no crypto — not a Larissa path)

## 1. Background & intent

Users have asked for the return of third-party chat import. The two migration
scenarios are well understood:

- **ChatGPT users** are frustrated by OpenAI's heavy-handed censorship and want
  to bring their conversation history with them.
- **Grok users** are discovering that the xAI API is cheaper than the
  subscription, and Grok's UI is weaker than ours.

Chatsune had a ChatGPT importer, but as a server-side pipeline (upload, async
parse jobs, progress events). This rebuild is deliberately simpler: fully
client-side, one overlay, no server involvement of any kind.

The Grok data-format analysis comes from a community fork commit
(`symphonic-navigator/chatsundere@0918b949`) whose author has the import working
against his own export. We adopt the **format knowledge** from that commit — the
JSON shape, sender values, timestamp variants, and the `importedFrom` dedup
idea — but none of its code. In particular we do **not** adopt its
branch-preservation machinery (`parentMessageId` on messages, branch navigation
in the chat stream, a regenerate refactor): we always flatten to the newest
branch, matching both our one-chat model and chatsune's ChatGPT behaviour.

## 2. Scope

**In scope**

- Import from a **ChatGPT export** — either the downloaded `.zip` or a raw
  `conversations.json`.
- Import from a **Grok export** — a single `.json` file.
- Target: the persona whose hub hosts the control. Imported conversations land
  in that persona's history as ordinary chats.
- Content: message **text** and **reasoning traces**. Anything else (images,
  files, code blocks with non-text content types, tool output) is dropped with
  a visible dropped-content hint, reusing the chatsune-import hint mechanism.

**Out of scope (deferred, with the door left open)**

- Branch preservation (importing regenerated alternatives). Requires a message
  tree in our data model; consciously rejected for now.
- Importing images/attachments from the ChatGPT zip (Grok only ships
  auth-gated URLs anyway).
- Memory import or automatic memory extraction over imported history (see §8).
- Other providers (Claude, Gemini, …). The parser-per-format architecture makes
  each future provider one new parser plus a detection branch, nothing more.

## 3. Surface & flow

The persona hub's existing **Import** section (which hosts the chatsune/
chatsundere pack control) gains a second control: **"Import chats from ChatGPT
or Grok…"**. It opens an overlay with three states:

1. **Pick** — a file picker, `accept=".zip,.json"`. A short line names exactly
   what to pick: the `.zip` downloaded from ChatGPT, or the `.json` from Grok.
2. **Select** — after parsing (spinner while parsing), a scrollable list of the
   conversations found in the file. Each row: checkbox, title (fallback
   "Untitled chat"), date, message count. A "Select all" toggle operates on
   enabled rows. A title-search input sits above the list when it exceeds 10
   rows (ChatGPT exports commonly contain hundreds of conversations).
   Rows that cannot be imported are **disabled with a visible reason**, never
   hidden:
   - "Already imported" — the persona already has a chat with this
     conversation's `importedFrom` key (idempotent re-import).
   - "Nothing importable" — the conversation is empty after filtering (e.g.
     image-only).
3. **Import** — a footer button labelled with the live count ("Import 12
   chats"), disabled at zero. During the write a progress count is shown; on
   completion the overlay shows "Imported N chats" with a Done action. Cancel
   is available at any point before the write starts.

No persona picker anywhere — the hub *is* the persona.

## 4. Format detection

Detection is content-based, not extension-based:

- Bytes start with `PK` (zip magic) → ChatGPT export zip; extract only the
  `conversations.json` entry.
- JSON parses to a **top-level array** whose items carry `mapping` /
  `current_node` → raw ChatGPT `conversations.json`.
- JSON parses to an **object** with a `conversations` array whose items carry
  `responses` → Grok export.
- Anything else → the constructive error in §9.

## 5. ChatGPT parser (`lib/third-party-import/chatgpt.ts`)

A TypeScript port of chatsune's proven parser logic
(`backend/modules/chatgpt_import/_parser.py`):

- **Linearise:** walk the parent chain from `current_node` back to the root
  (cycle-guarded via a visited set; nodes without a `message` are skipped),
  then reverse to root→leaf order. Dead branches are never visited — this *is*
  the flatten-to-latest-branch behaviour, for free.
- **Keepable filter:** keep a message iff `author.role ∈ {user, assistant}`,
  `status ∈ {null/undefined, "finished_successfully"}`, and
  `content.content_type ∈ {"text", "user_editable_context"}`. Visually hidden
  messages are dropped except `user_editable_context`. Empty/whitespace-only
  parts are dropped.
- **Custom instructions:** a `user_editable_context` message becomes a
  synthetic first user message composed of `[User Profile]` /
  `[Custom Instructions]` blocks, stamped 1 s before the conversation start.
- **Dropped content:** non-text parts and skipped content types contribute a
  dropped-content hint on the nearest kept message (`DroppedKind` and the hint
  rendering are reused/adapted from `lib/chatsune-import/dropped-hint.ts`). A
  conversation with nothing kept at all surfaces as "Nothing importable" (§3).
- **Roles:** `user` → `user`, `assistant` → `persona`.
- **Timestamps:** unix seconds (float) → epoch milliseconds.
- **Ids:** `conversation_id ?? id`, namespaced as `chatgpt/<id>`.

## 6. Grok parser (`lib/third-party-import/grok.ts`)

Built from the fork commit's format analysis:

- **Root shape:** `{ conversations, projects, tasks, media_posts }`; only
  `conversations` is read. Each item is
  `{ conversation: { id, title, create_time, modify_time }, responses: [{ response }] }`.
- **Responses:** `{ _id, message, sender, create_time, parent_response_id,
  thinking_trace?, agent_thinking_traces?, partial?, file_attachments?,
  generated_image_urls? }`.
- **Branch flattening:** skip `partial: true` responses; build the tree via
  `parent_response_id`; choose the leaf whose subtree carries the newest
  `create_time`; walk its parent chain to the root and reverse. Regenerated
  alternatives are discarded.
- **Roles:** `sender` lower-cased equals `"human"` → `user`; every other value
  (`"ASSISTANT"`, `"assistant"`, `"grok-4"`, `"grok-4-auto"`, …) → `persona`.
- **Blocks:** an optional reasoning block from `thinking_trace` (or the joined
  `agent_thinking_traces[].thinking_trace`), then a text block from `message`.
  Responses with neither are skipped.
- **Dropped content:** non-empty `file_attachments` / `generated_image_urls`
  contribute a dropped-content hint on that message.
- **Timestamps:** accept epoch milliseconds, ISO-8601 strings, and MongoDB
  `$date` notation (`{ $date: string | { $numberLong } }`).
- **Ids:** `conversation.id`, namespaced as `grok/<id>`.

## 7. Intermediate format (`lib/third-party-import/types.ts`)

Both parsers are pure functions emitting the same shape; the writer and the UI
know nothing about ChatGPT or Grok specifics:

```ts
interface ThirdPartyConversation {
  sourceId: string;               // "chatgpt/<id>" | "grok/<id>" — dedup key
  title: string | null;
  createdAt: number;              // epoch ms
  lastMessageAt: number;          // epoch ms
  messages: ThirdPartyMessage[];
}

interface ThirdPartyMessage {
  role: 'user' | 'persona';
  createdAt: number;              // epoch ms
  blocks: Array<{ type: 'text'; text: string } | { type: 'reasoning'; text: string }>;
  dropped?: DroppedKind[];        // feeds the dropped-content hint
}
```

Message order within a conversation is the linear (flattened) order. Because
the chat stream orders by the `[chatId+createdAt]` index, the **writer enforces
strictly increasing `createdAt`** per chat: equal or missing source timestamps
degrade to synthetic monotonic values that preserve the linear order.

## 8. Writer (`data/third-party-import.ts`)

Mirrors `importChatsuneSessions` (`data/chatsune-import.ts`) exactly:

- One Dexie `rw` transaction over `chats`, `messages`, `syncOutbox`.
- Fresh `uuidv7()` ids for every row; `ChatRow.importedFrom = sourceId` is the
  idempotency key — a conversation whose key already exists for this persona is
  skipped (and shown disabled in the UI beforehand).
- Messages get `streamingState: 'complete'` and text/reasoning content blocks.
- Every insert is paired with `enqueueSync(tx, …, 'upsert')`, and the import
  finishes with `scheduleClass1Sync()` — imported chats sync to other devices
  like any locally created chat.
- Chat-list queries are invalidated after the transaction so the history
  reflects the import immediately.
- **No Dexie version bump** — `importedFrom` and all other fields exist; no
  stores or indexes change. (No collision with parallel work owning Dexie
  versions.)
- **Memory:** the extraction cursor (`lastExtractedMessageId`) is left unset,
  exactly like the chatsune import. Imported history feeds memory only when the
  user actively continues that chat, bounded by the extraction window
  (`memory/pipeline.ts`) — no surprise background token burn at import time.

## 9. Error handling — constructive, input preserved

- **Unrecognised file:** "That doesn't look like a ChatGPT or Grok export.
  Pick the .zip you downloaded from ChatGPT, or the .json file from Grok." The
  picker remains open; no dead end.
- **Empty export** (no conversations): an honest message naming the fact.
- **Per-conversation parse failure:** the failing conversation is listed
  disabled with a reason; the remaining conversations stay importable. One
  corrupt entry must never block four hundred good ones.
- **Write failure mid-import:** the Dexie transaction is atomic — either the
  import lands or it doesn't; the error states that nothing was partially
  written and offers retry.
- **Large files:** migration is realistically a desktop task; a ChatGPT export
  can exceed 100 MB and `JSON.parse` of such a file on a phone may fail. We do
  not guard memory explicitly; the failure path stays constructive. This
  assumption is deliberate and recorded here.

## 10. Dependencies

- **fflate** (new, `apps/user-client` only): minimal zip reading, used solely
  to extract `conversations.json` from a ChatGPT export zip. Small (~8 kB
  gzipped), zero sub-dependencies. Our existing gzip+tar utilities cannot read
  zip.

## 11. Testing

Vitest, following the full-fidelity fixture lesson (a text-only stub once hid a
pill-loss CRITICAL):

- **ChatGPT parser:** fixtures with a branched `mapping` (regenerated replies —
  assert dead branches are not visited), custom instructions, hidden/system/
  tool messages, non-text content types (dropped hints), empty parts, float
  timestamps.
- **Grok parser:** fixtures with `partial` responses, a branched
  `parent_response_id` tree (assert newest-subtree leaf wins), thinking traces
  (both single and `agent_thinking_traces`), all three timestamp notations,
  mixed-case senders, attachment/image references (dropped hints).
- **Format detection:** zip vs raw ChatGPT JSON vs Grok JSON vs junk.
- **Writer:** idempotent re-import (second run imports zero), strictly
  increasing `createdAt` under equal source timestamps, sync outbox entries
  enqueued, no cursor set.
- **UI:** disabled-row reasons, select-all on enabled rows only, import-count
  button gating.

## 12. Manual verification (Chris, on device)

1. Real ChatGPT export zip → hub → "Import chats from ChatGPT or Grok…" →
   conversation list appears with titles/dates → select a subset → import →
   chats appear in the persona's history with correct titles and dates; open
   one: the conversation reads correctly top-to-bottom, custom-instructions
   context (if present) appears as the first user message.
2. Re-pick the same zip → previously imported rows show "Already imported",
   disabled; "Select all" selects only the rest.
3. Real Grok `.json` → import → thinking traces render as reasoning blocks;
   only the latest branch of a regenerated conversation is present.
4. A random unrelated `.json` → the constructive error appears, the picker is
   still usable.
5. Continue an imported chat → the reply streams normally; title stays; memory
   extraction runs only now (bounded), not at import time.
6. On a linked second device: the imported chats arrive via sync.
7. (If available) the community member's Grok export imports cleanly — the
   fixtures are built from format analysis; a second real-world file is the
   strongest check.
