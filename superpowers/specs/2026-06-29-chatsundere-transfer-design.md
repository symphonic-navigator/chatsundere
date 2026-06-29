# Chatsundere Transfer — native export & import (design)

**Date:** 2026-06-29
**Author:** Liz (with Chris)
**Status:** Draft — awaiting Chris's spec review, then Laura spec-pass, then plan.
**Scope:** `apps/user-client` only. Client-only; **not** a Larissa path (no
`apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, or
`packages/crypto` change). Laura spec-pass applies (new user-reachable flows).

---

## 1. Why

Chatsundere is being adopted faster than expected, and users want to move their
own data between devices and share it with each other. The existing
**Chatsune import** (`81cf6f1`) is a deliberate stop-gap bridge from the old
product — Tier A only (user/persona text + reasoning; tool-calls, images,
attachments, artefacts, KB-injections are dropped to text hints), because the
Chatsune wire format simply does not carry the richer data.

This feature is the **native** counterpart: a high-fidelity, **1:1**
export/import in Chatsundere's *own* format, exploiting the more capable
internal data structures. It is separate from the Chatsune bridge in both code
and file format. Two independent units travel: **a persona** (with its chats and
memory) and **a knowledge library**.

This is **not** sync. Real multi-device convergence arrives with the encrypted
backend (Block 6 / v0.3.0). This feature is a punctual, fully deterministic
file-in/file-out transfer.

## 2. Guiding principles (settled with Chris)

1. **Create-new only — never merge.** Every import produces a *new* persona or
   *new* library. Merge is deliberately out of scope, and not from laziness:
   from the user's point of view a merge is a non-deterministic black box that
   ends with broken personas lying around. We make no false promises. The user
   can knowingly hold two "Fable"s; we never silently fold one into another.
2. **100% deterministic, including from the user's seat.** A transient
   begin→end operation with no surprises. What you export is exactly what you
   re-import (modulo freshly-minted IDs and gracefully-degraded live bindings).
3. **Content travels 1:1; live-environment bindings degrade gracefully, never
   block.** Provider keys, MCP servers, library/mindspace references are
   device-local. They resolve if present on the target, otherwise fall back to
   unset/default — an import never fails because the target lacks them.
4. **Secrets never leave the device.** No provider, no `apiKey`, no
   `EncryptedBlob`, no sealed material appears in any export. Enforced by an
   invariant test (§9).
5. **Transient operations get no surface.** Export is an operation, not a place.
   It presents as a transient overlay reached from a `⋯` menu, runs begin→end,
   then disappears. (Surfaces are for places you navigate to and dwell in.)

## 3. File format

Two independent `.tar.gz` archives, same archive family as the Chatsune bridge
(reuse the existing decompression/format concepts; gzip via the browser-native
`CompressionStream('gzip')`). Each archive carries a `manifest.json` whose
`format` field drives **auto-detection** on import.

| Pack | `manifest.format` | `version` |
|---|---|---|
| Persona | `chatsundere/persona` | `1` |
| Library | `chatsundere/knowledge` | `1` |

Auto-detection: the importer reads `manifest.format`, branches on the prefix
(`chatsune/` → existing Tier-A bridge; `chatsundere/` → this feature), and on
the suffix (`persona` vs `knowledge`). A single import entry point per surface
handles **both** formats; no new "import Chatsundere" button.

Suggested download filenames: `<slug(personaName)>-chatsundere.tar.gz`,
`<slug(libraryName)>-chatsundere.tar.gz`.

### 3.1 New infrastructure

The only genuinely new low-level piece is a **tar writer** — the counterpart to
the existing `untar` reader (`lib/chatsune-import/archive-reader.ts`). It emits
ustar 512-byte-header records; ~50 lines, no new dependency. Everything else
mirrors the existing import code's structure.

## 4. Persona pack (`chatsundere/persona`)

### 4.1 Archive layout

```
manifest.json        format, version, exportedAt, appVersion,
                     included: { memory, artefacts, images },   // the three switches
                     source:   { personaName }
persona.json         exported PersonaRow (see §4.3)
avatar.<ext>         binary avatar blob (always, if the persona has one)
chats.json           ChatRow[]            (see §4.4)
messages.json        MessageRow[]         (contentBlocks intact: text/pill/reasoning)
pills.json           PillRow[]            (full payloads: tool-call/kb-injection/
                                           image-result/voice-expression)
attachments.json     AttachmentRow[] meta (text inline; image blob → blobs/, or placeholder)
artefacts.json       ArtefactRow[] meta   (text-kind content inline; image-kind → blobs/)
compactions.json     CompactionCheckpointRow[]    // decision A — see §4.5
memory.json          { journal: MemoryJournalRow[], bodies: MemoryBodyRow[] }  // if memory ON
blobs/<blobId>.<ext> binary image blobs                                        // if images ON
```

### 4.2 The three export switches

Defaults: **Memory ON · Artefacts ON · Images OFF.** Omakase — the valuable
small things travel by default; the heavy ones are opt-in. No live size
estimate (kept simple).

| Switch | Covers | Default | Off behaviour |
|---|---|---|---|
| **Memory** | `memoryJournal` (all states) + `memoryBody` (all versions) | ON | section omitted |
| **Artefacts** | text-kind artefacts (`html`/`markdown`/`code`/`svg`/`mermaid`) — a few kB | ON | those artefacts omitted |
| **Images** | heavy PNG/JPEG blobs: image-kind artefacts **+** image-kind attachments (uploaded *and* generated) | OFF | per affected message a lightweight placeholder ("Image not carried over in this transfer"); the row's metadata is kept, the blob is dropped |

The **avatar always travels** (it is identity, and small) — it is *not* an image
under the Images switch. The Images switch governs only in-chat/in-artefact
heavy blobs.

**Overlay legibility (Laura spec-pass).** Each switch carries an honest label so
the consequence is legible *before* download (don't-make-me-think; the
astonishment must not be deferred onto the importing user):

- **Memory** subtitle: "Your private memories from chats with this persona."
  This is the only signal for the share-vs-move tension (§1): the same button
  moves a persona to your own device *and* sends it to a friend, and Memory ON
  means the friend receives your extracted personal facts. Default stays ON
  (Chris's call — the valuable thing travels; the visible, honestly-labelled
  toggle is empowerment over nagging), but the label makes the consequence
  legible. The placeholder wording ("not carried over in this transfer") is
  written from the *importing* user's vantage, where it is actually read, so it
  never reads as corruption.
- **Images** subtitle: "Off: in-chat images become placeholders in the copy."
- The placeholder text itself ("Image not carried over in this transfer") is
  neutral and reads as a deliberate omission, not data loss.

### 4.3 `persona.json` — what is kept vs degraded

Kept 1:1: `name`, `tagline`, `instructions`, `canonicalId`, `colour`, `font`,
`temperature`, `adultPersona`, `chatsundereTonality`, `roleplay`, `narration`,
`greetingEnabled`, `greetingInstructions`, `voice`, `narratorVoice`,
`askExpertDefault`, `useMemory`, `memoryInstructions`.

Decision B — **live bindings degrade, never block:**

| Field | Export form | Import resolution |
|---|---|---|
| `providerId` + `modelId` | a **modelRef** `{ providerTemplateId, modelId }` (strings) — never the local row id, never the key | match a local provider of the same `templateId` → bind; else leave model **unset**, user picks |
| `mcpOverrides` | **dropped** | n/a (re-configure locally) |
| `libraryIds` | **dropped** | n/a (libraries import separately; a binding to an absent library is meaningless) |
| `lastInteractionAt` | reset on import (`createdAt`-fresh) | n/a |

`providerId` itself (the local UUID) and any provider/key material are **never**
written. A ProviderRow is never serialised.

### 4.4 `chats.json` / messages / pills / attachments

- **ChatRow**: keep `title`, `createdAt`, `lastMessageAt`,
  `bookmarkedMessageCount`, `openerPending`, `lastExtractedMessageId`,
  `activeCompactionId`, `compactionToastShown`. Drop `draftInput` (transient
  unsent text). `libraryIds` dropped (as §4.3). `resolvedMindspaceId`: kept as a
  reference; on import, if it resolves on the target → keep, else fall back to
  the default mindspace.
- **MessageRow**: `contentBlocks` kept intact (`text` / `pill` / `reasoning`).
  This is the headline fidelity gain over the Tier-A bridge.
- **PillRow**: full `payload` kept for every kind. An `image-result` pill whose
  payload references a blob follows the Images switch (blob in `blobs/` if ON,
  else the pill keeps its metadata and the blob ref resolves to the placeholder).
- **AttachmentRow**: `kind:'text'` → `text` inline (always). `kind:'image'` →
  blob in `blobs/` if Images ON, else dropped-with-placeholder. `state:'deleted'`
  attachments are not exported.

### 4.5 Compaction checkpoints (decision A)

`CompactionCheckpointRow[]` travel with the chat. They are cheap text
(`summaryMarkdown`) plus message-id references (`lastMessageIdBefore`,
`tailStartMessageId`, `prevCheckpointId`) — all remapped on import (§5). Without
them a long imported chat would behave differently (re-compact from scratch);
with them the chat is genuinely 1:1, including its sent-context state.

### 4.6 Import — persona

`chatsundere/persona` → **always a new persona**. Pre-import the user may edit
the target name; a **non-blocking, explanatory warning** shows if the name
already exists. The copy teaches the create-new model rather than implying an
error (Laura SOFT-2 — a bare "already exists" reads as a problem and sets a
merge expectation the product deliberately does not meet): e.g. *"You already
have a 'Fable'. Importing creates a second, separate one — nothing is merged or
overwritten."* (final wording Chris-arbitrated.)

On apply:

1. Mint a fresh `personaId` (UUIDv7). Write `persona.json` (degraded per §4.3),
   write the avatar via the existing `normaliseAvatar` + `useSetPersonaAvatar`
   path.
2. For each chat: fresh `chatId`, remap `personaId`. For each message: fresh
   `messageId`, remap `chatId`. For each pill: fresh `pillId`, remap `messageId`.
   For each attachment/artefact: fresh id, remap `chatId`/`messageId`. For each
   checkpoint: fresh id, remap message-id and `prevCheckpointId` references.
3. If Memory present: write `memoryJournal` + `memoryBody` rows with fresh ids
   and the new `personaId`.

All remapping is a single deterministic pass over an old→new id map.

### 4.6a Landing — where the user ends up (Laura HARD-1)

After writing the rows, **navigate the user into the persona-editor of the new
persona** — the same place the Chatsune import lands. This unifies the two
import experiences behind the one generalised "Import a persona" affordance (a
silent direct-write-then-list path would make the same button behave two
different ways — astonishment) and, crucially, dissolves the model-unset
dead-end: the editor's existing **"Choose a model" picker**
(`persona-editor.tsx:670`) and the **disabled-with-reason chat actions**
(`persona-editor.tsx:497–529`) are already in the user's face, so "pick a model
to start chatting" is self-evident, not discovered by trial.

On that landing, show **one calm, non-modal post-import note** that names what
did *not* travel (Laura SOFT-1) — grouping the model cue with the silently-
degraded live bindings (§4.3) so a carefully-bound persona doesn't quietly
behave differently with no explanation:

> *"Imported. Pick a model to start chatting. Library links and MCP settings
> don't transfer between devices — re-add them in this persona's settings."*

(Drop the model clause when a provider match *was* found and the model bound
automatically; drop the bindings clause when the source persona had none. Final
wording Chris-arbitrated.)

## 5. ID remapping (the determinism core)

Every export carries the *original* IDs purely so internal references stay
consistent inside the archive. On import we build one `Map<oldId, newId>`
covering personas, chats, messages, pills, attachments, artefacts, checkpoints,
memory rows, libraries, documents, and **vector ids**. Every foreign reference
is rewritten through the map. Because every id is freshly minted, **no DB-level
collision is ever possible** — "watch for ID collisions" reduces to "always
regenerate, always remap". The only user-facing collision is the **name**
warning.

## 6. Library pack (`chatsundere/knowledge`)

### 6.1 Archive layout

```
manifest.json   format, version, exportedAt, appVersion,
                embed: { modelId, dim, codecVersion },   // the adopt/re-embed guard
                source: { libraryName }
library.json    LibraryRow  (name, description, nsfw, timestamps)
documents.json  DocumentRow[]  (title, content, triggerPhrases, triggerOnCompanion, nsfw)
vectors.bin     concatenated serialised I4L EncodedVectors (fixed I4L_VECTOR_BYTES each)
vectors.json    [{ documentId, chunkIndex, headingPath, text, byteOffset, byteLength }]
```

No export switches — a library is pure text plus its tiny vectors.

### 6.2 Vectors: export, don't blindly re-embed (decision C)

Vectors are exported. They are **small** — `I4L_VECTOR_BYTES = 497` bytes per
chunk (a 2000-chunk library ≈ 1 MB, smaller than its own source text), so the
earlier "too big" worry was wrong. Re-embedding on import, by contrast, imposes
real cost: model load (and possibly a model *download*) plus ~0.9–7 s **per
chunk**, and risks cross-dtype query/document mismatch (q4f16 vs int8 inference)
— both contrary to the friction-free + deterministic principles.

We guard the one real risk (a future model or codec change) deterministically:

- The manifest stamps `embed: { modelId: MODEL_ID, dim: EMBED_DIM,
  codecVersion: CODEC_VERSION }` (`packages/embeddings`:
  `MODEL_ID='Snowflake/snowflake-arctic-embed-m-v2.0'`, `EMBED_DIM=768`,
  `CODEC_VERSION=1`).
- On import, a **pure function** decides strategy:

  ```ts
  resolveVectorStrategy(
    manifest: { modelId: string; dim: number; codecVersion: number },
    engine:   { modelId: string; dim: number; codecVersion: number },
  ): 'adopt' | 'reembed'
  ```

  Equal on all three → `adopt`; otherwise → `reembed`. Zero side effects,
  100% unit-testable.
- **adopt**: remap each vector's `id` (`` `${newDocId}#${chunkIndex}` ``) and
  `tags` (`{ libraryId: newLibId, documentId: newDocId }`), then write the
  vectors straight into the knowledge vector store — **no model call** — and set
  `embeddingStatus='ready'`. (Decode→`store.upsert` is the simplest faithful
  path: the I4L codec round-trips deterministically, so decode-then-upsert
  reproduces the same codes while still passing through the store's budget
  accounting.)
- **reembed**: ignore `vectors.bin`, set `embeddingStatus='pending'`, and
  `enqueueDocument(newDocId)` — the existing, device-tested ingestion path.

Per Chris: the only "real world" side effect is the model call, which is the
known-good existing path; everything around it (the strategy decision, id/tag
remap, adopt-write) is pure and fully unit-coverable. This permanently neutral-
ises the model/codec-drift risk we cannot currently test against.

### 6.3 Import — library

`chatsundere/knowledge` → **always a new library**. Name editable pre-import,
non-blocking **explanatory** name-collision warning (same create-new framing as
§4.6 — "creates a second, separate one; nothing is merged"). Fresh `libraryId`;
each document gets a fresh `documentId`; vectors adopted or re-embedded per
§6.2. On completion, a toast confirms the import.

## 7. UI / entry points

### 7.1 Export — transient `⋯` overlay

- **Persona**: a "Export" item in the persona's `⋯` menu opens a small transient
  overlay: the three honestly-labelled switches (Memory / Artefacts / Images,
  §4.2) + an "Export" button. On confirm: build the archive, trigger a browser
  download, close, and show a completion toast ("Persona exported").
- **Library**: an "Export" item in the library-detail `⋯` menu **triggers the
  download immediately** + a completion toast ("Library exported") — **no
  confirm overlay** (Laura SOFT-5). A dialog whose only choice is "yes" is pure
  friction; a confirm step earns its keep only when there is a choice or a
  destructive consequence, and an export is neither. The asymmetry with the
  persona overlay is justified and unsurprising: the overlay exists *because*
  the persona export has three choices; the library export has none.

Both export paths end in a **completion toast** — a file silently appearing in
Downloads with no acknowledgement is its own small astonishment.

Reuse the makeover primitives: `OverflowMenu` for the trigger, a lightweight
overlay (`ConfirmDialog`/`ReadingOverlay`-style transient shell) for the persona
body, `Button` tones, the existing toast mechanism. No `PageScaffold` — export
is not a surface.

### 7.2 Import — auto-detect at existing entries

- **Persona**: the existing persona-editor import affordance (today "Coming from
  Chatsune?") generalises (e.g. "Import a persona") and auto-detects. A
  `chatsundere/persona` file always takes the create-new path.
- **Library**: the existing knowledge-list `⋯` "Import library" generalises and
  auto-detects.

Both keep the existing preview→apply shape (show what will be imported, let the
user confirm/rename).

## 8. Modules (mirrors the existing import code)

```
lib/archive/tar-write.ts                tar(ustar) writer + gzip helper (counterpart to archive-reader)
lib/chatsundere-transfer/manifest.ts    manifest types + format/version constants + detection helpers
lib/chatsundere-transfer/persona-pack.ts   write/read the persona archive ↔ typed payloads
lib/chatsundere-transfer/knowledge-pack.ts write/read the library archive ↔ typed payloads
lib/chatsundere-transfer/vector-strategy.ts resolveVectorStrategy (pure)
lib/chatsundere-transfer/id-remap.ts       the old→new id map + reference rewriters (pure)
data/chatsundere-export.ts              gather rows from Dexie → persona/knowledge payloads → archive Blob
data/chatsundere-import.ts              parse archive → remap → write rows (create-new)
components/.../ExportOverlay.tsx         the transient export overlay (persona + library variants)
```

Import entry-point changes: the persona-editor import control and the
knowledge-list import handler gain the `manifest.format` branch (Chatsune vs
Chatsundere). No new Dexie version, **no schema change** (only existing tables
are written) — avoids the verno-assertion sweep.

## 9. Testing

Backend-free, all in the user-client Vitest suite.

- **Round-trip (the core test):** build a persona with chats (text + reasoning +
  pills + a text attachment), memory, and a text artefact → export → import →
  assert structural equality modulo new IDs and dropped live-bindings.
- **tar writer ↔ reader round-trip:** bytes in === bytes out across the existing
  `untar` and the new writer.
- **ID-remap integrity:** every foreign reference in the imported graph points
  to a freshly-minted local id; no original id survives.
- **`resolveVectorStrategy`:** adopt on exact match; reembed on any of
  modelId/dim/codecVersion mismatch.
- **Vector adopt path:** decode→upsert reproduces equivalent codes; ids/tags
  remapped; `embeddingStatus='ready'` without a model call (engine mocked to
  throw if invoked).
- **Images-OFF placeholder:** an image attachment/artefact exports as a
  placeholder; the message stays readable; no blob bytes in the archive.
- **Security invariant:** no ProviderRow / `apiKey` / `EncryptedBlob` bytes
  appear in any produced archive (assert over the raw archive bytes).
- **Degradation:** import with no matching provider → model unset, import
  succeeds; `resolvedMindspaceId` absent on target → default; dropped
  mcpOverrides/libraryIds.
- **Name-collision warning:** surfaced, non-blocking, and explanatory (create-
  new framing, not an error).
- **Post-import landing (Laura HARD-1):** a Chatsundere persona import navigates
  into the new persona's editor; the post-import note's model clause appears
  only when the model is unset and the bindings clause only when the source had
  mcpOverrides/libraryIds.
- **Completion toasts:** persona and library export each emit a completion
  toast; library import emits one.

Manual verification (device, Chris): export Fable (images off) → import on a
fresh-state client → chat history, reasoning, memory, avatar all present; model
prompts for selection; library export with vectors → import adopts instantly
(no embedding spinner).

## 10. Out of scope

- **Merge** into an existing persona/library (deliberate, permanent — see §2.1).
- **Sync** / multi-device convergence (Block 6 / backend).
- **Provider/key transfer** (never — secrets stay on device).
- Exporting the embedding **model** itself (re-embed fallback covers drift).
- A live export-size estimate.

## 11. Open questions

- **Resolved (Laura spec-pass):** library export micro-flow → immediate download
  + toast, no confirm overlay (§7.1). Persona-import landing → into the
  persona-editor of the new persona (§4.6a).
- **Chris-arbitrated copy** (settle at build, not blocking): the generalised
  import-affordance labels; the exact name-collision warning wording (§4.6); the
  post-import note wording (§4.6a); the toggle subtitles (§4.2).
