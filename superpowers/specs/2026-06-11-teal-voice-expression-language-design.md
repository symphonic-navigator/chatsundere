# TEAL — Transformative Expression and Anthropomorphisation Layer

**Date:** 2026-06-11
**Status:** Approved (brainstormed end-to-end with Chris)
**Scope:** The canonical voice expression language, its always-on prompt segment, and the human-friendly display rendering. TTS backends and their translators are explicitly **out of scope** (they consume this language later).
**Part of:** the voice design weekend (roleplay mode and user greeting landed 2026-06-11; TTS/live voice follows).

---

## 1. Purpose and background

Chatsundere will speak through several voice backends with different expression
semantics and syntaxes. Rather than letting each backend's markup leak into the
product, we define **one canonical expression language** that everything else
translates from: TTS backends translate it into their own markup along their
capabilities, and the chat display translates it into human-friendly
formatting. The display is simply the prettiest translation target of all —
same architecture, no special case.

The second motivation is product identity. Chatsundere is *deredere towards
the user*, not a technical tool: the user who chats, roleplays, learns and
creates must never see
`<emphasis>You solved it!</emphasis> [giggle]` on screen. They see the
emotional expression *reflected* — an emoji, an italic whisper, a bold
emphasis. Grok is the precedent: it uses expressions in ordinary
conversations, users love it, and it cannot be neutral — which we consider
exemplary.

**Design stance (preamble against future over-engineering):** Chatsundere
expressivity is a creative instrument, not a precision instrument. Ambiguity
in the rendered surface (e.g. italics meaning either whisper or narration) is
accepted deliberately. The canonical stored text stays precise; the display
does not have to be.

---

## 2. The language

### 2.1 Definition

TEAL v1 is a **closed, versioned vocabulary**, snapshotted from xAI's voice
expression tag set as of 2026-06-11 (the chatsune source of truth:
`backend/modules/integrations/_voice_expression_tags.py`). It is **our**
language: if xAI changes its vocabulary, TEAL does not move — the future xAI
translator then maps instead of passing through. Extension is deliberate
curation (new vocabulary version), never heuristics — the same philosophy as
the model catalogue.

Two syntactic categories:

- **Inline tags** — square brackets, discrete one-shot events:
  `[laugh]`, `[sigh]`, `[pause]`.
- **Wrapping tags** — angle brackets, prosody spans modulating the enclosed
  text: `<whisper>a secret</whisper>`. Wrapping tags may nest.

**Qualifiers:** an inline tag may carry free qualifier words in the same
brackets (`[soft laugh]`, `[exhale sharply]`). The vocabulary's *core words*
are closed; qualifiers are open.

### 2.2 Vocabulary v1

Inline (16): `pause`, `long-pause`, `hum-tune`, `laugh`, `chuckle`, `giggle`,
`cry`, `whoop`, `tsk`, `tongue-click`, `lip-smack`, `breath`, `inhale`,
`exhale`, `sigh`, `gasp`.

Wrapping (13): `soft`, `whisper`, `loud`, `build-intensity`,
`decrease-intensity`, `higher-pitch`, `lower-pitch`, `slow`, `fast`,
`sing-song`, `singing`, `laugh-speak`, `emphasis`.

### 2.3 Where it lives

The vocabulary module (tag lists, types, prompt-segment builder) lives in
`packages/llm-unified` — the future home of the TTS translators. The display
render map lives in `apps/user-client` (display is a UI concern).

---

## 3. Emission — the prompt segment

- **Always on.** Every persona emits expressions; there is no toggle, no
  persona switch, no per-chat state (decision D1). Expressions are part of
  Chatsundere's base personality, exactly as with Grok. This is also the
  simpler architecture: no configuration, no state.
- A new **Band-1 prompt segment** explains both syntaxes, lists the
  vocabulary with one-line descriptions, and carries the dosage recipe
  (typically 0–2 markups per message; markup is expressive because it is
  rare).
- **Anti-double-marking rule** (roleplay interaction): one sentence in the
  segment — *if you narrate an action in asterisks, do not additionally tag
  the same sound* (no `*giggles softly*` immediately next to `[giggle]`).
- **Placement constraint:** the segment sits in Band 1 **before** the
  roleplay segment. It must **not** break the roleplay-segment → persona-CI
  adjacency, which is load-bearing (Chris's empirical finding, see the
  roleplay spec of 2026-06-11).
- **The user-greeting (opener) generation includes the segment** — the opener
  is in-character chat text. Title generation and memory extraction do
  **not** (they produce no spoken text).

### 3.1 Relationship to roleplay narration

Narration and expressions are **orthogonal layers** (decision D4):

- Asterisk narration (roleplay mode) describes *action* — narrative,
  rendered italic by Markdown as-is.
- TEAL tags mark *vocal delivery* — rendered per §4.

Outside roleplay mode, italic text is simply spoken by the normal voice; in
roleplay mode the persona already narrates in asterisks, and expressions add a
further layer. The canonical text always keeps the two distinguishable
(`*…*` vs tags), which is what the future TTS translator needs for
narrator-voice vs dialogue-voice handling. The *rendered* collision (whisper
italics look like narration italics) is **accepted deliberately** per the §1
design stance; the render map keeps a styling slot for whisper (e.g. dimmed
italics) for Chris's styling pass.

---

## 4. Display rendering

### 4.1 Mechanism

A **generic AST plugin** in the user-client Markdown pipeline (remark/rehype —
the same mechanism the voice sentence-glow plan already foresees), driven
entirely by a **declarative data file** (decision D5): one map from tag to
render action — `emoji`, `typography`, or `silent`. Editing a mapping is
editing one data row; the plugin contains no per-tag logic.

Operating on the AST (not regex on raw text) gives code blocks, inline code
and links immunity for free: a `[pause]` inside a code fence stays literal.

### 4.2 Matching rules

- **Closed vocabulary** (decision D2): only known tags transform. Unknown
  bracket content (`[1]`, `[sic]`, an invented `[snort]`) stays literal in
  the text — zero false positives, and surviving literal tags are our
  observation source for curating vocabulary v2.
- **Longest match first** (decision D3): known multi-word combinations have
  their own rows (`soft laugh` → 🤭); only when no combination matches does
  the renderer fall back to the known core word within the tag
  (`[soft laugh until breathless]` → core `laugh` → 😄). Unknown qualifiers
  never block rendering; they act in the voice only.
- Unknown **wrapping** tags: strip the tags, keep the inner text.

### 4.3 Render map v1

| Tag(s) | Rendering |
|---|---|
| `laugh` | 😄 |
| `soft laugh` (combination row), `giggle` | 🤭 |
| `chuckle` | 😁 |
| `cry` | 😢 |
| `whoop` | 🥳 |
| `tsk` | 😒 |
| `gasp` | 😲 |
| `sigh`, `breath`, `inhale`, `exhale` | 😮‍💨 (one emoji for the breath family — canonically they stay distinct, so nothing is lost for TTS) |
| `hum-tune` | 🎶 |
| `pause` | ` … ` |
| `long-pause` | ` …… ` |
| `singing`, `sing-song` | ♪ around the wrapped text |
| `whisper`, `soft` | italics (whisper with a distinct styling slot, e.g. dimmed — styling pass) |
| `loud`, `emphasis` | bold |
| `laugh-speak` | bold |
| `slow` | slightly letter-spaced text |
| `tongue-click`, `lip-smack`, `higher-pitch`, `lower-pitch`, `fast`, `build-intensity`, `decrease-intensity` | silent (audible later, not visible) |

The emoji rows are Chris-curated data; he adjusts them during the device test
or any time after — that is the point of the data file.

### 4.4 Streaming behaviour

- An opened, not-yet-closed wrapping tag styles **progressively** to the
  current stream end; the closing tag ends the span.
- A half-typed tag at the stream tip (`[lau`, `<whis`) is suppressed rather
  than flashing raw.

### 4.5 Scope of the pipeline

The transform applies wherever message Markdown is rendered (both roles — a
user typing `[laugh]` gets the emoji too, consistent and charming). Plain-text
surfaces are not changed in this feature; the vocabulary module should expose
a `stripTeal`-style helper as part of its public surface for future use
(previews, notifications).

---

## 5. Storage

**Canonical text with tags is what Dexie stores; rendering is derived at
display time, never persisted.** Rendered output is ambiguous (italic is
italic); canonical text never is — and the future TTS translator reads the
stored canonical text. No schema change, no Dexie bump: tags are just message
content. The Copy control therefore copies canonical text (honest, and the
status quo); a rendered-copy variant can follow later if tags in copied text
annoy.

---

## 6. Notes to the future translator layer (recorded, no code now)

1. **Emojis are an expression source.** Translators read emojis in model text
   as expression input too (😂 in the text → `[laugh]`-equivalent for the
   TTS). The canonical language is the union of TEAL tags and the emoji
   surface.
2. **Capability degradation.** Each TTS backend declares what it supports;
   unsupported expressions are stripped, never passed through raw. (Mistral
   currently supports essentially nothing — it simply hears none of this.)
3. **Narration vs dialogue stays canonical.** Asterisk narration and TEAL
   tags are distinguishable in the stored text, enabling narrator-voice vs
   dialogue-voice synthesis later (xAI supports this; see the chatsune
   narrator-mode prompt note).

---

## 7. Testing

- **user-client (Vitest):** AST-plugin unit tests — emoji mapping, typography
  mapping, longest-match and qualifier fallback, unknown-stays-literal,
  unknown-wrap-strips-keeps-text, code-block/inline-code/link immunity,
  nested wraps, unclosed-wrap progressive styling, stream-tip partial-tag
  suppression.
- **llm-unified (bun test):** vocabulary module — tag lists, prompt-segment
  builder output (both syntaxes, dosage, anti-double-marking rule), strip
  helper.

No tests phrase-match prompt prose beyond structural markers (lesson: brittle
retry tests are a signal).

---

## 8. Manual verification (Chris, on device)

1. Ask a persona for an expressive story → emojis, italics and bold appear in
   the text; **no raw tags** visible.
2. A whispered span renders italic; a `[pause]` renders as an ellipsis; a
   sung line carries ♪.
3. Roleplay persona: asterisk narration and expressions coexist; no
   double-marking (`*giggles*` next to 🤭) as the norm.
4. New chat with user greeting enabled → the opener may carry expressions,
   rendered the same way.
5. Ask for a code sample containing `[pause]` → stays literal inside the
   code block.
6. Watch a streaming answer → no raw half-tags flash at the stream tip.
7. Type `[laugh]` as the user → 😄 renders in your own bubble.

---

## 9. Decisions

| # | Decision |
|---|---|
| D1 | Expressions are **always on** — no persona toggle, no per-chat state. Grok precedent; Chatsundere cannot be neutral, deliberately. |
| D2 | **Closed, versioned vocabulary**; v1 = xAI snapshot 2026-06-11. Unknown tags stay literal (observation source for v2). No heuristics. |
| D3 | **Longest-match rendering** with curated combination rows (`soft laugh` → 🤭) and core-word fallback. |
| D4 | Narration and expressions are **orthogonal layers**; the rendered italics collision is accepted (creative instrument, not precision instrument). One anti-double-marking sentence in the prompt segment. |
| D5 | **Data-driven render map** — one declarative file, generic plugin, Chris curates rows. |
| D6 | Name: **TEAL — Transformative Expression and Anthropomorphisation Layer** (British spelling in all artefacts; the acronym is also a small jab, and a colour). |
| D7 | Canonical text stored; rendering derived at display; Copy copies canonical. |
| D8 | Opener generation includes the segment; title-gen and memory extraction do not. |
| D9 | TEAL prompt segment must not break the roleplay-segment → persona-CI adjacency (placed before the roleplay segment in Band 1). |
