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
> files) — tune on device. Open device decision: sidebar inline-rename is
> double-click only (mobile touch gap; rename also available in the lightbox).

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

### Open questions (to resolve in the relevant chunk's spec)

- **Treasury filter UI at 380px:** five axes (persona, tag, project, type,
  name-search) is a lot on mobile. Needs a visual pass.
- **`read_artefact(id)` on demand?** With the file out of context, if the user
  asks "what's in it?" the main model can't answer. Add a `read_artefact` tool,
  or rely on the user opening the lightbox? Decide in Kern/Treasury spec.
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
| 2 | **Treasury** | global view (flip the Entrance-Hall tile live); filters: persona, type, **tags** (+ autocomplete), project (reserved), fuzzy name search; favourites; multi-select for management (delete/tag) | ⬜ planned |
| 3 | **Artefacts as attachments** | slimmed treasury picker + multi-select → copy snapshot into `attachments` → existing multimodal wire injection (cross-persona reuse) | ⬜ planned |
| 4 | **Save as artefact** | save-message-as-artefact (markdown, both roles, default name = snippet, text-only) **and** save-code-block-as-artefact (format from fence language) | ⬜ planned |
| 5 | **Iteration** *(small follow-up)* | `edit_artefact(id, instruction)` — reuses the Kern author-subagent machinery; just the second tool + lightbox-edit conflict handling | 🅿️ deferred |
| 6 | **Configurable author model** *(follow-up, aimed today)* | global "artefact author model" picker (mirrors substitute-vision): chat with one model's voice, author the file with the best coder — "best of everything" | 🅿️ deferred |

### Related follow-ups (not artefact chunks)

- **Restyle the ToC/bookmarks sheet (`TocSheet`)** to match the polished compact
  artefact-sidebar aesthetic — currently plain. Small, non-blocking.
- **Sidebar inline-rename on touch:** the `ArtefactSheet` rename is double-click
  only (collides with tap-to-open on mobile-first 380px). Decide a touch gesture
  (long-press / small edit affordance) after Chris's device test; rename already
  works in the lightbox, so non-blocking. (Final opus review, 2026-06-06.)

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
