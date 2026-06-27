# My History — Makeover Design Spec

**Date:** 2026-06-27
**Author:** Liz (with Chris)
**Surface:** `apps/user-client` → `/app/history`
**Status:** Draft for review

---

## 1. Purpose

My History is one of the two remaining main-menu rooms not yet rebuilt in the
design language. This spec lifts it onto the proven makeover surface pattern —
`PageScaffold`/`PageBar` + the `cs-row` list + `OverflowMenu` + `Badge` +
per-page `useHelp` — exactly as the seven surfaces before it (foundations, main
menu, My Account, My Settings, My Integrations, My Knowledge, My Treasury).

All data behaviour is **ported verbatim**: no Dexie/schema change, no new query
hooks. Only chrome, row anatomy, and the add/rename/delete information
architecture change. This is **not a Larissa path** (client-only; no
`packages/crypto`, auth/sync/proxy touch).

### Chris's explicit asks (the brief)

1. **Persona avatar** on the left of each chat item.
2. **NSFW badge** on conversations whose persona is NSFW.
3. **All per-item functions — including rename — behind a `⋯` menu.**
4. **Chat title font 1–2 pt smaller** than the standard row title.

### Decisions taken during brainstorming

- **Both tabs** (Chats **and** Bookmarks) get the makeover this pass.
- The **`⋯` menu** on a chat row carries four actions: **Rename**, **New chat
  with this persona**, **Go to persona**, **Delete**.
- **Go to persona** → the **persona editor** (`/app/persona/:id`).
- The **persona filter** stays a **restyled dropdown** (not a Treasury-style
  filter sheet).
- **Bookmark entries** keep a **visible star** (the canonical "remove bookmark"
  affordance); only **Rename** moves into a `⋯`.
- A **count label** like Treasury (`N chats` / `N of M` when filtered / empty
  discriminant) sits at the top.

---

## 2. Surface shell

Rebuild `routes/app/history.tsx` from `EditorTopbar` + bespoke `.history-*`
chrome to:

- **`PageScaffold`** with `crumbs={[{ label: 'My History' }]}`, `back="/app"`,
  `onHelp` from a new **`useHelp('history')`**.
- A new help doc **`content/help/history.md`** + its `HelpKey` registration in
  `content/help/index.ts` (`history: { title: 'My History — help', markdown }`).
- The **mindspace reset on mount** is preserved verbatim — History is a neutral
  surface, so it resets to the user-default mindspace exactly as today.
- The **tab bar** (Chats / Bookmarks) is rebuilt on the existing **`cs-segmented`**
  control (the design-language segmented control already used by Treasury's type
  filter) — two segments, `role="tablist"` semantics preserved.
- **`HistorySearchBar`** is kept as-is (already a shared component, also consumed
  by Treasury). Placeholder text stays tab-dependent.
- The **persona filter** stays `PersonaFilterDropdown`, with its `.persona-dropdown*`
  CSS **restyled to the `cs-*` token family** (rounded-13px popover, dark
  surface, persona colour dots, accent-highlighted selection). Behaviour, props,
  and the URL/auto-reset logic are unchanged.
- A **count label** mirroring Treasury: a small `text-[11px] uppercase
  tracking-widest text-paper-soft` line driven by a new pure helper
  **`lib/history-count.ts` → `historyCountLabel(total, shown)`** returning
  `empty` / `N chats` / `N of M`. The count reflects the **chats** tab; on the
  bookmarks tab it is suppressed (bookmarks are grouped, not a flat count).

The existing **URL mirroring** of `personaId`, the **persona-vanish auto-reset**
(NSFW→SFW flip), and the **search/filter `useMemo` chain** are ported verbatim.

---

## 3. Chats list — the `cs-row` rebuild

`HistoryRow` is rewritten to the shared `cs-row` grammar. Anatomy:

```
┌───────────────────────────────────────────────────┐
│ ▢avatar    Evening with Liz                  NSFW ⋯ │   title 12px
│            Liz · 3h ago                             │   persona · age
└───────────────────────────────────────────────────┘
```

- **Leading (`cs-row-leading`):** `PersonaAvatar` at **40 px** (image-cropped or
  the monogram tile). The `StreamingOrb` live-stream pulse is positioned as a
  small corner dot over the avatar (it currently renders inside the row; it stays
  but is repositioned so background activity remains visible without the old bare
  colour orb). The avatar is `aria-label`'d by the component already. The avatar
  sits **inside the row-body button** — tapping it opens the chat (whole-row
  single-target, mirroring `TreasuryRow`); the build must **not** wire the avatar
  to a different target (Laura SOFT-7).
- **Body (`cs-row-body`):**
  - **Title:** `displayTitle(chat)` in the persona's colour, truncated, rendered
    **1 px smaller than the `cs-row-title` default** (13 px → **12 px**) via a
    reusable modifier `data-compact` on the title span (`.cs-row-title[data-compact]
    { font-size: 12px }`). Chris's "1–2 pt smaller" ask.
  - **Subtitle (`cs-row-subtitle`):** `<persona name> · <relative time>`, persona
    name in persona colour at 0.8 opacity (mirroring Treasury's subtitle), time
    via `relativeTimeLabel(chat.lastMessageAt)`.
- **Trailing (`cs-row-trailing`):**
  - **NSFW badge:** `persona.adultPersona ? <Badge tone="danger">NSFW</Badge> : null`
    — the same `Badge tone="danger"` as My Knowledge's library badge. (The persona
    NSFW flag is `adultPersona`, not `nsfw` — `nsfw` is the *libraries* field. In
    SFW mode adult personas are already filtered out upstream by
    `useFilteredPersonas` via `!p.adultPersona`, so this badge only ever renders in
    adult mode — the intended safety cue, consistent with My Knowledge.)
  - **`OverflowMenu` (`⋯`, default icon variant)** with items in this order:
    1. **Rename** → enters inline-rename mode: the row body swaps to the
       preserved `HistoryRowRenameInput`; the rest of the row dims. On
       commit/cancel it returns to idle. (Same `onRename` contract as today.)
    2. **New chat with this persona** → navigates `/app/chat/new?personaId={persona.id}`.
    3. **Go to persona** → navigates `/app/persona/{persona.id}?return=/app/history`
       (persona editor). **The `?return=` is mandatory** (Laura SOFT-1): the
       editor otherwise defaults its back/save target to `/app/circle`
       (`persona-editor.tsx`), dropping the user out of their filtered History.
       Carry the active `personaId` filter in the return path where set
       (`/app/history?personaId={persona.id}`) so the filter survives the
       round-trip — mirroring the in-chat persona-name tap precedent
       (`chat-page.tsx`).
    4. **Delete** (`tone: 'destructive'`) → opens a **`ConfirmDialog`** (makeover
       standard, replacing the inline `HistoryRowConfirmTray`). The dialog is
       `destructive`, title "Delete this chat?", body includes the artefact-count
       warning when `> 0` ("This will also delete N artefact(s). This cannot be
       undone."), confirm label "Delete". The `useChatArtefactCount(chat.id, open)`
       lookup is gated on the dialog being open — preserving today's
       lazy-count behaviour (no artefact content loaded per row at rest).
- **Row body tap** → `/app/chat/{chat.id}` (unchanged).

`HistoryRowConfirmTray` is **retired** (ConfirmDialog supersedes it).
`HistoryRowRenameInput` is **preserved**.

---

## 4. Bookmarks list — the `cs-row` rebuild

`BookmarksList` is lifted into the design language while keeping its grouped
structure (bookmarks grouped by chat, most-recently-active first).

- **Group header** per chat: a calm header row carrying the **`PersonaAvatar`**
  (~28 px) + the **chat title** in the persona colour + the persona name. This
  replaces the bare `.bookmark-group-title` heading.
- **Bookmark entry:** a light `cs-row` (or `cs-row`-styled `<li>`):
  - **Body:** the bookmark `label` as the title; **tap jumps** to
    `/app/chat/{chatId}?focus={messageId}` (via the existing `onJump`). The
    `data-role` (user/assistant) accent is preserved.
  - **Trailing:** a **visible filled star** (`★`, `data-active`) that **removes
    the bookmark** (un-stars via `useToggleBookmark`) — kept visible per Chris's
    call — plus a **`⋯`** carrying a single **Rename** action that enters the
    existing inline-rename input. (Inline rename input, commit-on-Enter/blur,
    Escape-discards — ported verbatim.)
- The empty-bookmarks state is restyled to the makeover empty-state idiom
  (`font-display` italic line + supporting sentence), matching Treasury.

---

## 5. Empty states

The three chat-tab empty states (no chats / no search match / persona-filtered
with none) and the bookmarks empty states are restyled to the makeover
empty-state idiom: a centred `font-display text-lg italic` line plus, where a
next action exists, a `.cs-btn`-styled CTA (Start a conversation / Start a new
one). Copy is preserved; only the chrome aligns to Treasury/Knowledge.

When a **filter or search** has narrowed the list to empty (as opposed to a
genuinely empty History), the empty state also offers an inline **"Clear filter"**
CTA that resets the persona filter + search query — mirroring Treasury's
filtered-empty "Clear filters" affordance (Laura SOFT-5), for cross-surface
symmetry with the sibling room.

---

## 6. CSS & cleanup

**New / changed CSS (in `index.css`):**
- `.cs-row-title[data-compact] { font-size: 12px }` — the reusable 1 px-smaller
  title modifier.
- Persona-dropdown restyle (`.persona-dropdown*`) onto the `cs-*` token family.
- A small NSFW-badge + `⋯` trailing cluster spacing tweak if needed (reuse
  existing `cs-row-trailing` gap).
- Bookmark group-header + entry styles in the `cs-row` family (replacing
  `.bookmark-*`).
- Avatar-corner positioning for `StreamingOrb` when consumed inside a `cs-row`.

**Retired CSS / components:**
- `.history-row*`, `.history-tabs`, `.history-tab` (→ `cs-segmented`).
- `.bookmark-group*`, `.bookmark-group-list`, `.bookmark-entry`, `.bookmark-row`.
- `HistoryRowConfirmTray.tsx` (component + its styles).
- **Verify before retiring `.toc-entry-*`**: the bookmark inline-rename currently
  borrows `.toc-entry-input`/`.toc-entry-actions`/`.toc-entry-rename`/
  `.toc-entry-star`. These classes are **shared with the in-chat Table-of-Contents
  bookmark list** — they must **NOT** be retired. The bookmark rebuild introduces
  its own `cs-row`-family classes and stops borrowing `.toc-entry-*` only if a
  `grep` confirms the chat ToC still owns them; otherwise the bookmark list keeps
  using them. (Confirmed during planning, not assumed.)

---

## 7. Data flow & schema

**No Dexie/schema change (stays at the current version).** Every hook is ported
verbatim:

- `useChats`, `useUpdateChat` (rename/title), `useDeleteChat`,
  `useChatArtefactCount` (lazy, gated on the delete dialog).
- `useBookmarks`, `useToggleBookmark`, `useSetBookmarkLabel`.
- `useFilteredPersonas` (NSFW gating), `useMindspaces`, `useSettings`,
  `useMindspaceStore` (neutral-surface reset).

The NSFW badge keys purely on `persona.adultPersona` — no new field, no new
query.

---

## 8. Components touched

| File | Change |
|---|---|
| `routes/app/history.tsx` | Rewrite shell: `PageScaffold` + `useHelp` + `cs-segmented` tabs + count label; keep filter/search/memo logic verbatim. |
| `components/history/HistoryRow.tsx` | Rewrite to `cs-row`: avatar leading, 12 px title, NSFW badge, `OverflowMenu` (4 actions), ConfirmDialog delete. |
| `components/history/BookmarksList.tsx` | Lift to `cs-row`: avatar group headers, visible star + `⋯`-rename entries. |
| `components/history/PersonaFilterDropdown.tsx` | CSS restyle only (markup/behaviour unchanged). |
| `components/history/HistoryRowConfirmTray.tsx` | **Delete** (superseded by ConfirmDialog). |
| `components/history/HistoryRowRenameInput.tsx` | Preserved (consumed by the new row + bookmark rename). |
| `lib/history-count.ts` | **New** pure `historyCountLabel(total, shown)`. |
| `content/help/history.md` | **New** help doc. |
| `content/help/index.ts` | Register the `history` HelpKey + doc. |
| `index.css` | New `cs-row`/badge/dropdown/bookmark styles; retire `.history-*`/`.bookmark-*` (keep shared `.toc-entry-*`). |

---

### 3.1 Build watch — trailing cluster at 380 px (Laura SOFT-3)

avatar(40) + 12 px title + persona-coloured subtitle + NSFW Badge + `⋯` all share
one row. No tap collision (the Badge is non-interactive), but the title-truncation
budget is tight for NSFW personas with long names. At build/pre-squash, verify
the title still shows a useful stub at 380 px with both Badge and `⋯` present, and
that the `⋯` keeps a ≥ 40 px tap target.

---

## 9. Build process

Standard makeover discipline:

1. spec (this file) → **Laura spec-pass** (UX audit before build).
2. `writing-plans` → implementation plan.
3. **Subagent-driven** implementation (per-task fresh implementer + spec/quality
   review).
4. **opus whole-branch review** before squash.
5. **Laura pre-squash** pass (the built flow honours approved intent).
6. Gates: `pnpm typecheck --force` (14/14), full user-client **vitest** at the
   8 Node-localStorage baseline (new history-count + row + bookmark + a11y
   tests), production **build**.
7. Squash on a `feat/my-history` branch; **Liz does not push** (Chris pushes).

Not a Larissa path (client-only).

---

## 10. Test plan

- **`historyCountLabel`** pure-function unit tests (empty / `N chats` /
  `N of M`).
- **`HistoryRow`** RTL: avatar renders; NSFW badge present iff `persona.nsfw`;
  `⋯` opens with the four items in order; Rename enters inline mode; "New chat"
  and "Go to persona" navigate to the right paths; Delete opens ConfirmDialog and
  the artefact-count warning shows when `> 0`; row-body tap navigates to the chat.
- **`BookmarksList`** RTL: grouped by chat with avatar header; star removes a
  bookmark; `⋯`-rename enters inline edit and commits.
- **History route** RTL: tab switch via `cs-segmented`; persona filter + search
  narrows the list and the count reflects `N of M`; empty states render the right
  copy/CTA.

---

## 11. Manual verification (Chris, on device)

1. Open My History from the main menu — zoom-in honoured, back collapses to the
   tile.
2. Each chat row shows the persona avatar (image where set, monogram otherwise);
   a live stream shows the orb on the avatar corner.
3. In adult mode, NSFW personas' chats carry the red NSFW badge; in SFW mode they
   are absent entirely (filtered upstream).
4. The `⋯` menu: Rename (inline), New chat with this persona (lands in a fresh
   chat with that persona), Go to persona (opens the persona editor), Delete
   (ConfirmDialog; artefact warning when the chat owns artefacts).
5. Chat title reads ~1 pt smaller than the subtitle weight expects — calmer.
6. Bookmarks tab: grouped by chat with avatars; the star removes a bookmark; the
   `⋯` renames it; tapping an entry jumps into the chat focused on the message.
7. Persona filter dropdown matches the design language; selecting narrows both
   tabs; the count shows `N of M`.
8. `?`-help opens the My History help reader.

---

## 12. Laura spec-pass

**Verdict: no hard defects** — the spec faithfully executes Chris's four asks and
the proven `cs-row` + `⋯` + `ConfirmDialog` grammar, and is a net empowerment gain
(two functions added, none made unreachable). Seven soft findings:

- **SOFT-1 (folded, mandated):** "Go to persona" must pass `?return=/app/history`
  (carrying `personaId`) or the editor drops the user in My Circle — §3.
- **SOFT-5 (folded):** filtered-empty states gain a "Clear filter" CTA for
  Treasury symmetry — §5.
- **SOFT-3 (build watch):** trailing cluster crowding at 380 px — §3.1.
- **SOFT-7 (build note):** avatar tap opens the chat, not the persona — §3.
- **SOFT-2** ("Go to persona" label) — keep as-is, matches the chat surface's
  mental model. Chris-arbitrated taste; no change.
- **SOFT-4** (visual separator before the destructive Delete in the `⋯`) — optional
  design-language convention; Chris's call at build. Not mandated here.
- **SOFT-6** (chats hide actions in `⋯`, bookmarks keep a visible star) — affirmed
  **justified, not a defect**: the star is a canonical toggle (like Treasury's
  favourite), rename lives in `⋯` on both tabs. No change.

She confirmed clean: no function unreachable, no dead-end, rename click-depth
(1→2) acceptable, count-suppression on Bookmarks reasonable, the lazy
artefact-count gate preserved, and the `.toc-entry-*` retirement guard correctly
conditioned rather than assumed.

---

## 13. Out of scope / deferred

- **Date-group headers** (`Today / Yesterday / Earlier`) — a long-standing Phase-5
  candidate (dropped once on LOC budget). Not in this pass; revisit when the list
  density warrants it.
- **Setup-Hints** in History — separate Phase-5 design.
- The **chat surface** itself (the densest, comes last in the makeover).
