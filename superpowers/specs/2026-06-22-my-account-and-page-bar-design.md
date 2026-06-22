# My Account & the Page Bar — Design Spec

**Date:** 2026-06-22
**Author:** Liz (with Chris)
**Status:** Draft for review
**Slice of:** the UI/UX makeover (after design-language foundations `982ea9f5` and the main-menu rebuild `7bb552f7`)

---

## 1. Context & goals

This is the next makeover slice — a deliberately small surface to *practise* the
next step (sub-pages, shared page chrome, an auto-save model, a reading overlay)
before the bigger rooms and, last, the chat.

Two things ship together:

1. **The Page Bar** — a new shared chrome row beneath the global brand bar. It
   gives every "page" (this slice: the My Account tree) a consistent way to show
   *where you are*, *where Back returns you*, and a `?` into contextual help. It
   replaces the old `Save & Back` model with **always-save** semantics.
2. **My Account** — `/app/account` rebuilt in the design language as a dashboard
   plus a 2×3 navigation matrix, with six sub-pages, plus a **Markdown Reading
   Overlay** for help/legal/long-text display.

### Goals

- A user always sees their location and the Back target (breadcrumbs).
- Nothing is lost between the current account surface and the new one — every
  existing capability has a home (see §13 for the carry-over audit).
- "Don't make me think": one intent per surface, opinionated defaults, no
  Save buttons to forget to press.
- Consistency with the landed primitives (`NavTile`, `Button`, `ConfirmDialog`,
  the origin-aware zoom) and the colour/motion language.

### Non-goals (this slice)

- Migrating Settings, Persona Editor, Circle, History, etc. to the Page Bar.
  The Page Bar is built **reusable** but wired only to the My Account tree now.
  Those surfaces migrate in their own slices. (Circle/History already use
  `ListScaffold`; its header is the eventual merge target for the Page Bar.)
- Backend/sync work. Everything here is client-only (no Larissa gate; Laura
  spec-pass yes).
- The "Documentation" external link from the old About (dropped for the alpha;
  the docs site does not exist yet — re-add on request).

---

## 2. The Page Bar

A horizontal chrome row that sits **directly under the global brand bar**
(`root.tsx` `<header>`, `sticky top-0 z-20`). The Page Bar is `sticky` at
`top-13 lg:top-15` (the same offset `EditorSticky` uses today), `z-10`, with a
blur backdrop and a thin bottom divider so it reads unmistakably as **chrome**,
not page content. **It never scrolls away**; the page content beneath it is the
scroll region.

### 2.1 Anatomy (left → right)

- **Breadcrumb trail** (left, takes remaining width): the path as tappable
  crumbs. The **current** crumb is bold/emphasised and non-interactive; every
  **ancestor** crumb is a real, obviously-tappable button that navigates there.
  The leading `‹` chevron + the leftmost ancestor crumb form a **single back
  control with a ≥44×44 hit area** — matching the `ListScaffold` fixed-back
  contract Laura already vetted at foundations. It is a control, not decoration:
  on an installed PWA / iOS standalone (no hardware Back), this in-page control is
  the user's exit and must be visibly hittable, never a mere label. (Laura
  HARD-1.)
- **`?` help affordance** (right, fixed 44×44 hit area): opens the page's help
  document in the Reading Overlay (§8). Present on every page in the tree.

There is **no** Save/Save-and-Back control anywhere in this tree.

### 2.2 Breadcrumbs at 375 px

This tree is shallow (sub-pages are one level under My Account), so at most two
crumbs are ever visible:

- **My Account** page → `‹ My Account` (current; Back chevron → `/app`, the
  Entrance Hall — the brand-bar logo also goes Home, so "Home" is not a crumb).
- **Sub-page** (e.g. Biometric) → `‹ My Account / **Biometric**` — "My Account"
  is tappable (→ `/app/account`), "Biometric" is the bold current crumb.

The primitive supports N crumbs with **middle-collapse** (`‹ … / Parent /
**Current**`) for future deeper trees, but this slice never exceeds two.

### 2.3 Always-save model

`Save & Back` is gone. Persistence rules:

- **Free-text fields** (display name): save **on blur and on Enter**. A subtle,
  self-dismissing `Saved ✓` micro-confirmation appears beside the field on
  success. Empty is a valid value.
- **Validated fields** (username): save on blur/Enter **only if valid**. On
  invalid input, show an inline error, keep the entered value and focus, and do
  **not** persist or navigate. This is the one guard the always-save model needs
  — a rename that the crypto layer rejects (`CryptoError 'invalid_input'`) must
  not silently vanish.
- **Selections / actions** (toggles, taps): persist immediately on change.
- **Cancelling** an edit = navigate Back (breadcrumb) or just blur an unchanged
  field. There is nothing to "discard" because nothing was staged.

Until the other editor surfaces (Settings, Persona Editor) migrate to the Page
Bar, this tree is an **inconsistency island** — it drops Save & Back while they
keep it. That is **temporary by design** (§1 non-goals). The mitigation is a
prompt, legible `Saved ✓` on the first edit so the user learns the model by
doing; we add **no** persistent "auto-saves" banner (that would nag). The My
Account `?` help opens by stating "changes save as you go". (Laura SOFT.)

### 2.4 The primitive

A new `PageBar` component in `components/ui/` (thin, `data-*`-driven, styling in
`index.css`, consistent with the other eight primitives). A small `PageScaffold`
wrapper composes `PageBar` + a scroll region for pages that want the standard
layout. Breadcrumbs are passed as a typed array:

```ts
interface Crumb { label: string; to?: string } // no `to` ⇒ current page
interface PageBarProps {
  crumbs: Crumb[];          // last entry is the current page
  onHelp?: () => void;      // opens the Reading Overlay with this page's help
}
```

The Page Bar lives **inside** the routed page subtree (not in `root.tsx`), so a
tile→sub-page zoom (§9) grows the bar together with its page out of the tapped
tile — the bar is part of the page, the brand bar stays put.

---

## 3. My Account (`/app/account`)

Two regions, sized to fit an iPhone SE (375×667) without scrolling in the common
case; smaller viewports scroll the content region (the Page Bar still doesn't).

### 3.1 Dashboard (top)

A compact read/edit panel:

| Field | Behaviour |
|---|---|
| **Username** | Inline-editable (Edit → field → blur/Enter saves if valid, else inline error). Monospace display. Uses `changeUsername()`. |
| **Display name** | Inline-editable free text (max 60). **When empty, the field shows the username as its effective value** (not a blank/placeholder) so the user is never confused about what others see. Saved via `updateSettings({ displayName })`. |
| **Biometrics** | Read-only `Badge` — "Configured (N)" or "Not set up on this device". |
| **Server link** | Read-only `Badge` — "Linked to {url}" or "Local-only". |
| **Version** | Read-only — `v{version} · sha {sha}`. |

Read-only items use `Badge` ("tells", per the design language); editable items
use inline edit affordances.

### 3.2 Navigation matrix (2×3, Nav-palette)

Six `NavTile`s, paired by meaning, coloured from the **navigation palette**
(not destructive red — see §10):

| | Left | Right |
|---|---|---|
| Row 1 (**pink** / Relate) | **Biometric** → `/app/account/biometric` | **Recovery Key** → `/app/account/recovery` |
| Row 2 (**blue** / Nourish) | **Server linking** → `/app/account/server-linking` | **About** → `/app/account/about` |
| Row 3 (**purple** / Root) | **Change passphrase** → `/change-passphrase` | **Logout** → `/app/account/logout` |

Each tile carries a Lucide icon and a calm one-line meta that **says what the
sub-page is for** (the meta is the first-line affordance; `?` help is the safety
net, not a prerequisite — Laura SOFT). Tiles navigate; the zoom (§9) is inherited
for free from the `to=` prop.

---

## 4. Sub-pages

All six render with `PageScaffold` (Page Bar + scroll region). Breadcrumb is
always `‹ My Account / **<page>**`.

### 4.1 Biometric (`/app/account/biometric`)

- **Status** of WebAuthn availability; PRF requirement honoured.
- **Add biometric** — `Button` (primary) → `registerLocalBiometric()`; busy
  state "Setting up…"; PRF-less devices refused with the existing message;
  user-cancel is silent.
- **List of existing biometrics** — each row (`ListRow`): label + AAGUID badge,
  with **Rename** (inline) and **Remove** actions. Remove uses `ConfirmDialog`;
  removing the **last** biometric shows the lockout warning before confirming.
- Disabled-with-reason when WebAuthn is unavailable.

### 4.2 Recovery Key (`/app/account/recovery`)

- One action: **Regenerate recovery key**. Destructive-styled `Button`
  (`tone="destructive"`), opens the existing typed confirm (`ConfirmTyped`, token
  "regenerate") warning that the old key is invalidated immediately. The typed
  token is **kept** (Chris, 2026-06-22) — the heavy friction is wanted despite
  regeneration being repeatable.
- **mk-gated**: only enabled when the master key is in the session (passphrase or
  recovery-key login). Biometric-only sessions show the disabled state with the
  reason ("You can only regenerate after logging in with your passphrase or
  recovery key").
- On success, renders `RecoveryKeyReveal` (existing component) with the new key
  and an "I have saved it" dismiss.

### 4.3 Server linking (`/app/account/server-linking`)

- **Status** (read-only `Badge`): "Linked to {url}" / "Local-only mode".
- **Link to server** → existing onboarding flow
  (`/onboarding/invitation?return=/app/account/server-linking`).
- Disconnect, when linked (carried over from the current capability).

### 4.4 About (`/app/account/about`)

The richest sub-page — itself a dashboard + matrix.

- **Dashboard:** version block (`v{version} · sha {sha} · built {builtAt}`) and
  the copyright line (`© Chatsundere · No warranty. AGPLv3, LGPLv3, or MIT per
  package.`).
- **Matrix (2×3):**

  | | Left | Right |
  |---|---|---|
  | Row 1 (**pink**) | **License** → Reading Overlay (bundled AGPL-3.0 text) | **Source Code** → external GitHub link |
  | Row 2 (**green**) | **Privacy** → Reading Overlay (privacy notice) | **Third-party libraries** → Reading Overlay (generated from `third-party-licences.ts`) |
  | Row 3 (**purple**) | *(empty)* | **Developer tools** → sub-page, **DEV builds only** |

  In production the third row **collapses entirely** (Dev Tools renders only
  under `import.meta.env.DEV`) — About is a clean **2×2**, never a 2×3 with a
  blank/ghost quadrant (Laura SOFT). If a third pair is wanted later, the dropped
  "Documentation" link (§13/§14) is the natural occupant of that reserved cell, so
  the asymmetry reads as "reserved", not "forgotten". "Source Code" is the only
  tile that leaves the app (external link); the three overlay tiles open the
  Reading Overlay in place.

- **Developer tools** (`/app/account/about/devtools`, DEV only): the existing
  "Dump IndexedDB → /dumps" action and any future dev affordances.

### 4.5 Change passphrase (`/change-passphrase`)

The existing flow, re-dressed with the Page Bar (breadcrumb `‹ My Account /
**Change passphrase**`). No functional change to the passphrase-change logic in
this slice — only the chrome.

### 4.6 Logout (`/app/account/logout`)

Hosts the two "leaving" actions, deliberately one level in. **Sign out's extra
depth is a consciously accepted, logged decision** (Chris, 2026-06-22 — a very
rarely used action on a single-user local-first device, thematically at home with
the other "leaving" action, with an almost-destructive character; burying it
slightly so the user does not accidentally stumble over it is a feature). Logged
in [`ux-deferrals.md`](../../obsidian/insights/ux-deferrals.md). The Logout tile's
meta names what the page holds, so the action stays discoverable. (Laura HARD-2.)

- **Sign out** — `Button` (neutral); `closeAndForget()` → `/login`.
  Non-destructive (encrypted data stays on device). Framed as such.
- **Delete all local data** — `Button` (`tone="destructive"`), in a clearly
  set-apart danger zone. Opens a **type-your-username** confirm (`ConfirmTyped`)
  inside a gold-protects dialog: the safe **"No"** button carries the gold
  overlay (gold protects, never invites), the **"Yes"** button is destructive
  red. On confirm → `deleteLocalAccount()` → `/onboarding`. Irreversible; the
  username-typing safeguard is kept precisely because "no recovery is a feature".

---

## 5. Markdown Reading Overlay

A new `ReadingOverlay` primitive for displaying long text (help, License,
Privacy, Third-party) elegantly.

- **Zoom-in** from the triggering control's origin (reuse the design-language
  zoom; `cs-zoom-in`), zoom-out on close.
- **Inset, not full-bleed**: margin all around; the uncovered margin is **dimmed**
  (backdrop) so focus is on the panel without losing the sense of place.
- **Opulent** background; near-white body text; **gold-tinted headings**.
- **Title bar** naming exactly what is being read (e.g. "Privacy & data
  handling", "GNU AGPL v3.0", "Third-party libraries", "About — help").
- **Prominent `×`** top-right; also closes on Esc and backdrop tap.
- **Scrollable** content region; the title bar and `×` stay fixed.
- Renders through the existing **`MarkdownContent`** component (remark-gfm etc.),
  so formatting, links (new tab, `noopener`), and code all work for free.

```ts
interface ReadingOverlayProps {
  open: boolean;
  title: string;
  markdown: string;       // raw markdown source
  onClose: () => void;
  originRef?: React.RefObject<HTMLElement>; // zoom origin
}
```

---

## 6. Help system

- **Per-page help.** Every page in the tree has its own help document, opened
  only via `?` (never auto-shown). The **My Account** help additionally explains
  what each sub-page is for (Chris's idea: the `?` previews the sub-pages).
- **All help texts are authored in this slice** (British English).
- Help docs live as markdown under a new `src/content/help/` directory, imported
  as raw strings (`?raw`). One file per page:
  `my-account.md`, `biometric.md`, `recovery.md`, `server-linking.md`,
  `about.md`, `change-passphrase.md`, `logout.md`.

---

## 7. Content deliverables (British English)

Authored as part of this slice:

1. **Seven help docs** (§6).
2. **AGPL-3.0 full text** — bundled as a markdown/text asset for the License
   overlay (works offline; aligns with local-first values).
3. **Privacy notice** — expand the current three-paragraph copy
   (`copy.settings.about.privacy`) into a proper notice. *Wording is
   Chris/SCAI-reviewable; Liz drafts.*
4. **Third-party libraries** — **generated** from the existing
   `src/lib/third-party-licences.ts` (single source of truth) into markdown at
   render time; no parallel hand-authored list.

---

## 8. Colour & motion

- **Navigation matrices** (My Account, About) use the **nav palette**
  (`--color-nav-pink` `#ff6db0` "Schmuserot", `--color-nav-green`,
  `--color-nav-blue`, `--color-nav-purple`) — these tiles *navigate*, so they are
  navigation-plane elements, exactly like the Entrance Hall.
- **Destructive red** (`--color-destructive` `#ff5a5a`) is a *different* token
  and appears **only on destructive action buttons** (Delete local data;
  Regenerate recovery key; Remove last biometric) — never on a nav tile.
- **Gold** = priority overlay, one per screen; on confirm dialogs it protects the
  safe choice ("gold protects, never invites").
- **Motion**: tiles zoom into sub-pages and collapse back via the existing
  origin-path mechanism (`NavTransitionOutlet` + `useNavZoom`) — inherited for
  free from `to=`. The Reading Overlay reuses the same zoom grammar.

---

## 9. Zoom integration

Because matrix tiles use `NavTile to=...`, the bidirectional Unified-Experience
zoom already applies: a tap plays the gold blink, the sub-page grows out of the
tile, and Back collapses it into the same tile. The Page Bar, being inside the
routed subtree, zooms with its page. The brand bar (global chrome) stays put, as
established. No new transition mechanism is needed.

---

## 10. Routes added

```
/app/account                    (rebuilt)
/app/account/biometric          (new)
/app/account/recovery           (new)
/app/account/server-linking     (new)
/app/account/about              (new)
/app/account/about/devtools     (new, DEV only)
/app/account/logout             (new)
/change-passphrase              (existing; Page-Bar chrome only)
```

All under `ProtectedRoute`.

---

## 11. Components

**Reused:** `NavTile`, `Button`, `Badge`, `ListRow`, `ConfirmDialog`,
`ConfirmTyped`, `RecoveryKeyReveal`, `MarkdownContent`, the
`NavTransitionOutlet` / `useNavZoom` zoom, `webauthn` helpers,
`changeUsername` / `updateSettings` / `regenerateRecoveryKey` /
`deleteLocalAccount` / `closeAndForget`.

**New:** `PageBar`, `PageScaffold`, `Breadcrumbs` (likely internal to `PageBar`),
`ReadingOverlay`, and the per-route sub-page components.

**Retired on this tree (kept for other surfaces):** `EditorSticky`,
`EditorTopbar`, `SaveBar`, `AccordionCard`, and the `account-sections/*`
accordion modules are no longer used by the account tree (they remain in the
codebase for Settings/Persona-Editor until those surfaces are migrated).

---

## 12. Accessibility

- Breadcrumb ancestor crumbs are real `<button>`/links with discernible names;
  the current crumb is `aria-current="page"`.
- `?` and `×` have `aria-label`s and 44×44 hit areas.
- Reading Overlay traps focus, restores it to the trigger on close, closes on
  Esc, and is announced (`role="dialog"`, `aria-modal`, labelled by its title).
- Disabled affordances stay focusable with an announced reason (the established
  pattern), e.g. Recovery-Key when mk is absent, Add-biometric when WebAuthn is
  unavailable.
- `Saved ✓` confirmations use a polite live region. Blur and Enter **de-dupe to a
  single persist + single announcement** per change, so a fast Enter-then-blur
  never double-announces (or races a `Saved ✓` against an error) — important for
  the ND audience (Laura SOFT). Pre-squash device check on VoiceOver.

---

## 13. Carry-over audit (nothing lost)

Every capability of the current account surface has a home:

| Current capability | New home |
|---|---|
| Display name edit (empty ⇒ username) | Dashboard (semantics sharpened) |
| Username inline rename + validation | Dashboard |
| Account created date | **Dropped for alpha** (Laura + Liz: inert never-actioned metadata; "nothing lost" means no *capability* lost, not no inert string). Re-add on request. |
| Sign out | Logout sub-page |
| Delete local data (type username) | Logout sub-page (danger zone) |
| Passphrase "never displayed" row | Implicit; Change-passphrase tile |
| Change passphrase | Matrix tile → `/change-passphrase` |
| Biometric list + add | Biometric sub-page |
| Biometric rename / remove (+ lockout) | Biometric sub-page |
| Recovery key regenerate (+ mk gate) | Recovery sub-page |
| Recovery key reveal | Recovery sub-page |
| Server link status + link | Server-linking sub-page |
| Server disconnect | Server-linking sub-page |
| About: version/sha/built | About dashboard |
| About: privacy | About → Reading Overlay |
| About: third-party libraries | About → Reading Overlay |
| About: licence footer (copyright) | About dashboard |
| About: Licence link | About → Reading Overlay (bundled AGPL) |
| About: Source code link | About matrix (external) |
| About: Documentation link | *Dropped for alpha* (re-add on request) |
| Dev tools: IndexedDB dump | About → Developer tools (DEV only) |

(The "Account created" date is dropped for the alpha — see the row above.)

---

## 14. Out of scope / deferrals

- Migrating other section pages to the Page Bar.
- "Account created" date (decide at review — §13).
- Documentation external link.
- Any backend/sync linking changes (the link flow is reused as-is).

---

## 15. Manual verification (device — Chris)

1. Page Bar never scrolls; content beneath scrolls; bar reads as chrome.
2. Breadcrumbs show location + Back target; tapping the ancestor crumb returns;
   the chevron/leftmost crumb returns; brand-bar logo goes Home.
3. Display name: type → blur → `Saved ✓`; reload shows it; empty shows username.
4. Username: valid rename saves on blur; invalid shows inline error and keeps the
   value/focus; nothing persists.
5. Tiles zoom into sub-pages and collapse back into the same tile; reduced-motion
   is instant.
6. Biometric: add (PRF path), rename, remove; last-one lockout warning.
7. Recovery: regenerate only with passphrase/recovery session; disabled-with-
   reason on biometric-only; reveal + dismiss.
8. Server linking: status correct; link/disconnect.
9. About: version/copyright; License/Privacy/Third-party open the Reading Overlay
   with the right title and render correctly; Source Code opens GitHub; Dev Tools
   present only in dev.
10. Reading Overlay: zooms from trigger, dims the margin, `×`/Esc/backdrop close,
    zooms back; long content scrolls under a fixed title.
11. Logout: Sign out → /login (data kept); Delete → type username, gold "No"/red
    "Yes", → /onboarding; data gone.
12. `?` on every page opens its help; My Account help explains the sub-pages.

---

## 16. Open questions

All Laura findings resolved (HARD-1 fixed in §2.1; HARD-2 accepted + logged, §4.6;
softs folded in or arbitrated). Remaining:

- Privacy-notice wording owner: Liz drafts; Chris/SCAI sign-off before alpha.
```
