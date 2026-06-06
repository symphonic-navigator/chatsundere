# Lightbox Viewer — Design Spec

**Date:** 2026-06-06
**Author:** Liz (brainstormed end-to-end with Chris)
**Scope:** Client-only (`apps/user-client`). No auth/sync/proxy/crypto path — not a Larissa gate.
**Branch:** `worktree-lightbox-viewer` (isolated worktree; Chris is device-testing chat on `master`).

---

## 1. Context & Goal

The unified lightbox (`987c885`) already renders `image | text | markdown` items, has a
working FLIP open-zoom from the click origin, loop navigation, and a Preview/Source toggle.
It was deliberately built as the seam the future artefact feature plugs into.

This work brings two things, both **viewer-only** (artefact *generation* is a separate,
later scope Chris wants to do cleanly afterwards):

- **(a)** Port chatsune's artefact-view *rendering capabilities* into the lightbox: standalone
  format viewers (a whole file rendered as Code / HTML / SVG / Mermaid), the document-grade
  Markdown styling Chris loved, and the "how it works" chrome (format-override picker, copy,
  download).
- **(b)** Complete the claude.ai-style zoom: the open-zoom exists; add the **symmetric
  close-zoom** back to the origin, with a re-measure at close time and a downward fall-back
  when the origin has scrolled away.

### Non-goals (this session)

- **JSX / React single-page-app preview.** Deferred — see §11. chatsune loaded React + Babel
  from `unpkg.com` (a third-party CDN), which violates Hard Rule #1 (zero-knowledge) and the
  IP-leak posture behind the Markdown `<img>` fix. JSX/SPA belongs to the artefact-generation
  work and will be done with a locally-bundled transpiler + a hard-sandboxed iframe.
- Artefact *generation* (LLM produces artefacts, artefact store, in-stream cards, version
  history, sidebar). Separate scope.
- Touching the chat bubbles. Copy-on-codeblock and collapsible code land **only** in the
  lightbox document renderer this session.

---

## 2. Decisions (from the brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Session scope | Viewer only; artefact generation is a separate later scope |
| 2 | JSX/SPA | Deferred to artefact-generation (CDN approach rejected on zero-knowledge grounds) |
| 3 | Standalone viewers to build | Code (Shiki), HTML (sandbox), SVG, Mermaid |
| 4 | Markdown styling | Port chatsune's document-grade craft, **re-tinted to the Aurora palette** (not gold) |
| 5 | Chrome | Format-override picker (also shows the detected format), Copy, Download; Rename + Preview/Source stay |
| 6 | Dropdown styling | Custom dropdown modelled on `PersonaFilterDropdown` — no native `<select>` |
| 7 | Close animation | Re-measure the origin at close; visible → zoom back; scrolled-away/detached → zoom downward + fade |
| 8 | Copy/collapse on code blocks | Lightbox document renderer only this session (chat untouched) |

---

## 3. Architecture — format derived from the file, not from `kind`

The stored `AttachmentRow.kind` stays `image | text`. For text-kind items the lightbox derives
a **preview format** from the filename + MIME via a pure, testable function:

```ts
// lightbox/format-detect.ts
export type PreviewFormat = 'markdown' | 'code' | 'html' | 'svg' | 'mermaid' | 'plain';
export function detectFormat(fileName: string, mime: string): PreviewFormat;
```

Rules (extension first, MIME as tiebreaker):
- `.md`, `.markdown` → `markdown`
- `.svg` (or `image/svg+xml`) → `svg`
- `.html`, `.htm` (or `text/html`) → `html`
- `.mmd`, `.mermaid` → `mermaid`
- a recognised code extension (`.ts/.tsx/.js/.jsx/.py/.rs/.go/.java/.c/.h/.cpp/.cs/.rb/.php/.sh/.css/.xml/.sql/.json/.yaml/.yml/.toml/.ini/.log` …) → `code`
- otherwise → `plain`

This mirrors chatsune's `detectPreviewType` but is **source-based** (the upload's real
extension) rather than parsing an LLM's label. The mapping from extension → Shiki language id
lives alongside it (`extensionToLang`).

The lightbox body dispatch becomes:

```
kind === 'image'  → ImagePreview (unchanged <img>)
kind === 'text'   → effectiveFormat = override ?? detectFormat(fileName, mime)
                    markdown → MarkdownDoc
                    code     → CodePreview
                    html     → HtmlPreview
                    svg      → SvgPreview
                    mermaid  → MermaidPreview
                    plain    → PlainPreview (<pre>)
```

`override` is the user's pick from the format dropdown (§6); it falls back to detection.

### `ViewableItem` / `Caps` changes

`viewable-item.ts`:
- Add `mime: string` to `ViewableItem` (needed for detection + download).
- Keep `kind` as today; **drop** the eager `'markdown'` kind collapse — the viewer now derives
  the format itself, so `attachmentToViewable` sets `kind: row.kind` (`image | text`) and the
  body computes the format. (Markdown items therefore flow as `text` + detected `markdown`.)
- `Caps`: `copy` and `download` become `true` for upload-origin items too (were generated-only).
  `editSource` unchanged (text + pending). Add `copy: boolean`.

---

## 4. The viewers (`lightbox/previews/`)

One small component per format; each fills the existing `.lightbox-body` and reuses its
scroll styling.

- **`MarkdownDoc.tsx`** — wraps our existing `MarkdownContent` (chat renderer: GFM, KaTeX via
  `rehype-katex` + `preprocessMath`, Mermaid, Shiki) in a new `.lightbox-doc` container that
  carries the document-grade Aurora typography (§7). No new markdown pipeline — we already have
  parity; this is a styling container + the doc variant of code blocks.
- **`CodePreview.tsx`** — Shiki `codeToHtml(content, { lang, theme: 'github-dark-dimmed' })`
  via the existing lazy `useHighlighter()`; language from `extensionToLang`. Fallback to escaped
  `<pre><code>` until the highlighter resolves (existing pattern). Copy button + collapsible at
  >15 lines (lightbox-scoped).
- **`HtmlPreview.tsx`** — `<iframe srcDoc sandbox="allow-scripts">` **without**
  `allow-same-origin`. Injects: (1) a strict CSP `<meta>` that blocks all network
  (`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'`),
  (2) Aurora scrollbar CSS, (3) an Escape-key `postMessage('lightbox-escape')` script the
  lightbox listens for. See §8.
- **`SvgPreview.tsx`** — render via `data:image/svg+xml;base64,<utf8-safe base64>` in an `<img>`
  (image context does not execute embedded scripts). Centered, aspect-preserving.
- **`MermaidPreview.tsx`** — the existing lazy mermaid path, whole file as one diagram, dark
  theme, with the error card on parse failure.
- **`PlainPreview.tsx`** — `<pre>` monospace (today's plain-text body).

`LightboxTextBody.tsx` is refactored into this dispatch + the Preview/Source toggle. Source
view stays the raw text (editable only when `caps.editSource`).

---

## 5. Chrome — "how it works"

Added to the existing toolbar (filename, rename, Preview/Source, nav, close):
- **Format-override picker** — custom dropdown (§6). Shows the current effective format and lets
  the user force any of the text formats. Only shown for `kind === 'text'`. This is also the
  forward-seam for the artefact era (LLMs mislabel formats).
- **Copy** — copies the raw content (code/markdown/text/svg/html source) to the clipboard with a
  1.5 s "Copied" confirmation. Plus a copy button on each code block inside the Markdown doc
  renderer (lightbox-scoped).
- **Download** — downloads the content as a file with the correct extension (a small
  `formatToExtension` / filename-preserving helper). Uses a Blob + object-URL, revoked after click.

`caps.copy`/`caps.download` are `true` for both upload and generated origins now.

---

## 6. Custom format dropdown

Modelled on `apps/user-client/src/components/history/PersonaFilterDropdown.tsx`: a `<button>`
trigger with a chevron (`data-open` rotation) + an absolutely-positioned list of `<button>`
options with `data-selected`, closing on outside-pointerdown and Escape. New component
`lightbox/FormatPicker.tsx` with Aurora-tinted classes (`.lightbox-format-*`) added to
`index.css`. We do **not** generalise `PersonaFilterDropdown` into a shared primitive this
session (YAGNI; mirror the proven structure).

---

## 7. Styling — document-grade Markdown in Aurora

New `.lightbox-doc` block in `apps/user-client/src/index.css`, porting chatsune's craft:
line-height ~1.7, generous block spacing, code-surface treatment, table styling
(header underline, row hover), blockquote with an accent left-border, list spacing, checkbox
accent, and KaTeX display styling (`.katex-display` margins, `overflow-x:auto`, inherited
colour). **Palette is Aurora**: `--font-display` (Instrument Serif) headings, accent-lilac/
purple for headings/links/table-headers/blockquote-border (the project's existing tokens), not
chatsune's gold. The chat bubble Markdown styling is untouched.

---

## 8. Security

Client-only, no Larissa gate — but logged in `obsidian/insights/security-deferrals.md` as the
new iframe-exec/outbound surface, consistent with prior practice.

- **HTML preview**: `sandbox="allow-scripts"` with **no** `allow-same-origin` → the iframe runs
  at a null origin and cannot read cookies, `localStorage`, or IndexedDB (where the MasterKey and
  ciphertext live). A strict CSP `<meta>` (`default-src 'none'`, allow only inline style/script
  and `data:` images) blocks all external network requests → no phone-home / IP-leak / tracking
  from previewed HTML. Self-contained HTML renders; anything reaching out is blocked.
- **SVG preview**: rendered as an `<img>` `data:` URI; the image context does not execute
  embedded `<script>` — safe.
- **Escape bridge**: the iframe posts `{type:'lightbox-escape'}`; the lightbox validates
  `event.data?.type` before acting (no origin trust needed — it's an action trigger, not data).

---

## 9. Close animation (Part b)

**API change:** the lightbox receives `getOriginRect: (id: string) => DOMRect | null` instead of
a static `originRect`. The caller resolves it via `document.querySelector('[data-attachment-thumb="<id>"]')?.getBoundingClientRect()`.
A `data-attachment-thumb={row.id}` attribute is added to the thumb button in `AttachmentThumb`.
This works uniformly for the stream (`MessageBlock`) and the cockpit, and the thumbs stay mounted
because the lightbox is a `body` portal.

- **Open**: at mount, `getOriginRect(currentItemId)` gives the start rect for the existing FLIP.
- **Close**: on Escape / backdrop / close-button:
  1. Enter a `closing` state (do not unmount yet).
  2. `rect = getOriginRect(currentItemId)`.
  3. If `rect` is non-null and **on-screen** (intersects the viewport) → reverse-FLIP: animate
     the surface to `translate/scale` onto `rect`, opacity → 0.
  4. Else (scrolled away / detached / returns zeros) → **zoom downward**: translate to a small
     rect centred horizontally below the viewport, scale down, opacity → 0.
  5. Call the real `onClose` on `transitionend` (with a timeout fallback equal to the duration).
- **Reduced motion**: skip the transform, unmount immediately (or instant CSS fade).
- Duration 220 ms, symmetric with the open. After loop-navigation the close targets the
  **current** item's thumb (by id), not the originally-clicked one.

---

## 10. Upload classification additions

`apps/user-client/src/attachments/file-classify.ts`:
- Accept `.svg` (MIME `image/svg+xml`) and `.mmd`/`.mermaid` as **text** (SVG is XML text; this
  keeps it editable in the Source tab and renderable via the SVG `<img>` path).
- Mirror the additions in the picker `accept` attribute in `Cockpit.tsx`.

SVG remains stored as `kind: 'text'` with `mime: image/svg+xml`; the viewer detects `svg` from
the extension/MIME and renders it as an image.

---

## 11. Deferred / follow-ups

- **JSX / SPA preview — REMINDER (Chris's explicit ask).** Belongs to the artefact-generation
  work; for many users it is core functionality (build a concept quickly, demo it, try it — "gold").
  Must be done with a **locally-bundled** transpiler (sucrase or esbuild-wasm, lazy-loaded) and
  React from our own deps, inlined into a hard-sandboxed (`allow-scripts`, no `same-origin`)
  iframe — **never** a third-party CDN. Recorded in both `security-deferrals.md` and
  `follow-ups-index.md`.
- Generalising the dropdown into a shared primitive (only if a third consumer appears).
- Copy/collapse on code blocks in the chat bubbles (only if Chris wants it there later).

---

## 12. File plan

**New**
- `lightbox/format-detect.ts` — `detectFormat`, `extensionToLang`, `formatToExtension`
- `lightbox/previews/MarkdownDoc.tsx`
- `lightbox/previews/CodePreview.tsx`
- `lightbox/previews/HtmlPreview.tsx`
- `lightbox/previews/SvgPreview.tsx`
- `lightbox/previews/MermaidPreview.tsx`
- `lightbox/previews/PlainPreview.tsx`
- `lightbox/FormatPicker.tsx`
- `lightbox/lightbox-actions.ts` — copy + download helpers
- code-block copy/collapse helpers for the doc renderer

**Modified**
- `lightbox/viewable-item.ts` — `mime`, `Caps.copy`, caps for uploads, drop eager markdown kind
- `lightbox/Lightbox.tsx` — `getOriginRect` API, close animation, format dispatch, chrome wiring
- `lightbox/LightboxTextBody.tsx` — refactor into format dispatch + Preview/Source
- `components/chat/AttachmentThumb.tsx` — `data-attachment-thumb={id}`; onOpen still gives index
- `components/chat/AttachmentStrip.tsx`, `MessageBlock.tsx`, `Cockpit.tsx` — pass `getOriginRect`
- `attachments/file-classify.ts` + `Cockpit.tsx` accept — `.svg/.mmd/.mermaid`
- `index.css` — `.lightbox-doc` (Aurora doc styling), `.lightbox-format-*` (dropdown)

---

## 13. Testing

**Vitest (pure + component):**
- `format-detect`: extension/MIME → format; extension → lang; format → extension.
- `file-classify`: `.svg/.mmd/.mermaid` now accepted as text; existing cases unchanged.
- `lightbox` dispatch: each format routes to the right preview (smoke-render with a stub for the
  lazy mermaid/shiki); format-override changes the rendered preview; copy/download caps reflected
  in the toolbar.
- `FormatPicker`: opens, selects, closes on outside-click/Escape.

**Manual verification (Chris, on device):**
1. Upload a `.ts`/`.py` file → opens as highlighted code; Copy works; Download yields the file.
2. Upload a `.md` → renders in the Aurora document style (headings serif, KaTeX block, a mermaid
   fence, a table) — confirm it looks "himmlisch".
3. Upload an `.html` (self-contained) → renders in the sandbox; a phone-home attempt is blocked.
4. Upload an `.svg` → renders as a centred vector; `.mmd` → renders as a diagram.
5. Format-override: force a `.txt` to render as Markdown, and code as plain text.
6. Open an attachment from the **chat stream**, scroll the stream, then close → it zooms
   **downward**; open one that's still visible and close → it zooms **back to the thumb**.
7. Open/close from the **cockpit strip** → zooms back to the strip thumb.
8. `prefers-reduced-motion` → no zoom, clean fade.

**Build verification:** `pnpm typecheck` + `pnpm run build` + full user-client vitest must be
green (modulo the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom
baseline) before squash.
