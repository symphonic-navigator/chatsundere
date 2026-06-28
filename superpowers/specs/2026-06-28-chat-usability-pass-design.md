# Chat Usability Pass — Design Spec

**Date:** 2026-06-28
**Author:** Liz (with Chris)
**Status:** Draft — awaiting Laura spec-pass (§9.2) before plan
**Surface:** `apps/user-client` — the chat surface (last and densest makeover surface)

---

## 1. Context

The UI/UX makeover has rebuilt every pre-chat surface in the design language
(Entrance Hall, My Account, Settings, Integrations, Knowledge, Treasury,
History, My Circle, the persona editor). The **chat itself** is the final
structural surface. This spec covers a *usability* pass on the chat's chrome and
navigation — the "grobe Sachen" — deliberately ahead of any later visual
fine-tuning, so the pieces can be felt together first.

It does **not** touch the message stream rendering, the composer internals, voice,
compaction, or memory engine behaviour. It is a chrome-and-navigation pass.

Four areas, in two implementation slices:

- **Slice A — Chrome:** read-only topbar, cockpit icons, toast repositioning.
- **Slice B — Cockpit pages:** bookmarks, artefacts, and knowledge become full
  pages mirroring the memory page, replacing the current overlay sheets.

The two slices ship as two squashes (ADR 0003 granularity). This single spec
covers both so Laura can audit the whole as one coherent intent.

### Guiding mental model

> **Cockpit pages = "this conversation". Entrance-Hall rooms = "everything,
> across all chats".**

The cockpit's four buttons (bookmarks, artefacts, memory, knowledge) lead to
*chat-scoped* surfaces. The Entrance-Hall rooms (My Treasury, My Knowledge,
History → Bookmarks) remain the *global* cross-chat views. This keeps the IA
astonishment-free: a user in a chat reaches that chat's things from the cockpit,
and everything-everywhere from the rooms.

---

## 2. Area 1 — Read-only topbar

**File:** `routes/root.tsx` (the global brand bar; the reading-chat branch only).

Today, in reading-chat mode the brand bar is an ultra-thin strip: a small
"Chatsundere" wordmark (link to home) + `BackgroundStreamBadge` on the left, the
`AdultModeToggle` pill on the right. Persona avatar and chat title live only in
the interaction-mode `InteractionTopbar`; the reading bar has neither.

### New layout (reading-chat mode)

```
[ ← Chatsundere ]  (avatar)  ···········  Chat title   [NSFW]
```

Left → right:

1. **Exit button** — a back-arrow (Lucide `ArrowLeft`) + the small "Chatsundere"
   wordmark, together forming **one** affordance. Tapping it leaves the chat for
   the **Entrance Hall** at **`/app`** (see `InteractionMode.tsx` "deliberate
   navigation back to the Entrance Hall"). Note: today's reading-mode wordmark
   links to `/` (`root.tsx:123`); pin **both** the reading-mode and
   interaction-mode exits to the same destination (`/app`) so "raus hier" is one
   consistent gesture (Laura soft). Goal: make it instantly legible rather than
   something the user has to decode. The arrow was chosen over a door/log-out
   glyph because `LogOut` already means *sign out* elsewhere in the app (avoid the
   collision).
2. **Persona avatar** — `PersonaAvatar`, placed in the **left cluster** (not
   centred — deliberately away from the device camera notch). Tappable →
   navigates to the **persona page** (`/app/persona/:id`), from where the user
   can start a new chat. Carries an `aria-label` naming the persona.
3. **Spacer.**
4. **Chat title** — right-aligned, immediately left of the NSFW pill. Truncates
   with an ellipsis when long; the exit button always stays fully legible (title
   yields width first). **No function for now** — rendered as **plain text, not a
   button-like element**, so it never reads as interactive (the interaction-mode
   title *is* tap-to-rename; same text/position in two modes must not invite a
   tap that silently does nothing — Laura soft). Editing remains in the
   interaction topbar.
5. **NSFW pill** — the existing `AdultModeToggle`, unchanged, rightmost.

### Data

The brand bar needs the current chat's persona (id, name, colour, avatar) and
chat title. `current-chat.store.ts` already publishes `chatPersonaIsAdult` and
`chatId` to the brand bar by the same pattern. Extend it with a published
`chatHeader: { personaId; name; colour; title } | null` (`null` when not in a
chat), set by `chat-page.tsx` alongside `setChatPersonaIsAdult`, consumed by
`root.tsx`. No Dexie change.

### Notes / constraints

- 380 px budget: exit button (~24 px arrow + ~90 px wordmark) + avatar (~28 px) on
  the left, NSFW pill (~50 px) on the right, title takes the elastic middle and
  truncates. Workable; the title is the only flexible element.
- Scope-fenced to the **reading** branch — interaction mode keeps its existing
  `InteractionTopbar` (which already shows avatar + editable title + hamburger).
  This brings the reading bar to parity; it does not duplicate or replace the
  interaction topbar.
- **Exact-route gating (Laura HARD — see §5.0):** the reading-bar exit/avatar/
  title additions render **only on the chat itself**, never on the cockpit
  sub-pages of §5. Today `isReadingChat`/`isChatRoute` derive from
  `pathname.startsWith('/app/chat')` (`root.tsx:42`), which would also match the
  new sub-routes. The chat chrome must key on the **exact** chat route so the
  sub-pages fall back to standard page chrome (as the memory page does).

---

## 3. Area 2 — Cockpit icons

**File:** `components/chat/Cockpit.tsx`.

The four resource buttons currently render text glyphs (◈ bookmarks/ToC, ⬡
artefacts, ◌ memory, ❖ knowledge). Replace with real Lucide SVGs, reusing the
main-menu vocabulary where one exists:

| Button     | Icon (Lucide) | Rationale                                   |
|------------|---------------|---------------------------------------------|
| Bookmarks  | `Bookmark`    | Plain, unambiguous.                         |
| Artefacts  | `Gem`         | Matches the "My Treasury" room tile.        |
| Memory     | `Brain`       | The "Chatsundere brain" — direct, eingängig.|
| Knowledge  | `BookOpen`    | Matches the "Knowledge" room tile.          |

- Existing count badges (e.g. memory uncommitted count) are preserved.
- The **`Brain`** icon is adopted for memory **consistently**: the cockpit
  button *and* the memory page header (and any future memory surface) use it.
- Icons inherit the cockpit's existing button sizing, colour tokens, and
  disabled/active states; only the glyph node changes.

---

## 4. Area 3 — Toast repositioning

**Files:** `components/Toast.tsx`, `state/toast.store.ts` (unchanged logic),
`index.css` (positioning).

Today `<Toast/>` is global (rendered in `root.tsx`) and anchored
**bottom-centre** (`bottom: max(1rem, safe-area)`, z-100). In a chat that places
it directly over the cockpit — e.g. the "*\<persona\> is starting to remember
you*" note fired from `stream-manager.store.ts:236`.

### Change

- Re-anchor the toast container to the **top**, directly beneath the brand bar.
- Render it as a **full-width banner** spanning the content column (the app's
  centred `max-w-[420px]`/`lg:max-w-[640px]` width) rather than a centred
  rectangle — less intrusive per Chris.
- Keep `position: fixed` (overlay; never reflows layout) and the existing
  `aria-live="polite"`, tones, auto-dismiss, and optional action button.
- **Global** — applies on every route, not chat-only (one consistent position;
  under a top page-bar it reads fine elsewhere too).

On mobile (380 px) the banner is effectively edge-to-edge; on desktop it is the
width of the centred content column. Safe-area top inset respected.

**Do not occlude the back control (Laura soft):** on the list/settings pages the
`PageBar` back/crumbs sit directly under the brand bar. The transient banner must
not cover the back affordance — anchor it below the full page chrome (brand bar +
`PageBar` where present), or confirm the (brief, transient) overlap is acceptable
during the later visual pass.

---

## 5. Area 4 — Cockpit pages (bookmarks · artefacts · knowledge)

The three remaining cockpit buttons currently open overlay **sheets**
(`TocSheet`, `ArtefactSheet`, `KnowledgeSheet`). The memory button already
navigates to a full **page** (`/app/persona/:id/memory?chat=`). This area brings
the other three to the same pattern: **full pages, reached from the cockpit with
the unified-experience zoom, returning to the chat**, reusing the makeover list
primitives. The three sheets are then retired.

All three pages are **chat-scoped** routes:

- `/app/chat/:chatId/bookmarks`
- `/app/chat/:chatId/artefacts`
- `/app/chat/:chatId/knowledge`

Each uses `PageScaffold` + `PageBar` chrome with crumbs ending in the section
name and a back affordance returning to the chat (interaction mode). Each carries
an authored `?`-help doc, like the other makeover pages. Navigation from the
cockpit button uses the existing zoom-from-origin mechanism (as memory does).

### 5.0 Routing & chrome (Laura HARD — must be settled here)

The three sub-routes sit under the `/app/chat` prefix, which the brand bar uses
to switch into chat chrome (`isChatRoute = pathname.startsWith('/app/chat')`,
`root.tsx:42`). Left as-is, the sub-pages would render the chat-collapsed brand
bar (and the Area 1 exit/avatar/title) **stacked over their own `PageBar`** — two
competing exits and a misleading chat title on a list page.

**Remedy:** narrow the chat-chrome predicate to the **exact** chat route — match
`/app/chat/:chatId` but **not** its sub-paths (e.g. a trailing-segment check or
matching the resolved route, not a bare `startsWith`). The three sub-pages then
get the **standard non-chat page chrome** exactly like the memory page
(`/app/persona/:id/memory`): a single `PageBar` back-to-chat, no second exit, no
chat title overlay. All four cockpit destinations thereby share one chrome
treatment. The reading-topbar additions (§2) explicitly never appear on these
sub-pages.

**Scope clarity (Laura soft):** because `Gem`/`BookOpen` are shared with the
global Treasury/Knowledge rooms, each cockpit page's current crumb/title must make
the **"this chat"** scope unmistakable (mirror the sheets' "In this chat"
framing), so a user arriving via the shared glyph never mistakes it for the global
room.

### 5.1 Bookmarks page

Replaces `TocSheet`. **One page, two sections** (decision: "Eine Seite, beide
Bereiche"):

- **Pinned** — the starred messages of this chat.
- **In this chat** — the table-of-contents timeline (`buildToc(messages)`), every
  navigable entry.

Per row (reusing the `cs-row` / `ListRow` idiom): the entry label, an inline
**rename** (the existing 80-char inline edit, `setBookmarkLabel`) and **star /
unstar** (`toggleBookmark`). Tapping a row **navigates back into the chat scrolled
to that message**, via the chat-page's existing `focusId` mechanism (e.g.
`/app/chat/:chatId?focus=<messageId>` → reading mode + scroll). Empty state for a
chat with no entries yet.

**Push, don't replace (Laura soft):** the row-tap navigates with a **push**, so
the system/browser Back from the chat lands back on the bookmarks list with scroll
position intact — this largely neutralises the scrubbing cost below for free. (The
existing `focusId` effect already strips the `?focus` param with `{replace:true}`
afterwards, `chat-page.tsx:639` — orthogonal and fine.)

Trade-off consciously accepted: repeated "scrubbing" across many messages means
re-opening the page per jump (a sheet could overlay-and-stay). Consistency with
the memory pattern and a single button = single page won this call; the push-nav
Back path softens it.

### 5.2 Artefacts page

Replaces `ArtefactSheet`. **Rich** (decision: "Reich wie My Treasury") — reuse the
existing **`TreasuryRow`** component so the chat view and the global Treasury read
identically:

- Sections: **★ Favourites** then **In this chat** (`buildArtefactSections` over
  `useChatArtefacts(chatId)`).
- Per row: glyph, title, meta (`format · size · age`), inline favourite star, and
  an **`OverflowMenu`** with **Rename** and **Delete** (delete →
  `ConfirmDialog`). Reuse Treasury's rename/`useDeleteArtefacts` mutations.
- Tapping a row opens the artefact in the existing **Lightbox** (overlay over the
  page). Empty state mirrors the sheet's "Artefacts you create appear here."
- **Persona label (Laura soft):** the page is single-persona, so `TreasuryRow`'s
  per-row persona name/colour is redundant noise here. If cheap, add a prop to
  `TreasuryRow` to suppress the persona label on this chat-scoped surface;
  otherwise accept as a minor and revisit in the visual pass.

### 5.3 Knowledge page

Replaces `KnowledgeSheet`. **Pure binding/assignment surface** (decision: "Reine
Zuordnungsseite") — a page, not a content browser:

- A list of libraries (`useFilteredLibraries`, NSFW-filtered by the persona's
  `adultPersona` exactly as today).
- **Persona-assigned** libraries render **locked-on** (checked + disabled, with a
  "from persona" hint — transparency: the user always sees what the persona
  contributes but cannot silently strip it).
- **Other** libraries are freely **toggleable for this chat** (the chat's ad-hoc
  `libraryIds`), **always-save** (toggle persists immediately — the makeover
  model; no explicit save).
- When no chat exists yet to bind to, toggleable rows are disabled-with-reason
  (as the sheet does today).
- A link to **My Knowledge** to create/manage libraries (and the empty state).

**Conscious disable-over-hide exception (Laura soft):** `useFilteredLibraries`
*removes* NSFW libraries for an SFW persona rather than greying them. This is the
app's established global NSFW gating model (not a capability that persona can
have), so it is correct — logged here as a principled exception so it is not later
mistaken for disable-over-hide drift.

### 5.4 Cockpit & cleanup

- The bookmarks/artefacts/knowledge cockpit buttons change from "open sheet" to
  "navigate to page" (memory already does this) — all four buttons now behave
  identically.
- **Always shown, never hidden (Laura soft):** today the ToC and artefacts
  buttons render only when `toolsAvailable && …` (`Cockpit.tsx:476`), so they
  vanish in a fresh/empty chat while memory/knowledge persist. Drop that gate so
  **all four buttons always render** (disable-over-hide; "behave identically") —
  each page already carries its own empty state to greet a chat with nothing yet.
- Remove `TocSheet`, `ArtefactSheet`, `KnowledgeSheet` and their rendering in
  `chat-page.tsx`, plus their now-dead CSS, once the pages exist.
- The artefact **lightbox** stays (it is opened by the artefacts page and
  elsewhere). The `current-chat.store` `isArtefactSheetOpen` flag and related
  sheet state are removed; `openArtefactId`/lightbox state stays.

---

## 6. Out of scope (this pass)

- Message-stream rendering, bubble styling, reasoning/CoT display.
- The composer/cockpit *input* internals, attach-picker Quick-Sheet, chat
  `DocumentPicker` (deferred sub-surfaces — separate work).
- Voice, compaction, memory-engine behaviour.
- Any Dexie/schema change (none required).
- Visual fine-tuning of the chat (the deliberate later pass).

---

## 7. Implementation slices

**Slice A — Chrome** (one squash): Areas 1–3 (read-only topbar, cockpit icons,
toast). Small, fast, low-risk; no new routes.

**Slice B — Cockpit pages** (one squash): Area 4 (three pages + cockpit rewiring
+ sheet retirement). The substantive work.

Each slice: spec-driven, subagent-driven implementation (per-task spec + quality
review), opus whole-branch review, Laura pre-squash pass. Client-only — **not a
Larissa path** (no `auth/sync/proxy-service`, no `packages/crypto`).

---

## 8. Quality gates

- `pnpm typecheck --force` clean; `pnpm run build` green; full user-client Vitest
  at the established baseline + new suites for the three pages and the topbar.
- Biome clean on changed files.
- TypeScript strict, `noUncheckedIndexedAccess`; package-public functions carry
  JSDoc; British English throughout (§3/§7).

---

## 9. Manual verification (Chris, on device)

**Topbar (reading mode):**
1. Open a chat, scroll up into reading mode → the top bar shows `← Chatsundere`,
   persona avatar, chat title (right), NSFW pill.
2. Tap `← Chatsundere` → lands in the Entrance Hall.
3. Tap the persona avatar → lands on that persona's page; can start a new chat.
4. A long chat title truncates with "…"; the exit button stays fully legible.

**Cockpit icons:**
5. The four buttons show Bookmark / Gem / Brain / BookOpen; count badges intact;
   the memory page header shows the same Brain.

**Toasts:**
6. Trigger the "starting to remember you" note (or any toast) inside a chat → it
   appears as a full-width banner under the top bar, over the stream, never over
   the cockpit. Confirm on another route (e.g. Settings) it is also top.

**Cockpit pages:**
7. Bookmarks: open from the cockpit → see Pinned + In-this-chat; rename and
   star/unstar work; tapping a row returns to the chat at that message.
8. Artefacts: open → Treasury-style rows; star, rename, delete (with confirm);
   tapping opens the lightbox.
9. Knowledge: open → persona libraries locked-on with "from persona"; toggling a
   non-persona library persists immediately; link to My Knowledge works.
10. All four cockpit buttons zoom to their page and back to the chat consistently;
    no sheet overlays remain.

---

## 10. Process note

Per CLAUDE.md §9.2, Laura ran a **spec-pass on this document before the
implementation plan** (her main lever). Verdict: **1 HARD + 8 soft**, all folded
into this revision:

- **HARD — routing/chrome collision** (`/app/chat/:chatId/*` vs the
  `startsWith('/app/chat')` chat-chrome switch). Folded → §5.0 + §2 exact-route
  gating.
- **Softs (folded):** all-four-cockpit-buttons-always-shown (§5.4); display-only
  title as plain text (§2.4); bookmark jump = push-nav (§5.1); shared-icon scope
  clarity in crumbs (§5.0); `TreasuryRow` persona-label suppression on the
  single-persona artefacts page (§5.2); top-toast must not occlude the `PageBar`
  back control (§4); both exits pinned to `/app` (§2.1); knowledge NSFW-hide
  logged as a conscious disable-over-hide exception (§5.3).

No findings deferred. Laura's **pre-squash** pass still runs per slice before each
squash. Next: `writing-plans` produces the two plans (A Chrome, B Cockpit pages),
then subagent-driven implementation.
