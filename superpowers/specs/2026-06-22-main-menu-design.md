# Main Menu (Entrance Hall) — Design Spec

- **Date:** 2026-06-22
- **Author:** Liz (with Chris)
- **Status:** Chris-approved in brainstorm — ready for spec review, then implementation plan
- **Scope:** The first real surface of the UI/UX makeover — a rebuild of the Entrance Hall (`/app`) in the design language landed on 2026-06-21. It is the reference slice where the language meets real content, and it gives birth to the navigation-plane **`NavTile`** primitive. The shared topbar and the ambient background are explicitly out of scope (see §8).

---

## 1. Context & Goals

The design-language foundations (colour planes, the Unified-Experience motion language, seven primitives) shipped to master on 2026-06-21 ([[../specs/2026-06-21-design-language-foundations-design]]). They define the *language*; this spec is the first *surface* that speaks it.

The main menu was chosen as the opening slice deliberately: it is small, low-stakes (the user spends little time here — the chat is the centre of gravity), and it surfaces a large share of the reusable catalogue. It is also the surface the visual reference (`visuals/redesign-idea-1.png`) was built around.

Today's `routes/app/entrance-hall.tsx` is functional but speaks the *old* language: a local `RoomTile` with Unicode glyphs, white borders, no plane colour, no ascension order, no motion. This spec replaces it.

Four things must marry, exactly as in the foundations:

1. **Neurodivergent-friendly calm** — one intent per screen, no nagging, omakase over options.
2. **Cinematic opulence in the surroundings** — the navigation plane is *loud* here (per foundations §2.5: "main menu — navigation plane loud").
3. **Guided controls from primitives** — the menu gives birth to `NavTile`; later surfaces inherit it.
4. **Effortless learnability** — the app is learned once; every surface behaves the same.

### 1.1 Reference

`visuals/redesign-idea-1.png` is a ChatGPT-Image-2 beautification of an early screenshot. It is a **mood reference, not a source of truth**. Known liberties the model took: it renamed the clickable Adult-Mode pill to "MVP 2"; it added "NEW" badges that were genuine placeholders; the Continue card's title was simply the title of the chat in the screenshot. The colour grouping, the ascension order, and the tile aesthetic are the parts we honour.

---

## 2. Component Architecture

### 2.1 Navigation-plane tokens (app-wide)

The four navigation-plane hues move into the Tailwind v4 `@theme` block in `apps/user-client/src/index.css`, alongside the existing Aurora + semantic tokens (foundations §8). Values from foundations §2.3:

| Token | Accent | Icon tint |
|---|---|---|
| `--nav-pink` | `#ff6db0` | `#ff8ec4` |
| `--nav-green` | `#4fd38a` | `#7fe0a8` |
| `--nav-blue` | `#5b9dff` | `#9cc0ff` |
| `--nav-purple` | `#a98bff` (light) / `#7457c4` (dark) | — |

`--color-gold` already exists as a load-bearing token (landed with the foundations); the menu reuses it for the priority overlay. The destructive/red token is not used on this surface (no destructive action lives here).

**Device-check (foundations §2.6):** navigation-green (`#4fd38a`) sits near semantic-success-green (`--color-success` `#7be0b8`). They appear on different element types here (a tile border vs the connectivity badge), but Chris verifies on device that they do not blur; widen the hue distance if they do.

### 2.2 `NavTile` — the eighth primitive

A new primitive in `apps/user-client/src/components/ui/`, exported from the `ui/index.ts` barrel. It is the navigation-plane building block — the answer to "what do I use for a navigation tile?". Chris confirmed it will be reused: later sub-areas branch off the main menu with their own depth and carry their own nav-tiles.

Props:

```
interface NavTileProps {
  colour: 'pink' | 'green' | 'blue' | 'purple';  // navigation-plane identity
  icon: LucideIcon;
  label: string;
  meta?: string;                  // secondary line (live count or hint)
  to?: string;                    // route; omitted/disabled → not navigable
  gold?: boolean;                 // priority overlay (§2.2 foundations) — 1× per screen
  wide?: boolean;                 // span both columns (Continue / Setup card)
  disabled?: boolean;
  disabledReason?: string;        // announced tooltip when disabled
  children?: ReactNode;           // body override (Continue/Setup cards)
}
```

Visual shell, fixed from foundations §2.3: a coloured **1px border at ~0.42 alpha** + a subtle **top-down gradient fill (~0.10 → ~0.02 alpha)** + a **soft outer glow (~0.12 alpha)**, all derived from the `colour` token. The **gold variant** swaps the border/glow/eyebrow to `--color-gold` (a gold halo, per foundations §11.1).

State pattern follows the codebase convention: variants via `data-*` attributes + Tailwind/CSS, **no CVA/Radix** (foundations §8).

The **Continue card and the Setup card are `<NavTile gold wide>`** with a `children` body, not bespoke components — plane × gold composed, as the foundations intend.

---

## 3. Screen Structure — the Ascension

Rendered top→bottom (the ascension reads bottom-to-top as meaning; foundations §2.4). **The row order is fixed and never reordered** — the order itself carries the chakra-ascension metaphor and seeds the future root→crown ambient background.

```
[ Topbar — global, unchanged: Chatsundere ✦ … Adult-Mode pill · LOCAL ]

        WELCOME BACK
        <displayName>                         ← --mindspace-text-primary

   ┌─────────────────────────────────────┐
   │ ✦ CONTINUE · <chat title>           │    🟡 Crown — gold, wide
   └─────────────────────────────────────┘        (or the Setup card — §5)
   ┌──────────────┐ ┌──────────────┐
   │ My Circle    │ │ My History   │           🩷 Relate — pink
   ├──────────────┤ ├──────────────┤
   │ My Treasury  │ │ My Projects  │           🟢 Treasure — green  (Projects disabled)
   ├──────────────┤ ├──────────────┤
   │ My Knowledge │ │ My Integr.   │           🔵 Nourish — blue
   ├──────────────┤ ├──────────────┤
   │ My Settings  │ │ My Account   │           🟣 Root — purple
   └──────────────┘ └──────────────┘

        v<version> · sha <sha>                ← footer (small, unchanged)
```

### 3.1 Greeting

`WELCOME BACK` eyebrow (uppercase, tracked) + `displayName` in `--mindspace-text-primary`. Unchanged in substance from today; restyled to the language.

### 3.2 The Crown card

- **Continue card** when a last chat exists: `<NavTile gold wide>` whose body is an eyebrow "CONTINUE" + the chat title (falling back to the persona name) rendered in the **persona's colour**. Tapping navigates to `/app/chat/:chatId`. This is the common, returning-user case.
- **Setup card** when setup is incomplete (§5): the same `<NavTile gold wide>` slot, different body. The two are mutually exclusive — the gold overlay always sits on exactly one Crown card.
- If a last chat exists *and* setup is somehow incomplete (e.g. the user later disabled their only provider), the **Setup card wins** the Crown (the blocker is the more urgent "what you came for"), and Continue is not shown this visit. This is an edge case, but the rule is explicit.

### 3.3 The room grid

Eight tiles in four fixed colour rows, two columns. Each tile is a `<NavTile>` with its plane colour, Lucide icon (§6), label, live-count meta (§3.4), and route. All eight routes already exist; only My Projects is a stub.

### 3.4 Meta lines (live counts)

Pulled from the hooks the Entrance Hall already loads. A zero count reads as a calm word, never "0":

| Tile | Meta source | Empty text |
|---|---|---|
| My Circle | persona count | `no companions yet` |
| My History | chat count | `no chats yet` |
| My Treasury | artefact count | `empty` |
| My Projects | — (disabled) | `coming after the alpha` |
| My Knowledge | library count | `empty` |
| My Integrations | (static) | `MCP servers` |
| My Settings | enabled-provider count | `no providers yet` |
| My Account | (static) | `identity & auth` |

(Exact copy is Chris's to arbitrate on device; British English throughout.)

### 3.5 Footer

The version + sha line stays, restyled to the language (small, low-contrast). Unchanged in content.

---

## 4. NavTile States

- **Interactive:** hover/active lift the gradient fill + outer glow a touch; the tile is keyboard-focusable; Enter/Space activate. Tap triggers the motion (§7).
- **Disabled** (My Projects): `opacity ~0.4`, **`aria-disabled="true"`** (not the native `disabled` attribute — it must stay focusable so the reason is announced, per foundations §7), `disabledReason` surfaced as an announced tooltip ("Coming after the alpha"). The activate handler no-ops. This honours "disabled over hidden" for keyboard and screen-reader users, not only sighted-pointer users.
- **My Projects rationale (Chris):** the feature is deferred until after the alpha because its concept is changing and not yet fully formed — it stays visible-but-disabled rather than hidden, so the user sees the capability is coming.

---

## 5. Setup-Hints

### 5.1 Blocking signals (decision: option B)

Two signals are **hard blockers** — without them the user genuinely cannot have a first chat:

1. **At least one enabled provider** — `useProviders()` → `providers.filter(p => p.enabled).length > 0`. Without a provider there is no model.
2. **At least one persona** — `useFilteredPersonas()` → `personas.length > 0`. Without a persona there is no counterpart.

The **Global Unlocker / instructions** (`settings.globalInstructions`) is **not** a blocker — a chat works without it (the persona's own instructions carry everything). Framing it as a required step would contradict "omakase, not nagging" and the constructive-error-handling ethos. It is therefore **not surfaced in the Setup card at all** in this slice; if we later want to suggest it, it arrives as a soft, differently-toned tip, never a "→ do this" blocker. (Parked, not designed here.)

### 5.2 Presentation

When either hard signal is missing, the Crown slot renders the **Setup card** (`<NavTile gold wide>`) instead of Continue:

```
   ┌─────────────────────────────────────┐
   │ ✦ LET'S GET YOU SET UP               │  ← gold overlay (§2.2 foundations)
   │   → Connect a provider               │     each line navigates to its fix
   │   → Create your first companion      │
   └─────────────────────────────────────┘
```

- Only the **missing** steps are listed; a satisfied step disappears. When the last step is satisfied, the Setup card is replaced by the Continue card (or, on a truly fresh account with no chat yet, by nothing — the Crown slot is simply empty until the first chat exists).
- Each line is a tap target navigating to its fix: "Connect a provider" → `/app/settings`; "Create your first companion" → `/app/persona/new` (the most direct fix path — straight into the editor, not the empty Circle list).
- The **gold priority overlay moves here** from the Continue card — exactly the foundations §2.2 definition ("here you can probably reach what you came for"): at first run that is "set me up"; afterwards it is "continue". One mechanism, two states.
- Motion and the disabled/focus contract are the same as any `NavTile`.

---

## 6. Icons (Lucide)

Lucide is introduced **with this slice**, scoped to the eight room tiles. The app-wide migration of the remaining Unicode placeholders (History, Treasury, Settings internals, …) stays deferred (foundations §9); each later surface inherits the library organically. Bespoke SVG is reserved for later (e.g. a future My-Circle mark).

Dependency: `lucide-react` (tree-shakeable; import individual icons).

| Room | Icon | Room | Icon |
|---|---|---|---|
| My Circle | `Users` | My Knowledge | `BookOpen` |
| My History | `Clock` | My Integrations | `Plug` |
| My Treasury | `Gem` | My Settings | `SlidersHorizontal` |
| My Projects | `FolderKanban` | My Account | `UserRound` |

Icons are tinted with the row's navigation-plane icon-tint token (§2.1).

---

## 7. Motion — first application of the Unified Experience

Tile activation follows foundations §3.1 verbatim:

- **Trigger feedback:** only the tapped tile blinks — a **gold 2× pulse** (~0.26s). Never a full-screen flash.
- **Enter:** the destination surface grows out of the tile's rect — `scale(.32)→1`, opacity `0→1`, ~0.30s, ease-out `cubic-bezier(.2,.7,.2,1)`. The cinematic moment; it may savour.
- **Exit / back:** collapses toward the origin — `scale(1)→.5`, opacity `1→0`, ~0.17s, ease-in. Gone before consciously noticed.
- **Governing rule:** "enter savours, exit vanishes."
- The **Continue card** zooms into the chat; the **Setup-card lines** zoom into their fix surface.
- **Reduced motion** (`prefers-reduced-motion: reduce`): a plain cross-fade — no zoom, no blink. Gated via the CSS `@media` query (foundations §8), consistent with the codebase's existing blocks.

### 7.1 Open implementation point (resolved in the plan, not here)

The main menu is the **first place the origin-zoom crosses a real route change** (`/app` → `/app/circle` etc.). The mechanism — capturing the tile's `getBoundingClientRect()` at click time and feeding it as the `transform-origin` of the entering route — is a plan-level decision. This spec fixes only the *behaviour* (origin-aware zoom from the tapped tile, gold blink, reduced-motion fallback). The plan chooses the concrete mechanism and whether a small shared transition helper is extracted for reuse by the "depth" sub-areas Chris foresees.

---

## 8. Out of Scope

- **The shared topbar** (`routes/root.tsx`) — the `Chatsundere` logo, the `AdultModeToggle` (the clickable Adult/NSFW pill the reference mislabelled "MVP 2"), the username, and the `ConnectivityBadge` ("LOCAL"). It is app-wide; redesigning it would change every surface at once. It already matches the reference, so it stays untouched this slice. A topbar pass belongs with a later slice (likely the chat rework).
- **The ambient root→crown background** (the "energy flowing up the ascension"). It is part of the same "Main Menu" work package but gets its **own spec and step** after this one lands (Chris's call). The token/structure here must not preclude it.
- **My Projects** beyond the disabled stub — the feature concept is deferred until after the alpha.
- The **app-wide icon migration** beyond the eight room tiles.
- Any change to the eight destination room screens themselves — they are restyled in their own later slices.

---

## 9. Implementation Notes

- **Replace** `routes/app/entrance-hall.tsx`'s local `RoomTile` with the new `NavTile` primitive; keep the existing data hooks (`useFilteredPersonas`, `useChats`, `useProviders`, `useFilteredLibraries`, `useAllArtefactCount`, `useDisplayName`, `useSettings`, `useMindspaces`) and the mindspace-reset effect.
- **Tokens** into the `@theme` block of `index.css`; **`NavTile`** into `components/ui/` + the barrel; add it to the internal `/app/ui-showcase` route (the live primitive catalogue, foundations §8).
- **Motion CSS-only** — no framer-motion (foundations §8).
- **British English** for all identifiers, copy, comments (project hard rule §3.7).
- **Tests:** unit/RTL on `NavTile` (the three colour planes render the right token; gold variant; disabled is focusable + announces its reason + no-ops navigation; wide spans two columns) and on the Entrance Hall (ascension order is fixed; Crown shows Continue when a chat exists, the Setup card when a blocker is missing, listing only the missing steps; meta empty-text). Manual device verification per §10.

---

## 10. Manual Verification (device, by Chris)

1. Main menu shows the four colour rows in the fixed ascension order; gold halo on the Crown card.
2. Returning user: the Crown is the Continue card; tapping it zooms into the last chat.
3. Fresh account (no provider / no persona): the Crown is the Setup card with only the missing steps; each line navigates to its fix; gold sits on the Setup card.
4. Satisfy the last blocker → the Setup card gives way to Continue (or to an empty Crown until the first chat exists).
5. Tapping a tile: only that tile blinks gold (2×), the destination zooms from it (~0.30s); back collapses fast (~0.17s) to where it came from.
6. My Projects is visible but disabled, opacity-dimmed, with an announced "Coming after the alpha" reason; keyboard focus reaches it and reads the reason; it does not navigate.
7. Meta counts are live and read as calm words when empty (never "0").
8. `prefers-reduced-motion` on: all motion degrades to plain cross-fades, no zoom, no blink.
9. Navigation-green (My Treasury / My Projects border) vs success-green (the LOCAL/connectivity badge) do not visually confuse (foundations §2.6).
10. The shared topbar is unchanged and correct: logo, the clickable Adult-Mode pill, "LOCAL".
