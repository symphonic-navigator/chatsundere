# Desktop UI Iteration 1 — Wider Chat, User-Message Bubbles, Permanent Cockpit

**Date:** 2026-07-18
**Status:** Draft — awaiting Laura spec-pass + Chris review
**Scope:** `apps/user-client` only. Client-only; no server, no `packages/*`, no Dexie change.

## 1. Goal and principle

Chatsundere's UI is mobile-first at 380 px, with desktop as a constrained-width
version of the same UI (CLAUDE.md §3.4). This iteration keeps that principle —
same UI, same flows, same components — but adds three deliberate, targeted
desktop refinements that make the chat feel at home on a large screen:

1. A wider chat column (640 px → 896 px).
2. User messages rendered as left-aligned bubbles (persona text stays open).
3. The cockpit permanently open — desktop has a single chat mode, and the
   pin button disappears there.

Everything in this spec applies **only at and above the existing `lg`
breakpoint (1024 px)** — the project's single breakpoint. No new breakpoint
is introduced. Below `lg` the app is unchanged, with a single deliberate
exception: the §5.6 repair of a pre-existing broken-model dead state, which
improves mobile as a side effect of the shared mechanism.

A future iteration may add left/right sidebars; that is explicitly **out of
scope** here (§9).

## 2. Governance: ADR + CLAUDE.md amendment

Hard rule §3.4 currently reads "Desktop is a constrained-width version of the
same UI." This iteration consciously refines that rule rather than silently
drifting from it:

- **New ADR `obsidian/decisions/0036-desktop-refinements-within-single-ui.md`**
  (Nygard style): desktop remains the same UI — same routes, same components,
  same flows — but may receive targeted, `lg`-gated refinements (width,
  message presentation, cockpit persistence) where the mobile constraint
  exists only because of mobile's limits, not as a design value. Mobile-first
  remains the design root; desktop refinements must never fork flows or add
  desktop-only features. The ADR also records the pin button's
  removed-not-disabled exception to §11 (Laura spec-pass soft; see §5.4) so
  the exception is discoverable next to the rule it bends.
- **CLAUDE.md §3.4 amendment** (same commit): "Mobile-first UI at 380 px.
  Desktop is the same UI with targeted `lg`-gated refinements (see ADR 0036);
  single `lg` breakpoint (1024 px) — tablets are phones."

## 3. Wider chat column (896 px)

Only the **chat route** widens; every other page keeps its current 640 px
desktop width.

The chat surface is **not** laid out by root.tsx's `<main>`: `.chat-page` is
`position: fixed` with its own centred `max-width` (`index.css:1912-1944`)
and escapes the `<main>` flow entirely. Two places therefore define the
chat's desktop width, and only these two change:

- `apps/user-client/src/index.css` — the `.chat-page` `lg` media block
  (`index.css:1936-1940`): `max-width: 640px` → `max-width: 56rem` (896 px).
- `apps/user-client/src/routes/root.tsx:125` — the chat-route brand bar
  (which must stay aligned with the chat column): `lg:max-w-[640px]` →
  `lg:max-w-4xl` (896 px). This line is already inside the `isChatRoute`
  branch; no new conditional needed.

The shared `<main>` (`root.tsx:219`) is **untouched** — every non-chat page,
including the chat sub-pages `/app/chat/:id/{bookmarks,artefacts,knowledge}`,
keeps its 640 px. The chat topbar, `ChatStream`, and the cockpit all live
inside `.chat-page` and widen with it — no per-component width work. The
cockpit's composer spans the full 896 px column; acceptable for iteration 1.
The global `.toast-stack` (`index.css:1966-1970`) deliberately stays at
640 px — toasts are app-wide and overlay-centred; a narrower toast over a
wider chat is fine, a 896 px toast over a 640 px page is not.

Rationale for 896 px: ~80 % of chat time is reading; 896 px (`max-w-4xl`) is
a widely used chat-column width, and with user bubbles capped at 85 % (§4)
per-element line length stays in the readable range.

Known, accepted polish note (Laura): navigating chat → bookmarks/artefacts/
knowledge → back snaps the column 896 ↔ 640. Conscious for iteration 1; a
later pass may widen the sub-pages if the snap proves distracting.

## 4. User-message bubbles on desktop

Today (`index.css:520-532`) both roles are transparent full-width text
blocks; user messages are distinguished purely by `text-align: right`. At
896 px, right-aligned ragged text is unpleasant to read, and the alignment
flip is the only role cue.

At `lg` and above (CSS only — **no markup change**, `MessageBlock.tsx`
untouched):

- `.msg.from-user`:
  - `text-align: left` (overriding the mobile right-alignment);
  - a bubble surface: subtle ink tint consistent with the Aurora dark theme
    (e.g. `background: rgba(255, 255, 255, 0.05)` with a faint
    1 px `rgba(255, 255, 255, 0.06)` ring — exact values are the
    implementer's call within the theme, restrained over loud);
  - `border-radius: 0.75rem`, padding slightly up from the shared `.msg`
    padding (e.g. `0.6rem 0.9rem`);
  - content-sized: `width: fit-content; max-width: 85%;` so a short "yes"
    stays a small pill and a long prompt wraps at a readable measure. Not
    right-shifted — the bubble sits on the left edge like everything else.
- `.msg.from-persona`: unchanged — open text across the full column. This is
  the deliberate asymmetry (Claude.ai/ChatGPT-style): the persona's long-form
  Markdown (headings, lists, code, pills) reads best unboxed.
- `.msg-name` header and `.msg-timestamp` stay on both roles (they are the
  primary role cue once alignment no longer differs); inside a user bubble
  they inherit the new left alignment automatically.
- Message-level affordances (tap-to-expand, `MessageControls`, edit entry,
  attachment strips, primer pills) are markup-level and unaffected; verify
  visually that `MessageControls` sits sensibly under the bubble (it flows
  with the left-aligned content).

Below `lg`, none of these rules apply — mobile keeps right-aligned
transparent user messages.

## 5. Permanent cockpit on desktop

### 5.1 Model

Mobile keeps its two chat modes: **reading** (thin brand-bar chrome,
`BottomAffordance` as the "open the cockpit" cue) and **interaction**
(`InteractionTopbar` + cockpit; unpinned auto-closes and dims, pinned stays).

Desktop gets **one mode**: always interaction, always pinned-semantics.
Concretely, desktop behaves as if `isInteractionMode === true` and
`isPinned === true` at all times, without writing either into the store.

Nothing user-reachable is lost in the merge: the `InteractionTopbar` already
carries the exit affordance ("Exit to Entrance Hall"), the persona avatar
(navigating to the persona hub with `?return`, identical to the reading
topbar's avatar — `chat-page.tsx:533-537`), the chat title with rename, and
the context gauge. The reading topbar's title display and avatar therefore
have equivalents; the zen/dim reading treatment is the one thing desktop
gives up, deliberately — at 896 px the cockpit does not crowd the text.

### 5.2 Mechanism: derived, not stored

New module `apps/user-client/src/state/effective-chat-mode.ts`:

- `useIsDesktop(): boolean` — reactive `window.matchMedia('(min-width: 1024px)')`
  subscription (`useSyncExternalStore` or equivalent listener effect). Guard
  for environments without `matchMedia` (jsdom default) by returning `false`
  — tests then exercise mobile behaviour unless they mock the hook. The
  1024 px value must be the single definition (exported constant) with a
  comment tying it to the Tailwind `lg` breakpoint.
- `useEffectiveChatMode(): { isInteractionMode: boolean; isPinned: boolean }`
  — `isDesktop || store value` for both flags.

The store (`state/current-chat.store.ts`) is **not** modified: no writes on
resize, no new fields. Because both flags are derived at read time, dragging
a window across 1024 px in either direction just works — widening opens the
cockpit, narrowing returns to whatever the store last said (typically
reading mode).

### 5.3 Consumption sites (complete sweep)

Every behavioural read of `isInteractionMode` / `isPinned` moves to the
effective hook. Known sites:

| File | Lines | Effect on desktop |
|---|---|---|
| `routes/root.tsx` | 47, 56 | `isReadingChat` always false on a chat route → brand bar keeps the interaction (dark-fill) treatment; reading-only avatar/title in the root header never render (equivalents live in `InteractionTopbar`). |
| `routes/app/chat/chat-page.tsx` | 99, 101 → 474, 739, 776, 803, 993, 1129, 1134 | `data-mode` always `interaction`; tap-message auto-enter effect (474-485) inert; `BottomAffordance` (993) never renders; `DimOverlay` (1129) never active; `InteractionMode` (1134) mounted whenever a persona is resolved (incl. during live voice — the pinned branch; see §5.6 for the `offering === null` split); live-voice hold-on-focus (739) uses effective pin. |
| `components/chat/InteractionMode.tsx` | 75, 95, 154 | Outside-tap close and send-close disabled (pinned semantics). |
| `components/chat/Cockpit.tsx` | 125 | `data-pinned` always `true`; pin button (≈565-575) **not rendered** on desktop (see §5.4). |
| `components/chat/ChatStream.tsx` | 109, 277 | `MessageBlock`'s `isPinned` prop (focus-shed tap behaviour) receives the effective value. |

`chat-page.tsx:151` (edit entry force-pins via `togglePin()`) stays as-is: it
reads and writes the **store**, which remains the mobile source of truth; on
desktop the effective value is already `true` and a redundant store flip is
harmless. The implementer must do a final `rg -n "isPinned|isInteractionMode"`
sweep to catch any site this table missed and route it through the hook
(store-internal reads and the store definition itself excepted).

**Exception — the lazy-chat mount effect writes are desktop-gated** (Laura
spec-pass soft, folded): the mount effect for a newly-created lazy chat
(`chat-page.tsx:146-156`) writes `setInteractionMode(true)` and force-pins
the **store**. On desktop those writes must be skipped (`!useIsDesktop()`):
the effective values are already `true`, and a store write would leak
desktop state into mobile — after composing a fresh chat on desktop and then
narrowing the window below 1024 px, the user would land in a pinned cockpit
instead of reading mode, unlike every pre-existing chat. Skipping the writes
keeps the store clean and the "derived, not stored" model true. (The
edit-entry force-pin at :151 is different: it encodes *editing* intent, not
desktop presence, and stays unconditional.)

### 5.4 Pin button

On desktop the pin control is meaningless (nothing to toggle), so it is
**removed, not disabled**: `Cockpit.tsx` renders the pin `cockpit-icon-btn`
only when `useIsDesktop()` is false. This is a conscious, narrow exception to
"disabled over hidden" (CLAUDE.md §11): the capability itself does not exist
on desktop — there is no state the button could ever reach — so a greyed-out
pin with a tooltip would advertise a phantom. (Same reasoning class as the
admin tile's hidden-not-disabled exception, spec 2026-07-05 §4.2.)

Conditional render (not CSS `display: none`) keeps the DOM honest for
assistive tech and makes the behaviour unit-testable.

### 5.5 Consequences accepted

- **No zen mode on desktop** — no dimmed, cockpit-free reading state. Chris's
  call, core to "cockpit always open". Named trade (Laura): the desktop chat
  loses the one surface that was pure invitation — a composer is always in
  view. The dwelling capability itself survives (896 px, free scroll, open
  persona text). Logged in `obsidian/insights/ux-deferrals.md`; if
  field-testing ever reads it as nagging, a lightweight desktop "focus read"
  affordance (hide composer chrome without reintroducing the two-mode
  machinery) is the sketched remedy.
- **Live voice keeps the cockpit visible** (`chat-page.tsx:1134` pinned
  branch). Desktop has the space; the live-voice bar and cockpit coexist as
  they already do for pinned mobile users.
- **Send does not close the cockpit** (pinned semantics) — on desktop the
  composer keeps focus after send, which is exactly the desktop expectation.

### 5.6 The `offering === null` state (Laura spec-pass soft, folded)

`offering` (`chat-page.tsx:273`) is persistently `null` when a chat
references a removed or unresolvable model. Today the whole
`InteractionMode` mount is gated on it (`chat-page.tsx:1134`), which on
desktop would mean: no cockpit, no `InteractionTopbar`, no
`BottomAffordance` (suppressed by effective interaction mode), no
reading-topbar avatar/title (root header is in interaction treatment) —
i.e. no reachable path to the persona hub, the exact surface that fixes a
broken model. Mobile has a milder pre-existing variant of the same gap
(tapping `BottomAffordance` with a null offering mounts nothing).

Fix, both breakpoints (one mechanism, no desktop fork):

- `InteractionMode` accepts `offering: Offering | null`. The
  **`InteractionTopbar` mounts whenever persona + chat are resolved**
  (exit, avatar, title, rename all work); the context gauge renders an
  inert placeholder when `offering` is null (`resolveContextWindow` is
  only called with a non-null offering).
- The **`Cockpit` renders only when `offering` is non-null** — composing
  against no model stays impossible, exactly as today.
- The mount guard at `chat-page.tsx:1134` drops its `offering` condition
  (keeps `effectivePersona` and the live-voice branch).

Net effect on desktop: a broken-model chat still shows the permanent topbar
with the persona avatar (the repair path). Net effect on mobile: the
`BottomAffordance` tap now opens the topbar with the exit + avatar instead
of nothing — a strict improvement of a pre-existing dead state.

## 6. Explicitly unchanged

- Mobile (< 1024 px): everything — modes, pin, dim, alignment, widths —
  except the §5.6 broken-model repair noted in §1.
- The `current-chat.store` shape and persistence.
- `MessageBlock`/`ChatStream` markup; Markdown, pills, attachments, editing,
  voice, screen effects.
- All non-chat routes' widths; the chat sub-pages (bookmarks/artefacts/
  knowledge) stay 640 px.
- `isPinned` semantics on mobile, including edit-entry force-pin.

## 7. Testing

Vitest (jsdom, mocking `useIsDesktop` / `matchMedia` where needed):

1. `effective-chat-mode`: returns store values when not desktop; forces
   `{ isInteractionMode: true, isPinned: true }` when desktop; reacts to a
   mocked media-query flip.
2. `chat-page` at desktop: `BottomAffordance` absent, `InteractionMode`
   mounted, `data-mode="interaction"` — without any store write.
3. `chat-page` at mobile: existing behaviour unchanged (guard test).
4. `Cockpit`: pin button present at mobile, absent at desktop.
5. `InteractionMode` at desktop: outside-tap does not close (pinned path).
6. `offering === null` (§5.6): topbar mounts with persona + chat on both
   breakpoints; cockpit absent; gauge placeholder rendered; on mobile the
   `BottomAffordance` tap now reaches the topbar.
7. Lazy-chat mount effect (§5.3 exception): store writes happen at mobile,
   are skipped at desktop (store stays `{ isInteractionMode: false,
   isPinned: false }` after a desktop lazy-chat mount).

CSS (widths, bubbles) is not unit-tested — covered by §8.

## 8. Manual verification (Chris, on device)

Desktop browser ≥ 1024 px wide:

1. Open a chat: cockpit is open on entry, no `BottomAffordance`, no pin icon
   in the cockpit; topbar shows avatar, title (rename works), gauge.
2. Chat column is visibly wider (896 px); other pages (Entrance Hall,
   settings, chat's bookmarks page) keep their previous width.
3. User messages: left-aligned bubbles, content-sized (short message = small
   pill, long message wraps ≤ 85 % column); persona replies remain open text.
   Markdown, pills, and attachments render normally in both. Cross-cases
   (Laura): tap-expand a **short** user message — the bubble may widen to
   fit the controls row (accepted; controls must be reachable); a user
   message **with an image attachment** sizes to its attachment strip
   within the 85 % cap. Both should look intentional, not broken.
4. Click into empty space / send a message: cockpit stays open, no dimming;
   after send the composer keeps focus.
5. Edit one of your messages: composer loads it, Replace/Branch control
   works as on mobile.
6. Live voice: cockpit remains visible.
7. Resize the window below 1024 px: mobile look returns (right-aligned
   plain user messages, cockpit closes to reading mode + `BottomAffordance`,
   pin button back); resize up again: cockpit reopens. No stuck states.
8. On a phone (380 px): spot-check that chat looks exactly as before.
9. Broken-model state (§5.6): point a chat at a removed model (or remove
   the provider): the topbar with the persona avatar stays reachable on
   desktop; on mobile, opening the cockpit cue shows the topbar instead of
   nothing.

## 9. Out of scope (future iterations)

- Left/right sidebars (navigation / context surfaces) — next iteration,
  needs its own brainstorm; nothing here may block it, but nothing
  anticipates it either.
- Bubble styling beyond the restrained baseline (accent tints per persona,
  mindspace-coloured bubbles) — a styling pass, separate.
- Desktop-specific keyboard affordances (e.g. keyboard shortcuts overlay).

## 10. Audit gates

- **Laura spec-pass** before the plan (this spec changes user-reachable
  states and the reachability of the pin/zen functions on desktop).
- **Laura pre-squash pass** after the build.
- **Not a Larissa path** (client-only presentation/state derivation; no
  auth/sync/proxy/crypto surface).
