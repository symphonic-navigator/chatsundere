# Design Language Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable foundation of the Chatsundere UI/UX makeover — design tokens, the origin-aware motion language, and seven core primitives (Button, Badge, Pill, OverflowMenu, ListRow, ListScaffold, ConfirmDialog) — validated together on an internal showcase route.

**Architecture:** Primitives live in a new `apps/user-client/src/components/ui/` library, styled with centralised CSS classes + `data-*` state attributes in `src/index.css` (the established codebase pattern — no CVA/Radix). Motion is CSS-only: keyframes + utility classes plus a tiny pure helper that computes a `transform-origin` from a trigger's rect. Every appearing/disappearing surface (dialogs, menus, pages) speaks the same origin-aware zoom; all motion degrades to a plain cross-fade under `prefers-reduced-motion`.

**Tech Stack:** React 18, TypeScript (strict), Tailwind v4 (`@theme` tokens in `index.css`), Vitest + React Testing Library (jsdom), Biome.

## Global Constraints

- **British English** in all identifiers, copy, comments, commit messages — verbatim project hard rule.
- **SPDX header** on every new app file: `// SPDX-License-Identifier: AGPL-3.0-only` (`.tsx`/`.ts`) — first line.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification comment.
- **No CVA / Radix / framer-motion.** Variants via `data-*` + CSS. Motion is CSS-only.
- **ESM import extensions:** intra-app imports end in `.js` (e.g. `import { Button } from './Button.js'`).
- **Reduced motion is first-class:** every animation has a `@media (prefers-reduced-motion: reduce)` fallback to a cross-fade or none.
- **Mobile-first at 380px.** Touch targets ≥ 40px.
- **Biome:** no non-null assertion `!` without a `// biome-ignore` justification line.
- **Components return `JSX.Element`.** Functional components only.
- **Tests** live under `apps/user-client/tests/**`, named `*.test.{ts,tsx}`, run via Vitest (jsdom, globals, `tests/setup.ts`). Note `tests/setup.ts` stubs `matchMedia` with `matches: false`, so **reduced-motion is OFF by default in tests** — opt in per-test by overriding `window.matchMedia`.
- **Run a single test file:** `cd apps/user-client && pnpm vitest run tests/component/<file>`.
- **Final gate:** `cd apps/user-client && pnpm vitest run` (expect the documented **8 Node-localStorage baseline** failures, nothing else) and from repo root `pnpm typecheck --force`.

---

### Task 1: Design tokens + motion keyframes

**Files:**
- Modify: `apps/user-client/src/index.css:28-46` (extend `@theme`) and append a motion block after the existing keyframes (around `:130`).

**Interfaces:**
- Produces (CSS custom properties, available app-wide): `--color-nav-pink`, `--color-nav-pink-icon`, `--color-nav-green`, `--color-nav-green-icon`, `--color-nav-blue`, `--color-nav-blue-icon`, `--color-nav-purple`, `--color-nav-purple-dark`, `--color-gold`, `--color-gold-hi`, `--color-gold-lo`, `--color-destructive`, `--color-destructive-text`, `--badge-tile-tone`.
- Produces (CSS utility classes): `.cs-zoom-in`, `.cs-zoom-out`, `.cs-tile-blink` (with reduced-motion fallbacks).

- [ ] **Step 1: Extend the `@theme` block**

In `apps/user-client/src/index.css`, inside the existing `@theme { … }` (after `--color-danger: #ff7a8a;` on line 40), add:

```css
  /* Navigation-plane room identities (makeover design language) */
  --color-nav-pink: #ff6db0;
  --color-nav-pink-icon: #ff8ec4;
  --color-nav-green: #4fd38a;
  --color-nav-green-icon: #7fe0a8;
  --color-nav-blue: #5b9dff;
  --color-nav-blue-icon: #9cc0ff;
  --color-nav-purple: #a98bff;
  --color-nav-purple-dark: #7457c4;
  /* Gold = priority overlay (exactly one element per screen) */
  --color-gold: #e8c061;
  --color-gold-hi: #f0d488;
  --color-gold-lo: #d9b455;
  /* Destructive — action plane only */
  --color-destructive: #ff5a5a;
  --color-destructive-text: #ff8a8a;
  /* Single token for the tile-badge tone. Parked design exploration:
     flip to a room-tinted value later in one line (spec §6, §10). */
  --badge-tile-tone: var(--color-paper-soft);
```

- [ ] **Step 2: Append the motion block**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── Unified-Experience motion language (makeover) ───────────────────────
   Every appearing/disappearing surface shares this gesture. Enter savours
   (~0.30s), exit vanishes (~0.17s). transform-origin is set inline by the
   caller from the trigger's position (see lib/origin-zoom.ts). */
@keyframes cs-zoom-in {
  from { transform: scale(0.32); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes cs-zoom-out {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0.5); opacity: 0; }
}
@keyframes cs-tile-blink {
  0% { box-shadow: 0 0 0 0 rgba(232, 192, 97, 0); filter: brightness(1); }
  22% { box-shadow: 0 0 20px 2px rgba(232, 192, 97, 0.95); filter: brightness(1.5); }
  44% { box-shadow: 0 0 0 0 rgba(232, 192, 97, 0); filter: brightness(1); }
  68% { box-shadow: 0 0 20px 2px rgba(232, 192, 97, 0.95); filter: brightness(1.5); }
  100% { box-shadow: 0 0 0 0 rgba(232, 192, 97, 0); filter: brightness(1); }
}
@keyframes cs-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cs-fade-out { from { opacity: 1; } to { opacity: 0; } }

.cs-zoom-in { animation: cs-zoom-in 0.3s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.cs-zoom-out { animation: cs-zoom-out 0.17s ease-in both; }
.cs-tile-blink { animation: cs-tile-blink 0.26s ease-out; }

@media (prefers-reduced-motion: reduce) {
  .cs-zoom-in { animation: cs-fade-in 0.15s ease both; }
  .cs-zoom-out { animation: cs-fade-out 0.12s ease both; }
  .cs-tile-blink { animation: none; }
}
```

- [ ] **Step 3: Verify the stylesheet builds**

Run: `cd apps/user-client && pnpm vitest run --passWithNoTests`
Expected: no failure introduced (this task adds CSS only; behaviour is verified visually on the showcase in Task 10). Then confirm the dev pipeline parses the CSS:
Run: `cd apps/user-client && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS (no TS errors; CSS is not type-checked but this confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Add design-language tokens and motion keyframes"
```

---

### Task 2: Origin-zoom helper

**Files:**
- Create: `apps/user-client/src/lib/origin-zoom.ts`
- Test: `apps/user-client/tests/lib/origin-zoom.test.ts`

**Interfaces:**
- Produces: `computeTransformOrigin(trigger: DOMRect, stage: DOMRect): string` — returns a `"<x>% <y>%"` string locating the trigger's centre within the stage. Used by ConfirmDialog (Task 9) and OverflowMenu (Task 6) to make a surface zoom out of the element that opened it.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/origin-zoom.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { computeTransformOrigin } from '../../src/lib/origin-zoom.js';

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) };
}

describe('computeTransformOrigin', () => {
  it('returns the centre of a trigger as a percentage of the stage', () => {
    const stage = rect(0, 0, 200, 400);
    const trigger = rect(50, 100, 100, 100); // centre at (100, 150)
    expect(computeTransformOrigin(trigger, stage)).toBe('50% 37.5%');
  });

  it('offsets by the stage origin', () => {
    const stage = rect(100, 200, 200, 200);
    const trigger = rect(150, 250, 100, 100); // centre (200, 300) → (100,100) within stage
    expect(computeTransformOrigin(trigger, stage)).toBe('50% 50%');
  });

  it('clamps to the 0–100 range for triggers outside the stage', () => {
    const stage = rect(0, 0, 100, 100);
    const trigger = rect(-50, 200, 10, 10); // centre (-45, 205)
    expect(computeTransformOrigin(trigger, stage)).toBe('0% 100%');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/origin-zoom.test.ts`
Expected: FAIL — cannot find module `origin-zoom.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/user-client/src/lib/origin-zoom.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute a CSS `transform-origin` value placing the visual origin at the
 * centre of `trigger`, expressed as percentages of `stage`. Lets a surface
 * zoom out of the element that opened it (the Unified-Experience motion,
 * spec §3). Result is clamped to 0–100% so off-stage triggers stay sane.
 */
export function computeTransformOrigin(trigger: DOMRect, stage: DOMRect): string {
  const cx = trigger.left + trigger.width / 2 - stage.left;
  const cy = trigger.top + trigger.height / 2 - stage.top;
  const x = clamp((cx / stage.width) * 100, 0, 100);
  const y = clamp((cy / stage.height) * 100, 0, 100);
  return `${+x.toFixed(2)}% ${+y.toFixed(2)}%`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/lib/origin-zoom.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/origin-zoom.ts apps/user-client/tests/lib/origin-zoom.test.ts
git commit -m "Add origin-zoom transform-origin helper"
```

---

### Task 3: Button primitive

**Files:**
- Create: `apps/user-client/src/components/ui/Button.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-btn` styles)
- Test: `apps/user-client/tests/component/ui-button.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ButtonTone = 'primary' | 'neutral' | 'destructive';
  export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    tone?: ButtonTone;      // default 'neutral'
    priority?: boolean;     // gold overlay; IGNORED when tone === 'destructive'
  }
  export function Button(props: ButtonProps): JSX.Element;
  ```
- Consumed by: ConfirmDialog (Task 9), ListScaffold footer (Task 8), showcase (Task 10).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-button.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/components/ui/Button.js';

describe('Button', () => {
  it('renders children inside a real button element', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('defaults to the neutral tone', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-tone', 'neutral');
  });

  it('applies the priority (gold) overlay for a primary button', () => {
    render(<Button tone="primary" priority>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tone', 'primary');
    expect(btn).toHaveAttribute('data-priority', 'true');
  });

  it('never marks a destructive button as priority (gold never invites destruction)', () => {
    render(<Button tone="destructive" priority>Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tone', 'destructive');
    expect(btn).not.toHaveAttribute('data-priority');
  });

  it('forwards onClick and disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} disabled>Go</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-button.test.tsx`
Expected: FAIL — cannot find module `Button.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/Button.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ButtonHTMLAttributes } from 'react';

export type ButtonTone = 'primary' | 'neutral' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Semantic intent on the action plane. Defaults to 'neutral'. */
  tone?: ButtonTone;
  /** Gold priority overlay ("what you came for"). Ignored for destructive tone. */
  priority?: boolean;
}

/**
 * The action-plane button primitive. Three tones (primary / neutral / destructive)
 * plus a separable gold `priority` overlay. Destructive never wears gold — the
 * safety rule "gold protects, never invites" (spec §4, §5).
 */
export function Button({ tone = 'neutral', priority, className, type, ...rest }: ButtonProps): JSX.Element {
  const isGold = priority === true && tone !== 'destructive';
  return (
    <button
      type={type ?? 'button'}
      data-tone={tone}
      data-priority={isGold ? 'true' : undefined}
      className={`cs-btn${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── Button primitive (action plane) ─────────────────────────────────── */
.cs-btn {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  padding: 10px 22px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-paper);
  cursor: pointer;
  transition: filter 0.15s ease, background 0.15s ease;
}
.cs-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cs-btn[data-tone='primary'] {
  font-weight: 600;
  border-color: color-mix(in srgb, var(--color-aurora-500) 60%, transparent);
  background: linear-gradient(180deg, var(--color-aurora-500), var(--color-aurora-700));
  color: var(--color-paper);
}
.cs-btn[data-tone='destructive'] {
  font-weight: 600;
  border-color: rgba(255, 90, 90, 0.55);
  background: rgba(255, 90, 90, 0.1);
  color: var(--color-destructive-text);
}
.cs-btn[data-priority='true'] {
  font-weight: 600;
  border-color: rgba(232, 192, 97, 0.7);
  background: linear-gradient(180deg, var(--color-gold-hi), var(--color-gold-lo));
  color: #1a1206;
  box-shadow: 0 0 16px rgba(232, 192, 97, 0.3);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-button.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/Button.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-button.test.tsx
git commit -m "Add Button primitive with tones and gold priority overlay"
```

---

### Task 4: Badge primitive

**Files:**
- Create: `apps/user-client/src/components/ui/Badge.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-badge` styles)
- Test: `apps/user-client/tests/component/ui-badge.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'new';
  export interface BadgeProps {
    tone?: BadgeTone;     // default 'neutral'
    count?: number;       // optional notification bubble
    onTile?: boolean;     // use the parked single tile-badge token
    children?: React.ReactNode;
  }
  export function Badge(props: BadgeProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-badge.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../../src/components/ui/Badge.js';

describe('Badge', () => {
  it('renders read-only text and is NOT a button (a badge tells, it never acts)', () => {
    render(<Badge>13 personas</Badge>);
    const el = screen.getByText('13 personas');
    expect(el.tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies the tone via data-tone', () => {
    render(<Badge tone="success">Connected</Badge>);
    expect(screen.getByText('Connected')).toHaveAttribute('data-tone', 'success');
  });

  it('renders a count bubble when count is given', () => {
    render(<Badge count={3}>Inbox</Badge>);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks tile badges so the single tile-badge token applies', () => {
    render(<Badge onTile>13 personas</Badge>);
    expect(screen.getByText('13 personas')).toHaveAttribute('data-on-tile', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-badge.test.tsx`
Expected: FAIL — cannot find module `Badge.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/Badge.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'new';

export interface BadgeProps {
  /** Tone — use only when it MEANS something (status). Defaults to 'neutral'. */
  tone?: BadgeTone;
  /** Optional notification count rendered as a small bubble. */
  count?: number;
  /** Render with the single tile-badge token (kept neutral; spec §6, §10). */
  onTile?: boolean;
  children?: ReactNode;
}

/**
 * Read-only status / count / "NEW" marker. A Badge TELLS; it never acts
 * (no onClick). For interactive chips use Pill instead (spec §6).
 */
export function Badge({ tone = 'neutral', count, onTile, children }: BadgeProps): JSX.Element {
  return (
    <span className="cs-badge" data-tone={tone} data-on-tile={onTile ? 'true' : undefined}>
      {children}
      {typeof count === 'number' ? <span className="cs-badge-count">{count}</span> : null}
    </span>
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── Badge primitive (read-only) ─────────────────────────────────────── */
.cs-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: 11px;
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-paper-soft);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.cs-badge[data-on-tile='true'] { color: var(--badge-tile-tone); }
.cs-badge[data-tone='success'] { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 35%, transparent); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
.cs-badge[data-tone='warning'] { color: var(--color-warning); border-color: color-mix(in srgb, var(--color-warning) 35%, transparent); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
.cs-badge[data-tone='danger'] { color: var(--color-destructive-text); border-color: rgba(255, 90, 90, 0.35); background: rgba(255, 90, 90, 0.12); }
.cs-badge[data-tone='new'] {
  font-size: 9px;
  letter-spacing: 1px;
  font-weight: 700;
  color: #1a1206;
  border: none;
  background: linear-gradient(180deg, var(--color-gold-hi), var(--color-gold-lo));
}
.cs-badge-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  font-size: 9px;
  font-weight: 700;
  border-radius: var(--radius-pill);
  background: var(--color-destructive);
  color: #fff;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-badge.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/Badge.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-badge.test.tsx
git commit -m "Add Badge primitive (read-only status and count marker)"
```

---

### Task 5: Pill primitive

**Files:**
- Create: `apps/user-client/src/components/ui/Pill.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-pill` styles)
- Test: `apps/user-client/tests/component/ui-pill.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PillProps {
    variant?: 'filter' | 'tag' | 'add';  // default 'filter'
    active?: boolean;                     // active state = gold accent
    onClick?: () => void;
    onRemove?: () => void;                // when set, renders a × remove control
    children: React.ReactNode;
  }
  export function Pill(props: PillProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-pill.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pill } from '../../src/components/ui/Pill.js';

describe('Pill', () => {
  it('is interactive (a Pill acts) and fires onClick', () => {
    const onClick = vi.fn();
    render(<Pill onClick={onClick}>Personas</Pill>);
    const pill = screen.getByRole('button', { name: 'Personas' });
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reflects the active state via data-active', () => {
    render(<Pill active>All</Pill>);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('data-active', 'true');
  });

  it('renders a remove control and fires onRemove without firing onClick', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<Pill variant="tag" onClick={onClick} onRemove={onRemove}>#fiction</Pill>);
    fireEvent.click(screen.getByRole('button', { name: /remove #fiction/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-pill.test.tsx`
Expected: FAIL — cannot find module `Pill.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/Pill.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent, ReactNode } from 'react';

export interface PillProps {
  /** Visual role. Defaults to 'filter'. */
  variant?: 'filter' | 'tag' | 'add';
  /** Active state — rendered with the gold accent. */
  active?: boolean;
  onClick?: () => void;
  /** When provided, renders a × control; clicking it removes without selecting. */
  onRemove?: () => void;
  children: ReactNode;
}

/**
 * Interactive chip. A Pill ACTS (filter toggle, removable tag, "+ add"). For
 * read-only status use Badge (spec §6).
 */
export function Pill({ variant = 'filter', active, onClick, onRemove, children }: PillProps): JSX.Element {
  function handleRemove(e: MouseEvent): void {
    e.stopPropagation();
    onRemove?.();
  }
  return (
    <button
      type="button"
      className="cs-pill"
      data-variant={variant}
      data-active={active ? 'true' : undefined}
      onClick={onClick}
    >
      <span>{children}</span>
      {onRemove ? (
        <span
          className="cs-pill-x"
          role="button"
          tabIndex={0}
          aria-label={`Remove ${typeof children === 'string' ? children : 'tag'}`}
          onClick={handleRemove}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleRemove(e as unknown as MouseEvent);
          }}
        >
          ×
        </span>
      ) : null}
    </button>
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── Pill primitive (interactive chip) ───────────────────────────────── */
.cs-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 11px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-paper-soft);
  border: 1px solid rgba(255, 255, 255, 0.14);
  cursor: pointer;
}
.cs-pill[data-active='true'] {
  color: #f0dca0;
  background: linear-gradient(180deg, rgba(232, 192, 97, 0.22), rgba(232, 192, 97, 0.08));
  border-color: rgba(232, 192, 97, 0.55);
  box-shadow: 0 0 10px rgba(232, 192, 97, 0.18);
}
.cs-pill[data-variant='tag'] {
  color: var(--color-nav-purple);
  background: color-mix(in srgb, var(--color-nav-purple) 14%, transparent);
  border-color: color-mix(in srgb, var(--color-nav-purple) 40%, transparent);
}
.cs-pill[data-variant='add'] { border-style: dashed; background: transparent; }
.cs-pill-x { opacity: 0.7; font-size: 13px; line-height: 1; cursor: pointer; }
.cs-pill-x:hover { opacity: 1; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-pill.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/Pill.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-pill.test.tsx
git commit -m "Add Pill primitive (interactive filter and tag chip)"
```

---

### Task 6: OverflowMenu primitive (the ⋯ context menu)

**Files:**
- Create: `apps/user-client/src/components/ui/OverflowMenu.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-overflow*` styles)
- Test: `apps/user-client/tests/component/ui-overflow-menu.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface OverflowItem {
    label: string;
    onSelect?: () => void;
    disabled?: boolean;
    disabledReason?: string;       // announced via aria-describedby (HARD-2)
    tone?: 'default' | 'destructive';
  }
  export interface OverflowMenuProps {
    items: OverflowItem[];
    triggerLabel?: string;         // accessible name for the ⋯ trigger; default "More actions"
  }
  export function OverflowMenu(props: OverflowMenuProps): JSX.Element;
  ```
- Consumed by: ListRow (Task 7).
- Consumes: `computeTransformOrigin` (Task 2), `.cs-zoom-in` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-overflow-menu.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverflowMenu } from '../../src/components/ui/OverflowMenu.js';

describe('OverflowMenu', () => {
  it('opens on trigger click and lists every action', () => {
    render(<OverflowMenu items={[{ label: 'Rename' }, { label: 'Delete', tone: 'destructive' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('fires onSelect for an enabled item and closes', () => {
    const onSelect = vi.fn();
    render(<OverflowMenu items={[{ label: 'Rename', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('shows disabled items as focusable with an announced reason and does NOT fire onSelect (HARD-2)', () => {
    const onSelect = vi.fn();
    render(
      <OverflowMenu items={[{ label: 'Pin', onSelect, disabled: true, disabledReason: 'Needs sync' }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    const item = screen.getByRole('menuitem', { name: /pin/i });
    expect(item.tagName).toBe('BUTTON'); // focusable, not a non-focusable div
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).not.toBeDisabled(); // aria-disabled, not the native attribute (stays tabbable)
    const reasonId = item.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId as string)?.textContent).toMatch(/needs sync/i);
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<OverflowMenu items={[{ label: 'Rename' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-overflow-menu.test.tsx`
Expected: FAIL — cannot find module `OverflowMenu.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/OverflowMenu.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';

export interface OverflowItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Announced via aria-describedby when the item is disabled (spec §7, HARD-2). */
  disabledReason?: string;
  tone?: 'default' | 'destructive';
}

export interface OverflowMenuProps {
  items: OverflowItem[];
  /** Accessible name for the ⋯ trigger. Defaults to "More actions". */
  triggerLabel?: string;
}

/**
 * The ⋯ context-menu primitive. Secondary actions live here so list rows stay
 * calm; the menu is where "disabled over hidden" holds — disabled items remain
 * focusable (aria-disabled, not native disabled) and announce their reason
 * (spec §7). Appears via the origin-aware zoom (spec §3).
 */
export function OverflowMenu({ items, triggerLabel = 'More actions' }: OverflowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reasonBase = useId();

  useEffect(() => {
    if (!open) return undefined;
    // Zoom out of the trigger (Unified-Experience motion).
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (menu && trigger) {
      const stage = menu.offsetParent as HTMLElement | null;
      if (stage) {
        menu.style.transformOrigin = computeTransformOrigin(
          trigger.getBoundingClientRect(),
          stage.getBoundingClientRect(),
        );
      }
    }
    const onOutside = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function activate(item: OverflowItem): void {
    if (item.disabled) return; // aria-disabled: no-op rather than removed from tab order
    item.onSelect?.();
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="cs-overflow">
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="cs-overflow-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open ? (
        <div ref={menuRef} role="menu" className="cs-overflow-menu cs-zoom-in">
          {items.map((item, i) => {
            const reasonId = item.disabled && item.disabledReason ? `${reasonBase}-${i}` : undefined;
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: menu items are a stable, caller-ordered list
                key={i}
                type="button"
                role="menuitem"
                className="cs-overflow-item"
                data-tone={item.tone ?? 'default'}
                aria-disabled={item.disabled ? 'true' : undefined}
                aria-describedby={reasonId}
                onClick={() => activate(item)}
              >
                <span>{item.label}</span>
                {reasonId ? (
                  <span id={reasonId} className="cs-overflow-reason">
                    {item.disabledReason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── OverflowMenu primitive (⋯ context menu) ─────────────────────────── */
.cs-overflow { position: relative; display: inline-flex; }
.cs-overflow-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-paper-soft);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.cs-overflow-trigger:hover { background: rgba(255, 255, 255, 0.05); }
.cs-overflow-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 180px;
  padding: 6px;
  border-radius: 14px;
  background: radial-gradient(120% 90% at 80% -10%, #21123f, #0a0518);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
}
.cs-overflow-item {
  display: block;
  width: 100%;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 9px 11px;
  border-radius: 9px;
  background: transparent;
  border: none;
  color: var(--color-paper);
  cursor: pointer;
}
.cs-overflow-item:hover { background: rgba(255, 255, 255, 0.05); }
.cs-overflow-item[data-tone='destructive'] { color: var(--color-destructive-text); }
.cs-overflow-item[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
.cs-overflow-reason { display: block; font-size: 10px; opacity: 0.7; margin-top: 2px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-overflow-menu.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/OverflowMenu.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-overflow-menu.test.tsx
git commit -m "Add OverflowMenu primitive with focusable disabled-with-reason items"
```

---

### Task 7: ListRow primitive

**Files:**
- Create: `apps/user-client/src/components/ui/ListRow.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-row*` styles)
- Test: `apps/user-client/tests/component/ui-list-row.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  import type { OverflowItem } from './OverflowMenu.js';
  export interface ListRowProps {
    leading?: React.ReactNode;       // ① avatar / icon
    title: string;                   // ② body — primary
    subtitle?: string;               // ② body — secondary
    trailing?: React.ReactNode;      // ③ badge(s)
    onOpen?: () => void;             // row tap = primary action
    overflow?: OverflowItem[];       // when set, a ⋯ menu renders in the trailing slot
  }
  export function ListRow(props: ListRowProps): JSX.Element;
  ```
- Consumes: `OverflowMenu`, `OverflowItem` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-list-row.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../../src/components/ui/Badge.js';
import { ListRow } from '../../src/components/ui/ListRow.js';

describe('ListRow', () => {
  it('renders the three slots', () => {
    render(
      <ListRow
        leading={<span>AV</span>}
        title="Fable"
        subtitle="flagship companion"
        trailing={<Badge>42 chats</Badge>}
      />,
    );
    expect(screen.getByText('AV')).toBeInTheDocument();
    expect(screen.getByText('Fable')).toBeInTheDocument();
    expect(screen.getByText('flagship companion')).toBeInTheDocument();
    expect(screen.getByText('42 chats')).toBeInTheDocument();
  });

  it('fires onOpen when the row is tapped', () => {
    const onOpen = vi.fn();
    render(<ListRow title="Fable" onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Fable'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opening the ⋯ menu does not trigger the row onOpen', () => {
    const onOpen = vi.fn();
    render(<ListRow title="Fable" onOpen={onOpen} overflow={[{ label: 'Rename' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-list-row.test.tsx`
Expected: FAIL — cannot find module `ListRow.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/ListRow.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { OverflowMenu, type OverflowItem } from './OverflowMenu.js';

export interface ListRowProps {
  /** ① Leading slot — avatar / icon / symbol. */
  leading?: ReactNode;
  /** ② Body — primary line. */
  title: string;
  /** ② Body — secondary line. */
  subtitle?: string;
  /** ③ Trailing slot — badge(s). */
  trailing?: ReactNode;
  /** Tapping the row performs the primary action (open). */
  onOpen?: () => void;
  /** Secondary actions; when present a ⋯ menu renders in the trailing slot. */
  overflow?: OverflowItem[];
}

/**
 * The unified list row: ① Leading · ② Body · ③ Trailing (spec §7). Tapping the
 * row opens; secondary actions live in the ⋯ overflow menu (clicks inside the
 * trailing controls do not bubble to the row's onOpen).
 */
export function ListRow({ leading, title, subtitle, trailing, onOpen, overflow }: ListRowProps): JSX.Element {
  return (
    <div className="cs-row">
      <button type="button" className="cs-row-main" onClick={onOpen}>
        {leading ? <span className="cs-row-leading">{leading}</span> : null}
        <span className="cs-row-body">
          <span className="cs-row-title">{title}</span>
          {subtitle ? <span className="cs-row-subtitle">{subtitle}</span> : null}
        </span>
      </button>
      {(trailing || overflow) && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a non-interactive wrapper that only stops bubbling; its children carry the semantics
        <span className="cs-row-trailing" onClick={(e) => e.stopPropagation()}>
          {trailing}
          {overflow && overflow.length > 0 ? <OverflowMenu items={overflow} /> : null}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── ListRow primitive (unified row anatomy) ─────────────────────────── */
.cs-row { display: flex; align-items: center; gap: 8px; border-radius: 13px; padding-right: 6px; }
.cs-row:hover { background: rgba(255, 255, 255, 0.03); }
.cs-row-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  padding: 10px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.cs-row-leading { flex: none; display: inline-flex; }
.cs-row-body { display: flex; flex-direction: column; min-width: 0; }
.cs-row-title { font-family: var(--font-sans); font-weight: 600; font-size: 13px; color: var(--color-paper); }
.cs-row-subtitle { font-family: var(--font-sans); font-size: 11px; color: var(--color-paper-soft); opacity: 0.7; }
.cs-row-trailing { display: inline-flex; align-items: center; gap: 8px; flex: none; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-list-row.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/ListRow.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-list-row.test.tsx
git commit -m "Add ListRow primitive (Leading/Body/Trailing with overflow menu)"
```

---

### Task 8: ListScaffold primitive (fixed header + scroll region + footer; back control)

**Files:**
- Create: `apps/user-client/src/components/ui/ListScaffold.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-scaffold*` styles)
- Test: `apps/user-client/tests/component/ui-list-scaffold.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface ListScaffoldProps {
    title: React.ReactNode;
    count?: number;                 // shown after the title (e.g. "My Circle · 13")
    onBack: () => void;             // §3.4 back control — always present, fixed position
    onHelp?: () => void;            // optional (?) affordance
    footer?: React.ReactNode;       // fixed footer (e.g. gold "+ New") — stays put
    isEmpty?: boolean;              // when true, render `empty` instead of children
    empty?: React.ReactNode;        // constructive empty-state content (spec §7)
    children: React.ReactNode;      // the scrolling list region — ONLY this scrolls
  }
  export function ListScaffold(props: ListScaffoldProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-list-scaffold.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListScaffold } from '../../src/components/ui/ListScaffold.js';

describe('ListScaffold', () => {
  it('renders a back control with an accessible name and fires onBack', () => {
    const onBack = vi.fn();
    render(
      <ListScaffold title="My Circle" onBack={onBack}>
        <div>rows</div>
      </ListScaffold>,
    );
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows the title with count and a fixed footer', () => {
    render(
      <ListScaffold title="My Circle" count={13} onBack={() => {}} footer={<button type="button">+ New</button>}>
        <div>rows</div>
      </ListScaffold>,
    );
    expect(screen.getByText('My Circle')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
  });

  it('renders the constructive empty state instead of children when empty', () => {
    render(
      <ListScaffold title="My Circle" onBack={() => {}} isEmpty empty={<p>No personas yet — create your first</p>}>
        <div>rows</div>
      </ListScaffold>,
    );
    expect(screen.getByText(/no personas yet/i)).toBeInTheDocument();
    expect(screen.queryByText('rows')).not.toBeInTheDocument();
  });

  it('puts only the list in the scroll region (header and footer are siblings of it)', () => {
    const { container } = render(
      <ListScaffold title="My Circle" onBack={() => {}} footer={<span>foot</span>}>
        <div>rows</div>
      </ListScaffold>,
    );
    const scroll = container.querySelector('.cs-scaffold-scroll');
    expect(scroll).toBeTruthy();
    expect(scroll?.textContent).toContain('rows');
    expect(scroll?.textContent).not.toContain('foot'); // footer is outside the scroll region
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-list-scaffold.test.tsx`
Expected: FAIL — cannot find module `ListScaffold.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/ListScaffold.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

export interface ListScaffoldProps {
  title: ReactNode;
  /** Shown after the title (e.g. "My Circle · 13"). */
  count?: number;
  /** The always-present, fixed-position back control (spec §3.4). */
  onBack: () => void;
  /** Optional (?) help affordance. */
  onHelp?: () => void;
  /** Fixed footer (e.g. a gold "+ New" primary action) — never scrolls. */
  footer?: ReactNode;
  /** When true, render `empty` in place of `children`. */
  isEmpty?: boolean;
  /** Constructive empty-state content (spec §7). */
  empty?: ReactNode;
  /** The scrolling list region — the ONLY part that scrolls. */
  children: ReactNode;
}

/**
 * List page scaffold: a fixed header (back control left, title centre, optional
 * ? right), a single scrolling region, and a fixed footer. Only the list region
 * scrolls — header and footer stay put (spec §7). The back control is always
 * visible in a constant position (spec §3.4); no surface is a dead-end.
 */
export function ListScaffold({
  title,
  count,
  onBack,
  onHelp,
  footer,
  isEmpty,
  empty,
  children,
}: ListScaffoldProps): JSX.Element {
  return (
    <div className="cs-scaffold">
      <header className="cs-scaffold-header">
        <button type="button" aria-label="Back" className="cs-scaffold-back" onClick={onBack}>
          ←
        </button>
        <h2 className="cs-scaffold-title">
          {title}
          {typeof count === 'number' ? <span className="cs-scaffold-count"> · {count}</span> : null}
        </h2>
        {onHelp ? (
          <button type="button" aria-label="Help" className="cs-scaffold-help" onClick={onHelp}>
            ?
          </button>
        ) : (
          <span className="cs-scaffold-help-spacer" aria-hidden="true" />
        )}
      </header>
      <div className="cs-scaffold-scroll">{isEmpty ? empty : children}</div>
      {footer ? <footer className="cs-scaffold-footer">{footer}</footer> : null}
    </div>
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── ListScaffold primitive (fixed header/footer; only list scrolls) ──── */
.cs-scaffold { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cs-scaffold-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex: none;
}
.cs-scaffold-back,
.cs-scaffold-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--color-paper-soft);
  cursor: pointer;
}
.cs-scaffold-help-spacer { width: 40px; height: 40px; }
.cs-scaffold-title { margin: 0; font-size: 16px; color: var(--color-paper); }
.cs-scaffold-count { color: var(--color-paper-soft); }
.cs-scaffold-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
.cs-scaffold-footer { flex: none; padding: 10px 14px 14px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-list-scaffold.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/ListScaffold.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-list-scaffold.test.tsx
git commit -m "Add ListScaffold primitive with fixed back control and scroll region"
```

---

### Task 9: ConfirmDialog primitive

**Files:**
- Create: `apps/user-client/src/components/ui/ConfirmDialog.tsx`
- Modify: `apps/user-client/src/index.css` (append `.cs-dialog*` styles)
- Test: `apps/user-client/tests/component/ui-confirm-dialog.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    body?: React.ReactNode;
    confirmLabel: string;            // e.g. "Save" / "Delete"
    cancelLabel?: string;            // default "Cancel"
    destructive?: boolean;           // gold→cancel(safe), red→confirm, red title (spec §5)
    onConfirm: () => void;
    onCancel: () => void;
    triggerRef?: React.RefObject<HTMLElement>;  // origin for the zoom (spec §3)
  }
  export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null;
  ```
- Consumes: `Button` (Task 3), `computeTransformOrigin` (Task 2), `.cs-zoom-in` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/ui-confirm-dialog.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/components/ui/ConfirmDialog.js';

const base = {
  title: 'Save changes?',
  confirmLabel: 'Save',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...base} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('non-destructive: the confirm button wears the gold priority overlay', () => {
    render(<ConfirmDialog {...base} open />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('data-tone', 'primary');
    expect(save).toHaveAttribute('data-priority', 'true');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('data-tone', 'neutral');
  });

  it('destructive: gold moves to the safe choice, confirm is red, title is marked destructive', () => {
    render(
      <ConfirmDialog {...base} open destructive title="Delete Fable?" confirmLabel="Delete" cancelLabel="Keep" />,
    );
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toHaveAttribute('data-tone', 'destructive');
    expect(del).not.toHaveAttribute('data-priority'); // gold never invites destruction
    const keep = screen.getByRole('button', { name: 'Keep' });
    expect(keep).toHaveAttribute('data-priority', 'true'); // gold protects the safe choice
    expect(screen.getByText('Delete Fable?')).toHaveAttribute('data-destructive', 'true');
  });

  it('fires onConfirm and onCancel; backdrop click maps to cancel (the safe path)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    const backdrop = container.querySelector('.cs-dialog-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-confirm-dialog.test.tsx`
Expected: FAIL — cannot find module `ConfirmDialog.js`.

- [ ] **Step 3: Write the component**

Create `apps/user-client/src/components/ui/ConfirmDialog.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useEffect, useRef } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';
import { Button } from './Button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive: gold→safe choice, red→confirm, red title (spec §5). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Element the dialog should zoom out of (spec §3). */
  triggerRef?: React.RefObject<HTMLElement>;
}

/**
 * The single, uniform confirmation/query dialog (spec §5). Layout A: secondary
 * left, gold action right. For destructive prompts the colour roles swap — gold
 * protects the safe choice, red stays on the destructive action, and the title
 * is marked so it is re-read rather than thumb-reflexed (Laura SOFT-1). Appears
 * via the Unified-Experience zoom and dismisses to the safe path on backdrop tap.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
  triggerRef,
}: ConfirmDialogProps): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const card = cardRef.current;
    const trigger = triggerRef?.current;
    if (card && trigger) {
      const stage = card.offsetParent as HTMLElement | null;
      if (stage) {
        card.style.transformOrigin = computeTransformOrigin(
          trigger.getBoundingClientRect(),
          stage.getBoundingClientRect(),
        );
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, triggerRef, onCancel]);

  if (!open) return null;

  return (
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={title}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape is handled on document */}
      <div className="cs-dialog-backdrop" onClick={onCancel} />
      <div ref={cardRef} className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title" data-destructive={destructive ? 'true' : undefined}>
          {title}
        </div>
        {body ? <div className="cs-dialog-body">{body}</div> : null}
        <div className="cs-dialog-actions">
          <Button tone={destructive ? 'primary' : 'neutral'} priority={destructive} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button tone={destructive ? 'destructive' : 'primary'} priority={!destructive} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append the component CSS**

At the end of `apps/user-client/src/index.css`, append:

```css
/* ── ConfirmDialog primitive (uniform confirmation) ──────────────────── */
.cs-dialog-root { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 20px; }
.cs-dialog-backdrop { position: absolute; inset: 0; background: rgba(5, 2, 16, 0.6); animation: cs-fade-in 0.2s ease both; }
.cs-dialog-card {
  position: relative;
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
  padding: 16px;
  background: radial-gradient(120% 90% at 50% -10%, #21123f, #0a0518);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.cs-dialog-card:has(.cs-dialog-title[data-destructive='true']) { border-color: rgba(255, 90, 90, 0.2); }
.cs-dialog-title { font-family: var(--font-display); font-size: 15px; color: var(--color-paper); margin-bottom: 4px; }
.cs-dialog-title[data-destructive='true'] { color: var(--color-destructive-text); }
.cs-dialog-body { font-family: var(--font-sans); font-size: 12px; color: var(--color-paper-soft); opacity: 0.8; margin-bottom: 14px; }
.cs-dialog-actions { display: flex; gap: 10px; }
.cs-dialog-actions > .cs-btn { flex: 1; padding: 10px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-confirm-dialog.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/ConfirmDialog.tsx apps/user-client/src/index.css apps/user-client/tests/component/ui-confirm-dialog.test.tsx
git commit -m "Add ConfirmDialog primitive (uniform layout, gold-protects safety)"
```

---

### Task 10: Showcase route + barrel export

**Files:**
- Create: `apps/user-client/src/components/ui/index.ts` (barrel)
- Create: `apps/user-client/src/routes/app/ui-showcase.tsx`
- Modify: `apps/user-client/src/App.tsx` (add the route)
- Test: `apps/user-client/tests/component/ui-showcase.test.tsx`

**Interfaces:**
- Consumes: every primitive (Tasks 3–9).
- Produces: the route `/app/ui-showcase` (internal; the live successor to `chatsundere-prototype.html`).

- [ ] **Step 1: Write the barrel export**

Create `apps/user-client/src/components/ui/index.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
export { Button, type ButtonProps, type ButtonTone } from './Button.js';
export { Badge, type BadgeProps, type BadgeTone } from './Badge.js';
export { Pill, type PillProps } from './Pill.js';
export { OverflowMenu, type OverflowMenuProps, type OverflowItem } from './OverflowMenu.js';
export { ListRow, type ListRowProps } from './ListRow.js';
export { ListScaffold, type ListScaffoldProps } from './ListScaffold.js';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog.js';
```

- [ ] **Step 2: Write the failing test**

Create `apps/user-client/tests/component/ui-showcase.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UiShowcase } from '../../src/routes/app/ui-showcase.js';

describe('UiShowcase', () => {
  it('renders the primitive sections', () => {
    render(
      <MemoryRouter>
        <UiShowcase />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Buttons/i)).toBeInTheDocument();
    expect(screen.getByText(/Badges/i)).toBeInTheDocument();
    expect(screen.getByText(/Pills/i)).toBeInTheDocument();
    expect(screen.getByText(/List/i)).toBeInTheDocument();
  });

  it('opens the confirmation dialog from its trigger', () => {
    render(
      <MemoryRouter>
        <UiShowcase />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    screen.getByRole('button', { name: /open save dialog/i }).click();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-showcase.test.tsx`
Expected: FAIL — cannot find module `ui-showcase.js`.

- [ ] **Step 4: Write the showcase route**

Create `apps/user-client/src/routes/app/ui-showcase.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { ListRow } from '../../components/ui/ListRow.js';
import { ListScaffold } from '../../components/ui/ListScaffold.js';
import { Pill } from '../../components/ui/Pill.js';

/**
 * Internal showcase of every design-language primitive — the live successor to
 * chatsundere-prototype.html. Reached at /app/ui-showcase. Not user-facing; the
 * device-test surface for the makeover foundation.
 */
export function UiShowcase(): JSX.Element {
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  return (
    <main className="mx-auto max-w-[420px] p-4">
      <h1 className="mb-4">UI primitives</h1>

      <section className="mb-6">
        <h3 className="mb-2">Buttons</h3>
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" priority>Save (gold)</Button>
          <Button tone="neutral">Cancel</Button>
          <Button tone="destructive">Delete</Button>
          <Button tone="primary">Primary</Button>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Badges</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>13 personas</Badge>
          <Badge tone="success">Connected</Badge>
          <Badge tone="warning">Reconnecting</Badge>
          <Badge tone="danger">Offline</Badge>
          <Badge tone="new">NEW</Badge>
          <Badge count={3}>Inbox</Badge>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Pills</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>All</Pill>
          <Pill active={filter === 'personas'} onClick={() => setFilter('personas')}>Personas</Pill>
          <Pill variant="tag" onRemove={() => {}}>#fiction</Pill>
          <Pill variant="add">+ Tag</Pill>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Dialogs</h3>
        <div className="flex flex-wrap gap-2">
          <Button ref={saveTrigger} tone="primary" priority onClick={() => setSaveOpen(true)}>
            Open save dialog
          </Button>
          <Button ref={deleteTrigger} tone="destructive" onClick={() => setDeleteOpen(true)}>
            Open delete dialog
          </Button>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">List (only the rows scroll)</h3>
        <div className="h-[280px] overflow-hidden rounded-2xl border border-white/10">
          <ListScaffold
            title="My Circle"
            count={3}
            onBack={() => {}}
            onHelp={() => {}}
            footer={<Button tone="primary" priority className="w-full">+ New persona</Button>}
          >
            <ListRow
              leading={<span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-700">F</span>}
              title="Fable"
              subtitle="flagship companion"
              trailing={<Badge tone="success">active</Badge>}
              onOpen={() => {}}
              overflow={[
                { label: 'New chat' },
                { label: 'New incognito chat' },
                { label: 'Pin', disabled: true, disabledReason: 'Pinning lands next round' },
                { label: 'Delete', tone: 'destructive' },
              ]}
            />
            <ListRow leading={<span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-700">L</span>} title="Lyra" subtitle="design sparring" trailing={<Badge>8 chats</Badge>} onOpen={() => {}} />
            <ListRow leading={<span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-700">N</span>} title="Nova" subtitle="research analyst" trailing={<Badge>12 chats</Badge>} onOpen={() => {}} />
          </ListScaffold>
        </div>
      </section>

      <ConfirmDialog
        open={saveOpen}
        title="Save changes?"
        body="Your edit to Fable will be applied."
        confirmLabel="Save"
        onConfirm={() => setSaveOpen(false)}
        onCancel={() => setSaveOpen(false)}
        triggerRef={saveTrigger}
      />
      <ConfirmDialog
        open={deleteOpen}
        destructive
        title="Delete Fable?"
        body="All chats and memories are lost for good."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={() => setDeleteOpen(false)}
        onCancel={() => setDeleteOpen(false)}
        triggerRef={deleteTrigger}
      />
    </main>
  );
}
```

> Note: `Button` forwards refs because it spreads `ButtonHTMLAttributes` onto a real `<button>` — but a plain function component does **not** accept `ref` by default. Add ref-forwarding in Step 5 so `saveTrigger`/`deleteTrigger` work.

- [ ] **Step 5: Make Button forward its ref**

Edit `apps/user-client/src/components/ui/Button.tsx` to wrap the component in `forwardRef`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { type ButtonHTMLAttributes, forwardRef } from 'react';

export type ButtonTone = 'primary' | 'neutral' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  priority?: boolean;
}

/**
 * The action-plane button primitive. Three tones (primary / neutral / destructive)
 * plus a separable gold `priority` overlay. Destructive never wears gold — the
 * safety rule "gold protects, never invites" (spec §4, §5).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = 'neutral', priority, className, type, ...rest },
  ref,
): JSX.Element {
  const isGold = priority === true && tone !== 'destructive';
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      data-tone={tone}
      data-priority={isGold ? 'true' : undefined}
      className={`cs-btn${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
});
```

- [ ] **Step 6: Add the route**

In `apps/user-client/src/App.tsx`, add the import (alphabetical, after the `Treasury` import on line 18):

```tsx
import { UiShowcase } from './routes/app/ui-showcase.js';
```

And add the route inside the `ProtectedRoute` block (after the `/app/account` route, line 108):

```tsx
                  <Route path="/app/ui-showcase" element={<UiShowcase />} />
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/component/ui-showcase.test.tsx tests/component/ui-button.test.tsx`
Expected: PASS (showcase 2 tests + button 5 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/components/ui/index.ts apps/user-client/src/components/ui/Button.tsx apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/src/App.tsx apps/user-client/tests/component/ui-showcase.test.tsx
git commit -m "Add UI primitive barrel and internal showcase route"
```

---

### Task 11: Final gate + STATUS update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (Current section + Last updated line)

- [ ] **Step 1: Run the full user-client test suite**

Run: `cd apps/user-client && pnpm vitest run`
Expected: all new `ui-*` suites green; total failures = the documented **8 Node-localStorage baseline** only. Any 9th failure must be investigated before proceeding.

- [ ] **Step 2: Run the typecheck gate (forced — turbo caches)**

Run: `cd /home/chris/workspace/chatsundere && pnpm typecheck --force`
Expected: PASS (14/14 packages).

- [ ] **Step 3: Lint**

Run: `cd /home/chris/workspace/chatsundere && pnpm lint`
Expected: PASS (no Biome errors in the new files).

- [ ] **Step 4: Update STATUS**

In `obsidian/STATUS-CLIENT-ONLY.md`, add a new **Current** entry summarising: design-language foundations landed (tokens + motion + 7 primitives + showcase at `/app/ui-showcase`), built spec→plan→subagent-driven, Laura spec-pass folded in, gate results. Refresh the `Last updated:` line. Note the next slice: **main-menu rebuild** consuming these primitives.

- [ ] **Step 5: Commit**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Update STATUS: design-language foundations landed [skip ci]"
```

---

## Self-Review

**Spec coverage:**
- §2 colour model → Task 1 tokens (nav hues, gold, destructive, tile-badge token). ✓
- §2.4 ascension order → a *layout* property of the main-menu screen (next plan); tokens exist here. ✓ (screen consumes them)
- §3 motion language (origin-aware zoom, enter/exit timings, tile blink, reduced-motion) → Task 1 keyframes + Task 2 origin helper; consumed by Tasks 6 & 9. ✓
- §3.4 back control → Task 8 ListScaffold (always-visible back). ✓
- §4 Button (3 tones + gold overlay, destructive never gold) → Task 3. ✓
- §5 ConfirmDialog (layout A, gold-protects, red title, backdrop→safe) → Task 9. ✓
- §6 Badge/Pill split + tile-badge token + tones → Tasks 4, 5, 1. ✓
- §7 List paradigm (slots, ⋯ overflow, disabled-with-reason focusable, fixed header/footer only-list-scrolls, empty contract) → Tasks 6, 7, 8. ✓
- §8 implementation notes (tokens in @theme, data-* pattern, CSS-only motion, reduced-motion, showcase route) → throughout + Task 10. ✓
- §9/§10 deferred + parked → showcase demonstrates the parked Pin (disabled-with-reason) and incognito-chat overflow items; not built as features. ✓ (deferred items intentionally absent)
- §11 manual verification → Task 11 device checklist references the spec. ✓

**Placeholder scan:** No TBD/TODO in steps; every code step shows complete code. ✓

**Type consistency:** `OverflowItem` defined in Task 6, imported by Task 7 and used in Task 10 with the same shape (`label/onSelect/disabled/disabledReason/tone`). `ButtonProps` extended to `forwardRef` in Task 10 Step 5 keeps the same prop names. `computeTransformOrigin(trigger, stage)` signature identical in Tasks 2, 6, 9. ✓

**Note on consolidation (spec §6):** folding the existing `InlineMarker`/chat `Pill` under the new Badge/Pill standard is explicitly *later* per the spec and is **not** in this plan — flagged here so it is not mistaken for a gap.
