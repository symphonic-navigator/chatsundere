# Chat Font Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New personas default to `sans`, and users get a global, per-device chat reading-text size control (Standard/Large/Larger) in the cockpit ⋯ menu.

**Architecture:** Two independent units. Unit 1 is a one-line default-seed flip. Unit 2 stores a per-device `SettingsRow.chatFontScale` (device-local by allowlist omission, no Dexie bump), applies it as a single `--chat-font-scale` CSS custom property on `.chat-page` that multiplies the reading-text `font-size`s in `index.css`, and exposes a three-chip control in `CockpitMenu`.

**Tech Stack:** React 18, TypeScript (strict), Tailwind v4 + `index.css`, Dexie, TanStack Query, Vitest.

## Global Constraints

- **British English for all UI copy and comments.** The size labels shown to the user are **Standard · Large · Larger** (the internal values are `standard` · `large` · `larger`). No German in the repo.
- **TypeScript strict**; no `any` without an inline justification.
- **No Dexie version bump.** `chatFontScale` is an optional, non-indexed field; default is resolved at read (`?? 'standard'`), never by migration.
- **Device-local by construction.** `chatFontScale` must NOT be added to `SETTINGS_SYNC_ALLOWLIST` in `sync/strip.ts`; the settings collection uses allowlist polarity, so omission keeps it per-device.
- **Client-only.** No `auth-service`/`sync-service`/`proxy-service`/`packages/crypto` change → no Larissa. Laura pre-squash pass still owed after build.
- Working directory for all paths: `apps/user-client/`. Run tests with `pnpm --filter @chatsundere/user-client test <path>` (Vitest). Restart the dev stack before manual verification (Vite HMR ignores `packages/*` and the new `SettingsRow` field loads cleanly on a fresh boot).

Spec: `superpowers/specs/2026-07-18-chat-font-tuning-design.md`.

---

### Task 1: Persona default font → `sans` (Unit 1)

**Files:**
- Modify: `apps/user-client/src/routes/app/persona/persona-draft.ts:26`
- Test: `apps/user-client/tests/routes/persona-draft-background.test.ts` (extend — it already exercises `defaultDraft`)

**Interfaces:**
- Consumes: `defaultDraft(settings, mindspaces, providers)` (existing).
- Produces: nothing new; only the seeded `font` value changes to `'sans'`.

- [ ] **Step 1: Write the failing test** — add to `tests/routes/persona-draft-background.test.ts`:

```ts
import { defaultDraft } from '../../src/routes/app/persona/persona-draft.js';

describe('defaultDraft font default', () => {
  it('seeds a new persona with the sans font', () => {
    expect(defaultDraft(undefined, undefined, undefined).font).toBe('sans');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/routes/persona-draft-background.test.ts`
Expected: FAIL — received `'serif'`.

- [ ] **Step 3: Make the change** — `persona-draft.ts:26`:

```ts
    font: 'sans',
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/routes/persona-draft-background.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona/persona-draft.ts apps/user-client/tests/routes/persona-draft-background.test.ts
git commit -m "Default new personas to the sans font"
```

---

### Task 2: `chatFontScale` foundation — type, scale helper, settings field, device-local pin (Unit 2)

**Files:**
- Create: `apps/user-client/src/lib/chat-font-scale.ts`
- Create: `apps/user-client/tests/lib/chat-font-scale.test.ts`
- Modify: `apps/user-client/src/boot/client-data-db.ts` (add `chatFontScale` to the `SettingsRow` interface)
- Modify: `apps/user-client/src/sync/strip.ts` (doc-comment line recording the deliberate device-local omission)
- Test: `apps/user-client/tests/sync/strip.test.ts` (extend — pin the device-local property)

**Interfaces:**
- Produces:
  - `type ChatFontScale = 'standard' | 'large' | 'larger'`
  - `const CHAT_FONT_SCALE: Record<ChatFontScale, number>` = `{ standard: 1, large: 1.15, larger: 1.3 }`
  - `function chatFontScaleValue(scale: ChatFontScale | undefined): number` — absent ⇒ `1`
  - `SettingsRow.chatFontScale?: ChatFontScale`
- Consumes: `SETTINGS_SYNC_ALLOWLIST`, `patchTouchesSyncedField` (existing, from `sync/strip.ts`).

- [ ] **Step 1: Write the failing helper test** — `tests/lib/chat-font-scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chatFontScaleValue } from '../../src/lib/chat-font-scale.js';

describe('chatFontScaleValue', () => {
  it('maps each step to its multiplier', () => {
    expect(chatFontScaleValue('standard')).toBe(1);
    expect(chatFontScaleValue('large')).toBe(1.15);
    expect(chatFontScaleValue('larger')).toBe(1.3);
  });

  it("defaults an absent scale to 1 (today's baseline)", () => {
    expect(chatFontScaleValue(undefined)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chat-font-scale.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/chat-font-scale.js`.

- [ ] **Step 3: Create the helper module** — `src/lib/chat-font-scale.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Chat reading-text size steps (behaviour-axis, per-device — see sync/strip.ts).
 *  'standard' is today's baseline; the feature only adds headroom above it. */
export type ChatFontScale = 'standard' | 'large' | 'larger';

/** Multiplier applied to the chat reading text at each step. Starting points,
 *  tunable on-device; not a contract. */
export const CHAT_FONT_SCALE: Record<ChatFontScale, number> = {
  standard: 1,
  large: 1.15,
  larger: 1.3,
};

/** Resolve a stored (possibly absent) scale to its multiplier. Absent ⇒ 1. */
export function chatFontScaleValue(scale: ChatFontScale | undefined): number {
  return CHAT_FONT_SCALE[scale ?? 'standard'];
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chat-font-scale.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Add the settings field** — `src/boot/client-data-db.ts`, inside the `SettingsRow` interface, add the field next to the other optional non-indexed fields (e.g. after `artefactExpertModel`). First add the type import at the top of the file with the other type imports:

```ts
import type { ChatFontScale } from '../lib/chat-font-scale.js';
```

Then in `SettingsRow`:

```ts
  /** Chat reading-text size (behaviour-axis, per-device — deliberately NOT
   *  synced, see sync/strip.ts). Absent ⇒ 'standard' (today's baseline).
   *  Non-indexed (schemaless) — no Dexie version bump. */
  chatFontScale?: ChatFontScale;
```

- [ ] **Step 6: Pin the device-local property** — add to `tests/sync/strip.test.ts` (reuse the file's existing imports of `SETTINGS_SYNC_ALLOWLIST` and `patchTouchesSyncedField`; add them to the import if absent):

```ts
describe('chatFontScale is device-local', () => {
  it('is absent from the settings sync allowlist', () => {
    expect(SETTINGS_SYNC_ALLOWLIST).not.toContain('chatFontScale');
  });

  it('a chatFontScale-only patch is a plain local write (not a synced field)', () => {
    expect(patchTouchesSyncedField('settings', ['chatFontScale'])).toBe(false);
  });
});
```

- [ ] **Step 7: Record the deliberate omission** — in `src/sync/strip.ts`, extend the "Deliberately device-local and therefore ABSENT" JSDoc list (above `SETTINGS_SYNC_ALLOWLIST`) with:

```
 *  - `chatFontScale`      — per-device reading-comfort size; a big-monitor and a
 *                           phone want different sizes, so it must never sync.
```

Do NOT add `chatFontScale` to the allowlist array.

- [ ] **Step 8: Run the touched suites + typecheck**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/chat-font-scale.test.ts tests/sync/strip.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS (the new `SettingsRow` field type-checks against `ChatFontScale`).

- [ ] **Step 9: Commit**

```bash
git add apps/user-client/src/lib/chat-font-scale.ts apps/user-client/tests/lib/chat-font-scale.test.ts apps/user-client/src/boot/client-data-db.ts apps/user-client/src/sync/strip.ts apps/user-client/tests/sync/strip.test.ts
git commit -m "Add device-local chatFontScale setting and scale helper"
```

---

### Task 3: Apply the scale — CSS variable + `.chat-page` wiring (Unit 2)

**Files:**
- Modify: `apps/user-client/src/index.css` (`.msg-text`, `.msg-name`, `.msg-text pre code`, `.reasoning-pill`)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (set `--chat-font-scale` on `.chat-page`)

**Interfaces:**
- Consumes: `chatFontScaleValue` (Task 2), `settingsQuery.data.chatFontScale` (Task 2 field).
- Produces: the `--chat-font-scale` custom property on `.chat-page`, honoured by the reading-text selectors.

This task is CSS + a single style attribute; it is verified by typecheck, build, and on-device manual steps (Task 6 in the spec's Manual Verification), consistent with the project's "manual verification beats automated coverage for UX" rule. No unit test.

- [ ] **Step 1: Scale the reading-text selectors** — in `src/index.css`:

`.msg-text` (base ~line 584):

```css
.msg-text {
  font-size: calc(0.95rem * var(--chat-font-scale, 1));
  line-height: 1.5;
  word-wrap: break-word;
  min-width: 0;
}
```

`.msg-name` (~line 552) — change only its `font-size`:

```css
.msg-name {
  font-size: calc(0.95rem * var(--chat-font-scale, 1));
```

`.msg-text pre code` (~line 663) — change `0.82rem` to `0.82em` so code fences ride the scaled base:

```css
.msg-text pre code {
  background: none;
  font-family: var(--font-mono);
  font-size: 0.82em;
}
```

`.reasoning-pill` (~line 2129) — change only its `font-size`:

```css
.reasoning-pill,
```
(the shared rule) →
```css
  font-size: calc(0.78rem * var(--chat-font-scale, 1));
```

Leave `.pill` (`0.9em`) unchanged — it is nested inside the scaled `.msg-text` and rides the base automatically.

- [ ] **Step 2: Set the variable on `.chat-page`** — in `src/routes/app/chat/chat-page.tsx`:

Add the import (with the other `lib/` imports):

```ts
import { chatFontScaleValue } from '../../../lib/chat-font-scale.js';
```

On the root `.chat-page` element (currently `<div className="chat-page" data-mode={...}>`), add a `style` prop:

```tsx
    <div
      className="chat-page"
      data-mode={isInteractionMode ? 'interaction' : 'reading'}
      style={
        { '--chat-font-scale': chatFontScaleValue(settingsQuery.data?.chatFontScale) } as React.CSSProperties
      }
    >
```

(`settingsQuery` is the existing `useSettings`-backed query already read in this file, e.g. `settingsQuery.data.screenEffectsEnabled`.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client build` (or `pnpm run build`)
Expected: PASS (CSS compiles, no unknown-property errors).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/index.css apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Scale chat reading text by the --chat-font-scale variable"
```

---

### Task 4: `CockpitMenu` Text-size section (Unit 2)

**Files:**
- Modify: `apps/user-client/src/components/chat/CockpitMenu.tsx`
- Modify: `apps/user-client/src/index.css` (chip intrinsic-size cue)
- Test: `apps/user-client/tests/components/chat/CockpitMenu.test.tsx` (extend)

**Interfaces:**
- Consumes: `ChatFontScale` (Task 2).
- Produces: two new required `CockpitMenu` props — `chatFontScale: ChatFontScale` and `onChatFontScaleChange: (scale: ChatFontScale) => void` — consumed by Task 5.

- [ ] **Step 1: Write the failing tests** — add to `tests/components/chat/CockpitMenu.test.tsx` (reuse the file's existing render helper / baseline props; pass a bare reasoning control `{ mode: 'none' }` and the two new props). Use `@testing-library/react`:

```tsx
it('always renders the Text size section, even for a bare model', () => {
  render(
    <CockpitMenu
      control={{ mode: 'none' } as ReasoningControl}
      reasoning={/* baseline from the file's helper */}
      onReasoningChange={vi.fn()}
      onClose={vi.fn()}
      chatFontScale="standard"
      onChatFontScaleChange={vi.fn()}
    />,
  );
  expect(screen.getByText('Text size')).toBeInTheDocument();
  expect(screen.getByRole('menuitemradio', { name: 'Large' })).toBeInTheDocument();
});

it('marks the active size chip', () => {
  render(<CockpitMenu {/* ...baseline... */} chatFontScale="large" onChatFontScaleChange={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('menuitemradio', { name: 'Large' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemradio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'false');
});

it('changing size reports the new value and does NOT close the menu', () => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<CockpitMenu {/* ...baseline... */} chatFontScale="standard" onChatFontScaleChange={onChange} onClose={onClose} />);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Larger' }));
  expect(onChange).toHaveBeenCalledWith('larger');
  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @chatsundere/user-client test tests/components/chat/CockpitMenu.test.tsx`
Expected: FAIL — `Text size` not found / prop type errors.

- [ ] **Step 3: Add the props + section + always-render** — in `src/components/chat/CockpitMenu.tsx`:

Import the type:

```ts
import type { ChatFontScale } from '../../lib/chat-font-scale.js';
```

Add to `Props`:

```ts
  chatFontScale: ChatFontScale;
  onChatFontScaleChange: (scale: ChatFontScale) => void;
```

Add a label map near the top of the module (module scope):

```ts
const FONT_SIZE_STEPS: readonly ChatFontScale[] = ['standard', 'large', 'larger'];
const FONT_SIZE_LABEL: Record<ChatFontScale, string> = {
  standard: 'Standard',
  large: 'Large',
  larger: 'Larger',
};
```

**Remove the early `null` return** (`if (!hasReasoning && !hasDepth && !p.askExpertAvailable && !p.artefactExpertAvailable) return null;`) — the Text-size section is always present, so the menu always has content.

At the **end** of the `<div className="cockpit-menu" role="menu">` children (after the expert sections), add:

```tsx
      <div className="cockpit-menu-section" data-section="font-size">
        <div className="cockpit-menu-label">Text size</div>
        <div className="cockpit-menu-chips">
          {FONT_SIZE_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              role="menuitemradio"
              aria-checked={p.chatFontScale === step}
              className={`cockpit-chip${p.chatFontScale === step ? ' active' : ''}`}
              data-size={step}
              onClick={() => p.onChatFontScaleChange(step)}
            >
              {FONT_SIZE_LABEL[step]}
            </button>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Add the chip intrinsic-size cue** — in `src/index.css`, so each chip previews its own size (robust even when the messages behind are dimmed):

```css
.cockpit-menu-chips {
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
}
.cockpit-chip[data-size='large'] {
  font-size: 1.15em;
}
.cockpit-chip[data-size='larger'] {
  font-size: 1.3em;
}
```

(If `.cockpit-chip`/`.cockpit-menu-chips` base styling does not yet exist, mirror the existing `.cockpit-menu` chip/pill styling in the file for background, radius, padding, and the `.active` state so the section reads consistently with the reasoning/expert chips.)

- [ ] **Step 5: Run and verify pass**

Run: `pnpm --filter @chatsundere/user-client test tests/components/chat/CockpitMenu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/CockpitMenu.tsx apps/user-client/src/index.css apps/user-client/tests/components/chat/CockpitMenu.test.tsx
git commit -m "Add a Text size section to the cockpit menu"
```

---

### Task 5: Wire the control through `Cockpit` (Unit 2)

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`

**Interfaces:**
- Consumes: `CockpitMenu` props `chatFontScale` + `onChatFontScaleChange` (Task 4); `useSettings` (already imported at `Cockpit.tsx:24,143`); `useUpdateSettings` (`data/settings.js`); `ChatFontScale` (Task 2).
- Produces: nothing downstream — this closes the loop.

`Cockpit` already reads `settings = useSettings()`. It resolves `chatFontScale` from there and writes changes via `useUpdateSettings` (a `chatFontScale`-only patch is a plain local write — see the Task 2 strip test — so it is never sync-gated). No prop threading through `InteractionMode`/`chat-page` is needed; `Cockpit` is self-sufficient for settings.

This task is wiring, verified by typecheck, build, and the on-device manual steps; the menu's behaviour is already unit-tested in Task 4.

- [ ] **Step 1: Add the update hook + type imports** — in `Cockpit.tsx`, extend the settings import and add the type:

```ts
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import type { ChatFontScale } from '../../lib/chat-font-scale.js';
```

In the component body (near `const settings = useSettings();`):

```ts
  const updateSettings = useUpdateSettings();
```

- [ ] **Step 2: Pass the two props to `CockpitMenu`** — in the `<CockpitMenu ... />` usage, add:

```tsx
            chatFontScale={settings.data?.chatFontScale ?? 'standard'}
            onChatFontScaleChange={(scale: ChatFontScale) => {
              void updateSettings.mutateAsync({ chatFontScale: scale });
            }}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm run build`
Expected: PASS.

- [ ] **Step 4: Full user-client suite (regression gate)**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: the known Node-localStorage baseline (8 failures) and no new failures; the new `chat-font-scale`, `strip`, `CockpitMenu`, and `persona-draft` tests all green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx
git commit -m "Wire the cockpit Text size control to the chatFontScale setting"
```

---

## Self-Review

**Spec coverage:**
- §4 Unit 1 (persona default → sans) → Task 1. ✓
- §5.1 `chatFontScale` field + §5.2 device-local + strip comment → Task 2. ✓
- §5.3 scale applied via `--chat-font-scale` (body + name + reasoning + pill + code) → Task 3 (+ `.pill`/code ride the base). ✓
- §5.4 the ⋯-menu control, chips-as-preview, does-not-close-on-tap → Task 4 (section + intrinsic-size cue + no `onClose`). ✓
- §5.5 both breakpoints — inherent (the cockpit renders on both; no breakpoint-specific code). ✓
- §5.6 ⋯ always-meaningful (drop the `null` return) → Task 4 Step 3. ✓
- §6/§8 no Dexie bump, no allowlist entry, no Larissa → Constraints + Task 2. ✓
- §9 edge cases: unset ⇒ 1 (Task 2 helper test); pulled row keeps local value (Task 2 allowlist pin); bare-model ⋯ (Task 4 test); dimmed-mobile preview (Task 4 chip cue). ✓
- §10 manual verification → owner Chris, post-build.

**Placeholder scan:** none — every code step carries concrete code; the only non-TDD tasks (3, 5) are CSS/wiring, verified by typecheck/build/manual per the project rule, and say so explicitly.

**Type consistency:** `ChatFontScale` / `chatFontScaleValue` / `CHAT_FONT_SCALE` used identically across Tasks 2–5; `SettingsRow.chatFontScale?: ChatFontScale`; `CockpitMenu` props `chatFontScale` + `onChatFontScaleChange` defined in Task 4 and consumed in Task 5 with matching signatures. `--chat-font-scale` set in Task 3 and read by the selectors in Task 3.

## After all tasks

- **Laura pre-squash pass** (owed per spec §8): confirm the built ⋯ Text-size flow honours the approved intent (chips preview, menu stays open, always-present menu reads well).
- **Squash** the per-task commits into the two feature units — "Default new personas to the sans font" (Task 1) and "Add per-device chat text-size control" (Tasks 2–5) — or one unit if preferred. Verify the squash captured the full tree (file-count + `pnpm typecheck --force`) before it lands on `master`.
- Update `obsidian/STATUS-CLIENT-ONLY.md`.
