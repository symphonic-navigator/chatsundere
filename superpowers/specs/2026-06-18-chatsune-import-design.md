# Chatsune Import — Design Spec

**Date:** 2026-06-18
**Author:** Liz (with Chris)
**Status:** Approved design, pending implementation plan
**Track:** Client-only (no backend; lives entirely in `apps/user-client`)

---

## 1. Context & Goal

Chatsune is end-of-life. It is not being switched off — users can still download
their data — but the migration path to Chatsundere must let them **carry their
conversations and personas across and keep going**. That is the whole point of
this feature: *"come to Chatsundere, your chats and your companions continue,
everything is fine."*

Chatsune produces two `.tar.gz` exports with a stable, explicitly-allowlisted
format (`manifest.json` carries `format` + `version`, currently `version: 1`):

- **Persona export** (`chatsune/persona`): `manifest.json`, `persona.json`,
  `profile_image.<ext>`, `sessions.json`, and — only when exported with content —
  `memory.json`, `artefacts.json`, `storage/`.
- **Knowledge export** (`chatsune/knowledge`): `manifest.json`, `library.json`,
  `documents.json`.

### Reality check: the code does not transfer, the format does

Chatsune's import is Python/MongoDB/`BlobStore`, server-side, per-module
`bulk_import_for_*` APIs. Chatsundere is a TypeScript client over Dexie/IndexedDB,
local-first, with **no existing import/export code**. The two share no code. What
we reuse is the **export format** — a clean, versioned contract — against which we
build a fresh TypeScript reader in the client.

---

## 2. Non-Goals (explicit)

- **No full persona reconstruction.** Model/provider, temperature, voice slots,
  MCP config, integrations — none of this is imported. Chatsune's models are not
  Chatsundere's offerings; the user picks a model in Chatsundere's UI.
- **No high-fidelity chat reconstruction.** Tool-calls, generated images,
  knowledge injections, attachments and artefacts are **not** imported (see §6,
  Tier A). They are replaced by a short per-message text hint. This is a deliberate
  choice to avoid the bug-prone edge cases of reconstructing app-specific pill
  payloads, and is acceptable because chatsune remains downloadable.
- **No ongoing sync.** Import is a **one-time migration snapshot per session**, not
  a live sync. Once a session is in Chatsundere, Chatsundere owns it (see §6.5).
- **No memory import yet** — the memory system does not exist in Chatsundere.
  Memories are deferred with a robust reminder mechanism (see §8).

---

## 3. Source Format Summary (chatsune)

### Persona export
- `manifest.json`: `{ format: "chatsune/persona", version: 1, exported_at,
  include_content, source_persona_name }`
- `persona.json` (allowlist): `name`, `tagline`, `system_prompt`, `nsfw`,
  `use_memory`, `colour_scheme`, `monogram`, `profile_crop {x, y, zoom, width,
  height}`, `has_avatar`
- `profile_image.<ext>`: binary avatar (png/jpg/webp/gif)
- `sessions.json`: `{ sessions: [{ original_id, session_fields, messages }] }`
  - `session_fields` (allowlist): `title`, `pinned`, `state`, `reasoning_override`,
    `tools_enabled`, `auto_read`, `knowledge_library_ids`, `context_*`,
    `created_at`, `updated_at`, `deleted_at`
  - `messages[]` (`ChatMessageDto`): `role` (`user`|`assistant`|`tool`), `content`
    (flat string), `thinking` (CoT, optional), `created_at`, `status`
    (`completed`|`aborted`|`refused`), `refusal_text`, plus rich fields we drop
    (`attachments`, `tool_calls`, `image_refs`, `knowledge_context`,
    `artefact_refs`, `events`, `web_search_context`, …)
- `memory.json` (deferred): `{ journal_entries[], memory_bodies[] }`

### Knowledge export
- `manifest.json`: `{ format: "chatsune/knowledge", version: 1, exported_at,
  source_library_name }`
- `library.json` (allowlist): `name`, `description`, `nsfw`, `default_refresh`
- `documents.json` (allowlist): `[{ title, content, media_type, trigger_phrases,
  refresh }]` — **no stable document or library IDs** in the export.

---

## 4. Target Model Summary (chatsundere, Dexie)

- `personas` (`PersonaRow`): `name`, `tagline`, `instructions`, `adultPersona`,
  `colour`, `font`, `providerId` + `modelId` (**required**, not imported), …
- `personaAvatars` (`PersonaAvatarRow`, 1:1): `blob` (WebP ≤512px), `mime`,
  `width`, `height`, `crop {x, y, zoom}`
- `chats` (`ChatRow`): `personaId`, `title`, `createdAt`, `lastMessageAt`,
  `libraryIds`, … (+ new `importedFrom`, see §9)
- `messages` (`MessageRow`): `role` (`user`|`persona`|`system`), `contentBlocks`
  (`text` | `pill` | `reasoning`), `createdAt`, `streamingState`, `bookmarked`
- `libraries` (`LibraryRow`): `name`, `description`, `nsfw`
- `documents` (`DocumentRow`): `libraryId`, `title`, `content`, `triggerPhrases`,
  `embeddingStatus`, `chunkCount`

Chat list is a one-shot TanStack query, **not** a Dexie live-query: any
`db.messages`/`db.chats` write must `invalidateQueries` for `['chats', …]` /
`QK.chats` after the import transaction commits.

---

## 5. Persona Import

### 5.1 Entry point (approach A)

Import lives **in the persona editor**, reachable both when creating a new persona
and when editing an existing one ("Import from Chatsune"). This single entry point
covers both flows:

- **New persona:** the editor is fresh; imported values fill it in.
- **Existing persona (merge):** the natural flow — *"I created Lumen, started
  chatting, ah right, I should import my chats."* Chats merge in; persona config is
  governed by the overwrite prompt (§5.4).

The file is chosen via a standard file input accepting the persona `.tar.gz`. After
parsing we land in the editor pre-filled, where the user picks the **model**
(resolving the required `providerId`/`modelId`) and can re-set or accept the
imported avatar before saving. On save, persona + avatar + all chats commit in a
**single Dexie transaction**.

### 5.2 Field mapping

| chatsune | chatsundere | Notes |
|---|---|---|
| `name` | `name` | direct |
| `tagline` | `tagline` | direct |
| `system_prompt` | `instructions` | direct (the "character CI") |
| `nsfw` | `adultPersona` | monotonic rule, §5.3 |
| `profile_image` + `profile_crop` | `personaAvatars` | converted, §5.5 |
| `use_memory` | — | deferred (§8) |
| `colour_scheme`, `monogram` | — | dropped (no equivalent; colour/font set in UI) |
| model, temperature, voice, MCP, … | — | not imported (non-goal) |

`providerId`/`modelId` are **not** satisfiable from the export, so the imported
persona cannot be saved until the user selects a model in the editor. This is by
design — the editor is the natural place for it.

### 5.3 NSFW rule (pinned — monotonic OR)

`adultPersona` can only **gain** capability on import, never lose it, and this is
**independent of the config-overwrite choice** (§5.4). NSFW is a capability/safety
flag, not a taste field: if the imported chats contain adult content, the persona
must be allowed to render it, otherwise the continued chat feels suddenly
neutered.

| Existing | Import | Overwrite choice | Result |
|---|---|---|---|
| false | true | (any) | **true** |
| true | false | (any) | **true** (never downgraded) |
| false | false | yes | false |
| true | true | (any) | true |

For a **new** persona, "existing" is `false`, so the result is simply the imported
value.

### 5.4 Merge & config-overwrite

- **Chats** always merge **additively** — new chat rows with fresh UUIDs; existing
  chats are untouched.
- **Config-overwrite prompt** ("Overwrite persona configuration with imported
  values?") appears **only** when importing into an existing persona whose values
  differ. It governs **`name`, `tagline`, `instructions`** only.
  - Yes → those three fields take the imported values.
  - No → existing config is kept; only chats merge.
- **Model is never overwritten** (not imported).
- **NSFW follows §5.3 regardless** of this choice.
- For a fresh persona there is nothing to overwrite, so no prompt is shown.

### 5.5 Avatar & crop conversion

The avatar **is** imported (the face is a companion's emotional anchor; losing it
on every migrated persona is a real downgrade). The format mismatch Chris feared is
dissolved by the existing `avatar-normalise.ts`, which already normalises any
input (png/jpg/webp/gif) to WebP ≤512px — exactly chatsune's export formats.

The two apps crop **differently**, so the crop is **converted**, not copied:

| | chatsune | chatsundere |
|---|---|---|
| Crop region | 220px **circle** on a 280px canvas | the **whole square** (`size×size`) |
| `x`/`y` | **pixel offset from canvas centre** | **fraction of box size**, from centre |
| `zoom` | multiplier on **natural size** (1 = unscaled) | multiplier on **cover-scale** (1 = covers box) |

Conversion (with `shortSide = min(profile_crop.width, profile_crop.height)`):

```
x_new    = profile_crop.x / 220
y_new    = profile_crop.y / 220
zoom_new = clamp(profile_crop.zoom * shortSide / 220, 1, 3)
```

The default chatsune framing maps **exactly** to chatsundere `zoom = 1` (the
initial-zoom formula `220/shortSide` cancels), so an untouched crop reproduces the
same view precisely. **Single edge case:** if the user zoomed *below* cover in
chatsune (whole non-square image with letterboxing), Chatsundere cannot represent
it (its minimum is "cover") → clamp to `zoom = 1`. Rare, and the crop tool is right
there in the editor for a nudge.

If `has_avatar` is false or no `profile_crop` is present, the avatar is skipped /
crop defaults to `{ x: 0, y: 0, zoom: 1 }`.

### 5.6 Idempotency (double-import protection)

Chatsune sessions carry a stable `original_id` (the old Mongo `_id`). On import we
record it on the chat row (`importedFrom`, §9). Re-importing the same file into the
same persona:

- Sessions whose `original_id` already exists **for this persona** are **skipped**.
- The preview states honestly: *"23 chats in the export — 20 new, 3 already
  imported (will be skipped)."*

This makes import idempotent: the same file twice does no harm. Dedup is scoped
**per persona** — importing the same export into two different personas is a
deliberate act and is not blocked.

---

## 6. Chat Import (Tier A)

### 6.1 Fidelity

Only the **continuable core** is imported: user text, persona text, and CoT.
Everything else is dropped and summarised in a per-message hint.

### 6.2 Message mapping

| chatsune | chatsundere | Notes |
|---|---|---|
| role `user` | role `user` | |
| role `assistant` | role `persona` | |
| role `tool` | — | **skipped entirely** (its activity is reflected by the hint on the assistant message) |
| `content` (string) | one `{ type: 'text', text }` block | |
| `thinking` (CoT) | one `{ type: 'reasoning', text }` block | only if present |
| `created_at` | `createdAt` | preserved verbatim |
| — | `streamingState` | always `'complete'` |
| — | `bookmarked` | always `false` |

**Refusals:** if `content` is empty but `status: 'refused'` with `refusal_text`,
use `refusal_text` as the text block (no loss of the visible text).

### 6.3 Dropped-content hint (per message)

When a message dropped non-text content (images, tool-calls, attachments,
artefacts, knowledge injections), append a small, recognisable note as a final text
line on **that** message, e.g.:

> *[2 images and 1 tool call from the original message were not imported.]*

A plain text message with no extras gets **no** hint. Per-message (not per-chat)
granularity is deliberate: the user sees exactly where something was, and knows
what to look up in chatsune if they ever want it.

### 6.4 Session → chat mapping

| chatsune `session_fields` | chatsundere `ChatRow` | Notes |
|---|---|---|
| `title` | `title` | |
| `created_at` | `createdAt` | verbatim |
| `updated_at` | `lastMessageAt` | verbatim |
| `original_id` | `importedFrom` | dedup key (§5.6) |
| `pinned`, `state`, `context_*`, … | — | dropped |
| `knowledge_library_ids` | — | dropped (libraries are a separate import; Tier A drops KB pills anyway) |

`deleted_at` sessions: **skipped** (not imported).

### 6.5 One-time snapshot, not sync (known limitation)

Dedup is at **session** level. If a user keeps chatting in chatsune in an
already-imported session and re-imports, the new tail does **not** come across —
the whole session is skipped. Message-level merge is explicitly rejected: once the
user continues a session in Chatsundere, the two copies have **diverged**, and
merging diverging tails is a conflict-resolution problem that reintroduces exactly
the complexity Tier A avoids.

Mental model: **import is a one-time migration snapshot per session.** Surfaced
honestly in the preview/help: *"Already-imported chats are skipped; finish your
migration before continuing elsewhere."* (If it ever becomes a real complaint — not
expected at EOL — the non-destructive answer is importing a *changed* session as a
**new** chat, post-alpha. Not built now.)

---

## 7. Knowledge Import

### 7.1 Entry point

A separate "Import from Chatsune" action in the **Libraries** view (knowledge is a
separate export in chatsune). Accepts the knowledge `.tar.gz`.

### 7.2 Mapping

| chatsune | chatsundere | Notes |
|---|---|---|
| `library.name` | `LibraryRow.name` | |
| `library.description` | `LibraryRow.description` | |
| `library.nsfw` | `LibraryRow.nsfw` | |
| `library.default_refresh` | — | dropped (no per-library refresh concept) |
| `document.title` | `DocumentRow.title` | |
| `document.content` | `DocumentRow.content` | |
| `document.trigger_phrases` | `DocumentRow.triggerPhrases` | |
| `document.media_type`, `document.refresh` | — | dropped (documents are always Markdown source) |
| — | `embeddingStatus` | `'pending'` |
| — | `chunkCount` | `0` |

### 7.3 Re-embedding

Documents land `embeddingStatus: 'pending'`; the **existing** embedding engine
picks them up and recomputes vectors locally (int4 codec). No new function — just a
trigger.

### 7.4 Always a new library (no dedup)

The knowledge export carries **no stable IDs** (neither library nor document), so
there is nothing to dedup on. Library import therefore **always creates a new
library**. Re-import yields a second library of the same name — visible, deletable,
no silent corruption. This deliberate asymmetry vs chat idempotency is justified:
the format gives us no anchor, and a name-based match is an unreliable bet (renames,
genuine duplicates). A valuable library is hand-built, hard work — nobody re-imports
one by accident, and if they do, the duplicate is obvious.

---

## 8. Memory Deferral & the "future-feature couplings" mechanism

The memory system does not exist yet. Memories must be imported **the moment it
does** — and Chris's standing concern is forgetting cross-feature obligations like
this. We introduce three coupled anchors so it cannot slip through, from three
directions.

### 8.1 Code tripwire (primary)

The persona importer already parses the tar. When it encounters `memory.json`, it
**counts** the entries and surfaces a calm user-facing note:

> *"This export contains 14 memories. Memory import arrives in a future update —
> re-import this file then to bring them across."*

A `FUTURE:` comment sits at that exact branch, linking to the register (§8.2). This
fires for **real users**, so it cannot be silently forgotten, and it documents
itself precisely where the future memory-import code will attach.

This is a complete, lossless deferral — **not** a lossy compromise — because chat
idempotency (§5.6) makes the "re-import later" path clean: on re-import the chats
are skipped and *only* the memories flow in. It also matches Chatsundere's
"every gap surfaces the next constructive step" tenet: the user hears *"your
memories are not lost, they're coming,"* rather than having them silently dropped.

### 8.2 New register: `obsidian/insights/future-feature-couplings.md`

A new, lightweight convention — distinct from `follow-ups-index` (tech debt) and
STATUS (current state). Format: *"When you build **X**, you must also do **Y**."*
First entry:

> **Memory system ⇒ extend the chatsune importer with memory import**
> (`memory.json`: `journal_entries[]` + `memory_bodies[]`; see the `FUTURE:`
> tripwire in the persona importer).

### 8.3 STATUS cross-link

The memory-gap line in `STATUS-CLIENT-ONLY.md` (read at every session start) gains
a pointer to the register entry — so whoever briefs the memory system sees the
obligation **before** starting.

---

## 9. Data Model Changes

- **`ChatRow.importedFrom?: string | null`** — chatsune `original_id` for imported
  chats; `null`/absent for natively-created chats. **Indexed** (dedup lookup scoped
  with `personaId`).
- **Dexie version bump** to add the `importedFrom` index. Current version is **26**;
  this feature takes the **next free version (tentatively 27)** — verify at
  implementation time that no parallel feature has claimed it (per the
  parallel-feature Dexie-version-ownership rule).

No other schema changes: avatars, libraries, documents reuse existing tables.

---

## 10. Implementation Notes

- **Archive reading in-browser:** gzip via `DecompressionStream('gzip')`; tar via a
  small parser (hand-rolled minimal reader or a tiny dependency — decided in the
  plan). No chatsune code is reused.
- **Two importers, shared low-level reader:** a common `readChatsuneArchive` (gunzip
  + untar → `{ manifest, files }`), then a persona-importer and a knowledge-importer
  on top. Each validates `manifest.format` against its expected value and rejects
  mismatches.
- **Where it lives:** new module under `apps/user-client/src/`, e.g.
  `lib/chatsune-import/` (reader + mappers) wired into the persona editor and
  libraries view.
- **Transactional:** the whole persona+avatar+chats write is one Dexie transaction
  (all-or-nothing); same for a library+documents write. Invalidate the relevant
  TanStack queries after commit.

---

## 11. Error Handling

- **Wrong format** (`manifest.format` not the expected `chatsune/persona` /
  `chatsune/knowledge`) → reject with a clear message ("This is a … export, not
  a … export").
- **Unknown/newer version** (`version > 1`) → refuse gracefully ("exported by a
  newer version of Chatsune than this importer understands").
- **Corrupt / non-archive file** → "Could not read this file — is it a Chatsune
  export?"
- **Partial / missing required member** (e.g. `persona.json` absent) → reject before
  writing anything; the transaction never opens.
- All failures leave the database untouched.

---

## 12. Testing

- **Pure functions (unit):** the crop conversion (§5.5) with known values incl. the
  zoom-clamp edge; the NSFW matrix (§5.3, all four rows); the dropped-content hint
  builder; the message/session mappers; the dedup filter (§5.6).
- **Reader:** gunzip+untar against a small fixture archive (a hand-built minimal
  `.tar.gz` checked into fixtures).
- **Integration (RTL):** import-into-new-persona and import-into-existing-persona
  (merge + overwrite + NSFW), idempotent re-import (skips), library import (new
  library, documents `pending`).
- Fixtures and assertions in British English. Full user-client vitest must remain
  at the known 8 Node-localStorage baseline.

---

## 13. Manual Verification (Chris, on device)

1. Export a real persona from chatsune; import into a **new** Chatsundere persona;
   pick a model; confirm name/tagline/instructions/NSFW, avatar framing, and that
   all chats are present and **continuable**.
2. Create a persona, chat a little, then import the same export → chats merge,
   overwrite prompt behaves, NSFW only upgrades.
3. Re-import the same file → preview reports "already imported", nothing duplicates.
4. Import a chat that had images/tool-calls → per-message hint appears on the right
   messages; plain messages have none.
5. Import a CoT-bearing chat → reasoning blocks render.
6. Import a knowledge library → new library, documents re-embed and become
   searchable.
7. Import a persona export that contains memories → the "memories coming soon" note
   appears with the correct count.
8. Feed a corrupt / wrong-format / newer-version file → graceful rejection, DB
   untouched.

---

## 14. Deferred / Out-of-Scope (tracked)

- **Memory import** — §8, gated on the memory system; tripwire + register +
  STATUS cross-link in place.
- **Re-import of a changed session as a new chat** — §6.5; only if it becomes a real
  complaint, post-alpha.
- **Tool-calls / images / attachments / artefacts** — Tier A non-goal; chatsune
  remains downloadable.
