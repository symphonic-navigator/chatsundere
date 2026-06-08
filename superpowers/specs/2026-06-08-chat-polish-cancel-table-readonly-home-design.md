# Chat polish: cancel inference, table overflow, read-only home

**Date:** 2026-06-08
**Author:** Liz (with Chris)
**Scope:** One client-only feature unit, three small polish changes to the chat
surface. No Dexie migration, no backend, no `apps/auth-service` / `sync-service`
/ `proxy-service` / `packages/crypto` touch — **not a Larissa-gated change**.

---

## Motivation

Three independent rough edges Chris hit during device testing:

- **(B)** A running inference cannot be cancelled by the user. There is a
  timeout, but some upstreams misbehave in edge cases and the user must be able
  to stop a stream on demand.
- **(C)** A horizontal scrollbar intermittently appears on the chat stream,
  caused by Markdown GFM tables wider than the chat column.
- **(D)** In read-only (reading) mode the brand logo is hidden, so there is no
  quick route back to the main menu (Entrance Hall).

These bundle naturally as "chat polish": all three are small, client-only, and
touch the same chat surface.

---

## B — Cancel a running inference

### Current state

The abort machinery already exists end-to-end:

- `runIntoDraft` creates an `AbortController` and threads `controller.signal`
  through the tool loop and stream engine down into the adapters
  (`stream-manager.store.ts`).
- Two abort variants exist: `abortDiscard(chatId)` (deletes the partial answer
  on a fresh send; preserves it as `incomplete` only on a regenerate) and
  `abortAllForPersonaPreserve(personaId)` (keeps the partial buffer, marks the
  message `incomplete`).
- While a stream is live the send button (`DualActionBtn`) is merely
  **disabled** (`isStreamLive` ⇒ `disabled`).
- An incomplete persona message already renders a `StreamInterruptedFooter`
  offering **Retry** (`chat-page.tsx:428`).

What is missing is purely a user-visible control.

### Design

**The send button becomes a stop button.** While `isStreamLive`, `DualActionBtn`
renders a **stop** affordance (square icon), enabled, instead of a disabled send
arrow. Tapping it stops the stream. This is the least-astonishing placement — the
same button the user just pressed halts the reply — and costs no extra screen
space (mobile-first space economy).

**On stop, the partial answer is preserved.** The user decides what to do next:
keep chatting with what they have, or retry. Concretely, stopping:

1. Aborts the controller.
2. Persists the partial `contentBuffer` to the draft message with
   `streamingState: 'incomplete'` (regardless of whether it was a fresh send or
   a regenerate — this is the key difference from `abortDiscard`).
3. Removes the stream handle, so `isStreamLive` flips to `false`: the input is
   immediately free again and the button returns to its send/mic state.

The existing `StreamInterruptedFooter` then surfaces under the incomplete
message with **Retry**; the user may instead simply type the next message. This
is the constructive-error pattern — a stop never leaves a dead end.

A new store action `abortPreserve(chatId: string)` factors out exactly the
single-chat preserve behaviour (the body of `abortAllForPersonaPreserve`, scoped
to one chat). The stop control calls it.

**Reading-mode note:** the stop control lives in the cockpit. In reading mode
the cockpit is hidden; a user who wants to stop taps once to restore interaction
mode, then stops. This is acceptable because streaming almost always happens
immediately after a send (i.e. in interaction mode). No separate reading-mode
stop control.

### Files

- `state/stream-manager.store.ts` — add `abortPreserve(chatId)`.
- `components/chat/DualActionBtn.tsx` — third visual state (stop icon + enabled +
  `onStop` when `isStreamLive`).
- `components/chat/Cockpit.tsx` — pass an `onStop` through to `DualActionBtn`
  (calls `abortPreserve(p.chatId)`).
- `routes/app/chat/chat-page.tsx` — wire `onStop` into the cockpit.

---

## C — Horizontal scrollbar on Markdown tables

### Root cause

`.msg-text table` (`index.css`) has **no** overflow handling, unlike code blocks
(`.msg-text pre` — `overflow-x: auto`) and maths (`.msg-text .katex-display` —
`overflow-x: auto`), which both bound their width correctly. A table wider than
the chat column stretches `.msg-text` → `.msg` → `.chat-stream` past the column
max-width, producing a horizontal scrollbar on the whole stream.

### Design

Give tables the same proven pattern as code blocks: a **scroll wrapper** with
`overflow-x: auto`, so a wide table scrolls **inside its own bubble** while the
chat stream stays fixed.

- Add a `table` component override in `markdown-components.tsx` that wraps the
  `<table>` in a container element (e.g. `<div class="msg-table-wrap">`). The
  table stays a real table (semantics preserved), the wrapper owns the scroll.
- CSS: `.msg-table-wrap { overflow-x: auto; max-width: 100%; }`.
- Add a `min-width: 0` guard on the message-text/column box so a wide child can
  no longer stretch the flex column (the structural half of the fix).

Horizontal scroll is chosen over shrinking/wrapping: it preserves table data and
matches the existing code-block behaviour.

### Files

- `components/chat/markdown/markdown-components.tsx` — `table` override (wrapper).
- `index.css` — `.msg-table-wrap` rule + `min-width: 0` guard on the message
  column.

---

## D — Read-only-mode logo as a route home

### Current state

In reading mode the logo is deliberately hidden (`root.tsx`, `!isReadingChat &&`)
so the header collapses to a thin strip. The normal logo navigates to `to="/"`,
which redirects an authenticated user to the Entrance Hall (`/app`) — the main
menu.

### Design

Render the logo in reading mode too, as a **small** variant. In the thin reading
header (`py-1`) it appears top-left, smaller than the interaction-mode logo, with
the `✦` twinkle dropped for calm. It keeps `to="/"` — one tap straight to the
main menu, consistent with the full logo (no new navigation path).

- `root.tsx`: change the gating so the logo always renders inside a chat, with a
  `brand-logo-small` modifier applied when `isReadingChat`.
- `index.css`: a minimal `.brand-logo-small` rule (smaller font, twinkle hidden).

Styling is deliberately minimal — exact size/position is a later styling pass by
Chris (mechanics first, styling later). This change delivers the mechanic: a
visible, tappable home affordance in reading mode.

### Files

- `routes/root.tsx` — logo gating + small modifier.
- `index.css` — `.brand-logo-small`.

---

## Testing

- **Unit:** `DualActionBtn` stop state (renders stop icon + calls `onStop` when
  `isStreamLive`, send/mic otherwise); `abortPreserve` preserves the partial
  buffer as `incomplete` and removes the handle for both fresh-send and
  regenerate handles.
- **No new Dexie / no backend / no crypto** ⇒ no integration or security tests.

## Manual verification (device, Chris)

1. **Cancel:** send a message; while the reply streams, the send button shows a
   stop icon → tap it → the stream halts, the partial answer stays with a Retry
   footer, and the input is immediately usable. Then (a) type and send a new
   message (continues fine) and (b) on a fresh attempt tap Retry (re-rolls).
2. **Cancel a regenerate:** regenerate a reply, stop mid-stream → the partial is
   preserved with Retry, the original is not lost.
3. **Table overflow:** send/receive a Markdown table wider than 380 px → it
   scrolls horizontally within its bubble; the chat stream itself does **not**
   show a horizontal scrollbar. Code blocks and maths still scroll as before.
4. **Read-only home:** open a chat, drop to reading mode (cockpit hidden) → a
   small Chatsundere logo appears top-left → tap it → lands in the Entrance Hall.
   In interaction mode the full logo is unchanged.
