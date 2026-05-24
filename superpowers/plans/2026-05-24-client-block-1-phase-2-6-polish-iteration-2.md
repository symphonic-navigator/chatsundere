# Client Block 1 — Phase 2.6 (Polish Iteration 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the second round of Chris's device-smoke feedback — drop the "Room · "
breadcrumb prefix, introduce a three-action UX (back-discards, save-persists-stays,
save-and-back-persists-navigates) across the two editor surfaces (Persona Editor +
My Settings), switch My Settings from auto-save-on-keystroke to draft-then-save,
make the AccordionCard meta-line dynamic so collapsed sections preview their content
(selected model, NSFW badge, "Using user default" for mindspace), split Font into
its own "Font and Voice" accordion section in the Persona Editor (TTS lands there
later), revoke Decision 28 by dropping `Settings.userFont` entirely (new personas
default to `serif`), and fix the latent `bg-bg/95` transparency bug in the SaveBar
that escaped Phase 2.5.

**Architecture:** Mostly local to `apps/user-client`. One mild schema relaxation
removes `userFont` from `SettingsRow` (Dexie's `'id'`-keyed store is schemaless for
non-indexed fields, so existing-row userFont values are simply ignored — no Dexie
version bump required, but the row type changes). `AccordionCard.meta` widens from
`string` to `ReactNode` so callers can compose dynamic previews (badges, monogram
chips, multi-segment text). The Persona Editor and My Settings each grow an
`EditorTopbar` component that holds back-button (discard, with confirm-on-dirty),
optional title, and a "Save & Back" pill on the right; the existing bottom-anchored
`SaveBar` stays as the "Persist + Stay" action and gets a `saveLabel` prop. My
Settings transitions from per-input `updateSettings.mutate(...)` calls to a single
local-draft state populated from `settings.data`, with `useUpdateSettings()` only
called on Save. Provider configuration retains its own bottom-sheet flow with
explicit "Test & Save" — providers stay out of band of the global settings save.
The MindspacePicker grows a `hideFont` prop so it can be reused without the Font
row (used by both the Persona Editor — Font lives in its own section now — and My
Settings — no User Font any more).

**Tech Stack:** TypeScript strict, React 18, Tailwind v4 (`@theme` config in
`index.css`), Dexie 4 (no migration), TanStack Query v5, Vitest +
`@testing-library/react` + `fake-indexeddb/auto`.

**References:**
- Phase-2.5 plan: `superpowers/plans/2026-05-24-client-block-1-phase-2-5-polish.md`
- Block-1 design spec: `superpowers/specs/2026-05-23-client-block-1-design.md`
  (extended with Decisions 36-41 + a revoke of Decision 28 as part of this phase)
- Status: `obsidian/STATUS-CLIENT-ONLY.md`

---

## File Structure

### Created

- `apps/user-client/src/components/EditorTopbar.tsx`
- `apps/user-client/tests/components/EditorTopbar.test.tsx`
- `apps/user-client/tests/components/AccordionCard.meta-node.test.tsx`
- `apps/user-client/tests/routes/settings.draft-save.test.tsx`
- `apps/user-client/tests/routes/persona-editor.dynamic-meta.test.tsx`
- `apps/user-client/tests/routes/persona-editor.font-and-voice.test.tsx`

### Modified

- `apps/user-client/src/components/AccordionCard.tsx` (`meta?: ReactNode`)
- `apps/user-client/src/components/SaveBar.tsx` (`bg-bg/95` → `bg-ink/95`; new
  `saveLabel?: string` prop; default `'Save'`)
- `apps/user-client/src/components/MindspacePicker.tsx` (`hideFont?: boolean` —
  when true, suppresses the Font row entirely; font and onFontChange become
  optional when hideFont is set)
- `apps/user-client/src/boot/client-data-db.ts` (`SettingsRow.userFont` removed
  from the type; seed and migration no longer write it)
- `apps/user-client/src/routes/app/persona-editor.tsx` (mount EditorTopbar; drop
  "Room · " prefix; dynamic meta for Model / Behavior / Mindspace-Override;
  drop Font from Mindspace section; new Font-and-Voice accordion; SaveBar uses
  `saveLabel="Save Persona"`)
- `apps/user-client/src/routes/app/settings.tsx` (mount EditorTopbar; drop
  "Room · " prefix; convert to draft + SaveBar; SaveBar saveLabel="Save Settings";
  MindspacePicker `hideFont`)
- `apps/user-client/src/routes/app/circle.tsx` (drop "Room · " prefix on the
  topbar — same convention)
- `apps/user-client/src/routes/app/entrance-hall.tsx` (no topbar — only a
  greeting; leave as is, but verify nothing reads `settings.data.userFont`)
- `apps/user-client/src/components/PersonaCard.tsx` (verify it doesn't read
  `settings.userFont` for its default-font preview — should already only use
  `persona.font`)
- `apps/user-client/tests/components/MindspacePicker.controlled.test.tsx` (add
  a `hideFont` case)
- `apps/user-client/tests/routes/settings.test.tsx` (existing — update for the
  draft/save flow)
- `apps/user-client/tests/routes/persona-editor.test.tsx` (existing — update for
  EditorTopbar + Font-and-Voice section)
- `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`
  (existing — re-check accordion ordering assertion after Font-and-Voice insert)
- `apps/user-client/tests/boot/client-data-db-v3.test.ts` (existing — drop the
  `userFont` assertion if any; the schema doesn't claim that field any more)
- `apps/user-client/tests/unit/client-data-db.test.ts` (verify `userFont` is not
  asserted)

### Deleted

- None.

---

## Pre-Existing Pitfalls (carry forward)

- **Vitest test glob is `tests/**/*.test.{ts,tsx}`** — put every new test file under
  `apps/user-client/tests/...`.
- **SPDX header line 1, blank line 2, imports from line 3** — Biome's
  `organizeImports` re-sorts imports; the SPDX must stay above.
- **Biome rules to obey:** `noForEach` (use `for...of`), `noNonNullAssertion`
  (never `!`; use explicit guards), `useKeyWithClickEvents` /
  `useFocusableInteractive` for interactive divs (the back-button stays a
  `<button>` so this only matters if we touch any rogue `<div onClick>`).
- **TanStack-Query cache is stale right after `mutateAsync`** — if My Settings'
  Save does multiple writes in sequence and one needs to read the previous result,
  use the local draft, not `useSettings().data`.
- **Tailwind v4 colour tokens defined in `apps/user-client/src/index.css`** —
  `--color-bg` is NOT defined, `--color-ink` is. `bg-bg/95` resolves to nothing
  (transparent). Always reach for `bg-ink/95` (or `bg-ink`).
- **`@chatsundere/llm-unified` and `@chatsundere/crypto` must be built first** if
  their dist folders are missing (`pnpm --filter @chatsundere/crypto build` etc).
- **Run `pnpm lint` and `pnpm typecheck` from the repo root**, not from inside a
  package.
- **Subagents never push or switch branches.** Commit on master only.

---

## Task 0: Widen `AccordionCard.meta` from `string` to `ReactNode`

**Files:**
- Modify: `apps/user-client/src/components/AccordionCard.tsx`
- Create: `apps/user-client/tests/components/AccordionCard.meta-node.test.tsx`

The downstream tasks (3, 4, 6) need to render badges / pills / multi-segment text
in the collapsed meta line. Widen the prop first so every subsequent task can
just compose JSX.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/AccordionCard.meta-node.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccordionCard } from '../../src/components/AccordionCard.js';

describe('AccordionCard.meta', () => {
  it('accepts a ReactNode and renders embedded markup', () => {
    render(
      <AccordionCard
        icon="∿"
        label="Behavior"
        meta={
          <span>
            Temperature · <span data-testid="adult-flag">NSFW</span>
          </span>
        }
      >
        body
      </AccordionCard>,
    );
    expect(screen.getByTestId('adult-flag').textContent).toBe('NSFW');
  });

  it('still accepts a plain string for legacy callers', () => {
    render(
      <AccordionCard icon="∿" label="X" meta="just text">
        body
      </AccordionCard>,
    );
    expect(screen.getByText('just text')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/components/AccordionCard.meta-node.test.tsx
```

Expected: the ReactNode case FAILS (type narrows to string).

- [ ] **Step 3: Widen the prop in `AccordionCard.tsx`**

In `apps/user-client/src/components/AccordionCard.tsx`, change line 8:

```ts
  meta?: ReactNode;
```

(The existing `import { type ReactNode, useState } from 'react';` already imports
the type — no new import needed.)

The render path is already `{meta ? <div className="text-xs text-paper-soft">{meta}</div> : null}` —
React renders `ReactNode` correctly so no further change.

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/AccordionCard.meta-node.test.tsx
```

Expected: both cases PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/AccordionCard.tsx apps/user-client/tests/components/AccordionCard.meta-node.test.tsx
git commit -m "$(cat <<'EOF'
Widen AccordionCard.meta from string to ReactNode

Lets callers compose dynamic previews (badges, monograms,
multi-segment text) for collapsed accordion sections. Phase 2.6's
Model/Behavior/Mindspace-Override sections need this to surface
selected-state into the header.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Fix the latent `bg-bg/95` transparency in `SaveBar` and add `saveLabel` prop

**Files:**
- Modify: `apps/user-client/src/components/SaveBar.tsx`

The SaveBar uses `bg-bg/95` which resolves to nothing in Tailwind v4 (`--color-bg`
isn't defined; only `--color-ink` is). Same regression as the FAB-glyph bug from
Phase 2.5. Switch to `bg-ink/95`. While we're in there, the hardcoded
"Save Persona" button text needs to become a prop so My Settings can use the
same component with `"Save Settings"`.

This task has no new tests — the existing persona-editor tests already exercise
the SaveBar's onSave / onCancel paths; the visual transparency fix is verified
manually in Chris's smoke.

- [ ] **Step 1: Edit `SaveBar.tsx`**

Replace the file entirely:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  onCancel: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  saveTooltip?: string;
  saveLabel?: string;
}

export function SaveBar({
  onCancel,
  onSave,
  saveDisabled,
  saveTooltip,
  saveLabel = 'Save',
}: Props): JSX.Element {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-white/5 bg-ink/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-paper-soft/30 px-4 py-2 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        title={saveDisabled ? saveTooltip : undefined}
        className="rounded-md border border-paper bg-paper/10 px-6 py-2 text-xs uppercase tracking-wider text-paper hover:bg-paper/20 disabled:opacity-40"
      >
        {saveLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update persona-editor.tsx to pass the explicit label**

In `apps/user-client/src/routes/app/persona-editor.tsx`, find the `<SaveBar …>`
usage and add `saveLabel="Save Persona"`:

```tsx
      <SaveBar
        onCancel={() => navigate('/app/circle')}
        onSave={onSave}
        saveDisabled={!draft.name || !draft.instructions || !draft.providerId || !draft.modelId}
        saveTooltip={…}
        saveLabel="Save Persona"
      />
```

(The same SaveBar call will be wrapped differently in Task 5 when we switch the
Save semantic from "persist + navigate" to "persist + stay" — for now the only
change is the `saveLabel` prop.)

- [ ] **Step 3: Run typecheck + tests**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/SaveBar.tsx apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "$(cat <<'EOF'
Fix SaveBar transparency; let callers set the save-button label

Phase 2.5 caught the bg-bg / text-bg pattern on the FAB and the
ProviderSheet but missed the SaveBar. bg-bg/95 resolves to nothing
under the current Tailwind theme — the bar was transparent.

While we're in there: saveLabel becomes an optional prop so My Settings
can reuse the same component with "Save Settings".

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build `EditorTopbar` component (back-discard with confirm-on-dirty + "Save & Back" pill)

**Files:**
- Create: `apps/user-client/src/components/EditorTopbar.tsx`
- Create: `apps/user-client/tests/components/EditorTopbar.test.tsx`

The shared topbar for the two editor surfaces (Persona Editor + My Settings). Three
slots: a back-button on the left (discard semantic; if `isDirty`, prompts via
`window.confirm` before navigating), an optional title in the centre, and a
"Save & Back" pill on the right. Save & Back is disabled if `saveDisabled` is
true (mirroring SaveBar's disabled logic).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/EditorTopbar.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorTopbar } from '../../src/components/EditorTopbar.js';

describe('EditorTopbar', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the title', () => {
    render(
      <EditorTopbar
        title="My Settings"
        isDirty={false}
        onBack={() => {}}
        onSaveAndBack={() => {}}
      />,
    );
    expect(screen.getByText('My Settings')).toBeInTheDocument();
  });

  it('back button fires onBack directly when not dirty (no confirm)', () => {
    const onBack = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(
      <EditorTopbar title="X" isDirty={false} onBack={onBack} onSaveAndBack={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('back button asks for confirmation when dirty, calls onBack only if confirmed', () => {
    const onBack = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <EditorTopbar title="X" isDirty={true} onBack={onBack} onSaveAndBack={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(window.confirm).toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('back proceeds when user confirms discard', () => {
    const onBack = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <EditorTopbar title="X" isDirty={true} onBack={onBack} onSaveAndBack={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Save & Back fires onSaveAndBack when enabled', () => {
    const onSaveAndBack = vi.fn();
    render(
      <EditorTopbar title="X" isDirty={true} onBack={() => {}} onSaveAndBack={onSaveAndBack} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save & back/i }));
    expect(onSaveAndBack).toHaveBeenCalledTimes(1);
  });

  it('Save & Back is disabled when saveDisabled is true', () => {
    const onSaveAndBack = vi.fn();
    render(
      <EditorTopbar
        title="X"
        isDirty={true}
        onBack={() => {}}
        onSaveAndBack={onSaveAndBack}
        saveDisabled
      />,
    );
    const btn = screen.getByRole('button', { name: /save & back/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onSaveAndBack).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/components/EditorTopbar.test.tsx
```

Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `apps/user-client/src/components/EditorTopbar.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  title: string;
  /** Truthy when the current draft has unpersisted changes. */
  isDirty: boolean;
  onBack: () => void;
  onSaveAndBack: () => void;
  saveDisabled?: boolean;
  saveTooltip?: string;
}

/**
 * Topbar shared between the Persona Editor and My Settings. Three slots:
 *  - back button (left): discards in-flight edits; if `isDirty`, asks
 *    the user to confirm via window.confirm before invoking onBack.
 *  - title (centre): static text label.
 *  - "Save & Back" pill (right): explicit save-then-navigate, mirror
 *    of the bottom SaveBar's "save + stay" path.
 */
export function EditorTopbar({
  title,
  isDirty,
  onBack,
  onSaveAndBack,
  saveDisabled = false,
  saveTooltip,
}: Props): JSX.Element {
  function handleBack() {
    if (isDirty) {
      const ok = window.confirm('Discard your unsaved changes?');
      if (!ok) return;
    }
    onBack();
  }

  return (
    <header className="flex items-center justify-between gap-3 pb-2">
      <button
        type="button"
        aria-label="Back"
        onClick={handleBack}
        className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-paper-soft hover:bg-white/5 hover:text-paper"
      >
        ←
      </button>
      <div className="min-w-0 flex-1 truncate text-center font-display text-sm text-paper">
        {title}
      </div>
      <button
        type="button"
        onClick={onSaveAndBack}
        disabled={saveDisabled}
        title={saveDisabled ? saveTooltip : undefined}
        className="rounded-md border border-paper px-3 py-1.5 text-xs uppercase tracking-wider text-paper hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Save &amp; Back
      </button>
    </header>
  );
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/EditorTopbar.test.tsx
```

Expected: all 6 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/EditorTopbar.tsx apps/user-client/tests/components/EditorTopbar.test.tsx
git commit -m "$(cat <<'EOF'
Add EditorTopbar — larger back button + Save & Back pill

Per Chris's iteration-2 feedback: back-button is now a 40x40 touch
target with a 2xl glyph; the centre slot carries the page title
without the "Room · " breadcrumb prefix; the right slot exposes an
explicit "Save & Back" action. Back is purely discard semantic —
it asks the user to confirm if there are unsaved changes.

Shared between Persona Editor and My Settings.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `hideFont` prop to `MindspacePicker`

**Files:**
- Modify: `apps/user-client/src/components/MindspacePicker.tsx`
- Modify: `apps/user-client/tests/components/MindspacePicker.controlled.test.tsx`

The Persona Editor's Mindspace section drops Font (it moves to its own Font-and-Voice
section in Task 6), and My Settings drops Font entirely (Decision 28 revoked).
Both call sites still want the picker for Colour + Texture + preview. Add a
`hideFont` prop that suppresses the Font row when true; make `selectedFont` and
`onFontChange` optional in that case.

- [ ] **Step 1: Extend the test**

Append a new case to `apps/user-client/tests/components/MindspacePicker.controlled.test.tsx`:

```tsx
  it('omits the Font row when hideFont is true', () => {
    render(
      <MindspacePicker
        mindspaces={[ms('a', 'Aurum', '#c9a84c')]}
        selectedMindspaceId="a"
        selectedTexture="cloudy"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        hideFont
      />,
    );
    expect(screen.queryByText(/^font$/i)).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @chatsundere/user-client test tests/components/MindspacePicker.controlled.test.tsx
```

Expected: FAIL — `hideFont` not a prop yet; selectedFont/onFontChange required.

- [ ] **Step 3: Update `MindspacePicker.tsx`**

In the existing `interface Props`, change:

```ts
interface Props {
  mindspaces: ReadonlyArray<MindspaceRow>;
  selectedMindspaceId: string | null;
  selectedTexture: MindspaceTexture;
  selectedFont?: Font;
  previewName: string;
  /** When true, surfaces a "Use user default" chip that emits onMindspaceChange(null). */
  allowUserDefault?: boolean;
  /** When true, the Font row is omitted entirely (caller uses a different surface for font). */
  hideFont?: boolean;
  onMindspaceChange: (id: string | null) => void;
  onTextureChange: (t: MindspaceTexture) => void;
  onFontChange?: (f: Font) => void;
}
```

In the destructured props, set defaults:

```ts
  const {
    mindspaces,
    selectedMindspaceId,
    selectedTexture,
    selectedFont = 'serif',
    previewName,
    allowUserDefault = false,
    hideFont = false,
    onMindspaceChange,
    onTextureChange,
    onFontChange,
  } = props;
```

Wrap the Font Row in a conditional:

```tsx
      {/* Font row */}
      {!hideFont && onFontChange ? (
        <Row label="Font">
          {FONTS.map((f) => (
            <Chip
              key={f}
              active={selectedFont === f}
              onClick={() => onFontChange(f)}
              label={capitalise(f)}
              className={FONT_CLASSES[f]}
            />
          ))}
        </Row>
      ) : null}
```

(The Preview card still uses `selectedFont` for the label rendering — that part
is unchanged; the default `'serif'` keeps the preview readable when hideFont is
set and the caller didn't pass a font.)

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/MindspacePicker.controlled.test.tsx
```

Expected: all cases PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/MindspacePicker.tsx apps/user-client/tests/components/MindspacePicker.controlled.test.tsx
git commit -m "$(cat <<'EOF'
MindspacePicker: optional hideFont prop

Font moves out of the picker into its own Font-and-Voice accordion
section in the Persona Editor (TTS lands there later). My Settings
drops the user-display-font entirely. The picker stays the unified
Colour + Texture (+ preview) component for both call sites.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Drop `SettingsRow.userFont` and revoke Decision 28

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Modify: `apps/user-client/tests/boot/client-data-db-v3.test.ts` (existing)
- Modify: `apps/user-client/tests/unit/client-data-db.test.ts` (existing) — if it
  asserts userFont
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` —
  `defaultDraft(...).font = 'serif'` hardcoded (was `settings?.userFont ?? 'serif'`)

Dexie's `'id'`-keyed settings store is schemaless for non-indexed fields, so old
rows that still carry `userFont` continue to deserialise harmlessly — we just
stop reading it. No version bump.

- [ ] **Step 1: Edit `client-data-db.ts`**

Remove the `userFont: 'sans' | 'serif' | 'cursive';` line from `SettingsRow`.

In `seedBuiltinsIfNeeded`, drop the `userFont: 'serif',` line from the fresh-install
add.

In the v2 upgrade callback, the line `await tx.table('settings').update(1, { userFont: 'serif' });`
becomes dead code — leave it as-is (idempotent against schemaless settings rows;
removing it would create a migration-history gap that's harder to reason about).

In the v3 upgrade callback, no change needed (only touches userTexture +
textureOverride).

- [ ] **Step 2: Edit `persona-editor.tsx`**

In `defaultDraft`, change the font field:

```ts
    font: 'serif',
```

(was `settings?.userFont ?? 'serif'`). The `settings` parameter to `defaultDraft`
can still arrive — just no longer needed for this purpose. If `settings` ends up
unused after this change, remove the parameter cleanly.

- [ ] **Step 3: Edit `tests/boot/client-data-db-v3.test.ts`**

```bash
grep -n "userFont" apps/user-client/tests/boot/client-data-db-v3.test.ts
```

If any assertion claims `userFont` exists on the seeded row, remove it. The
fresh-install seed test focuses on `userTexture` (Phase 2.5) — that's the surviving
contract.

- [ ] **Step 4: Edit `tests/unit/client-data-db.test.ts`**

Same drill — remove any `userFont` reference.

- [ ] **Step 5: Update `tests/routes/settings.test.tsx`**

```bash
grep -n "userFont" apps/user-client/tests/routes/settings.test.tsx
```

Remove any fixture line that sets `userFont: 'serif'` on a SettingsRow literal
(harmless if left, but tidier without).

Same drill for `tests/routes/persona-editor.test.tsx` and any other test files
that construct `SettingsRow` literals.

- [ ] **Step 6: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green. The typecheck will flag any caller still trying to read
`settings.userFont`; fix each.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/
git commit -m "$(cat <<'EOF'
Drop Settings.userFont; new personas default to serif

Revokes Decision 28 per Chris's iteration-2 feedback. Font is a
persona property only — there is no separate "user display font"
any more. Settings drops the entire Font row from the Mindspace
section; new personas default to serif (the prototype's serif
greeting matches this baseline).

Dexie's 'id'-keyed settings store is schemaless for non-indexed
fields — existing rows with the now-orphaned userFont value are
harmlessly ignored. No version bump.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mount `EditorTopbar` in Persona Editor + add Save & Back wiring

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Modify: `apps/user-client/tests/routes/persona-editor.test.tsx` (existing — re-check
  topbar-related assertions)

Replaces the existing `<header>` block at the top of Persona Editor with
`<EditorTopbar />`. Also drops the "Room · Persona Editor" / persona-name
breadcrumb (was inconsistent; the new EditorTopbar uses a single clean title).
The SaveBar at the bottom keeps Save semantic = persist-and-stay (was persist+navigate);
EditorTopbar's Save & Back is the persist+navigate path.

- [ ] **Step 1: Read existing persona-editor.tsx**

```bash
cat apps/user-client/src/routes/app/persona-editor.tsx
```

Note the current top-of-page header (with back-button and persona-name) — that's
what `EditorTopbar` replaces.

- [ ] **Step 2: Compute dirty state and split Save semantics**

Add the dirty-tracker. The existing `userModifiedRef` from Phase 2.5 already
flips to `true` on first `patch()`. Re-use it: `isDirty = userModifiedRef.current`.
Actually, refs don't trigger re-renders, so we need state instead. Introduce:

```ts
  const [isDirty, setIsDirty] = useState(false);
```

Update `patch`:

```ts
  function patch(p: Partial<DraftPersona>) {
    userModifiedRef.current = true;
    setIsDirty(true);
    setDraft((d) => ({ ...d, ...p }));
  }
```

Split the existing `onSave` into two flavours:

```ts
  async function persistDraft() {
    if (isCreate) {
      await create.mutateAsync(draft);
    } else if (id) {
      await update.mutateAsync({ id, patch: draft });
    }
    setIsDirty(false);
  }

  async function onSaveStay() {
    await persistDraft();
  }

  async function onSaveAndBack() {
    await persistDraft();
    navigate('/app/circle');
  }
```

(Create-mode's `persistDraft` doesn't yet have a stable id to re-navigate to,
so post-save-stay stays on `/app/persona/new` — which is fine; on Save & Back
the user lands at `/app/circle`. If Chris asks later, we can route create-mode
save-stay to `/app/persona/<new-id>`; for now it's a separate task.)

- [ ] **Step 3: Replace the header block**

In the JSX, replace:

```tsx
      <header className="flex items-center justify-between text-xs uppercase tracking-widest text-paper-soft">
        {/* …current back-button + centre title + spacer… */}
      </header>
```

with:

```tsx
      <EditorTopbar
        title={isCreate ? 'New Persona' : draft.name || 'Edit Persona'}
        isDirty={isDirty}
        onBack={() => navigate('/app/circle')}
        onSaveAndBack={() => {
          void onSaveAndBack();
        }}
        saveDisabled={!draft.name || !draft.instructions || !draft.providerId || !draft.modelId}
        saveTooltip={
          !draft.providerId
            ? 'Add a provider in Settings first'
            : !draft.modelId
              ? 'Pick a model'
              : 'Fill in name and instructions'
        }
      />
```

Import:

```ts
import { EditorTopbar } from '../../components/EditorTopbar.js';
```

- [ ] **Step 4: Update the SaveBar usage to use the new save-stay path**

```tsx
      <SaveBar
        onCancel={() => navigate('/app/circle')}
        onSave={() => {
          void onSaveStay();
        }}
        saveDisabled={!draft.name || !draft.instructions || !draft.providerId || !draft.modelId}
        saveTooltip={…}
        saveLabel="Save Persona"
      />
```

(`onCancel` is essentially the same path as Back's "discard + navigate"; keep
it as a navigate without confirm since the user is already aware they're
abandoning at the cancel button.)

- [ ] **Step 5: Update `tests/routes/persona-editor.test.tsx`**

Any test that queried the old back-button by text (`getByText('←')`) should use
`getByLabelText(/back/i)` now (the new EditorTopbar component sets `aria-label="Back"`).
Any test that asserted on the old persona-name being rendered in the centre slot
will find it under the new title format (`isCreate ? 'New Persona' : draft.name || 'Edit Persona'`).

- [ ] **Step 6: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/routes/persona-editor.test.tsx
git commit -m "$(cat <<'EOF'
Mount EditorTopbar in Persona Editor; split Save vs Save & Back

The top header gains a 40x40 back button (discard semantic with
confirm-on-dirty), drops the "Room · " breadcrumb prefix, and
exposes "Save & Back" on the right. The bottom SaveBar's Save now
persists and stays on the page; the topbar's Save & Back persists
and navigates to My Circle.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Dynamic accordion meta for Model + Behavior + Mindspace-Override; new Font-and-Voice section

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Create: `apps/user-client/tests/routes/persona-editor.dynamic-meta.test.tsx`
- Create: `apps/user-client/tests/routes/persona-editor.font-and-voice.test.tsx`
- Modify: `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`
  (existing — accordion-order assertion changes)

Five things in this task:

1. **Model meta** — when `modelId` is set: `<providerDisplayName> · <modelDisplayName>`.
   When unset: keep `"Pick a provider/model pair"`.
2. **Behavior meta** — when `adultPersona` is true: append a small `NSFW` badge
   to the meta. When false: just `"Temperature"`.
3. **Mindspace-Override meta** — when `mindspaceId === null` (using user default):
   show `"Using user default"`. When set: show `<displayName> · <texture>`.
4. **New Font-and-Voice accordion section** placed between Behavior and
   Mindspace-Override. Contents (Phase 2.6): just the three font chips (Sans /
   Serif / Cursive) — same chip UX as the picker used. Voice/TTS lands later.
5. **Mindspace-Override accordion** loses the Font controls (now in Font-and-Voice).
   Pass `hideFont` to the MindspacePicker.

The new accordion order: Custom Instructions → Model → Behavior →
**Font and Voice** → Mindspace-Override → About-Me-Override.

- [ ] **Step 1: Write the dynamic-meta test**

Create `apps/user-client/tests/routes/persona-editor.dynamic-meta.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({
    id: 'nano-gpt',
    displayName: 'nano-gpt.com',
    baseUrl: 'x',
    knownModels: [{ id: 'llama-3.1-70b', displayName: 'Llama 3.1 70B' }],
  }),
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({
    data: {
      id: 'p-1',
      name: 'Liz',
      tagline: 't',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'i',
      providerId: 'pr-1',
      modelId: 'llama-3.1-70b',
      mindspaceId: 'a',
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: true,
      createdAt: 0,
      updatedAt: 0,
    },
  }),
  useCreatePersona: () => ({ mutateAsync: vi.fn() }),
  useUpdatePersona: () => ({ mutateAsync: vi.fn() }),
  useDeletePersona: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({
    data: { defaultMindspaceId: 'a', userTexture: 'cloudy' },
  }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({
    data: [
      {
        id: 'a',
        displayName: 'Aurum',
        palette: {
          bg: '#000', surfaceBase: 'x', surfaceRaised: 'x', surfaceInput: 'x',
          accent: '#c9a84c', accentSubtle: 'x', accentBorder: 'x',
          accentBorderActive: 'x', accentGlow: 'x',
          text: { primary: '#fff', secondary: 'x', muted: 'x', ghost: 'x' },
        },
        texture: 'cloudy',
        builtIn: true,
        createdAt: 0,
      },
    ],
  }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({
    data: [{ id: 'pr-1', templateId: 'nano-gpt', enabled: true }],
  }),
}));

import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function setup(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaEditor — dynamic accordion meta', () => {
  it('Model meta shows provider · model when modelId is set', () => {
    setup('/app/persona/p-1');
    const header = screen
      .getByText(/^model$/i)
      .closest('[data-accordion-card]');
    expect(header?.textContent).toMatch(/nano-gpt\.com.*Llama 3\.1 70B/);
  });

  it('Behavior meta shows an NSFW badge when adultPersona is true', () => {
    setup('/app/persona/p-1');
    const header = screen
      .getByText(/^behavior$/i)
      .closest('[data-accordion-card]');
    expect(header?.querySelector('[data-nsfw-badge]')).not.toBeNull();
  });

  it('Mindspace-Override meta shows displayName · texture when set', () => {
    setup('/app/persona/p-1');
    const header = screen
      .getByText(/^mindspace — override$/i)
      .closest('[data-accordion-card]');
    expect(header?.textContent).toMatch(/Aurum.*cloudy/i);
  });
});
```

- [ ] **Step 2: Write the Font-and-Voice test**

Create `apps/user-client/tests/routes/persona-editor.font-and-voice.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({ id: 'p', displayName: 'P', baseUrl: 'x', knownModels: [] }),
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: null }),
  useCreatePersona: () => ({ mutateAsync: vi.fn() }),
  useUpdatePersona: () => ({ mutateAsync: vi.fn() }),
  useDeletePersona: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { defaultMindspaceId: 'a', userTexture: 'cloudy' } }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({
    data: [
      {
        id: 'a',
        displayName: 'Aurum',
        palette: {
          bg: '#000', surfaceBase: 'x', surfaceRaised: 'x', surfaceInput: 'x',
          accent: '#c9a84c', accentSubtle: 'x', accentBorder: 'x',
          accentBorderActive: 'x', accentGlow: 'x',
          text: { primary: '#fff', secondary: 'x', muted: 'x', ghost: 'x' },
        },
        texture: 'cloudy',
        builtIn: true,
        createdAt: 0,
      },
    ],
  }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
}));

import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/persona/new']}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaEditor — Font and Voice section', () => {
  it('renders a Font and Voice accordion between Behavior and Mindspace-Override', () => {
    setup();
    const headers = Array.from(
      document.querySelectorAll('[data-accordion-card] [data-accordion-label]'),
    ).map((n) => n.textContent?.trim() ?? '');
    expect(headers).toEqual([
      'Custom Instructions',
      'Model',
      'Behavior',
      'Font and Voice',
      'Mindspace — Override',
      'About Me — Override',
    ]);
  });

  it('Mindspace-Override accordion no longer shows a Font row', () => {
    setup();
    // Open the Mindspace-Override accordion
    fireEvent.click(screen.getByText(/mindspace — override/i));
    // The "Font" row label should not appear inside it
    const ms = screen
      .getByText(/mindspace — override/i)
      .closest('[data-accordion-card]');
    expect(ms?.querySelector('[data-mindspace-preview]')).not.toBeNull();
    // No "Font" row label inside the Mindspace section
    const fontRowInMs = Array.from(ms?.querySelectorAll('span') ?? []).filter(
      (s) => s.textContent === 'Font',
    );
    expect(fontRowInMs.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run both new tests to verify they fail**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/persona-editor.dynamic-meta.test.tsx tests/routes/persona-editor.font-and-voice.test.tsx
```

Expected: most cases FAIL.

- [ ] **Step 4: Update the Persona Editor JSX**

In `apps/user-client/src/routes/app/persona-editor.tsx`:

4a. Compute the Model meta dynamically. Above the `return`:

```ts
  const selectedProvider = providers.data?.find((p) => p.id === draft.providerId);
  const selectedProviderDef = selectedProvider
    ? getProvider(selectedProvider.templateId)
    : null;
  const selectedModelDef = selectedProviderDef?.knownModels.find(
    (m) => m.id === draft.modelId,
  );
  const modelMeta: ReactNode = draft.modelId && selectedProviderDef
    ? `${selectedProviderDef.displayName} · ${selectedModelDef?.displayName ?? draft.modelId}`
    : 'Pick a provider/model pair';
```

4b. Compute Behavior meta:

```tsx
  const behaviourMeta: ReactNode = (
    <span>
      Temperature
      {draft.adultPersona ? (
        <>
          {' · '}
          <span
            data-nsfw-badge
            className="rounded-full border border-danger/50 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger"
          >
            NSFW
          </span>
        </>
      ) : null}
    </span>
  );
```

4c. Compute Mindspace-Override meta:

```ts
  const selectedMs = draft.mindspaceId
    ? mindspaces.data?.find((m) => m.id === draft.mindspaceId)
    : null;
  const mindspaceMeta: ReactNode = draft.mindspaceId && selectedMs
    ? `${selectedMs.displayName} · ${draft.textureOverride ?? selectedMs.texture}`
    : 'Using user default';
```

(Use `ReactNode` and import `type ReactNode` from React if not already imported.)

4d. Update the four accordion sections to wire the new metas + introduce
Font-and-Voice + drop Font from Mindspace-Override:

```tsx
      <AccordionCard
        icon="≣"
        label="Custom Instructions"
        meta="Who this persona is"
        requiredMarker={!draft.instructions}
      >
        {/* …unchanged… */}
      </AccordionCard>

      <AccordionCard
        icon="⬡"
        label="Model"
        meta={modelMeta}
        requiredMarker={!draft.providerId || !draft.modelId}
      >
        {/* …unchanged ModelList… */}
      </AccordionCard>

      <AccordionCard icon="∿" label="Behavior" meta={behaviourMeta}>
        {/* …unchanged Behavior body (Temperature slider + Adult Persona toggle)… */}
      </AccordionCard>

      <AccordionCard
        icon="ℑ"
        label="Font and Voice"
        meta={`Voice · ${capitalise(draft.font)}`}
      >
        <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">
          Font
        </div>
        <div className="flex flex-wrap gap-2">
          {(['sans', 'serif', 'cursive'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => patch({ font: f })}
              className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
                draft.font === f
                  ? 'border-paper text-paper'
                  : 'border-paper-soft/40 text-paper-soft'
              } ${
                f === 'sans' ? 'font-sans' : f === 'serif' ? 'font-display' : 'italic font-display'
              }`}
            >
              {capitalise(f)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-paper-soft">
          Font is the persona's visual voice — serif for informal, sans for formal,
          cursive for dolce vita. Voice (text-to-speech) lands later.
        </p>
      </AccordionCard>

      {mindspaces.data ? (
        <AccordionCard
          icon="◈"
          label="Mindspace — Override"
          meta={mindspaceMeta}
        >
          <MindspacePicker
            mindspaces={mindspaces.data}
            selectedMindspaceId={draft.mindspaceId}
            selectedTexture={
              draft.textureOverride ?? settings.data?.userTexture ?? 'cloudy'
            }
            previewName={draft.name || 'New Persona'}
            allowUserDefault
            hideFont
            onMindspaceChange={(id) => {
              const ms = id ? mindspaces.data?.find((m) => m.id === id) : null;
              patch({
                mindspaceId: id,
                colour: ms?.palette.accent ?? draft.colour,
              });
            }}
            onTextureChange={(t) => patch({ textureOverride: t })}
          />
        </AccordionCard>
      ) : null}

      <AccordionCard icon="◉" label="About Me — Override" meta="Empty = global is used">
        {/* …unchanged… */}
      </AccordionCard>
```

Add a private `capitalise` helper near the top of the file if not already present:

```ts
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 5: Update the existing required-markers test**

In `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`, the
`it('orders accordion sections as …')` assertion changes:

```tsx
    expect(headers).toEqual([
      'Custom Instructions',
      'Model',
      'Behavior',
      'Font and Voice',
      'Mindspace — Override',
      'About Me — Override',
    ]);
```

- [ ] **Step 6: Run all three editor tests**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/persona-editor
```

Expected: all PASS.

- [ ] **Step 7: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/routes/
git commit -m "$(cat <<'EOF'
Persona Editor: dynamic accordion meta + Font and Voice section

- Model header shows "<provider> · <model>" when modelId is set
  (was always "Pick a provider/model pair" even after selection).
- Behavior header shows an NSFW badge pill when adultPersona is true.
- Mindspace-Override header shows "Using user default" when the
  persona inherits, or "<mindspace> · <texture>" when overridden.
- Font moves out of the Mindspace-Override section into its own
  "Font and Voice" accordion (TTS lands in the same section later).
- AccordionCard's meta line is composed from a ReactNode now, not a
  plain string — opens the door for any future inline status pills.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mount `EditorTopbar` in My Settings + switch to draft + SaveBar

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Create: `apps/user-client/tests/routes/settings.draft-save.test.tsx`
- Modify: `apps/user-client/tests/routes/settings.test.tsx` (existing — substantial
  update for the draft flow)

My Settings becomes a draft-then-save surface. The three accordion sections
themselves stay (About Me, Global System Prompt, Upstream Providers); the
Providers section stays out-of-band (its own bottom sheets persist on
Test & Save, no global save needed). The About Me and Global System Prompt
fields write to local draft state until the top/bottom Save fires.

The MindspacePicker inside About Me writes draft fields too (defaultMindspaceId,
texture as `userTexture`). Font row is hidden via `hideFont`.

- [ ] **Step 1: Write the draft-save test**

Create `apps/user-client/tests/routes/settings.draft-save.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const updateMock = vi.fn(async () => {});

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({
    data: {
      id: 1,
      globalUnlockerPrompt: 'old prompt',
      globalAboutMe: 'old about',
      defaultMindspaceId: 'a',
      userTexture: 'cloudy',
      animationsEnabled: true,
      corsProxy: null,
      createdAt: 0,
      updatedAt: 0,
    },
  }),
  useUpdateSettings: () => ({ mutateAsync: updateMock, mutate: updateMock }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({
    data: [
      {
        id: 'a',
        displayName: 'Aurum',
        palette: {
          bg: '#000', surfaceBase: 'x', surfaceRaised: 'x', surfaceInput: 'x',
          accent: '#c9a84c', accentSubtle: 'x', accentBorder: 'x',
          accentBorderActive: 'x', accentGlow: 'x',
          text: { primary: '#fff', secondary: 'x', muted: 'x', ghost: 'x' },
        },
        texture: 'cloudy',
        builtIn: true,
        createdAt: 0,
      },
    ],
  }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
}));

vi.mock('../../src/state/mindspace.store.js', () => ({
  useMindspaceStore: vi.fn((selector?: unknown) => {
    if (typeof selector === 'function') return (selector as (s: { update: () => void }) => unknown)({ update: () => {} });
    return { update: () => {} };
  }),
}));

import { Settings } from '../../src/routes/app/settings.js';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings — draft + Save flow', () => {
  beforeEach(() => updateMock.mockClear());

  it('does not call updateSettings on each keystroke', async () => {
    setup();
    // Expand About Me to reveal the textarea
    fireEvent.click(screen.getByText(/about me/i));
    const ta = await screen.findByLabelText(/about me/i);
    fireEvent.change(ta, { target: { value: 'new content' } });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('calls updateSettings once when Save is clicked', async () => {
    setup();
    fireEvent.click(screen.getByText(/about me/i));
    const ta = await screen.findByLabelText(/about me/i);
    fireEvent.change(ta, { target: { value: 'new content' } });
    const saveBtns = screen.getAllByRole('button', { name: /save settings/i });
    // There is at least one Save Settings button — the bottom SaveBar one.
    fireEvent.click(saveBtns[saveBtns.length - 1]);
    // Allow microtasks to flush
    await Promise.resolve();
    expect(updateMock).toHaveBeenCalled();
    const payload = updateMock.mock.calls[0]?.[0] as { globalAboutMe?: string } | undefined;
    expect(payload?.globalAboutMe).toBe('new content');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/settings.draft-save.test.tsx
```

Expected: FAIL — Settings still calls update on every change.

- [ ] **Step 3: Rewrite `apps/user-client/src/routes/app/settings.tsx`**

The new structure: local `draft` state seeded from `settings.data`; all
About-Me / Global-Prompt / Default-Mindspace edits patch the draft; SaveBar
diffs draft against the source-of-truth and calls `updateSettings.mutateAsync(diff)`.

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { ProviderSheet } from '../../components/ProviderSheet.js';
import { SaveBar } from '../../components/SaveBar.js';
import type { MindspaceTexture, SettingsRow } from '../../boot/client-data-db.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

const BUILT_IN_PROVIDERS = [
  { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
  { id: 'novita', name: 'Novita AI', monogram: 'No' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
] as const;

interface SettingsDraft {
  globalAboutMe: string;
  globalUnlockerPrompt: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
}

function draftFromRow(s: SettingsRow): SettingsDraft {
  return {
    globalAboutMe: s.globalAboutMe,
    globalUnlockerPrompt: s.globalUnlockerPrompt,
    defaultMindspaceId: s.defaultMindspaceId,
    userTexture: s.userTexture,
  };
}

function isSameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.globalAboutMe === b.globalAboutMe &&
    a.globalUnlockerPrompt === b.globalUnlockerPrompt &&
    a.defaultMindspaceId === b.defaultMindspaceId &&
    a.userTexture === b.userTexture
  );
}

function ProvidersList(): JSX.Element {
  const providers = useProviders();
  const [openSheet, setOpenSheet] = useState<'nano-gpt' | 'novita' | 'ollama-cloud' | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {BUILT_IN_PROVIDERS.map((b) => {
        const row = providers.data?.find((p) => p.templateId === b.id);
        const connected = !!row?.enabled;
        return (
          <button
            key={b.id}
            type="button"
            className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
            onClick={() => setOpenSheet(b.id)}
          >
            <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
              {b.monogram}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm text-paper">{b.name}</div>
              <div className="text-xs text-paper-soft">
                {connected ? '● Connected · Key valid' : 'Not connected'}
              </div>
              <div className="mt-1 flex gap-1">
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-paper-soft">
                  Text
                </span>
              </div>
            </div>
            <span className="text-paper-soft">▸</span>
          </button>
        );
      })}
      <p className="mt-2 text-[11px] text-paper-soft">
        Keys are tested automatically on save. Each provider can be added once.
      </p>
      {openSheet ? (
        <ProviderSheet templateId={openSheet} onClose={() => setOpenSheet(null)} />
      ) : null}
    </div>
  );
}

export function Settings(): JSX.Element {
  const navigate = useNavigate();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const updateSettings = useUpdateSettings();
  const providers = useProviders();
  const setMindspace = useMindspaceStore((s) => s.update);

  const [draft, setDraft] = useState<SettingsDraft | null>(null);

  useEffect(() => {
    if (!draft && settings.data) {
      setDraft(draftFromRow(settings.data));
    }
  }, [settings.data, draft]);

  useEffect(() => {
    if (draft && mindspaces.data) {
      setMindspace({
        persona: null,
        defaultMindspaceId: draft.defaultMindspaceId,
        defaultTexture: draft.userTexture,
        mindspaces: mindspaces.data,
      });
    }
  }, [draft, mindspaces.data, setMindspace]);

  if (!settings.data || !mindspaces.data || !draft) {
    return <div className="p-4 text-paper-soft">Loading…</div>;
  }

  const isDirty = !isSameDraft(draft, draftFromRow(settings.data));

  function patch(p: Partial<SettingsDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function persistDraft() {
    if (!draft || !settings.data) return;
    const original = draftFromRow(settings.data);
    const diff: Partial<SettingsDraft> = {};
    if (draft.globalAboutMe !== original.globalAboutMe) diff.globalAboutMe = draft.globalAboutMe;
    if (draft.globalUnlockerPrompt !== original.globalUnlockerPrompt)
      diff.globalUnlockerPrompt = draft.globalUnlockerPrompt;
    if (draft.defaultMindspaceId !== original.defaultMindspaceId)
      diff.defaultMindspaceId = draft.defaultMindspaceId;
    if (draft.userTexture !== original.userTexture) diff.userTexture = draft.userTexture;
    if (Object.keys(diff).length > 0) {
      await updateSettings.mutateAsync(diff);
    }
  }

  async function onSaveStay() {
    await persistDraft();
  }

  async function onSaveAndBack() {
    await persistDraft();
    navigate('/app');
  }

  const selectedMindspace =
    mindspaces.data.find((m) => m.id === draft.defaultMindspaceId) ?? mindspaces.data[0];

  return (
    <section className="flex flex-col gap-3 px-4 pb-32 pt-4">
      <EditorTopbar
        title="My Settings"
        isDirty={isDirty}
        onBack={() => navigate('/app')}
        onSaveAndBack={() => {
          void onSaveAndBack();
        }}
      />

      <AccordionCard icon="◉" label="About Me" meta="What your Circle knows about you">
        <AutoSizeTextarea
          aria-label="About me"
          minRows={4}
          value={draft.globalAboutMe}
          onChange={(v) => patch({ globalAboutMe: v })}
          placeholder="Tell your Circle who you are…"
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is included in every persona's system prompt unless overridden per-persona.
        </p>
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">
            Your Default Mindspace
          </div>
          {selectedMindspace ? (
            <MindspacePicker
              mindspaces={mindspaces.data}
              selectedMindspaceId={selectedMindspace.id}
              selectedTexture={draft.userTexture}
              previewName="Chris"
              hideFont
              onMindspaceChange={(id) => {
                if (id) patch({ defaultMindspaceId: id });
              }}
              onTextureChange={(t) => patch({ userTexture: t })}
            />
          ) : null}
        </div>
      </AccordionCard>

      <AccordionCard
        icon="⚿"
        label="Global System Prompt"
        meta="The unlocker — prepended to every persona"
      >
        <AutoSizeTextarea
          aria-label="Global system prompt"
          minRows={4}
          maxRows={20}
          value={draft.globalUnlockerPrompt}
          onChange={(v) => patch({ globalUnlockerPrompt: v })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is prepended to every persona's system prompt. Mainly useful for permissive but
          cautious open-source models. Always global, no per-persona override.
        </p>
      </AccordionCard>

      <AccordionCard
        icon="⬢"
        label="Upstream Providers"
        meta={`${(providers.data ?? []).filter((p) => p.enabled).length} of 3 connected`}
      >
        <ProvidersList />
      </AccordionCard>

      <SaveBar
        onCancel={() => {
          if (!isDirty || window.confirm('Discard your unsaved changes?')) {
            setDraft(draftFromRow(settings.data!));
          }
        }}
        onSave={() => {
          void onSaveStay();
        }}
        saveDisabled={!isDirty}
        saveTooltip={!isDirty ? 'Nothing to save' : undefined}
        saveLabel="Save Settings"
      />
    </section>
  );
}
```

(Note: the `settings.data!` in the SaveBar's Cancel handler is a non-null
assertion — Biome will flag it. Replace with explicit guard:
`if (!settings.data) return;` before calling `setDraft`.)

- [ ] **Step 4: Run the new draft test + existing settings tests**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/settings
```

Expected: all PASS. The existing `tests/routes/settings.test.tsx` likely
asserts on old keystroke-driven `updateSettings.mutate(...)` calls and will need
updating: switch those assertions to fire the Save button and assert
`updateSettings.mutateAsync` was called with the diff.

- [ ] **Step 5: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/routes/settings.draft-save.test.tsx apps/user-client/tests/routes/settings.test.tsx
git commit -m "$(cat <<'EOF'
My Settings: draft + Save flow with EditorTopbar

About Me, Global System Prompt, and the Default-Mindspace picker
now write to a local draft instead of mutating settings on every
keystroke. Save persists the diff via updateSettings.mutateAsync;
Save & Back persists and navigates home; Back asks to discard
unsaved changes. Cancel resets the draft from disk.

Upstream Providers remain out-of-band — their per-provider bottom
sheets continue to persist on their own "Test & Save".

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Drop "Room · " breadcrumb prefix on My Circle

**Files:**
- Modify: `apps/user-client/src/routes/app/circle.tsx`

Circle uses its own header (not EditorTopbar — it's not an editor surface, just
a list). Drop the `Room · ` prefix; keep the back-button and the plain "My Circle"
title.

- [ ] **Step 1: Edit `circle.tsx` header**

Find the current `<header>` and update the centre text. Currently:

```tsx
        <span>Room · My Circle</span>
```

Change to:

```tsx
        <span className="font-display text-sm text-paper">My Circle</span>
```

Optionally also bump the back-button to match the EditorTopbar size for consistency:

```tsx
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/app')}
          className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-paper-soft hover:bg-white/5 hover:text-paper"
        >
          ←
        </button>
```

- [ ] **Step 2: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client test
```

Expected: green. Any test that asserted on "Room · My Circle" needs the substring
trimmed to "My Circle".

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/routes/app/circle.tsx apps/user-client/tests/
git commit -m "$(cat <<'EOF'
My Circle: drop "Room · " breadcrumb prefix

Per Chris's iteration-2 feedback. Plain "My Circle" reads better
than "Room · My Circle". Back button bumped to 40x40 to match
the new EditorTopbar convention.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Spec + STATUS updates

**Files:**
- Modify: `superpowers/specs/2026-05-23-client-block-1-design.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

Document Decisions 36-41 + revoke Decision 28; update STATUS with Phase-2.6 done
block.

- [ ] **Step 1: Append Decisions 36-41 to the design spec**

Inside § 2 ("Decisions"), append after Decision 35:

- **D36** (Revoke Decision 28 — Settings drops user-display font): `Settings.userFont`
  removed from the schema. New personas default to `serif`. Rationale: Chris's
  iteration-2 feedback — the user has no TTS / display-voice surface, so a
  per-user font lacked a use-case; per-persona font remains as Decision 20.
- **D37** ("Font and Voice" as its own Persona-Editor accordion): font moves
  out of the MindspacePicker into its own accordion section between Behavior
  and Mindspace-Override. TTS / voice configuration lands in the same section
  in a later block.
- **D38** (Dynamic accordion meta): `AccordionCard.meta` becomes `ReactNode`
  so callers can compose dynamic previews. Model shows `<provider> · <model>`
  when selected; Behavior shows an NSFW badge pill when `adultPersona` is true;
  Mindspace-Override shows `Using user default` when un-overridden, else
  `<mindspace> · <texture>`.
- **D39** (Three-action editor UX): both Persona Editor and My Settings expose
  three explicit save-related actions — back-button (top-left) discards with
  confirm-on-dirty; SaveBar's Save (bottom) persists and stays; "Save & Back"
  (top-right) persists and navigates. Replaces the implicit "Save = persist+
  navigate" of the previous design.
- **D40** (My Settings is draft + Save, not auto-save-on-keystroke): About Me,
  Global System Prompt, Default Mindspace edits write to a local draft until
  Save fires (then `updateSettings.mutateAsync` runs the diff). Upstream
  Providers stay out-of-band — their per-provider sheets continue to persist
  on "Test & Save".
- **D41** (Drop "Room · " breadcrumb prefix): page titles in the topbar are now
  plain — "My Settings", "My Circle", "New Persona", `<persona-name>`. Replaces
  Decision 25's centre-title language and Decision 27's Hall room metadata.

Also annotate Decision 28 as **revoked by D36**.

Also annotate Decision 25's "Identity" sub-bullet — Identity is outside the
accordion since Decision 33 (Phase 2.5), and Font moved into its own section per
D37, so the accordion order is now: Custom Instructions → Model → Behavior →
Font and Voice → Mindspace-Override → About-Me-Override.

- [ ] **Step 2: Update `STATUS-CLIENT-ONLY.md`**

Add a Phase-2.6 Done block summarising what landed; update the `Doing now` line
to "Phase 2.6 finished. Paused for Chris's iteration-3 review"; refresh the
`Next session` block to list the iteration-3 manual smoke (verify topbar +
draft/save + dynamic meta + Font-and-Voice + no userFont reference).

- [ ] **Step 3: Commit doc updates**

```bash
git add superpowers/specs/2026-05-23-client-block-1-design.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "$(cat <<'EOF'
Document Phase-2.6 decisions and update STATUS [skip ci]

Decisions 36-41 added to the Block-1 design spec. Decision 28
annotated as revoked (Settings.userFont gone). STATUS-CLIENT-ONLY
gains the Phase-2.6 Done block and the iteration-3 smoke checklist.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## End-of-Phase Squash

After Task 9 commits, squash the per-task commits into a single Phase-2.6 commit
on master.

```bash
BASE=27ca147  # Phase 2.5 squash
git reset --soft $BASE
git status  # sanity-check
git commit -m "$(cat <<'EOF'
Land Client Block 1 Phase 2.6 — Polish iteration 2

Following Chris's iteration-2 device-smoke of Phase 2.5, this phase
tightens the editor UX, surfaces collapsed-accordion state, and
revokes the user-display-font idea.

Highlights:
- New EditorTopbar shared between Persona Editor and My Settings:
  40x40 back button (discard with confirm-on-dirty), title-only
  centre slot (no "Room · " prefix), "Save & Back" pill on the right.
- SaveBar regains a visible background (latent bg-bg/95 → bg-ink/95
  fix that escaped Phase 2.5) and now takes an explicit saveLabel.
- My Settings switches from auto-save-on-keystroke to a local
  draft + explicit Save flow. Providers stay out of band.
- AccordionCard.meta widens to ReactNode so collapsed sections can
  preview their content. Persona Editor uses this for: Model
  ("<provider> · <model>"), Behavior (NSFW badge when adult),
  Mindspace-Override ("Using user default" or "<mindspace> · <texture>").
- New "Font and Voice" accordion section in the Persona Editor
  between Behavior and Mindspace-Override; Font drops out of the
  MindspacePicker.
- MindspacePicker gains a hideFont prop (Persona-Editor Mindspace-Override
  and My Settings Default Mindspace both pass it).
- Settings.userFont removed from the schema; new personas default
  to serif. Decision 28 revoked.
- My Circle's topbar drops the "Room · " prefix as well.

Tests: 6 new EditorTopbar cases + 2 AccordionCard meta cases + 3
PersonaEditor dynamic-meta cases + 2 Font-and-Voice cases + 2
Settings draft-save cases + a MindspacePicker hideFont case. All
user-client tests pass; typecheck and Biome lint clean.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (writing-plans checklist applied)

**1. Spec coverage** — every Chris-iteration-2 feedback bullet:

| Feedback | Task |
|---|---|
| Settings + Persona Save button generally | T7 (Settings draft+Save), T5 (Persona Save/Stay split) |
| Back-buttons larger | T2 (EditorTopbar 40x40) + T8 (Circle 40x40) |
| Back as Save alternative (Save & Back) | T2 (Save & Back pill in topbar) |
| "Room" breadcrumb out | T5, T7, T8 |
| Model collapsed → selected model | T6 (dynamic Model meta) |
| Behavior collapsed → NSFW badge | T6 (dynamic Behavior meta) |
| Mindspace-Override "nothing selected" explicit | T6 (dynamic Mindspace-Override meta) |
| Font under "Font and Voice" | T6 (new Font-and-Voice section) |
| Plus: latent SaveBar transparency bug | T1 |
| Plus: revoke Decision 28 (Font and Voice answer #3) | T4 |

All 8 feedback items map to a task. Two additional fixes (SaveBar transparency,
Decision-28 revoke) follow from the same conversation.

**2. Placeholder scan** — no TODO / TBD / "implement later" strings. Every code
block is concrete.

**3. Type consistency** — `EditorTopbar`'s `Props` reused identically in Persona
Editor and Settings call sites. `SettingsDraft`/`draftFromRow`/`isSameDraft`
defined once. `hideFont` prop spelled identically across MindspacePicker and
the two callers. The `meta?: ReactNode` widening is back-compatible (string is
a valid ReactNode).

Plan complete and saved to `superpowers/plans/2026-05-24-client-block-1-phase-2-6-polish-iteration-2.md`.
