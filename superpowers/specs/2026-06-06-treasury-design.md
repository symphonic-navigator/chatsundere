# Artefact System — Treasury (Chunk 2) Design

**Date:** 2026-06-06 · **Author:** Liz (with Chris) · **Block:** 2 (→ v0.1.0) ·
**Side:** client-only (no Larissa gate; see §11)

> Chunk 2 of the artefact system. The overall plan, decision log, and
> decomposition live in [[../../obsidian/ARTEFACTS-FEATURE-STATUS]] — read it
> first. The Kern (Chunk 1) is shipped: generation tool, author subagent, pill,
> lightbox reuse, per-chat sidebar. This spec details the **Treasury** only: the
> global browse/manage view over all chat-owned artefacts. Attachments-as-source
> (3), save-as-artefact (4), iteration (5), and the configurable author model (6)
> are later chunks.

---

## 1. Goal

Give the user one place — `My Treasury`, reached from the Entrance Hall — to see
**every** artefact across all chats, find one quickly (by type, persona, tag,
name, favourite), and manage them in bulk (tag, delete). The Treasury is a global
*view* over the existing chat-owned `artefacts` table (decision #1), not a
separate store. It is the orientation surface that the richer two-line row
treatment was reserved for (decision #20), and the foundation the Chunk-3
attachment picker will later slim down and reuse.

## 2. Scope

**In:**
- A new route `/app/treasury` and the live Entrance-Hall tile.
- A global `useAllArtefacts()` query + derived helpers (no Dexie migration).
- **Filter layout C:** segmented **type tabs** (`All · Apps · Docs · Code · Img`)
  + a **⚙ filter sheet** (persona, tags, favourites, project-reserved) + compact
  fuzzy **name search** + removable active-filter chips.
- **Two-line rows** (decision #20): glyph · title · star / persona · format ·
  size · age. Tap → lightbox, cycling over the **filtered** set.
- A shared **`TagEditor`** (autocomplete over existing tags, normalised) wired
  into both the **lightbox** (single artefact) and the Treasury (bulk).
- **Multi-select** via a header **Select** button → floating action bar →
  **bulk Tag** + **bulk Delete** (with confirm). No long-press.

**Out (later chunks — see STATUS §4):** attachments-as-source (3), save-message /
save-code-block (4), `edit_artefact` iteration (5), configurable author model (6),
`read_artefact` tool (deferred follow-up), vector/semantic name search, long-press
selection. TTI image artefacts: the data model already supports them
(`kind:'image'`, `blob`, `format:'image'`); the Treasury handles them correctly
when they arrive (the `image` type tab, blob-size, thumbnail glyph) but we build
nothing image-specific now.

## 3. Architecture overview

```
Entrance Hall  ──(My Treasury tile, live, meta = count)──▶  /app/treasury
                                                                  │
   useAllArtefacts()  ── all ArtefactRows, newest-first ──▶  Treasury page
        │                                                         │
        │   local UI state: { typeTab, personaId, tags[],         │
        │     favourite, query, selectMode, selectedIds }         │
        │   (typeTab/personaId/query mirrored to URL searchparams)│
        ▼                                                         ▼
   applyTreasuryFilters(rows, filters)  ──▶  filtered rows  ──▶  TreasuryRow[]
                                                                  │
                              tap (not select mode) ──▶ Lightbox(items=filtered, index)
                              tap (select mode)      ──▶ toggle selectedIds
                                                                  │
   floating action bar ──▶ bulk Tag (TagEditor → addTagsToArtefacts)
                       └──▶ bulk Delete (confirm → deleteArtefacts)
```

All mutations invalidate the `['artefacts']` query prefix, so the Treasury, the
per-chat sidebar, the chat pills, and the lightbox stay consistent.

## 4. Data layer (`data/artefacts.ts` — no migration)

No schema change: the Kern table (v13) already carries `tags`, `favourite`,
`personaId`, `format`. The `type` filter is **derived** from `format`, not stored
(per STATUS §3: "treasury 'type' filter derives from this").

New pure helpers (`lib/treasury-filter.ts`, fully unit-tested):

- `formatToType(format): 'app' | 'doc' | 'code' | 'image'` — mapping:
  `html→app`, `markdown→doc`, `code→code`, `svg|mermaid|image→image`.
- `normaliseTag(s): string` — `trim().toLowerCase()`; callers drop empties + dedupe.
- `artefactSize(row): number` — `new TextEncoder().encode(content).length` for
  text; `blob.size` for images. (A separate `formatBytes(n)` for display.)
- `collectTags(rows): string[]` — sorted unique tag set across rows, the
  autocomplete source (no separate query — derived from the loaded set).
- `applyTreasuryFilters(rows, { type, personaId, tags, favourite, query })` →
  filtered, newest-first (id tiebreaker). AND across axes; `type:'all'`/null
  axes are no-ops; `query` is a **case-insensitive substring/fuzzy** match on
  `title` (+ `fileName`); `tags` matches rows containing **all** selected tags.

New queries / mutations:

- `listAllArtefacts(): Promise<ArtefactRow[]>` — every row, newest-first.
- `useAllArtefacts()` — TanStack Query, queryKey `QK.allArtefacts = ['artefacts','all']`.
- `countAllArtefacts()` + `useAllArtefactCount()` — for the Entrance-Hall tile meta.
- `setArtefactTags(id, tags)` — replace (normalised + deduped); bumps `updatedAt`.
- `addTagsToArtefacts(ids, tags)` — bulk union into each row's tags (normalised).
- `deleteArtefacts(ids)` — bulk delete (Dexie `bulkDelete`).
- Hooks `useSetArtefactTags`, `useAddTagsToArtefacts`, `useDeleteArtefacts` —
  each invalidates `['artefacts']` (matches `all` + `chat` + `item`).

Age display reuses the existing relative-time formatter used by `HistoryRow`
(resolve the exact import in the plan).

## 5. Routing & Entrance Hall

- `App.tsx`: add `<Route path="/app/treasury" element={<Treasury />} />` as a
  sibling of `/app/history`, inside `<ProtectedRoute>`.
- `routes/app/entrance-hall.tsx`: flip the `My Treasury` `RoomTile` from
  `disabled` + "coming later" tooltip to `to="/app/treasury"`, with
  `meta = <count> artefacts` (via `useAllArtefactCount`; "empty" when zero — never
  hidden, per "disabled over hidden" the tile is always shown).

## 6. Treasury page (`routes/app/treasury.tsx`)

Composition, top to bottom:

1. **Header** — serif "My Treasury" title + count; a **Select** button on the
   right (becomes **Cancel** in select mode).
2. **`TypeTabs`** — segmented control `All · Apps · Docs · Code · Img`
   (`components/treasury/TypeTabs.tsx`), mirroring the History `Chats|Bookmarks`
   segmented tabs. (Label "Img"; open to "Visual" — settle in review.)
3. **Search + ⚙ row** — a compact name-search input (reusing the
   `HistorySearchBar` styling) and a **⚙ Filters** button carrying a badge with
   the count of active non-tab filters; opens the filter sheet.
4. **Active-filter chips** — removable chips for each active persona/tag/favourite
   filter (tap ✕ clears that axis).
5. **Row list** — `TreasuryRow[]` over the filtered set.
6. **Empty states** — distinct copy for "no artefacts yet" (warm onboarding-ish:
   artefacts appear here once a persona builds one) vs "no matches" (with a
   "clear filters" affordance).
7. **Floating action bar** — only in select mode (§9).
8. **Lightbox mount** — same shared lightbox, `items = filtered rows mapped via
   artefactToViewable`, `index` = tapped row; `getOriginRect` resolves the tapped
   row element (a `data-treasury-row="<id>"` attribute, mirroring the pill's
   `data-artefact-pill`).

**State** is local (`useState`): `typeTab`, `personaId`, `tags`, `favourite`,
`query`, `selectMode`, `selectedIds: Set<string>`, `openArtefactId`. `typeTab`,
`personaId`, and `query` are mirrored to URL search params (as History does) so
reload/back restores the view. Persona filter auto-resets when its persona is
hidden (NSFW→SFW), mirroring History's existing guard.

## 7. Components

`apps/user-client/src/components/treasury/`:

- **`TypeTabs.tsx`** — segmented tabs; `{ value, onChange }`. Pure presentational.
- **`TreasuryRow.tsx`** — two-line row. Props `{ row, selectMode, selected,
  onOpen, onToggleSelect, onToggleFavourite }`. Line 1: format glyph (reuse
  `formatGlyph` from `lib/artefact-sections.ts`) + title (serif, truncated) +
  favourite star. Line 2: `persona name (coloured) · FORMAT · size · age`. In
  select mode a leading checkbox; tapping the row toggles selection instead of
  opening. Carries `data-treasury-row={row.id}` for the FLIP origin rect.
- **`TreasuryFilterSheet.tsx`** — the ⚙ sheet (reuse the `ReadingToolStrip`→sheet
  / `TocSheet` overlay pattern). Contents: **Persona** (reuse
  `history/PersonaFilterDropdown`), **Tags** (multi-select over `collectTags`,
  built on the shared `TagEditor` in select-existing mode), **Favourites** toggle,
  **Project** (disabled, tooltip "arrives with projects" — disabled over hidden).
  Applies on change (live), closes on outside-tap/Escape.

`apps/user-client/src/components/artefact/` (shared, since the lightbox uses it too):

- **`TagEditor.tsx`** — reusable. Props `{ value: string[], onChange, suggestions:
  string[], mode?: 'edit' | 'pick' }`. Text input with autocomplete from
  `suggestions`; entered tags become removable chips; normalises + dedupes on add.
  Used in (a) the lightbox single-artefact tag panel, (b) the Treasury bulk-tag
  sheet, (c) the filter sheet's tag multi-select (`mode:'pick'`, no free text).

`lib/treasury-filter.ts` — the pure helpers from §4.

## 8. Tag editing & lightbox integration

Tags are authored in **both** the lightbox and the Treasury (Chris's call).

- **Lightbox** (`components/lightbox/`, shared with attachments): `ViewableItem`
  gains optional `tags?: string[]`; `Caps` gains `editTags: boolean` (artefacts
  `true`, attachments `false` → the tag panel is hidden); a new callback
  `onSetTags(id, tags)`. `artefactToViewable(row)` fills `tags` and `editTags:true`.
  A tag panel (the shared `TagEditor`, `suggestions` from all artefacts' tags)
  renders in the lightbox chrome only when `editTags`. **Both** the chat page and
  the Treasury wire `onSetTags → useSetArtefactTags`, so tagging is reachable from
  a chat pill exactly as from the Treasury. The attachment path is untouched
  (`editTags` defaults false; no `tags`).
- **Treasury single-row tagging** happens by opening the artefact in the lightbox
  (above); per-row inline tag editing is **not** added (keeps rows compact —
  decision #20). Bulk tagging is the Treasury-native path (§9).

## 9. Multi-select & bulk actions

First bulk-management surface in the user-client (no prior precedent). Entry is a
visible **Select** button — explicitly chosen over long-press (Chris's
preference; §11 CLAUDE.md "no hidden gestures", disabled-over-hidden).

- **Enter:** header **Select** → `selectMode = true`. Rows render a leading
  checkbox; tapping a row toggles its `selectedIds` membership (does **not** open
  the lightbox). Header button becomes **Cancel** (exits, clears selection).
- **Floating action bar** (bottom, only when `selectMode`): "`N` selected" +
  **🏷 Tag** + **🗑 Delete**.
  - **Tag** → opens a `TagEditor` sheet; applying calls `addTagsToArtefacts(
    selectedIds, tags)` (union — never removes existing tags), then stays in
    select mode (so the user can act again) or exits — settle in plan; default:
    exit after apply.
  - **Delete** → an inline confirm bar ("Delete `N` artefacts? This cannot be
    undone.") → `deleteArtefacts(selectedIds)`, then exit select mode. Mirrors the
    lightbox's existing destructive-confirm pattern.
- Selection state is page-local and cleared on unmount / Cancel / after a bulk op.

## 10. Consistency & reactivity

- Every artefact mutation (single or bulk, from Treasury / lightbox / sidebar)
  invalidates the `['artefacts']` prefix → the Treasury list, the per-chat
  sidebar, the chat pills, and the open lightbox all reflect changes live.
- A bulk delete removing the artefact currently open in the lightbox closes the
  lightbox gracefully (the item leaves the `items` array — guard the index, as the
  Kern lightbox already does on single delete).
- Deleting from the Treasury an artefact whose chat still has an in-stream pill
  turns that pill into the existing **tombstone** (Kern §10) — no new work, it
  falls out of the same "lookup by id returns nothing" path.

## 11. Security

Client-only → no Larissa gate (§9 CLAUDE.md). The Treasury introduces **no new
execution or network surface**: it renders artefact previews through the same
hard-sandboxed `HtmlPreview` the Kern/lightbox already use (iframe `allow-scripts`
without `allow-same-origin`, CSP `default-src 'none'`). It only adds new *read*
breadth (a global query over all chats' artefacts — all local, all the user's own)
and bulk *delete*/*tag* mutations over local Dexie rows. Nothing leaves the
device. No security-deferrals entry needed beyond the Kern's existing
persisted-execution note; add a one-line confirmation when this lands.

## 12. Testing

Backend-less; Vitest (frontend). Follow the per-task-runs-full-suite lesson
([[feedback_per_task_review_runs_full_suite]]).

- **Pure helpers (`lib/treasury-filter.ts`):** `formatToType` (every format),
  `normaliseTag` (trim/lowercase/empty), `artefactSize` (text + blob),
  `collectTags` (sort + unique), `applyTreasuryFilters` (each axis alone, AND
  combinations, type-tab mapping, fuzzy query case-insensitivity, tag-all-match).
- **Data mutations:** `setArtefactTags` (replace + normalise), `addTagsToArtefacts`
  (union, no dupes, multi-row), `deleteArtefacts` (bulk) — against a test Dexie;
  invalidation keys correct.
- **Components:** `TypeTabs` (switch), `TreasuryRow` (tap→open vs select-toggle,
  star), `TreasuryFilterSheet` (chips clear an axis), `TagEditor` (add normalises
  + dedupes, autocomplete filters suggestions, remove chip), select-mode flow
  (enter → toggle → bulk-delete-confirm → exit; bulk-tag applies).
- **Lightbox bridge:** `artefactToViewable` sets `tags` + `editTags:true`;
  attachment viewables keep `editTags:false`.
- No Dexie migration → no verno bump (unlike the Kern).

## 13. Manual verification (Chris, on device)

1. Entrance Hall: the **My Treasury** tile is live and shows the artefact count;
   tap → the Treasury opens listing artefacts from **multiple** chats.
2. **Type tabs** filter (build artefacts of a couple of types first): `Apps` shows
   only HTML, `Docs` only markdown, etc.; `All` shows everything.
3. **⚙ filter sheet**: filter by **persona** → only that persona's artefacts; the
   active-filter **chip** appears and its ✕ clears it; the ⚙ badge counts active
   filters. The **Project** row is visibly disabled with a tooltip.
4. **Favourites** toggle shows only starred artefacts; star/unstar from a row
   updates the list live.
5. **Name search** narrows by title, case-insensitively, as you type.
6. Tap an artefact → it opens in the lightbox; **paging** (←/→) cycles through the
   **currently filtered** set, not all artefacts.
7. In the lightbox, add/remove **tags** on an artefact → reopen (or open in the
   Treasury filter sheet) shows the tag; filtering by that tag finds it.
8. **Select** → pick several artefacts → **🏷 Tag** applies a tag to all of them
   (verify via the tag filter); **🗑 Delete** asks to confirm, then removes them
   and they vanish from any chat sidebar too.
9. Deleting a Treasury artefact that has an in-stream pill turns that pill into a
   tombstone (cross-check in the originating chat).
10. Empty/edge: a fresh account shows the warm "no artefacts yet" state; an
    over-filtered view shows "no matches" with a clear-filters affordance.

## 14. Open questions for the plan

- **Type-tab label**: "Img" vs "Visual" for the `image` type (covers
  svg/mermaid/image). Cosmetic; default "Img".
- **Bulk-tag post-apply**: exit select mode vs stay selected. Default: exit.
- **Lightbox tag-panel placement**: where in the existing lightbox chrome the tag
  panel sits (alongside rename) without crowding the 380px toolbar — resolve
  against the current lightbox layout in the plan.
- **Filter-sheet vs inline persona dropdown**: the ⚙ sheet hosts the persona
  dropdown; confirm the `PersonaFilterDropdown` works inside the sheet overlay
  (z-index / outside-tap interplay) — adjust if it conflicts.
- **Relative-time helper**: confirm the exact existing formatter `HistoryRow` uses
  and reuse it (don't introduce a second).
