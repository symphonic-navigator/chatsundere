# My Treasury — Design-Language Makeover

**Date:** 2026-06-27
**Author:** Liz (brief-led with Chris)
**Status:** Approved (design), pending implementation plan
**Surface:** `apps/user-client` — the "My Treasury" room (`/app/treasury`)
**Larissa:** not a security path (client-only; no `packages/crypto`, auth/sync/proxy change)
**Laura:** spec-pass (main lever) + pre-squash pass required

---

## 1. Purpose

The Treasury — the global view over all chat-owned artefacts — is feature-complete
and device-tested (artefact system Chunk 2, 2026-06-06) but was built
"mechanics-first": a custom `EditorTopbar`, bespoke `.treasury-*` CSS, segmented
type tabs, an inline-confirm action bar, and hand-rolled bottom-sheets. This is the
**seventh surface** of the UI/UX makeover. It brings "My Treasury" into the design
language already established by the Main Menu, My Account, My Settings, My
Integrations, and My Knowledge — **without touching any artefact logic**. The data
hooks, NSFW gating, filtering predicates, lightbox bridge, and multi-select
mechanics are all preserved; only the chrome and the type-filter affordance change.

## 2. Scope

### In scope

Everything on the Treasury route (`/app/treasury`):

- The page chrome (topbar → `PageScaffold`/`PageBar`).
- The artefact list rows (`TreasuryRow` → `ListRow` semantics).
- The **type filter** (segmented `TypeTabs` kept as a segmented control, restyled
  into the design language; the `Img` label spelled out to `Images`; "All" the
  default).
- The `⚙` filter sheet (persona / tags / favourites / projects-reserved) — restyled
  into the design language, behaviour unchanged.
- The active-filter chips row — restyled, behaviour unchanged.
- The multi-select flow (Select button → floating action bar; bulk Tag + Delete) —
  restyled, behaviour unchanged.
- A new `?`-help document for the room (`useHelp('treasury')`).

### Explicitly out of scope (deferred, by Chris's call)

- **The Lightbox.** It is already acceptable; untouched. The Treasury still opens it
  for view/edit/rename/tag/delete and pages through `items` exactly as today.
- **The slim attach-picker Quick-Sheet** (artefacts-as-attachments, Chunk 3). It
  belongs to the chat/cockpit surface, reworked when we reach the chat (the densest
  surface, last).

### Non-goals

- No Dexie/schema change. No migration.
- No change to the artefact data model, the filter predicates
  (`applyTreasuryFilters`/`collectTags`), the NSFW gating, or the lightbox
  `ViewableItem` bridge (`artefactToViewable`).
- No change to multi-select *behaviour* (Chris's call: keep the Select→action-bar
  model, no long-press).

## 3. Architecture — a single makeover surface

The Treasury is one route; this is a chrome-and-affordance translation, not a new
page tree. The shape is:

```
/app/treasury    The global artefact view (PageScaffold)
```

- `PageBar` breadcrumbs read *My Treasury* (single crumb), back → `/app`.
- The Unified-Experience zoom is origin-path-based and already handles this tile via
  the standard `NavTile`/`PageScaffold` adoption — no special wiring.
- The room authors its own `?`-help document, consistent with the other surfaces.

## 4. Chrome (`PageScaffold` + `PageBar`)

Replace the `EditorTopbar` + `flex min-h-[80dvh]` section with `PageScaffold`:

- `crumbs={[{ label: 'My Treasury' }]}`, `back="/app"`, `onHelp` from
  `useHelp('treasury')`.
- No `+ Add` button — artefacts are produced in chat, never created here.
- A body header row carries the **count label** on the left and the **Select** button
  on the right. The label reads `empty` when there are no artefacts, `N artefacts`
  when nothing is filtered, and **`N of M`** when any filter (type / persona / tags /
  favourites / search) narrows the set — fixing today's "42 artefacts over 3 rows"
  astonishment (Laura soft, folded).
- The page retires the bespoke `treasury`-section wrapper; padding/scroll follow the
  `PageScaffold` contract used by My Knowledge / My Integrations.

## 5. The list (`TreasuryRow` → `ListRow`)

`TreasuryRow` is rebuilt on the shared `ListRow` (`cs-row`) semantics:

- **Leading** — the format-coloured glyph (`formatGlyph(row.format)`). In **select
  mode** the leading slot renders the check indicator instead (preserving today's
  glyph→check swap).
- **Title** — `row.title`.
- **Subtitle** — `‹persona› · FORMAT · ‹size› · ‹age›`, the persona name tinted in
  its colour (today's two-line meta, carried over verbatim:
  `relativeTimeLabel`, `formatBytes(artefactSize(row))`).
- **Trailing** — the **favourite star**, inline and single-tap (kept out of the `⋯`
  by design: burying a one-tap action contradicts "disabled over hidden" /
  discoverability). Hidden in select mode, as today.
- `data-treasury-row={row.id}` is **preserved** — the lightbox reads it via
  `getOriginRect` for the open/close zoom. This attribute is load-bearing; the
  rebuild must keep it on the row root.
- Row tap: open the lightbox (normal mode) or toggle selection (select mode), exactly
  as today.

Where `ListRow`'s slot model and the select-mode check/glyph swap or the inline star
cannot be expressed through `ListRow` props cleanly, the row may compose the
`cs-row` structure directly rather than forcing an awkward prop shape — the goal is
the shared *visual grammar*, not prop purity. (Decided during implementation; flagged
so the reviewer expects either a clean `ListRow` adoption or a faithful `cs-row`
composition.)

## 6. Type filter — segmented control, restyled (not a dropdown)

Chris's original ask was a dropdown; Laura's spec-pass argued — and Chris agreed —
that the type axis is a **fixed five-item set with short labels**, exactly what a
segmented control is for, whereas the `PersonaFilterDropdown` pattern earns itself on
*unbounded* count (its own JSDoc rationale). Hiding five legible categories behind a
trigger (1 tap → 2) would trade the browse surface's legibility for visual uniformity
on a justification that does not apply here. **Decision: keep the segmented control.**

- `TypeTabs` is **kept**, not retired — restyled into the design language (it
  currently borrows the shared `history-tabs`/`history-tab` styling; the rebuild
  brings it into the makeover's segmented-control aesthetic, consistent with the rest
  of the Treasury chrome).
- Segments: **All** (default) · Apps · Docs · Code · **Images** — the same
  `TreasuryType` union; the clipped `Img` label is spelled out to `Images` (Laura
  soft, folded — the segmented row has the room, and it now matches the whole-word
  siblings).
- "All" is the default and the resting state; selecting it clears the `type` URL
  param (today's mirror semantics preserved exactly).
- URL mirroring of `type` via `mirrorUrl` is unchanged.

## 7. The `⚙` filter sheet + active-filter chips (restyled, behaviour kept)

Chris's decision: minimal eingriff — the type axis stays a segmented control (§6);
the remaining filters stay in the `⚙` sheet.

- The `⚙` sheet keeps its four groups: **Persona** (`PersonaFilterDropdown`),
  **Tags** (`TagEditor` in `pick` mode), **Favourites only**, **Projects** (reserved,
  "Coming soon", disabled). Behaviour and contents unchanged; only the bespoke
  `.treasury-sheet*` / `.treasury-filter-*` chrome is restyled into the design
  language (shared overlay aesthetic where a primitive fits; otherwise restyled CSS).
- The toolbar keeps today's two-row layout: the **type segmented control** as its own
  row, then a **Search · ⚙** row, with the active-filter count badge on the `⚙`
  button as today.
- The **active-filter chips** row (persona / favourites / each tag, each removable)
  stays, restyled to the design language.
- The search field (`HistorySearchBar`, fuzzy name search) stays.
- The empty-state "Clear filters" reset stays.

## 8. Multi-select (restyled, behaviour kept)

Chris's decision: keep the proven model, restyle only.

- The **Select** header button toggles select mode.
- A floating **action bar** shows the selection count and **🏷 Tag** + **🗑 Delete**.
- Delete uses today's **inline two-step confirm** in the action bar
  ("Delete N? Cannot be undone." → Delete / Cancel).
- **Tag** opens the bulk-tag sheet (`TagEditor` in `edit` mode → "Apply tags").
- All of this is restyled into the design language; the state machine
  (`selectMode`/`selected`/`tagging`/`confirmDelete`, `exitSelect`) is carried over
  verbatim.

### Known design tension (for Laura's spec-pass)

The inline-confirm delete in the action bar (§8) diverges from the shared
`ConfirmDialog` used elsewhere in the makeover. Chris consciously chose "keep
behaviour" over routing through `ConfirmDialog`. It is logged here as a **soft**
finding for Laura rather than silently changed; Chris arbitrates if she presses it.

## 9. Preserved verbatim (no change)

- The Lightbox and its full caps (view/edit/rename/tag/delete/cycle), opened via
  `openId`/`openIndex` over the filtered set.
- URL mirroring of `type` / `personaId` / `query`.
- NSFW persona gating: `useFilteredPersonas` → `visiblePersonaIds` → `visibleRows`;
  the persona auto-reset effect when a selected persona stops being visible.
- All data hooks: `useAllArtefacts`, `useSetArtefactFavouriteGlobal`,
  `useSetArtefactTags`, `useAddTagsToArtefacts`, `useDeleteArtefacts`,
  `useRenameArtefactGlobal`, `useUpdateArtefactContentGlobal`.
- The filter predicates `applyTreasuryFilters` / `collectTags` and the size/format
  helpers (`artefactSize`, `formatBytes`, `formatGlyph`, `relativeTimeLabel`).

## 10. Retire

- The bespoke `.treasury-row` CSS (replaced by `cs-row`/`ListRow` styling).
- The `EditorTopbar` usage here (replaced by `PageScaffold`/`PageBar`).
- Bespoke `.treasury-sheet*` / `.treasury-filter-*` / `.treasury-actionbar` CSS only
  to the extent it is replaced by shared primitives or restyled; what stays bespoke
  (the action bar, the bulk-tag sheet) is restyled, not deleted.

## 11. Help document

Author `treasury` help following the established `useHelp` pattern (the same shape
as My Knowledge / My Integrations). It explains: artefacts collect here from chats;
filter by type (the segmented control) and by persona/tags/favourites (⚙); tap a row
to open it
in the lightbox; star to favourite; Select to tag or delete several at once.

## 12. Testing

- The existing Treasury tests are updated to the new chrome: the rows are `cs-row`,
  the topbar is the `PageBar`, the `Img` label is now `Images`. The type filter stays
  a segmented control (its interaction is unchanged), so its assertions carry over;
  filtering, NSFW gating, multi-select, and lightbox-open assertions are preserved
  (the *behaviour* is unchanged).
- New: a test that the count label reads `N of M` when a filter is active and
  `N artefacts` when none is.
- Full user-client vitest at the gate (expect the **8 Node-localStorage baseline**; a
  9th failure is real). `pnpm typecheck --force` 14/14. Production build clean.

## 13. Audit gates

- **Laura:** spec-pass **done** (2026-06-27) — **no hard defects**, five softs. Two
  folded by Chris's call: the type filter stays a **segmented control** (not a
  dropdown — §6) and `Img`→`Images`; plus the count label now reads `N of M` when
  filtered (§4). Pre-logged/kept as softs: the §8 inline-confirm divergence (Chris
  keeps the behaviour, arbitrated); a pre-squash watch that the floating action bar
  and both sheets stay fully visible at 380 px inside `PageScaffold` (§14.6). A
  pre-squash pass still verifies the built flow honours the approved UX intent; hard
  defects block the squash.
- **Larissa:** not a security path — client-only; no `packages/crypto`,
  auth/sync/proxy change; the persisted-execution surface (HtmlPreview sandbox) is
  unchanged (lightbox out of scope).

## 14. Manual verification (Chris, on device)

1. The Treasury opens from its Entrance-Hall tile with the Unified-Experience zoom;
   the `PageBar` shows *My Treasury*, back returns with the collapse zoom.
2. The type segmented control shows all five categories at rest
   (All/Apps/Docs/Code/Images), defaults to **All**, narrows the list when a segment
   is tapped, and the choice survives a reload (URL mirror); tapping All clears the
   param.
3. Rows show glyph · title · `persona · FORMAT · size · age`; the persona is tinted;
   the favourite star toggles on a single tap. With a filter active, the header count
   reads `N of M`.
4. The `⚙` sheet filters by persona / tags / favourites; the active-filter chips
   appear and each removes its filter; "Clear filters" resets.
5. Search by name narrows the list; combined with the type segmented control and the
   sheet filters they compose correctly.
6. Select → tick several → 🏷 Tag applies tags; 🗑 Delete → inline confirm → removes
   them; Cancel exits cleanly.
7. Tapping a row opens the lightbox at the right item; paging, edit, rename, tag, and
   delete still work; close zooms back to the row.
8. SFW mode hides adult-persona artefacts (and auto-resets the persona filter if the
   selected persona vanishes); NSFW mode shows them.

## 15. Out-of-scope reminders (carried forward)

- The Lightbox makeover — deferred; it is acceptable as-is.
- The slim attach-picker Quick-Sheet — with the chat/cockpit surface (the chat comes
  last).
