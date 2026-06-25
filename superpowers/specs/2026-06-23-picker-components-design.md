# Picker Components — Design Spec

- **Date:** 2026-06-23
- **Author:** Liz (with Chris)
- **Status:** Chris-approved (brainstorm); Laura spec-pass complete (no hard defects; SOFT-1 ruled by Chris = discard-confirm-when-dirty; SOFT-3/SOFT-4 folded; SOFT-2 deferred to the design-language pass) — ready for implementation plan
- **Scope:** The reusable **picker** family for the UI/UX makeover: one shared overlay shell, one generic trigger field, and three content pickers (Mindspace, Model, Web). Built as **internal primitives + showcase demos only**. The live wiring into My Settings is the *next* slice and is out of scope here.

---

## 1. Context & Goals

The UI/UX makeover proceeds surface-by-surface; the next planned surface is **My Settings** (`/app/settings`). Settings is denser and more knob-heavy than My Account, and several of its knobs are *pickers* — a control where the user opens a focused sheet, chooses one thing, and returns. Rather than build My Settings and its pickers in one large step, we first extract the picker primitives, prove them in the internal showcase, and only then rebuild My Settings on top of them. This keeps each step overseeable — the operating principle for the whole redesign.

This slice mirrors the **Design Language Foundations** slice precedent: ship reusable primitives plus a showcase route, with **no user-reachable flow wired yet**, so a Laura pre-squash pass is likely unnecessary (a Laura *spec-pass* on the picker UX still applies).

Three pickers are needed now:

1. **Mindspace picker** — what is today "Your Default Mindspace".
2. **Model picker** — the existing model+provider picker, rehoused into the new shell.
3. **Web picker** — search + fetch backends (and, in the expert context, search depth).

### 1.1 What already exists (reuse points)

| Concern | Existing code |
|---|---|
| Model picker data + vision filter | `components/model-picker/model-picker-data.ts` (`ModelFilter = 'all' \| 'vision'`, `filterGroupsByQuery`, `PickerModel`/`PickerOffering`/`ModelSelection`) |
| Model picker UI (two-step) + trigger | `components/ModelPickerModal.tsx`, `components/ModelPickerField.tsx` |
| Mindspace picker content | `components/MindspacePicker.tsx` (selection + texture + font + `allowUserDefault` chip); type `MindspaceRow` in `boot/client-data-db.ts` |
| Web backend selectors | `components/WebInterfacingSection.tsx` (search + fetch), `components/ExpertWebSection.tsx` (search + depth + fetch); types `WebBackendSetting`/`OfferingRef` in `lib/web-backends.ts`, `SearchTier` |
| Overlay shell precedent | `components/ui/ReadingOverlay.tsx` (zoom-from-trigger, `cs-reader-titlebar`) |
| Other primitives | `ConfirmDialog`, `NavTile` (`onActivate`), `PageScaffold`/`PageBar`, `useHelp` |
| Showcase route | `/app/ui-showcase` (internal, outside `ProtectedRoute`) |

No persistence schema changes: the pickers read and write existing settings shapes (`MindspaceRow`/`MindspaceTexture`/`Font`, `ModelSelection`, `WebBackendSetting`, `searchTierId`). **No Dexie bump.**

---

## 2. The shared shell — `PickerOverlay`

A new primitive in `components/ui/` (the 9th). It provides the chrome, motion, focus management and dismissal that all pickers share; the picker-specific UI is its `children`.

### 2.1 Appearance

A modal overlay that zooms out of its trigger like `ReadingOverlay` — centred, "not quite over the whole screen". Header row:

```
┌─────────────────────────────────────┐
│  ‹      <title>            Save      │   back · title · Save (gold, optional)
├─────────────────────────────────────┤
│   …children (scrolls)…              │
└─────────────────────────────────────┘
```

### 2.2 Props

```ts
interface PickerOverlayProps {
  open: boolean;
  title: string;                                   // "what is being picked"
  onClose: () => void;                             // ‹ / Esc / backdrop → cancel (discard-guarded if dirty)
  onBack?: () => void;                             // when set, ‹ steps back one level instead of closing
  onSave?: () => void;                             // present → gold Save shown; absent → no Save (model picker)
  saveDisabled?: boolean;                          // Save greyed until dirty
  dirty?: boolean;                                 // when true, dismissal raises a discard-changes confirm
  triggerRef?: React.RefObject<HTMLElement | null>; // zoom origin
  children: React.ReactNode;
}
```

### 2.3 Behaviour

- **Save slot is optional.** Mindspace and Web pass `onSave`; the Model picker does not (it self-closes on completion). Gold = the priority action, exactly one per screen.
- **`saveDisabled` is dirty-gating.** Save is greyed (disabled-over-hidden, focusable with reason) until the staged value differs from the committed value. This realises "leaving without a change = just back".
- **`onBack` makes `‹` context-aware.** When `onBack` is supplied, the back arrow calls it (used by the model picker to return from the provider step to the model step). When absent, `‹` calls `onClose`. There is therefore always exactly **one** back affordance — the shell's.
- **Dismissal:** `‹` (when no `onBack`), `Esc`, and backdrop tap all dismiss via `onClose`. (Esc/backdrop always fully cancel, even mid-drill-down.)
- **Discard guard (Laura SOFT-1, Chris-ruled).** A back-arrow elsewhere promises "you lose nothing", so a *dirty* staged sheet must not discard silently. When `dirty` is true, any dismissal path (`‹`/`Esc`/backdrop) first raises a **"Discard changes?"** `ConfirmDialog` whose **gold-protected** safe option is "Keep editing" (destructive "Discard" is never gold). When `dirty` is false the sheet dismisses instantly — no nagging. The Model picker passes no `dirty` (it never stages), so it keeps its frictionless dismissal. This reuses the existing `ConfirmDialog` (gold role-swap precedent).
- **Motion:** zoom from `triggerRef` with the standard enter/exit timing; `prefers-reduced-motion` → instant, matching the other primitives.
- **Focus:** because pickers are interactive selection surfaces, `PickerOverlay` implements a **focus trap** now (initial focus into the sheet, `Tab` cycles within, focus restored to the trigger on close). This deliberately closes one of the makeover-wide a11y follow-ons (the shared focus-trap, spec §12 of the foundations) rather than deferring it. `ReadingOverlay`/`ConfirmDialog` may later adopt the same helper.
- `role="dialog"`, `aria-modal`, labelled by the title.

---

## 3. `MindspacePickerOverlay` — Save

Lifts the existing `MindspacePicker` (Mindspace selection + texture + font + `allowUserDefault` chip) **1:1** into a staging container inside `PickerOverlay`.

- **Staged state** seeded from the current `selectedMindspaceId` / `texture` / `font`. The `MindspacePicker` change handlers write to this local state; the live preview renders the staged state.
- **Dirty** = any of the three differs from the seed → drives both `saveDisabled` and `dirty` (so the discard guard fires only when there is something to lose).
- **Save** commits all three at once via a single `onSave(result)` callback; **‹ / Esc / backdrop** dismiss (discard-guarded when dirty, §2.3).
- Title: `"Mindspace"`.

---

## 4. `ModelPickerOverlay` — no Save, auto-close

Rehouses the existing two-step model→provider flow (`model-picker-data` + the model list, search box, and per-model provider list from `ModelPickerModal`) into `PickerOverlay`. The bottom-sheet chrome of today's modal is dropped in favour of the shared zoom-from-trigger shell.

- **No `onSave`** → no Save button. Picking a provider (offering) commits the `ModelSelection` and closes (`onClose`). This is the "user is done picking → it closes itself" behaviour.
- **`filter: ModelFilter`** is supplied by the call-site. The "Image Understanding" call-site passes `'vision'`; general model picking passes `'all'`. There is **no user-facing vision toggle** — the call-site locks it. (The data layer already supports this.)
- **Two-step navigation via `onBack`:** in the provider step the picker passes an `onBack` that pops back to the model step; in the model step it passes no `onBack`, so `‹` closes. The shell's single back arrow serves both.
- Search box behaviour unchanged (case-insensitive model-name substring).
- **Call-site reach this slice:** only the My-Settings model call-sites are intended consumers (Image Understanding, Expert model). Chat/Persona model selection stays on the existing `ModelPickerModal` until those surfaces get their own makeover slice. (No call-sites are wired live in *this* slice — see §7 — but the component is scoped to serve those two.)

---

## 5. `WebPickerOverlay` — Save, context-aware

Bundles the web backend choices so the user picks them together under one Save (Chris: keeping them together is simpler than splitting). Reuses the selector logic from `WebInterfacingSection` / `ExpertWebSection`.

- **`mode: 'general' | 'expert'`** decides the field set:
  - `general`: `[ Search backend ] [ Fetch backend ]`
  - `expert`: `[ Search backend ] [ Depth ] [ Fetch backend ]` (depth = `searchTierId`)
- Each backend selector lists the available offerings for that role + `"Off"` + the existing Recommended / AI / Neural / Privacy trait badges describing the effective choice. **`"Off"` is a first-class, equally-weighted, visible choice** (Laura SOFT-4) — disabling a role is a legitimate primary intent, not something the user scrolls past the catalogue to find.
- **Staged state** for all fields; **Save** commits them together; **‹ / Esc / backdrop** dismiss (discard-guarded when dirty, §2.3). Dirty/Save-gating as in §2.3.
- **Per-field stale (Laura SOFT-4).** When a committed search/fetch backend's provider was removed, the affected *field* carries the constructive stale line (mirroring §6's `PickerField` copy — naming which backend went away), rather than greying the whole picker.
- Title supplied by the call-site (`"Web search"` / `"Expert web"`).

---

## 6. `PickerField` — the generic trigger

Generalises today's `ModelPickerField` into a single reusable trigger row used to open any of the pickers.

- Shows the **current value** (primary label + optional secondary line) and opens the matching overlay on tap, passing its own element as the zoom origin.
- Carries **constructive stale state** — when the stored value is no longer available it says so and points at the fix (e.g. *"Currently unavailable — add X or pick another"*), never a silent blank.
- `disabled` + `disabledReason` for disabled-over-hidden (focusable, announced reason).
- The parent decides *which* overlay a given `PickerField` opens; the field itself is overlay-agnostic.

```ts
interface PickerFieldProps {
  label: string;
  value: ReactNode;                 // current selection display (or an "unset" hint)
  stale?: { reason: ReactNode };    // constructive unavailable-state copy
  disabled?: boolean;
  disabledReason?: string;
  onOpen: (trigger: HTMLElement) => void;
}
```

---

## 7. Scope boundary & verification

**In scope (this slice):**

- `PickerOverlay` (shell, with focus trap), `PickerField` (generic trigger).
- `MindspacePickerOverlay`, `ModelPickerOverlay`, `WebPickerOverlay`.
- **Showcase demos** for all of the above under `/app/ui-showcase`, each driven by local demo state so the staged/Save/auto-close/stale behaviours are device-verifiable in isolation.

**Out of scope (next slice — My Settings rebuild):**

- Rebuilding `/app/settings` on `PageScaffold`.
- Wiring the pickers live into their real call-sites (Default Mindspace, Image Understanding, Expert model, Web, Expert Web). `settings.tsx` is **not** touched in this slice — it is rebuilt wholesale next, so we avoid editing it twice.
- Chat/Persona model-picker migration (their own future slices).

Because nothing user-reachable is wired, this is internal-only (like the foundations slice). A **Laura spec-pass** on the picker UX is in the gate; a Laura pre-squash pass is likely not required (judgement call at squash time).

---

## 8. Error handling & edge cases

- **Empty option sets:** a backend selector with no available offerings, or a model list emptied by the vision filter, shows a calm empty state with the constructive next step (e.g. "add a provider"), never a dead blank — consistent with the constructive-error stance.
- **Vision-locked empty state (Laura SOFT-3):** because the vision filter is call-site-locked and therefore *invisible* to the user, an empty vision-filtered list must **name the constraint** in its copy — e.g. *"No image-capable models available — add a provider that offers vision"* — so a user who already has (non-vision) providers configured understands *why* the list is empty and what fixes it. This is distinct from the general "add a provider" empty state.
- **Stale committed value:** handled by `PickerField` stale copy (§6); opening the overlay still lets the user pick a valid value.
- **Save while clean:** impossible to mis-fire — Save is dirty-gated.
- **Backdrop/Esc mid-drill (model picker):** fully cancels; no partial commit (the model picker only commits on provider tap).

---

## 9. Testing

- **Unit/RTL** per component: shell dismissal paths (‹/Esc/backdrop → onClose; `onBack` → step back, not close); **discard guard** (dirty → confirm intercepts every dismissal path; clean → instant close; Model picker passes no `dirty` → never guarded); Save visibility (present iff `onSave`) and dirty-gating; focus trap (initial focus, restore-on-close); model picker auto-close on provider tap and `filter='vision'` narrowing plus the constraint-naming empty copy; web picker mode field-sets, first-class "Off", per-field stale, and combined Save; mindspace staging + guarded discard-on-back; `PickerField` stale rendering and disabled-reason.
- Run the **full** user-client vitest at the gate (not just the touched dir), expecting the known **8 Node-localStorage baseline**.
- `pnpm typecheck --force` at the gate (Turbo caches typecheck; force it).

---

## 10. Manual verification (Chris, on device — via the showcase)

1. Open each picker from its showcase `PickerField`; confirm it zooms out of the field.
2. **Mindspace:** change colour/texture/font → preview updates; Save lights up (gold); Save commits and closes; reopen shows the new value. Then change something and press ‹ → a "Discard changes?" confirm appears (gold "Keep editing"); "Keep editing" returns to the sheet, "Discard" closes and the value is unchanged. Open, change nothing, press ‹ → closes instantly, no confirm.
3. **Model:** pick a model → provider list; press ‹ → back to models (not closed); pick a provider → commits and auto-closes (no Save ever shown). Open the vision-locked demo → only vision models listed, no toggle.
4. **Web (general):** pick search + fetch, Save commits both. **Web (expert):** depth field appears between them; Save commits all three.
5. **Stale + disabled:** the showcase includes a `PickerField` in a stale state (constructive copy) and a disabled one (reason on focus/hover).
6. **a11y:** Esc closes; focus is trapped inside while open and returns to the trigger on close; `prefers-reduced-motion` → instant.

---

## 11. Follow-ons / deferrals

- Live wiring + My Settings rebuild → next slice.
- Chat/Persona model-picker migration to `ModelPickerOverlay` → their makeover slices (two looks coexist meanwhile, by decision).
- `ReadingOverlay`/`ConfirmDialog` adopting the shared focus-trap helper extracted here → opportunistic, when those surfaces are next touched.
- **Telegraph the no-Save model picker vs the staged Mindspace/Web pickers via row affordance grammar (Laura SOFT-2)** — let a terminal "tap to choose" provider row read differently from a staged chip-toggle, so the Save/no-Save asymmetry is felt before the user acts. Visual call for the **design-language pass**, not this slice.
