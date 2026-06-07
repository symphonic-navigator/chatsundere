# Knowledgebase — Chunk B2 (Attach document) — Design

**Date:** 2026-06-07
**Author:** Liz (with Chris, brainstormed end-to-end)
**Status:** Approved design, ready for implementation plan
**Roadmap:** Block 5 → v0.2.0 (knowledge base). Client-only.

---

## 1. Context & overall feature

The knowledgebase ships as independently valuable chunks on the value ladder
*manage → use → automatic*:

- **Chunk A (shipped, `0ef499f`) — Foundation.** Libraries, on-device ingestion,
  the *My Knowledge* room.
- **Chunk B (shipped, `8d3e496` + `0b7800f`) — Retrieval.** The
  `query_knowledgebase` tool, persona ↔ library and ad-hoc chat ↔ library binding,
  model awareness. The model decides *when* to look something up; retrieval returns
  scored *snippets* scoped to the assigned libraries.
- **Chunk B2 (this spec) — Attach document.** The user explicitly attaches a single
  library document's **full** content to a chat message, as a first-class
  attachment — the deliberate counterpart to retrieval's snippets.
- **Chunk C (later) — Lorebooks.** Phrase-triggered injection.

### Why this is its own chunk

Attach-document is **user-driven**, **whole-document**, and **explicit**, where
retrieval is **model-driven**, **snippet-sized**, and **automatic**. Chris's framing
(verbatim, worth preserving): the feature exists so the user can on the one hand
*"über den Tellerrand rausschauen"* — reach past whatever libraries happen to be
assigned to this persona/chat — and on the other hand make the deliberate *"ich will
das ganze Dokument da jetzt drinnen haben"* move: pull one complete document into the
turn rather than letting retrieval snippet at it.

The north star, from Chris: **it must be fully equivalent to file upload.** Same
picker affordance, same lightbox, same rename/edit, same appearance in the chat
stream. The user learns *one* attachment model, not two. Every divergence below is
justified against that bar.

This is **not a Larissa change** — client-only; no auth/sync/proxy/crypto surface;
no new network egress (the attached content rides the *existing* outbound text-
attachment wire path, identical to an uploaded `.md` file).

---

## 2. Architectural approach (the one real fork)

Two ways to build this were considered:

1. **Reuse the existing `attachments` pipeline** (the path "Artefacts as attachments"
   / Chunk 3 already established). **← recommended, chosen.**
2. Build a parallel "knowledge-attachment" subsystem.

The whole machinery a document attachment needs **already exists** for text
attachments: the outbound wire path (code-fenced text in `wire-injection.ts`), the
lightbox preview (`attachmentToViewable` + `detectFormat`), the in-stream rendering
under the user message, rename/edit, and binding-to-message on send. Attach-document
adds only a new *source* (a library document) and the copy-on-write mechanic. A
parallel subsystem would duplicate all of that — re-introducing exactly the
two-models-to-learn confusion the feature exists to avoid. **We reuse the pipeline.**

---

## 3. Data model — copy-on-write by reference

The `AttachmentRow` (in `apps/user-client/src/boot/client-data-db.ts`, currently
`origin: 'upload' | 'generated'`, with `text?`, `fileName`, `mime`, `kind`, `state`,
`messageId`, `order`) gains:

- **`origin: 'library'`** — a third provenance value (joins `'upload'`/`'generated'`).
  A library attachment is always `kind: 'text'`.
- **`kbRef: { libraryId: string; documentId: string } | null`** — the reference. It
  is both the *live-content source* (while unmaterialised) and the *provenance*
  (for a small "from Library › Document" label in the lightbox), and it **survives**
  materialisation and snapshot.

No separate `materialised` flag is needed. The materialisation state is derived:

> **materialised ⇔ `row.text` is non-null.**

Effective values while pending:

- **effective fileName** = `row.fileName ?? (document.title + '.md')`
- **effective content** = `row.text ?? document.content` (the latter read *live* via
  `getDocument(kbRef.documentId)`)

Documents are Markdown, so the derived `.md` filename drives the lightbox Markdown
renderer and the `mime` is `text/markdown`. No Dexie schema-version bump is required
for the new optional fields if the existing table tolerates additive optional
properties; the implementation plan confirms whether a verno bump (and the
corresponding fresh-open assertion update) is needed and, if so, adds the migration
backfill (`origin` stays as-is for existing rows; `kbRef` defaults `null`).

---

## 4. Copy-on-write lifecycle (the core)

1. **Attach.** Selecting documents in the picker creates one pending `AttachmentRow`
   per document with `origin: 'library'`, `kbRef` set, `text` **unset**. No content
   is copied — a pure reference. (Mirrors `addArtefactSnapshot` in
   `data/attachments.ts`, but stores a reference instead of snapshotting content.)
2. **Rename** (lightbox) → sets `row.fileName` only. Content **stays a live
   reference** (`text` remains null). A name change does not copy content — the most
   faithful reading of "only copy when the user changed something".
3. **Content edit** (lightbox Source tab — e.g. adding a note) → **materialises**:
   the current live content is frozen into `row.text`, after which the attachment is
   fully decoupled and behaves exactly like an uploaded text attachment.
4. **Send** → if still a reference (`text` null), the current live content is frozen
   into `row.text` as a **snapshot** (and `fileName` settled to its effective value)
   at send time, before/at the point the attachment binds to the message
   (`attachPendingToMessage` in `stream-manager.store.ts`). After send the message is
   history-stable: later editing or deleting the source document **never** alters the
   sent message. This is WYSIWYG/store-and-send, consistent with the
   artefact-attachment precedent (copy-not-reference) and image normalisation.

`kbRef` is retained throughout for provenance display.

**COW reach decision (Chris):** the reference lives **only until send**
(snapshot-on-send). Persistent post-send references — which would save storage but
retroactively mutate or break sent history on source edit/delete (and change content
on *regenerate*) — were considered and **rejected**.

---

## 5. The picker — accordion-tree, multi-select

New bottom-sheet `components/knowledge/DocumentPicker.tsx` (sibling to
`components/artefact/ArtefactPicker.tsx`), props `{ chatId, onClose }`.

- **Source: all libraries**, via `useFilteredLibraries()` — **NSFW-gated** (a SFW
  chat never sees adult libraries; mirrors the persona-editor / Treasury precedent).
  **Not** restricted to the persona/chat-assigned set — this is the deliberate
  "look past the assigned set" reach (§1).
- **Layout: accordion-tree (chosen over drill-down).** Libraries render as
  expand-in-place groups; tapping a library reveals its documents *inline* on one
  scrolling surface; multiple libraries can be open at once. Chris chose this over a
  two-level drill-down sheet — he finds push-to-hidden-subscreen navigation
  personally tiring — while acknowledging the drill-down was the calmer choice for
  the neurodivergent audience. Inline visibility wins here.
- **Multi-select**, mirroring `ArtefactPicker`: checkboxes selectable across
  libraries, a sticky **"Attach (N)"** action; the full selection is snapshotted so
  it persists across search/expand changes (not just the visible subset). Equivalence
  with multi-file upload — one attachment model, not two.
- **Fuzzy search** over document titles (and library names), reusing the existing
  search affordance pattern.
- **Embedding status is irrelevant.** Attach uses the document's **raw content**, not
  its vectors — so a `pending` / `embedding` / `failed` document is fully attachable.
  No gating on `embeddingStatus`.
- A new `addDocumentReferences(chatId, documents)` in `data/attachments.ts` creates
  the pending reference rows (computes `order` like `addAttachment`), plus a
  `useAddDocumentReferences` hook for the picker.

---

## 6. Entry point & wiring

The cockpit `(+)` source menu (`components/chat/Cockpit.tsx`, currently the two-item
*Upload from device* / *Attach from Treasury* menu) becomes **three items**:

```
Upload from device · Attach from Treasury · Attach from knowledge
```

All copy in British English. A new optional prop `onAttachFromLibrary` is threaded
`chat-page.tsx → InteractionMode.tsx → Cockpit.tsx` (exactly as `onAttachFromTreasury`
is today). The `DocumentPicker` sheet renders at chat-page level alongside
`ArtefactPicker`, and its root (`.document-picker-root`) is **exempt** from
`InteractionMode`'s unpinned outside-tap close (same treatment as the other sheet
overlays, so the first tap reaches the sheet rather than collapsing the cockpit).

---

## 7. Edge & empty states (constructive — the *dere* half)

- **No libraries exist** → the *Attach from knowledge* menu item is shown
  **disabled with a tooltip** ("Create a library first") — disabled-over-hidden, not
  removed.
- **An empty library** → its accordion group shows a quiet "no documents yet" hint.
- **Source document or library deleted while a *pending* attachment references it** →
  **defensive materialisation**: the pending row is snapshotted (current content
  frozen into `row.text`) at the moment of deletion, so the in-progress attachment
  doesn't break under the user. Hook this into the existing delete paths
  (`deleteDocument` / `deleteLibraryCascade` in `data/knowledge.ts`). If content is
  somehow already gone, the row degrades to an empty-but-named attachment rather than
  throwing (constructive failure).
- **Live read fails at preview/send** (document vanished between frames) → preview
  shows a constructive "document no longer available" state; send degrades to the
  last-known/empty content rather than blocking the send.

---

## 8. Wire format & lightbox

- **Wire (unchanged):** the existing text-attachment path in
  `attachments/wire-injection.ts` — `` `Attachment: <fileName>\n```\n<content>\n``` ``
  — carries the (effective, snapshotted-at-send) content. Same framing as an uploaded
  file, so the model treats it identically. Resolution in `attachments/resolve-send.ts`
  / `stream-manager.store.ts` reads the effective content for a `library`-origin row.
- **Lightbox:** `attachmentToViewable` (in `components/lightbox/viewable-item.ts`)
  maps a `library`-origin pending row to a `ViewableItem` whose `.md` filename routes
  `detectFormat` to the Markdown renderer; caps = rename ✓, remove ✓ (pending),
  copy/download ✓ (text), editSource ✓ (pending). In the referenced state the preview
  reads live content; **editing in the Source tab materialises** (§4.3). A small
  provenance line ("from <library> › <document>") is shown from `kbRef`.

---

## 9. Testing & verification

- **Unit (`data/attachments.ts`, COW):** rename ⇏ content copy; content-edit ⇒
  materialise; snapshot-on-send freezes effective content+name; `kbRef` survives
  materialisation and snapshot; `addDocumentReferences` order computation; defensive
  materialisation on source delete.
- **Knowledge/NSFW:** the picker source is NSFW-filtered (adult library hidden in a
  SFW chat); embedding-status-independence (a `failed` document is attachable).
- **Components:** accordion expand/collapse; multi-select persistence across
  search/expand; the disabled *Attach from knowledge* menu item with zero libraries;
  sheet outside-tap exemption (no cockpit collapse on first tap).
- **Full vitest run before squash** — not only the touched dirs (the standing lesson;
  a touched-dir-only run has repeatedly missed cross-file regressions). Verify any
  "pre-existing" failure claims against master directly.
- `pnpm typecheck`, `pnpm run build`, biome clean.
- **Manual verification** section (device steps Chris runs) — see §10.

---

## 10. Manual verification (device — Chris)

1. With ≥2 libraries (one SFW with several docs, one adult), open a chat and tap
   `(+)` → **Attach from knowledge**.
2. The accordion lists **all** libraries (adult one hidden if the chat is SFW).
   Expand two libraries; both stay open.
3. Multi-select documents across both libraries; "Attach (N)" reflects the count;
   attach.
4. The attachments appear in the cockpit strip like uploads. Tap one → lightbox shows
   the **live** Markdown with a "from <library> › <document>" line.
5. **Rename** an attachment → name changes; (internally still a reference).
6. **Edit** another's content (add a note) in the Source tab → saves (materialised).
7. Send. The attachments render under the user message exactly like uploaded files;
   the model's reply reflects the full document content.
8. Now **edit the source document** in *My Knowledge* and **delete** another source
   document → the already-sent message is unchanged (snapshot held).
9. Attach a document, then **delete its source library while the attachment is still
   pending** → the pending attachment survives (defensive materialisation).
10. Empty case: in a profile with **no libraries**, the `(+)` menu shows *Attach from
    knowledge* **disabled** with the tooltip.

---

## 11. Deliberately out of scope

- **Chunk C** (Lorebooks / phrase-triggered injection).
- **Persistent post-send references** (Chris chose snapshot-on-send, §4).
- **Prior-turn attachment replay** (the existing, separately-tracked deferral — a
  vision/text attachment "forgets" after its turn).
- A `tags`-set-membership filter in `packages/embeddings` (unrelated retrieval
  optimisation).

---

## 12. Files (anticipated)

**New**
- `apps/user-client/src/components/knowledge/DocumentPicker.tsx`

**Modified**
- `apps/user-client/src/boot/client-data-db.ts` — `origin: 'library'`, `kbRef` field
  (+ verno bump if required).
- `apps/user-client/src/data/attachments.ts` — `addDocumentReferences` /
  `useAddDocumentReferences`; effective-content resolution; materialise + snapshot-on-
  send helpers; defensive materialisation.
- `apps/user-client/src/data/knowledge.ts` — hook defensive materialisation into
  `deleteDocument` / `deleteLibraryCascade`.
- `apps/user-client/src/attachments/resolve-send.ts` & `wire-injection.ts` — resolve
  effective content for `library`-origin rows (likely no change if snapshot-on-send
  populates `text` before resolution; confirmed in the plan).
- `apps/user-client/src/state/stream-manager.store.ts` — snapshot-on-send before bind.
- `apps/user-client/src/components/lightbox/viewable-item.ts` — `library`-origin caps
  + live-content read + provenance.
- `apps/user-client/src/components/chat/Cockpit.tsx` — third menu item +
  `onAttachFromLibrary`.
- `apps/user-client/src/components/chat/InteractionMode.tsx` — thread prop + sheet
  exemption.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — render `DocumentPicker`,
  wire `onAttachFromLibrary`.
- `apps/user-client/src/data/queryKeys.ts` — any new query keys (e.g. documents per
  library already exist as `QK.documents`).

The plan orders tasks topologically over the import graph (data model → data layer →
picker → wiring → lightbox), each task verified against the full suite.
