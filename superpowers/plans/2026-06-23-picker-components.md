# Picker Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable picker family for the UI/UX makeover — a shared `PickerOverlay` shell (zoom-from-trigger modal with a `[‹] title [Save]` bar, focus trap, and a dirty-discard guard), a generic `PickerField` trigger row, and three content pickers (`MindspacePickerOverlay`, `ModelPickerOverlay`, `WebPickerOverlay`) — each landed with a live `/app/ui-showcase` entry. No live wiring into real surfaces (that is the next slice).

**Architecture:** Five additive tasks, topologically ordered over the import graph. Task 1 lands the shell primitive; Task 2 the generic trigger; Tasks 3–5 the three content overlays, each composing the shell. The shell mirrors `ReadingOverlay`'s origin-zoom overlay chrome (`computeTransformOrigin` + `cs-zoom-in`) and reuses the existing `ConfirmDialog` for the dirty-discard guard. The content overlays reuse existing data/logic verbatim — `buildPickerData`/`filterGroupsByQuery` (model), `MindspacePicker` (mindspace), `resolveWebBackend`/`WebBackendOption` (web) — so this slice rehouses proven behaviour into the new shell rather than reinventing it.

**Tech Stack:** TypeScript (strict), React 18, react-router-dom 6, Tailwind v4 (`@theme` + `.cs-*` CSS), Vitest + Testing Library, `lucide-react` (existing), `@chatsundere/llm-unified` (existing).

**Reference:** Spec `superpowers/specs/2026-06-23-picker-components-design.md`. Existing code to mirror/lift:
- `src/components/ui/ReadingOverlay.tsx` — the overlay chrome + origin-zoom + Esc/restore-focus pattern the shell mirrors.
- `src/components/ui/ConfirmDialog.tsx` — reused as-is for the dirty-discard guard (its `destructive` mode already makes the cancel/"Keep editing" gold-protected and the confirm/"Discard" red).
- `src/components/ModelPickerModal.tsx` — the two-step model→provider rendering lifted into `ModelPickerOverlay`.
- `src/components/ModelPickerField.tsx` — the stale-state trigger generalised into `PickerField`.
- `src/components/MindspacePicker.tsx` — the content the Mindspace overlay stages.
- `src/components/WebInterfacingSection.tsx` + `src/components/ExpertWebSection.tsx` — the backend-select rendering the Web overlay stages.
- `src/lib/origin-zoom.ts` (`computeTransformOrigin(trigger: DOMRect, stage: DOMRect): string`), motion classes `cs-zoom-in` in `src/index.css`.

## Global Constraints

- **British English** for every identifier, comment, copy string (project hard rule §3.7).
- **TypeScript strict + `noUncheckedIndexedAccess`.** No `any` without an inline comment.
- **No CVA / Radix.** Variants via `data-*` attributes + Tailwind/CSS only. Primitives are thin; visual styling lives in `index.css` as `.cs-*` classes.
- **Motion is CSS-only.** No `framer-motion`. Reduced motion gated via the CSS `@media (prefers-reduced-motion: reduce)` query.
- **Biome bans the non-null assertion `!`.** Where genuinely unavoidable, add a `// biome-ignore lint/style/noNonNullAssertion: <reason>` line.
- **New `ui/` primitives are exported from `src/components/ui/index.ts`** and added to the internal `/app/ui-showcase` route.
- **Gate before every commit (run yourself, do not trust a cached pass):** `pnpm typecheck --force` (must be 14/14), `pnpm biome check <changed files>` clean, and the full user-client `pnpm test` at the **8 Node-localStorage baseline failures** (any 9th is a real regression). Tests run from `apps/user-client`; test files live under `apps/user-client/tests/`.
- **Scope fence:** these five tasks add primitives + content overlays + showcase entries only. Do NOT wire any of them into a real route (`routes/app/settings.tsx`, persona editor, chat). Do NOT touch the existing `ModelPickerModal`/`ModelPickerField` (they keep serving chat/persona until their own slice). Real wiring is the next slice.

---

### Task 1: `PickerOverlay` shell primitive

The shared modal shell every picker sits on: a zoom-from-trigger overlay with a header `[‹] title [Save]`, a focus trap, and a dirty-discard guard. The Save slot appears only when `onSave` is given; the `‹` steps back via `onBack` when given, else dismisses; any dismissal of a `dirty` sheet first raises a "Discard changes?" `ConfirmDialog`.

**Files:**
- Create: `apps/user-client/src/components/ui/PickerOverlay.tsx`
- Modify: `apps/user-client/src/components/ui/index.ts` (add export)
- Modify: `apps/user-client/src/index.css` (add `.cs-picker-*` rules)
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a PickerOverlay demo section)
- Test: `apps/user-client/tests/component/ui-picker-overlay.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PickerOverlayProps {
    open: boolean;
    title: string;                                    // "what is being picked"
    onClose: () => void;                              // dismiss (cancel); discard-guarded when dirty
    onBack?: () => void;                              // when set, ‹ calls this (step back) instead of onClose
    onSave?: () => void;                              // present → gold Save shown; absent → no Save
    saveDisabled?: boolean;                           // Save greyed until dirty
    dirty?: boolean;                                  // true → dismissal raises a discard-changes confirm
    triggerRef?: React.RefObject<HTMLElement | null>; // zoom origin
    children: React.ReactNode;
  }
  ```
  Consumed by Tasks 3, 4, 5 (and the next slice's real call-sites).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/ui-picker-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PickerOverlay } from '../../src/components/ui/PickerOverlay.js';

function renderOverlay(over: Partial<React.ComponentProps<typeof PickerOverlay>> = {}) {
  const props = {
    open: true,
    title: 'Mindspace',
    onClose: vi.fn(),
    children: <button type="button">inner</button>,
    ...over,
  };
  render(<PickerOverlay {...props} />);
  return props;
}

describe('PickerOverlay', () => {
  it('renders nothing when closed', () => {
    renderOverlay({ open: false });
    expect(screen.queryByText('Mindspace')).toBeNull();
  });

  it('shows the title and a Save button only when onSave is given', () => {
    const { rerender } = render(
      <PickerOverlay open title="Web search" onClose={vi.fn()}>
        x
      </PickerOverlay>,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    rerender(
      <PickerOverlay open title="Web search" onClose={vi.fn()} onSave={vi.fn()}>
        x
      </PickerOverlay>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('Save is disabled when saveDisabled and fires onSave otherwise', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <PickerOverlay open title="t" onClose={vi.fn()} onSave={onSave} saveDisabled>
        x
      </PickerOverlay>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender(
      <PickerOverlay open title="t" onClose={vi.fn()} onSave={onSave}>
        x
      </PickerOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('‹ calls onBack when given, else onClose; clean sheet closes without a confirm', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <PickerOverlay open title="t" onClose={onClose} onBack={onBack}>
        x
      </PickerOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <PickerOverlay open title="t" onClose={onClose}>
        x
      </PickerOverlay>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a dirty sheet raises a Discard-changes confirm before dismissing; Keep editing aborts, Discard closes', () => {
    const onClose = vi.fn();
    renderOverlay({ onClose, onSave: vi.fn(), dirty: true });
    // backdrop tap requests dismissal
    fireEvent.click(screen.getByTestId('cs-picker-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    // dismiss again, this time confirm the discard
    fireEvent.click(screen.getByTestId('cs-picker-backdrop'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape dismisses (clean), and focus moves to the first control (Back) on open', () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run (from `apps/user-client`): `pnpm test tests/component/ui-picker-overlay.test.tsx`
Expected: FAIL — cannot resolve `PickerOverlay.js`.

- [ ] **Step 3: Implement `PickerOverlay`**

```tsx
// src/components/ui/PickerOverlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';
import { Button } from './Button.js';
import { ConfirmDialog } from './ConfirmDialog.js';

export interface PickerOverlayProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onBack?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  dirty?: boolean;
  triggerRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The shared picker shell (spec §2): a zoom-from-trigger modal with a
 * `[‹] title [Save]` bar. Save is shown only when `onSave` is given (the model
 * picker self-closes instead). `‹` steps back via `onBack` when given, else
 * dismisses. Dismissing a `dirty` sheet first raises a Discard-changes confirm,
 * so a back-arrow never silently throws away staged edits (Laura SOFT-1).
 */
export function PickerOverlay({
  open,
  title,
  onClose,
  onBack,
  onSave,
  saveDisabled,
  dirty,
  triggerRef,
  children,
}: PickerOverlayProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Reset the guard whenever the sheet (re)opens.
  useEffect(() => {
    if (open) setConfirmingDiscard(false);
  }, [open]);

  // Origin-zoom: set transform-origin from the trigger before paint.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef?.current;
    if (panel && trigger) {
      panel.style.transformOrigin = computeTransformOrigin(
        trigger.getBoundingClientRect(),
        panel.getBoundingClientRect(),
      );
    }
  }, [open, triggerRef]);

  // Focus management + Esc + a minimal focus trap (spec §2.3). While the discard
  // confirm is up, ConfirmDialog owns Esc/focus, so this handler stands down.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (confirmingDiscard) return;
      if (e.key === 'Escape') {
        requestDismiss();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (!firstNode || !lastNode) return;
        const active = document.activeElement;
        if (e.shiftKey && active === firstNode) {
          e.preventDefault();
          lastNode.focus();
        } else if (!e.shiftKey && active === lastNode) {
          e.preventDefault();
          firstNode.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
    // Deps mirror the inputs requestDismiss closes over (dirty, onClose) plus the
    // open/guard state; requestDismiss is re-created each render and read fresh.
  }, [open, confirmingDiscard, dirty, onClose]);

  function requestDismiss(): void {
    if (dirty) setConfirmingDiscard(true);
    else onClose();
  }

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-picker-root" role="dialog" aria-modal="true" aria-label={title}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to dismiss; Escape is handled on window */}
      <div
        data-testid="cs-picker-backdrop"
        className="cs-picker-backdrop"
        onClick={requestDismiss}
        aria-hidden="true"
      />
      <div ref={panelRef} className="cs-picker-panel cs-zoom-in" tabIndex={-1}>
        <header className="cs-picker-titlebar">
          <button
            type="button"
            aria-label="Back"
            className="cs-picker-back"
            onClick={() => (onBack ? onBack() : requestDismiss())}
          >
            ‹
          </button>
          <h2 className="cs-picker-title">{title}</h2>
          {onSave ? (
            <Button tone="primary" priority disabled={saveDisabled} onClick={onSave}>
              Save
            </Button>
          ) : (
            <span className="cs-picker-save-spacer" aria-hidden="true" />
          )}
        </header>
        <div className="cs-picker-scroll">{children}</div>
      </div>
      <ConfirmDialog
        open={confirmingDiscard}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add the `.cs-picker-*` CSS**

In `src/index.css`, locate the `.cs-reader-root`, `.cs-reader-backdrop`, `.cs-reader-panel`, and `.cs-reader-scroll` rule blocks. Copy their declarations into four new blocks renamed `.cs-picker-root`, `.cs-picker-backdrop`, `.cs-picker-panel`, `.cs-picker-scroll` (identical overlay chrome — fixed inset stacking layer, dim backdrop, inset opulent panel, scrolling body). Then append the titlebar rules:

```css
.cs-picker-titlebar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
}
.cs-picker-back {
  font-size: 1.5rem;
  line-height: 1;
  color: var(--color-paper-soft, #b9b4c7);
  padding: 0.25rem 0.5rem;
  min-width: 44px;
  min-height: 44px;
  text-align: left;
}
.cs-picker-title {
  text-align: center;
  font-family: var(--font-display, serif);
  font-size: 0.95rem;
  color: var(--color-paper, #efeaf7);
}
.cs-picker-save-spacer {
  display: inline-block;
  min-width: 44px;
}
```

- [ ] **Step 5: Export from the barrel + add a showcase demo**

Add to `src/components/ui/index.ts`:

```ts
export { PickerOverlay, type PickerOverlayProps } from './PickerOverlay.js';
```

In `src/routes/app/ui-showcase.tsx`, import `PickerOverlay`, add `const [pickerOpen, setPickerOpen] = useState(false);` and `const [pickerDirty, setPickerDirty] = useState(false);`, a trigger button (`onClick={() => setPickerOpen(true)}`), and a section rendering:

```tsx
<PickerOverlay
  open={pickerOpen}
  title="Shell demo"
  onClose={() => setPickerOpen(false)}
  onSave={() => setPickerOpen(false)}
  saveDisabled={!pickerDirty}
  dirty={pickerDirty}
>
  <div className="p-4">
    <label className="flex items-center gap-2 text-sm text-paper">
      <input type="checkbox" checked={pickerDirty} onChange={(e) => setPickerDirty(e.target.checked)} />
      Mark dirty (to see the Save light up and the discard guard)
    </label>
  </div>
</PickerOverlay>
```

- [ ] **Step 6: Run the test + full gate**

Run: `pnpm test tests/component/ui-picker-overlay.test.tsx` → PASS.
Then: `pnpm typecheck --force` (14/14), `pnpm biome check src/components/ui/PickerOverlay.tsx src/components/ui/index.ts src/routes/app/ui-showcase.tsx`, full `pnpm test` (8-failure baseline).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/ui/PickerOverlay.tsx apps/user-client/src/components/ui/index.ts apps/user-client/src/index.css apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/ui-picker-overlay.test.tsx
git commit -m "Add PickerOverlay shell primitive"
```

---

### Task 2: `PickerField` generic trigger

A reusable trigger row (generalising `ModelPickerField`'s visible row): shows the current value, opens its overlay on tap (passing its own element as the zoom origin), carries a constructive stale state, and supports disabled-with-reason. It is overlay-agnostic — the parent decides which overlay `onOpen` opens.

**Files:**
- Create: `apps/user-client/src/components/ui/PickerField.tsx`
- Modify: `apps/user-client/src/components/ui/index.ts` (add export)
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a PickerField demo section)
- Test: `apps/user-client/tests/component/ui-picker-field.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PickerFieldProps {
    label: string;                                 // the row's static label
    value: React.ReactNode;                        // current selection display (or an "unset" hint)
    stale?: { reason: React.ReactNode };           // constructive unavailable-state copy
    disabled?: boolean;
    disabledReason?: string;
    onOpen: (trigger: HTMLElement) => void;        // open the overlay, with this element as zoom origin
  }
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/ui-picker-field.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PickerField } from '../../src/components/ui/PickerField.js';

describe('PickerField', () => {
  it('shows label + value and calls onOpen with its trigger element', () => {
    const onOpen = vi.fn();
    render(<PickerField label="Mindspace" value="Aurora" onOpen={onOpen} />);
    expect(screen.getByText('Mindspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mindspace/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
  });

  it('renders the constructive stale reason and marks the row stale', () => {
    render(
      <PickerField
        label="Search backend"
        value="Brave"
        stale={{ reason: 'Currently unavailable — add nano-gpt or pick another' }}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Currently unavailable — add nano-gpt or pick another'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search backend/ })).toHaveAttribute(
      'data-stale',
      'true',
    );
  });

  it('is disabled with a reason and does not open', () => {
    const onOpen = vi.fn();
    render(
      <PickerField
        label="Expert web"
        value="—"
        disabled
        disabledReason="Set an expert model first"
        onOpen={onOpen}
      />,
    );
    const btn = screen.getByRole('button', { name: /Expert web/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Set an expert model first');
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm test tests/component/ui-picker-field.test.tsx`
Expected: FAIL — cannot resolve `PickerField.js`.

- [ ] **Step 3: Implement `PickerField`**

```tsx
// src/components/ui/PickerField.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef } from 'react';

export interface PickerFieldProps {
  label: string;
  value: React.ReactNode;
  stale?: { reason: React.ReactNode };
  disabled?: boolean;
  disabledReason?: string;
  onOpen: (trigger: HTMLElement) => void;
}

/**
 * The generic picker trigger (spec §6): a labelled row showing the current value
 * that opens its overlay on tap, passing itself as the zoom origin. Carries a
 * constructive stale state (names the fix, never a dead blank) and a
 * disabled-with-reason mode (disabled-over-hidden). Overlay-agnostic — the parent
 * wires `onOpen` to the right overlay.
 */
export function PickerField({
  label,
  value,
  stale,
  disabled,
  disabledReason,
  onOpen,
}: PickerFieldProps): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      data-stale={stale ? 'true' : undefined}
      className="cs-picker-field"
      onClick={() => {
        if (!disabled && ref.current) onOpen(ref.current);
      }}
    >
      <span className="cs-picker-field-label">{label}</span>
      <span className="cs-picker-field-value">
        {stale ? <span className="cs-picker-field-stale">{stale.reason}</span> : value}
      </span>
      <span aria-hidden className="cs-picker-field-chevron">
        ›
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Add the `.cs-picker-field*` CSS**

Append to `src/index.css`:

```css
.cs-picker-field {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  text-align: left;
  padding: 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(255 255 255 / 0.06);
  background: rgb(255 255 255 / 0.02);
}
.cs-picker-field:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.04);
}
.cs-picker-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cs-picker-field[data-stale='true'] {
  border-color: rgb(255 90 90 / 0.3);
  background: rgb(255 90 90 / 0.04);
}
.cs-picker-field-label {
  font-family: var(--font-display, serif);
  font-size: 0.85rem;
  color: var(--color-paper-soft, #b9b4c7);
}
.cs-picker-field-value {
  font-size: 0.85rem;
  color: var(--color-paper, #efeaf7);
  text-align: right;
}
.cs-picker-field-stale {
  color: var(--color-danger, #ff8a8a);
}
.cs-picker-field-chevron {
  color: var(--color-paper-soft, #b9b4c7);
}
```

- [ ] **Step 5: Export from the barrel + add a showcase demo**

Add to `src/components/ui/index.ts`:

```ts
export { PickerField, type PickerFieldProps } from './PickerField.js';
```

In `ui-showcase.tsx`, add a section with three `PickerField`s: a normal one (`value="Aurora"`, `onOpen` toggles an alert/log), a stale one (`stale={{ reason: 'Currently unavailable — add nano-gpt or pick another' }}`), and a disabled one (`disabled disabledReason="Set an expert model first"`).

- [ ] **Step 6: Run the test + full gate**

Run: `pnpm test tests/component/ui-picker-field.test.tsx` → PASS.
Then `pnpm typecheck --force` (14/14), `pnpm biome check <changed files>`, full `pnpm test` (8-failure baseline).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/ui/PickerField.tsx apps/user-client/src/components/ui/index.ts apps/user-client/src/index.css apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/ui-picker-field.test.tsx
git commit -m "Add PickerField generic trigger primitive"
```

---

### Task 3: `MindspacePickerOverlay`

Stages the existing `MindspacePicker` (selection + texture + font + `allowUserDefault` chip) inside `PickerOverlay`: local staged state seeded on open, Save commits all three at once, the discard guard fires on a dirty `‹`/Esc/backdrop.

**Files:**
- Create: `apps/user-client/src/components/MindspacePickerOverlay.tsx`
- Modify: `apps/user-client/src/components/MindspacePicker.tsx:7` (export the `Font` type so the overlay can reuse it)
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a demo section)
- Test: `apps/user-client/tests/component/mindspace-picker-overlay.test.tsx`

**Interfaces:**
- Consumes: `PickerOverlay` (Task 1); `MindspacePicker` and `type Font` from `MindspacePicker.tsx`; `MindspaceRow`/`MindspaceTexture` from `boot/client-data-db.js`.
- Produces:
  ```ts
  export interface MindspaceSelection {
    mindspaceId: string | null;
    texture: MindspaceTexture;
    font: Font; // 'sans' | 'serif' | 'cursive'
  }
  export interface MindspacePickerOverlayProps {
    open: boolean;
    onClose: () => void;
    triggerRef?: React.RefObject<HTMLElement | null>;
    mindspaces: ReadonlyArray<MindspaceRow>;
    previewName: string;
    initial: MindspaceSelection;
    allowUserDefault?: boolean;
    hideFont?: boolean;
    onSave: (next: MindspaceSelection) => void;
  }
  ```

- [ ] **Step 1: Export the `Font` type**

In `src/components/MindspacePicker.tsx` change line 7 from `type Font = ...` to:

```ts
export type Font = 'sans' | 'serif' | 'cursive';
```

- [ ] **Step 2: Write the failing test**

```tsx
// tests/component/mindspace-picker-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MindspacePickerOverlay } from '../../src/components/MindspacePickerOverlay.js';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';

const PALETTE = {
  bg: '#000', surfaceBase: '#111', surfaceRaised: '#222', surfaceInput: '#333',
  accent: '#f0f', accentSubtle: '#a0a', accentBorder: '#909', accentBorderActive: '#b0b',
  accentGlow: '#c0c', text: { primary: '#fff', secondary: '#ccc', muted: '#999', ghost: '#666' },
};
const MINDSPACES: MindspaceRow[] = [
  { id: 'm1', displayName: 'Aurora', palette: PALETTE, texture: 'aurora', builtIn: true, createdAt: 0 },
  { id: 'm2', displayName: 'Grain', palette: { ...PALETTE, accent: '#0ff' }, texture: 'grain', builtIn: true, createdAt: 0 },
];

function setup(over: Partial<React.ComponentProps<typeof MindspacePickerOverlay>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <MindspacePickerOverlay
      open
      onClose={onClose}
      mindspaces={MINDSPACES}
      previewName="Fable"
      initial={{ mindspaceId: 'm1', texture: 'aurora', font: 'serif' }}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave, onClose };
}

describe('MindspacePickerOverlay', () => {
  it('Save is disabled until a staged change, then commits the staged selection', () => {
    const { onSave } = setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mindspace Grain' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ mindspaceId: 'm2', texture: 'aurora', font: 'serif' });
  });

  it('a dirty back raises the discard guard and does not commit', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mindspace Grain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Discard changes?')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `pnpm test tests/component/mindspace-picker-overlay.test.tsx` → FAIL (cannot resolve module).

- [ ] **Step 4: Implement `MindspacePickerOverlay`**

```tsx
// src/components/MindspacePickerOverlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';
import { PickerOverlay } from './ui/PickerOverlay.js';
import { type Font, MindspacePicker } from './MindspacePicker.js';

export interface MindspaceSelection {
  mindspaceId: string | null;
  texture: MindspaceTexture;
  font: Font;
}

export interface MindspacePickerOverlayProps {
  open: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  mindspaces: ReadonlyArray<MindspaceRow>;
  previewName: string;
  initial: MindspaceSelection;
  allowUserDefault?: boolean;
  hideFont?: boolean;
  onSave: (next: MindspaceSelection) => void;
}

/**
 * The Mindspace picker (spec §3): the existing MindspacePicker staged inside the
 * shared shell. Local state is seeded from `initial` on open; Save commits all
 * three knobs at once; a dirty dismissal is discard-guarded by PickerOverlay.
 */
export function MindspacePickerOverlay({
  open,
  onClose,
  triggerRef,
  mindspaces,
  previewName,
  initial,
  allowUserDefault,
  hideFont,
  onSave,
}: MindspacePickerOverlayProps): JSX.Element {
  const [draft, setDraft] = useState<MindspaceSelection>(initial);

  // Re-seed each time the sheet opens, so a discarded edit does not persist.
  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const dirty =
    draft.mindspaceId !== initial.mindspaceId ||
    draft.texture !== initial.texture ||
    draft.font !== initial.font;

  return (
    <PickerOverlay
      open={open}
      title="Mindspace"
      onClose={onClose}
      triggerRef={triggerRef}
      onSave={() => onSave(draft)}
      saveDisabled={!dirty}
      dirty={dirty}
    >
      <div className="p-4">
        <MindspacePicker
          mindspaces={mindspaces}
          selectedMindspaceId={draft.mindspaceId}
          selectedTexture={draft.texture}
          selectedFont={draft.font}
          previewName={previewName}
          allowUserDefault={allowUserDefault}
          hideFont={hideFont}
          onMindspaceChange={(mindspaceId) => setDraft((d) => ({ ...d, mindspaceId }))}
          onTextureChange={(texture) => setDraft((d) => ({ ...d, texture }))}
          onFontChange={(font) => setDraft((d) => ({ ...d, font }))}
        />
      </div>
    </PickerOverlay>
  );
}
```

- [ ] **Step 5: Add a showcase demo**

In `ui-showcase.tsx` add a section: a `PickerField` (label "Default Mindspace") whose `onOpen` opens a `MindspacePickerOverlay` with the showcase's `MINDSPACES` sample (define a tiny inline sample array mirroring the test), `initial={{ mindspaceId: 'm1', texture: 'aurora', font: 'serif' }}`, and `onSave` storing into local state so the field reflects the commit.

- [ ] **Step 6: Run the test + full gate**

Run: `pnpm test tests/component/mindspace-picker-overlay.test.tsx` → PASS.
Then `pnpm typecheck --force` (14/14), `pnpm biome check <changed files>`, full `pnpm test` (8-failure baseline). The `MindspacePicker.tsx` `Font`-export change is non-breaking (it was a local alias of the same union).

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/MindspacePickerOverlay.tsx apps/user-client/src/components/MindspacePicker.tsx apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/mindspace-picker-overlay.test.tsx
git commit -m "Add MindspacePickerOverlay"
```

---

### Task 4: `ModelPickerOverlay`

Rehouses the two-step model→provider flow into `PickerOverlay`: no Save, auto-close on provider tap, `onBack` returns from the provider step to the model step, `filter` is call-site-locked, and a vision-emptied list names the constraint (Laura SOFT-3).

**Files:**
- Create: `apps/user-client/src/components/ModelPickerOverlay.tsx`
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a demo section)
- Test: `apps/user-client/tests/component/model-picker-overlay.test.tsx`

**Interfaces:**
- Consumes: `PickerOverlay` (Task 1); `buildPickerData`, `filterGroupsByQuery`, `type PickerModel`, `type ModelFilter`, `type ModelSelection` from `model-picker/model-picker-data.js`; the trust/freedom badges from `ModelTrustBadges.js` and `effectiveFreedom` from `@chatsundere/llm-unified` (as `ModelPickerModal.tsx` uses them).
- Produces:
  ```ts
  export interface ModelPickerOverlayProps {
    open: boolean;
    onClose: () => void;
    onSelect: (sel: ModelSelection) => void;
    providers: ProviderRow[];
    configuredTemplateIds: string[];
    filter?: ModelFilter;                 // 'all' | 'vision' — call-site-locked
    current?: { providerTemplateId: string; upstreamSlug: string } | null;
    onBrowseProviders?: () => void;
    triggerRef?: React.RefObject<HTMLElement | null>;
  }
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/model-picker-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelPickerOverlay } from '../../src/components/ModelPickerOverlay.js';
import * as data from '../../src/components/model-picker/model-picker-data.js';

const MODEL = {
  canonical: { id: 'c1', displayName: 'Fable 5', family: 'Fable', freedomOriented: true },
  offers: [
    {
      offering: {
        providerId: 'p1', upstreamSlug: 'fable-5',
        trust: { tee: false, zdr: false, jurisdiction: undefined },
        context: { recommended: 200000 },
        profile: { vision: true, toolCalls: { supported: true } },
        freedomOrientedDeployment: true, canonicalRef: 'c1',
      },
      providerRowId: 'r1', providerDisplayName: 'nano-gpt',
    },
  ],
  teeAvailable: false, zdrAvailable: false, sortPriority: 0,
} as unknown as data.PickerModel;

function stubData(groups: data.FamilyGroup[], hiddenCount = 0) {
  vi.spyOn(data, 'buildPickerData').mockReturnValue({ groups, hiddenCount });
  vi.spyOn(data, 'filterGroupsByQuery').mockImplementation((g) => g);
}

describe('ModelPickerOverlay', () => {
  it('drills model → provider, ‹ returns to models, picking a provider commits and closes; no Save', () => {
    stubData([{ family: 'Fable', models: [MODEL], sortPriority: 0 }]);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ModelPickerOverlay
        open onClose={onClose} onSelect={onSelect}
        providers={[]} configuredTemplateIds={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Fable 5/ }));
    // provider step
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).not.toHaveBeenCalled(); // ‹ stepped back, not closed
    fireEvent.click(screen.getByRole('button', { name: /Fable 5/ }));
    fireEvent.click(screen.getByRole('button', { name: /nano-gpt/ }));
    expect(onSelect).toHaveBeenCalledWith({
      canonicalId: 'c1', providerTemplateId: 'p1', providerRowId: 'r1', upstreamSlug: 'fable-5',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('vision-locked empty list names the constraint', () => {
    stubData([], 2);
    render(
      <ModelPickerOverlay
        open onClose={vi.fn()} onSelect={vi.fn()}
        providers={[]} configuredTemplateIds={[]} filter="vision"
      />,
    );
    expect(screen.getByText(/image-capable models/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm test tests/component/model-picker-overlay.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `ModelPickerOverlay`**

Create `src/components/ModelPickerOverlay.tsx`. Lift the model-list and provider-list rendering bodies verbatim from `ModelPickerModal.tsx:164-267` (the `!activeModel ? (model list) : (provider list)` block, including the `pick()` helper at lines 101-111 and the `activeModel`/`visibleGroups`/`data` memos at lines 72-88), but:
- render them as the `children` of `PickerOverlay` (drop the bottom-sheet `<div data-app-sheet>` chrome and the local header — the shell provides the titlebar);
- `title="Choose a model"`, `onClose={onClose}`, `triggerRef={triggerRef}`, **no `onSave`**;
- `onBack={activeCanonicalId ? () => setActiveCanonicalId(null) : undefined}` (the shell's `‹` becomes the model-step back; on the model step it dismisses);
- in `pick()`, call `onSelect(...)` then `onClose()` (auto-close — there is no closing-animation state machine here; the shell unmounts on `open=false`);
- replace the search-input wrapper's sheet-specific classes with a plain `<div className="px-4 pb-3">` (keep the `<input>` exactly);
- the `EmptyState` becomes constraint-aware:

```tsx
function EmptyState({
  hiddenCount,
  filter,
  onBrowseProviders,
}: {
  hiddenCount: number;
  filter: ModelFilter;
  onBrowseProviders?: () => void;
}): JSX.Element {
  const message =
    hiddenCount > 0 && filter === 'vision'
      ? 'No image-capable models available — add a provider that offers vision.'
      : hiddenCount > 0
        ? `${hiddenCount} model${hiddenCount === 1 ? '' : 's'} unlock once you add a provider.`
        : 'No models match your search.';
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-center">
      <p className="text-sm text-paper-soft">{message}</p>
      {hiddenCount > 0 && onBrowseProviders ? (
        <button
          type="button"
          onClick={onBrowseProviders}
          className="mt-2 text-[11px] text-aurora-200 underline"
        >
          Add a provider → My Settings
        </button>
      ) : null}
    </div>
  );
}
```

The component shell:

```tsx
// src/components/ModelPickerOverlay.tsx (skeleton — fill the lifted lists per above)
// SPDX-License-Identifier: AGPL-3.0-only
import { effectiveFreedom } from '@chatsundere/llm-unified';
import { useEffect, useMemo, useState } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { FreedomBadge, JurisdictionBadge, TrustBadge } from './ModelTrustBadges.js';
import {
  type ModelFilter, type ModelSelection, type PickerModel,
  buildPickerData, filterGroupsByQuery,
} from './model-picker/model-picker-data.js';
import { PickerOverlay } from './ui/PickerOverlay.js';

export interface ModelPickerOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: ModelSelection) => void;
  providers: ProviderRow[];
  configuredTemplateIds: string[];
  filter?: ModelFilter;
  current?: { providerTemplateId: string; upstreamSlug: string } | null;
  onBrowseProviders?: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function ModelPickerOverlay({
  open, onClose, onSelect, providers, configuredTemplateIds,
  filter = 'all', current, onBrowseProviders, triggerRef,
}: ModelPickerOverlayProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [activeCanonicalId, setActiveCanonicalId] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setQuery(''); setActiveCanonicalId(null); }
  }, [open]);

  const data = useMemo(
    () => buildPickerData(providers, configuredTemplateIds, filter),
    [providers, configuredTemplateIds, filter],
  );
  const visibleGroups = useMemo(() => filterGroupsByQuery(data.groups, query), [data.groups, query]);
  const activeModel: PickerModel | null = useMemo(() => {
    if (!activeCanonicalId) return null;
    for (const g of data.groups) {
      const m = g.models.find((x) => x.canonical.id === activeCanonicalId);
      if (m) return m;
    }
    return null;
  }, [data.groups, activeCanonicalId]);

  const pick = (model: PickerModel, offerIndex: number): void => {
    const o = model.offers[offerIndex];
    if (!o) return;
    onSelect({
      canonicalId: model.canonical.id,
      providerTemplateId: o.offering.providerId,
      providerRowId: o.providerRowId,
      upstreamSlug: o.offering.upstreamSlug,
    });
    onClose();
  };

  return (
    <PickerOverlay
      open={open}
      title="Choose a model"
      onClose={onClose}
      onBack={activeCanonicalId ? () => setActiveCanonicalId(null) : undefined}
      triggerRef={triggerRef}
    >
      {/* model list (with search) when !activeModel, else provider list —
          lifted from ModelPickerModal.tsx:164-267, EmptyState given `filter` */}
    </PickerOverlay>
  );
}
```

> Note for the implementer: the lifted model-list buttons must keep `onClick={() => setActiveCanonicalId(m.canonical.id)}`; the provider-list buttons keep `onClick={() => pick(activeModel, i)}`. Pass `filter` into `<EmptyState ... />`.

- [ ] **Step 4: Run the test, then full gate**

Run: `pnpm test tests/component/model-picker-overlay.test.tsx` → PASS.
Then `pnpm typecheck --force` (14/14), `pnpm biome check <changed files>`, full `pnpm test` (8-failure baseline).

- [ ] **Step 5: Add a showcase demo**

In `ui-showcase.tsx`, add a `PickerField` (label "Model") opening a `ModelPickerOverlay` with `providers={[]} configuredTemplateIds={[]}` (the empty state is the visible demo) and a second `PickerField` (label "Image model") opening one with `filter="vision"` to show the constraint copy.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ModelPickerOverlay.tsx apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/model-picker-overlay.test.tsx
git commit -m "Add ModelPickerOverlay (rehoused two-step model picker)"
```

---

### Task 5: `WebPickerOverlay`

Stages the search/fetch (and, in expert mode, depth) backends inside `PickerOverlay` under one Save. "Off" is a first-class peer option; a committed backend whose provider was removed shows a per-field stale note (Laura SOFT-4).

**Files:**
- Create: `apps/user-client/src/components/WebPickerOverlay.tsx`
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a demo section)
- Test: `apps/user-client/tests/component/web-picker-overlay.test.tsx`

**Interfaces:**
- Consumes: `PickerOverlay` (Task 1); `WebBackendOption` from `lib/web-backend-options.js`; `WebBackendSetting`, `resolveWebBackend` from `lib/web-backends.js`; `SearchTier` from `@chatsundere/llm-unified`.
- Produces:
  ```ts
  export interface WebPickerValue {
    search: WebBackendSetting;
    fetch: WebBackendSetting;
    searchTierId: string | null; // expert mode only; pass-through in general mode
  }
  export interface WebPickerOverlayProps {
    open: boolean;
    onClose: () => void;
    triggerRef?: React.RefObject<HTMLElement | null>;
    title: string;                 // "Web search" / "Expert web"
    mode: 'general' | 'expert';
    options: WebBackendOption[];
    searchTiers: SearchTier[];     // used only when mode==='expert'
    initial: WebPickerValue;
    onSave: (next: WebPickerValue) => void;
  }
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/component/web-picker-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebPickerOverlay } from '../../src/components/WebPickerOverlay.js';
import type { WebBackendOption } from '../../src/lib/web-backend-options.js';

const OPTIONS: WebBackendOption[] = [
  { providerId: 'p1', providerName: 'nano-gpt', upstreamSlug: 'web-brave-search', label: 'Brave', canSearch: true, canFetch: false, traits: ['recommended'], requiresProxy: false },
  { providerId: 'p1', providerName: 'nano-gpt', upstreamSlug: 'web-fetch', label: 'nano-gpt', canSearch: false, canFetch: true, traits: [], requiresProxy: false },
];

function setup(over: Partial<React.ComponentProps<typeof WebPickerOverlay>> = {}) {
  const onSave = vi.fn();
  render(
    <WebPickerOverlay
      open onClose={vi.fn()} title="Web search" mode="general"
      options={OPTIONS} searchTiers={[]}
      initial={{ search: null, fetch: null, searchTierId: null }}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave };
}

describe('WebPickerOverlay', () => {
  it('general mode shows search + fetch (no depth), with an Off option each', () => {
    setup();
    expect(screen.getByLabelText('Search backend')).toBeInTheDocument();
    expect(screen.getByLabelText('Fetch backend')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search depth')).toBeNull();
    // "Off" present as a selectable option in the search select
    const search = screen.getByLabelText('Search backend') as HTMLSelectElement;
    expect([...search.options].some((o) => o.text === 'Off')).toBe(true);
  });

  it('expert mode adds the depth field', () => {
    setup({
      mode: 'expert',
      title: 'Expert web',
      searchTiers: [{ id: 'neural', label: 'Neural' } as never],
    });
    expect(screen.getByLabelText('Search depth')).toBeInTheDocument();
  });

  it('Save is dirty-gated and commits the staged value', () => {
    const { onSave } = setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search backend'), { target: { value: '' } }); // → Off
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ search: 'off', fetch: null, searchTierId: null });
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm test tests/component/web-picker-overlay.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `WebPickerOverlay`**

```tsx
// src/components/WebPickerOverlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier, WebTrait } from '@chatsundere/llm-unified';
import { useEffect, useState } from 'react';
import type { WebBackendOption } from '../lib/web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from '../lib/web-backends.js';
import { PickerOverlay } from './ui/PickerOverlay.js';

export interface WebPickerValue {
  search: WebBackendSetting;
  fetch: WebBackendSetting;
  searchTierId: string | null;
}
export interface WebPickerOverlayProps {
  open: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  title: string;
  mode: 'general' | 'expert';
  options: WebBackendOption[];
  searchTiers: SearchTier[];
  initial: WebPickerValue;
  onSave: (next: WebPickerValue) => void;
}

const TRAIT_LABEL: Record<WebTrait, string> = {
  recommended: 'Recommended', ai: 'AI', neural: 'Neural', privacy: 'Privacy',
};
const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;
const displayName = (o: WebBackendOption): string =>
  o.label === o.providerName ? o.label : `${o.label} (${o.providerName})`;
function settingFromValue(v: string): WebBackendSetting {
  if (v === '') return 'off';
  const [providerId, upstreamSlug] = v.split('::');
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : 'off';
}

/** True when the stored setting is an explicit ref no longer present for this role. */
function isStale(setting: WebBackendSetting, options: WebBackendOption[], role: 'search' | 'fetch'): boolean {
  if (setting === 'off' || setting === null) return false;
  const usable = options.filter((o) => (role === 'search' ? o.canSearch : o.canFetch));
  return !usable.some((o) => o.providerId === setting.providerId && o.upstreamSlug === setting.upstreamSlug);
}

function BackendField({
  id, label, role, options, setting, onChange,
}: {
  id: string; label: string; role: 'search' | 'fetch';
  options: WebBackendOption[]; setting: WebBackendSetting;
  onChange: (s: WebBackendSetting) => void;
}): JSX.Element {
  const roleOptions = options.filter((o) => (role === 'search' ? o.canSearch : o.canFetch));
  const effective = resolveWebBackend(setting, options, role);
  const effectiveOption = effective
    ? roleOptions.find((o) => o.providerId === effective.providerId && o.upstreamSlug === effective.upstreamSlug)
    : undefined;
  const value = setting === 'off' || !effective ? '' : keyOf(effective);
  const stale = isStale(setting, options, role);
  return (
    <div className="web-field">
      <label htmlFor={id}>{label}</label>
      <div className="web-select-wrap">
        <select id={id} className="web-select" value={value}
          onChange={(e) => onChange(settingFromValue(e.target.value))}>
          {/* "Off" first-class: kept an explicit, labelled option (Laura SOFT-4) */}
          <option value="">Off</option>
          {roleOptions.map((o) => (
            <option key={keyOf(o)} value={keyOf(o)}>{displayName(o)}</option>
          ))}
        </select>
      </div>
      {stale ? (
        <p className="web-stale-note">
          Your chosen {role} backend is unavailable — pick another or it stays off.
        </p>
      ) : effectiveOption && effectiveOption.traits.length > 0 ? (
        <span className="web-traits">
          {effectiveOption.traits.map((t) => (
            <span key={t} className="web-trait-pill">{TRAIT_LABEL[t]}</span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** The web backends picker (spec §5): search + fetch (+ depth in expert mode),
 *  staged under one Save. */
export function WebPickerOverlay({
  open, onClose, triggerRef, title, mode, options, searchTiers, initial, onSave,
}: WebPickerOverlayProps): JSX.Element {
  const [draft, setDraft] = useState<WebPickerValue>(initial);
  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const dirty =
    JSON.stringify(draft.search) !== JSON.stringify(initial.search) ||
    JSON.stringify(draft.fetch) !== JSON.stringify(initial.fetch) ||
    draft.searchTierId !== initial.searchTierId;

  const defaultTierId = searchTiers.find((t) => t.id === 'neural')?.id ?? searchTiers[0]?.id ?? '';

  return (
    <PickerOverlay
      open={open} title={title} onClose={onClose} triggerRef={triggerRef}
      onSave={() => onSave(draft)} saveDisabled={!dirty} dirty={dirty}
    >
      <div className="expert-web p-4">
        <BackendField id="web-search-backend" label="Search backend" role="search"
          options={options} setting={draft.search}
          onChange={(search) => setDraft((d) => ({ ...d, search }))} />
        {mode === 'expert' ? (
          <div className="web-field">
            <label htmlFor="web-depth">Search depth</label>
            <div className="web-select-wrap">
              <select id="web-depth" className="web-select" disabled={searchTiers.length === 0}
                value={draft.searchTierId ?? defaultTierId}
                onChange={(e) => setDraft((d) => ({ ...d, searchTierId: e.target.value || null }))}>
                {searchTiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
        <BackendField id="web-fetch-backend" label="Fetch backend" role="fetch"
          options={options} setting={draft.fetch}
          onChange={(fetch) => setDraft((d) => ({ ...d, fetch }))} />
      </div>
    </PickerOverlay>
  );
}
```

- [ ] **Step 4: Add the `.web-stale-note` CSS**

Append to `src/index.css` (the other `.web-*` classes already exist):

```css
.web-stale-note {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-danger, #ff8a8a);
}
```

- [ ] **Step 5: Run the test, then full gate**

Run: `pnpm test tests/component/web-picker-overlay.test.tsx` → PASS.
Then `pnpm typecheck --force` (14/14), `pnpm biome check <changed files>`, full `pnpm test` (8-failure baseline).

- [ ] **Step 6: Add a showcase demo**

In `ui-showcase.tsx`, add two `PickerField`s: "Web search" → `WebPickerOverlay mode="general"` and "Expert web" → `WebPickerOverlay mode="expert"`, both with a small inline `OPTIONS` sample (mirroring the test) and `searchTiers={[{ id: 'neural', label: 'Neural' }, { id: 'deep', label: 'Deep' }]}` for the expert one; `onSave` stores into local state.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/WebPickerOverlay.tsx apps/user-client/src/index.css apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/web-picker-overlay.test.tsx
git commit -m "Add WebPickerOverlay (search + fetch + expert depth)"
```

---

## Self-Review

**Spec coverage:**
- §2 `PickerOverlay` shell (header, optional Save, `onBack`, dirty-discard guard, focus trap, motion) → Task 1. ✓
- §3 `MindspacePickerOverlay` (staged MindspacePicker, Save, guard) → Task 3. ✓
- §4 `ModelPickerOverlay` (rehoused two-step, no Save, auto-close, `onBack` drill, call-site-locked `filter`, vision empty copy SOFT-3) → Task 4. ✓
- §5 `WebPickerOverlay` (`mode` field-sets, first-class Off SOFT-4, per-field stale SOFT-4, combined Save) → Task 5. ✓
- §6 `PickerField` (value, stale, disabled-with-reason, zoom-origin `onOpen`) → Task 2. ✓
- §7 Showcase demos, no live wiring → every task adds a `/app/ui-showcase` entry; scope fence in Global Constraints. ✓
- §8 empty/stale states → Task 4 EmptyState (incl. vision), Task 5 per-field stale, Task 2 PickerField stale. ✓
- §9 testing (full vitest, typecheck --force) → every task's gate step. ✓
- SOFT-1 discard guard → Task 1. SOFT-2 (row affordance grammar) is a design-language-pass deferral, correctly not a task here.

**Placeholder scan:** No TBD/TODO. The one "fill the lifted lists" instruction in Task 4 Step 3 points at exact source lines (`ModelPickerModal.tsx:164-267`) with concrete transformation rules and the full surrounding skeleton — a lift, not a placeholder.

**Type consistency:** `ModelSelection` (4 fields) is the existing exported type, used identically in Task 4. `MindspaceSelection`/`WebPickerValue` are defined in their producing tasks and consumed only there. `Font` is exported from `MindspacePicker.tsx` in Task 3 Step 1 before use. `PickerOverlayProps` names (`onBack`, `onSave`, `saveDisabled`, `dirty`) are identical across Tasks 1, 3, 4, 5.
