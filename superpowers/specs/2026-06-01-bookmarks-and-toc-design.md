# Bookmarks & Table of Contents — Design Spec

**Date:** 2026-06-01
**Author:** Liz (with Chris)
**Status:** Approved (brainstorm), pending implementation plan
**Block:** 1 (chat core) — client-only, no backend, no crypto path
**Larissa:** not required (no `auth-service`/`sync-service`/`proxy-service`/`crypto` touch)

---

## 1. Motivation

ChatGPT recently shipped an in-chat table-of-contents rail: a clickable list of
the user's own messages that lets you jump to any point in a long conversation.
It is genuinely useful and neither Claude nor Grok has it either. None of the
three has a **named-bookmark** feature, which is the obvious next step.

Chatsundere does both, and unifies them with a single gesture. The design
north-stars are §11 "Don't make me think" and "Principle of Least
Astonishment", plus the neurodivergent-audience rule (calm, non-intrusive,
one intent per surface).

## 2. The core model — one concept, two triggers

A message carries two optional properties:

- a **label** (a name; default is derived from the message text),
- a **star** (= a global bookmark = pinned to the top of this chat's ToC).

These are surfaced through **two** UI entry points but are **one** data
operation — making them differ would be a "make me think" violation:

1. **From a message** (`MessageControls`): the user stars a message — their own
   *or* the persona's — and can name it. Already half-built: `bookmarked:
   boolean` + a `◈ Bookmark` toggle exist today.
2. **From the ToC**: an auto-listed user-message entry can be renamed and
   starred.

Starring from either place is the same write.

### Auto-populated ToC (ChatGPT-style — "Variant A")

The ToC's timeline is **derived, not stored**: it lists **every user message**
of the chat in order. Rename and star are *attributes* layered onto these
auto-entries. Persona messages are **not** in the auto-timeline (user-only,
like ChatGPT); a persona message can still be starred and then appears only in
the pinned section and in the global view.

## 3. Data model — no Dexie migration

Dexie is at v8. Both fields below avoid a version bump:

- `MessageRow.bookmarked: boolean` — **exists**. This *is* the star = the
  global bookmark.
- `MessageRow.bookmarkLabel: string | null` — **new, non-indexed**. Custom
  name; `null`/`undefined` ⇒ derive the default snippet from the message text.
  Dexie stores non-indexed properties schemalessly, so adding it needs **no
  migration** (same pattern as the earlier `userFont` removal).
- `ChatRow.bookmarkedMessageCount: number` — **exists**, kept in sync by
  `useToggleBookmark` already.

Derived data:

- **Auto-timeline** = query the chat's user messages via the existing
  `[chatId+createdAt]` index; label = `bookmarkLabel ?? snippet(text)`.
- **Global bookmarks** = scan messages where `bookmarked === true`. Acceptable
  at local scale; a dedicated index is a noted later optimisation, deferred
  to avoid the unreliable IndexedDB boolean-index idiom.

### Snippet default

First ~40 characters of the first text line, truncated on a word boundary.

## 4. Surfaces

### 4.1 Floating control (Reading Mode, top-right)

A new component. Reading Mode is otherwise deliberately chrome-free; this is the
one ghostly, non-intrusive affordance, consistent with the calm/ND rule.

- **Collapsed:** a single, ethereal, floating arrow ("drop-me-down"), top-right.
- **Tap → strip slides down**, revealing two icons (more later):
  - **Pin** — fixes the expanded strip open.
  - **Bookmark** — opens this chat's ToC sheet (§4.2).
- **Pinned** ⇒ the strip stays open regardless of what happens.
- **Unpinned** ⇒ the strip auto-collapses on the **first interaction outside
  the strip**: tapping/clicking elsewhere, typing, scrolling, opening the
  cockpit, navigating. (Dismiss-on-outside-interaction, popover-style.)
- Pin state is **ephemeral**, held in `current-chat.store` (cross-session
  persistence deferred).
- Aesthetic: ghostly/floating, touch-control vibe but softer. Styling is
  Chris's separate pass — this spec stays mechanics-only.

### 4.2 Per-chat ToC (overlay sheet)

Opened from the Bookmark icon. Two sections:

- **Pinned (top):** all starred messages of this chat (user *and* persona), in
  chat order.
- **Timeline:** all user messages in order — the complete auto-index. A starred
  user message appears in **both**; its timeline row carries a star marker so
  the timeline stays a lossless index (you never lose your place).

Per entry:

- **Tap → jump** (§4.4).
- **Inline rename** → sets `bookmarkLabel`.
- **Star toggle** → sets `bookmarked`. If already labelled, starring does **not**
  re-prompt for a name. Un-starring removes it from the pinned section and the
  global view.

### 4.3 Global bookmark view (History tab)

A segmented toggle inside `/app/history`: **"Chats | Bookmarks"**. History is
already the "find past things" home, so this adds no new route and keeps the
navigation surface small (ND-friendly).

- **Grouped by chat**: chat title as a header, its starred bookmarks beneath
  (label · snippet · persona · time).
- **Tap → navigate** into the chat and scroll to the message (§4.4).
- Empty state: constructive ("Star a message to find it here").

### 4.4 Jump mechanics

The sheet/tab closes, the app lands in **Reading Mode** at the target message
(`data-msg-id` ⇒ `scrollIntoView`), with a brief ghostly highlight pulse. When
the jump originates while the cockpit is open, the cockpit closes.

## 5. Incognito (forward-compatible only)

Incognito is a future concept (Block 3 — the button exists disabled in
`persona-editor.tsx`). Not built here, but designed around: in incognito the
star write is a **no-op against the global store**; ToC navigation works
unchanged. No special-casing beyond a guarded write later.

## 6. Out of scope / deferred

- Incognito itself (Block 3).
- Cross-session persistence of the pin state.
- Full-text search *within* the global bookmark list (fast-follow if wanted).
- ToC reachability *from* Interaction Mode (MVP is Reading-Mode-only).
- A dedicated bookmark index in Dexie (later optimisation).

## 7. Micro-decisions (defaults, vetoable)

- `◈ Bookmark` button stays, becomes semantically the star; star-glyph styling
  is Chris's separate pass.
- Rename lives in the ToC, **not** in `MessageControls` (which stays a simple
  toggle).
- Snippet default as in §3.

## 8. Testing

Vitest (no Larissa, no backend):

- ToC derivation: timeline (all user messages, ordered) + pinned (all starred,
  user + persona).
- Label default vs override; rename; un-star.
- Jump scroll contract (`data-msg-id` resolution; jsdom-guarded
  `scrollIntoView`).
- Floating-control pin behaviour: pinned stays; unpinned collapses on outside
  interaction.
- History "Bookmarks" tab: grouping by chat, empty state, navigate-to-message.

## 9. Manual verification (Chris, on device)

1. Open a long chat → tap the floating arrow → strip slides out; tap Bookmark →
   ToC sheet lists every user message; tap an entry → lands in Reading Mode at
   that message with the highlight pulse.
2. Rename a timeline entry → label changes; reopen → label persists.
3. Star a renamed entry → it appears pinned at the top, no name re-prompt.
4. Star a persona message from its message-control → it appears in the pinned
   section (not in the timeline) and in the global view.
5. Pin the strip → interact elsewhere → strip stays. Unpin → tap into the chat →
   strip collapses.
6. History → "Bookmarks" → bookmarks grouped by chat → tap one → opens the chat
   at the message.
