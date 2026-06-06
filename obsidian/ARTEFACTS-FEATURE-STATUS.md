# Artefact System — Feature Status

> **Living plan + decision log for the artefact system.** Read this first when
> resuming artefact work after a `/clear`. It survives context resets; the chat
> does not. Update it at the end of every artefact session.
>
> **Started:** 2026-06-06 (brainstorm with Chris). **Block:** 2 (→ v0.1.0).
> **Side:** client-only (no auth/sync/proxy/crypto → no Larissa gate, but see
> §Security).
>
> **Kern shipped 2026-06-06** — squashed to master `ff62750` (**NOT pushed**),
> built subagent-driven (17 TDD tasks + final opus holistic review). Verified:
> typecheck 14/14, build 9/9, user-client vitest 928/928, biome clean. **Next:
> Chris device-tests the spec §13 checklist**, then Chunk 2 (Treasury).
> Known limit: author output capped at `max_tokens: 8192` (≈demo-scale single
> files) — tune on device. **Device-fix rounds landed** (master `2fa7b5f`,
> `9862f60`): (1) pill opens on first tap — `create_artefact` now invalidates the
> chat artefacts query after persisting; (2) lightbox toolbar moved to a row
> below title+filename (no overlap); (3) artefact sidebar is tap-to-open +
> favourite only — **no inline rename** (Chris's call: artefacts are heavyweight,
> rename lives in the lightbox); (4) format dropdown anchored `left:0` (was
> opening off the left edge after the toolbar move); (5) ToC + artefact buttons
> added to the cockpit controls row (right-aligned, above the input) so they're
> reachable while composing, not just in reading mode (master `436aea7`).
> **Decided:** the lightbox **Source editor stays a plain textarea** — no
> editable syntax highlighting (the Preview already highlights via shiki; an
> overlay/CodeMirror editor is over-engineering for a mobile single-file editor).
>
> **Treasury (Chunk 2) shipped 2026-06-06** — squashed to master `92100de`
> (**NOT pushed**; awaiting Chris's device test), built subagent-driven (10 TDD
> tasks + two-stage review per task + final opus holistic review). Verified:
> typecheck 14/14, build 9/9, user-client vitest 959/959, biome clean.
> **Brainstorm decisions:** filter UI = **variant C** (type tabs `All/Apps/Docs/
> Code/Img` + a ⚙ filter sheet for persona/tags/favourites/project-reserved +
> compact fuzzy name search + removable active-filter chips); multi-select =
> **a visible "Select" header button** → floating action bar (bulk Tag + Delete
> with confirm) — **no long-press** (Chris's call); **tags editable in both** the
> lightbox (single, from chat *or* treasury) and the Treasury (bulk); two-line
> rows (decision #20). **`read_artefact` deferred** (follow-up; Chunk 3 is the
> real "feed content back" path). No Dexie migration (the v13 table already
> carries tags/favourite/personaId). Holistic review caught + fixed a privacy
> leak (NSFW persona tags must not surface in the SFW view) before squash.
>
> **Artefacts as attachments (Chunk 3) shipped 2026-06-06** — squashed to master
> `f43b33e` (**NOT pushed**; awaiting Chris's device test), built subagent-driven
> (7 TDD tasks + per-task review + a final **opus** holistic review). Verified:
> build 9/9, typecheck clean, user-client vitest 959→**972/972**, biome clean.
> **Brainstorm decisions** (visual companion): entry point = the cockpit **(+)
> becomes a two-item source menu** (*Upload from device* / *Attach from Treasury*,
> variant A — the natural home as more "add" sources arrive); picker = a **slim
> Quick-Sheet** (variant A — type tabs + fuzzy name search + selection-only rows +
> sticky "Attach (N)"; **no persona/tag filter** — search is the main entry,
> Duplo over Lego); **selection only, no in-picker preview** (inspect in the
> Treasury). Mechanism (decision log #2): each attach copies a **snapshot**
> (content/fileName/mime → a pending `kind:'text'`, `origin:'upload'` attachment)
> via the existing `addAttachment`; **no Dexie migration**, no provenance link;
> the existing send/wire path carries it as a code-fenced text part and the
> lightbox previews it via the extension-bearing `fileName`. **Text-only** (HTML/
> md/code/svg/mermaid are all `kind:'text'`; the future TTI `kind:'image'` blob
> branch is a trivial later add). NSFW gating mirrors the Treasury via
> `useFilteredPersonas`. The **opus holistic review caught one cross-cutting bug**
> per-task reviews missed (the picker root wasn't exempt from `InteractionMode`'s
> unpinned outside-tap close → first tap collapsed the cockpit; fixed +
> regression-tested before squash) and confirmed the rest end-to-end. **No new
> exec/network surface** (logged in [[insights/security-deferrals]]). Spec/plan:
> [[../superpowers/specs/2026-06-06-artefacts-as-attachments-design]],
> [[../superpowers/plans/2026-06-06-artefacts-as-attachments]].

Links: [[STATUS-CLIENT-ONLY]] · [[ROADMAP]] ·
[[../superpowers/specs/2026-06-06-lightbox-viewer-design]] (the seam we plug into) ·
[[../superpowers/specs/2026-06-06-artefact-kern-design]] (Kern spec) ·
[[../superpowers/plans/2026-06-06-artefact-kern]] (Kern plan) ·
[[insights/follow-ups-index]] · [[insights/security-deferrals]].

---

## 1. Vision

Chatsundere is a mobile-first generative-AI workshop *alongside* the chat.
Artefacts are the durable, reusable outputs of that workshop: **single-file web
apps** the persona generates, **markdown** saved from any message, **code
blocks** lifted out of a reply, and (later) **TTI images**. The user can browse
them, edit them, favourite them, tag them, and — crucially — **re-attach them to
new messages** so one persona's output feeds another persona's work.

The single-file-web-app focus is deliberate: it is the lingua franca of the
"AI shows you a UI demo you then hand to a coding agent" workflow. A persona
produces a self-contained demo; the user downloads it and takes it to their real
project. We do not build the backend — we produce the shareable artefact.

---

## 2. Locked decisions (decision log)

Each entry is a settled call from the 2026-06-06 brainstorm. Add to this list;
do not silently change it — if a decision is revisited, note the change + why.

1. **Ownership = the chat session.** An artefact belongs to the chat it was
   created in (later also referenceable via a project). The Treasury is a global
   *view* over all chat-owned artefacts, not a separate store. Mirrors Chatsune.
2. **Re-use = copy, not reference.** Attaching an artefact to a message behaves
   exactly like an upload: it copies a **snapshot** into the existing
   `attachments` flow. Lifecycle is decoupled; deleting the artefact never breaks
   an old message. Driving scenario: persona A makes a great single-file app,
   persona B (better at prose) is asked "write me a Discord project description
   for this" — B receives a copy.
3. **Single file = one self-contained file, full stop.** This is a constraint on
   the *generation tool's output*, motivated by two things at once:
   (a) the download-and-hand-off workflow, and (b) **our zero-knowledge sandbox**
   — the HtmlPreview iframe runs `default-src 'none'`, no external network, so a
   web-app artefact *must* be fully self-contained (no CDN, no `fetch`, libs
   inline). The system prompt must hammer this: Chatsune's models kept splitting
   a trivial calculator into separate `.css`/`.js` files. The model must know:
   **an artefact is exactly one file.** → ADR to write.
4. **The generation tool emits HTML only.** Other artefact formats arrive via
   other paths: markdown via save-message-as-artefact, arbitrary code via
   save-code-block-as-artefact, images via TTI (later). The artefact *format*
   field spans the lightbox's `detectFormat` set + image; the *create tool* is
   HTML-only.
5. **Authoring runs through a one-shot "author subagent" — for create AND edit,
   from the Kern onwards.** The main model calls `create_artefact(title, brief)`
   with only a *brief*, never the full file; the tool fires an internal one-shot
   completion (focused system prompt: "exactly one self-contained file, no CDN,
   no `fetch`") that **streams** the HTML, which we save. The main model only
   ever sees "created artefact «title» (id)". Iteration is the same machinery:
   `edit_artefact(id, instruction)` (current file + instruction → new file).
   Reuses the background-job one-shot infra (persona's provider+model). Rationale
   + tradeoffs in #14. **Supersedes** the earlier "create-only, iteration-later"
   plan — the addressable `id` still carries iteration cleanly.
6. **No persistent version history for now.** Lightbox single-level Undo (to
   baseline) is enough. Full 20-version undo/redo (Chatsune) is YAGNI.
   Open edge case: user edits in lightbox, then a future `edit_artefact`
   overwrites — revisit when iteration lands.
7. **Sidebar behaves like the ToC/bookmark sidebar.** Per-chat list +
   pinned favourites section, inline rename, tap-to-open. Reuses the
   `ReadingToolStrip` → sheet pattern (`TocSheet`). Projects will introduce
   different behaviour later — cross that bridge then.
8. **Tags:** a `string[]` on the artefact, **always normalised (trim +
   lowercase)**, with autocomplete + selection of existing tags.
9. **Pill = title only + reference.** A `create`/`edit` tool call renders as a
   pill showing just the title; clicking opens the artefact in the lightbox.
10. **Lightbox cycling.** Opening an artefact (from pill, sidebar, or treasury)
    gives the normal lightbox behaviour — page through the set, edit/rename/
    copy/download/delete via caps. Generated origin → `delete` cap is on.
11. **Code-block-as-artefact is in scope now** (not deferred). Makes artefacts
    first-class. Sibling of save-message-as-artefact.
12. **`projectId` is in the schema from day one** (nullable, unused until
    projects exist). "Move to project" is a later add.
13. **We will not curate non-tool-call models.** So tool-based generation is the
    norm; save-message / save-code-block are the universal fallbacks anyway.
14. **Why author-subagent (the serendipitous win).** Three benefits drove
    pulling the subagent into the Kern: (a) **context frugality** — the heavy
    HTML never enters the main conversation (only briefs + ids), critical on
    mobile context windows and multi-artefact chats; (b) **progress UI even when
    upstreams don't stream tool-call args** — some providers (e.g. Ollama Cloud
    native) don't stream tool-call argument deltas, so a full-file-in-tool-call
    would appear all at once after a long wait; the subagent streams *content*
    (always streamable), so the pill shows a "progress in characters" indicator
    everywhere; (c) **single-file adherence** — a focused author system prompt
    enforces "one self-contained file" far more robustly than burying it in the
    persona's tool description (Chatsune's models kept splitting into .css/.js).
    Tradeoffs accepted: one extra inference round per artefact (but the main turn
    is tiny, and the file is never replayed in main context); the brief must be
    complete (telephone-game risk → the tool description tells the main model to
    pass a full, self-contained brief). Author model = the persona's model for
    now, but a **configurable "artefact author model" is a committed follow-up**
    (chunk 6) — the "best of everything" payoff: chat with Mistral's voice while
    GLM/Qwen-Coder authors the file. Mechanism mirrors substitute-vision (a
    global picker; later possibly per-persona). Concurrency is fine: authoring is sequential to the main
    stream; parallel-invocation limits (Ollama Cloud 3, nano-gpt 10) only matter
    for overlapping background jobs. **Verify on device: char-progress streams on
    every adapter.**
15. **Chat deletion cascades to its artefacts, with a warning** ("this will also
    delete N artefacts"). The chat is the centre of gravity.
16. **`title` and `fileName` are separate, both renameable.** Avoids 15×
    `index.html`. `fileName` carries the extension (download + `detectFormat`
    preview), `title` is the display name. Lightbox gets two rename targets.
17. **In context, only the outcome lives.** The tool result is
    `created artefact «title» (id: …)`, never the file body (follows from #5/#14).
18. **Artefact pill = variant C** (hybrid). Icon + serif title + format chip;
    while building, a thin sweep progress bar + live character count; when done,
    "N chars · tap to open ↗". Richer than the calculate_js pill (artefacts are
    first-class) but calmer than a full card. Tap opens it in the lightbox.
19. **Chatsundere never authors chat-stream text.** All narration around a pill
    ("I'll build you a calculator…", "the calculator's ready, have fun") is the
    *model's* streamed content, interleaved with the pill as ordinary
    text/pill/reasoning content blocks. We render only the pill chrome — we never
    inject our own sentences into the stream. (Consistent with the existing
    content-block model; a load-bearing product principle.)
20. **Artefact sidebar = compact one-line rows (variant A).** Format-coloured
    glyph + title + favourite star, nothing more — details live in the lightbox.
    The richer two-line (format · size · age) treatment is reserved for the
    Treasury, where orientation matters more.
21. **Attach entry point = the cockpit `(+)` becomes a source menu (variant A).**
    Tapping `(+)` opens a two-item Aurora menu — *Upload from device* (the existing
    file dialog) and *Attach from Treasury* — instead of opening the dialog
    directly. The menu is the natural home as more "add" sources arrive (e.g. TTI).
    Back-compat: `(+)` only becomes a menu when an attach handler is wired, so it
    falls back to the direct dialog where no Treasury attach is offered.
22. **Attach picker = a slim Quick-Sheet (variant A), not the full Treasury.** A
    bottom-sheet with type tabs + fuzzy name search + selection-only one-line rows
    + a sticky "Attach (N)". **No persona/tag filter** — search is the primary
    entry point; persona/tag filtering is a later add *if device use shows the
    need* (Duplo over Lego). Selections resolve against the NSFW-gated `visibleRows`
    so they persist across tab/search changes (the full selection is snapshotted,
    not just the currently visible subset).
23. **Selection only, no in-picker preview.** Tapping a row toggles a check; there
    is no tap-opens-lightbox path inside the picker. Deep inspection lives in the
    real Treasury (one tap away). Revisit if users want an in-picker peek.

### Open questions (to resolve in the relevant chunk's spec)

- ~~**Treasury filter UI at 380px:**~~ **resolved 2026-06-06** → **variant C**:
  type as segmented tabs (the most-used axis) + the remaining axes behind a ⚙
  filter sheet + compact name search + removable chips (visual pass done in the
  brainstorm companion).
- ~~**`read_artefact(id)` on demand?**~~ **resolved 2026-06-06: deferred.** Not a
  Treasury concern; Chunk 3 (artefacts-as-attachments) is the real "feed content
  back into the conversation" path. Logged as a follow-up, kept out of scope.
- **Vector name search:** fuzzy + case-insensitive now; vector search is a
  beta-era add (out of scope).

---

## 3. Data model sketch (provisional — finalise in Kern spec)

New Dexie table `artefacts` (migration **v13**; current schema is v12). Shaped
to mirror `attachments` so the lightbox `ViewableItem` bridge is trivial and
image artefacts (TTI) fit later without another migration.

```
ArtefactRow {
  id: string;                 // pk, addressable (iteration needs this)
  chatId: string;             // owner (indexed)
  personaId: string;          // provenance + treasury filter (indexed)
  projectId: string | null;   // reserved, future
  origin: 'generated' | 'saved-message' | 'saved-code-block';
  kind: 'text' | 'image';     // image reserved for TTI
  format: 'html' | 'markdown' | 'code' | 'svg' | 'mermaid' | 'image';
                              // (treasury "type" filter derives from this)
  title: string;              // display name, freely renameable
  fileName: string;           // carries extension for download/detectFormat
  mime: string;
  content?: string;           // text artefacts
  blob?: Blob;                // image artefacts (future)
  tags: string[];             // normalised trim+lowercase
  favourite: boolean;         // (indexed) — sidebar/treasury pin
  sourceMessageId?: string | null;  // provenance for save-as-artefact
  createdAt: number;
  updatedAt: number;
}
```

Indexes (provisional): `id, chatId, personaId, favourite, [chatId+createdAt]`.

---

## 4. Decomposition & status

One scope per session (Chatsune lesson). Build in order; each chunk gets its own
spec in `superpowers/specs/` and plan in `superpowers/plans/`.

| # | Chunk | Contents | Status |
|---|---|---|---|
| 1 | **Kern** | `artefacts` table (v13); **author subagent** (one-shot, brief→file, streamed); `create_artefact(title, brief)` tool (HTML single-file, self-contained, focused system prompt); artefact pill (title + **char-progress** + click); click → lightbox (cycle, edit/rename `title`+`fileName`/copy/download/delete); per-chat **sidebar** (ReadingToolStrip → sheet, favourites + list, like ToC) | ✅ done (master `ff62750`, 2026-06-06; awaiting Chris's device test) |
| 2 | **Treasury** | global view (flip the Entrance-Hall tile live); filters: persona, type, **tags** (+ autocomplete), project (reserved), fuzzy name search; favourites; multi-select for management (delete/tag) | ✅ done (master `92100de`, 2026-06-06; **NOT pushed** — awaiting Chris's device test) |
| 3 | **Artefacts as attachments** | slimmed treasury picker + multi-select → copy snapshot into `attachments` → existing multimodal wire injection (cross-persona reuse) | ✅ done (master `f43b33e`, 2026-06-06; **NOT pushed** — awaiting Chris's device test) |
| 4 | **Save as artefact** | save-message-as-artefact (markdown, both roles, default name = snippet, text-only) **and** save-code-block-as-artefact (format from fence language) | ⬜ planned |
| 5 | **Iteration** *(small follow-up)* | `edit_artefact(id, instruction)` — reuses the Kern author-subagent machinery; just the second tool + lightbox-edit conflict handling | 🅿️ deferred |
| 6 | **Configurable author model** *(follow-up, aimed today)* | global "artefact author model" picker (mirrors substitute-vision): chat with one model's voice, author the file with the best coder — "best of everything" | 🅿️ deferred |

### Related follow-ups (not artefact chunks)

- **Restyle the ToC/bookmarks sheet (`TocSheet`)** to match the polished compact
  artefact-sidebar aesthetic — currently plain. Small, non-blocking.
- ~~Sidebar inline-rename on touch~~ — **resolved 2026-06-06:** removed entirely.
  The `ArtefactSheet` is tap-to-open + favourite only; rename lives in the
  lightbox (Chris: artefacts are heavyweight, keep the sheet uncluttered).

---

## 5. Security note

Client-only, so no Larissa gate (§9). **But** we persist model-generated,
*executable* HTML and render it. The sandbox (HtmlPreview: `allow-scripts`
without `allow-same-origin` → null origin; CSP `default-src 'none'`; no external
network) is the load-bearing control — same posture as the lightbox viewer.
Log the new persisted-execution surface in [[insights/security-deferrals]] when
the Kern lands.

---

## 6. How to resume

1. Read this file + [[STATUS-CLIENT-ONLY]].
2. Find the first chunk in §4 not marked done.
3. If it has a spec under `superpowers/specs/`, continue from there;
   otherwise brainstorm it (one scope per session) → spec → plan → implement.
4. Update §2 (decisions), §4 (status table), and this file's header date at the
   end of the session.
