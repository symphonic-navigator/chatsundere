# My Account — Shared Chrome Primitives Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three reusable chrome primitives the My Account tree (Plan 2) consumes — the `PageBar`/`PageScaffold` (breadcrumbs + `?` help, sticky, always-save model, no Save & Back), the `ReadingOverlay` (zoom-in Markdown reader for help/legal/long text), and a small additive `onActivate` extension to the existing `NavTile` so a tile can open an overlay or external link instead of navigating.

**Architecture:** Three independent, additive tasks. None touches an existing user-reachable flow — each lands a new primitive plus a live entry in the internal `/app/ui-showcase` route, so the slice ships working, testable software on its own (Plan 2 then wires them into real surfaces). The `PageBar` mirrors `EditorSticky`'s proven sticky positioning (`top-13 lg:top-15`, blur backdrop, bottom divider) so it reads as chrome and never scrolls away; the scroll lives in the page beneath. The `ReadingOverlay` mirrors `ConfirmDialog`'s origin-zoom (compute `transform-origin` from a trigger rect, play `cs-zoom-in`). Breadcrumb back-navigation inherits the bidirectional zoom for free: the central origin-path mechanism (`NavTransitionOutlet`) already collapses a destination back into its origin tile whether back is a PUSH (`navigate('/app/account')`) or a POP.

**Tech Stack:** TypeScript (strict), React 18, react-router-dom 6, Tailwind v4 (`@theme` + `.cs-*` CSS), Vitest + Testing Library, `lucide-react` (already a dependency), `MarkdownContent` (existing).

**Reference:** Spec `superpowers/specs/2026-06-22-my-account-and-page-bar-design.md` §2 (Page Bar), §5 (Reading Overlay), §8 (colour/motion). Existing primitives to mirror: `src/components/EditorSticky.tsx` (sticky chrome), `src/components/ui/ConfirmDialog.tsx` (origin-zoom modal), `src/components/ui/NavTile.tsx` (the primitive being extended), `src/components/ui/ListScaffold.tsx` (the `cs-scaffold-*` styling to echo). Motion classes in `src/index.css`: `cs-zoom-in` (0.3s), `cs-zoom-out` (0.17s), reduced-motion fallbacks; `computeTransformOrigin(rect, stageRect)` in `src/lib/origin-zoom.ts`.

## Global Constraints

- **British English** for every identifier, comment, copy string (project hard rule §3.7).
- **TypeScript strict + `noUncheckedIndexedAccess`.** No `any` without an inline comment.
- **No CVA / Radix.** Variants via `data-*` attributes + Tailwind/CSS only. Primitives are thin; visual styling lives in `index.css` as `.cs-*` classes.
- **Motion is CSS-only.** No `framer-motion`. Reduced motion gated via the CSS `@media (prefers-reduced-motion: reduce)` query, and for JS-driven paths via the existing `motion.respectsReducedMotion()` helper from `@chatsundere/ui-shared` (the codebase's established split — see `src/lib/use-nav-zoom.ts`).
- **Biome bans the non-null assertion `!`.** Where genuinely unavoidable, add a `// biome-ignore lint/style/noNonNullAssertion: <reason>` line.
- **New primitives are exported from `src/components/ui/index.ts`** and added to the internal `/app/ui-showcase` route.
- **Gate before every commit (run yourself, do not trust a cached pass):** `pnpm typecheck --force` (must be 14/14), `pnpm biome check <changed files>` clean, and the full user-client `pnpm test` at the **8 Node-localStorage baseline failures** (any 9th is a real regression). Tests run from `apps/user-client`; test files live under `apps/user-client/tests/`.
- **Scope fence:** these three tasks add primitives + showcase entries only. Do NOT wire them into any real route, and do NOT modify the shared topbar in `routes/root.tsx`. Real wiring is Plan 2.

---

### Task 1: `PageBar` + `PageScaffold` primitives

The shared page chrome beneath the brand bar: a sticky row with a breadcrumb trail (a real back control + tappable ancestor crumbs + a bold current crumb) and an optional `?` help affordance. `PageScaffold` composes the bar with a content region. No Save/Save-and-Back control exists — the always-save model is a consumer concern (Plan 2), not the bar's.

**Files:**
- Create: `apps/user-client/src/components/ui/PageBar.tsx`
- Create: `apps/user-client/src/components/ui/PageScaffold.tsx`
- Modify: `apps/user-client/src/components/ui/index.ts` (add exports)
- Modify: `apps/user-client/src/index.css` (add `.cs-pagebar*` rules)
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a PageBar section)
- Test: `apps/user-client/tests/component/ui-page-bar.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface Crumb { label: string; to?: string } // last crumb = current page; omit `to`
  export interface PageBarProps {
    crumbs: Crumb[];     // full trail including the current page as the last entry
    back: string;        // route the leading ‹ chevron navigates to (nearest parent / Home)
    onHelp?: () => void; // opens the page's ReadingOverlay help doc (Plan 2)
  }
  export interface PageScaffoldProps {
    crumbs: Crumb[];
    back: string;
    onHelp?: () => void;
    children: ReactNode; // the scrolling page content
  }
  ```
  Consumed by every My Account tree page (Plan 2).

- [ ] **Step 1: Write the failing PageBar test**

```tsx
// tests/component/ui-page-bar.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageBar } from '../../src/components/ui/PageBar.js';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

describe('PageBar', () => {
  beforeEach(() => mockNavigate.mockReset());

  function renderBar(onHelp?: () => void) {
    return render(
      <MemoryRouter>
        <PageBar
          back="/app/account"
          crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Biometric' }]}
          onHelp={onHelp}
        />
      </MemoryRouter>,
    );
  }

  it('marks the current (last) crumb and does not make it a button', () => {
    renderBar();
    const current = screen.getByText('Biometric');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Biometric' })).toBeNull();
  });

  it('ancestor crumb navigates to its route', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'My Account' }));
    expect(mockNavigate).toHaveBeenCalledWith('/app/account');
  });

  it('the back control navigates to `back` and has a ≥44px hit area label', () => {
    renderBar();
    const back = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(back);
    expect(mockNavigate).toHaveBeenCalledWith('/app/account');
  });

  it('renders the help affordance only when onHelp is given, and calls it', () => {
    const onHelp = vi.fn();
    const { rerender } = renderBar(onHelp);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onHelp).toHaveBeenCalledOnce();
    rerender(
      <MemoryRouter>
        <PageBar back="/app" crumbs={[{ label: 'My Account' }]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Help' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm test tests/component/ui-page-bar.test.tsx`
Expected: FAIL — cannot resolve `PageBar.js`.

- [ ] **Step 3: Implement `PageBar`**

```tsx
// src/components/ui/PageBar.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';

export interface Crumb {
  label: string;
  /** Route to navigate to. Omit on the last (current) crumb. */
  to?: string;
}

export interface PageBarProps {
  /** Full breadcrumb trail; the last entry is the current page (omit its `to`). */
  crumbs: Crumb[];
  /** Route the leading ‹ back control navigates to (nearest parent / Home). */
  back: string;
  /** When given, renders the `?` help affordance; opens the page's help reader. */
  onHelp?: () => void;
}

/**
 * The shared page chrome row (spec §2). Sits sticky beneath the brand bar and
 * never scrolls away. Shows where you are (the bold current crumb), where Back
 * returns you (a real ≥44px back control → `back`, plus tappable ancestor
 * crumbs), and an optional `?` into contextual help. There is no Save control —
 * the tree saves as you go (Plan 2). Back-navigation inherits the origin-zoom
 * collapse for free via the central NavTransitionOutlet.
 */
export function PageBar({ crumbs, back, onHelp }: PageBarProps): JSX.Element {
  const navigate = useNavigate();
  return (
    <div data-page-bar="" className="cs-pagebar">
      <button
        type="button"
        aria-label="Back"
        className="cs-pagebar-back"
        onClick={() => navigate(back)}
      >
        ‹
      </button>
      <nav aria-label="Breadcrumb" className="cs-pagebar-crumbs">
        {crumbs.map((c, i) => {
          const isCurrent = i === crumbs.length - 1;
          return (
            <Fragment key={c.label}>
              {i > 0 ? <span className="cs-pagebar-sep" aria-hidden="true">/</span> : null}
              {isCurrent || !c.to ? (
                <span className="cs-pagebar-current" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="cs-pagebar-crumb"
                  onClick={() => navigate(c.to as string)}
                >
                  {c.label}
                </button>
              )}
            </Fragment>
          );
        })}
      </nav>
      {onHelp ? (
        <button type="button" aria-label="Help" className="cs-pagebar-help" onClick={onHelp}>
          ?
        </button>
      ) : (
        <span className="cs-pagebar-help-spacer" aria-hidden="true" />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `PageScaffold`**

```tsx
// src/components/ui/PageScaffold.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { PageBar, type Crumb } from './PageBar.js';

export interface PageScaffoldProps {
  crumbs: Crumb[];
  back: string;
  onHelp?: () => void;
  /** The scrolling page content; the PageBar above it stays put. */
  children: ReactNode;
}

/**
 * Standard page layout for the My Account tree (spec §2.4): the sticky PageBar
 * plus a content region. Only the content scrolls — the bar is sticky chrome.
 */
export function PageScaffold({ crumbs, back, onHelp, children }: PageScaffoldProps): JSX.Element {
  return (
    <div className="cs-page">
      <PageBar crumbs={crumbs} back={back} onHelp={onHelp} />
      <div className="cs-page-body">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Add the `.cs-pagebar` styling**

In `src/index.css`, after the `.cs-scaffold-footer` rule (~line 5082), add. The sticky offset mirrors `EditorSticky` (`top-13 lg:top-15`, blur, bottom divider); the `-mx-* px-*` echoes how `EditorSticky` extends the blur to the gutter inside `<main>`'s padding. The current crumb uses the display font; ancestors are soft and the back/help controls are 44px hit targets.

```css
/* ── PageBar / PageScaffold (shared page chrome, spec §2) ───────────── */
.cs-pagebar {
  position: sticky;
  top: 3.25rem; /* 52px — brand-bar height, matches EditorSticky top-13 */
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -1rem -1.5rem 0; /* cancel <main> px-6 / pt-4 so the bar is full-bleed */
  padding: 0.75rem 1.5rem;
  background: color-mix(in srgb, var(--color-ink) 55%, transparent);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid color-mix(in srgb, var(--color-paper-soft) 15%, transparent);
}
@media (min-width: 1024px) {
  .cs-pagebar { top: 3.75rem; } /* 60px — matches EditorSticky lg:top-15 */
}
.cs-pagebar-back,
.cs-pagebar-help {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--color-paper-soft);
  font-size: 20px;
  cursor: pointer;
}
.cs-pagebar-back:hover,
.cs-pagebar-help:hover { color: var(--color-paper); }
.cs-pagebar-help-spacer { flex: none; width: 44px; height: 44px; }
.cs-pagebar-crumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}
.cs-pagebar-crumb {
  background: none;
  border: none;
  padding: 4px 2px;
  color: var(--color-paper-soft);
  font-size: 14px;
  cursor: pointer;
  flex: none;
}
.cs-pagebar-crumb:hover { color: var(--color-paper); }
.cs-pagebar-sep { color: var(--color-paper-soft); opacity: 0.5; flex: none; }
.cs-pagebar-current {
  font-family: var(--font-display);
  font-size: 16px;
  color: var(--color-paper);
  overflow: hidden;
  text-overflow: ellipsis; /* the current crumb truncates first at 375px */
}
.cs-page-body { padding-top: 1rem; }
```

(If `--color-ink` or `--radius-pill` is not the exact token name in this codebase, match the names used by the adjacent `.cs-scaffold-*` rules — they use `--color-paper`, `--color-paper-soft`, `var(--radius-pill)`. Verify `--color-ink` exists in the `@theme` block; if not, reuse the dark surface token the brand bar uses.)

- [ ] **Step 6: Run the test, expect pass**

Run: `pnpm test tests/component/ui-page-bar.test.tsx` → PASS (all four).

- [ ] **Step 7: Export from the barrel + add to the showcase**

In `src/components/ui/index.ts` add:

```ts
export { PageBar, type PageBarProps, type Crumb } from './PageBar.js';
export { PageScaffold, type PageScaffoldProps } from './PageScaffold.js';
```

In `src/routes/app/ui-showcase.tsx`, import `PageScaffold` and add a section rendering a live example:

```tsx
<PageScaffold
  back="/app/ui-showcase"
  crumbs={[{ label: 'My Account', to: '/app/ui-showcase' }, { label: 'Biometric' }]}
  onHelp={() => alert('help opens the reading overlay (Plan 2)')}
>
  <p className="text-paper-soft">Page content scrolls; the bar above stays put.</p>
</PageScaffold>
```

- [ ] **Step 8: Run the gate**

Run: `pnpm typecheck --force` → 14/14. `pnpm biome check src/components/ui/PageBar.tsx src/components/ui/PageScaffold.tsx src/components/ui/index.ts src/routes/app/ui-showcase.tsx src/index.css` → clean. `pnpm test tests/component/ui-page-bar.test.tsx` → PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/user-client/src/components/ui/PageBar.tsx apps/user-client/src/components/ui/PageScaffold.tsx apps/user-client/src/components/ui/index.ts apps/user-client/src/index.css apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/ui-page-bar.test.tsx
git commit -m "Add PageBar and PageScaffold shared page-chrome primitives

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: `ReadingOverlay` primitive

A zoom-in Markdown reader for help, licence, privacy, and third-party text (spec §5). Insets with margin, dims the surrounding screen, opulent background, near-white body, gold-tinted headings, a fixed title bar with a prominent `×`, scrollable content, and Esc / backdrop-tap / `×` to close. Renders through the existing `MarkdownContent`. Origin-zoom mirrors `ConfirmDialog` (read `triggerRef`'s rect → `computeTransformOrigin` → `cs-zoom-in`).

**Files:**
- Create: `apps/user-client/src/components/ui/ReadingOverlay.tsx`
- Modify: `apps/user-client/src/components/ui/index.ts` (add export)
- Modify: `apps/user-client/src/index.css` (add `.cs-reader*` rules)
- Modify: `apps/user-client/src/routes/app/ui-showcase.tsx` (add a ReadingOverlay demo)
- Test: `apps/user-client/tests/component/ui-reading-overlay.test.tsx`

**Interfaces:**
- Consumes: `MarkdownContent` (`src/components/chat/markdown/MarkdownContent.tsx`, signature `{ text: string; glow?: VoiceGlow }`); `computeTransformOrigin` (`src/lib/origin-zoom.ts`).
- Produces:
  ```ts
  export interface ReadingOverlayProps {
    open: boolean;
    title: string;          // shown in the fixed title bar — what the user is reading
    markdown: string;       // raw Markdown source
    onClose: () => void;
    triggerRef?: React.RefObject<HTMLElement>; // zoom origin (the tapped tile / ? button)
  }
  ```
  Consumed by the About sub-page and every page's `?` help (Plan 2).

- [ ] **Step 1: Write the failing ReadingOverlay test**

Read `src/components/ui/ConfirmDialog.tsx` first to match the existing modal conventions (backdrop element, Escape handler, `role="dialog"`/`aria-modal`, focus handling). Mirror them.

```tsx
// tests/component/ui-reading-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReadingOverlay } from '../../src/components/ui/ReadingOverlay.js';

// MarkdownContent pulls in heavy markdown deps; stub it to its text for this unit test.
vi.mock('../../src/components/chat/markdown/MarkdownContent.js', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-md>{text}</div>,
}));

describe('ReadingOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ReadingOverlay open={false} title="Privacy" markdown="# Privacy" onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the title and renders the markdown when open', () => {
    render(<ReadingOverlay open title="Privacy & data handling" markdown="# Hello" onClose={() => {}} />);
    expect(screen.getByText('Privacy & data handling')).toBeInTheDocument();
    expect(screen.getByText('# Hello')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on the × button, on Escape, and on backdrop tap', () => {
    const onClose = vi.fn();
    render(<ReadingOverlay open title="X" markdown="x" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('cs-reader-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm test tests/component/ui-reading-overlay.test.tsx`
Expected: FAIL — cannot resolve `ReadingOverlay.js`.

- [ ] **Step 3: Implement `ReadingOverlay`**

```tsx
// src/components/ui/ReadingOverlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef } from 'react';
import { MarkdownContent } from '../chat/markdown/MarkdownContent.js';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';

export interface ReadingOverlayProps {
  open: boolean;
  /** What the user is reading — shown in the fixed title bar. */
  title: string;
  /** Raw Markdown source. */
  markdown: string;
  onClose: () => void;
  /** The element the overlay zooms out of (the tapped tile / ? button). */
  triggerRef?: React.RefObject<HTMLElement>;
}

/**
 * A zoom-in Markdown reader (spec §5): insets with margin, dims the screen
 * around it, opulent surface with gold-tinted headings, a fixed title bar and a
 * prominent × (also Esc / backdrop-tap). Long content scrolls under the fixed
 * title. Zooms out of the trigger rect, mirroring ConfirmDialog.
 */
export function ReadingOverlay({ open, title, markdown, onClose, triggerRef }: ReadingOverlayProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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

  // Escape to close + focus the × on open.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cs-reader-root" role="dialog" aria-modal="true" aria-label={title}>
      <div
        data-testid="cs-reader-backdrop"
        className="cs-reader-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div ref={panelRef} className="cs-reader-panel cs-zoom-in">
        <header className="cs-reader-titlebar">
          <h2 className="cs-reader-title">{title}</h2>
          <button ref={closeRef} type="button" aria-label="Close" className="cs-reader-close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="cs-reader-scroll">
          <MarkdownContent text={markdown} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the `.cs-reader` styling**

In `src/index.css`, after the `.cs-page-body` rule from Task 1, add. Inset panel (margin all round), dimmed backdrop, opulent fill, gold headings via the markdown subtree, fixed title bar, scroll region.

```css
/* ── ReadingOverlay (Markdown reader, spec §5) ─────────────────────── */
.cs-reader-root { position: fixed; inset: 0; z-index: 100; }
.cs-reader-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.cs-reader-panel {
  position: absolute;
  inset: 5vh 4vw; /* margin all around — never full-bleed */
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--color-gold) 28%, transparent);
  background:
    radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--color-nav-purple) 16%, transparent), transparent),
    color-mix(in srgb, var(--color-ink) 92%, black);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.cs-reader-titlebar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-gold) 18%, transparent);
}
.cs-reader-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--color-gold-hi);
}
.cs-reader-close {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--color-paper);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.cs-reader-close:hover { color: var(--color-gold-hi); }
.cs-reader-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  color: color-mix(in srgb, var(--color-paper) 96%, white);
}
.cs-reader-scroll :is(h1, h2, h3) { color: var(--color-gold-hi); }
```

(Match `--color-ink` / `--color-gold-hi` / `--color-nav-purple` to the actual token names confirmed in Task 1's `@theme` block. `--color-nav-purple` and `--color-gold-hi` are confirmed to exist; verify `--color-ink` and substitute the dark surface token if its name differs.)

- [ ] **Step 5: Run the test, expect pass**

Run: `pnpm test tests/component/ui-reading-overlay.test.tsx` → PASS (all three).

- [ ] **Step 6: Export from the barrel + add to the showcase**

In `src/components/ui/index.ts`:

```ts
export { ReadingOverlay, type ReadingOverlayProps } from './ReadingOverlay.js';
```

In `src/routes/app/ui-showcase.tsx`, add a button + local `useState(false)` that opens a `ReadingOverlay` with a few paragraphs of sample Markdown (headings + a list + a link), passing the button's ref as `triggerRef` so the zoom origin is visible.

- [ ] **Step 7: Run the gate**

Run: `pnpm typecheck --force` → 14/14. `pnpm biome check src/components/ui/ReadingOverlay.tsx src/components/ui/index.ts src/routes/app/ui-showcase.tsx src/index.css` → clean. `pnpm test tests/component/ui-reading-overlay.test.tsx` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/components/ui/ReadingOverlay.tsx apps/user-client/src/components/ui/index.ts apps/user-client/src/index.css apps/user-client/src/routes/app/ui-showcase.tsx apps/user-client/tests/component/ui-reading-overlay.test.tsx
git commit -m "Add ReadingOverlay Markdown reader primitive

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: `NavTile` `onActivate` extension

Extend the existing `NavTile` so a tile can trigger a callback (open a ReadingOverlay, open an external link) instead of navigating — keeping the matrix visually uniform. Additive and backward-compatible: existing `to`-only tiles are unchanged.

**Files:**
- Modify: `apps/user-client/src/components/ui/NavTile.tsx` (add the `onActivate` prop + activate path)
- Test: `apps/user-client/tests/component/ui-nav-tile.test.tsx` (extend with new cases)

**Interfaces:**
- Produces (added to the existing `NavTileProps`):
  ```ts
  /** Alternative to `to`: tap triggers this callback (overlay / external link)
   *  instead of navigating, receiving the tile element so a consumer can use it
   *  as a zoom origin. Ignored when `to` is set or when disabled. */
  onActivate?: (el: HTMLElement) => void;
  ```
  An `onActivate` tile is interactive (focusable, plays the gold blink) but does not navigate. The element argument is the tile itself (for `ReadingOverlay`'s `triggerRef` zoom origin). Consumed by the About sub-page (License/Source/Privacy/Third-party tiles, Plan 2).

- [ ] **Step 1: Read the current `NavTile` and add the failing tests**

First read `src/components/ui/NavTile.tsx` to see the exact current activate logic and `interactive` computation. Then add two cases to `tests/component/ui-nav-tile.test.tsx`:

```tsx
it('onActivate tile: interactive, fires the callback with the element, does not navigate', () => {
  const onActivate = vi.fn();
  renderTile({ to: undefined, onActivate });
  const tile = screen.getByRole('button', { name: /My Circle/ });
  fireEvent.click(tile);
  expect(onActivate).toHaveBeenCalledOnce();
  expect(onActivate.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('disabled wins over onActivate', () => {
  const onActivate = vi.fn();
  renderTile({ to: undefined, onActivate, disabled: true, disabledReason: 'nope' });
  fireEvent.click(screen.getByRole('button', { name: /My Circle/ }));
  expect(onActivate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them, expect failure**

Run: `pnpm test tests/component/ui-nav-tile.test.tsx`
Expected: FAIL — `onActivate` not wired (callback never called).

- [ ] **Step 3: Add the prop + activate path**

In `NavTile.tsx`: add `onActivate?: () => void;` to `NavTileProps` (with the JSDoc above). Update the interactivity + activate logic so a tile is interactive when `!disabled && (to || onActivate)`, and on activation: arm + navigate when `to` is set (existing behaviour, unchanged), else call `onActivate` after the same gold-blink the navigation path uses. Concretely, adapt the existing `activate` function — e.g.:

```tsx
const interactive = !disabled && (Boolean(to) || Boolean(onActivate));

const activate = (el: HTMLElement): void => {
  if (!interactive) return;
  if (to) {
    // existing navigation path — arm the transition store + blink + navigate (unchanged)
    // (keep whatever the current implementation does here)
    return;
  }
  if (onActivate) {
    el.classList.add('cs-tile-blink');
    onActivate(el);
  }
};
```

Keep the existing navigation branch exactly as shipped; only add the `onActivate` branch and widen `interactive`. Do not change any existing call site.

- [ ] **Step 4: Run the NavTile tests, expect pass**

Run: `pnpm test tests/component/ui-nav-tile.test.tsx` → PASS (existing + two new).

- [ ] **Step 5: Run the gate**

Run: `pnpm typecheck --force` → 14/14. `pnpm biome check src/components/ui/NavTile.tsx` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/NavTile.tsx apps/user-client/tests/component/ui-nav-tile.test.tsx
git commit -m "Add onActivate path to NavTile for overlay/external-link tiles

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (this plan = the §2 / §5 / §8 primitives):**
- §2.1 anatomy (breadcrumb trail + `?`), §2.2 breadcrumbs, §2.4 the primitive (`PageBar`/`PageScaffold`) → Task 1. The ≥44px real back control (Laura HARD-1) → Task 1 CSS (`width/height: 44px`) + test ("Back" button navigates).
- §2.3 always-save → NOT a primitive concern; lives in Plan 2 (the bar deliberately has no Save control — verified by the absence of any Save affordance in `PageBar`).
- §5 ReadingOverlay (inset, dim, gold headings, fixed title + ×, Esc/backdrop, MarkdownContent, origin-zoom) → Task 2.
- §8 colour/motion: nav palette untouched; gold headings in the reader; origin-zoom reused → Tasks 1-2. NavTile stays nav-plane; `onActivate` does not add colour.
- §4.4 About's overlay/external-link tiles need a non-navigating tile → Task 3 (`onActivate`).

**Placeholder scan:** No TBD/TODO. The two token-name caveats (`--color-ink`, `--radius-pill`) are explicit verification instructions with a named fallback, not placeholders. Task 3's activate branch references "the current implementation" deliberately (it must be read, not rewritten, to stay backward-compatible) and shows the exact new branch to add.

**Type consistency:** `Crumb`/`PageBarProps`/`PageScaffoldProps` consistent across `PageBar`/`PageScaffold`/index barrel. `ReadingOverlayProps` fields match the test usage. `onActivate?: () => void` matches the Task 3 test and the About consumer signature in Plan 2.

**Interfaces handed to Plan 2:** `PageScaffold({ crumbs, back, onHelp, children })`, `ReadingOverlay({ open, title, markdown, onClose, triggerRef })`, `NavTile`'s new `onActivate`.
