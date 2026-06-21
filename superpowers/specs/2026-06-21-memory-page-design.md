# Memory Page — Design Spec

**Date:** 2026-06-21
**Author:** Liz (with Chris)
**Status:** Approved design, pending Laura spec-pass + implementation plan
**Track:** Client-only (lives entirely in `apps/user-client`)

---

## 1. Context & Goal

The memory engine, its UI, and chatsune import landed on `master` (squash
`2eebfd24`). The engine works, but its UI shipped **mechanics-first, style-free**
by deliberate plan decision (styling deferred to the later design-language pass).
Two consequences surfaced on first real use:

1. **The cockpit memory overlay is unusable.** `MemorySheet` is a bare
   `<dialog open>` with no CSS at all. It falls back to the user-agent default
   `<dialog>` box (absolutely positioned, content-sized) and is clipped by the
   cockpit container — it opens just below the ◌ button and is immediately cut off.
2. **Journal entries have no home outside the chat.** The uncommitted journal
   candidates live *only* in the cockpit overlay. The persona-editor
   `MemorySection` shows the body, versions, and committed entries — but never the
   uncommitted candidates. There is nowhere to review them outside an active chat.

**Goal:** give memory a single, functional home — a dedicated page where the user
can see, edit, delete, and commit all entries, and see the memory body. This is a
**functional foundation only**. A full UI/UX + design-language pass for memory is
planned in ~1–2 weeks, informed by real usage; this spec deliberately does **not**
attempt polish.

### Guiding principle (Chris)

> Simplify and unify. Minimal UI variability. One review surface, reached by
> navigation — not a second floating window to maintain. A single extra screen
> reads as "one more tap" but is *less* confusing and goes into muscle memory fast.

This is the north star for every decision below: **one surface, not two.**

---

## 2. Non-Goals

- **No design-language pass.** Minimal functional CSS only — readable and usable at
  380 px, nothing more. The opulent styling (Instrument Serif, glows, etc.) is the
  later pass.
- **No changes to the memory engine, pipeline, extraction, consolidation, or data
  model.** This is purely a presentation/IA change over the existing repo + hooks.
- **No new repo capabilities.** Everything needed already exists in
  `src/memory/repo.ts` and `src/data/memory.ts` (see §6).
- **No "uncommit"** (committed → back to uncommitted). Not requested.
- **No backend, no sync.** Client-only.

---

## 3. Architecture

### 3.1 New route + page

A new persona-scoped route, following the existing nesting style
(`/app/knowledge/:libraryId`):

```
/app/persona/:id/memory   →   <PersonaMemory />
```

New component `src/routes/app/persona-memory.tsx`. It reads `:id` (personaId) from
the route and an **optional** `?chat=<chatId>` query param (present only when
reached from the cockpit — see §3.2). Registered in `src/App.tsx` inside the
`ProtectedRoute` group, adjacent to the existing `/app/persona/:id` route.

Because this is a real route (not a dialog inside the cockpit), the clipping problem
disappears structurally — there is no overflow container to be clipped by.

### 3.2 Entry points (both)

1. **Cockpit ◌ button** — pure navigation, no overlay. The button's `onClick`
   becomes `navigate('/app/persona/<personaId>/memory?chat=<chatId>')`. The
   uncommitted-count badge on the button stays (it already exists). The
   `aria-expanded` attribute is dropped (no longer a disclosure).
2. **Persona editor `MemorySection`** — keeps the **settings** (the
   "Remember across conversations" toggle + the instructions textarea; these are
   persona properties saved with the persona). The inline body/versions/committed
   display is **removed** from the section and replaced by a single
   **"Manage memory →"** link to `/app/persona/<id>/memory` (rendered only for a
   saved persona; the unsaved-persona hint is unchanged).

### 3.3 What is removed

- `src/components/chat/MemorySheet.tsx` — deleted (the broken overlay).
- Its mount, the `memoryOpen` state, and `openMemory`/`markViewed`-on-open wiring in
  `src/components/chat/Cockpit.tsx`.
- `SavedPersonaMemory` (body + versions + committed) is **moved out** of
  `src/components/persona-editor/MemorySection.tsx` into the new page. After the
  trim, `MemorySection` retains **only group 1** (the settings: toggle +
  instructions) **plus the "Manage memory →" link**. Both group 2 (body + versions)
  and group 3 (the committed list, `MemorySection.tsx:128-138`) leave — group 3 in
  particular must not be orphaned, or committed entries again live in two places
  (the exact §1.2 duplication this spec closes).
- The `tests/components/chat/memory-sheet.test.tsx` test is removed; its coverage is
  re-expressed against the new page.

### 3.4 "Mark viewed" handling

The cockpit currently marks the memory body version as viewed when the overlay
opens (clearing the "active" indicator). With navigation, the page becomes the
natural place to mark-viewed: `PersonaMemory` calls `useMarkMemoryViewed` on mount
(once the current body version is known). The cockpit ◌ keeps showing the
uncommitted-count badge and the staleness "active" state until the user visits the
page. No behavioural regression.

Conscious widening: mark-viewed now fires on the page from **both** entry points, so
reaching the page via the editor "Manage memory →" link also clears the cockpit's
"active" dot. This is deliberate and defensible — the user did look at the memory —
and is a slightly broader clearing surface than today's chat-only clearing.

---

## 4. The Page

`PersonaMemory` is persona-scoped. Layout top-to-bottom, single column,
mobile-first:

### 4.1 Header
Persona name + "Memory" label + an **explicit, labelled, context-derived** back
affordance (never `navigate(-1)` — that produces a dead-end / app-exit on the
PWA-resume and reload paths, and a non-deterministic destination that varies by
history depth rather than by where the user actually is). Mirror the established
codebase pattern (`knowledge-library.tsx:40`'s labelled "← My Knowledge"; the
editor's `?return=` thread):
- **Chat path** (`?chat=` present): "← Back to chat" → `navigate('/app/chat/<chatId>')`.
- **Editor path** (no `?chat=`): "← <persona name>" → `navigate('/app/persona/<id>')`.

The destination is derived from the known route context, so it is correct on first
load, reload, and resume — not from a fragile back-stack.

### 4.2 Actions (chat-path only)
Both pipeline-trigger actions require a chat, because
`resolveMemoryPipelineArgs(chatId, …)` derives the persona, provider, model, and
credentials **from the chat** (`chats.get(chatId) → personaId → …`). There is no
persona-rooted resolution path, and refactoring one is out of scope (§2). So the
whole actions block renders **only when `?chat=` is present** (the cockpit path);
from the editor path it is omitted entirely.

- **Learn from this chat** + the unextracted-count hint — `useMemoryActions(chatId).learnNow`.
- **Consolidate now** — `useMemoryActions(chatId).consolidateNow`; enabled when ≥1
  committed entry exists.
- Error/retry row for learn/consolidate failures (carried over verbatim from the
  old overlay, incl. the `no-credentials` message).

This is not a functional loss: these actions only ever existed in the cockpit
overlay, which always had a chat. Consolidation also still runs automatically on
its volume threshold after sends. Entry management and body editing (§4.3–4.5) do
**not** depend on a chat and are always available on the page.

On the editor path, where the block is omitted, render one calm orientation line in
its place so the absence reads as intent, not a bug (constructive-error house
style): e.g. "Open a chat with <persona> to learn new memories or consolidate."

### 4.3 Pending entries (uncommitted)
List of uncommitted journal entries, oldest-first. Per entry:
- **Commit** — `useCommitEntry`
- **Edit** — inline textarea + Save/Cancel (`useUpdateEntry`)
- **Delete** — immediate delete with a 5 s **Undo toast** (carried over verbatim
  from the old overlay's `rejectWithUndo`; `useRejectEntry` hard-deletes the row).

Empty state: a calm, path-aware one-liner. Chat path: "No pending memories. Keep
chatting and <persona> will start to remember you." Editor path (no chat in view):
a neutral variant that doesn't point at an action the page can't start, e.g.
"No pending memories yet."

### 4.4 Committed entries (awaiting consolidation)
List of committed journal entries. Per entry:
- **Edit** — inline textarea + Save/Cancel (`useUpdateEntry`)
- **Delete** — same immediate-with-undo pattern as §4.3.

(No Commit action — already committed. No uncommit.) Shown only when ≥1 committed
entry exists.

### 4.5 The memory itself (body)
Carried over from `SavedPersonaMemory`:
- The current body in an editable textarea + **Save memory** (`useSaveBodyManual`),
  disabled when empty or unchanged.
- Version list: `v<n> · <source>`, with **Restore** on non-current versions
  (`useRollbackBody`) and a "current" marker on the active one.
- Empty state when no versions exist yet ("Nothing remembered yet.").

### 4.6 Delete UX (uniform)
All deletes (pending and committed) use the **immediate-delete-with-5 s-undo-toast**
pattern. The toast carries an "Undo" action (the existing `toastStore` action
support). The deliberate no-unmount-cleanup note from the old overlay applies: a
pending delete must complete even if the user navigates away; the toast closure
keeps `clearTimeout` reachable.

---

## 5. Minimal functional CSS

New `.memory-*` rules in `src/index.css`, scoped to "readable + usable at 380 px",
explicitly **not** a design pass:
- Page: single-column, comfortable vertical rhythm, the page scrolls naturally
  (it is a route, not a fixed overlay).
- Entry rows: a simple bordered/spaced card so content and its action buttons are
  legible and tappable.
- Reuse existing Tailwind utility conventions where the surrounding code already
  does (e.g. the toggle in `MemorySection`).
- A short comment marks the block as placeholder styling pending the design-language
  pass (mirrors the plan's existing "placeholder" convention).

---

## 6. Data layer — already complete

No new repo or hook code is required. Used as-is:

| Need | Existing |
|---|---|
| List uncommitted | `useJournalEntries(personaId, 'uncommitted')` |
| List committed | `useCommittedEntries(personaId)` |
| Commit | `useCommitEntry` |
| Edit | `useUpdateEntry` |
| Delete (any state) | `useRejectEntry` → `rejectEntry` = `memoryJournal.delete(id)` |
| Body (current) | `useCurrentBody` |
| Body versions | `useBodyVersions` |
| Save body | `useSaveBodyManual` |
| Restore version | `useRollbackBody` |
| Mark viewed | `useMarkMemoryViewed` |
| Learn (chat) | `useMemoryActions(chatId).learnNow` + `useUnextractedCount(chatId)` |
| Consolidate | `useMemoryActions(chatId).consolidateNow` |

Confirmed during design: `useMemoryActions` and `resolveMemoryPipelineArgs` are
**chat-rooted** — they resolve the persona and credentials from the chat, not the
persona id. Therefore the Learn/Consolidate block is gated behind `?chat=` (§4.2);
no hook refactor is needed. The entry/body mutation hooks are persona-scoped Dexie
operations with no credential resolution and work without a chat.

---

## 7. Testing

Bun/Vitest, behaviour-first (no phrase-matching):
- Page renders pending + committed + body groups from seeded data.
- Commit moves an entry pending → committed (assert via repo/query state).
- Edit persists new content.
- Delete removes an entry; Undo within the window restores it.
- Restore writes the chosen version's content as a new newest version.
- `?chat=` present → the actions block (Learn + Consolidate) visible; absent → the
  whole block omitted, while entry management + body editing remain available.
- `MemorySection` renders the settings + "Manage memory →" link for a saved
  persona, and the hint for an unsaved one.
- Remove `memory-sheet.test.tsx`; re-express its meaningful assertions here.

The known Node-26 `localStorage` baseline (exactly 8 failures) is unrelated and
unchanged.

---

## 8. Gates

- **Laura (UX)** — this changes user-reachable flows (a new page, a moved review
  surface, a removed overlay). **Spec-pass complete (2026-06-21):** one HARD defect
  (the `navigate(-1)` back affordance) — folded into §4.1; five SOFT findings —
  folded into §3.3, §3.4, §4.2, §4.3. Both architectural questions (hiding
  Learn/Consolidate on the editor path; removing the in-chat overlay) cleared as
  justified. A **pre-squash pass** on the diff still follows implementation.
- **Larissa (security)** — not required: no `auth-service`, `sync-service`,
  `proxy-service`, or `crypto` changes.

---

## 9. Manual verification (Chris, on device)

1. In a chat, tap ◌ → lands on the memory page (no clipping); pending entries
   visible.
2. Commit / Edit / Delete (+ Undo) a pending entry; observe the change.
3. Edit / Delete a committed entry.
4. Edit the body, Save; Restore an older version.
5. "Learn from this chat" present from the cockpit path; absent from the editor
   path.
6. Persona editor → "Manage memory →" lands on the same page.
7. Toggle + instructions still save with the persona from the editor.
