# Persona Quick Access — Design Specification

**Date:** 2026-10-07 · **Author:** Liz, brainstormed with Chris · **Status:** approved in conversation by Chris (2026-10-07), pending written-spec review and Laura spec-pass

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
- **B.** A chat quick menu opened from the brand logo on the chat route (§3).
- **C.** A default persona instruction that clears on focus (§4).
- `?return=` support on the three quick-menu destinations that lack a return path (§3.5).

### 1.3 Out of scope

- Any change to the global `/app/history` page beyond reading `?q=` and
  `?return=` (§2.5, §3.5).
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
│                       More…  →  │
└─────────────────────────────────┘
```

- The header row is the toggle: a `<button>` with `aria-expanded` and
  `aria-controls` covering the chevron and the "Recent chats" label.
- **Collapsed:** the right end of the header row carries a `History →` link.
  It is a separate focusable element, not part of the toggle.
- **Expanded:** the `History →` link is not rendered in the header; instead a
  `More… →` link closes the list. It is one destination with two positions —
  the label reflects the state.
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
| Persona has no chats | The header toggle and `History →` are rendered **disabled** with the tooltip `No chats with this persona yet` (the existing History button's copy). Disabled over hidden. |
| Filter matches nothing | One muted line `No chats match "<text>"` in place of the rows; `More… →` stays visible (it carries the filter text — §2.5). |
| Chats still loading | The list area renders empty (no spinner); the toggle stays usable. |
| Persona incomplete | The accordion is unaffected — history remains reachable for an incomplete persona with chats. |

### 2.5 Link target

Both `History →` and `More… →` navigate to:

```
/app/history?personaId=<id>[&q=<filter>]&return=<hub path incl. its own search>
```

- `q` is set only when the filter text is non-empty (trimmed).
- `routes/app/history.tsx` reads `q` once as the initial value of its search
  field (`useState(() => search.get('q') ?? '')`). It does **not** mirror the
  search field back into the URL.
- `return` is honoured as described in §3.5, so the History page's back control
  returns to the hub (and the hub's own `?return=` survives the round trip).

### 2.6 Persisted open/closed state

- One global value for all personas, per device.
- `localStorage` key `chatsundere.hub.recentChatsOpen`, values `'1'` / `'0'`.
- Default when absent or unreadable: **collapsed**.
- Every read and write is wrapped in `try/catch`; on failure the accordion
  works in memory only.

## 3. B — Chat Quick Menu

### 3.1 Trigger

- Only on the chat route (`isExactChatRoute(location.pathname)`), in **both**
  reading and interaction mode.
- The brand logo becomes a `<button>` with `aria-haspopup="menu"` and
  `aria-expanded`, accessible name `Quick menu`.
- The `ArrowLeft` prefix is removed in reading mode. A small `▾` glyph
  (`ChevronDown`, ~14 px, `text-paper-soft`) follows the logo text in both
  modes on the chat route — a visible affordance for the menu.
- Off the chat route, the logo is unchanged: a link to `/` with label
  `Chatsundere home`.
- The existing `InteractionMode.tsx` outside-pointer exemption for
  `.brand-logo` stays; it now lets the tap open the menu instead of navigating.
  Opening the menu does not change the cockpit's open/pinned state.

### 3.2 Presentation

```
Chatsundere ▾
┌──────────────────┐ ░░░░░░░░
│ Main menu        │ ░░ blur ░
│──────────────────│ ░░░░░░░░
│ ◯ Fable          │ ░░░░░░░░
│ Memories         │ ░░░░░░░░
│ History          │ ░░░░░░░░
│ Knowledge        │ ░░░░░░░░
│──────────────────│ ░░░░░░░░
│ Image settings   │ ░░░░░░░░
└──────────────────┘ ░░░░░░░░
```

- A new component `components/chat/ChatQuickMenu.tsx`, rendered via a portal to
  `<body>` so it overlays the topbar and the chat.
- A full-viewport backdrop: dimmed (`bg-black/50`) with `backdrop-blur-sm`.
  Where `backdrop-filter` is unsupported, the dimming alone suffices.
- The card is anchored to the logo: its top-left aligns under the logo's
  bounding rect (computed on open), clamped to the 16 px viewport gutter.
  Minimum width 14 rem; item rows have at least 44 px tap height.
- The persona entry shows the persona's avatar (`PersonaAvatar`, 24 px) before
  the name, in the menu's default font.
- Two thin separators group the entries: navigation-out / persona / settings.
- Motion: a short fade + 4 px drop-in (≤150 ms); none under
  `prefers-reduced-motion`.

### 3.3 Entries

| Entry | Target |
|---|---|
| `Main menu` | `/app` (the Entrance Hall — the logo's previous destination) |
| `<Persona name>` | `/app/persona/<personaId>?return=<chat>` |
| `Memories` | `/app/persona/<personaId>/memory?chat=<chatId>` (the memory page's existing cockpit convention — its back control already returns to the chat) |
| `History` | `/app/history?personaId=<personaId>&return=<chat>` |
| `Knowledge` | `/app/persona/<personaId>/knowledge?return=<chat>` |
| `Image settings` | `/app/settings/images?return=<chat>` |

`<chat>` is `encodeURIComponent(location.pathname + location.search)`, exactly
as the topbar's persona-avatar button builds it today.

The persona identity comes from `useCurrentChatStore((s) => s.chatHeader)`. When
`chatHeader` is `null` (e.g. a fresh `/app/chat/new` before the header is set),
the four persona entries render **disabled** with the label `Persona` and the
tooltip `Available once the chat has loaded`; `Main menu` and `Image settings`
stay enabled.

### 3.4 Interaction

- Opens on logo click/tap, or Enter/Space when the logo is focused.
- Closes on: tap on the backdrop, Escape, selecting an entry, or a route change.
- Implemented as `role="menu"` with `role="menuitem"` children; arrow keys move
  focus, focus moves to the first enabled item on open, and returns to the logo
  on close (except after navigation).
- While open, the rest of the app is `inert` behind the backdrop; the backdrop
  tap is consumed (it does not reach the chat underneath — no accidental message
  expansion).

### 3.5 `?return=` on the destinations

The persona hub already honours `?return=` via `safeReturnPath`
(`lib/safe-return.ts`), and the memory page already returns to the chat via its
existing `?chat=<chatId>` parameter (`persona-memory.tsx` ~line 59) — neither
changes. The other three destinations gain `?return=`, each with its current
back target as the fallback:

| Page | File | Fallback (today's `back`) |
|---|---|---|
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
  time was the default, the default is restored and saved (no empty save).
  If the value at focus time was something else, today's behaviour stands
  (empty saves as empty).
- The behaviour lives in the instructions page (or a small wrapper there), not
  in the shared `InlineEditTextarea`, which serves other fields.

### 4.3 Interaction with "incomplete"

No change to the incomplete rule itself (empty instructions or no model). The
default simply means a fresh persona is no longer incomplete on instructions.

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
- No matches: the empty line renders and `More… →` stays.
- Zero chats: toggle and `History →` disabled with the tooltip.
- `More… →` / `History →` hrefs carry `personaId`, `q` (only when non-empty),
  and `return`.
- Row tap navigates to `/app/chat/<id>`.
- The action row no longer contains a `History` button.

**History page (`tests/routes/history.test.tsx`, extend):**

- `?q=abc` pre-fills the search field and filters.
- `?return=/app/persona/p1` drives the back control; the personaId mirroring
  keeps `return` and `q`.

**Quick menu (`tests/components/chat-quick-menu.test.tsx`):**

- On the chat route the logo is a button named `Quick menu`; off the chat
  route it is the `/` link.
- Opens on click; six entries in order; Escape and backdrop close it.
- Each entry navigates to its target with the encoded chat return path.
- `chatHeader === null`: persona entries disabled, `Main menu` and
  `Image settings` enabled.
- Works in interaction mode (the cockpit's outside-pointer handler does not
  swallow the logo tap).

**Return paths:** one test per destination (knowledge, images) that
`?return=` drives the back control and an off-origin value falls back.

**Default instructions (`tests/routes/persona-instructions-default.test.tsx`):**

- `defaultDraft()` yields the default.
- Focus on the exact default clears the field; blur while empty restores and
  saves the default.
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
3. Tap `More… →`. The History page opens filtered to this persona with the
   search pre-filled. Back returns to the persona hub.
4. Reload the app, open a different persona: the accordion is still expanded.
   Collapse it, open a third persona: collapsed.
5. A persona without chats: accordion disabled, tooltip explains why.
6. In a chat (reading mode): the logo shows `Chatsundere ▾`, no arrow. Tap it:
   the menu drops from the logo, background dimmed and blurred.
7. Try every entry; on each destination, the back control returns to the chat.
8. Open the cockpit (interaction mode, unpinned) and tap the logo: the menu
   opens; nothing in the chat underneath reacts.
9. Create a new persona, pick a model: `New Chat` is enabled immediately.
10. Open its Instructions: tap the custom-instructions field — the default
    disappears. Tap away without typing — it comes back. Type something — it saves.

## 7. Documentation

- Help copy: check `content/help/` for references to the hub's History button
  or the logo as "leave chat" and update them (British English).
- `obsidian/STATUS-CLIENT-ONLY.md`: Current entry at squash time.

## 8. Audits

- **Laura spec-pass** on this document before the plan is written (flows change:
  history reachability, logo affordance, default copy).
- **Laura pre-squash pass** on the built diff.
- **Larissa:** not required — frontend-only, no auth/sync/proxy/crypto surface.
  The `?return=` additions reuse the existing `safeReturnPath` validator; that
  reuse is the only security-relevant point and is covered by tests.
