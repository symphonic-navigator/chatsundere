# Non-destructive Regenerate — Design

**Date:** 2026-05-31
**Author:** Liz (Claude Code), brief-led with Chris
**Status:** Approved, ready for implementation plan
**Area:** `apps/user-client` (frontend-only — no Larissa gate)

---

## 1. Background

A `useRegenerate` hook was wired earlier and then **reverted**. The reverted
version was destructive and non-atomic: it deleted the last user message as well
as the response, then re-sent. This nuked single-exchange chats and lost the
prompt entirely if the re-send failed — Chris hit this during a smoke test.

This design rebuilds Regenerate non-destructively: keep the user message, re-roll
only the response.

The per-message `↻ Regenerate` control already exists in
`apps/user-client/src/components/chat/MessageControls.tsx`; `ChatStream.tsx`
already passes `onRegenerate` only for the last persona message (`isLastPersona`),
currently a no-op stub. This is a behaviour/data-flow change, not a layout change.

## 2. Decisions (from brainstorming)

1. **Replace in-place.** One response per exchange; no variant carousel. The old
   answer is gone once the new one succeeds.
2. **Current persona, read live.** Regenerate uses whatever persona / model /
   deployment is currently selected. To re-roll with a different model, the user
   switches it in the Cockpit first, then presses `↻`. No per-message model
   override, no mini-picker.
3. **Last persona answer only.** The button stays where it already is — the most
   recent **complete** persona message. No regenerate on mid-conversation
   messages (that is branch-like and destructive; branching arrives later
   separately).
4. **Interrupted-footer on failure (as today).** The old answer is discarded at
   start and the new one streams in-place. On failure/abort the message shows the
   existing `StreamInterruptedFooter` (retry available). The **user prompt is
   always preserved** — that was the original bug. The old *answer* is not
   preserved. This deliberately avoids a separate-draft / restore-on-failure
   model and its extra data-model + render-hide + boot-recovery cost.

## 3. Core idea

Regenerate ≈ a normal send with two deviations:

- **The user message is reused** — no delete, no re-insert.
- **Streaming targets the existing last persona message** (cleared →
  `incomplete`) instead of inserting a fresh draft.

Everything else (abort, completion, interrupted footer, retry) is the existing
stream machinery.

## 4. Flow — `regenerate(chatId)`

1. Abort any live stream for the chat (defensive).
2. Load messages. Last **complete** persona message = `T`. If none → no-op.
3. Build wire context: `priorMessages` = everything **before** the last user
   message; `userText` = that user message's text. The old answer `T` does **not**
   enter the context.
4. Transaction: set `T.contentBlocks = []`, `T.streamingState = 'incomplete'`.
   The user row is **untouched**.
5. Create a stream handle with `draftMessageId = T.id` and run `runStreamEngine`
   — identical to the normal send path.
6. **Success:** fill `T` with final content, mark `complete`.
   **Failure/abort:** `T` stays `incomplete` → existing `StreamInterruptedFooter`
   + retry (i.e. "as today").

## 5. Stream-manager refactor (small, targeted)

`start()` today does: insert user message + insert draft + stream. Extract the
streaming core (handle lifecycle + engine run against a `draftMessageId`) into an
internal `runIntoDraft(...)`. Then:

- `start()` = insert user message + insert draft → `runIntoDraft`
- `regenerate()` = clear `T` (reuse as draft) → `runIntoDraft`

## 6. Shared persona / secret resolution

`useSendMessage` currently resolves persona → provider → offering and decrypts
secrets (via the master key). Extract this chain into `resolvePersonaContext(...)`
used by both hooks, so `useRegenerate` does not duplicate decryption logic.
Message-list logic stays per-hook. The old destructive `useRegenerate`
(`send-message.ts:160-253`) and its test are replaced.

## 7. Wiring

`ChatStream.tsx:172-177` (stub, `isLastPersona` only) calls the new hook via
`chat-page.tsx`. The button appears, as it already does, only on the last
**complete** persona answer.

## 8. Tests (TDD)

- User row unchanged (same id + content); last persona answer replaced by new
  stream output.
- Failure/abort: user row intact, persona message `incomplete` (footer state).
- Wire context contains prior messages + last user text, **not** the old answer.
- The chat-route regenerate test that STATUS notes is missing.

Backend tests via Bun's runner; frontend via Vitest (per CLAUDE.md §10).

## 9. Scope / non-goals / security

- **Out of scope:** variant carousel, model choice at the button, regenerate on
  mid-conversation messages.
- **Security:** frontend-only change; reused secret decryption is unchanged; no
  `auth` / `crypto` / `sync` / `proxy` touched → no Larissa audit required (§9).
