# Design-language brainstorm — round 1 (parked)

**Date:** 2026-06-08
**State:** Idea-collection only. Chris consciously deferred to think 1-2 days. No spec, no code. Direction approved *in spirit* ("ich mag die Richtung").

## The artefact

`visuals/redesign-idea-1.png` — a mobile (≈380 px) **Entrance-Hall / dashboard** mockup:

- Header: `Chatsundere` wordmark top-left; two monospace pills top-right (`MVP 2`, `LOCAL`).
- `WELCOME BACK` eyebrow + large **Instrument-Serif** name heading ("Chris Tidesson").
- A primary **"Continue page"** outlined card (last artefact / resume anchor) with a `→`.
- A **2-column grid of eight "My X" cards** — My Integrations (NEW), My Knowledge (NEW), My Circle (7 personas), My Projects, My History (14 chats), My Treasury (1.3 TAS), My Settings, My Account. Each: small line icon, per-card **neon glow outline** (pink/blue/purple/cyan), small-caps subtitle, `→`.
- Footer: `MVP 2 · 09.001`.

## What's genuinely strong (and already on-canon)

- **No sidebar; card-grid root** — the "2×2 root matrix over combined surfaces" we set for the [[project_neurodivergent_audience]].
- **Opulent lexicon**: Instrument-Serif heading, glow borders, monospace inline pills — exactly CLAUDE.md §11 + the inline-marker aesthetic.
- **Possessive "My X" voice** — the *dere* warmth as a *language system*, not decoration.
- **"Continue page" as primary anchor** — gives the eye one next action before the grid (good ND-calm instinct).

## The four tensions (ranked by leverage) — to resolve when we resume

1. **Motion vs. neurodivergent audience (biggest).** Zoom-in/out on navigation + button "blink" + breathing glows is exactly the reizdichte that can overwhelm our target users. The design language must define **two motion states from day one** (full + calm), `prefers-reduced-motion` is core, not a courtesy. See [[feedback_aesthetic_validation]] (beauty from restraint).
2. **Drill-down vs. Chris's earlier inline preference.** "Unterseiten statt Tabs" + breadcrumb + zoom-in *is* push-to-subscreen. We had recorded a lean toward accordion/expand-in-place ([[feedback_inline_over_hidden_navigation]]). This is a conscious reversal — the open fork below. It decides the whole animation language.
3. **Density.** Eight equally-weighted glow cards compete; nothing is primary except the Continue card. Open question: does colour/glow become **semantic** (e.g. only NEW glows bright, rest rest) or is it decoration? A rule is needed or colour carries no information.
4. **Scope: chrome ≠ chat.** This card-language is the **navigation shell**. The reading surface (chat ≈ 80% reading — [[project_reading_mode_is_central]]) obeys different laws (calm, lesefluss). The design language is **two layers** — shell (card-grid, glow, transitions) + reading surface (calm) — and must define their *relationship*, not pretend the chat is a glow-grid. This is the honest answer to "können wir das konsequent über alles ziehen": shell yes, reading surface in spirit only.

## The open fork (decides everything else)

**"Unterseiten statt Tabs" — true push/pop (new page slides in, breadcrumb builds up) OR expand-in-place (card opens to its section where it sits)?** The mockup suggests push; Chris's earlier self leaned expand. Resolve this first when we resume — the motion language hangs off it.

## When we resume

Run as its own **brainstorming session with the visual companion** (browser mockups). Order: **design language as a document FIRST** (tokens, type scale, spacing, motion, component anatomy), then build screen-by-screen against it. Reference workflow: OpenAI image model = Nordstern reference, **not** SVG source; translate to Tailwind v4 tokens + real components. See [[project_next_session_laura_and_design_language]].
