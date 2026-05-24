# Polish Block (Phase 2.8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Chris's pre-very-early-alpha polish list — brand logo gradient + twinkle, sticky-header pattern as a project-wide design guideline, display-name in My Account (with Entrance Hall greeting hook), and a cold-start splash overlay with FLIP-migration of the logo to the topbar position.

**Architecture:** All work lives in `apps/user-client`. Four polish items mapped to four squashed commits (plus a STATUS update commit). Within each item, TDD: write failing test → minimal implementation → green test → commit. New component `EditorSticky` is shared by Persona Editor, My Settings, and My Account (and any future editor-class route — projects, knowledge bases, etc.). New component `SplashOverlay` lives at root layout level, gated by `sessionStorage`, with a `SplashContext` that lets the overlay measure the topbar logo for the FLIP transform.

**Tech Stack:** TypeScript strict, React 18, Tailwind v4, React Router v6, Dexie v4 schema migration, Vitest + `@testing-library/react`. No new packages.

**References:**
- Spec: [`superpowers/specs/2026-05-24-polish-block-design.md`](../specs/2026-05-24-polish-block-design.md)
- Teaser-page visual source: [`docs/index.html`](../../docs/index.html)
- Phase-2.7 plan (for plan-style reference): [`superpowers/plans/2026-05-24-client-block-1-phase-2-7-account-room.md`](2026-05-24-client-block-1-phase-2-7-account-room.md)
- Status: [`obsidian/STATUS-CLIENT-ONLY.md`](../../obsidian/STATUS-CLIENT-ONLY.md)

---

## File Structure

### Created

- `apps/user-client/src/components/EditorSticky.tsx`
- `apps/user-client/src/components/SplashOverlay.tsx`
- `apps/user-client/src/components/SplashContext.tsx`
- `apps/user-client/tests/components/EditorSticky.test.tsx`
- `apps/user-client/tests/components/SplashOverlay.test.tsx`
- `apps/user-client/tests/boot/client-data-db-v4.test.ts`
- `apps/user-client/tests/data/use-display-name.test.tsx`
- `apps/user-client/tests/routes/account.display-name.test.tsx`
- `apps/user-client/tests/routes/entrance-hall.greeting.test.tsx`
- `apps/user-client/tests/routes/root.brand-logo.test.tsx`

### Modified

- `apps/user-client/src/index.css` — add `.brand-logo*` classes + `.splash-*` keyframes + reduced-motion overrides
- `apps/user-client/src/routes/root.tsx` — replace italic logo with `.brand-logo` markup; mount `<SplashContext.Provider>` + `<SplashOverlay />`; attach topbar ref
- `apps/user-client/src/routes/app/persona-editor.tsx` — wrap topbar + quick-actions in `<EditorSticky>`
- `apps/user-client/src/routes/app/settings.tsx` — wrap topbar in `<EditorSticky>`
- `apps/user-client/src/routes/app/account.tsx` — wrap topbar in `<EditorSticky>`
- `apps/user-client/src/routes/app/account-sections/account-section.tsx` — add Display-Name input block
- `apps/user-client/src/routes/app/entrance-hall.tsx` — replace `session.username` with `useDisplayName()`
- `apps/user-client/src/data/settings.ts` — add `useDisplayName()` hook
- `apps/user-client/src/boot/client-data-db.ts` — add `SettingsRow.displayName: string`, Dexie v4 migration, seed default in `seedBuiltinsIfNeeded`
- `obsidian/STATUS-CLIENT-ONLY.md` — append Phase-2.8 Done block + update Doing/Next sections

### Deleted

(none)

---

## Pre-Existing Pitfalls (carry forward from earlier phases)

- **Vitest test glob is `tests/**/*.test.{ts,tsx}`** — put every new test file under `apps/user-client/tests/...`, mirroring the `src/` structure.
- **SPDX header line 1, blank line 2, imports from line 3** — Biome's `organizeImports` re-sorts; SPDX header stays above.
- **Biome rules:** `noForEach` (use `for…of`), `noNonNullAssertion` (no `!`), interactive `<div>`s need keyboard support and `role="button"`, accordion-style `<div>` needs `tabIndex`.
- **Tailwind v4 colour tokens** are defined in `src/index.css`'s `@theme` block: `ink`, `ink-soft`, `paper`, `paper-soft`, `aurora-{50,200,500,700,900}`, `success`, `warning`, `danger`. The class name `bg` is NOT defined — use `ink` for the page background.
- **`@chatsundere/llm-unified` and `@chatsundere/crypto` must already be built** (their `dist/` folders must exist). If a typecheck error mentions one of them, run `pnpm --filter @chatsundere/crypto build` and/or `pnpm --filter @chatsundere/llm-unified build` once from the repo root.
- **Run `pnpm lint` and `pnpm typecheck` from the repo root**, not from inside `apps/user-client`.
- **Build verification is `pnpm run build`** (full TS pipeline), not `tsc --noEmit` alone.
- **TanStack-Query cache is stale right after `mutateAsync`** — relevant for the Display-Name input on blur (we await the mutate, but the UI's local input state is the source of truth until the cache refreshes).
- **`SettingsRow` lives in `client-data-db.ts` (Dexie)**, but **AccountSection currently speaks to the crypto DB** via `getDb()` from `@chatsundere/crypto`. The Display-Name input is the first thing in AccountSection that uses the OTHER DB (via `useSettings()` / `useUpdateSettings()` from `data/settings.ts`). Both DBs co-exist; that is correct.
- **`useSessionStore` exposes `session?.username`** but the session may be null on `/`, `/onboarding`, and `/unlock`. Display-name fallback chain: `settings.displayName.trim()` → `session.username` → `'—'`.
- **`prefers-reduced-motion` already has CSS hooks** in `src/index.css` for wizard, badge-pulse, recovery-reveal, mindspace-texture. New `.splash-*` and `.brand-logo-*` rules follow the same pattern.
- **fake-indexeddb is already wired** in test bootstrap; `import 'fake-indexeddb/auto'` at the top of any DB test gives a fresh isolated IndexedDB per test file.
- **Subagents never push or switch branches.** All commits go onto `master`.
- **Commit subject line capitalised, imperative.** Co-author trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.

---

# COMMIT 1 of 4 — Polish 1/4: Brand logo style

## Task 1: Replace italic logo with gradient-text + twinkle

**Files:**
- Modify: `apps/user-client/src/index.css`
- Modify: `apps/user-client/src/routes/root.tsx`
- Create: `apps/user-client/tests/routes/root.brand-logo.test.tsx`

The italic Lora wordmark is replaced by Lora regular wrapped in a cyan→pink→gold gradient (identical hex values to `docs/index.html`'s teaser hero), with a small absolutely-positioned gold `✦` at the top-right. Twinkle keyframes match the teaser exactly. `prefers-reduced-motion` disables the twinkle but keeps the `✦` visible at 80% opacity so the brand mark stays whole.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/root.brand-logo.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Root } from '../../src/routes/root.js';

describe('Root brand logo', () => {
  it('renders the wordmark inside a span carrying the gradient class', () => {
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    const wordmark = screen.getByText('Chatsundere');
    expect(wordmark).toBeInTheDocument();
    expect(wordmark.className).toContain('brand-logo-text');
    expect(wordmark.closest('a')?.className).toContain('brand-logo');
    expect(wordmark.closest('a')?.className).not.toContain('italic');
  });

  it('renders the twinkle as a sibling span with aria-hidden', () => {
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    const twinkle = screen.getByText('✦');
    expect(twinkle).toBeInTheDocument();
    expect(twinkle.getAttribute('aria-hidden')).toBe('true');
    expect(twinkle.className).toContain('brand-logo-twinkle');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```
cd /home/chris/workspace/chatsundere
pnpm --filter user-client test -- root.brand-logo
```

Expected: FAIL with "Unable to find an element with text: Chatsundere" or "expect(received).toContain('brand-logo-text')" — the current root still renders `text-xl italic`.

- [ ] **Step 3: Add the CSS rules**

Append to `apps/user-client/src/index.css`, after the existing `@keyframes recovery-reveal` block (around line 132, before the `@media (prefers-reduced-motion: reduce)` block) — add a NEW reduced-motion block below your additions; do NOT modify the existing one:

```css
/* ===== Brand logo ===== */

.brand-logo {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  font-family: var(--font-display);
  font-size: 1.25rem; /* text-xl */
  line-height: 1;
  font-style: normal;
}

@media (min-width: 1024px) {
  .brand-logo {
    font-size: 1.5rem; /* text-2xl */
  }
}

.brand-logo-text {
  background: linear-gradient(135deg, #4dd0ff 0%, #ff9ad9 50%, #ffd56b 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.brand-logo-twinkle {
  position: absolute;
  top: -0.2em;
  right: -0.55em;
  font-size: 0.35em;
  color: #ffd56b;
  animation: brand-twinkle 3s ease-in-out infinite;
}

@keyframes brand-twinkle {
  0%, 100% { opacity: 0.4; transform: rotate(0deg) scale(1); }
  50%      { opacity: 1;   transform: rotate(180deg) scale(1.2); }
}

@media (prefers-reduced-motion: reduce) {
  .brand-logo-twinkle {
    animation: none;
    opacity: 0.8;
  }
}
```

- [ ] **Step 4: Update the markup in `root.tsx`**

Open `apps/user-client/src/routes/root.tsx`. Find this block (around line 30-33):

```tsx
{/* Logo — smaller on mobile to leave room for the right-side controls */}
<Link to="/" className="font-display text-xl italic lg:text-2xl">
  Chatsundere
</Link>
```

Replace it with:

```tsx
{/* Logo — gradient wordmark + twinkle, sized via .brand-logo CSS */}
<Link to="/" className="brand-logo">
  <span className="brand-logo-text">Chatsundere</span>
  <span className="brand-logo-twinkle" aria-hidden="true">✦</span>
</Link>
```

- [ ] **Step 5: Run the test to confirm it passes**

Run:
```
pnpm --filter user-client test -- root.brand-logo
```

Expected: PASS, both cases green.

- [ ] **Step 6: Run the full user-client test suite to confirm no regressions**

Run:
```
pnpm --filter user-client test
```

Expected: all 183+ tests pass. If a different `Root` test (e.g. `tests/unit/root.test.tsx` if it exists) asserts on the old `italic` class, update it to assert on `brand-logo` instead.

- [ ] **Step 7: Run typecheck + lint**

Run from repo root:
```
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 8: Commit Polish 1/4**

```bash
git add apps/user-client/src/index.css apps/user-client/src/routes/root.tsx apps/user-client/tests/routes/root.brand-logo.test.tsx
git status   # confirm only these three files are staged
git commit -m "$(cat <<'EOF'
Polish 1/4 — Brand logo style (gradient + twinkle)

Replace the italic Lora wordmark in the topbar with a cyan→pink→gold
gradient-clipped Lora regular plus a small absolutely-positioned gold
'✦' that twinkles on the same 3-second cadence as the teaser hero.
Brings the app shell's brand mark in sync with the chatsune.me teaser
page so the upcoming splash-screen can hand off seamlessly.

prefers-reduced-motion freezes the twinkle at 0.8 opacity.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

# COMMIT 2 of 4 — Polish 2/4: Sticky-header pattern

## Task 2: Create the EditorSticky component + tests

**Files:**
- Create: `apps/user-client/src/components/EditorSticky.tsx`
- Create: `apps/user-client/tests/components/EditorSticky.test.tsx`

Shared component that turns its children into a viewport-sticky region with backdrop-blur + hairline border + negative-margin trick to span the route's `px-4` gutter.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/EditorSticky.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorSticky } from '../../src/components/EditorSticky.js';

describe('EditorSticky', () => {
  it('renders its children', () => {
    render(
      <EditorSticky>
        <div>child-marker</div>
      </EditorSticky>,
    );
    expect(screen.getByText('child-marker')).toBeInTheDocument();
  });

  it('applies sticky-positioning classes', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('sticky');
    expect(wrapper.className).toContain('top-0');
    expect(wrapper.className).toContain('z-10');
  });

  it('applies backdrop-blur + hairline border', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('backdrop-blur-sm');
    expect(wrapper.className).toContain('border-b');
  });

  it('extends across the px-4 route gutter via negative margin', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('-mx-4');
    expect(wrapper.className).toContain('px-4');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- EditorSticky
```

Expected: FAIL with "Failed to resolve import" for `../../src/components/EditorSticky.js`.

- [ ] **Step 3: Implement the component**

Create `apps/user-client/src/components/EditorSticky.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Sticky wrapper for the top-of-page action bar on editor-class routes.
 * Children stay anchored to the viewport top as the surrounding content
 * scrolls. A backdrop-blur + hairline border lets underlying content
 * shimmer through, so the sticky region reads as a tool palette rather
 * than a solid header.
 *
 * Negative horizontal margin + padding extends the blur to the full
 * route gutter; consuming routes use px-4 today, so -mx-4 px-4 wins.
 */
export function EditorSticky({ children }: Props): JSX.Element {
  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 pb-2 pt-1 bg-ink/80 backdrop-blur-sm border-b border-paper-soft/15">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- EditorSticky
```

Expected: PASS, all four cases green.

## Task 3: Adopt EditorSticky in Persona Editor

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Modify: `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx` (or any persona-editor test that snapshots the top region)

The EditorTopbar + the three quick-action buttons (Continue / New Chat / Incognito — edit mode only) move inside `<EditorSticky>`. Identity, accordions, and the Delete-zone stay outside (scrolling).

- [ ] **Step 1: Write the new test asserting on sticky composition**

Add a NEW test file: `apps/user-client/tests/routes/persona-editor.sticky.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function renderEditor(initial: '/app/persona/new' | '/app/persona/:id') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial === '/app/persona/new' ? '/app/persona/new' : '/app/persona/p-1']}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Persona Editor sticky region', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('in create mode wraps only the EditorTopbar in the sticky region (no quick-actions row)', async () => {
    renderEditor('/app/persona/new');
    await waitFor(() => expect(screen.getByLabelText(/back/i)).toBeInTheDocument());
    const back = screen.getByLabelText(/back/i);
    const sticky = back.closest('[class*="sticky"][class*="top-0"]');
    expect(sticky).not.toBeNull();
    // Quick-actions should NOT be present in create mode.
    expect(screen.queryByText(/^Continue$/)).toBeNull();
    expect(screen.queryByText(/^New Chat$/)).toBeNull();
    expect(screen.queryByText(/^Incognito$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- persona-editor.sticky
```

Expected: FAIL — the back button currently is NOT inside any element with class `sticky top-0`.

- [ ] **Step 3: Update `persona-editor.tsx`**

Open `apps/user-client/src/routes/app/persona-editor.tsx`. At the top, add to the imports list (alongside the existing `EditorTopbar` import):

```tsx
import { EditorSticky } from '../../components/EditorSticky.js';
```

Then find the `return (` block (around line 147-180) and replace this section:

```tsx
return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
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

      {!isCreate ? (
        <div className="grid grid-cols-3 gap-2">
          {(['Continue', 'New Chat', 'Incognito'] as const).map((label) => (
            <button
              key={label}
              type="button"
              disabled={label === 'Incognito'}
              title={label === 'Incognito' ? 'Coming with Block 3 memory system' : undefined}
              className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
```

…with:

```tsx
return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorSticky>
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

        {!isCreate ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['Continue', 'New Chat', 'Incognito'] as const).map((label) => (
              <button
                key={label}
                type="button"
                disabled={label === 'Incognito'}
                title={label === 'Incognito' ? 'Coming with Block 3 memory system' : undefined}
                className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper disabled:text-paper-soft/40"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </EditorSticky>
```

(The closing `</EditorSticky>` goes right after the quick-actions ternary; everything else — Identity section, accordions, Delete zone — stays outside the sticky region.)

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- persona-editor.sticky
```

Expected: PASS.

- [ ] **Step 5: Run all persona-editor tests to confirm no regressions**

```
pnpm --filter user-client test -- persona-editor
```

Expected: all persona-editor test files green (sticky, required-markers, dynamic-meta, font-and-voice).

## Task 4: Adopt EditorSticky in My Settings

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/user-client/tests/routes/settings.draft-save.test.tsx` (or create a small new file `apps/user-client/tests/routes/settings.sticky.test.tsx` if you prefer to keep tests separated):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Settings } from '../../src/routes/app/settings.js';

describe('My Settings sticky region', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('wraps the EditorTopbar in the sticky region', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/back/i)).toBeInTheDocument());
    const back = screen.getByLabelText(/back/i);
    const sticky = back.closest('[class*="sticky"][class*="top-0"]');
    expect(sticky).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- settings.sticky
```

Expected: FAIL (back button not inside sticky).

- [ ] **Step 3: Update `settings.tsx`**

Open `apps/user-client/src/routes/app/settings.tsx`. Add to the imports:

```tsx
import { EditorSticky } from '../../components/EditorSticky.js';
```

Find the `return (` block (around line 164-173) and wrap the `<EditorTopbar … />` element in `<EditorSticky>`:

```tsx
return (
    <section className="flex flex-col gap-3 px-4 pb-32 pt-4">
      <EditorSticky>
        <EditorTopbar
          title="My Settings"
          isDirty={isDirty}
          onBack={() => navigate('/app')}
          onSaveAndBack={() => {
            void onSaveAndBack();
          }}
        />
      </EditorSticky>
      …  {/* accordions and SaveBar continue unchanged below */}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- settings
```

Expected: all settings tests green.

## Task 5: Adopt EditorSticky in My Account + commit Polish 2/4

**Files:**
- Modify: `apps/user-client/src/routes/app/account.tsx`

- [ ] **Step 1: Write the failing test**

Add a new test file `apps/user-client/tests/routes/account.sticky.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AccountPage } from '../../src/routes/app/account.js';

describe('My Account sticky region', () => {
  it('wraps the EditorTopbar in the sticky region', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AccountPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/back/i)).toBeInTheDocument());
    const back = screen.getByLabelText(/back/i);
    const sticky = back.closest('[class*="sticky"][class*="top-0"]');
    expect(sticky).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- account.sticky
```

Expected: FAIL.

- [ ] **Step 3: Update `account.tsx`**

Open `apps/user-client/src/routes/app/account.tsx`. Add:

```tsx
import { EditorSticky } from '../../components/EditorSticky.js';
```

Wrap the `<EditorTopbar … />` element:

```tsx
return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorSticky>
        <EditorTopbar
          title="My Account"
          isDirty={false}
          onBack={() => navigate('/app')}
          onSaveAndBack={() => {}}
          hideSaveAndBack
        />
      </EditorSticky>
      …  {/* accordions continue unchanged */}
```

- [ ] **Step 4: Run the new test to confirm it passes**

```
pnpm --filter user-client test -- account.sticky
```

Expected: PASS.

- [ ] **Step 5: Run the full user-client test suite**

```
pnpm --filter user-client test
```

Expected: all tests green.

- [ ] **Step 6: Run typecheck + lint**

```
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit Polish 2/4**

```bash
git add apps/user-client/src/components/EditorSticky.tsx \
        apps/user-client/src/routes/app/persona-editor.tsx \
        apps/user-client/src/routes/app/settings.tsx \
        apps/user-client/src/routes/app/account.tsx \
        apps/user-client/tests/components/EditorSticky.test.tsx \
        apps/user-client/tests/routes/persona-editor.sticky.test.tsx \
        apps/user-client/tests/routes/settings.sticky.test.tsx \
        apps/user-client/tests/routes/account.sticky.test.tsx
git status   # confirm only these files are staged
git commit -m "$(cat <<'EOF'
Polish 2/4 — EditorSticky pattern across editor-class routes

Introduce a shared EditorSticky wrapper and adopt it in Persona Editor
(topbar + Continue/New Chat/Incognito quick-actions in edit mode),
My Settings (topbar only), and My Account (topbar only). The sticky
region uses backdrop-blur + a paper-soft hairline border and extends
across the route's px-4 gutter via -mx-4 px-4, so the underlying
content shimmers through as the user scrolls.

Identity, accordions, and destructive Delete zones stay outside the
sticky region — that placement is intentional, the Delete-zone is
meant to be a little harder to reach than the everyday tools.

Establishes the pattern for any future editor-class route (My
Projects, knowledge bases, ...).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

# COMMIT 3 of 4 — Polish 3/4: Display-Name

## Task 6: Add `displayName` to the Dexie schema (v4 migration)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/tests/boot/client-data-db-v4.test.ts`

`SettingsRow` gains `displayName: string`. v4 migration backfills `''` on existing rows; the v1 seed for fresh installs also writes `''`.

- [ ] **Step 1: Write the failing migration test**

Create `apps/user-client/tests/boot/client-data-db-v4.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const V3_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

async function plantV3DatabaseWithoutDisplayName(): Promise<void> {
  const now = Date.now();
  const v3 = new Dexie('chatsundere_client_data');
  v3.version(1).stores(V3_STORES);
  v3.version(2).stores(V3_STORES);
  v3.version(3).stores(V3_STORES);
  await v3.open();
  await v3.table('mindspaces').add({
    id: 'ms-1',
    displayName: 'Aurum',
    palette: {
      bg: '#0a0a0a',
      surfaceBase: '',
      surfaceRaised: '',
      surfaceInput: '',
      accent: '#c9a84c',
      accentSubtle: '',
      accentBorder: '',
      accentBorderActive: '',
      accentGlow: '',
      text: { primary: '', secondary: '', muted: '', ghost: '' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: now,
  });
  await v3.table('settings').add({
    id: 1,
    globalUnlockerPrompt: '',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    corsProxy: null,
    createdAt: now,
    updatedAt: now,
  });
  v3.close();
}

describe('client-data-db v4 migration (displayName)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds SettingsRow.displayName as "" on a fresh install', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.displayName).toBe('');
  });

  it('on upgrade, backfills SettingsRow.displayName to "" for an existing v3 row', async () => {
    await plantV3DatabaseWithoutDisplayName();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.displayName).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- client-data-db-v4
```

Expected: FAIL — `settings.displayName` is `undefined`.

- [ ] **Step 3: Add the v4 migration + type field**

Open `apps/user-client/src/boot/client-data-db.ts`.

(a) In the `SettingsRow` interface (around line 11-21), add `displayName: string` after `id: 1`:

```ts
export interface SettingsRow {
  id: 1;
  displayName: string;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
  animationsEnabled: boolean;
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}
```

(b) Inside the `ClientDataDb` constructor, after the existing `this.version(3)…upgrade(…)` block (around line 188, right before the closing brace of the constructor), append:

```ts
    this.version(4)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.displayName — default '' means "use the username".
        const settings = await tx.table('settings').get(1);
        if (settings && typeof settings.displayName !== 'string') {
          await tx.table('settings').update(1, { displayName: '' });
        }
      });
```

(c) In `seedBuiltinsIfNeeded`, find the `db.settings.add({ … })` call (around line 287-298) and add `displayName: ''` after `id: 1,`:

```ts
      await db.settings.add({
        id: 1,
        displayName: '',
        globalUnlockerPrompt: '',
        globalAboutMe: '',
        defaultMindspaceId: aurumId,
        userTexture: 'cloudy',
        animationsEnabled: true,
        corsProxy: null,
        createdAt: now,
        updatedAt: now,
      });
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- client-data-db-v4
```

Expected: both cases PASS.

- [ ] **Step 5: Run the v3 migration test to confirm no regression**

```
pnpm --filter user-client test -- client-data-db-v3
```

Expected: all four v3 cases still pass.

## Task 7: Add `useDisplayName()` hook + tests

**Files:**
- Modify: `apps/user-client/src/data/settings.ts`
- Create: `apps/user-client/tests/data/use-display-name.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/data/use-display-name.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useDisplayName } from '../../src/data/settings.js';

function Probe(): JSX.Element {
  const name = useDisplayName();
  return <span data-testid="dn">{name}</span>;
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useDisplayName', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useSessionStore.setState({ session: null });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useSessionStore.setState({ session: null });
  });

  it('returns trimmed displayName when set', async () => {
    await getClientDataDb().settings.update(1, { displayName: '  Chris Tidesson  ' });
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('Chris Tidesson'));
  });

  it('falls back to username when displayName is empty', async () => {
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('chris151'));
  });

  it('falls back to username when displayName is whitespace only', async () => {
    await getClientDataDb().settings.update(1, { displayName: '   ' });
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('chris151'));
  });

  it('returns "—" when neither displayName nor session.username is available', async () => {
    useSessionStore.setState({ session: null });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('—'));
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- use-display-name
```

Expected: FAIL — `useDisplayName` is not exported.

- [ ] **Step 3: Implement the hook**

Open `apps/user-client/src/data/settings.ts`. Add at the top of the file (right under the existing imports):

```ts
import { useSessionStore } from '@chatsundere/ui-shared';
```

Append at the bottom of the file:

```ts
/**
 * Resolved display-name for the current user.
 *
 * Priority chain:
 *   1. settings.displayName.trim() if non-empty
 *   2. session.username
 *   3. '—' (renders an em-dash placeholder while the session is null)
 */
export function useDisplayName(): string {
  const settings = useSettings();
  const session = useSessionStore((s) => s.session);
  const trimmed = settings.data?.displayName?.trim();
  if (trimmed) return trimmed;
  return session?.username ?? '—';
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- use-display-name
```

Expected: all four cases PASS.

## Task 8: Add Display-Name input to AccountSection

**Files:**
- Modify: `apps/user-client/src/routes/app/account-sections/account-section.tsx`
- Create: `apps/user-client/tests/routes/account.display-name.test.tsx`

A new block above the existing username section. Live-write on blur via `useUpdateSettings`. Max 60 chars (enforced by `maxLength`). Trim normalises whitespace-only to empty.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/account.display-name.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { AccountSection } from '../../src/routes/app/account-sections/account-section.js';

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountSection display-name input', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders a Display Name input with the current displayName prefilled', async () => {
    await getClientDataDb().settings.update(1, { displayName: 'Chris Tidesson' });
    renderSection();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    expect(input.value).toBe('Chris Tidesson');
    expect(input.maxLength).toBe(60);
  });

  it('persists a trimmed displayName on blur', async () => {
    renderSection();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    fireEvent.change(input, { target: { value: '  Chris Tidesson  ' } });
    fireEvent.blur(input);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.displayName).toBe('Chris Tidesson');
    });
  });

  it('normalises whitespace-only input to empty string on blur', async () => {
    await getClientDataDb().settings.update(1, { displayName: 'something' });
    renderSection();
    const input = await screen.findByLabelText<HTMLInputElement>(/display name/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.displayName).toBe('');
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- account.display-name
```

Expected: FAIL — there is no Display Name input.

- [ ] **Step 3: Implement the input block in AccountSection**

Open `apps/user-client/src/routes/app/account-sections/account-section.tsx`. Add to the imports near the top (after the existing `react` import):

```ts
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
```

In the component body, BEFORE the `useEffect` that loads the local account (around line 41), add:

```ts
const settings = useSettings();
const updateSettings = useUpdateSettings();
const [draftDisplayName, setDraftDisplayName] = useState('');
const [displayNameInitialised, setDisplayNameInitialised] = useState(false);

useEffect(() => {
  if (!displayNameInitialised && settings.data) {
    setDraftDisplayName(settings.data.displayName ?? '');
    setDisplayNameInitialised(true);
  }
}, [settings.data, displayNameInitialised]);
```

In the JSX, at the very top of the rendered `<div className="space-y-10">` block (right after the opening tag, BEFORE the `{/* Username */}` block), insert the Display Name block:

```tsx
{/* Display name — optional, falls back to username when empty. */}
<div className="space-y-3">
  <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
    Display name <span className="text-paper-soft/60">(optional)</span>
  </p>
  <input
    id="display-name"
    aria-label="Display name"
    type="text"
    maxLength={60}
    value={draftDisplayName}
    onChange={(e) => setDraftDisplayName(e.target.value)}
    onBlur={() => {
      const trimmed = draftDisplayName.trim();
      setDraftDisplayName(trimmed);
      if (trimmed !== (settings.data?.displayName ?? '')) {
        void updateSettings.mutateAsync({ displayName: trimmed });
      }
    }}
    className="w-full rounded-[var(--radius-input)] bg-ink px-3 py-2 font-mono text-sm text-paper ring-1 ring-inset ring-aurora-700/40 focus:outline-none focus:ring-aurora-500"
  />
  <p className="text-xs leading-relaxed text-paper-soft">
    How you appear across Chatsundere. Empty? Your username is used.
  </p>
</div>
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- account.display-name
```

Expected: all three cases PASS.

- [ ] **Step 5: Run all account tests to confirm no regressions**

```
pnpm --filter user-client test -- account
```

Expected: all green.

## Task 9: Entrance Hall consumes useDisplayName + commit Polish 3/4

**Files:**
- Modify: `apps/user-client/src/routes/app/entrance-hall.tsx`
- Create: `apps/user-client/tests/routes/entrance-hall.greeting.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/entrance-hall.greeting.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { EntranceHall } from '../../src/routes/app/entrance-hall.js';

function renderHall() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EntranceHall />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Entrance Hall greeting', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useSessionStore.setState({ session: null });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useSessionStore.setState({ session: null });
  });

  it('shows the display name when set', async () => {
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    await getClientDataDb().settings.update(1, { displayName: 'Chris Tidesson' });
    renderHall();
    await waitFor(() => expect(screen.getByText('Chris Tidesson')).toBeInTheDocument());
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  it('falls back to the username when display name is empty', async () => {
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderHall();
    await waitFor(() => expect(screen.getByText('chris151')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- entrance-hall.greeting
```

Expected: FAIL — the first case (display name 'Chris Tidesson') is not satisfied because the current code reads `session.username`.

- [ ] **Step 3: Update `entrance-hall.tsx`**

Open `apps/user-client/src/routes/app/entrance-hall.tsx`. Add to the imports:

```ts
import { useDisplayName } from '../../data/settings.js';
```

In the `EntranceHall` component body, add right after the existing `const session = …` line:

```ts
const displayName = useDisplayName();
```

In the JSX, find this block (around line 82-91):

```tsx
<div className="text-center">
  <div className="text-[10px] uppercase tracking-[0.3em] text-paper-soft">Welcome back</div>
  <div
    className="mt-2 text-3xl font-display"
    style={{ color: 'var(--mindspace-text-primary)' }}
  >
    {session?.username ?? '—'}
  </div>
</div>
```

Replace the inner `{session?.username ?? '—'}` with `{displayName}`:

```tsx
<div className="text-center">
  <div className="text-[10px] uppercase tracking-[0.3em] text-paper-soft">Welcome back</div>
  <div
    className="mt-2 text-3xl font-display"
    style={{ color: 'var(--mindspace-text-primary)' }}
  >
    {displayName}
  </div>
</div>
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm --filter user-client test -- entrance-hall.greeting
```

Expected: both cases PASS.

- [ ] **Step 5: Run the full user-client test suite**

```
pnpm --filter user-client test
```

Expected: all green.

- [ ] **Step 6: Run typecheck + lint + build**

```
pnpm typecheck && pnpm lint && pnpm --filter user-client run build
```

Expected: clean.

- [ ] **Step 7: Commit Polish 3/4**

```bash
git add apps/user-client/src/boot/client-data-db.ts \
        apps/user-client/src/data/settings.ts \
        apps/user-client/src/routes/app/account-sections/account-section.tsx \
        apps/user-client/src/routes/app/entrance-hall.tsx \
        apps/user-client/tests/boot/client-data-db-v4.test.ts \
        apps/user-client/tests/data/use-display-name.test.tsx \
        apps/user-client/tests/routes/account.display-name.test.tsx \
        apps/user-client/tests/routes/entrance-hall.greeting.test.tsx
git status   # confirm only these files are staged
git commit -m "$(cat <<'EOF'
Polish 3/4 — Display-Name in My Account + Hall greeting

Add SettingsRow.displayName as a Dexie v4 schema migration (backfills
'' on existing rows; v1 seed writes '' on fresh installs). Surface the
field in My Account → Account section as an optional input with max
60 chars, persisted on blur via useUpdateSettings; trimmed on save,
whitespace-only normalises to empty.

useDisplayName() hook gives every consumer a single resolution path:
trimmed displayName → session.username → '—'. Entrance Hall's
"WELCOME BACK" greeting is the first consumer; the Phase-3 chat
topbar will be the second.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

# COMMIT 4 of 4 — Polish 4/4: Splash-Screen

## Task 10: SplashContext + SplashOverlay skeleton

**Files:**
- Create: `apps/user-client/src/components/SplashContext.tsx`
- Create: `apps/user-client/src/components/SplashOverlay.tsx`
- Create: `apps/user-client/tests/components/SplashOverlay.test.tsx`

The skeleton handles: sessionStorage gating, render-or-not decision, tap-to-skip, Escape-to-skip, 3-second hard-timeout. NO animation yet — that comes in Task 11. NO FLIP migration yet — that comes in Task 12.

- [ ] **Step 1: Write the failing tests**

Create `apps/user-client/tests/components/SplashOverlay.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplashContext } from '../../src/components/SplashContext.js';
import { SplashOverlay } from '../../src/components/SplashOverlay.js';

function renderOverlay() {
  const ref = { current: null } as { current: HTMLElement | null };
  return render(
    <SplashContext.Provider value={{ topbarLogoRef: ref }}>
      <SplashOverlay />
    </SplashContext.Provider>,
  );
}

describe('SplashOverlay', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('renders the overlay on first mount in a fresh session', () => {
    renderOverlay();
    expect(screen.getByLabelText(/skip intro/i)).toBeInTheDocument();
    expect(screen.getByText('Chatsundere')).toBeInTheDocument();
  });

  it('does not render when sessionStorage marks the splash as already shown', () => {
    sessionStorage.setItem('splashShown', '1');
    renderOverlay();
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });

  it('unmounts and persists splashShown when tapped', () => {
    renderOverlay();
    fireEvent.click(screen.getByLabelText(/skip intro/i));
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
    expect(sessionStorage.getItem('splashShown')).toBe('1');
  });

  it('unmounts when Escape is pressed', () => {
    renderOverlay();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });

  it('unmounts via hard-timeout after 3000ms', () => {
    renderOverlay();
    expect(screen.getByLabelText(/skip intro/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
    expect(sessionStorage.getItem('splashShown')).toBe('1');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- SplashOverlay
```

Expected: FAIL with "Failed to resolve import" for SplashContext / SplashOverlay.

- [ ] **Step 3: Implement SplashContext**

Create `apps/user-client/src/components/SplashContext.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, type RefObject } from 'react';

interface SplashContextValue {
  /** Ref to the topbar's brand-logo-text span. Read by SplashOverlay
   *  to compute the FLIP target position. May be null briefly during
   *  mount or in tests that don't render the Root layout. */
  topbarLogoRef: RefObject<HTMLElement | null>;
}

export const SplashContext = createContext<SplashContextValue>({
  topbarLogoRef: { current: null },
});
```

- [ ] **Step 4: Implement SplashOverlay skeleton**

Create `apps/user-client/src/components/SplashOverlay.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'splashShown';
const HARD_TIMEOUT_MS = 3000;

/**
 * Cold-start splash overlay. Renders only when sessionStorage has not yet
 * marked the splash as shown. Layered above the routing tree at z-100;
 * the underlying route mounts and hydrates as normal while the overlay
 * is up.
 *
 * Skip paths:
 *   - click/tap anywhere in the overlay
 *   - Escape key
 *   - HARD_TIMEOUT_MS hard cap, independent of animation state
 *   - prefers-reduced-motion: handled in the CSS (no movement, just fade)
 *
 * Note: animation timing and FLIP migration are pure CSS + a single
 * imperative effect; this file owns the lifecycle only.
 */
export function SplashOverlay(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STORAGE_KEY) === null;
  });

  useEffect(() => {
    if (!show) return;
    const dismiss = () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setShow(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    const timeout = window.setTimeout(dismiss, HARD_TIMEOUT_MS);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', onKey);
    };
  }, [show]);

  if (!show) return null;

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  };

  return (
    <div
      role="button"
      aria-label="Skip intro"
      tabIndex={0}
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') dismiss();
      }}
      className="splash-overlay fixed inset-0 z-[100] flex items-center justify-center cursor-pointer"
    >
      <div className="splash-content flex flex-col items-center gap-6 text-center px-6">
        <div className="splash-logo relative inline-flex items-baseline">
          <span className="brand-logo-text font-display text-5xl">Chatsundere</span>
          <span
            className="brand-logo-twinkle"
            aria-hidden="true"
            style={{ fontSize: '1.4rem' }}
          >
            ✦
          </span>
        </div>
        <p className="splash-tagline text-base text-paper">
          <span style={{ color: '#ff4dc8', fontWeight: 600 }}>Tsuntsun</span> towards regulation.
          {' '}
          <span style={{ color: '#ffd56b', fontWeight: 600 }}>Deredere</span> towards you.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```
pnpm --filter user-client test -- SplashOverlay
```

Expected: all five cases PASS.

## Task 11: Add splash CSS animations + reduced-motion fallback

**Files:**
- Modify: `apps/user-client/src/index.css`

Pure CSS. The component already references classes; this task wires them up.

- [ ] **Step 1: Append the splash rules to `index.css`**

Open `apps/user-client/src/index.css`. After the `.brand-logo*` block you added in Task 1, append:

```css
/* ===== Splash overlay ===== */

.splash-overlay {
  background:
    radial-gradient(ellipse at 20% 30%, rgba(255, 77, 200, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(77, 208, 255, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 50%, rgba(255, 213, 107, 0.04) 0%, transparent 60%),
    #050210;
  animation: splash-bg-fade 2300ms ease-out forwards;
}

.splash-content {
  animation: splash-content-fade 400ms ease-out;
}

.splash-tagline {
  animation: splash-tagline-drift 600ms ease-out 1200ms forwards;
}

@keyframes splash-bg-fade {
  0%, 87% { opacity: 1; }
  100%    { opacity: 0; }
}

@keyframes splash-content-fade {
  0%   { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes splash-tagline-drift {
  0%   { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(40px); }
}

@media (prefers-reduced-motion: reduce) {
  .splash-overlay { animation: splash-bg-reduced 200ms ease-out forwards; }
  .splash-content { animation: none; opacity: 1; }
  .splash-tagline { animation: none; opacity: 1; }
  .splash-logo    { transform: none !important; transition: none !important; }
}

@keyframes splash-bg-reduced {
  0%, 50% { opacity: 1; }
  100%    { opacity: 0; }
}
```

- [ ] **Step 2: Run the SplashOverlay test to confirm CSS additions don't break anything**

```
pnpm --filter user-client test -- SplashOverlay
```

Expected: still passes (CSS doesn't affect render assertions, but a regression here would mean the class change broke a selector).

- [ ] **Step 3: Run the build to confirm CSS compiles cleanly**

```
pnpm --filter user-client run build
```

Expected: clean Vite build (no warnings about unknown CSS rules).

## Task 12: Implement the FLIP migration of the splash logo

**Files:**
- Modify: `apps/user-client/src/components/SplashOverlay.tsx`
- Modify: `apps/user-client/tests/components/SplashOverlay.test.tsx` (add a guard test for missing topbar ref)

At `t = 1500ms` the splash logo measures itself and the topbar logo's bounding rect; computes a transform that takes "centred big" → "topbar small" with `transform-origin: top left`; applies it with a 500ms `transition: transform`. At `t = 2000ms` it dispatches a custom event so the Root layout reveals the topbar logo (which was held `opacity: 0` until now). If the topbar ref is null, the FLIP is skipped — the splash still fades out and dismisses normally.

- [ ] **Step 1: Add the failing safety test**

Add the following case to `apps/user-client/tests/components/SplashOverlay.test.tsx` inside the existing `describe(…)` block:

```tsx
  it('dismisses cleanly when topbarLogoRef is null', () => {
    // FLIP migration must be skipped if the ref is null; the overlay
    // still fades out and unmounts on the hard timeout.
    renderOverlay();
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });
```

(This already passes from Task 10 because we don't attempt the FLIP yet — but make it explicit so any future change cannot break the no-ref path.)

- [ ] **Step 2: Run the existing tests to confirm baseline green**

```
pnpm --filter user-client test -- SplashOverlay
```

Expected: all six cases PASS.

- [ ] **Step 3: Extend SplashOverlay with the FLIP migration**

Open `apps/user-client/src/components/SplashOverlay.tsx`. Add imports:

```ts
import { useContext, useEffect, useRef, useState } from 'react';
import { SplashContext } from './SplashContext.js';
```

In the component body, add a ref to the splash logo:

```ts
const splashLogoRef = useRef<HTMLDivElement>(null);
const { topbarLogoRef } = useContext(SplashContext);
```

Bind `splashLogoRef` to the `<div className="splash-logo …">` element:

```tsx
<div ref={splashLogoRef} className="splash-logo relative inline-flex items-baseline">
```

Add a second `useEffect` for the FLIP migration. Put it AFTER the lifecycle-management effect from Task 10:

```ts
useEffect(() => {
  if (!show) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let cancelled = false;
  const flipTimer = window.setTimeout(() => {
    if (cancelled) return;
    const splash = splashLogoRef.current;
    const topbar = topbarLogoRef.current;
    if (!splash || !topbar) return; // safety: cannot migrate without targets
    const splashRect = splash.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    if (splashRect.width === 0 || topbarRect.width === 0) return;
    const scale = topbarRect.width / splashRect.width;
    const dx = topbarRect.left - splashRect.left;
    const dy = topbarRect.top - splashRect.top;
    splash.style.transformOrigin = 'top left';
    splash.style.transition = 'transform 500ms ease-in-out';
    splash.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    // After the migration completes, signal the topbar to reveal itself.
    window.setTimeout(() => {
      if (!cancelled) window.dispatchEvent(new Event('chatsundere:splash-flip-done'));
    }, 500);
  }, 1500);
  return () => {
    cancelled = true;
    window.clearTimeout(flipTimer);
  };
}, [show, topbarLogoRef]);
```

- [ ] **Step 4: Run the SplashOverlay tests to confirm everything still passes**

```
pnpm --filter user-client test -- SplashOverlay
```

Expected: all six cases PASS. (The FLIP effect runs but has no observable test surface; the test environment's `matchMedia` may report `undefined` for `.matches`, which is fine — the effect just no-ops or skips on missing rects.)

## Task 13: Mount SplashOverlay in Root + commit Polish 4/4

**Files:**
- Modify: `apps/user-client/src/routes/root.tsx`

Mount `<SplashContext.Provider>` around the layout, attach the topbar logo ref, listen for the FLIP-done event to flip the topbar's `opacity` from `0` to `1`, and mount `<SplashOverlay />`.

- [ ] **Step 1: Write the failing test**

Add a new test file `apps/user-client/tests/routes/root.splash.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Root } from '../../src/routes/root.js';

describe('Root mounts the splash overlay', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders SplashOverlay on first mount (cold start)', () => {
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/skip intro/i)).toBeInTheDocument();
  });

  it('does not render SplashOverlay when splashShown is already set', () => {
    sessionStorage.setItem('splashShown', '1');
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm --filter user-client test -- root.splash
```

Expected: FAIL — Root does not currently mount the overlay.

- [ ] **Step 3: Update `root.tsx`**

Open `apps/user-client/src/routes/root.tsx`. Add imports:

```ts
import { useEffect, useRef, useState } from 'react';
import { SplashContext } from '../components/SplashContext.js';
import { SplashOverlay } from '../components/SplashOverlay.js';
```

In the `Root` component body, add the topbar logo ref and a `topbarLogoVisible` state:

```ts
const topbarLogoRef = useRef<HTMLElement | null>(null);
const [topbarLogoVisible, setTopbarLogoVisible] = useState<boolean>(() => {
  // Topbar logo is hidden during the splash; visible immediately otherwise
  // (no splash this session, or reduced motion).
  if (typeof window === 'undefined') return true;
  if (sessionStorage.getItem('splashShown') !== null) return true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  return false;
});

useEffect(() => {
  if (topbarLogoVisible) return;
  const onFlipDone = () => setTopbarLogoVisible(true);
  window.addEventListener('chatsundere:splash-flip-done', onFlipDone);
  // Safety: if the splash dismisses without a FLIP (tap-to-skip, hard timeout),
  // still reveal the topbar logo so the user never sees the blank header.
  const onStorage = () => {
    if (sessionStorage.getItem('splashShown') !== null) setTopbarLogoVisible(true);
  };
  // Poll once per 150ms for at most 3.5 seconds — sessionStorage events don't
  // fire in the same document, so we cannot listen for them.
  let elapsed = 0;
  const pollId = window.setInterval(() => {
    onStorage();
    elapsed += 150;
    if (elapsed > 3500) window.clearInterval(pollId);
  }, 150);
  return () => {
    window.removeEventListener('chatsundere:splash-flip-done', onFlipDone);
    window.clearInterval(pollId);
  };
}, [topbarLogoVisible]);
```

Update the `<Link to="/" …>` element to:
- attach the ref to the inner `.brand-logo-text` span (NOT the `<Link>`; we want the wordmark's rect, not the anchor's),
- gate visibility on `topbarLogoVisible`:

```tsx
<Link to="/" className="brand-logo" style={{ opacity: topbarLogoVisible ? 1 : 0 }}>
  <span
    ref={(el) => { topbarLogoRef.current = el; }}
    className="brand-logo-text"
  >
    Chatsundere
  </span>
  <span className="brand-logo-twinkle" aria-hidden="true">✦</span>
</Link>
```

Wrap the entire returned tree in `<SplashContext.Provider value={{ topbarLogoRef }}>` and mount `<SplashOverlay />` AFTER the layout's `<main>` (so it lives at the bottom of the layout tree, on top of all other content via its `z-100`):

```tsx
return (
  <SplashContext.Provider value={{ topbarLogoRef }}>
    <div className="relative isolate min-h-dvh overflow-x-hidden">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-sm lg:px-6 lg:py-4">
        <Link to="/" className="brand-logo" style={{ opacity: topbarLogoVisible ? 1 : 0 }}>
          <span
            ref={(el) => { topbarLogoRef.current = el; }}
            className="brand-logo-text"
          >
            Chatsundere
          </span>
          <span className="brand-logo-twinkle" aria-hidden="true">✦</span>
        </Link>
        <div className="flex items-center gap-2 lg:gap-3">
          {session && (
            <span className="hidden font-mono text-xs text-paper-soft lg:inline">
              {session.username}
            </span>
          )}
          <ConnectivityBadge />
        </div>
      </header>
      <UpdateBanner />
      {showRolledBackBanner && (
        <div className="flex items-center justify-between gap-4 bg-warning/10 px-6 py-2 ring-1 ring-inset ring-warning/30">
          <p className="font-mono text-xs text-warning">{copy.stagingBanner.rolledBack}</p>
          <button
            type="button"
            onClick={dismissBanner}
            className="shrink-0 font-mono text-xs uppercase tracking-wider text-warning/70 hover:text-warning"
          >
            {copy.stagingBanner.dismissCta}
          </button>
        </div>
      )}
      <main className="mx-auto w-full max-w-[420px] px-6 pb-12 lg:max-w-[640px]">
        <Outlet />
      </main>
      <SplashOverlay />
    </div>
  </SplashContext.Provider>
);
```

(Adapt the existing structure carefully — the only changes from current `root.tsx` are: imports, the topbarLogoRef + state + effect, the `<Link>`'s inner markup + visibility gating, the `<SplashContext.Provider>` wrapping, and the `<SplashOverlay />` mount.)

- [ ] **Step 4: Update `root.brand-logo.test.tsx` to clear sessionStorage so the existing assertions keep passing**

Open `apps/user-client/tests/routes/root.brand-logo.test.tsx`. Add `beforeEach` + `afterEach` to clear sessionStorage:

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
…
describe('Root brand logo', () => {
  beforeEach(() => {
    sessionStorage.setItem('splashShown', '1'); // skip splash to assert on topbar logo
  });
  afterEach(() => {
    sessionStorage.clear();
  });
  …
});
```

(The existing assertions on the topbar logo only need the topbar logo visible. With `splashShown` set, the topbar logo renders at `opacity: 1` from `t = 0`, and the splash overlay does not render — clean.)

- [ ] **Step 5: Run all root tests**

```
pnpm --filter user-client test -- root
```

Expected: `root.brand-logo` PASS, `root.splash` PASS.

- [ ] **Step 6: Run the full user-client test suite**

```
pnpm --filter user-client test
```

Expected: all green.

- [ ] **Step 7: Run typecheck + lint + build**

```
pnpm typecheck && pnpm lint && pnpm --filter user-client run build
```

Expected: clean.

- [ ] **Step 8: Commit Polish 4/4**

```bash
git add apps/user-client/src/components/SplashContext.tsx \
        apps/user-client/src/components/SplashOverlay.tsx \
        apps/user-client/src/index.css \
        apps/user-client/src/routes/root.tsx \
        apps/user-client/tests/components/SplashOverlay.test.tsx \
        apps/user-client/tests/routes/root.brand-logo.test.tsx \
        apps/user-client/tests/routes/root.splash.test.tsx
git status   # confirm only these files are staged
git commit -m "$(cat <<'EOF'
Polish 4/4 — Splash-Screen overlay with cold-start FLIP migration

Mount a session-gated splash overlay (sessionStorage.splashShown) at
the Root layout level. The overlay renders the gradient wordmark
'Chatsundere' + the teaser-page tagline against a radial-glow
background. At t=1500ms a transform-based migration carries the
splash logo to the topbar logo's measured position (FLIP-style:
single translate+scale with transform-origin: top left), and at
t=2000ms the real topbar logo reveals via opacity.

Skip paths: tap/click, Escape, prefers-reduced-motion (200ms
crossfade), 3-second hard timeout. SplashContext exposes the topbar
logo ref so the overlay can measure without DOM queries.

The topbar logo is held opacity: 0 until either the FLIP completes
or the splash dismisses without one (polled once per 150ms for at
most 3.5s as a safety net).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Update STATUS-CLIENT-ONLY.md

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Read the current STATUS**

Run:
```
cat obsidian/STATUS-CLIENT-ONLY.md | head -30
```

Note the `Last updated:` line and the structure of the most-recent "Done" block (Phase 2.7).

- [ ] **Step 2: Edit STATUS-CLIENT-ONLY.md**

Open `obsidian/STATUS-CLIENT-ONLY.md`. Update the top `Last updated:` line to 2026-05-24 and the count-of-tests for the latest user-client suite (run `pnpm --filter user-client test` and read the count).

Append a new "Done" block AFTER the Phase 2.7 block, before "## Briefed, awaiting implementation":

```markdown
- **Phase 2.8 — Polish Block (2026-05-24)**. Four squashed commits on
  master following Chris's pre-very-early-alpha polish ask. Driven by
  subagent-driven-development per task. What landed:
  - `apps/user-client/src/index.css` — new `.brand-logo` rules (cyan→
    pink→gold gradient + `✦` twinkle, identical to docs/index.html)
    plus `.splash-*` keyframes and reduced-motion overrides.
  - `apps/user-client/src/routes/root.tsx` — italic Lora wordmark
    replaced by the gradient brand mark; new topbarLogoRef passed
    through `SplashContext` to the overlay; topbar logo held
    `opacity: 0` until the splash FLIP completes (or until the splash
    dismisses without one — 150ms safety poll).
  - `apps/user-client/src/components/EditorSticky.tsx` (new) — shared
    sticky-region wrapper adopted by Persona Editor (topbar +
    Continue/New Chat/Incognito quick-actions in edit mode), My
    Settings (topbar only), and My Account (topbar only).
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v4 migration
    adds `SettingsRow.displayName: string`, backfills `''` on existing
    rows, seeds `''` on fresh installs.
  - `apps/user-client/src/data/settings.ts` — `useDisplayName()` hook:
    trimmed `displayName` → `session.username` → `'—'`.
  - `apps/user-client/src/routes/app/account-sections/account-section.tsx`
    — new Display-Name input block above the existing username
    section; live-write on blur via `useUpdateSettings`; max 60
    chars; whitespace-only normalises to empty.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — "WELCOME
    BACK" greeting now uses `useDisplayName()` instead of
    `session?.username`.
  - `apps/user-client/src/components/{SplashContext,SplashOverlay}.tsx`
    (new) — cold-start splash overlay gated by `sessionStorage.splashShown`.
    Tap/Escape/3s-hard-timeout skip paths; `prefers-reduced-motion`
    reduces to a 200ms crossfade. FLIP migration computes
    `transform: translate(Δx,Δy) scale(s)` from `getBoundingClientRect`
    deltas and applies it with `transition: transform 500ms ease-in-out`.
  - Tests: 20+ new Vitest cases (EditorSticky 4, SplashOverlay 6,
    client-data-db-v4 2, useDisplayName 4, account.display-name 3,
    entrance-hall.greeting 2, root.brand-logo 2, root.splash 2,
    persona-editor.sticky 1, settings.sticky 1, account.sticky 1).
    All user-client tests pass; llm-unified Bun tests untouched and
    green.
```

Also update the "Doing now" section:

```markdown
## Doing now

Phase 2.8 finished. Paused for Chris's iteration-5 manual smoke covering
the new brand logo (gradient + twinkle), the sticky-header pattern on
all three editor-class routes, the Display-Name field with Hall
greeting fallback, and the cold-start splash overlay (full motion, tap-
to-skip, Escape, reduced-motion fallback, 3s safety timeout).
```

And the "Next session" block — replace the existing iteration-4 smoke item with the iteration-5 smoke checklist, then keep "Phase 3 brainstorm + plan" and "Phase 3 execution" as before:

```markdown
## Next session

1. **Chris's iteration-5 smoke after Phase 2.8** — reload the PWA and
   walk through:
   - **Brand logo (top-left, every route):** gradient cyan→pink→gold
     'Chatsundere', no italic, with the gold `✦` twinkling on the same
     3-second cadence as chatsune.me. With OS-level reduced-motion on,
     the `✦` is visible at lower opacity but does not animate.
   - **Sticky header (Persona Editor edit-mode):** scrolling keeps
     `← Edit Persona  [Save & Back]` plus the Continue / New Chat /
     Incognito row glued to the top. Identity, Custom Instructions,
     Behavior, Mindspace-Override, About-Me-Override, and the
     Delete-zone all scroll underneath the blurred sticky bar.
   - **Sticky header (Persona Editor create-mode):** only the topbar is
     sticky; no quick-actions row.
   - **Sticky header (My Settings, My Account):** only the topbar is
     sticky.
   - **Display Name (My Account → Account section):** type 'Chris
     Tidesson', blur. Go to Entrance Hall — greeting reads "WELCOME
     BACK / Chris Tidesson". Clear the field, blur — greeting falls
     back to the username.
   - **Splash (cold start):** quit and relaunch the PWA. Splash plays:
     gradient background fades in, 'Chatsundere' + tagline appear,
     tagline drifts down and fades, 'Chatsundere' wanders and shrinks
     into the topbar position, overlay fades. Then F5 — splash does
     NOT replay. Quit + relaunch — splash DOES replay.
   - **Splash skip paths:** new session, tap during the animation →
     overlay vanishes; new session, Escape during the animation →
     overlay vanishes; reduced-motion enabled → splash is a 200ms
     crossfade with no movement.

2. **Phase 3 brainstorm + plan** — walk through the chat surface
   wireframes in `chatsundere-prototype.html` (Reading Mode +
   Interaction Mode + Cockpit). Open the ADR "Tool Display Position"
   discussion.

3. **Phase 3 execution** — subagent-driven, same pattern as Phases
   1, 2, 2.5, 2.6, 2.7, 2.8.
```

- [ ] **Step 3: Commit the STATUS update**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git status   # confirm only this file is staged
git commit -m "$(cat <<'EOF'
Update STATUS-CLIENT-ONLY for Phase 2.8 (Polish Block) [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Final verification — run the full test suite + typecheck + lint + build**

```
pnpm --filter user-client test && pnpm typecheck && pnpm lint && pnpm --filter user-client run build
```

Expected: all green. Five commits on `master`:

```
<sha 5>  Update STATUS-CLIENT-ONLY for Phase 2.8 (Polish Block) [skip ci]
<sha 4>  Polish 4/4 — Splash-Screen overlay with cold-start FLIP migration
<sha 3>  Polish 3/4 — Display-Name in My Account + Hall greeting
<sha 2>  Polish 2/4 — EditorSticky pattern across editor-class routes
<sha 1>  Polish 1/4 — Brand logo style (gradient + twinkle)
```

- [ ] **Step 5: Report back**

Summarise to Chris: count of commits landed, count of tests added, count of total user-client tests now passing, and the iteration-5 smoke list he can walk on his small-Chromium-viewport profile.
