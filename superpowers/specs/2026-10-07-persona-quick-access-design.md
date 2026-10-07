# Persona Quick Access — Design Specification

**Date:** 2026-10-07 · **Author:** Liz, brainstormed with Chris · **Status:** approved in conversation by Chris (2026-10-07); Laura spec-pass folded in (3 hard, 9 soft — see §8); pending Chris's written-spec review

## 1. Purpose and Scope

### 1.1 Why

Two design rules were applied too strictly, and field feedback keeps returning
to them:

1. **History feels like leaving the persona.** The persona hub offers chat
   history only as a `History` button that navigates to the global
   `/app/history` page. Testers report the sensation of "leaving" the persona
   to look at its chats.
2. **No quick access from inside a chat.** Reaching the persona's memories,
   history, knowledge, or the image settings from a chat means leaving the chat
   and drilling down. The chat's brand logo is today a single-purpose
   "Leave chat" link.

A third, small friction rides along:

3. **A new persona is not chat-ready.** The create form has no instructions
   field, a new persona starts with empty instructions, and empty instructions
   make the persona *incomplete* — `Continue` and `New Chat` are disabled until
   the user finds the Instructions sub-page. A default instruction resolves this.

This is the third piece of the v0.2.30 omnibus release.

### 1.2 In scope

- **A.** A "Recent chats" accordion on the persona hub replacing the `History`
  button (§2).
- **B.** A chat quick menu opened from the brand logo (and, in interaction
  mode, the hamburger) on the chat route (§3).
- **C.** A default persona instruction that clears on focus (§4).
- `?return=` support on the four quick-menu destinations that lack it (§3.6).
- Hub incomplete-cue copy derived from what is actually missing (§4.3).
- The Instructions tile meta flags the default instruction (§4.4).

### 1.3 Out of scope

- Any change to the global `/app/history` page beyond reading `?q=` and
  `?return=` (§2.5, §3.6).
- Rename, delete, or overflow actions in the accordion rows — those stay on the
  History page.
- Migrating existing personas' instructions. Existing personas are untouched.
- Richer image settings in the quick menu (per-chat image options) — a later
  iteration; for now the entry links to the global page.
- Changing the logo's behaviour outside the chat route.

### 1.4 Parallel-work boundary

The unified image models overnighter runs concurrently on its own branch. It
touches `packages/llm-unified/src/tti/**`, `apps/user-client/src/components/image-gen/**`,
`send-message.ts`, `generate-image.ts`, `client-data-db.ts`, and `artefacts.ts`.
**This work must not touch any of those files.** It links only to the route
`/app/settings/images`, whose page file (`routes/app/settings/images.tsx`) the
image plan does not modify. No Dexie version bump: all new device state lives in
`localStorage`. The only expected merge point is `obsidian/STATUS-CLIENT-ONLY.md`.

Files this work touches (all under `apps/user-client/src/`, none in the image
plan): `routes/root.tsx`, `routes/app/chat/chat-page.tsx`,
`components/chat/InteractionTopbar.tsx`, `components/chat/InteractionMode.tsx`,
`components/chat/ChatQuickMenu.tsx` (new), `state/current-chat.store.ts`,
`routes/app/persona/hub.tsx`, `routes/app/history.tsx`,
`routes/app/persona-memory.tsx`, `routes/app/persona/knowledge.tsx`,
`routes/app/settings/images.tsx`, `routes/app/persona/persona-draft.ts`,
`routes/app/persona/create.tsx`, `routes/app/persona/instructions.tsx`,
`lib/persona-hub.ts`, `content/help/*`, plus their tests.

## 2. A — Recent Chats Accordion (`routes/app/persona/hub.tsx`)

### 2.1 Placement

Directly below the action row (section A: `Continue`, `New Chat`,
`New Incognito`), above the identity hero. The `History` button is removed from
the action row; its function moves into the accordion.

### 2.2 Layout

```
COLLAPSED
┌─────────────────────────────────┐
│ ▸ Recent chats       History →  │
└─────────────────────────────────┘

EXPANDED
┌─────────────────────────────────┐
│ ▾ Recent chats                  │
│ ┌ Filter chats… ──────────────┐ │
│ └─────────────────────────────┘ │
│  Evening talk about Bach    2h  │
│  Tax return           yesterday │
│  …  (at most 10)                │
│               All in History →  │
└─────────────────────────────────┘
```

- The header row is the toggle: a `<button>` with `aria-expanded` and
  `aria-controls` covering the chevron and the "Recent chats" label.
- **Collapsed:** the right end of the header row carries a `History →` link.
  It is a separate focusable element, not part of the toggle.
- **Expanded:** the `History →` link is not rendered in the header; instead an
  `All in History →` link closes the list. It is one destination with two
  positions; the expanded label says where it leads, so it never reads as
  "more rows here".
- Styling follows the hub's existing section cards
  (`rounded-card border border-white/5 bg-white/[0.02] p-3`); the filter input
  matches the create form's inputs.

### 2.3 Contents and filtering

- Source: all chats of this persona (the same chat set the History page shows
  for `?personaId=<id>`, including its visibility gating).
- Filter: case-insensitive substring match on the chat's display title — the
  same semantics and the same `displayTitle` helper as the History page search.
- The filter runs over **all** chats of the persona; the list then shows the
  **10 most recent** matches, ordered newest first by the same recency key the
  History page uses.
- Each row: the display title (truncated, single line) and the relative time
  (`lib/relative-time.ts`). Tapping a row opens `/app/chat/<chatId>`. Rows carry
  no overflow menu.
- The filter text is component state only. It is not persisted and resets when
  the hub unmounts or the accordion collapses.

### 2.4 States

| State | Behaviour |
|---|---|
| Persona has no chats (chats **loaded** and empty) | The header toggle is **disabled**, and in place of `History →` the header shows a muted inline `No chats yet` — a visible reason, not a tooltip (tooltips do not show on touch). Disabled over hidden. |
| Filter matches nothing | One muted line `No chats match "<text>"` in place of the rows; `All in History →` stays visible (it carries the filter text — §2.5). |
| Chats still loading (`chats.data === undefined`) | Rendered as if chats exist: toggle and `History →` enabled, the list area empty (no spinner). Never flash the disabled state while loading — note `hub.tsx` ~line 171 currently folds "loading" and "empty" together into `recentChat === null`; the accordion must distinguish them. |
| Persona incomplete | The accordion is unaffected — history remains reachable for an incomplete persona with chats. |

### 2.5 Link target

Both `History →` and `All in History →` navigate to:

```
/app/history?personaId=<id>[&q=<filter>]&return=<hub path incl. its own search>
```

- `q` is set only when the filter text is non-empty (trimmed).
- `routes/app/history.tsx` reads `q` once as the initial value of its search
  field (`useState(() => search.get('q') ?? '')`). It does **not** mirror the
  search field back into the URL.
- `return` is honoured as described in §3.6, so the History page's back control
  returns to the hub (and the hub's own `?return=` survives the round trip).

### 2.6 Persisted open/closed state

- One global value for all personas, per device.
- `localStorage` key `chatsundere.hub.recentChatsOpen`, values `'1'` / `'0'`.
- Default when absent or unreadable: **collapsed**.
- Every read and write is wrapped in `try/catch`; on failure the accordion
  works in memory only.

## 3. B — Chat Quick Menu

### 3.1 Triggers

The quick menu has **two triggers and one surface**:

1. **The brand logo** (`routes/root.tsx`), on the chat route
   (`isExactChatRoute(location.pathname)`), in **both** reading and interaction
   mode.
   - It becomes a `<button>` with `aria-haspopup="menu"` and `aria-expanded`,
     accessible name `Quick menu`.
   - The `ArrowLeft` prefix is removed in reading mode. A small `▾` glyph
     (`ChevronDown`, ~14 px, `text-paper-soft`) follows the logo text in both
     modes on the chat route — a visible affordance for the menu.
   - Off the chat route, the logo is unchanged: a link to `/` with label
     `Chatsundere home`.
2. **The interaction-mode hamburger** (`components/chat/InteractionTopbar.tsx`
   ~line 70). Today it is `Exit to Entrance Hall` and navigates at once; with a
   real menu one row above it, the two controls would swap their expected
   meanings (Laura, spec-pass). It now opens the **same** quick menu, anchored
   to the hamburger, with accessible name `Quick menu` and the same ARIA
   attributes. Its `onExit` prop is replaced by an `onOpenQuickMenu(anchor)` prop.

Leaving the chat therefore costs two taps in both modes (trigger →
`Entrance Hall`), and the exit is always the menu's first entry.

### 3.2 Ownership and state

- `ChatQuickMenu` (new, `components/chat/ChatQuickMenu.tsx`) is rendered **once,
  by `routes/app/chat/chat-page.tsx`**. Chat-page owns everything the menu needs:
  `effectivePersona` (known for saved *and* lazy `/app/chat/new?personaId=…`
  chats), `activeChatId`, `onExitToEntranceHall`, and `navigate`.
- Open state lives in `state/current-chat.store.ts` as a new field
  `quickMenuAnchor: { top: number; left: number; bottom: number } | null`
  (`null` = closed) with setters `openQuickMenu(rect)` / `closeQuickMenu()`. The
  logo (in `root.tsx`, outside chat-page) and the hamburger both call
  `openQuickMenu(el.getBoundingClientRect())`. Chat-page resets it to `null` on
  unmount and on route change.
- Because the persona comes from `effectivePersona`, not from `chatHeader`, all
  entries are enabled in a lazy, not-yet-sent chat. While `effectivePersona` is
  still resolving (a momentary state on first paint), the persona group renders
  disabled with the visible secondary line `Loading persona…` — never a
  tooltip-only reason.

### 3.3 Presentation

```
Chatsundere ▾
┌────────────────────────┐ ░░░░░░░░
│ Entrance Hall          │ ░░ blur ░
│────────────────────────│ ░░░░░░░░
│ ◯ Fable                │ ░░░░░░░░
│ New chat with Fable    │ ░░░░░░░░
│ Memories               │ ░░░░░░░░
│ History                │ ░░░░░░░░
│ Knowledge              │ ░░░░░░░░
│────────────────────────│ ░░░░░░░░
│ Image settings         │ ░░░░░░░░
└────────────────────────┘ ░░░░░░░░
```

- Rendered via a portal to `<body>` so it overlays the topbar and the chat.
  The portal root carries the class `chat-quick-menu-root` (backdrop and card
  both inside it).
- A full-viewport backdrop: dimmed (`bg-black/50`) with `backdrop-blur-sm`.
  Where `backdrop-filter` is unsupported, the dimming alone suffices.
- The card is anchored to its trigger: its top-left aligns under the anchor
  rect, clamped to the 16 px viewport gutter. Minimum width 14 rem; item rows
  have at least 44 px tap height.
- The persona entry shows the persona's avatar (`PersonaAvatar`, 24 px) before
  the name, in the menu's default font.
- Two thin separators group the entries: leave / persona / settings.
- Motion: a short fade + 4 px drop-in (≤150 ms); none under
  `prefers-reduced-motion`.

### 3.4 Entries

| Entry | Action |
|---|---|
| `Entrance Hall` | `onExitToEntranceHall()` — resets interaction mode, then navigates to `/app` (the same semantics as today's hamburger). The label matches the name the place carries everywhere else. |
| `<Persona name>` | `/app/persona/<personaId>?return=<chat>` |
| `New chat with <Persona name>` | `/app/chat/new?personaId=<personaId>`. **Disabled** with the visible secondary line `You're in a new chat` when the current chat is itself a lazy, unsent chat (no `activeChatId`) — navigating there would be a no-op. |
| `Memories` | `/app/persona/<personaId>/memory?return=<chat>` |
| `History` | `/app/history?personaId=<personaId>&return=<chat>` |
| `Knowledge` | `/app/persona/<personaId>/knowledge?return=<chat>` |
| `Image settings` | `/app/settings/images?return=<chat>` |

`<chat>` is `encodeURIComponent(location.pathname + location.search)`, exactly
as `onOpenPersonaEditor` builds it today (`chat-page.tsx` ~line 527). For a
lazy chat this keeps `?personaId=`, so back returns to the same unsent chat.

Except for `Entrance Hall`, entries do not touch interaction mode: returning to
the chat finds the cockpit as the user left it (today's avatar-button
behaviour).

### 3.5 Interaction

- Opens on trigger click/tap, or Enter/Space when the trigger is focused.
- Closes on: tap on the backdrop, Escape, selecting an entry, or a route change.
  Escape inside the menu closes **only** the menu (it must not also collapse the
  cockpit).
- Implemented as `role="menu"` with `role="menuitem"` children; arrow keys move
  focus, focus moves to the first enabled item on open, and returns to the
  trigger on close (except after navigation).
- While open, the rest of the app is `inert` behind the backdrop; the backdrop
  tap is consumed (it does not reach the chat underneath — no accidental message
  expansion).
- **Cockpit interplay (Laura hard defect 1).** `InteractionMode.tsx` closes an
  unpinned cockpit on any pointerdown outside its container and swallows the
  following click. The portal is outside that container, so
  `.chat-quick-menu-root` is **added to the exemption selector** at
  `InteractionMode.tsx` ~line 132 (beside `.branch-sheet-root`, …). Result: with
  an unpinned cockpit open, one tap on an entry navigates, and a backdrop tap
  closes only the menu; the cockpit stays as it was. The existing `.brand-logo`
  exemption stays.

### 3.6 Return paths on the destinations

The persona hub already honours `?return=` via `safeReturnPath`
(`lib/safe-return.ts`) and does not change. The other four destinations gain
`?return=`, each keeping its current back target as the fallback:

| Page | File | Fallback (today's `back`) |
|---|---|---|
| Persona memory | `routes/app/persona-memory.tsx` | today's `backPath` (`?chat=<id>` → that chat, else the persona hub). `?return=` takes precedence over `?chat=`; the cockpit's existing `?chat=` links keep working unchanged. |
| Persona knowledge | `routes/app/persona/knowledge.tsx` | `/app/persona/<id>` |
| History | `routes/app/history.tsx` | `/app` |
| Image settings | `routes/app/settings/images.tsx` | `/app/settings` |

Only the `back` control uses the return path; breadcrumbs are unchanged.
`safeReturnPath` already rejects off-origin and malformed values — no new
validation. On the History page, the existing URL-mirroring of `personaId`
(`history.tsx` ~lines 64–72) must preserve the `return` and `q` params rather
than dropping them.

## 4. C — Default Persona Instructions

### 4.1 The default

- New exported constant `DEFAULT_PERSONA_INSTRUCTIONS = 'You are a friendly assistant.'`,
  placed beside the draft factory in `routes/app/persona/persona-draft.ts`.
- New persona drafts start with `instructions: DEFAULT_PERSONA_INSTRUCTIONS`
  (today `''`, `persona-draft.ts:27`).
- Import with overwrite (`create.tsx` `onApplyImport`): if the imported
  instructions are empty after trimming, the default is used instead.
- Consequence: a new persona needs only a model to be chat-ready.
- Existing personas are not modified.

### 4.2 Clear on focus, restore on empty blur

Wherever the persona instructions field is editable (today: the Custom
Instructions field on `routes/app/persona/instructions.tsx`, an
`InlineEditTextarea`):

- **On focus:** if the field's value is **exactly** `DEFAULT_PERSONA_INSTRUCTIONS`,
  the field is cleared. Any other value — including the default with an edit —
  is left alone.
- **On blur:** if the value is empty after trimming **and** the value at focus
  time was the default, the draft is reset to the default. That is no change
  against the stored value, so no write happens (`InlineEditTextarea`'s
  unchanged-value de-dupe, ~line 49, already skips it) — tabbing through the
  field never causes a sync write.
  If the value at focus time was something else, today's behaviour stands
  (empty saves as empty).
- The behaviour lives in the instructions page (or a small wrapper there), not
  in the shared `InlineEditTextarea`, which serves other fields.

### 4.3 Interaction with "incomplete"

No change to the incomplete rule itself (empty instructions or no model). The
default simply means a fresh persona is no longer incomplete on instructions.

**Cue copy (Laura hard defect 2).** The hub's incomplete cue (`hub.tsx` ~line
408) today always reads `Add an instruction and pick a model, then <name> can
chat.` With the default, "only the model is missing" becomes the usual case, so
the cue would tell the user to add something that already exists. The cue is
derived from what is missing, reusing `missingRequirement(persona)` (already
used at `hub.tsx` ~line 459):

| Missing | Cue |
|---|---|
| model only | `Pick a model, then <name> can chat.` |
| instruction only | `Add an instruction, then <name> can chat.` |
| both | `Add an instruction and pick a model, then <name> can chat.` (unchanged) |

`<name>` falls back to `this persona` as today.

### 4.4 Default visible on the hub

The create form has no instructions field, so a user never sees that a new
persona runs on the default. `instructionsMeta` (`lib/persona-hub.ts` ~line 18)
prefixes `Default · ` when `instructions === DEFAULT_PERSONA_INSTRUCTIONS`
(e.g. `Default · Chatsundere voice`) — a quiet invitation to personalise, not a
nag. `DEFAULT_PERSONA_INSTRUCTIONS` is imported from `persona-draft.ts`.

## 5. Testing

### 5.1 Automated — Vitest (`apps/user-client`)

**Accordion (`tests/routes/persona-hub-recent-chats.test.tsx`):**

- Collapsed by default with no stored value; `History →` visible, no list.
- Toggle expands; the stored value becomes `'1'`; a re-mount reads it back
  expanded; collapsing writes `'0'`.
- `localStorage` throwing on get/set: the accordion still toggles.
- With 15 chats: exactly the 10 newest render, newest first.
- Filter: matches across all 15 (a match only in chat #14 appears); case
  insensitive; at most 10 matches shown.
- No matches: the empty line renders and `All in History →` stays.
- Zero chats (loaded): toggle disabled, `No chats yet` visible, no `History →`.
- Chats loading (`undefined`): toggle and `History →` enabled, not disabled.
- `All in History →` / `History →` hrefs carry `personaId`, `q` (only when
  non-empty), and `return`.
- Row tap navigates to `/app/chat/<id>`.
- The action row no longer contains a `History` button.

**History page (`tests/routes/history.test.tsx`, extend):**

- `?q=abc` pre-fills the search field and filters.
- `?return=/app/persona/p1` drives the back control; the personaId mirroring
  keeps `return` and `q`.

**Quick menu (`tests/components/chat-quick-menu.test.tsx`):**

- On the chat route the logo is a button named `Quick menu`; off the chat
  route it is the `/` link with label `Chatsundere home`.
- The interaction-mode hamburger is a button named `Quick menu` and opens the
  same menu (no immediate navigation).
- Opens on click; seven entries in order; Escape and backdrop close it.
- Each entry navigates to its target with the encoded chat return path;
  `Entrance Hall` also resets interaction mode.
- Lazy chat (`/app/chat/new?personaId=p1`, no `activeChatId`): all persona
  entries enabled; `New chat with …` disabled with `You're in a new chat`
  visible; the return path keeps `?personaId=p1`.
- **Cockpit interplay:** with an unpinned cockpit open, open the menu, tap one
  entry once — it navigates (the click is not swallowed). Backdrop tap and
  Escape close only the menu; the cockpit stays open.

**Hub cue:** a persona with the default instruction and no model shows
`Pick a model, then <name> can chat.`; one with neither shows the combined copy.

**Instructions tile meta:** default instruction → `Default · …`; any other
non-empty instruction → unchanged meta.

**Return paths:** one test per destination (memory, knowledge, images) that
`?return=` drives the back control and an off-origin value falls back; for
memory, `?return=` beats `?chat=` and `?chat=` alone still works.

**Default instructions (`tests/routes/persona-instructions-default.test.tsx`):**

- `defaultDraft()` yields the default.
- Focus on the exact default clears the field; blur while empty restores the
  default and performs **no** write.
- Focus on an edited default (`You are a friendly assistant. And funny.`) does
  not clear.
- Focus on a non-default value, clear, blur: saves empty (unchanged behaviour).
- Import with empty instructions + overwrite yields the default.

### 5.2 Gates

- `pnpm typecheck` (forced — `--force`), `pnpm run build`, Biome, full Vitest
  run for `apps/user-client`. The known 8-failure Node-localStorage baseline
  applies; a ninth failure is real.

## 6. Manual Verification (Chris, on device at 380 px and desktop)

1. Open a persona with many chats. The accordion sits under the action row,
   collapsed, with `History →` on the right. `History` is gone from the button row.
2. Expand. Ten newest chats show. Type part of an old chat's title — it appears.
3. Tap `All in History →`. The History page opens filtered to this persona with
   the search pre-filled. Back returns to the persona hub.
4. Reload the app, open a different persona: the accordion is still expanded.
   At 380 px with 10+ chats, judge how far the identity hero is pushed down —
   acceptable or not? Collapse it, open a third persona: collapsed.
5. A persona without chats: accordion disabled, `No chats yet` visible in the
   header.
6. In a chat (reading mode): the logo shows `Chatsundere ▾`, no arrow. Tap it:
   the menu drops from the logo, background dimmed and blurred.
7. Try every entry; on each destination, the back control returns to the chat.
   `Entrance Hall` lands in the Entrance Hall; opening another chat afterwards
   starts in reading mode.
8. Open the cockpit (interaction mode, unpinned). Tap the logo: the menu opens.
   Tap the backdrop: only the menu closes, the cockpit stays. Open it again and
   tap `Memories` once: it navigates on the first tap.
9. In interaction mode, tap the hamburger: the same menu opens, anchored to it.
10. Start a new chat but do not send: the menu's persona entries all work;
    `New chat with …` is greyed out with `You're in a new chat`. From
    `Knowledge`, back returns to the unsent chat.
11. Create a new persona: the hub cue reads `Pick a model, then … can chat.`
    and the Instructions tile reads `Default · …`. Pick a model: `New Chat` is
    enabled immediately.
12. Open its Instructions: tap the custom-instructions field — the default
    disappears. Tap away without typing — it comes back. Type something — it saves.

## 7. Documentation

- Help copy: check `content/help/` for references to the hub's History button
  or the logo as "leave chat" and update them (British English).
- `obsidian/STATUS-CLIENT-ONLY.md`: Current entry at squash time.

## 8. Audits

- **Laura spec-pass** — done 2026-10-07: 3 hard defects (quick-menu taps
  swallowed by the unpinned cockpit; misleading incomplete cue; disabled
  persona entries in a lazy chat), all folded in (§3.2, §3.5, §4.3). Soft
  findings adopted with Chris: hamburger opens the same menu, `Entrance Hall`
  label with exit semantics, `All in History →`, `New chat with …` entry,
  visible zero-chat reason, no-write restore, `Default ·` tile meta. Kept
  against her alternative: clear-on-focus (Chris's choice over select-all).
  Logged as follow-up: the hub's `My Circle` crumb follows `?return=` and can
  lead to a chat (pre-existing, `hub.tsx` ~line 341) — record in
  `obsidian/insights/ux-deferrals.md` during implementation.
- **Laura pre-squash pass** on the built diff.
- **Larissa:** not required — frontend-only, no auth/sync/proxy/crypto surface.
  The `?return=` additions reuse the existing `safeReturnPath` validator; that
  reuse is the only security-relevant point and is covered by tests.
