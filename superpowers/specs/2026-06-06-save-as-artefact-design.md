# Save as Artefact (Artefact Chunk 4) — Design

> **Block 2 (→ v0.1.0), client-only.** Chunk 4 of the artefact system. Read
> [[../../obsidian/ARTEFACTS-FEATURE-STATUS]] for the decision log and the wider
> feature shape; this spec covers only Chunk 4.

**Status:** approved (brainstormed with Chris 2026-06-06).
**Side:** client-only — no auth/sync/proxy/crypto, so no Larissa gate (see §8).

---

## 1. Goal

Let the user lift existing content out of a conversation into a first-class,
reusable artefact, via two sibling entry points:

- **Save message as artefact** — the visible answer text of any message
  (either role) becomes a Markdown artefact.
- **Save code block as artefact** — a fenced code block (or a Mermaid diagram)
  becomes an artefact whose format derives from the fence language.

This makes artefacts first-class beyond AI generation (Chunk 1): the universal
fallback paths that work even for models we would not curate for tool calling
(decision log #13). The content already exists in the message, so — unlike the
Kern — there is **no author-subagent inference**; this is purely UI entry points
plus two persist functions.

---

## 2. Decisions carried in (from the brainstorm)

1. **Save flow = one-tap, then rename in the lightbox.** Tapping saves
   immediately with a sensible default title; a `success` toast confirms; the
   artefact appears in the chat's artefact sidebar at once. Renaming and tagging
   happen afterwards in the lightbox/Treasury — exactly like a generated
   artefact. No pre-save sheet.
2. **`html` code blocks save as renderable HTML artefacts.** A ```` ```html ````
   block → `format: 'html'`, previewable in the lightbox's hard-sandboxed
   iframe (same posture as Chunk 1 — null origin, `default-src 'none'`, no
   network). ```` ```svg ```` → `'svg'`, Mermaid → `'mermaid'`; every other
   language → `'code'`.
3. **Message content = the visible answer text only.** All `text` ContentBlocks
   concatenated; `reasoning` (thinking trace) and `pill` (tool calls) are
   excluded — they are not reusable prose.
4. **Save button scope = code blocks with a recognised language + Mermaid.**
   Language-less fences, inline code, and LaTeX get no button.
5. **Disabled over hidden (§11).** The message save control is always present in
   `MessageControls`; it is *disabled with a tooltip* when the message has no
   text block, never hidden.
6. **No provenance link.** `sourceMessageId` was deliberately dropped from the
   built schema at the Kern; it stays out. A saved artefact is decoupled from
   its source message (mirrors decision log #2's copy-not-reference posture).

---

## 3. Data model

**No Dexie migration.** The `artefacts` table (v13) already carries every field
needed: `ArtefactOrigin` includes `'saved-message'` and `'saved-code-block'`;
`ArtefactFormat` includes `'markdown'` and `'code'`. `personaId` is always the
**chat's persona** (provenance), even when saving a user-authored message.

### New functions in `data/artefacts.ts`

Both mirror the existing `addGeneratedArtefact` (insert a row, return its id) and
both invalidate `QK.chatArtefacts(chatId)` plus the `['artefacts']` prefix
(Treasury), so the sidebar and Treasury stay live.

```ts
interface AddSavedMessageArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  content: string; // concatenated visible text blocks
}
// origin 'saved-message', kind 'text', format 'markdown',
// fileName `${slugify(title)}.md`, mime 'text/markdown'

interface AddSavedCodeBlockArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  content: string; // raw code
  lang: string;    // fence language token, e.g. 'python', 'html', 'mermaid'
}
// origin 'saved-code-block', kind 'text',
// format/mime/extension derived from `lang` via fenceToArtefactMeta (§4),
// fileName `${slugify(title)}.${ext}`
```

A React mutation hook per function (e.g. `useSaveMessageArtefact(chatId)` /
`useSaveCodeBlockArtefact(chatId)`) following the existing hook pattern, so the
UI invalidates consistently.

---

## 4. Language → artefact metadata (new pure helper)

`lib/fence-to-artefact.ts`:

```ts
interface FenceArtefactMeta {
  format: ArtefactFormat; // 'html' | 'svg' | 'mermaid' | 'code'
  mime: string;
  ext: string;            // without leading dot
}
function fenceToArtefactMeta(lang: string): FenceArtefactMeta;
```

Rules:

- **Format:** `html → 'html'`, `svg → 'svg'`, `mermaid → 'mermaid'`, everything
  else → `'code'`. (No `markdown` here — that is the message path.)
- **MIME:** `text/html` for html, `image/svg+xml` for svg, `text/plain` for
  Mermaid and for generic code. (MIME is secondary — the lightbox's
  `detectFormat` prefers the extension; MIME is only its tiebreaker.)
- **Extension:** a small alias map for tokens whose extension differs from the
  token (`python→py`, `typescript→ts`, `javascript→js`, `rust→rs`, `csharp→cs`,
  `ruby→rb`, `bash`/`sh→sh`, `mermaid→mmd`, …). Fallback = the fence token
  itself when it is already a sane extension (`zig→zig`, `html→html`,
  `css→css`); last-resort fallback `txt`.

This is the inverse of the lightbox's existing `LANG_BY_EXT` (`format-detect.ts`)
and keeps a single source of truth: a saved code block round-trips to the same
preview renderer `detectFormat` would pick from its `fileName`.

Pure and fully unit-tested (the mapping, every fallback branch).

---

## 5. UI entry points

### 5.1 Message save (`MessageControls.tsx`)

A new control beside Branch / Copy / Bookmark (both roles):

- Label/glyph in keeping with the existing controls (e.g. `◆ Save`).
- `onClick` → `useSaveMessageArtefact`, building `content` from the message's
  `text` ContentBlocks concatenated (`reasoning`/`pill` excluded), and a default
  title from §6.
- `disabled` with a tooltip ("No text to save") when the message has no text
  block. `MessageBlock` already owns the message + chat/persona context and
  wires the other controls, so it computes the text content and the disabled
  flag and passes the handler down.

### 5.2 Code block save (`CodeBlock.tsx`, `MermaidBlock.tsx`)

A second button beside the existing `CopyButton`, same chrome (e.g. a small
`Save` next to `Copy`):

- `CodeBlock` already receives `codeStr` + `lang`; `MermaidBlock` receives the
  code and uses `lang: 'mermaid'`.
- The blocks need `chatId` + `personaId`. To avoid widening the
  `MarkdownContent` → markdown-components → block signature for every block, a
  small **React context** (`ArtefactSaveContext`, provided by `MessageBlock`
  around its `MarkdownContent`) carries `{ chatId, personaId }` and a
  `saveCodeBlock` callback. Blocks that need it consume the context; blocks that
  do not are unchanged. When the context is absent (e.g. markdown rendered
  outside a chat message — the lightbox doc preview), the save button is simply
  not rendered.
- Default title from §6; format/extension from `fenceToArtefactMeta(lang)`.

---

## 6. Default titles and feedback

- **Message:** first ~50 characters of the concatenated text, whitespace
  collapsed to single spaces, trimmed, with a trailing `…` when truncated.
- **Code block:** first non-empty line of the code, trimmed, ≤50 characters;
  fallback `«lang» snippet` (e.g. `python snippet`) when the code is empty or
  has no meaningful first line.
- **Feedback:** on success, `toastStore.show({ tone: 'success', message: 'Saved
  «title»', durationMs: 2500 })`. The artefact appears immediately in the chat's
  artefact sidebar (query invalidation). The toast has no action button — the
  toast system does not support one, and adding one is out of scope (the
  sidebar/Treasury is the open path). On failure, an `info`/`warn` toast with a
  constructive message.

Title heuristics live in small pure helpers (`messageSnippetTitle(text)` /
`codeSnippetTitle(code, lang)`) so they are unit-testable.

---

## 7. Testing

TDD per task (Bun is backend; this is user-client → **Vitest**):

- `fence-to-artefact` — format + MIME + extension for html/svg/mermaid/known
  code/unknown code, and every fallback branch.
- title helpers — truncation, whitespace collapse, empty-line fallback.
- `addSavedMessageArtefact` / `addSavedCodeBlockArtefact` — row shape, origin,
  format derivation, fileName, query invalidation.
- `MessageControls` — save disabled when no text block; enabled otherwise;
  handler called with concatenated text.
- code-block / Mermaid save button — present with a recognised language, absent
  without the context, correct `lang` passed.

Full verification gate: `pnpm typecheck`, `pnpm run build`, the **full**
user-client Vitest suite (per the per-task-review-runs-full-suite lesson), and
biome clean.

---

## 8. Security

Client-only, so no Larissa gate. **No new execution or network surface:** a
saved `html` code block is previewed by the *same* hard-sandboxed `HtmlPreview`
iframe that Chunk 1 already ships (null origin, `default-src 'none'`, no external
network). We persist model- or user-authored HTML, but the rendering control is
unchanged and already logged in [[../../obsidian/insights/security-deferrals]]
for the Kern. No new entry to add beyond a note that save-as-artefact is another
producer of the already-logged persisted-HTML surface.

---

## 9. Out of scope (YAGNI)

- A pre-save sheet (one-tap + lightbox rename covers it).
- A tap-to-open action on the toast (the toast system has no action button).
- Saving language-less fences, inline code, or LaTeX.
- `sourceMessageId` provenance (deliberately absent from the schema).
- `read_artefact` and `edit_artefact` (other chunks).

---

## 10. Manual verification (Chris, on device)

1. Save a persona message with prose → a Markdown artefact appears in the
   sidebar; the toast confirms; open it in the lightbox → renders as a doc.
2. Save a user-authored message → saved under the chat's persona.
3. A message that is only a tool-call pill (no text) → the Save control is
   disabled with a tooltip, not hidden.
4. Save a ```` ```python ```` block → `code` artefact, `.py`, syntax-highlighted
   preview; title defaults to the first code line.
5. Save a ```` ```html ```` block → `html` artefact, renders live in the
   sandboxed iframe.
6. Save a Mermaid diagram → `mermaid` artefact, renders as a diagram.
7. A saved artefact survives deleting nothing it depends on; renaming/tagging in
   the lightbox works as for a generated artefact.
