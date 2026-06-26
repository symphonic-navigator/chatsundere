# My Knowledge — Design-Language Makeover

**Date:** 2026-06-26
**Author:** Liz (brief-led with Chris)
**Status:** Approved (design), pending implementation plan
**Surface:** `apps/user-client` — the "My Knowledge" room
**Larissa:** not a security path (client-only; crypto consumed via verbatim port, no `packages/crypto` change)
**Laura:** spec-pass (main lever) + pre-squash pass required

---

## 1. Purpose

The knowledge-base room is feature-complete and device-verified (Block 5, Chunks
A–C, 2026-06-08) but was deliberately built "mechanics-first": custom
`.knowledge-*` CSS, bottom-sheet overlays, inline delete-confirm, no `PageScaffold`.
This is the sixth surface of the UI/UX makeover. It brings "My Knowledge" into the
design language already established by the Main Menu, My Account, My Settings, and
My Integrations — **without touching any knowledge-base logic**. Chunking, the
embedding queue, status tracking, lore trigger-phrases, NSFW filtering, and the
Chatsune import are all ported **verbatim**; only the chrome and the add/edit/delete
information architecture change.

## 2. Scope

### In scope

Everything reachable from the "My Knowledge" tile in the Entrance Hall:

- The library list (`/app/knowledge`)
- The library detail (`/app/knowledge/:libraryId`)
- The document detail, including a create mode (`/app/knowledge/:libraryId/:documentId` and `/app/knowledge/:libraryId/new`)

### Explicitly out of scope (deferred, by Chris's call)

- **The chat-side `DocumentPicker`** (the multi-select library→document tree in the
  Cockpit). It belongs to the chat surface, which the makeover tackles last. The
  `PickerOverlay` shell exists, but a multi-select tree is new *content* — it is
  designed when the chat surface is reworked, not here.
- **The persona-editor `KnowledgeSection`** (library-selection toggles inside an
  `AccordionCard`). It belongs to the persona editor, reworked when we reach it.
- **NSFW deep-link gating** of the detail route (existing deferred follow-up; an
  app-wide decision, kept consistent — not introduced in this slice).

### Non-goals

- No Dexie/schema change. No migration.
- No change to retrieval, lore injection, the `query_knowledgebase` tool, embedding
  models, or the ingestion pipeline.

## 3. Architecture — a three-level page tree

The room mirrors the My Integrations list→detail pattern, extended one level deeper.

```
/app/knowledge                          Level 1 — library list
/app/knowledge/:libraryId               Level 2 — library detail (metadata + document list)
/app/knowledge/:libraryId/new           Level 3 — document detail, create mode
/app/knowledge/:libraryId/:documentId   Level 3 — document detail, edit mode
```

- `PageBar` breadcrumbs read *My Knowledge › ‹Library name› › ‹Document title›*. In
  create mode the trailing crumb reads **"New library"** / **"New document"** (no
  empty or stale segment).
- The Unified-Experience zoom is origin-path-based and already handles arbitrary
  depth; no special wiring beyond the standard `NavTile`/`PageScaffold` adoption.
- Each level authors its own `?`-help document, consistent with My Account / My
  Integrations.

## 4. Level 1 — Library list (`/app/knowledge`)

`PageScaffold` with **pure-navigation rows** (no inline actions on the row — the
"quieter list" line from My Integrations).

**Row anatomy:**
- **Body:** library name; description as subtext when present.
- **Trailing:** an **NSFW badge** when the library is adult-flagged, plus a
  read-only **document-count badge** (e.g. "12 docs").

The NSFW badge is deliberately kept in the list (Chris's call): in NSFW mode the
list shows a mix of SFW and adult libraries, and the badge tells the user which is
adult *before* opening it — a safety/certainty cue. (In SFW mode adult libraries are
filtered out entirely by the existing `useFilteredLibraries` path, so the badge is
only ever seen in NSFW mode.)

**Header / actions:**
- A single primary **`+ Add`** affordance → `/app/knowledge/new`-equivalent create
  path for a new library (a small create form; see §4.1).
- **Import from Chatsune** lives in an `OverflowMenu` (⋯) — it is the rare,
  one-off, secondary action. The existing `ChatsuneLibraryImport` logic (file
  picker for `.gz`/`.tgz`, parse, re-embed, success/error feedback) is ported
  **verbatim**, rehoused behind the ⋯ item with its success/error feedback
  preserved.

**Empty state:** constructive — "No libraries yet — create one to add documents."
with the `+ Add` as the obvious next step.

### 4.1 Creating a library

A new library has only cheap metadata (name, description, NSFW). Two equivalent
options were considered:

- a `/new` create page (consistent with My Integrations), or
- a lightweight inline create.

**Decision:** a small **create page** at the library level (mirroring the My
Integrations `/new` shape), so the create path matches the edit path (the library
detail, §5). The create page collects name (required), description (optional), and
NSFW, then lands on the new library's detail page. This keeps one mental model for
"a library's fields" across create and edit.

> Open for the plan: whether the library create page is a distinct route
> (`/app/knowledge/new`) or a transient create state of the detail scaffold. Either
> satisfies the design; the plan picks the simpler implementation. The detail page's
> metadata fields are always-save (§5), but **create** is necessarily an explicit
> "Create" action (the row does not exist until saved) — this is the same
> create-vs-edit asymmetry already present in My Integrations and is not the
> document-content explicit-save of §6.

## 5. Level 2 — Library detail (`/app/knowledge/:libraryId`)

One scrolling page that both **edits the library's metadata** and **hosts the
document list**. This is the one genuinely new composition in the room; it uses only
existing primitives.

**Top — metadata, always-save inline** (cheap, no embedding):
- Name → `InlineEditRow`
- Description → `InlineEditTextarea`
- NSFW → a toggle row (always-save). **In SFW mode this toggle is
  disabled-with-reason** ("Switch to NSFW mode to mark this adult"), screen-reader
  announced. Rationale: flipping NSFW on while in SFW mode would persist instantly
  and then `useFilteredLibraries` would remove the library from the list — the user
  navigates back to a vanished library that reads as deleted/broken (a
  least-astonishment defect; Laura HARD). Disabling the toggle in SFW mode means a
  library can never silently vanish, and the adult flag is managed from NSFW mode
  (consistent with how adult content is handled app-wide). In NSFW mode the toggle is
  live and flipping it on does **not** vanish the row (NSFW mode shows adult
  libraries).

Because every field here persists on blur, the page carries **no dirty-guard**. (The
dirty-guard lives only on the document detail, §6.)

**"Documents" section:**
- Quiet **pure-navigation rows** → document detail (Level 3). Body = document title;
  trailing = a read-only **status badge** (`pending` / `embedding…` / `ready` /
  `failed`). No inline trash, no inline retry (see §7).
- An **"Add ▾"** affordance opening an `OverflowMenu`. The downward caret telegraphs
  that this control opens a menu, deliberately distinguishing it from the Level-1
  `+ Add` which goes straight to a create path (Laura SOFT — the same label must not
  teach "direct action" on one level and "opens a menu" on the next):
  - **Upload files** → native multi-file picker (`.md` / `.markdown` / `.txt`),
    creating N documents directly. They appear in the list with `pending` /
    `embedding…` status; no navigation occurs. **A file that cannot be read or
    turned into a document fails constructively, not silently:** an inline notice
    names the cause and the offending filename (parity with the §4 import path's
    error feedback). The constructive-error machinery of §6/§7 only covers
    *embedding* failure, which has a row to land on; a *pre-creation* upload failure
    has no row, so it must surface here.
  - **New document** → navigates to the document detail in **create mode**
    (`/app/knowledge/:libraryId/new`).
- Constructive empty state — "No documents yet — add one by upload or paste."

**`ModelDownloadBanner`:** kept as a quiet inline notice (the precedent is the My
Integrations egress note), visible only while the on-device embedding model is
loading; it hides once ready. The same quiet notice also surfaces on the document
detail (§6) while the model loads, so a user who saves a new document on a fresh
device understands why the status sits at `pending`/`embedding…` rather than feeling
the app is stuck (Laura SOFT).

**Delete library:** in the `PageBar` `OverflowMenu` (⋯) → `ConfirmDialog`. Quiet,
protected, consistent with My Integrations; deletion is rare.

## 6. Level 3 — Document detail (`/:libraryId/:documentId` and `/new`)

Fields: **Title**, **Content** (textarea), **Trigger phrases** (`TagEditor`,
reused, with suggestions drawn from sibling documents), **Companion toggle** ("Let
the companion trigger this too"), plus **status** and **delete**.

The companion toggle is **disabled-with-reason** when there are no trigger phrases:
it carries its reason inline (e.g. subtext/tooltip "Add a trigger phrase first") and
is screen-reader announced, matching the `OverflowMenu` disabled-item convention — a
bare grey control with no explanation is the think-gap the rubric forbids (Laura
HARD).

While the on-device embedding model is loading, the quiet `ModelDownloadBanner`
notice (§5) also surfaces on this page, so a freshly-saved document's
`pending`/`embedding…` status has a visible explanation.

**Save model — the whole page is one explicit Save with one dirty-guard.**
- The user edits title / content / phrases / toggle, presses **Save** once, and all
  fields persist together. Leaving with unsaved changes raises the shared
  discard-confirm (`● Unsaved` badge + `ConfirmDialog`), adopted verbatim from My
  Integrations' `PageScaffold`/`PageBar` opt-in dirty-guard.
- Rationale (Chris): **one mental model, no astonishment.** Mixed always-save /
  explicit-save on a single page is exactly the "confusion gap" that makes otherwise
  good software annoying. One Save, one dirty model.
- **Re-embedding is an internal optimisation:** on Save, the content is diffed
  against the stored content and the document is re-queued for embedding **only when
  the content actually changed**. Title / phrase / toggle changes never re-embed.
  This is invisible to the user.
- **Create mode** uses the same page; saving creates the document and queues its
  first embedding. The explicit Save fits create naturally.

**Status & failure (the one constructive-error moment):**
- A status badge reflects `pending` / `embedding…` / `ready` / `failed`.
- On `failed`, the **error cause is shown in plain text** on this page, with a
  **Retry `Pill`**. The cause finally gets real estate here (today it is hidden in a
  list-row tooltip). The list row only signals `failed`; the fix lives on the detail
  page (§7).

**Delete document:** in the `PageBar` `OverflowMenu` (⋯) → `ConfirmDialog`,
mirroring the library delete. The Level-2 list row stays pure-navigation.

## 7. Status & retry placement

A failed embedding is the room's one constructive-error case. The decision (A over
the busier B):

- The **list row shows the status badge only**; on `failed` it reads clearly as
  "needs attention" but carries no inline retry.
- Tapping the row opens the document detail, where the **error cause + Retry** live.

This keeps the list uniform and gives the failure proper context. Embedding failures
are rare in practice (it runs locally in the browser), so the extra tap on the rare
failure path is an acceptable trade for a quiet, consistent list. Iteration remains
open if real use shows otherwise.

The failed badge stays a **plain read-only `Badge`** (not phrased "tap to fix"): the
row is already tappable and the `failed` state is visually distinct, so the
established navigate-to-detail pattern carries the remedy without giving a read-only
tell an action-like voice (Laura SOFT, kept plain by Chris's taste call).

## 8. Data flow & behaviour

- The existing `useLibraries` / `useDocuments` queries and the background ingestion
  queue are reused unchanged.
- **Live status** flows through `invalidateQueries` (this project uses no
  `useLiveQuery`). The implementation must verify the ingestion queue invalidates
  the documents query on each status transition so the list and detail badges update
  without a manual refresh; if it does not already, that invalidation is added.
- **NSFW filtering** for the list uses the existing `useFilteredLibraries` path
  verbatim.

## 9. Cleanup (opportunistic, within this slice)

Retiring the old chrome these surfaces used:

- Remove the pre-makeover overlays: `LibrarySheet`, `DocumentEditor`, the paste-text
  sheet, and `AddDocumentMenu` (its two paths move into the §5 `+ Add` overflow).
- Remove the dead `NewLibrarySheet` alias (existing opportunistic follow-up).
- Retire the bespoke `.knowledge-*` / `.doc-status*` / `.add-document*` CSS that no
  longer has a consumer, folding any still-needed styling into the design-language
  tokens/primitives.
- `DocumentStatusBadge` is re-expressed via the `Badge` primitive; the failed-state
  Retry becomes a `Pill` on the detail page.
- `TagEditor` and `ModelDownloadBanner` are kept (rehoused, not rewritten).

Anything touched by the chat `DocumentPicker` or persona-editor `KnowledgeSection`
is left alone — those surfaces still consume their own chrome until their own
makeover slices.

## 10. Testing

Vitest / RTL, per level:

- **Level 1:** list renders rows with NSFW + count badges; `+ Add` reaches the
  create path; the ⋯ import item triggers the (ported) import with success/error
  feedback; empty state.
- **Level 2:** metadata fields always-save on blur (name/description/NSFW); the
  documents list renders rows with the correct status badge; `+ Add` overflow offers
  Upload and New document; upload creates N documents in `pending`; library delete
  via ⋯ → confirm; empty state.
- **Level 3:** create → Save → document created + embedding queued; edit content →
  Save → re-embed queued; edit title/phrases/toggle only → Save → **no** re-embed;
  dirty-guard fires on leave with unsaved changes and is byte-quiet when clean;
  `failed` shows the error cause + Retry, and Retry re-queues; document delete via ⋯
  → confirm.

Full user-client vitest at the gate (expect the **8 Node-localStorage baseline**;
a 9th failure is real). `pnpm typecheck --force` 14/14. Production build clean.

## 11. Audit gates

- **Laura:** spec-pass **done** (2026-06-26) — 2 hard defects + 5 softs. Both hards
  folded in: the companion toggle's disabled-reason (§6) and the NSFW-vanish guard
  (§5, resolved by disabling the toggle in SFW mode per Chris). Softs folded: "Add ▾"
  caret (§5), upload-failure feedback (§5), model-loading notice on Level 3 (§5/§6),
  create-mode breadcrumb labels (§3); the failed-badge "tap to fix" soft was kept
  plain by Chris's taste call (§7). A pre-squash pass still verifies the built flows
  honour the approved UX intent; hard defects block the squash.
- **Larissa:** not a security path — client-only, crypto only consumed via the
  verbatim KB port, no `packages/crypto` change.

## 12. Manual verification (Chris, on device)

1. Library list shows the NSFW badge (in NSFW mode) and the document count; SFW mode
   hides adult libraries entirely.
2. `+ Add` creates a library and lands on its detail page; Import from Chatsune (⋯)
   imports a `.gz`/`.tgz` and shows success/error.
3. Library detail: editing name/description/NSFW persists on blur (reload confirms);
   the model-download notice appears once on a fresh device and then never again.
4. `+ Add` → Upload files adds several documents that progress
   `pending`→`embedding…`→`ready`; `+ Add` → New document opens the create page.
5. Document create → Save creates and embeds; editing only the title does **not**
   re-embed (status stays `ready`); editing the content re-embeds.
6. Leaving a document with unsaved changes prompts to discard; saved leaves are
   silent.
7. A failed document shows the cause + Retry on its detail page; Retry recovers it.
8. Delete a document and a library (⋯ → confirm); breadcrumbs and back behave at all
   three depths; the Unified-Experience zoom plays on enter/back.

## 13. Out-of-scope reminders (carried forward)

- Chat `DocumentPicker` makeover — with the chat surface.
- Persona-editor `KnowledgeSection` makeover — with the persona editor.
- NSFW deep-link gating of the library-detail route — existing deferred follow-up,
  app-wide decision.
