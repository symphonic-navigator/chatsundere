# Chat Font Tuning — Design Spec

**Date:** 2026-07-18
**Author:** Liz (with Chris)
**Status:** Draft — Laura spec-pass done (no hard defects; 4 soft notes, 2 folded
in below, 2 open for Chris — see §8); awaiting Chris review
**Scope:** `apps/user-client` only. Client-only, no backend, no `packages/*`.

---

## 1. Context & Motivation

Two small, independent refinements to how text reads in the chat surface, both
field-driven:

1. **New personas default to the wrong font.** A freshly created persona starts
   on `serif`. `sans` is the calmer, more legible default most users want; the
   change should not touch existing personas.

2. **No way to enlarge the chat text.** The current message size is a popular
   baseline, but some users — especially on desktop, where the reading column is
   wide — want larger text for comfort and accessibility. There is today no
   control for this anywhere in the app.

The two share a theme (how the chat reads) but are otherwise orthogonal and ship
as two units.

## 2. Goals

- New personas default to `font: 'sans'`; existing personas are untouched.
- A user can enlarge the chat reading text through three steps —
  **Standard · Groß · Größer** (English in code: `standard · large · larger`) —
  with a live preview.
- The size preference is **global** (not per-persona, not per-chat) and
  **per-device** (deliberately *not* synced): a user on a large desktop monitor
  and a small phone wants different sizes, so the setting must not travel.
- The control lives on **one surface present on both breakpoints**, so there is
  no desktop-vs-mobile placement split.

## 3. Non-Goals

- No change to existing personas' fonts (only the *default* for new ones).
- No per-persona or per-chat font-size override. Size is one global knob.
- No continuous slider — three discrete steps only (omakase, calm, ND-friendly).
- No smaller-than-today step. The baseline stays; the feature only adds headroom
  above it.
- The dead `SettingsRow.userFont` field is out of scope. It is already unread
  (only a DB backfill sets it; the picker was removed). We neither revive nor
  delete it here.

## 4. Unit 1 — Persona Default Font → `sans`

Single change: `apps/user-client/src/routes/app/persona/persona-draft.ts:26`,
`font: 'serif'` → `font: 'sans'`.

- `defaultDraft()` is the sole source of a new persona's starting field values,
  so this is complete on its own.
- Existing personas carry their own `font` value in their row; nothing reads the
  default for them. **No migration, no Dexie bump.**
- Content-axis (per-persona, sealed and synced with the persona) — unchanged
  behaviour, only the seed value moves.

## 5. Unit 2 — Chat Font Size

### 5.1 The setting

New field on the settings singleton:

```ts
// SettingsRow (boot/client-data-db.ts)
/** Chat reading-text size (behaviour-axis, per-device — deliberately NOT synced,
 *  see sync/strip.ts). Absent ⇒ 'standard' (today's baseline). Non-indexed
 *  (schemaless) — no Dexie version bump. */
chatFontScale?: 'standard' | 'large' | 'larger';
```

- **Non-indexed optional field** → no store/index change → **no Dexie bump**
  (per the project's unindexed-field rule).
- **Default at read**, not by migration: every consumer resolves
  `settings.chatFontScale ?? 'standard'`. No backfill needed.

### 5.2 Device-local by construction

`chatFontScale` is **not** added to `SETTINGS_SYNC_ALLOWLIST` in
`sync/strip.ts`. The `settings` collection uses **allowlist** polarity — a field
absent from the list is never sealed and is restored from the local row on open.
So the field is device-local automatically, exactly like `adultMode`,
`animationsEnabled`, and `spectrumEnabled`.

- The deliberately-device-local doc comment in `strip.ts` gains a `chatFontScale`
  line, so the conscious opt-out is recorded (the discipline the allowlist exists
  to enforce).
- `useUpdateSettings` already routes a patch touching only non-allowlisted fields
  as a **plain local write, never sync-gated** (`patchTouchesSyncedField` returns
  `false`). So changing size works offline and for unlinked accounts, with no
  Class-2 gate — verified against the existing `adultMode` path.

### 5.3 Applying the scale

A single CSS custom property drives every scaled element:

- `chat-page.tsx` sets `style={{ '--chat-font-scale': SCALE[chatFontScale ?? 'standard'] }}`
  on the `.chat-page` root, reading it from `useSettings()`.
- The scale map lives in one module:

  ```ts
  const CHAT_FONT_SCALE = { standard: 1, large: 1.15, larger: 1.3 } as const;
  ```

- Message reading text — persona body, user body, sender names, reasoning, and
  inline pills — derives its `font-size` from the base multiplied by
  `var(--chat-font-scale, 1)` in `index.css`. The scale applies **uniformly** to
  the reading surface: no partial scaling, no astonishing exceptions. Code blocks
  and monospace scale with it too (reading comfort applies to code as well;
  existing horizontal-overflow containers already scroll).
- The cockpit composer, topbar chrome, and navigation are **not** scaled — this
  is a *reading* knob, not an app-wide zoom.

The exact multipliers (1.15 / 1.3) are tunable during the build on-device; they
are starting points, not contract.

### 5.4 The control — a row in the cockpit ⋯ menu

The size control is a new section in `CockpitMenu` (the ⋯ overflow menu already
holding reasoning, web-depth, and the expert toggles):

```
⋯ menu
┌─────────────────────────────┐
│ Reasoning        [ … ]      │   (only if the model reasons)
│ …                           │
│ Text size                   │   ← new, always present
│  [ Standard ] Groß  Größer  │   ← three chips, current one active
└─────────────────────────────┘
```

- Three chips: **Standard · Groß · Größer**. Tapping one writes
  `chatFontScale` immediately and the reading text behind the menu resizes
  **live** (the menu is a small popover; messages remain visible around it).
- **The chips are the primary preview**, not the messages. Each chip renders its
  own label at its target relative size, so the size difference is visible *in
  the control itself* — robust even when the messages behind are dimmed (mobile
  interaction-mode with the composer focused). The behind-menu live resize of the
  actual transcript is the desktop/pinned bonus on top.
- **The size chips do NOT dismiss the menu on tap** — deliberately unlike the
  reasoning / web-depth / expert chips in the same menu, which each close it. The
  menu stays open so the user can step Standard→Groß→Größer and compare; it closes
  only on outside-tap or Escape. This divergence is intentional (a stepper, not a
  one-shot choice) and must be built as such — copying the close-on-tap behaviour
  of the sibling sections would silently defeat the compare-the-steps loop.
- Rationale for the ⋯ menu over a dedicated top-level icon: the cockpit controls
  row is already dense (attach, ⋯, live-voice, read-aloud, bookmarks, artefacts,
  memory), and font size is a **set-once, rarely-touched** preference — it does
  not earn a permanent icon. The ⋯ menu is exactly the home for infrequent
  controls. *(Placement is deliberately revisitable in a later iteration — Chris
  may promote it to a visible affordance once it is tested on-device.)*
- Precedent for a **global** setting living in the cockpit: read-aloud
  (`autoReadAloud`) is already a global toggle in the controls row. A global
  display setting in the cockpit is established, not novel.

### 5.5 Both breakpoints, one surface

The cockpit is present on **both** breakpoints — mobile in interaction mode
(reached by tapping the bottom affordance), desktop as the permanent cockpit.
So the ⋯ menu is one consistent home; there is no reading-mode-only surface and
no desktop-specific placement. On mobile the user opens the cockpit (one tap) to
reach the control — acceptable for a rarely-changed setting, and it keeps the
chrome-free reading surface untouched (honouring the airy value).

### 5.6 Side effect — ⋯ menu becomes always-meaningful

`CockpitMenu` currently returns `null` when a model has no reasoning, no
web-depth, and no expert toggles — so tapping ⋯ on a bare model opens nothing (a
latent dead affordance). Adding the always-present **Text size** section means
the render guard must include it, so the ⋯ menu now always has content. This is
a small, welcome fix, not a regression.

## 6. Data & Sync Summary

| Field | Location | Axis | Synced? | Dexie bump? |
|---|---|---|---|---|
| Persona `font` default seed | `persona-draft.ts` | content | (persona syncs) | no |
| `chatFontScale` | `SettingsRow` | behaviour | **no — device-local** | **no** |

## 7. Files Touched

- `routes/app/persona/persona-draft.ts` — default `font` seed.
- `boot/client-data-db.ts` — `SettingsRow.chatFontScale` field (+ JSDoc).
- `sync/strip.ts` — doc-comment line recording the field as deliberately
  device-local (no allowlist entry).
- `components/chat/CockpitMenu.tsx` — Text-size section + props; render-guard
  update.
- `components/chat/Cockpit.tsx` + `components/chat/InteractionMode.tsx` — thread
  `chatFontScale` + setter from settings down to `CockpitMenu`.
- `routes/app/chat/chat-page.tsx` — set `--chat-font-scale` on `.chat-page`.
- `index.css` — reading-text `font-size` derives from `var(--chat-font-scale)`.
- A small scale-map module (or a colocated const) for `CHAT_FONT_SCALE`.

Orthogonal to the in-flight desktop UI iteration ("something nice on the left") —
no shared surface beyond `index.css` (additive) and `chat-page.tsx` (a single
style attribute), no collision expected.

## 8. Audits

- **Laura — spec-pass done (2026-07-18): no hard defects.** She confirmed
  reachability, click-depth (2–3 taps for a set-once preference), visibility, no
  dead-ends, no misdirection, and recorded §5.6 as a genuine latent-defect
  retirement (the previously-dead ⋯ on a bare model). Four soft notes:
  - *Folded in:* the menu-persistence divergence is now pinned explicitly (§5.4);
    the chips-are-the-primary-preview cue is now stated (§5.4), which also covers
    the dimmed-mobile-preview concern.
  - *Open for Chris (taste/product):* (a) the setting has **no home in My
    Settings** — a user may look there first and find nothing (there is no
    display/appearance page at all). Options: accept it as the single in-context
    home, or add a Settings pointer. (b) **read-aloud parity** — read-aloud is a
    permanent controls-row icon while text-size is one tap deeper in ⋯; whether an
    accessibility knob deserves promotion to a visible icon is a call best made
    on-device. Both resolve the same way if field feedback shows people cannot
    find it: promote text-size to a visible cockpit icon (not a Settings page).
  - Pre-squash pass still owed after build.
- **Larissa — not required.** Client-only; no `auth`/`sync-service`/`proxy`/
  `crypto` surface. `sync/strip.ts` is touched only for a doc comment (a
  deliberate device-local field), no polarity or sealing change.

## 9. Edge Cases

- **Unset field on an existing install:** `?? 'standard'` yields today's size. No
  visible change until the user opts up.
- **A pulled settings row from another device:** the allowlist strips
  `chatFontScale` out of the sealed form, and `restoreLocalFields` keeps this
  device's local value — the size never travels, by construction.
- **Bare model (no reasoning/depth/experts):** the ⋯ menu now shows just the
  Text-size section — meaningful, not empty.
- **Live preview while the cockpit dims the messages (mobile, unpinned):** the
  size change still applies to the (dimmed) messages; on desktop and pinned the
  preview is fully lit. Acceptable — the chips also carry their own visual size
  cue.

## 10. Manual Verification (Chris, on-device)

Restart the dev stack first (Vite HMR ignores `packages/*`; a fresh boot loads
the new `SettingsRow` field cleanly).

1. **New-persona default:** create a new persona → its messages render in `sans`
   (not serif). An existing persona is unchanged.
2. **Enlarge:** open a chat → cockpit → ⋯ → **Text size** → tap *Größer* → the
   message text (persona and your own), names, reasoning, and pills all grow
   together, live. Tap *Standard* → back to baseline.
3. **Global:** the size holds across a different persona/chat on the same device.
4. **Per-device (the point):** set *Größer* on desktop; open the same account on
   the phone (linked) → the phone stays at its own size (the setting did not
   sync). Change size on the phone → desktop unaffected.
5. **Offline / unlinked:** change size with the backend unreachable (or a
   local-only account) → it applies with no gate, no error.
6. **Bare-model ⋯:** point a chat at a model with no reasoning/depth/experts →
   ⋯ still opens and shows the Text-size section.
7. **Desktop:** same ⋯ → Text-size control in the permanent cockpit; larger
   sizes read well in the wide column.
