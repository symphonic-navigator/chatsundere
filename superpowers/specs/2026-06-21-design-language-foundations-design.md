# Design Language Foundations — Design Spec

- **Date:** 2026-06-21
- **Author:** Liz (with Chris)
- **Status:** Draft — awaiting Chris review, then Laura spec-pass
- **Scope:** The foundation of the UI/UX makeover — the colour model, the motion language, and the first three reusable primitives. This is the durable design language every later surface inherits. The chat surface is deliberately the *last* thing reworked and is out of scope here.

---

## 1. Context & Goals

Chatsundere is entering its UI/UX makeover (a 2–3 week sub-project). We work **organically**: primitives are extracted from real screens as we build them, not invented in a vacuum. The first vertical slices are the **main menu**, then **My Settings** and **My Account** — together they surface a large share of the reusable catalogue while staying low-stakes (the user spends little time here; the chat is the centre of gravity).

Four things must marry:

1. **Neurodivergent-friendly calm** — *Don't make me think*, *Principle of Least Astonishment*, one intent per screen, never overwhelming the user with controls.
2. **Cinematic opulence in the "surroundings"** — a slightly-cyberpunk, opulent treatment of everything *around* the chat.
3. **Guided controls from primitives** — a fixed catalogue of building blocks so we never re-style a dropdown white-on-white again, and always know what to use where.
4. **Effortless learnability** — the app is learned essentially once; every surface behaves the same way.

The resolution of (1) vs (2): **opulence lives in the surroundings, calm lives in the chat.** The same design language is simply *mixed differently* per screen (see §2.4).

---

## 2. The Colour Model — Three Orthogonal Planes

Colour never means two things at once because each meaning lives on a different **plane** (a different *type* of element at a different depth). For any new element we ask "which plane?", and that selects the colour family.

### 2.1 The three planes

1. **Navigation plane** — *"where am I / where can I go?"* Lives on room tiles and navigation buttons. Colour = **room identity** (category). Owns the navigation transition.
2. **Action plane** — *"what can I do here?"* Lives on buttons and controls *inside* a screen. Colour = **semantic intent** (primary / neutral / destructive). **Red lives only here**, and only ever means destructive/caution.
3. **Persona / mindspace plane** — *"who am I talking to?"* The existing per-persona accent (`--mindspace-accent`). Dominates the chat, recedes everywhere else.

### 2.2 Gold — the priority overlay (a fourth, thin axis)

Gold is **not** a category. It is an **overlay** applied to **exactly one element per screen**: the thing the user most likely came for. Definition (Chris's words): *"here you can probably reach what you came for."* It cuts across all planes.

### 2.3 Navigation-plane palette & room grouping

Colour groups follow **origin** (the meaning that emerged during design):

| Group | Hue | Token (accent) | Rooms |
|---|---|---|---|
| Companions & conversations | Pink | `#ff6db0` (icon `#ff8ec4`) | My Circle, My History |
| Your works & active work | Green | `#4fd38a` (icon `#7fe0a8`) | My Treasury, My Projects |
| Knowledge & tools from outside | Blue | `#5b9dff` (icon `#9cc0ff`) | My Knowledge, My Integrations |
| System & self | Purple | `#a98bff` light / `#7457c4` dark | My Settings (light), My Account (dark) |
| **Priority overlay** | Gold | `#e8c061` (button fill `#f0d488→#d9b455`) | — (1× per screen) |
| **Destructive (action plane)** | Red | `#ff5a5a` (text `#ff8a8a`) | — (reserved) |

Tile styling: a coloured 1px border at ~0.42 alpha + a subtle top-down gradient fill (~0.10→0.02 alpha) + a soft outer glow (~0.12 alpha).

### 2.4 The layout order is meaningful — the "ascension"

The main-menu rows read **bottom-to-top as an ascension** (Chris's chakra metaphor). **This order is fixed; rows are never reordered arbitrarily** because the order itself carries meaning:

- 🟣 **Root** — System & self (settings, account) · the foundation
- 🔵 **Nourish** — knowledge & tools from outside
- 🟢 **Treasure** — what you have created & your work
- 🩷 **Relate** — conversations, the companions
- 🟡 **Crown** — "continue where you left off" (the gold Continue card, top)

This also seeds the future ambient background: energy flowing from root upward to crown.

### 2.5 Per-screen mix (the calm/opulence dial)

The *same* language, mixed by turning planes up or down:

- **Main menu** — navigation plane **loud** (opulent surroundings).
- **Settings/Account** — action plane loud, navigation quieter.
- **Chat** — persona plane loud; navigation & action planes only whisper (calm).

### 2.6 Known proximity to monitor

Navigation-green (`#4fd38a`, "your works") sits close to semantic-success-green (existing `--color-success` `#7be0b8`, status "connected"). They live on different planes/element types, but the hues are near. **Device-check** that they do not blur; widen the hue distance if they do.

---

## 3. The Motion Language — "Unified Experience"

One motion language governs **everything that appears or disappears**: pages, confirmation/query dialogs, message boxes. Nothing is ever a foreign body, because every surface speaks the same **origin-aware** gesture.

### 3.1 Origin-aware zoom (Variant A)

A new surface **grows out of the element that triggered it** (a pressed tile, a button, a menu item) and, on dismissal, **collapses back to that origin**. The motion itself carries orientation — the user always sees *where they came from*, which dissolves the "how do I get out?" problem.

- **Trigger feedback:** only the **triggering element blinks** — a gold 2× pulse (`~0.26s`, double brightness flash). Never a full-screen flash.
- **Enter:** zoom from the origin, `scale(.32)→1`, opacity `0→1`, **~0.30s**, ease-out cubic-bezier(.2,.7,.2,1). The cinematic moment — it may savour.
- **Exit:** collapse toward origin/centre, `scale(1)→.5`, opacity `1→0`, **~0.17s**, ease-in. *It must be gone before the user consciously notices.*
- **Governing rule:** **"Enter savours, exit vanishes."** An exit that lingers is subconsciously discouraging — it makes the user quietly not want to use the app.

### 3.2 Dialogs & query boxes

Confirmation/query/message cards use the **same** origin-aware zoom from their trigger, with a **dimming backdrop** that fades in on enter and out on exit. This is the literal embodiment of the Unified Experience.

### 3.3 Reduced motion

Under `prefers-reduced-motion: reduce`: **a plain cross-fade, no zoom, no blink.** (The codebase already gates every animation this way — we honour it as first-class, not an afterthought.)

---

## 4. Primitive — Button (action plane)

Three types, and a separable gold overlay.

| Type | Use | Style |
|---|---|---|
| **Primary** | the main affirmative action (Save, Yes, Confirm) | filled with a calm aurora/violet base; **wears the gold treatment when it is the screen's priority** (the common case for a single-action dialog). The aurora base appears only when a positive action is present but is *not* the screen's one priority |
| **Neutral / Ghost** | secondary (Cancel, No, Dismiss) | transparent fill, ~0.18 white border, recedes |
| **Destructive** | Delete, Discard | red (`#ff5a5a` border ~0.55, `rgba(255,90,90,.08)` fill, `#ff8a8a` text). **Never gold.** |

**Gold** and the base affirmative style are **separable** so gold can sit on a *non*-affirmative button when safety demands it (§5).

---

## 5. Primitive — Confirmation / Query Dialog

A single, uniform layout used for **every** confirmation in the app — learned exactly once.

- **Layout A — side-by-side** (space-economical; matches desktop habit). **Secondary on the left, the gold action on the right** (thumb zone).
- **One layout everywhere.** Destructive dialogs use the *same* layout; only the **colour roles swap**.
- **The safety principle — "Gold protects, never invites":** in a destructive confirmation, **gold moves to the safe choice** (e.g. *Keep*) and the destructive action stays **red and restrained**. We never pull the finger toward destruction. This creates two attention tiers: *the safest is the most prominent, while destruction is also visible (warning colour) but secondary.*
- The dialog appears/dismisses via the §3 Unified-Experience zoom from its trigger.

---

## 6. Primitive — Pills & Badges

The standard we keep forever: **a Badge tells, a Pill acts.** For any new element, ask only "does it tell or act?" — the answer picks the primitive.

- **Badge (read-only):** status, count, "NEW", notification number. No tap. **Tone only when it means something** (green=connected, amber=reconnecting, red=offline). Attention "NEW" = gold. Count = small number bubble.
- **Pill (interactive):** filter groups (active state = gold accent), removable tag chips (with `×`), "+ Tag" affordances. Has visible hover/active states.
- **Tile badges are neutral** (grey) — the tile border already carries the colour; tinting the badge too costs calm. Implement the tile-badge tone as **a single token** so a future switch to room-tinted badges is a one-line change (a consciously parked exploration — see §10).
- **Consolidation:** the existing `InlineMarker` (tone-driven) and chat `Pill` are brought under this standard later, not re-invented.

---

## 7. Primitive — List Paradigm

The project standard so we never again ask "what function lives in a list?". Every list uses the same row anatomy.

- **Row slots:** **① Leading** (avatar / icon / symbol, optional) · **② Body** (primary title + secondary subtext) · **③ Trailing** (badge / primary action / chevron).
- **Row interaction:** tapping the row = the **primary action** (open).
- **Secondary actions:** a trailing **⋯ overflow menu** (a reusable context-menu primitive). Crucially, the **menu is where "disabled over hidden" is honoured** — it shows *every* capability, greying out unavailable ones with a reason. The row stays calm; completeness lives in the menu. (Chosen decisively over inline buttons, which crowd a 380px row and cost space + calm.)
- **Scrolling:** the **header and footer stay fixed; only the list region scrolls** — a hard project principle.
- **Primary list action:** a fixed footer button wearing **gold** (e.g. "+ New persona").
- **No drag-and-drop** (project rule) — ordering is automatic or via menu actions.

---

## 8. Implementation Notes

- **Tokens:** extend the Tailwind v4 `@theme` block in `apps/user-client/src/index.css` with the navigation-plane hues, gold, and the destructive token; keep the existing Aurora + semantic tokens.
- **State pattern:** follow the existing convention — variants via `data-*` attributes + Tailwind/CSS, **no CVA/Radix** (the codebase is intentionally lean).
- **Motion:** **CSS-only** (the project has no framer-motion and should keep it that way for this scope). The origin-aware zoom needs the trigger's position → compute `transform-origin` from the trigger's rect at fire time.
- **Reduced motion:** reuse `motion.respectsReducedMotion()` from `packages/ui-shared`.
- **Showcase route:** add an internal route that renders every primitive side-by-side — the live successor to `chatsundere-prototype.html`, so "what exists" is always answerable. *(Build location/visibility TBD with the first primitives.)*
- **British English** for all identifiers, copy, comments (project hard rule).

---

## 9. Out of Scope — Next Round

These surfaced as references but are **not** designed here; they arrive with Settings / Circle / History:

- The **⋯ context-menu** primitive in detail (how it appears — bottom sheet vs origin-zoom popover).
- The **search** primitive (shared, reusable — e.g. History search).
- The **(?) help affordance** (also the "disabled over hidden" explainer).
- **Empty / zero states** (constructive — every empty list offers the next step).
- **Dropdown / Select** (the chatsune white-on-white pain — high priority for Settings).
- **Toggle / switch**, slider.
- The **LRU picker** (model, web-search provider … recency-first selection).
- The **animated ambient background** (the "electric charge through circuits" — a styling treat, energy flowing root→crown per §2.4).
- **Icons** — adopt **Lucide** + bespoke SVG, replacing the placeholder Unicode glyphs (✦ ◯ ⬡ …).

---

## 10. Emergent Possibilities (Parked)

Surfaced during design; the list paradigm makes them nearly free later (they compose into existing slots). Not in scope now:

- **"New chat / New incognito chat"** as overflow actions on a persona row.
- **Persona avatars in My History** rows (Leading slot) — makes History warm, not just a text list.
- **Pin in My History** — an overflow action + a pin badge (Trailing), pinned rows auto-sort to top.
- **Revisit tile-badge tinting** (neutral → room-tinted) once the right idea arrives — the token in §6 keeps this cheap.

---

## 11. Manual Verification (device, by Chris)

1. Main menu shows the four colour groups in the fixed ascension order; gold halo on the Continue card.
2. Tapping a tile: only that tile blinks gold (2×), the page zooms from it (~0.30s); back collapses it fast (~0.17s) to where it came from.
3. A confirmation dialog zooms in from its trigger with a backdrop; Save/Cancel side-by-side, gold on the right.
4. A delete confirmation: gold sits on *Keep*, red on *Delete*; same layout as save.
5. A list (My Circle): header + footer fixed, only rows scroll; ⋯ opens a menu listing all actions incl. greyed-with-reason; no inline action buttons cluttering rows.
6. `prefers-reduced-motion` on: all of the above degrade to plain cross-fades, no zoom, no blink.
7. Navigation-green vs success-green do not visually confuse (§2.6).
