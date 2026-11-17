# Prior-turn Attachment Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prior user turns still in the replayed history carry their attachments on the wire: text in full, images of the last 3 image-bearing turns in full, older images as a cached description or a placeholder.

**Architecture:** A pure module `attachments/prior-replay.ts` picks the image window and resolves each prior turn's attachments into `ResolvedPart[]`. `stream-manager.store.ts` resolves them once per send into a `Map<messageId, wire content>`. That map travels inside the existing `ReplayContext` to `replayHistory`, so `lib/tool-replay.ts` never touches IndexedDB. Token estimates add an upper-bound attachment cost per user row.

**Tech Stack:** TypeScript strict, React 18, Dexie, Vitest (`apps/user-client`).

**Spec:** `superpowers/specs/2026-11-17-prior-turn-attachment-replay-design.md`

## Global Constraints

- British English in every identifier, comment, string and commit message.
- `PRIOR_IMAGE_TURN_WINDOW = 3`; the current turn does not count towards it.
- `IMAGE_TOKEN_ESTIMATE = 1000`.
- Placeholder copy, exact: `[Image: <fileName> — shown earlier, no longer attached]`.
- A prior-turn resolution failure never blocks the send. It degrades that turn to its text-only form and is logged with `console.error('[stream-manager] …')`.
- Commits: free-form imperative subject, ending with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Subagents commit only; they never push, merge or switch branches.
- Gates: `pnpm test`, `pnpm typecheck`, `pnpm run build` from the repo root.

## Review Focus

- A prior user turn with **only deleted** attachments → it stays a plain string (byte-identical to today).
- A text-only chat → the wire messages are byte-identical to today (existing `replayHistory` test stays green).
- An image row with no `blob` in a prior turn → the placeholder, not a silent skip. In the **current** turn the existing skip behaviour stays.
- An out-of-window image with a `visionDescription` from a **different** model than the current substitute → the description is still used.
- The opener path (`replay` undefined) → unchanged text-only replay.

---

### Task 1: Pure prior-turn resolution

**Files:**
- Create: `apps/user-client/src/attachments/prior-replay.ts`
- Modify: `apps/user-client/src/attachments/wire-injection.ts` (new part kind)
- Modify: `apps/user-client/src/attachments/resolve-send.ts` (missing-blob option)
- Test: `apps/user-client/tests/unit/prior-replay.test.ts`, `apps/user-client/tests/unit/wire-injection.test.ts`

**Interfaces:**
- Produces:
  - `ResolvedPart` gains `{ kind: 'image-earlier'; fileName: string }`, rendered by `buildUserWireContent` as the exact placeholder copy.
  - `resolveAttachmentParts(attachments, disposition, substituteModel, deps, opts?: { missingBlob?: 'skip' | 'earlier' })`; default `'skip'` (current behaviour).
  - `export const PRIOR_IMAGE_TURN_WINDOW = 3;`
  - `export function imageWindowMessageIds(userMessageIds: readonly string[], attachmentsByMessage: ReadonlyMap<string, readonly AttachmentRow[]>): Set<string>`. Takes ids in chronological order and returns the last `PRIOR_IMAGE_TURN_WINDOW` ids with at least one non-deleted `kind === 'image'` row.
  - `export function resolveEarlierParts(attachments: readonly AttachmentRow[]): ResolvedPart[]`, for out-of-window turns, with no I/O. Deleted rows are skipped. Text becomes `{kind:'text'}` in full. An image with `visionDescription` becomes `{kind:'image-description', model: visionDescription.model, description: visionDescription.text}`, otherwise `{kind:'image-earlier'}`.

- [ ] **Step 1: Write failing tests** in `tests/unit/prior-replay.test.ts`:
  - `imageWindowMessageIds` with 5 image turns `m1..m5` returns `{m3,m4,m5}`; a text-only turn and a turn with only deleted images are not counted.
  - `resolveEarlierParts` returns, for `[text 'doc.md' 'hello', image with visionDescription {model:'x:y', text:'A cat.'}, image without description, deleted image]`, exactly `[{kind:'text',fileName:'doc.md',text:'hello'}, {kind:'image-description',fileName:…,model:'x:y',description:'A cat.'}, {kind:'image-earlier',fileName:…}]`.
  - `resolveAttachmentParts([img({blob: undefined})], 'direct', null, deps, { missingBlob: 'earlier' })` → `[{kind:'image-earlier', fileName:'cat.jpg'}]`; without opts it stays `[]`.
  - In `wire-injection.test.ts`: `buildUserWireContent('hi', [{kind:'image-earlier', fileName:'a.png'}])` → `[{type:'text',text:'hi'},{type:'text',text:'[Image: a.png — shown earlier, no longer attached]'}]`.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/prior-replay.test.ts tests/unit/wire-injection.test.ts tests/unit/resolve-attachment-parts.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `Resolve prior-turn attachments for replay`.

### Task 2: Replay prior attachments on the wire

**Files:**
- Modify: `apps/user-client/src/lib/tool-replay.ts` (`ReplayContext`, `replayHistory`)
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (`resolveUserContent` area, `runIntoDraft` near the `replay` construction at ~line 926)
- Modify: `apps/user-client/src/lib/stream-engine.ts:243-250` (doc comment only: drop "prior-turn attachments are still not replayed")
- Test: `apps/user-client/tests/lib/tool-replay.test.ts`, `apps/user-client/tests/unit/stream-manager-store.test.ts`

**Interfaces:**
- Consumes: Task 1's `imageWindowMessageIds`, `resolveEarlierParts`, `resolveAttachmentParts(..., { missingBlob: 'earlier' })`, `buildUserWireContent`.
- Produces:
  - `ReplayContext` gains `userContentById?: ReadonlyMap<string, string | WireContentPart[]>`. In `replayHistory`, a user row whose id is in the map is sent as `{ role: 'user', content: map.get(id) }`; every other row is unchanged.
  - In `stream-manager.store.ts`: `async function resolvePriorUserContent(args: StartArgs, priorMessages: MessageRow[], callbacks): Promise<Map<string, string | WireContentPart[]>>`, with the same callbacks type as `resolveUserContent`. Extract the shared disposition, substitute and `ResolveDeps` construction from `resolveUserContent` into one helper used by both, so describe and caching behave identically.

- [ ] **Step 1: Write failing tests:**
  - `tool-replay.test.ts`: `replayHistory` with `userContentById` mapping user row `u1` to `[{type:'text',text:'hi'},{type:'image_url',image_url:{url:'data:,'}}]` emits exactly that content for `u1`, and leaves other rows identical to the text-only output.
  - `stream-manager-store.test.ts`, following that file's existing fixture style: a send with 4 prior user turns each carrying an image (vision offering) puts `image_url` parts on the 3 most recent prior user messages and the `shown earlier` placeholder text on the oldest. A prior text attachment appears as `Attachment: <name>` content. A prior turn whose attachment resolution throws replays as plain text, and the send completes.
- [ ] **Step 2:** `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/tool-replay.test.ts tests/unit/stream-manager-store.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the code. `resolvePriorUserContent` loads the attachments of `compacted.priorMessages` filtered to `role === 'user'`. Use one indexed query (`db.attachments.where('messageId').anyOf(ids)`, grouped and sorted by `order`), add it to `lib/replay-pills.ts` as `loadReplayAttachments(messageIds): Promise<Map<string, AttachmentRow[]>>`, and reuse it in Task 3. Window turns go through `resolveAttachmentParts(..., { missingBlob: 'earlier' })`, older turns through `resolveEarlierParts`. Rows with no non-deleted attachments get no map entry. Wrap each turn in try/catch per the Global Constraints. Call it in `runIntoDraft` after `applyActiveCompaction`, with the same live describe-pill callbacks as the current turn, and pass the map as `replay.userContentById`.
- [ ] **Step 4:** Run the same command, then the full `pnpm --filter @chatsundere/user-client test`. Expected: PASS.
- [ ] **Step 5:** Commit `Replay prior-turn attachments in the model context`.

### Task 3: Count attachments in the estimates

**Files:**
- Modify: `apps/user-client/src/lib/tool-replay.ts` (`estimateReplayTokens`)
- Modify: `apps/user-client/src/attachments/prior-replay.ts` (`estimateAttachmentTokens`, `IMAGE_TOKEN_ESTIMATE`)
- Modify: `apps/user-client/src/state/stream-manager.store.ts:395-405` (overflow estimate)
- Modify: `apps/user-client/src/compaction/runner.ts:128-129`
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx` (new optional prop) and `apps/user-client/src/routes/app/chat/chat-page.tsx` (load and pass it)
- Test: `apps/user-client/tests/lib/tool-replay.test.ts`, `apps/user-client/tests/unit/prior-replay.test.ts`

**Interfaces:**
- Consumes: `loadReplayAttachments` (Task 2).
- Produces:
  - `export const IMAGE_TOKEN_ESTIMATE = 1000;`
  - `export function estimateAttachmentTokens(attachments: readonly AttachmentRow[]): number`. Deleted rows count 0, each image counts `IMAGE_TOKEN_ESTIMATE`, and each text row counts `estimateTokens` of its rendered `Attachment: <name>` fence.
  - `estimateReplayTokens(row, pillsById, attachmentsByMessage?: ReadonlyMap<string, readonly AttachmentRow[]>)` adds `estimateAttachmentTokens` for user rows.
  - `ChatStream` prop `attachmentsByMessage?: ReadonlyMap<string, readonly AttachmentRow[]>`, passed to `estimateReplayTokens`.

- [ ] **Step 1: Write failing tests:** `estimateAttachmentTokens([image, image, deleted image])` → `2000`. For a text row, the result equals `estimateTokens` of the fenced text. `estimateReplayTokens(userRow, new Map(), map)` equals its text estimate plus the attachments' cost; without the map it is unchanged.
- [ ] **Step 2:** Run `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/tool-replay.test.ts tests/unit/prior-replay.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions, then wire them in. In `start`, the overflow estimate uses `loadReplayAttachments` for `projected.priorMessages` and adds `estimateAttachmentTokens(await listPendingAttachments(args.chat.id))` for the current turn. `runCompaction` passes the map loaded for `all`. In `chat-page.tsx`, use a `useQuery` keyed `['attachments', 'replay', chatId, messages.length]` that calls `loadReplayAttachments`, and pass the result to `ChatStream`.
- [ ] **Step 4:** Run the full gates from the repo root: `pnpm test`, `pnpm typecheck`, `pnpm run build`. Expected: all pass.
- [ ] **Step 5:** Commit `Count attachments in context estimates`.
