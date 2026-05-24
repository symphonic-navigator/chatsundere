# Phase 2.9 — Mindspace Cards & Adult Mode — design spec

**Date:** 2026-05-24.
**Status:** brainstormed; ready for implementation plan.
**Implements:** four interlocking polish items Chris requested before Phase 3 begins. Establishes a project-wide design grammar that future surfaces (My Projects, knowledge bases, Phase-3 chat list) will inherit verbatim — both the mindspace tinting of list items and the adult-mode filtering convention.
**Lead:** Liz. Larissa skipped — no security-touching code; all changes live in `apps/user-client/**` (`src/components/**`, `src/data/**`, `src/state/**`, `src/routes/**`, `src/boot/client-data-db.ts`, `src/index.css`).
**Visual ground truth:** the Mindspace palette finalised in Phase 2 (seven built-ins: Crimson, Aurum, Verdan, Azuro, Indigaut, Violetta, Rosari) — see `apps/user-client/src/boot/client-data-db.ts:242-250`. The chatsune.me teaser remains the brand-mark reference.
**Out of scope:** Phase-3 chat surface (the "panic button" idea Chris flagged for kicking a user out of an in-flight NSFW chat when SFW mode is toggled mid-session lives in Phase 3's backlog). Sync semantics for the new `adultMode` setting (we document the exclusion-list requirement but don't build a sync mechanism here — there is no sync system yet).

---

## 1. Purpose

Phase 2.8 (Polish Block) closed the brand, sticky-header, display-name, and splash items. What still feels generic is the persona list — every card looks the same regardless of which mindspace the persona inhabits, and there is no visual or interaction distinction between adult and non-adult personas. Chris also lacks the device-local "context switch" he relies on personally (laptop at home = full programme, work laptop or phone = sanitised view).

This phase delivers four interlocking changes:

1. **Persona cards inherit their persona's mindspace** — background tint and base border come from the persona's resolved mindspace (with fallback to the user default). The card visually answers "in which world does this persona live?".

2. **Adult-status visible on the card** — every card carries an outer ring + a subtle shimmer animation. NSFW personas glow in `danger` red; SFW personas glow in `paper-soft` grey. Both shimmer; NSFW shimmers more often (every 6-8 s vs every 12 s) and brighter. Establishes the visual grammar future projects/knowledge-bases will reuse.

3. **The Persona Editor adopts the persona's mindspace context** — opening a persona's editor switches the ambient `MindspaceLayer` to that persona's resolved mindspace; closing it returns to the user default. Deepens the "you are inside this persona's world while editing" feeling.

4. **A global adult-mode toggle in the Brand-Bar** — a pill centred between the brand wordmark and the connectivity badge, switching between NSFW and SFW. SFW filters every persona list, count, and implicit reference (Hall's "X personas" tile, Hall's "Continue chat" card lookup, etc.) so that no adult persona, count, or reference leaks into a SFW context. The empty result of an all-NSFW circle in SFW mode is rendered as the same empty-state shown when no personas exist at all — visually discreet, no "X hidden" indicator anywhere.

---

## 2. Decisions captured during brainstorm

Each decision is sourced from Chris's answers on 2026-05-24.

1. **The filter pill lives in the global Brand-Bar, centred between logo and connectivity badge.** Not in a per-route sticky header. Rationale: adult-mode is a kernel-grade setting whose state must be visible everywhere it filters, not only on the list it currently affects. Future surfaces (Projects, History, Chat list) will inherit the same filtering behaviour without each needing its own pill.

2. **Default value on a fresh install is NSFW; subsequent value is whatever the user last chose on this device.** SFW is treated as the special case, not the default — a deliberate political/philosophical positioning that aligns with the teaser's "Tsuntsun towards regulation. Deredere towards you." manifesto. The setting persists in `SettingsRow.adultMode` and is **device-local**: when sync lands in a future phase, this field is in the sync-exclusion list so a user's home-laptop's NSFW choice does not propagate to their work-laptop or phone.

3. **Shimmer animation is dezent.** A horizontal light-streak crosses the outer border, ~800 ms duration. SFW cycle: every 12 s. NSFW cycle: every 6-8 s. Each card receives a random animation-delay offset to prevent synchronised glitter across the list (organic variation, consistent with Phase-2 mindspace-texture philosophy). `prefers-reduced-motion: reduce` disables the shimmer; the static border tint remains.

4. **No leak in SFW mode.** When SFW is active and the result is empty (or partially filtered), the UI renders **identically** to the "no personas yet" state — no "X hidden" counters, no "switch to NSFW to see them" hints, no explanatory copy. The only indication that NSFW personas exist is the pill itself in the Brand-Bar. Chris's use case is sharing a device's screen with someone unaware of the NSFW personas; the SFW view must be undistinguishable from a fresh install with no adult personas at all.

5. **All persona-listing surfaces use a single filtered source.** A new hook `useFilteredPersonas()` is the single source of truth for any UI that displays personas as a list, counts personas, or resolves a recent persona reference. Raw `usePersonas()` is reserved for persona-by-id lookups inside Editor-class contexts. This becomes a project-wide convention (the new ADR documents it).

6. **Pill displays the active mode, not both modes side-by-side.** Single-state pill, click to toggle. Active = NSFW → red-toned "NSFW" pill with a `⇄` glyph for discoverability. Active = SFW → grey-toned "SFW" pill with the same `⇄`. The pill colour matches the colour of the card-glow it controls — visually you see "this is the colour personas of this category have, you are seeing only those".

7. **Mindspace + NSFW are orthogonal visual axes on the persona card.** Mindspace owns the card background tint and the base border colour (per-persona inner identity). NSFW/SFW owns the outer ring + shimmer (cross-cutting status). A Verdan-mindspace NSFW persona reads as "green-tinted card with a red shimmering outer ring" — both colours sit at their conceptually-correct layer, no fight for visual primacy.

8. **The Persona Editor takes over the global mindspace context on mount.** When the editor opens an existing persona, it calls `useMindspaceStore.update({ persona })` with the persona's mindspaceId and textureOverride. When the editor unmounts (back-navigate to Circle), Circle's own mount-effect resets the store to the user default. CSS variable transitions on the `MindspaceLayer` make the swap visually smooth. Create-mode (no persona yet) leaves the global default in place until the user picks a mindspace via the override picker.

9. **Persona-listing counts also respect adult-mode.** The Entrance Hall RoomTile reads "My Circle • X personas" — this `X` is the filtered count, not the raw count. Same rule applies to any future count display (Phase-3 unread-chat counters etc.). Phase-3 chat-list filtering and the panic-button idea are deferred to Phase 3.

---

## 3. Architecture

Four items, ordered by dependency:

```
1. Dexie v5 — SettingsRow.adultMode field + migration
2. Hooks — useAdultMode, useFilteredPersonas (data layer foundation)
3. UI components — AdultModeToggle, PersonaCard redesign
4. Integration — Root brand-bar layout, Circle filter, Hall filter,
                Persona-Editor mindspace transition
```

No cross-item shared state; each is independently testable. Order matters: the schema must land before the hooks; the hooks must exist before the components consume them; the components must exist before routes mount them.

### Files touched

| File | Change |
|---|---|
| `apps/user-client/src/boot/client-data-db.ts` | Add `SettingsRow.adultMode: 'nsfw' \| 'sfw'`; Dexie v5 migration backfills `'nsfw'`; v1 seed writes `'nsfw'` |
| `apps/user-client/src/data/settings.ts` | New `useAdultMode()` hook returning `{ mode, toggleMode, setMode }` |
| `apps/user-client/src/data/personas.ts` | New `useFilteredPersonas()` hook composing `usePersonas()` + `useAdultMode()` |
| `apps/user-client/src/components/AdultModeToggle.tsx` (new) | Pill component, click toggles |
| `apps/user-client/src/components/PersonaCard.tsx` | Redesign — mindspace tint + NSFW/SFW ring + shimmer |
| `apps/user-client/src/index.css` | New `.persona-card-*` rules + `@keyframes persona-shimmer-*` |
| `apps/user-client/src/routes/root.tsx` | Mount `<AdultModeToggle />` centred in brand-bar; layout change from `justify-between` two-child to three-child distribution |
| `apps/user-client/src/routes/app/circle.tsx` | Switch from `usePersonas()` to `useFilteredPersonas()`; pass resolved mindspace to each PersonaCard; ensure Circle's empty-state is unchanged regardless of filter cause |
| `apps/user-client/src/routes/app/entrance-hall.tsx` | Switch from `usePersonas()` to `useFilteredPersonas()` for the count + `recentPersona` lookup |
| `apps/user-client/src/routes/app/persona-editor.tsx` | Mount-effect calls `useMindspaceStore.update({ persona: { mindspaceId, textureOverride } })` for the loaded persona; unmount-effect resets to default |

### Tests touched

| File | Coverage |
|---|---|
| `apps/user-client/tests/boot/client-data-db-v5.test.ts` (new) | v5 migration backfills `adultMode: 'nsfw'`; fresh install seeds `'nsfw'` |
| `apps/user-client/tests/data/use-adult-mode.test.tsx` (new) | toggleMode flips state and persists; setMode writes specific value |
| `apps/user-client/tests/data/use-filtered-personas.test.tsx` (new) | NSFW returns all; SFW filters `adultPersona: true`; reactive to mode change |
| `apps/user-client/tests/components/AdultModeToggle.test.tsx` (new) | Click toggles; shows correct label + colour for each mode; has `⇄` glyph |
| `apps/user-client/tests/components/PersonaCard.test.tsx` (extend or new) | Renders with mindspace background; NSFW persona has danger glow class; SFW persona has soft glow class |
| `apps/user-client/tests/routes/circle.filter.test.tsx` (new) | SFW + all-adult personas → empty-state identical to no-personas state |
| `apps/user-client/tests/routes/entrance-hall.filter.test.tsx` (new) | RoomTile count + Continue-chat card filter by adult-mode |
| `apps/user-client/tests/routes/persona-editor.mindspace.test.tsx` (new) | Mount updates mindspace store with persona's mindspaceId |

---

## 4. Item-by-item design

### 4.1 Adult-mode storage

**Schema (Dexie v5):**

```ts
export interface SettingsRow {
  id: 1;
  displayName: string;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
  animationsEnabled: boolean;
  adultMode: 'nsfw' | 'sfw';   // NEW in v5
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}
```

Migration:

```ts
this.version(5)
  .stores({ /* unchanged from v4 */ })
  .upgrade(async (tx) => {
    const settings = await tx.table('settings').get(1);
    if (settings && typeof settings.adultMode !== 'string') {
      await tx.table('settings').update(1, { adultMode: 'nsfw' });
    }
  });
```

Fresh-install seed in `seedBuiltinsIfNeeded`:

```ts
adultMode: 'nsfw',
```

**Sync-exclusion contract (forward-looking note):** when a sync system lands in a future phase, `adultMode` must be in the exclusion list (per Decision 2). Today this is just a comment near the field; the actual exclusion mechanism does not exist yet. A future ADR captures it formally.

### 4.2 Hooks

**`useAdultMode()`** in `apps/user-client/src/data/settings.ts`:

```ts
export function useAdultMode(): {
  mode: 'nsfw' | 'sfw';
  toggleMode: () => Promise<void>;
  setMode: (m: 'nsfw' | 'sfw') => Promise<void>;
} {
  const settings = useSettings();
  const update = useUpdateSettings();
  const mode = settings.data?.adultMode ?? 'nsfw';
  return {
    mode,
    toggleMode: () => update.mutateAsync({ adultMode: mode === 'nsfw' ? 'sfw' : 'nsfw' }),
    setMode: (m) => update.mutateAsync({ adultMode: m }),
  };
}
```

**`useFilteredPersonas()`** in `apps/user-client/src/data/personas.ts`:

```ts
export function useFilteredPersonas(): UseQueryResult<PersonaRow[]> {
  const personas = usePersonas();
  const { mode } = useAdultMode();
  const filtered = personas.data?.filter((p) => mode === 'nsfw' || !p.adultPersona);
  return { ...personas, data: filtered };
}
```

Returns a `UseQueryResult`-shaped object so callers can use the same loading/error semantics as raw `usePersonas()` — drop-in replacement.

**Project guideline (new ADR or just a comment in `data/personas.ts`):** any UI that lists personas, counts them, or resolves a recent persona reference for display MUST use `useFilteredPersonas()`. Raw `usePersonas()` is for Editor-class persona-by-id lookups only.

### 4.3 AdultModeToggle component

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useAdultMode } from '../data/settings.js';

/**
 * Brand-bar pill toggling the global adult-mode filter.
 *
 * NSFW: red-toned (matches PersonaCard NSFW glow).
 * SFW:  grey-toned (matches PersonaCard SFW glow).
 *
 * Single-state pill (shows active mode + ⇄ glyph for discoverability).
 * Click toggles. The pill itself shimmers subtly via CSS — see
 * .adult-mode-toggle-nsfw / .adult-mode-toggle-sfw in index.css.
 */
export function AdultModeToggle(): JSX.Element {
  const { mode, toggleMode } = useAdultMode();
  const isNsfw = mode === 'nsfw';
  return (
    <button
      type="button"
      onClick={() => void toggleMode()}
      aria-label={`Adult mode: ${mode.toUpperCase()}. Tap to switch.`}
      className={`adult-mode-toggle ${
        isNsfw ? 'adult-mode-toggle-nsfw' : 'adult-mode-toggle-sfw'
      } inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider`}
    >
      {mode.toUpperCase()}
      <span aria-hidden="true" className="opacity-60">⇄</span>
    </button>
  );
}
```

CSS in `index.css`:

```css
.adult-mode-toggle {
  position: relative;
  overflow: hidden;
  border: 1px solid transparent;
  transition: background 200ms ease, border-color 200ms ease;
}

.adult-mode-toggle-nsfw {
  background: rgba(255, 122, 138, 0.10);
  border-color: rgba(255, 122, 138, 0.40);
  color: var(--color-danger);
}

.adult-mode-toggle-sfw {
  background: rgba(185, 180, 207, 0.06);
  border-color: rgba(185, 180, 207, 0.25);
  color: var(--color-paper-soft);
}

.adult-mode-toggle::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(255, 255, 255, 0.18) 50%,
    transparent 70%
  );
  transform: translateX(-110%);
  pointer-events: none;
}

.adult-mode-toggle-nsfw::before { animation: pill-shimmer 7s ease-in-out infinite; }
.adult-mode-toggle-sfw::before  { animation: pill-shimmer 12s ease-in-out infinite; }

@keyframes pill-shimmer {
  0%, 85%   { transform: translateX(-110%); }
  92%       { transform: translateX(0); }
  100%      { transform: translateX(110%); }
}

@media (prefers-reduced-motion: reduce) {
  .adult-mode-toggle::before { animation: none; }
}
```

### 4.4 Brand-bar layout for the three-child distribution

Current Root brand-bar:

```tsx
<header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-sm lg:px-6 lg:py-4">
  <Link to="/" …>…</Link>
  <div …>{badge}</div>
</header>
```

New:

```tsx
<header className="sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-3 backdrop-blur-sm lg:px-6 lg:py-4">
  <Link to="/" …>…</Link>
  <AdultModeToggle />
  <div …>{badge}</div>
</header>
```

`justify-between` with three children distributes them left-centre-right with equal gaps. At 380 px viewport:
- Padding: 32 px (px-4 mobile)
- Logo: ~110 px
- Pill: ~70 px ("NSFW ⇄")
- Badge: ~60 px ("Local")
- Sum of children: ~240 px
- Available for inter-child gaps: 380 − 32 − 240 = 108 px / 2 gaps = 54 px each. Plenty.

Adds `gap-2` as a floor so very-narrow children don't end up uncomfortably close.

### 4.5 PersonaCard redesign

The card is composed of three visual layers (CSS `box-shadow` stacking + a `::before` shimmer):

1. **Persona identity** (innermost): monogram tile (`persona.colour`), name (`persona.colour`), tagline — unchanged from today.
2. **Mindspace** (card body): `background: ${mindspace.palette.surfaceBase}1a` (10 % opacity hex suffix), `border: 1px solid ${mindspace.palette.accentBorder}`.
3. **Adult-status** (outer): `box-shadow` ring outside the border, plus animated shimmer streak via `::before`.

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { Link } from 'react-router-dom';
import type { PersonaRow } from '../boot/client-data-db.js';
import type { ResolvedMindspace } from '../state/mindspace-resolver.js';
import { monogramFor } from '../lib/monogram.js';

interface Props {
  persona: PersonaRow;
  mindspace: ResolvedMindspace;
  hasProvider: boolean;
  onChat: (personaId: string) => void;
}

export function PersonaCard({ persona, mindspace, hasProvider, onChat }: Props): JSX.Element {
  const monogram = monogramFor(persona.name);
  const tagline = persona.tagline || persona.instructions.slice(0, 60);
  // Per-card random offset so cards don't shimmer in unison.
  const shimmerDelay = (hashStringToInt(persona.id) % 4000) / 1000; // 0-4s

  return (
    <li
      data-persona-card
      data-adult={persona.adultPersona ? 'true' : 'false'}
      className={`persona-card relative flex items-center gap-3 rounded-lg ${
        persona.adultPersona ? 'persona-card-nsfw' : 'persona-card-sfw'
      }`}
      style={{
        background: `${mindspace.palette.surfaceBase}1a`,
        border: `1px solid ${mindspace.palette.accentBorder}`,
        ['--persona-shimmer-delay' as string]: `${shimmerDelay}s`,
      }}
    >
      {/* … existing inner markup (Link + monogram tile + chat button) … */}
    </li>
  );
}

function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
```

CSS:

```css
.persona-card {
  position: relative;
  overflow: hidden;
  transition: background 250ms ease;
}

.persona-card-sfw {
  box-shadow:
    0 0 0 1px rgba(185, 180, 207, 0.20),
    0 0 8px -4px rgba(185, 180, 207, 0.30);
}

.persona-card-nsfw {
  box-shadow:
    0 0 0 1px rgba(255, 122, 138, 0.45),
    0 0 12px -2px rgba(255, 122, 138, 0.40);
}

.persona-card::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(255, 255, 255, 0.10) 50%,
    transparent 70%
  );
  transform: translateX(-110%);
  border-radius: inherit;
  animation-delay: var(--persona-shimmer-delay, 0s);
}

.persona-card-sfw::after  { animation: persona-shimmer 12s ease-in-out infinite; }
.persona-card-nsfw::after { animation: persona-shimmer 7s ease-in-out infinite; }

@keyframes persona-shimmer {
  0%, 88% { transform: translateX(-110%); }
  94%     { transform: translateX(0); }
  100%    { transform: translateX(110%); }
}

@media (prefers-reduced-motion: reduce) {
  .persona-card::after { animation: none; }
}
```

The shimmer keyframe spends 88 % of the cycle invisible (off-screen left), 6 % crossing the visible area, then 6 % off-screen right. With a 12 s cycle the visible glint lasts ~720 ms, with 7 s cycle ~420 ms. Subtle and unobtrusive.

### 4.6 Circle list with filter

```tsx
import { useFilteredPersonas } from '../../data/personas.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useSettings } from '../../data/settings.js';
import { resolveMindspace } from '../../state/mindspace-resolver.js';

export function Circle(): JSX.Element {
  // …
  const personas = useFilteredPersonas();
  const mindspaces = useMindspaces();
  const settings = useSettings();
  const defaultMindspaceId = settings.data?.defaultMindspaceId;
  const defaultTexture = settings.data?.userTexture ?? null;

  return (
    <section …>
      {/* unchanged header */}

      {personas.data && personas.data.length === 0 ? (
        <div className="mt-8 grid place-items-center text-center text-paper-soft">
          <p className="font-display text-lg italic text-paper">No personas yet</p>
          <p className="mt-2 max-w-xs text-sm">
            Tap the "+" button below to create your first companion.
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {(personas.data ?? []).map((p) => {
          const ms = resolveMindspace({
            persona: { mindspaceId: p.mindspaceId, textureOverride: p.textureOverride },
            defaultMindspaceId: defaultMindspaceId ?? '',
            defaultTexture,
            mindspaces: mindspaces.data ?? [],
          });
          if (!ms) return null; // mindspaces not loaded yet
          return <PersonaCard key={p.id} persona={p} mindspace={ms} … />;
        })}
      </ul>

      {/* unchanged FAB */}
    </section>
  );
}
```

Note: the empty-state copy is **identical** to the "no personas yet" state, regardless of whether the filter or the actual absence caused the empty list. Per Decision 4 (no leak).

### 4.7 Entrance Hall filter

`entrance-hall.tsx` swaps `usePersonas()` → `useFilteredPersonas()`. The `personaCount = personas.data?.length ?? 0` line then reflects the filtered count automatically. The `recentPersona = personas.data?.find(...)` lookup naturally returns `undefined` for NSFW personas under SFW mode, and the `{recentChat && recentPersona ? … : null}` conditional already hides the Continue-chat card in that case.

### 4.8 Persona-Editor mindspace transition

In `persona-editor.tsx`, add an effect that updates the global mindspace store when the loaded persona changes:

```tsx
import { useMindspaceStore } from '../../state/mindspace.store.js';

// inside PersonaEditor component, after the existing data hooks:
const setMindspace = useMindspaceStore((s) => s.update);

useEffect(() => {
  if (!mindspaces.data || !settings.data) return;
  setMindspace({
    persona: persona.data
      ? { mindspaceId: persona.data.mindspaceId, textureOverride: persona.data.textureOverride }
      : null,
    defaultMindspaceId: settings.data.defaultMindspaceId,
    defaultTexture: settings.data.userTexture,
    mindspaces: mindspaces.data,
  });
}, [persona.data, mindspaces.data, settings.data, setMindspace]);
```

When the user navigates back to Circle, Circle's own mount-effect (which already exists in Phase 2 — it sets `persona: null` for the global default) resets the store. CSS-variable updates in `MindspaceLayer` make the transition visually smooth via existing CSS transitions.

For Create-mode (`persona.data === undefined`), the store stays on the user default until the user picks a mindspace via the override picker. Live preview during picker interaction is out-of-scope for this phase (would require lifting the picker's draft state into the global store — Phase 3 polish).

---

## 5. Migration plan

### Dexie schema

```
v4 → v5: SettingsRow.adultMode: 'nsfw' | 'sfw'
        v5 migration backfills 'nsfw' on existing rows
        v1 seed for fresh installs writes 'nsfw'
```

No data loss on downgrade — `adultMode` is a non-indexed enum string; v4-aware code reads `undefined` and falls back to NSFW per the `useAdultMode()` default.

### CSS

New classes:
- `.adult-mode-toggle`, `.adult-mode-toggle-nsfw`, `.adult-mode-toggle-sfw`
- `.persona-card`, `.persona-card-sfw`, `.persona-card-nsfw`
- `@keyframes pill-shimmer`, `@keyframes persona-shimmer`

All scoped to the new component classes; no conflicts with existing rules.

### No `useUpdateSettings`-shape changes

`adultMode` is just another key in `Partial<Omit<SettingsRow, 'id' | 'createdAt'>>`, so the existing mutate signature already accepts it.

---

## 6. Acceptance criteria

Manually verifiable on Chris's smallest-Chromium-viewport profile:

### Adult mode storage & default
1. Fresh install → `adultMode === 'nsfw'`; pill shows "NSFW".
2. Reload after toggling to SFW → pill still shows "SFW" (persisted).
3. On an existing v4 install (no `adultMode` field), opening the app after upgrade → pill shows "NSFW" (backfill default).

### AdultModeToggle in Brand-Bar
4. Brand-Bar shows three children evenly distributed: logo (left), pill (centre), connectivity badge (right).
5. Pill text matches active mode; pill colour is red on NSFW, grey on SFW.
6. Click pill → mode toggles, pill colour and text update without a reload.
7. Pill shimmers subtly: SFW every 12 s, NSFW every 6-8 s. With `prefers-reduced-motion: reduce`, no shimmer.

### PersonaCard visuals
8. Each card's background tint matches the persona's resolved mindspace (Verdan → green, Crimson → red-warm, …).
9. Each card's outer ring is red when persona is NSFW (`adultPersona: true`), grey-soft when SFW.
10. Shimmer crosses the card border roughly every 7 s (NSFW) / 12 s (SFW); cards do not shimmer in unison (random per-card delay).
11. With `prefers-reduced-motion: reduce`, no shimmer; static ring remains.

### Filter behaviour & no-leak
12. NSFW mode → Circle shows all personas (including adult ones).
13. SFW mode → Circle shows only non-adult personas.
14. SFW mode + all personas adult → Circle renders the same "No personas yet — tap +" empty-state as a fresh install; no hint that hidden personas exist.
15. Entrance Hall RoomTile "My Circle • X personas" — `X` is the filtered count in SFW mode.
16. Entrance Hall "Continue chat" card — hidden in SFW mode when the most-recent chat is with an adult persona.

### Persona-Editor mindspace transition
17. Tap a persona with Verdan mindspace from Circle → editor opens with the global ambient mindspace switched to Verdan; background gradient transitions smoothly.
18. Back to Circle → ambient mindspace reverts to user default.
19. Create-mode (`+ New Persona`) → ambient mindspace stays on user default until the user picks one via the override picker.

---

## 7. Open questions

None for this phase. Future considerations flagged but explicitly out of scope:

- **Panic button in chat (Phase 3):** Chris noted the idea — a one-tap kick-out from an in-flight NSFW chat. Lives in Phase 3's backlog.
- **Live mindspace preview during picker interaction (Phase 3 polish):** Currently the persona-editor only switches ambient on mount with the persisted value. Live preview while the user clicks through the picker would require lifting the picker's draft into the global store.
- **Sync exclusion list:** When sync arrives in a future phase, `adultMode` (and likely `userTexture`, `defaultMindspaceId`, `displayName`) must be in a sync-exclusion list. Today this is just a code comment near the field.

---

## 8. Manual verification (device-tested by Chris)

The full 19-point acceptance list. Recommended sequence on Chris's smallest-Chromium-viewport profile:

1. Fresh install (clear IndexedDB) → Hall greeting, pill shows "NSFW".
2. Create one NSFW persona (toggle `Adult Persona` in editor), one SFW persona. Each in a different mindspace. Back to Circle → two cards, each in its mindspace tint, NSFW card glowing red.
3. Toggle pill to SFW → Circle shows only the SFW card; pill goes grey; Hall RoomTile drops to "1 persona".
4. Toggle pill back to NSFW → both cards return.
5. Delete the SFW persona; ensure mode is SFW → Circle shows the "No personas yet" empty-state, no leak.
6. Switch to NSFW → NSFW persona reappears.
7. Tap NSFW persona's card → editor opens, ambient mindspace transitions to the persona's mindspace.
8. Back to Circle → ambient transitions back to default.
9. Toggle `prefers-reduced-motion: reduce` in OS → reload → no shimmers anywhere; static borders/glows remain.

---

## 9. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Persona-card shimmer + mindspace gradient + brand-bar pill shimmer feel busy together | Medium | Strict timing budgets (≤6 % of cycle visible); per-card random offsets prevent unison; reduced-motion full-off path |
| Brand-bar at 380 px feels cramped with three children | Medium | Pill is compact (~70 px); `gap-2` floor prevents touching; manual smoke validates |
| Adult-mode storage in shared Dexie row gets sync'd by accident when sync lands | High (future) | Documented contract; future ADR captures sync-exclusion mechanism before sync ships |
| User in NSFW chat (Phase 3) when toggling to SFW mid-session | Medium (Phase 3 territory) | Out of scope here; Phase-3 panic-button backlog item |
| Mindspace transition on editor mount flashes when CSS-variables update | Low | `MindspaceLayer` already writes CSS-variables via React effect; transition smoothness inherited from Phase 2 |

---

## 10. Sequencing

Single squashed commit at the end of the implementation plan ("Phase 2.9 — Mindspace Cards & Adult Mode"), matching the Phase 2.5/2.6/2.7-style. Plus a separate `[skip ci]` STATUS-CLIENT-ONLY update commit.
