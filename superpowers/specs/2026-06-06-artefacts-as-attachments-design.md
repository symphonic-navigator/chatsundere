# Artefacts as Attachments (Artefact Chunk 3) — Design

**Date:** 2026-06-06
**Block:** 2 (→ v0.1.0). **Side:** client-only (no auth/sync/proxy/crypto → no
Larissa gate; see §8). **Status:** brainstormed with Chris 2026-06-06, design
approved.

Links: [[../../obsidian/ARTEFACTS-FEATURE-STATUS]] (living plan + decision log) ·
[[2026-06-06-treasury-design]] (Chunk 2) ·
[[2026-06-06-artefact-kern-design]] (Chunk 1) ·
[[2026-06-05-unified-lightbox-and-attachments-design]] (the attachments
subsystem this plugs into).

---

## 1. Purpose

Let a user attach an **existing artefact** to a new chat message, so one
persona's output can feed another persona's work. The driving scenario from the
decision log (#2): persona A produces a great single-file web app; persona B
(better at prose) is asked "write me a Discord project description for this" — B
receives a **copy** of A's artefact as an attachment.

This is Chunk 3 of the artefact system. Chunks 1 (Kern) and 2 (Treasury) have
shipped; the attachments subsystem (unified lightbox + uploads, 2026-06-05) and
its multimodal wire injection already exist. Chunk 3 is mostly a **UX surface**
over machinery that already works.

## 2. Key finding (why this chunk is small)

The attachments subsystem **already supports text attachments end-to-end**:

- `AttachmentRow` has `kind: 'image' | 'text'` with `text?: string`
  (`apps/user-client/src/boot/client-data-db.ts`).
- `addAttachment()` creates a pending row with `origin: 'upload'`
  (`apps/user-client/src/data/attachments.ts:23`).
- The send path resolves a text attachment to a `kind: 'text'` part and
  `buildUserWireContent()` wraps it in a markdown code fence
  (`apps/user-client/src/attachments/resolve-send.ts`,
  `apps/user-client/src/attachments/wire-injection.ts`).

So attaching an artefact reduces to: **copy a snapshot of the artefact's content
into a pending `kind: 'text'` attachment**, then let the existing flow carry it.
No change to the send path, the wire injection, or the lightbox is required.

## 3. Decisions (recap from the brainstorm)

These were settled with Chris on 2026-06-06; they extend the decision log in
[[../../obsidian/ARTEFACTS-FEATURE-STATUS]] §2.

1. **Entry point = the `(+)` button becomes a small menu** (variant A). Today
   `(+)` opens the file dialog directly; it now opens a two-item Aurora menu:
   *Upload from device* (the existing dialog) and *Attach from Treasury* (⬡). The
   menu is the natural home as more "add" sources arrive later (e.g. TTI).
2. **Picker = a slim Quick-Sheet** (variant A), not the full Treasury. Type tabs
   + fuzzy name search + select-first one-line rows + a sticky "Attach (N)"
   button. **No persona/tag filter** — search is the primary entry point.
   Persona/tag filtering is a later add **if device use shows the need** (Duplo
   over Lego).
3. **Selection only, no preview in the picker.** Tap toggles a check; there is no
   tap-opens-lightbox path. Deep inspection lives in the real Treasury (one tap
   away). Revisit if users want an in-picker peek.
4. **Re-use = copy, not reference** (decision log #2, unchanged). Each attach
   copies a **snapshot** into the chat's `attachments`. Lifecycle is decoupled:
   deleting the artefact later never breaks a sent message.
5. **No Dexie migration.** The `attachments` table already holds everything; we
   add no field and store no provenance link (copy semantics).
6. **Text-only this chunk.** All current artefact formats (HTML, markdown, code,
   SVG, Mermaid) are `kind: 'text'` (`content: string`); they copy into a
   `kind: 'text'` attachment. The future `kind: 'image'` artefact (TTI, blob)
   does not exist yet and is out of scope; the snapshot helper is shaped so a
   `blob→blob` branch is a trivial later add.

## 4. User flow

1. In a chat, the user taps **(+)** in the cockpit controls row.
2. A small menu opens with **Upload from device** and **Attach from Treasury**.
   - *Upload from device* → the existing hidden file input (unchanged behaviour).
   - *Attach from Treasury* → opens the `ArtefactPicker` bottom-sheet.
3. The picker shows, over **all chat-owned artefacts** (global, NSFW-gated per
   §7): type tabs (`All / Apps / Docs / Code / Img`), a fuzzy name search field,
   and select-first one-line rows (format-coloured glyph + title + format chip +
   a checkbox state). Tapping a row toggles its selection.
4. A sticky footer shows **Attach (N)**, disabled while N = 0.
5. Tapping **Attach (N)** copies a snapshot of each selected artefact into the
   chat's pending attachments, closes the sheet, and resets the selection.
6. The snapshots appear in the cockpit thumbnail strip exactly like uploads
   (text thumbs show their extension pill). From here the existing flow takes
   over: the user can remove or edit a snapshot via the lightbox, then send; the
   send path binds the pending attachments and the wire injection includes each
   as a code-fenced text part.

## 5. The snapshot (data flow)

A new helper in `apps/user-client/src/data/attachments.ts` maps an `ArtefactRow`
to an `AddAttachmentInput` and calls the existing `addAttachment()`:

```ts
/** Copy an artefact's current content into the chat as a pending attachment
 *  (a snapshot — lifecycle decoupled from the artefact). Text artefacts only. */
export async function addArtefactSnapshot(
  chatId: string,
  artefact: ArtefactRow,
): Promise<string> {
  return addAttachment({
    chatId,
    kind: 'text',
    fileName: artefact.fileName,
    mime: artefact.mime,
    text: artefact.content,
  });
}
```

- `origin` defaults to `'upload'` inside `addAttachment()` → the snapshot is
  removable and source-editable in the cockpit lightbox, and has no `delete`
  cap (it behaves exactly like an uploaded file). This is the desired behaviour;
  we do **not** add an `origin` parameter.
- We copy **content + fileName + mime** only. We do **not** copy the artefact's
  `title` (attachments have no title) or `tags` (attachments have no tags). The
  `fileName` carries the extension, which is what `detectFormat()` and the wire
  label both rely on.
- Image artefacts (`kind: 'image'`) are out of scope; if `artefact.kind` is ever
  `'image'` the helper would need a blob branch — explicitly deferred.

The picker calls `addArtefactSnapshot()` once per selected id (sequential awaits
are fine; counts are tiny), then invalidates the pending-attachments query once
(mirroring `Cockpit.ingest`). A thin mutation hook
(`useAddArtefactSnapshots(chatId)`) wraps this so the picker stays declarative.

## 6. Components

### New

- **`ArtefactPicker`** (`apps/user-client/src/components/artefact/ArtefactPicker.tsx`)
  — the slim bottom-sheet. Props: `chatId`, `onClose`. Local state: `type`,
  `query`, `selected: Set<string>`. Renders `TypeTabs`, a search field, the row
  list, and the sticky "Attach (N)" footer. On attach: calls the snapshot hook
  per selected id, then `onClose()`.
- **A `(+)` source menu** in the Cockpit. The current `(+)` button's
  `onClick={() => fileInputRef.current?.click()}` is replaced by a toggle that
  opens a small Aurora menu mirroring `CockpitMenu`'s styling, positioning, and
  outside-tap/Escape close behaviour. Two items: *Upload from device* (clicks the
  hidden input) and *Attach from Treasury* (opens the picker). Keep the file
  input and the existing `ingest` path untouched.
- **`addArtefactSnapshot()`** + **`useAddArtefactSnapshots(chatId)`** in
  `data/attachments.ts` (see §5).
- Optionally a small **`ArtefactPickerRow`** component if the row markup is large
  enough to warrant extraction; otherwise inline in `ArtefactPicker`.

### Reused (unchanged)

- `useAllArtefacts()` (global query), `useFilteredPersonas()` (NSFW gate),
  the `visibleRows` filter pattern (§7), and `applyTreasuryFilters()` with only
  the `type` and `query` axes active (`personaId: null`, `tags: []`,
  `favourite: false`).
- `TypeTabs`, the search-bar pattern, the format-glyph/colour helpers, and the
  compact one-line row aesthetic of the artefact sidebar (decision log #20).
- The attachment strip, the lightbox, and the entire send/wire path — **no
  changes**.

## 7. NSFW / privacy

The picker reuses `useFilteredPersonas()` exactly as the Treasury does: it builds
the set of visible persona ids and filters the artefact rows to those whose
`personaId` is in that set **before** display (mirror of `treasury.tsx`
`visibleRows`). Consequence: in SFW mode, an NSFW persona's artefacts — and the
tags they would carry — never appear in the picker. Same privacy posture as the
Treasury, achieved by reusing the same gate. There is no separate code path to
get wrong.

## 8. Security

Client-only, so no Larissa gate. This chunk adds **no new execution or network
surface**: it copies already-persisted artefact text into the existing
attachments table; previewing a snapshot reuses the existing hard-sandboxed
lightbox viewers (`HtmlPreview` etc.), and the wire injection is the existing
outbound path. The only new outbound consequence is that artefact content can now
ride a chat message to the model — but that is the user's explicit action and is
identical to attaching a text file today. Log the surface in
[[../../obsidian/insights/security-deferrals]] for completeness when the chunk
lands.

## 9. Edge cases & error handling

- **Empty treasury / empty after filter:** the sheet shows a calm empty state
  ("No artefacts yet" before any exist; "No matches" when a type/search filter
  excludes everything).
- **No selection:** the "Attach" button is disabled until N ≥ 1.
- **Re-attach:** each attach is a fresh copy; attaching the same artefact twice
  yields two independent snapshots. No dedupe (copy semantics, harmless).
- **Large artefact:** copied as-is, no extra cap — identical to attaching a large
  text file. The resulting wire payload is the user's choice.
- **Artefact deleted between open and attach (race):** `addArtefactSnapshot`
  takes the `ArtefactRow` already in hand from the query result, so the snapshot
  still succeeds with the last-known content; a stale row is acceptable (it is a
  copy). No special handling.

## 10. Testing

Per CLAUDE.md §10 (full vitest must stay green; per-task review runs the full
suite).

- **Unit — snapshot mapper:** `addArtefactSnapshot` produces a pending
  `AttachmentRow` with `kind: 'text'`, `origin: 'upload'`, `messageId: null`, and
  `fileName`/`mime`/`text` copied from the artefact.
- **`ArtefactPicker` (vitest + RTL):** type-tab filtering, search filtering,
  select/deselect toggling, the "Attach (N)" count, disabled-when-empty,
  NSFW-hidden rows absent from the list, and that Attach calls the snapshot hook
  once per selected id and then closes.
- **`(+)` menu:** opens on tap; shows two items; closes on outside-tap and
  Escape; *Upload from device* triggers the file input; *Attach from Treasury*
  opens the picker.
- **Integration-ish (reuse existing tests):** after attach, the snapshot appears
  in the pending strip; on send, the wire content includes the artefact as a
  code-fenced text part (existing wire-injection tests cover the tail).

## 11. Out of scope

- Persona/tag filters inside the picker (add if device use shows the need).
- Any preview/lightbox **inside** the picker.
- Image (`kind: 'image'`) artefacts — no TTI yet.
- Chunk 4 (save-as-artefact), Chunk 5 (iteration), Chunk 6 (configurable author
  model).

## 12. Manual verification (Chris, on device)

1. In a chat, tap **(+)** → the menu shows *Upload from device* and *Attach from
   Treasury*; outside-tap and Escape close it.
2. *Upload from device* still opens the OS file picker and attaches as before.
3. *Attach from Treasury* opens the slim sheet; type tabs and search narrow the
   list; tapping rows toggles checks; "Attach (N)" reflects the count and is
   disabled at 0.
4. Attach two artefacts (one HTML app, one markdown doc) → both appear in the
   cockpit strip with extension pills; the sheet closes.
5. Open one snapshot from the strip → the lightbox shows the correct preview
   (HTML renders in the sandbox; markdown renders as a doc); remove the other
   from the strip.
6. Send → the persona receives the attached artefact content; deleting the
   original artefact in the Treasury afterwards leaves the sent message intact.
7. **Cross-persona:** make an artefact with persona A, open a chat with persona
   B, attach A's artefact, and confirm B can work with it.
8. **NSFW:** with adult mode off, an NSFW persona's artefacts do not appear in
   the picker.
