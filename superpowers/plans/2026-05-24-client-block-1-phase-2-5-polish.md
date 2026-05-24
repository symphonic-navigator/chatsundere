# Client Block 1 — Phase 2.5 (Polish & Bug-Bash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the Phase-2 surfaces (Settings, Circle, Persona Editor,
Entrance Hall) and a device-tested experience: kill regressions Chris caught during smoke
test, port the Lora serif and Inter sans typography from `chatsune`, port the kollision-
free monogram algorithm, separate the texture state from the mindspace row so the picker
no longer fights itself, make textareas grow with their content, and tighten the
ProviderSheet so it's actually usable.

**Architecture:** Mostly local to `apps/user-client`. One schema migration (Dexie v3)
adds `SettingsRow.userTexture` and `PersonaRow.textureOverride` and demotes
`MindspaceRow.texture` to a seed-default — texture is a *user/persona* property, not a
mindspace property. The mindspace resolver picks up the new fields. The
`MindspaceLayer` is repositioned to a fixed full-viewport wrapper so the background
holds across scrolled pages. The `MindspacePicker` is refactored to source texture
from its parent's controlled state, not from the selected row. The `ProviderSheet`
loses its auto-save-on-close behaviour in favour of an explicit Save button, gets an
opaque backdrop, and stops corrupting writes via stale TanStack-Query cache reads.
The `PersonaEditor` is restructured so Identity sits outside the accordion (always
visible) and required-field markers (red `✕`) surface on both the accordion header
(when collapsed) and the field itself (when open). A small `AutoSizeTextarea`
component replaces the four growable text inputs across Settings and Persona Editor.
The kollision-free monogram algorithm from `chatsune/backend/modules/persona/_monogram.py`
is ported to TypeScript, replacing the naïve first-two-chars approach in
`lib/monogram.ts`. Two woff2 font assets land in `public/fonts/` (Lora-Regular,
Lora-Italic from `chatsune`) plus Inter-Regular / Inter-Medium (downloaded fresh from
the Google Fonts CDN bundle and self-hosted, no runtime CDN call). The Tailwind v4
`@theme` declarations are extended so `font-display` resolves to Lora and the sans
default resolves to Inter; mistaken `text-bg` / `bg-bg` usages — undefined under
the current theme — get corrected to `text-ink` / `bg-ink`.

**Tech Stack:** TypeScript strict, React 18, Tailwind v4 (`@theme` config in
`index.css`), Dexie 4 with `.upgrade()` migration, TanStack Query v5, Vitest +
`@testing-library/react` + `fake-indexeddb/auto` for the frontend tests.

**References:**
- Spec: `superpowers/specs/2026-05-23-client-block-1-design.md` (extended with
  Decisions 29-35 as part of this phase)
- Status: `obsidian/STATUS-CLIENT-ONLY.md` (updated at squash)
- Source for Lora woff2: `~/workspace/chatsune/frontend/public/fonts/`
- Source for monogram algorithm: `~/workspace/chatsune/backend/modules/persona/_monogram.py`

---

## File Structure

### Created

- `apps/user-client/public/fonts/Lora-Regular.woff2` (copied from chatsune)
- `apps/user-client/public/fonts/Lora-Italic.woff2` (copied from chatsune)
- `apps/user-client/public/fonts/Inter-Regular.woff2` (downloaded once, vendored)
- `apps/user-client/public/fonts/Inter-Medium.woff2` (downloaded once, vendored)
- `apps/user-client/src/components/AutoSizeTextarea.tsx`
- `apps/user-client/tests/components/AutoSizeTextarea.test.tsx`
- `apps/user-client/tests/lib/monogram.test.ts`
- `apps/user-client/tests/boot/client-data-db-v3.test.ts`
- `apps/user-client/tests/components/MindspaceLayer.fullviewport.test.tsx`
- `apps/user-client/tests/components/MindspacePicker.controlled.test.tsx`
- `apps/user-client/tests/components/ProviderSheet.polish.test.tsx`
- `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`

### Modified

- `apps/user-client/src/index.css` (theme: font-display=Lora, font-sans=Inter,
  @font-face blocks for Lora + Inter, `--color-bg` → `--color-ink` semantic alias
  if any existing code relies on `bg-bg`/`text-bg`)
- `apps/user-client/src/lib/monogram.ts` (replace naïve impl with kollision-free port)
- `apps/user-client/src/boot/client-data-db.ts` (v3 migration: add
  `SettingsRow.userTexture`, `PersonaRow.textureOverride`; types updated)
- `apps/user-client/src/state/mindspace-resolver.ts` (texture priority:
  persona.textureOverride > settings.userTexture > mindspace.texture)
- `apps/user-client/src/state/mindspace.store.ts` (accept new texture sources;
  no longer reads `mindspace.texture` directly)
- `apps/user-client/src/components/MindspaceLayer.tsx` (wrap MindspaceTexture in
  a `position: fixed; inset: 0; pointer-events: none; z-index: -1` wrapper)
- `apps/user-client/src/components/MindspacePicker.tsx` (preview card renders a
  scaled `MindspaceTexture`; texture is parent-controlled and orthogonal to colour)
- `apps/user-client/src/components/ProviderSheet.tsx` (opaque bg, backdrop, explicit
  Save button, no auto-save-on-close, autocomplete attributes for password-manager
  suppression, proxy URL default `https://example.com`, Ollama save bug fix)
- `apps/user-client/src/components/PersonaCard.tsx` (use new monogram helper)
- `apps/user-client/src/routes/app/settings.tsx` (texture state wired to
  `SettingsRow.userTexture`; autosize textareas; remove `useUpdateMindspaceTexture`
  call path)
- `apps/user-client/src/routes/app/persona-editor.tsx` (Identity outside accordion,
  new section order, required-field markers, textureOverride wiring, autosize
  textareas)
- `apps/user-client/src/routes/app/circle.tsx` (FAB icon: `text-ink` instead of
  `text-bg`, use a proper `+` glyph that survives the colour fix)
- `apps/user-client/src/data/mindspaces.ts` (drop `useUpdateMindspaceTexture` —
  texture no longer lives on the mindspace row; type the hook out)
- `apps/user-client/src/data/settings.ts` (already provides `useUpdateSettings`;
  no API change, just used for new field)
- `apps/user-client/src/data/personas.ts` (same — `useUpdatePersona` now also
  patches `textureOverride`)
- `apps/user-client/tests/components/MindspacePicker.test.tsx` (existing — update
  to controlled-texture API)
- `apps/user-client/tests/components/ProviderSheet.test.tsx` (existing — update
  for new Save button + opaque bg)
- `apps/user-client/tests/routes/persona-editor.test.tsx` (existing — update for
  Identity-outside-accordion + new section order)
- `apps/user-client/tests/routes/settings.test.tsx` (existing — update for autosize
  textareas if assertions on textarea shape exist)
- `apps/user-client/tests/state/mindspace-resolver.test.ts` (existing — extend
  with new priority cases)
- `apps/user-client/tests/boot/client-data-db.test.ts` (existing — verify v3
  upgrade keeps v2 behaviour intact)

### Deleted

- `apps/user-client/tests/data/mindspaces.test.ts::useUpdateMindspaceTexture` (the
  specific test for the dropped hook — the file itself stays for `useMindspaces`)

---

## Pre-Existing Pitfalls (carry forward from Phase-1 + Phase-2 notes)

- **Vitest test glob is `tests/**/*.test.{ts,tsx}`** (not `src/**`). Put every new
  test file under `apps/user-client/tests/...`.
- **Biome rules to obey:**
  - `noForEach` — use `for...of` instead of `.forEach()`.
  - `noNonNullAssertion` — never use `!`; use explicit guards.
  - `useKeyWithClickEvents` / `useFocusableInteractive` — interactive `<div>`s need
    `role="button"`, `tabIndex={0}`, and `onKeyDown` handling for Space/Enter.
  - `organizeImports` will sort imports — keep SPDX header on line 1 followed by a
    blank line 2 before the first import.
- **SPDX header must be line 1, then blank line 2.** Every new file:
  ```ts
  // SPDX-License-Identifier: AGPL-3.0-only

  import …
  ```
- **`bun` for cross-package use:** if you need it directly, the path is
  `/home/chris/.bun/bin/bun`. For this phase all commands run under `pnpm` from
  the repo root, so this rarely matters.
- **Test renders that mount React-Router routes** need `MemoryRouter` from
  `react-router-dom` wrapping the component under test.
- **TanStack-Query cache is stale right after `mutateAsync`.** If a write needs
  the new value of a field it just wrote, *use the local variable*, do not re-
  read from `useXxx().data` — the cache hasn't been invalidated yet at that point.
- **`@chatsundere/llm-unified` and `@chatsundere/crypto` must be built before
  user-client tests pass** if their dist folders are missing. The standard
  recovery is `pnpm --filter @chatsundere/crypto build && pnpm --filter @chatsundere/llm-unified build`.
- **Run `pnpm lint` and `pnpm typecheck` from the repo root**, not from inside
  a workspace package — the Turbo pipeline only resolves correctly from the root.
- **The user-client uses Tailwind v4 with `@theme` inside CSS, not `tailwind.config.js`.**
  Adding a new colour or font goes into the `@theme` block in `src/index.css`.

---

## Task 0: Wire Lora and Inter font assets

**Files:**
- Create: `apps/user-client/public/fonts/Lora-Regular.woff2`
- Create: `apps/user-client/public/fonts/Lora-Italic.woff2`
- Create: `apps/user-client/public/fonts/Inter-Regular.woff2`
- Create: `apps/user-client/public/fonts/Inter-Medium.woff2`
- Modify: `apps/user-client/src/index.css` (add `@font-face` blocks; theme `--font-display` and `--font-sans`)

This is a mechanical task — no behavioural logic. No new tests; the visual
verification is in Chris's manual smoke at the end of the phase.

- [ ] **Step 1: Copy Lora woff2 assets from chatsune**

```bash
mkdir -p apps/user-client/public/fonts
cp ~/workspace/chatsune/frontend/public/fonts/Lora-Regular.woff2 apps/user-client/public/fonts/
cp ~/workspace/chatsune/frontend/public/fonts/Lora-Italic.woff2 apps/user-client/public/fonts/
ls -la apps/user-client/public/fonts/
```

Expected: `Lora-Regular.woff2` and `Lora-Italic.woff2` listed, file sizes ~30-50 KB each.

- [ ] **Step 2: Download Inter woff2 assets (Regular 400 and Medium 500)**

Inter is open source under SIL OFL. We self-host the two weights we actually use.
Use the upstream `rsms/inter` v4 release bundle which ships subsetted woff2 files.

```bash
cd apps/user-client/public/fonts
curl -fsSLo Inter-Regular.woff2 https://rsms.me/inter/font-files/InterVariable.woff2
ls -la Inter-Regular.woff2
```

Note: `InterVariable.woff2` covers the full weight axis (100-900) in one file
(~340 KB). We rename it to `Inter-Regular.woff2` for the @font-face declaration but
expose both 400 and 500 via the `font-weight` range. If the curl fails (rsms.me
unavailable), fall back to:

```bash
curl -fsSLo Inter-Regular.woff2 "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuLyfMZg.woff2"
```

If neither works, escalate as BLOCKED — Chris will source the woff2 manually.

For this phase a single variable file is enough; we do not need to ship `Inter-Medium.woff2`
as a separate file. **Delete the `Inter-Medium.woff2` line from the file list above and
proceed with the single variable file.**

```bash
ls -la apps/user-client/public/fonts/
```

Expected: 3 files (`Lora-Regular.woff2`, `Lora-Italic.woff2`, `Inter-Regular.woff2`).

- [ ] **Step 3: Add `@font-face` blocks at the top of `src/index.css`**

Edit `apps/user-client/src/index.css`. Insert after the `@import "tailwindcss";` line
and *before* the `@theme { … }` block:

```css
/* Self-hosted display + body type. Lora (serif) and Inter (variable sans). */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/Lora-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Lora';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/Lora-Italic.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/Inter-Regular.woff2') format('woff2-variations');
}
```

- [ ] **Step 4: Re-point the Tailwind theme tokens to the new fonts**

In the same file, inside the existing `@theme { … }` block, replace the existing
font declarations with:

```css
  --font-display: "Lora", Georgia, serif;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
```

(Tailwind v4 derives `font-sans` and `font-display` Tailwind classes from these tokens.)

- [ ] **Step 5: Run typecheck and build to ensure CSS still parses**

```bash
pnpm --filter @chatsundere/user-client build
```

Expected: build completes, no errors. Lora and Inter font files appear in `dist/fonts/`.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/public/fonts/ apps/user-client/src/index.css
git commit -m "$(cat <<'EOF'
Self-host Lora and Inter fonts

Replace the implicit Tailwind defaults with self-hosted Lora (serif,
copied from chatsune) and Inter (variable sans, downloaded from the
upstream rsms/inter v4 release). No CDN call at runtime.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Fix the invisible FAB `+` icon

**Files:**
- Modify: `apps/user-client/src/routes/app/circle.tsx:52-59`

`text-bg` is not defined in the Tailwind v4 `@theme` block in `src/index.css`, so
the resulting CSS variable is undefined and the glyph inherits its colour from the
parent — `text-paper` (a near-white). The FAB has a near-white background, so the
glyph disappears. The defined dark colour is `--color-ink`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/circle.fab-icon.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Circle } from '../../src/routes/app/circle.js';

describe('Circle FAB', () => {
  it('renders the + glyph with a dark text colour class so it stays visible on bg-paper', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Circle />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const fab = screen.getByRole('button', { name: /new persona/i });
    expect(fab.className).toMatch(/\btext-ink\b/);
    expect(fab.className).not.toMatch(/\btext-bg\b/);
    expect(fab).toHaveTextContent('+');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/circle.fab-icon.test.tsx
```

Expected: FAIL — current className contains `text-bg`, not `text-ink`.

- [ ] **Step 3: Edit `circle.tsx` to fix the colour**

Replace the FAB block (`apps/user-client/src/routes/app/circle.tsx:52-59`):

```tsx
      <button
        type="button"
        aria-label="New persona"
        onClick={() => navigate('/app/persona/new')}
        className="fixed bottom-6 right-6 z-10 grid h-14 w-14 place-items-center rounded-full bg-paper text-3xl leading-none text-ink shadow-2xl transition-transform hover:scale-105"
      >
        +
      </button>
```

(`text-2xl` → `text-3xl leading-none` for a more legible glyph; `text-bg` → `text-ink`.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/circle.fab-icon.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/circle.tsx apps/user-client/tests/routes/circle.fab-icon.test.tsx
git commit -m "$(cat <<'EOF'
Fix invisible FAB + glyph on My Circle

Replace undefined `text-bg` with `text-ink`. Bump font size from 2xl to
3xl with tight leading so the glyph reads clearly against bg-paper.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Port the kollision-free monogram algorithm

**Files:**
- Modify: `apps/user-client/src/lib/monogram.ts`
- Create: `apps/user-client/tests/lib/monogram.test.ts`

The current `monogramFor(name)` returns the first two uppercase characters,
which gives terrible results for "Sam" → "SA" / "Sammy" → "SA" (kollision) and
nothing usable for "🦊 fox" → "??". `chatsune` has a five-rule strategy that
prefers first+last initials of multi-word names, then iterates letter pairs to
find a kollision-free pair, then falls back to AA…ZZ. Port it to TypeScript.

Reference: `~/workspace/chatsune/backend/modules/persona/_monogram.py`.

- [ ] **Step 1: Write the failing tests**

Create `apps/user-client/tests/lib/monogram.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { generateMonogram } from '../../src/lib/monogram.js';

describe('generateMonogram', () => {
  it('uses first + last initial for multi-part names', () => {
    expect(generateMonogram('Wilhelm Friedrich', new Set())).toBe('WF');
  });

  it('uppercases the result', () => {
    expect(generateMonogram('wilhelm friedrich', new Set())).toBe('WF');
  });

  it('falls back to letter combinations within a single-word name', () => {
    expect(generateMonogram('Alex', new Set())).toBe('AL');
  });

  it('iterates non-adjacent pairs when the first two collide', () => {
    expect(generateMonogram('Alex', new Set(['AL']))).toBe('AE');
  });

  it('falls back to the doubled first letter if no combinations are free', () => {
    expect(generateMonogram('Ab', new Set(['AB']))).toBe('AA');
  });

  it('iterates AA … ZZ for names with no usable letters', () => {
    expect(generateMonogram('!!', new Set())).toBe('AA');
    expect(generateMonogram('!!', new Set(['AA']))).toBe('AB');
  });

  it('returns ?? as the ultimate fallback when every AA…ZZ is taken', () => {
    const all: Set<string> = new Set();
    for (let i = 65; i <= 90; i++) {
      for (let j = 65; j <= 90; j++) {
        all.add(String.fromCharCode(i) + String.fromCharCode(j));
      }
    }
    expect(generateMonogram('whatever', all)).toBe('??');
  });

  it('strips non-alpha when computing letter pools', () => {
    expect(generateMonogram('Liz 2.0', new Set())).toBe('LI');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @chatsundere/user-client test tests/lib/monogram.test.ts
```

Expected: most tests FAIL — current impl returns wrong values.

- [ ] **Step 3: Rewrite `src/lib/monogram.ts`**

Replace the file contents entirely:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generate a two-letter monogram for a name, preferring a kollision-free
 * pair from a known-occupied set. Port of
 * chatsune/backend/modules/persona/_monogram.py.
 *
 * Strategy:
 *  1. Multi-part name → first + last initial. Use if free.
 *  2. Single name → iterate every i<j letter pair (uppercase) until one is free.
 *  3. Single name → doubled first letter if every pair is taken.
 *  4. No usable letters → iterate AA … ZZ until one is free.
 *  5. Total saturation → return '??'.
 */
export function generateMonogram(name: string, existing: Set<string>): string {
  const letters = name.replace(/[^a-zA-Z]/g, '');
  const parts = name.split(/\s+/).filter((p) => p.length > 0);

  if (parts.length >= 2) {
    const firstInitial = firstLetter(parts[0]);
    const lastInitial = firstLetter(parts[parts.length - 1] ?? '');
    if (firstInitial && lastInitial) {
      const candidate = (firstInitial + lastInitial).toUpperCase();
      if (!existing.has(candidate)) return candidate;
    }
  }

  if (letters.length > 0) {
    const upper = letters.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      for (let j = i + 1; j < upper.length; j++) {
        const candidate = (upper[i] ?? '') + (upper[j] ?? '');
        if (candidate.length === 2 && !existing.has(candidate)) return candidate;
      }
    }
    const doubled = (upper[0] ?? '') + (upper[0] ?? '');
    if (doubled.length === 2 && !existing.has(doubled)) return doubled;
  }

  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const candidate = String.fromCharCode(a) + String.fromCharCode(b);
      if (!existing.has(candidate)) return candidate;
    }
  }

  return '??';
}

function firstLetter(part: string | undefined): string | null {
  if (!part) return null;
  for (const ch of part) {
    if (/[a-zA-Z]/.test(ch)) return ch;
  }
  return null;
}

/**
 * Convenience wrapper for callers that don't track kollisions (e.g. preview
 * fields, throwaway renders). Always returns *some* two-letter result.
 */
export function monogramFor(name: string): string {
  return generateMonogram(name || '?', new Set());
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @chatsundere/user-client test tests/lib/monogram.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Update `PersonaCard.tsx` to render via `monogramFor`**

Find the persona-card monogram render (search for `monogramFor` or for the line
that produces the two-letter tile inside `PersonaCard.tsx`) and confirm it already
calls `monogramFor(persona.name)`. If it imports a different helper, switch the
import to the new `monogramFor` from `../lib/monogram.js`.

- [ ] **Step 6: Run the full user-client test suite to catch any callers I missed**

```bash
pnpm --filter @chatsundere/user-client test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/lib/monogram.ts apps/user-client/tests/lib/monogram.test.ts apps/user-client/src/components/PersonaCard.tsx
git commit -m "$(cat <<'EOF'
Port kollision-free monogram algorithm from chatsune

Single character first-initial gave duplicate monograms for any two
personas whose names share a leading letter. The chatsune algorithm
iterates first+last initial, then letter pairs, then AA…ZZ — guaranteed
two characters unless every combination is taken.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Schema v3 — texture as user/persona property

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/tests/boot/client-data-db-v3.test.ts`

Texture is currently stored on `MindspaceRow.texture` and the `MindspacePicker`
re-reads it from there. Result: changing the colour also changes the texture (because
each mindspace row remembers its own texture), which is what Chris saw when the
preview "sprang wild umher". Texture is conceptually a user choice — when I pick
Crimson with Aurora and then switch to Verdan, I expect to keep Aurora. Move the
authoritative source to `SettingsRow.userTexture` (default), and `PersonaRow.textureOverride`
(per-persona). `MindspaceRow.texture` survives as a seed-default the first time the
DB is opened, but the resolver no longer reads it once user state is present.

- [ ] **Step 1: Write the failing v3 migration test**

Create `apps/user-client/tests/boot/client-data-db-v3.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('client-data-db v3 migration', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds SettingsRow.userTexture as "cloudy" on a fresh install', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.userTexture).toBe('cloudy');
  });

  it('seeds PersonaRow.textureOverride as null on persona creation', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.personas.add({
      id: 'p-1',
      name: 'Test',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'x',
      providerId: 'pr-1',
      modelId: 'm-1',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const row = await db.personas.get('p-1');
    expect(row?.textureOverride).toBeNull();
  });

  it('on upgrade, backfills SettingsRow.userTexture from the default mindspace.texture if available', async () => {
    // Simulate a Phase-2 DB by opening, reading settings, mutating texture on
    // the default mindspace, then re-opening to trigger the v3 upgrade path.
    await openClientDataDb();
    const db = getClientDataDb();
    const settings = await db.settings.get(1);
    const defaultMs = await db.mindspaces.get(settings!.defaultMindspaceId);
    await db.mindspaces.update(defaultMs!.id, { texture: 'aurora' });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const newSettings = await getClientDataDb().settings.get(1);
    expect(newSettings?.userTexture).toBe('aurora');
  });

  it('on upgrade, backfills PersonaRow.textureOverride to null for existing personas', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.personas.add({
      id: 'p-1',
      name: 'Pre-existing',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'x',
      providerId: 'pr-1',
      modelId: 'm-1',
      mindspaceId: null,
      aboutMeOverride: null,
      // Intentionally omit textureOverride to simulate pre-v3 row shape.
      temperature: 0.85,
      adultPersona: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    // biome-ignore lint/suspicious/noExplicitAny: simulating pre-v3 row shape in test
    } as any);
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const row = await getClientDataDb().personas.get('p-1');
    expect(row?.textureOverride).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @chatsundere/user-client test tests/boot/client-data-db-v3.test.ts
```

Expected: FAIL — `userTexture` and `textureOverride` don't exist yet.

- [ ] **Step 3: Update the row types and add v3 migration**

Edit `apps/user-client/src/boot/client-data-db.ts`.

3a. Update `SettingsRow`:

```ts
export interface SettingsRow {
  id: 1;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userFont: 'sans' | 'serif' | 'cursive';
  userTexture: MindspaceTexture;  // NEW (v3)
  animationsEnabled: boolean;
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}
```

3b. Update `PersonaRow`:

```ts
export interface PersonaRow {
  id: string;
  name: string;
  tagline: string;
  colour: string;
  font: 'sans' | 'serif' | 'cursive';
  instructions: string;
  providerId: string;
  modelId: string;
  mindspaceId: string | null;
  aboutMeOverride: string | null;
  textureOverride: MindspaceTexture | null;  // NEW (v3)
  temperature: number;
  adultPersona: boolean;
  createdAt: number;
  updatedAt: number;
}
```

3c. Inside the `ClientDataDb` constructor, after the v2 block, add v3:

```ts
    this.version(3)
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
        // Backfill SettingsRow.userTexture from the user's default mindspace
        // (whichever texture is currently set on the chosen mindspace row).
        const settings = await tx.table('settings').get(1);
        if (settings) {
          const defaultMs = await tx.table('mindspaces').get(settings.defaultMindspaceId);
          const seedTexture = defaultMs?.texture ?? 'cloudy';
          await tx.table('settings').update(1, { userTexture: seedTexture });
        }
        // Backfill PersonaRow.textureOverride = null for every persona.
        const personas = await tx.table('personas').toArray();
        for (const p of personas) {
          await tx.table('personas').update(p.id, { textureOverride: null });
        }
      });
```

3d. Update the settings seed in `seedBuiltinsIfNeeded` to write `userTexture: 'cloudy'`:

```ts
      await db.settings.add({
        id: 1,
        globalUnlockerPrompt: '',
        globalAboutMe: '',
        defaultMindspaceId: aurumId,
        userFont: 'serif',
        userTexture: 'cloudy',
        animationsEnabled: true,
        corsProxy: null,
        createdAt: now,
        updatedAt: now,
      });
```

- [ ] **Step 4: Run the v3 migration test**

```bash
pnpm --filter @chatsundere/user-client test tests/boot/client-data-db-v3.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full user-client suite to catch typing regressions**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: any callers that construct `SettingsRow` or `PersonaRow` literals
(test fixtures, drafts in components) now need `userTexture` / `textureOverride`.
Fix them — see Tasks 4-7 for the call-site updates.

This step may leave the suite red for a beat. That's expected — Tasks 4-7 fix
those call sites. Commit this task only after Task 7 lands so the squash story
stays clean.

- [ ] **Step 6: Stage but don't commit yet — wait for Task 7**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/boot/client-data-db-v3.test.ts
```

Do NOT `git commit` until after Task 7 lands.

---

## Task 4: Mindspace resolver — texture priority

**Files:**
- Modify: `apps/user-client/src/state/mindspace-resolver.ts`
- Modify: `apps/user-client/src/state/mindspace.store.ts`
- Modify: `apps/user-client/tests/state/mindspace-resolver.test.ts` (existing)

The resolver now picks texture from `persona.textureOverride > settings.userTexture > mindspace.texture`,
mirroring how it already picks the mindspace itself (`persona.mindspaceId > settings.defaultMindspaceId > first`).

- [ ] **Step 1: Read the existing resolver and its test**

```bash
cat apps/user-client/src/state/mindspace-resolver.ts
cat apps/user-client/tests/state/mindspace-resolver.test.ts
```

Note the existing signature and how `update()` on the store consumes it.

- [ ] **Step 2: Extend the resolver test with texture-priority cases**

Append to `apps/user-client/tests/state/mindspace-resolver.test.ts` (paste your new
`describe` block before the file's final closing brace if it's a single root
`describe`, or as a sibling `describe` if it's flat):

```ts
describe('mindspace-resolver — texture priority', () => {
  const ms = (id: string, texture: 'cloudy' | 'aurora' | 'grain'): MindspaceRow => ({
    id,
    displayName: `MS-${id}`,
    palette: stubPalette(),
    texture,
    builtIn: true,
    createdAt: 0,
  });

  it('returns persona.textureOverride if set', () => {
    const r = resolveMindspace({
      persona: { mindspaceId: 'a', textureOverride: 'grain' },
      defaultMindspaceId: 'a',
      defaultTexture: 'aurora',
      mindspaces: [ms('a', 'cloudy')],
    });
    expect(r?.texture).toBe('grain');
  });

  it('falls back to settings.userTexture when persona.textureOverride is null', () => {
    const r = resolveMindspace({
      persona: { mindspaceId: 'a', textureOverride: null },
      defaultMindspaceId: 'a',
      defaultTexture: 'aurora',
      mindspaces: [ms('a', 'cloudy')],
    });
    expect(r?.texture).toBe('aurora');
  });

  it('falls back to mindspace.texture when neither override nor user-default is set', () => {
    const r = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'a',
      defaultTexture: null,
      mindspaces: [ms('a', 'cloudy')],
    });
    expect(r?.texture).toBe('cloudy');
  });
});
```

If the existing resolver test imports the helper `stubPalette` from a fixture,
reuse it; otherwise inline it inside this `describe` block.

- [ ] **Step 3: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/state/mindspace-resolver.test.ts
```

Expected: FAIL — `defaultTexture` parameter not yet accepted, persona type
doesn't carry `textureOverride`, etc.

- [ ] **Step 4: Update the resolver signature**

Edit `apps/user-client/src/state/mindspace-resolver.ts`. The resolver now returns
the resolved mindspace **and** a separate `texture` field, because texture is no
longer guaranteed to come from the mindspace row.

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';

export interface ResolvedMindspace extends MindspaceRow {
  /** Resolved texture (may differ from MindspaceRow.texture). */
  texture: MindspaceTexture;
}

export interface ResolverArgs {
  persona: { mindspaceId: string | null; textureOverride: MindspaceTexture | null } | null;
  defaultMindspaceId: string;
  defaultTexture: MindspaceTexture | null;
  mindspaces: ReadonlyArray<MindspaceRow>;
}

export function resolveMindspace(args: ResolverArgs): ResolvedMindspace | null {
  const { persona, defaultMindspaceId, defaultTexture, mindspaces } = args;
  if (mindspaces.length === 0) return null;
  const wantedId = persona?.mindspaceId ?? defaultMindspaceId;
  const ms = mindspaces.find((m) => m.id === wantedId) ?? mindspaces[0];
  if (!ms) return null;
  const texture =
    persona?.textureOverride ?? defaultTexture ?? ms.texture;
  return { ...ms, texture };
}
```

- [ ] **Step 5: Update `mindspace.store.ts` to plumb `defaultTexture` through**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from 'zustand';
import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';
import { resolveMindspace, type ResolvedMindspace, type ResolverArgs } from './mindspace-resolver.js';

interface MindspaceState {
  resolved: ResolvedMindspace | null;
  update: (args: ResolverArgs) => void;
  reset: () => void;
}

export const useMindspaceStore = create<MindspaceState>((set) => ({
  resolved: null,
  update: (args) => set({ resolved: resolveMindspace(args) }),
  reset: () => set({ resolved: null }),
}));

export type { MindspaceTexture };
export type { MindspaceRow };
```

- [ ] **Step 6: Run the resolver test**

```bash
pnpm --filter @chatsundere/user-client test tests/state/mindspace-resolver.test.ts
```

Expected: all tests PASS (old + new).

- [ ] **Step 7: Stage but don't commit — bundled into Task 7's commit**

```bash
git add apps/user-client/src/state/
git add apps/user-client/tests/state/mindspace-resolver.test.ts
```

---

## Task 5: Fix MindspaceLayer to cover the full viewport

**Files:**
- Modify: `apps/user-client/src/components/MindspaceLayer.tsx`
- Create: `apps/user-client/tests/components/MindspaceLayer.fullviewport.test.tsx`

`MindspaceTexture` renders with `position: absolute; inset: 0`, which fits its
*nearest positioned ancestor* — the `<div id="root">`'s default layout, which is
only as tall as the content. Wrap it in a `position: fixed; inset: 0; pointer-events: none; z-index: -1`
container so the texture spans the whole viewport regardless of scroll position
or content height.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/MindspaceLayer.fullviewport.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MindspaceLayer } from '../../src/components/MindspaceLayer.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

const samplePalette = {
  bg: '#0a0a0a',
  surfaceBase: 'rgba(255,255,255,0.025)',
  surfaceRaised: 'rgba(255,255,255,0.04)',
  surfaceInput: 'rgba(0,0,0,0.3)',
  accent: '#c9a84c',
  accentSubtle: 'rgba(0,0,0,0)',
  accentBorder: 'rgba(0,0,0,0)',
  accentBorderActive: 'rgba(0,0,0,0)',
  accentGlow: 'rgba(0,0,0,0)',
  text: { primary: '#fff', secondary: '#eee', muted: '#aaa', ghost: '#666' },
};

describe('MindspaceLayer', () => {
  it('wraps the texture in a position:fixed full-viewport wrapper', () => {
    useMindspaceStore.setState({
      resolved: {
        id: 'a',
        displayName: 'Aurum',
        palette: samplePalette,
        texture: 'cloudy',
        builtIn: true,
        createdAt: 0,
      },
    });
    const { container } = render(<MindspaceLayer />);
    const wrapper = container.querySelector('[data-mindspace-layer]') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.position).toBe('fixed');
    expect(wrapper!.style.inset).toBe('0px');
    expect(wrapper!.style.pointerEvents).toBe('none');
    // Texture should sit inside the wrapper.
    expect(wrapper!.querySelector('.mindspace-texture')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/components/MindspaceLayer.fullviewport.test.tsx
```

Expected: FAIL — no `[data-mindspace-layer]` wrapper yet.

- [ ] **Step 3: Update `MindspaceLayer.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useMindspaceStore } from '../state/mindspace.store.js';
import { MindspaceTexture } from './MindspaceTexture.js';

export function MindspaceLayer(): JSX.Element | null {
  const resolved = useMindspaceStore((s) => s.resolved);

  useEffect(() => {
    if (!resolved) return;
    const root = document.documentElement;
    const p = resolved.palette;
    root.style.setProperty('--mindspace-bg', p.bg);
    root.style.setProperty('--mindspace-surface-base', p.surfaceBase);
    root.style.setProperty('--mindspace-surface-raised', p.surfaceRaised);
    root.style.setProperty('--mindspace-surface-input', p.surfaceInput);
    root.style.setProperty('--mindspace-accent', p.accent);
    root.style.setProperty('--mindspace-accent-subtle', p.accentSubtle);
    root.style.setProperty('--mindspace-accent-border', p.accentBorder);
    root.style.setProperty('--mindspace-accent-border-active', p.accentBorderActive);
    root.style.setProperty('--mindspace-accent-glow', p.accentGlow);
    root.style.setProperty('--mindspace-text-primary', p.text.primary);
    root.style.setProperty('--mindspace-text-secondary', p.text.secondary);
    root.style.setProperty('--mindspace-text-muted', p.text.muted);
    root.style.setProperty('--mindspace-text-ghost', p.text.ghost);
  }, [resolved]);

  if (!resolved) return null;
  return (
    <div
      data-mindspace-layer
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: -1,
        overflow: 'hidden',
      }}
    >
      <MindspaceTexture texture={resolved.texture} accent={resolved.palette.accent} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/MindspaceLayer.fullviewport.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Stage — bundle with Task 7's commit**

```bash
git add apps/user-client/src/components/MindspaceLayer.tsx apps/user-client/tests/components/MindspaceLayer.fullviewport.test.tsx
```

---

## Task 6: MindspacePicker — controlled texture + real preview

**Files:**
- Modify: `apps/user-client/src/components/MindspacePicker.tsx`
- Create: `apps/user-client/tests/components/MindspacePicker.controlled.test.tsx`

The picker keeps its current props shape (`selectedTexture`, `onTextureChange`) —
already controlled. The bug was that **callers** derive `selectedTexture` from
`mindspace.texture`, so a colour change cascades into a texture change. After
this phase, callers pass `settings.userTexture` (Settings) or
`draft.textureOverride ?? settings.userTexture` (Persona editor). The picker
itself only needs two improvements:

1. The preview card renders an actual `MindspaceTexture` so the chosen texture
   is visible, not just a flat colour panel.
2. The "Color" row + "Texture" row + "Font" row are independent — no implicit
   resets.

The caller-side fixes happen in Tasks 8 + 9. This task fixes the picker itself.

- [ ] **Step 1: Write the controlled-API test**

Create `apps/user-client/tests/components/MindspacePicker.controlled.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MindspacePicker } from '../../src/components/MindspacePicker.js';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';

function ms(id: string, name: string, accent: string): MindspaceRow {
  return {
    id,
    displayName: name,
    palette: {
      bg: '#000',
      surfaceBase: 'rgba(0,0,0,0.1)',
      surfaceRaised: 'rgba(0,0,0,0.2)',
      surfaceInput: 'rgba(0,0,0,0.3)',
      accent,
      accentSubtle: 'rgba(0,0,0,0)',
      accentBorder: 'rgba(0,0,0,0)',
      accentBorderActive: 'rgba(0,0,0,0)',
      accentGlow: 'rgba(0,0,0,0)',
      text: { primary: '#fff', secondary: '#eee', muted: '#aaa', ghost: '#666' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
  };
}

describe('MindspacePicker', () => {
  it('renders the preview with an actual MindspaceTexture matching selectedTexture', () => {
    const { container } = render(
      <MindspacePicker
        mindspaces={[ms('a', 'Aurum', '#c9a84c')]}
        selectedMindspaceId="a"
        selectedTexture="aurora"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    // The MindspaceTexture component sets data-texture on its root.
    const texturePreview = container.querySelector('[data-mindspace-preview] [data-texture="aurora"]');
    expect(texturePreview).not.toBeNull();
  });

  it('does not call onTextureChange when colour is selected', () => {
    const onColour = vi.fn();
    const onTexture = vi.fn();
    render(
      <MindspacePicker
        mindspaces={[ms('a', 'Aurum', '#c9a84c'), ms('b', 'Verdan', '#6aa97a')]}
        selectedMindspaceId="a"
        selectedTexture="aurora"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={onColour}
        onTextureChange={onTexture}
        onFontChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Mindspace Verdan/));
    expect(onColour).toHaveBeenCalledWith('b');
    expect(onTexture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/components/MindspacePicker.controlled.test.tsx
```

Expected: FAIL — preview card has no `data-mindspace-preview` + no nested texture.

- [ ] **Step 3: Update `MindspacePicker.tsx` to render `<MindspaceTexture>` in the preview**

In the existing Preview-card block (currently the `<div className="mb-3 rounded-md p-4 text-center" …>`),
replace it with a card that has a relative-positioned inner with an absolute
`MindspaceTexture` underneath and the label text on top:

```tsx
import { MindspaceTexture } from './MindspaceTexture.js';
…
      {/* Preview card */}
      <div
        data-mindspace-preview
        className="relative mb-3 overflow-hidden rounded-md"
        style={{ background: selectedMs?.palette.bg ?? '#0a0a0a' }}
      >
        {selectedMs ? (
          <div className="pointer-events-none absolute inset-0">
            <MindspaceTexture texture={selectedTexture} accent={selectedMs.palette.accent} />
          </div>
        ) : null}
        <div
          className="relative p-6 text-center"
          style={{ color: accent }}
        >
          <div className={`text-2xl ${FONT_CLASSES[selectedFont]}`} style={{ color: accent }}>
            {previewName}
          </div>
          <div className="mt-1 text-xs uppercase tracking-widest text-paper-soft">
            Your space
          </div>
        </div>
      </div>
```

(The wrapper `position: relative` lets the texture sit beneath the label.)

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/MindspacePicker.controlled.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Stage — bundle with Task 7**

```bash
git add apps/user-client/src/components/MindspacePicker.tsx apps/user-client/tests/components/MindspacePicker.controlled.test.tsx
```

---

## Task 7: Wire Settings + Persona Editor to the new texture sources, drop `useUpdateMindspaceTexture`

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Modify: `apps/user-client/src/data/mindspaces.ts`
- Modify: `apps/user-client/tests/routes/settings.test.tsx`
- Modify: `apps/user-client/tests/routes/persona-editor.test.tsx`

Settings: `selectedTexture={s.userTexture}` and `onTextureChange={(t) => updateSettings.mutate({ userTexture: t })}`.
Persona Editor: `selectedTexture={draft.textureOverride ?? settings.data?.userTexture ?? 'cloudy'}`
and `onTextureChange={(t) => patch({ textureOverride: t })}`. Drop the
`useUpdateMindspaceTexture` hook entirely — texture is no longer a mindspace-row
property.

The store update calls (`setMindspace({ persona, defaultMindspaceId, mindspaces, defaultTexture })`)
also need the new `defaultTexture` argument. Settings passes `s.userTexture`;
Persona Editor passes `{ mindspaceId: draft.mindspaceId, textureOverride: draft.textureOverride }`
as the `persona` and `s.userTexture` as `defaultTexture`.

- [ ] **Step 1: Update `Settings` route**

Edit `apps/user-client/src/routes/app/settings.tsx`:

1a. Remove the `useUpdateMindspaceTexture` import + its call site.

1b. Update the `useEffect` that calls `setMindspace`:

```tsx
  useEffect(() => {
    if (settings.data && mindspaces.data) {
      setMindspace({
        persona: null,
        defaultMindspaceId: settings.data.defaultMindspaceId,
        defaultTexture: settings.data.userTexture,
        mindspaces: mindspaces.data,
      });
    }
  }, [settings.data, mindspaces.data, setMindspace]);
```

1c. Update the `MindspacePicker` props inside the About-Me accordion:

```tsx
            <MindspacePicker
              mindspaces={mindspaces.data}
              selectedMindspaceId={selectedMindspace.id}
              selectedTexture={s.userTexture}
              selectedFont={s.userFont}
              previewName="Chris"
              onMindspaceChange={(id) => {
                if (id) updateSettings.mutate({ defaultMindspaceId: id });
              }}
              onTextureChange={(t) => updateSettings.mutate({ userTexture: t })}
              onFontChange={(f) => updateSettings.mutate({ userFont: f })}
            />
```

- [ ] **Step 2: Update `PersonaEditor` route**

Edit `apps/user-client/src/routes/app/persona-editor.tsx`:

2a. Add `textureOverride: null` to `defaultDraft`'s returned object.

2b. Update the Mindspace-Override accordion's `MindspacePicker` props:

```tsx
          <MindspacePicker
            mindspaces={mindspaces.data}
            selectedMindspaceId={draft.mindspaceId}
            selectedTexture={
              draft.textureOverride ?? settings.data?.userTexture ?? 'cloudy'
            }
            selectedFont={draft.font}
            previewName={draft.name || 'New Persona'}
            allowUserDefault
            onMindspaceChange={(id) => {
              const ms = id ? mindspaces.data?.find((m) => m.id === id) : null;
              patch({
                mindspaceId: id,
                colour: ms?.palette.accent ?? draft.colour,
              });
            }}
            onTextureChange={(t) => patch({ textureOverride: t })}
            onFontChange={(f) => patch({ font: f })}
          />
```

Remove the no-op comment block; the editor now wires through.

- [ ] **Step 3: Drop `useUpdateMindspaceTexture` from `data/mindspaces.ts`**

Edit `apps/user-client/src/data/mindspaces.ts` — delete the
`useUpdateMindspaceTexture` export entirely. `useMindspaces` stays.

- [ ] **Step 4: Update existing tests that referenced the dropped hook**

```bash
grep -rn "useUpdateMindspaceTexture" apps/user-client/
```

Delete or rewrite each hit. The `tests/data/mindspaces.test.ts` file may contain
a `describe('useUpdateMindspaceTexture', …)` block — drop that whole block.

- [ ] **Step 5: Update `tests/routes/settings.test.tsx`**

Read the file:

```bash
cat apps/user-client/tests/routes/settings.test.tsx
```

Any test that asserts on a `useUpdateMindspaceTexture` mock or builds a
`SettingsRow` without `userTexture` needs an update. Add `userTexture: 'cloudy'`
to every settings literal and switch texture-related assertions to inspect the
`updateSettings` mock call payload (`{ userTexture: '...' }`).

- [ ] **Step 6: Update `tests/routes/persona-editor.test.tsx`**

Same drill: persona-row fixtures get `textureOverride: null`; any draft-write
assertion expecting a write to a mindspace-row mock for texture now expects a
`patch({ textureOverride: '...' })` on the persona draft.

- [ ] **Step 7: Run the full user-client suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: all green. If a test was importing `useUpdateMindspaceTexture` directly,
remove that import and the test that uses it.

- [ ] **Step 8: Commit Tasks 3-7 as a single texture-source-migration commit**

```bash
git add apps/user-client/src/data/mindspaces.ts apps/user-client/src/routes/app/settings.tsx apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/data/ apps/user-client/tests/routes/settings.test.tsx apps/user-client/tests/routes/persona-editor.test.tsx
git commit -m "$(cat <<'EOF'
Move texture from mindspace row to user/persona state

Texture was tracked on MindspaceRow.texture and the picker re-read it
on every colour selection — switching colour silently reset texture
to whatever the new row remembered, which Chris caught in the smoke
test as "texture springt wild umher".

Schema v3 introduces SettingsRow.userTexture (user default) and
PersonaRow.textureOverride (per-persona); MindspaceRow.texture survives
only as a seed-default the resolver reads when neither user state nor
override is present. The picker is now genuinely controlled — selecting
a colour does not touch texture.

MindspaceLayer also gets a fixed full-viewport wrapper so the texture
spans the page instead of collapsing onto the content box.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: AutoSizeTextarea component

**Files:**
- Create: `apps/user-client/src/components/AutoSizeTextarea.tsx`
- Create: `apps/user-client/tests/components/AutoSizeTextarea.test.tsx`

A tiny controlled `<textarea>` wrapper that grows with content. Optional
`maxRows` cap (default unlimited; the Global System Prompt and Custom Instructions
will pass `maxRows={20}` to keep them sane). Implementation: ref the textarea,
on every `input` reset `height` to `auto`, then set it to `scrollHeight`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/AutoSizeTextarea.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AutoSizeTextarea } from '../../src/components/AutoSizeTextarea.js';

describe('AutoSizeTextarea', () => {
  it('renders the controlled value', () => {
    const { getByRole } = render(
      <AutoSizeTextarea value="hello" onChange={() => {}} aria-label="t" />,
    );
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('hello');
  });

  it('forwards onChange', () => {
    let v = '';
    const { getByRole } = render(
      <AutoSizeTextarea value={v} onChange={(next) => (v = next)} aria-label="t" />,
    );
    fireEvent.change(getByRole('textbox'), { target: { value: 'updated' } });
    expect(v).toBe('updated');
  });

  it('respects minRows and maxRows on the rendered element', () => {
    const { getByRole } = render(
      <AutoSizeTextarea value="" onChange={() => {}} aria-label="t" minRows={3} maxRows={10} />,
    );
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.rows).toBe(3);
    expect(ta.style.maxHeight).not.toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/components/AutoSizeTextarea.test.tsx
```

Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Implement the component**

Create `apps/user-client/src/components/AutoSizeTextarea.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

const LINE_HEIGHT_PX = 22;  // matches text-sm + leading-snug; adjust if base size changes

export function AutoSizeTextarea(props: Props): JSX.Element {
  const {
    value,
    onChange,
    onBlur,
    placeholder,
    minRows = 3,
    maxRows,
    className = '',
    id,
  } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const maxHeight = maxRows ? `${maxRows * LINE_HEIGHT_PX + 24}px` : undefined;

  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={props['aria-label']}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur?.(e.target.value)}
      placeholder={placeholder}
      rows={minRows}
      style={{ maxHeight, overflowY: maxRows ? 'auto' : 'hidden', resize: 'none' }}
      className={`w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm leading-snug text-paper outline-none focus:border-paper-soft ${className}`}
    />
  );
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/AutoSizeTextarea.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Replace the four growable textareas across Settings + Persona Editor**

In `apps/user-client/src/routes/app/settings.tsx`, replace the About-Me and
Global System Prompt `<textarea>` blocks with `AutoSizeTextarea`:

```tsx
import { AutoSizeTextarea } from '../../components/AutoSizeTextarea.js';
…
        <AutoSizeTextarea
          aria-label="About me"
          minRows={4}
          value={s.globalAboutMe}
          onChange={(v) => updateSettings.mutate({ globalAboutMe: v })}
          placeholder="Tell your Circle who you are…"
        />
…
        <AutoSizeTextarea
          aria-label="Global system prompt"
          minRows={4}
          maxRows={20}
          value={s.globalUnlockerPrompt}
          onChange={(v) => updateSettings.mutate({ globalUnlockerPrompt: v })}
        />
```

Note: switching from `onBlur` + `defaultValue` to `onChange` + `value` makes the
field strictly controlled. Each keystroke mutates settings. If that turns out
to thrash IndexedDB during the smoke test, escalate as DONE_WITH_CONCERNS — we
can debounce with a 200 ms timer inside the setter wrapper. Do not pre-emptively
debounce; ship the simple version and let real usage tell us if it's a problem.

In `apps/user-client/src/routes/app/persona-editor.tsx`, replace the Custom
Instructions textarea and About-Me-Override textarea:

```tsx
        <AutoSizeTextarea
          aria-label="Custom instructions"
          minRows={5}
          maxRows={30}
          value={draft.instructions}
          onChange={(v) => patch({ instructions: v })}
        />
…
        <AutoSizeTextarea
          aria-label="About me override"
          minRows={4}
          maxRows={20}
          placeholder={settings.data?.globalAboutMe || 'Tell this persona who you are…'}
          value={draft.aboutMeOverride ?? ''}
          onChange={(v) => patch({ aboutMeOverride: v === '' ? null : v })}
        />
```

- [ ] **Step 6: Run the full suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: all green. Any test that asserted on the previous `<textarea defaultValue=…>`
shape needs updating to inspect `value={…}` / `onChange` instead.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/AutoSizeTextarea.tsx apps/user-client/tests/components/AutoSizeTextarea.test.tsx apps/user-client/src/routes/app/settings.tsx apps/user-client/src/routes/app/persona-editor.tsx
# plus any updated test files
git add apps/user-client/tests/routes/
git commit -m "$(cat <<'EOF'
Replace fixed-height textareas with AutoSizeTextarea

About Me, Global System Prompt, Custom Instructions, and About-Me-Override
now grow with their content (with sane maxRows caps where it matters).
The component is controlled — onChange fires on every keystroke. If
IndexedDB write thrash becomes a problem during real use, a small
debounce can be added later inside the setter wrapper.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: ProviderSheet — opaque + Save button + Ollama fix + autocomplete

**Files:**
- Modify: `apps/user-client/src/components/ProviderSheet.tsx`
- Modify: `apps/user-client/tests/components/ProviderSheet.test.tsx` (existing)
- Create: `apps/user-client/tests/components/ProviderSheet.polish.test.tsx`

Five changes in one task because they all touch the same component:

1. **Opaque background + backdrop.** `bg-bg` is undefined — switch the sheet to
   `bg-ink` (defined dark) and add a fixed `bg-black/60 backdrop-blur-sm`
   backdrop sibling.
2. **Explicit Save button, no auto-save-on-close.** Closing via `×` discards
   the in-progress edit. Save is the only way to persist. Probe runs on Save,
   not on close.
3. **Ollama API key save bug.** Use the local `sealedShared` variable when
   decrypting for the probe — `settings.data?.corsProxy` is stale TanStack-Query
   cache and can be `null` even right after `updateSettings.mutateAsync`.
4. **Proxy-URL placeholder is `https://example.com`** (was Chris's domain).
5. **Autocomplete attributes** that suppress browser/password-manager prompts:
   `autoComplete="off"`, `data-1p-ignore`, `data-lpignore="true"`, plus
   `name=""` left empty.

- [ ] **Step 1: Write the polish test**

Create `apps/user-client/tests/components/ProviderSheet.polish.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderSheet } from '../../src/components/ProviderSheet.js';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) => ({
    id,
    displayName: id === 'ollama-cloud' ? 'Ollama Cloud' : 'nano-gpt.com',
    baseUrl: 'https://example.com/v1',
    corsHint: id === 'ollama-cloud' ? 'requires-proxy' : 'inofficial',
    knownModels: [],
  }),
  probeProvider: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: Uint8Array }) => unknown) =>
    selector({ mk: new Uint8Array(32) }),
}));

vi.mock('../../src/lib/secrets.js', () => ({
  sealSecret: vi.fn(async () => ({ ciphertext: new Uint8Array(), iv: new Uint8Array() })),
  openSecret: vi.fn(async () => 'plain-key'),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
  useUpsertProvider: () => ({
    mutateAsync: vi.fn(async (row) => ({ id: 'pr-1', ...row })),
  }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: null }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));

function renderSheet(templateId: 'nano-gpt' | 'ollama-cloud', onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProviderSheet templateId={templateId} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('ProviderSheet polish', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an opaque backdrop with bg-ink classes', () => {
    const { container } = renderSheet('nano-gpt');
    const backdrop = container.querySelector('[data-ps-backdrop]');
    expect(backdrop).not.toBeNull();
    const sheet = container.querySelector('[data-ps-sheet]') as HTMLElement;
    expect(sheet.className).toMatch(/bg-ink/);
    expect(sheet.className).not.toMatch(/bg-bg\b/);
  });

  it('shows an explicit Save button', () => {
    renderSheet('nano-gpt');
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('does not run the probe when the close (×) button is clicked', async () => {
    const onClose = vi.fn();
    const { default: real } = await import('@chatsundere/llm-unified');
    renderSheet('nano-gpt', onClose);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalled();
    // probeProvider must not have been called
    const probed = (await import('@chatsundere/llm-unified')).probeProvider as ReturnType<typeof vi.fn>;
    expect(probed).not.toHaveBeenCalled();
  });

  it('uses https://example.com as the proxy URL placeholder for Ollama Cloud', () => {
    renderSheet('ollama-cloud');
    const input = screen.getByLabelText(/proxy url/i) as HTMLInputElement;
    expect(input.placeholder).toMatch(/example\.com/);
  });

  it('sets autocomplete=off and password-manager opt-out attrs on the API key field', () => {
    renderSheet('nano-gpt');
    const input = screen.getByLabelText(/api key/i);
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('data-1p-ignore');
    expect(input).toHaveAttribute('data-lpignore', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/components/ProviderSheet.polish.test.tsx
```

Expected: all 5 cases FAIL.

- [ ] **Step 3: Rewrite `ProviderSheet.tsx`**

Replace the file with the polished version:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, probeProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../data/providers.js';
import { useSettings, useUpdateSettings } from '../data/settings.js';
import { openSecret, sealSecret } from '../lib/secrets.js';

interface Props {
  templateId: 'nano-gpt' | 'novita' | 'ollama-cloud';
  onClose: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok' }
  | { kind: 'error'; reason: string };

export function ProviderSheet({ templateId, onClose }: Props): JSX.Element {
  const definition = getProvider(templateId);
  const requiresProxy = definition?.corsHint === 'requires-proxy';
  const providers = useProviders();
  const settings = useSettings();
  const upsert = useUpsertProvider();
  const del = useDeleteProvider();
  const updateSettings = useUpdateSettings();
  const mk = useSessionStore((s) => s.mk);

  const existing = providers.data?.find((p) => p.templateId === templateId);

  const [apiKey, setApiKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState(settings.data?.corsProxy?.url ?? '');
  const [proxyShared, setProxyShared] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!apiKey && !existing) {
      setStatus({ kind: 'error', reason: 'API key required' });
      return;
    }
    if (!mk || !definition) {
      setStatus({ kind: 'error', reason: 'No master key in session — re-login required' });
      return;
    }
    setSaving(true);
    setStatus({ kind: 'probing' });
    try {
      const rowId = existing?.id ?? 'pending';
      const apiKeySlotId = `provider/${rowId}/api-key`;
      const sealedKey = apiKey ? await sealSecret(apiKey, mk, apiKeySlotId) : existing?.apiKey;
      if (!sealedKey) {
        setSaving(false);
        return;
      }
      const row = await upsert.mutateAsync({
        id: existing?.id,
        templateId,
        apiKey: sealedKey,
        enabled: false,
      });

      // Re-seal with the stable row id as slotId when we just created the row.
      const stableSlotId = `provider/${row.id}/api-key`;
      const stableSealedKey =
        apiKey && !existing ? await sealSecret(apiKey, mk, stableSlotId) : sealedKey;

      if (apiKey && !existing) {
        await upsert.mutateAsync({
          id: row.id,
          templateId,
          apiKey: stableSealedKey,
          enabled: false,
        });
      }

      // For proxy-required providers, seal the shared key locally; do NOT
      // rely on settings.data for read-back since TanStack-Query cache is
      // stale right after a mutateAsync write.
      let sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
      if (requiresProxy && proxyUrl && proxyShared) {
        sealedShared = await sealSecret(proxyShared, mk, 'cors-proxy/shared-key');
        await updateSettings.mutateAsync({
          corsProxy: { url: proxyUrl, sharedKey: sealedShared },
        });
      }

      const decryptedKey = await openSecret(stableSealedKey, mk, stableSlotId);
      const decryptedProxyKey =
        requiresProxy && sealedShared
          ? await openSecret(sealedShared, mk, 'cors-proxy/shared-key')
          : null;

      const config = {
        baseUrl: definition.baseUrl,
        routing: requiresProxy ? ({ kind: 'cors-proxy' } as const) : ({ kind: 'direct' } as const),
      };
      const result = await probeProvider({
        definition,
        config,
        apiKey: decryptedKey,
        corsProxyUrl: requiresProxy
          ? proxyUrl || settings.data?.corsProxy?.url || null
          : null,
        corsProxyKey: decryptedProxyKey,
      });

      if (result.ok) {
        await upsert.mutateAsync({
          id: row.id,
          templateId,
          apiKey: stableSealedKey,
          enabled: true,
        });
        setStatus({ kind: 'ok' });
        // Allow the user to read the "Key valid" badge briefly before closing.
        setTimeout(() => onClose(), 600);
      } else {
        setStatus({ kind: 'error', reason: `${result.status} · ${result.reason ?? ''}` });
      }
    } catch (e) {
      setStatus({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const displayName = definition?.displayName ?? templateId;

  return (
    <>
      <div
        data-ps-backdrop
        className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        data-ps-sheet
        className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-white/10 bg-ink p-4 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
              {displayName.slice(0, 2)}
            </div>
            <div>
              <div className="font-display text-sm text-paper">{displayName}</div>
              <div className="text-xs text-paper-soft">Text capability</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1 text-paper-soft hover:text-paper"
          >
            ×
          </button>
        </div>

        <div className="mb-3">
          <label
            htmlFor="ps-api-key"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            API Key
          </label>
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
            <input
              id="ps-api-key"
              type={revealKey ? 'text' : 'password'}
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              name=""
              className="flex-1 bg-transparent font-mono text-sm text-paper outline-none"
            />
            <button
              type="button"
              onClick={() => setRevealKey((v) => !v)}
              aria-label={revealKey ? 'Hide key' : 'Show key'}
              className="text-paper-soft hover:text-paper"
            >
              ◉
            </button>
          </div>
        </div>

        {requiresProxy ? (
          <div className="mb-3 space-y-2 border-t border-white/5 pt-3">
            <div>
              <label
                htmlFor="ps-proxy-url"
                className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
              >
                Proxy URL
              </label>
              <input
                id="ps-proxy-url"
                type="text"
                placeholder="https://example.com"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                name=""
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="ps-proxy-shared"
                className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
              >
                Shared key
              </label>
              <input
                id="ps-proxy-shared"
                type="password"
                placeholder="shared secret"
                value={proxyShared}
                onChange={(e) => setProxyShared(e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                name=""
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
              />
            </div>
            <p className="text-[11px] text-paper-soft">
              Required for Ollama Cloud. Stored once and reused for any provider that needs a proxy.
            </p>
          </div>
        ) : null}

        {status.kind !== 'idle' ? (
          <div
            data-testid="sheet-status"
            className={`mb-3 rounded-md border px-3 py-2 text-xs ${
              status.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : status.kind === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-paper-soft/30 bg-paper-soft/10 text-paper-soft'
            }`}
          >
            {status.kind === 'probing'
              ? 'Probing…'
              : status.kind === 'ok'
                ? '✓ Key valid'
                : `✗ ${(status as { kind: 'error'; reason: string }).reason}`}
          </div>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void onSave();
            }}
            disabled={saving}
            className="flex-1 rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Test & Save'}
          </button>
        </div>

        {existing ? (
          <div className="mt-4 rounded-md border border-danger/30 p-3">
            <div className="text-xs font-medium uppercase tracking-widest text-danger">
              Remove this provider
            </div>
            <div className="mb-2 text-[11px] text-paper-soft">
              Key is deleted, personas using this provider won&apos;t be able to connect.
            </div>
            <button
              type="button"
              onClick={() => {
                void del.mutateAsync(existing.id).then(() => onClose());
              }}
              className="rounded-md border border-danger px-3 py-1 text-xs uppercase tracking-wider text-danger hover:bg-danger/10"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the polish test**

```bash
pnpm --filter @chatsundere/user-client test tests/components/ProviderSheet.polish.test.tsx
```

Expected: all 5 PASS.

- [ ] **Step 5: Update the existing `tests/components/ProviderSheet.test.tsx`**

Read the file:

```bash
cat apps/user-client/tests/components/ProviderSheet.test.tsx
```

Adjust assertions that relied on the previous auto-save-on-close behaviour:
the close path no longer triggers a probe; users must click Save explicitly.
If a test asserts that closing without filling triggers a write, change it to
click the new Save button instead.

- [ ] **Step 6: Run the full user-client suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/ProviderSheet.tsx apps/user-client/tests/components/ProviderSheet.polish.test.tsx apps/user-client/tests/components/ProviderSheet.test.tsx
git commit -m "$(cat <<'EOF'
ProviderSheet polish + Ollama-Cloud save fix

- Opaque bg-ink background with a click-through backdrop overlay
- Explicit Test & Save button; closing via × discards the edit
- Ollama save bug: shared-key was being re-read from stale TanStack-Query
  cache, which was null right after the write. Use the local sealedShared
  variable for the probe-side decrypt.
- Proxy URL placeholder is now https://example.com (was Chris's domain)
- API key + proxy fields disable browser/password-manager autofill
  (autoComplete=off, data-1p-ignore, data-lpignore=true, empty name=)
- Show/Hide button gets an aria-label

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Persona Editor — Identity outside accordion, new section order, required-field markers

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Create: `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`
- Modify: `apps/user-client/tests/routes/persona-editor.test.tsx` (existing)

New visual structure:

```
Topbar (back / title / —)
Chat actions row (Continue, New Chat, Incognito)  [edit mode only]
─────────────────────────────────────
Identity (always visible, not in accordion)
  Name              [✕ if empty]
  Tagline
─────────────────────────────────────
Accordions (in this order):
  ❶ Custom Instructions   [header ✕ if instructions empty]
  ❷ Model                 [header ✕ if providerId or modelId empty]
  ❸ Behavior
  ❹ Mindspace — Override
  ❺ About Me — Override
─────────────────────────────────────
Delete-Zone (edit mode only)
Save-Bar
```

The header `✕` is a small `<span>` with `text-danger` rendered inline with the
accordion icon. Inline next to the Name field, a `<span aria-label="required">✕</span>`
shows up only when `draft.name` is empty.

Required-field set: `name`, `instructions`, `providerId`, `modelId`.

- [ ] **Step 1: Write the marker test**

Create `apps/user-client/tests/routes/persona-editor.required-markers.test.tsx`:

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
  useSettings: () => ({ data: { defaultMindspaceId: 'a', userFont: 'serif', userTexture: 'cloudy' } }),
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => ({ data: [{ id: 'a', displayName: 'Aurum', palette: { accent: '#c9a84c' }, texture: 'cloudy', builtIn: true, createdAt: 0 }] }),
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

describe('PersonaEditor — required-field markers', () => {
  it('renders Identity outside any accordion', () => {
    setup();
    const name = screen.getByLabelText(/name/i);
    // The Identity input must not be inside an [data-accordion-card] container.
    expect(name.closest('[data-accordion-card]')).toBeNull();
  });

  it('shows the inline ✕ marker next to Name while it is empty', () => {
    setup();
    const marker = screen.getByLabelText(/name is required/i);
    expect(marker).toBeInTheDocument();
  });

  it('removes the inline marker once Name has content', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Liz' } });
    expect(screen.queryByLabelText(/name is required/i)).toBeNull();
  });

  it('shows the header ✕ marker on the Custom Instructions accordion when empty', () => {
    setup();
    // The accordion header for "Custom Instructions" should carry an icon that
    // can be queried by an aria-label containing "required".
    const ci = screen.getByText(/custom instructions/i).closest('[data-accordion-card]');
    expect(ci?.querySelector('[aria-label="Custom Instructions is required"]')).not.toBeNull();
  });

  it('orders accordion sections as Custom Instructions → Model → Behavior → Mindspace → About-Me-Override', () => {
    setup();
    const headers = Array.from(document.querySelectorAll('[data-accordion-card] [data-accordion-label]')).map(
      (n) => n.textContent?.trim() ?? '',
    );
    expect(headers).toEqual([
      'Custom Instructions',
      'Model',
      'Behavior',
      'Mindspace — Override',
      'About Me — Override',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/persona-editor.required-markers.test.tsx
```

Expected: most FAIL — current structure has Identity in an accordion and a
different section order.

- [ ] **Step 3: Update `AccordionCard.tsx` to expose the data + label attributes**

Read the current file:

```bash
cat apps/user-client/src/components/AccordionCard.tsx
```

Add `data-accordion-card` to the root and `data-accordion-label` to the label
span. Also accept an optional `requiredMarker?: boolean` prop and render a
small `<span aria-label="${label} is required" className="text-danger">✕</span>`
next to the icon when it's true.

Add to the existing `interface Props`:

```ts
  requiredMarker?: boolean;
```

In the rendered header, after the icon and before the label:

```tsx
        {requiredMarker ? (
          <span aria-label={`${label} is required`} className="text-danger" data-required-marker>
            ✕
          </span>
        ) : null}
```

And on the label span:

```tsx
        <span data-accordion-label className="…existing classes…">{label}</span>
```

And on the root container:

```tsx
    <section data-accordion-card className="…existing classes…">
```

- [ ] **Step 4: Restructure `persona-editor.tsx`**

Rewrite the body of `PersonaEditor` to use the new order and Identity-outside.
This is a substantial edit; lay out the JSX from top to bottom in the order
described above. Key changes:

4a. Replace the `<AccordionCard icon="✦" label="Identity" …>` wrapper with an
inline section:

```tsx
      <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
        <header className="mb-2 text-xs uppercase tracking-widest text-paper-soft">
          Identity
        </header>
        <label
          className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-paper-soft"
          htmlFor="persona-name"
        >
          Name
          {!draft.name ? (
            <span aria-label="Name is required" className="text-danger">✕</span>
          ) : null}
        </label>
        <input
          id="persona-name"
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
        <label
          className="mb-2 block text-xs uppercase tracking-widest text-paper-soft"
          htmlFor="persona-tagline"
        >
          Tagline
        </label>
        <input
          id="persona-tagline"
          type="text"
          value={draft.tagline}
          onChange={(e) => patch({ tagline: e.target.value })}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
      </section>
```

4b. Reorder the accordions and add `requiredMarker` props:

```tsx
      <AccordionCard
        icon="≣"
        label="Custom Instructions"
        meta="Who this persona is"
        requiredMarker={!draft.instructions}
      >
        <AutoSizeTextarea
          aria-label="Custom instructions"
          minRows={5}
          maxRows={30}
          value={draft.instructions}
          onChange={(v) => patch({ instructions: v })}
        />
      </AccordionCard>

      <AccordionCard
        icon="⬡"
        label="Model"
        meta="Pick a provider/model pair"
        requiredMarker={!draft.providerId || !draft.modelId}
      >
        <ModelList
          providers={providers.data ?? []}
          selectedProviderId={draft.providerId}
          selectedModelId={draft.modelId}
          onSelect={(providerId, modelId) => patch({ providerId, modelId })}
        />
      </AccordionCard>

      <AccordionCard icon="∿" label="Behavior" meta="Temperature · content flags">
        {/* …unchanged Behavior body… */}
      </AccordionCard>

      {mindspaces.data ? (
        <AccordionCard icon="◈" label="Mindspace — Override" meta="Color · texture · font">
          {/* …MindspacePicker as wired in Task 7… */}
        </AccordionCard>
      ) : null}

      <AccordionCard icon="◉" label="About Me — Override" meta="Empty = global is used">
        <AutoSizeTextarea
          aria-label="About me override"
          minRows={4}
          maxRows={20}
          placeholder={settings.data?.globalAboutMe || 'Tell this persona who you are…'}
          value={draft.aboutMeOverride ?? ''}
          onChange={(v) => patch({ aboutMeOverride: v === '' ? null : v })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          Empty = global About Me is used (shown in grey). Fill in to override for this persona only.
        </p>
      </AccordionCard>
```

4c. Update the SaveBar's `saveDisabled` to also require `modelId`:

```tsx
      <SaveBar
        onCancel={() => navigate('/app/circle')}
        onSave={onSave}
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

- [ ] **Step 5: Run the marker test**

```bash
pnpm --filter @chatsundere/user-client test tests/routes/persona-editor.required-markers.test.tsx
```

Expected: all 5 PASS. If "removes the inline marker once Name has content" still
fails, double-check that the input is genuinely controlled (`value={draft.name}`).

- [ ] **Step 6: Update the existing `tests/routes/persona-editor.test.tsx`**

Read it:

```bash
cat apps/user-client/tests/routes/persona-editor.test.tsx
```

Update any selector that queries Identity inside an accordion (`screen.getByText('Identity')`
or expanding it via click) to instead query the input directly. Update any
ordering assertions to match the new sequence.

- [ ] **Step 7: Run the full user-client suite**

```bash
pnpm --filter @chatsundere/user-client typecheck && pnpm --filter @chatsundere/user-client test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/src/components/AccordionCard.tsx apps/user-client/tests/routes/persona-editor.required-markers.test.tsx apps/user-client/tests/routes/persona-editor.test.tsx
git commit -m "$(cat <<'EOF'
Restructure Persona Editor — Identity surfaced, required markers

- Identity (Name + Tagline) lifted out of the accordion so the fields
  are always visible — by far the most-edited part.
- Accordion order: Custom Instructions → Model → Behavior → Mindspace
  → About-Me-Override. About-Me-Override is the least used and lands
  last.
- Required-field markers (red ✕): inline next to Name when empty;
  on the accordion header for Custom Instructions and Model when
  their content is missing.
- Model now requires both providerId and modelId before Save unlocks
  (was only providerId, which let half-filled drafts through).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Manual verification checklist + STATUS update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`
- Modify: `superpowers/specs/2026-05-23-client-block-1-design.md` (Decisions 29-35)

The spec extension and STATUS update are handled in this single doc-only commit
at the end.

- [ ] **Step 1: Append Decisions 29-35 to the design spec**

Edit `superpowers/specs/2026-05-23-client-block-1-design.md`. Inside § 2
("Decisions"), append the seven new sub-sections (29 through 35) following the
existing pattern. Each gets a one-paragraph rationale tracing back to Chris's
device-smoke feedback on 2026-05-24:

- **D29** (Texture is a user/persona property, not a mindspace property):
  Schema v3 moves authoritative texture state to SettingsRow.userTexture +
  PersonaRow.textureOverride. MindspaceRow.texture remains as a seed default
  for resolver fallback.
- **D30** (AutoSizeTextarea for growable multi-line inputs): About-Me, Global
  System Prompt, Custom Instructions, About-Me-Override grow with content;
  Global System Prompt and CI cap at maxRows={20-30}; About-Me uncapped.
- **D31** (ProviderSheet uses explicit Save; no auto-save-on-close): "Test &
  Save" button runs the probe. Close via × discards. Probe failure keeps the
  sheet open with error state visible.
- **D32** (Required-field markers as red ✕): Inline next to Identity inputs;
  on accordion headers for sections containing unmet requirements. Identity
  is outside the accordion so its markers are inline only.
- **D33** (Persona Editor structure): Identity is always visible (outside
  accordion); accordion order is Custom Instructions → Model → Behavior →
  Mindspace-Override → About-Me-Override. Model requires both providerId and
  modelId to save.
- **D34** (Kollision-free monogram algorithm from chatsune): Five-strategy port
  (multi-part first+last initials → letter pairs → doubled first → AA…ZZ →
  '??'). Replaces naïve `name.slice(0,2)` to prevent duplicate monograms when
  personas share leading letters.
- **D35** (Self-hosted Lora + Inter typography): Lora woff2 reused from
  chatsune for `--font-display`; Inter variable woff2 from upstream rsms/inter
  for `--font-sans`. No CDN call at runtime. Display heads remain Instrument-
  Serif-influenced via the existing class, but Lora replaces it as the actual
  served face for the new surfaces.

Also update § 4.1 schema annotations to reflect v3 fields:
`SettingsRow.userTexture: MindspaceTexture (v3)` and
`PersonaRow.textureOverride: MindspaceTexture | null (v3)`.

Also update § 11 Open Questions: remove the "MindspaceRow.texture is the source
of truth — is that right?" entry if present; it's resolved by D29.

- [ ] **Step 2: Update `obsidian/STATUS-CLIENT-ONLY.md`**

Add a new `## Done (continued from Phase 2)` block summarising what landed:

```markdown
- **Phase 2.5 — Polish & Bug-Bash (2026-05-24)**. Squashed into one
  Phase-2.5 commit. What landed:
  - `apps/user-client/public/fonts/` — self-hosted Lora-Regular,
    Lora-Italic (copied from chatsune) + Inter variable (downloaded
    from rsms/inter). No CDN at runtime. `src/index.css` `@theme`
    points `--font-display` to Lora and `--font-sans` to Inter.
  - `apps/user-client/src/lib/monogram.ts` — kollision-free port of
    `chatsune/backend/modules/persona/_monogram.py`. Five-strategy
    fallback (multi-part initials → pair iteration → doubled →
    AA…ZZ → '??'). 8 Vitest tests.
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v3 migration
    adds `SettingsRow.userTexture` and `PersonaRow.textureOverride`,
    backfilling existing rows from the user's default mindspace.
    MindspaceRow.texture remains as seed-default. 4 Vitest tests.
  - `apps/user-client/src/state/mindspace-resolver.ts` + `mindspace.store.ts`
    — resolver picks texture from
    `persona.textureOverride > settings.userTexture > mindspace.texture`.
  - `apps/user-client/src/components/MindspaceLayer.tsx` — wraps texture
    in `position: fixed; inset: 0` so the background spans the full
    viewport regardless of scroll.
  - `apps/user-client/src/components/MindspacePicker.tsx` — preview card
    renders a live `MindspaceTexture` sample (was a flat colour panel).
    Texture is now genuinely controlled by the caller.
  - `apps/user-client/src/components/AutoSizeTextarea.tsx` — new
    component replacing fixed-height textareas across Settings + Persona
    Editor.
  - `apps/user-client/src/components/ProviderSheet.tsx` — opaque bg-ink
    background with click-through backdrop; explicit Test & Save button;
    no auto-save-on-close (closing discards); Ollama-Cloud save bug
    fixed (was reading from stale TanStack-Query cache); proxy URL
    placeholder is now `https://example.com`; API-key + proxy fields
    suppress browser/password-manager autofill.
  - `apps/user-client/src/routes/app/circle.tsx` — FAB `+` glyph fixed
    (was invisible due to undefined `text-bg` class).
  - `apps/user-client/src/routes/app/persona-editor.tsx` — Identity
    lifted outside the accordion (always visible); accordion order
    Custom Instructions → Model → Behavior → Mindspace → About-Me-Override;
    required-field markers (red ✕) inline at Identity and on accordion
    headers for Custom Instructions / Model; Save requires modelId
    in addition to providerId.
  - `apps/user-client/src/routes/app/settings.tsx` — texture wires to
    `SettingsRow.userTexture`; growable textareas use AutoSizeTextarea.
  - `apps/user-client/src/data/mindspaces.ts` — `useUpdateMindspaceTexture`
    removed; texture no longer lives on the mindspace row.
  - Tests: ~25 new Vitest cases across monogram, db v3 migration, the
    new component, the picker controlled API, the sheet polish, and
    the persona-editor markers. Total user-client tests still green;
    crypto + llm-unified untouched.
```

Also update the `Doing now` block to say "Phase 2.5 finished. Paused for
Chris's manual re-smoke" and the `Next session` block to enumerate the
re-smoke checklist for the surfaces touched (FAB visible, mindspace texture
spans page, picker stays stable on colour change, About-Me grows, Provider
Sheet opaque + has Save button + Ollama saves, Persona Editor Identity
outside accordion + new order + red ✕ on empty Name and on collapsed
Custom-Instructions / Model accordions).

Move the existing Phase-3 brainstorm item further down so it remains the
next user-facing step after the re-smoke passes.

- [ ] **Step 3: Commit doc updates**

```bash
git add superpowers/specs/2026-05-23-client-block-1-design.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "$(cat <<'EOF'
Document Phase-2.5 decisions and update STATUS [skip ci]

Decisions 29-35 added to the Block-1 design spec; STATUS-CLIENT-ONLY
gains the Phase-2.5 Done block and an updated re-smoke checklist for
Chris's manual verification.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## End-of-Phase Squash

After Task 11 commits, squash the per-task commits into a single Phase-2.5
commit on master (same pattern as Phase 1 and Phase 2). Use `git reset --soft`
to the pre-Phase-2.5 tip and re-commit with a single comprehensive message.

```bash
# Identify the commit just before this phase started (typically the head before
# Task 0's commit). For Phase 2.5 starting after ea49054:
BASE=ea49054
git reset --soft $BASE
git status  # sanity-check the staged set
git commit -m "$(cat <<'EOF'
Land Client Block 1 Phase 2.5 — Polish & Bug-Bash

Following Chris's device-smoke of Phase 2, this phase tightens
typography, fixes texture-state regressions, restructures the
Persona Editor for everyday use, and lands a working ProviderSheet.

Highlights:
- Self-hosted Lora + Inter typography (no CDN at runtime).
- Kollision-free monogram algorithm ported from chatsune.
- Schema v3: texture moves from MindspaceRow to SettingsRow.userTexture
  and PersonaRow.textureOverride. Picker stops fighting the user.
- MindspaceLayer covers the full viewport.
- AutoSizeTextarea replaces every fixed-height growable input.
- ProviderSheet: opaque background, explicit Test & Save, Ollama-Cloud
  save bug fixed, password-manager autofill suppressed.
- Persona Editor: Identity always visible, accordion reordered,
  required-field markers on header + inline, Model requires modelId.
- Entrance Hall FAB glyph fixed (was invisible due to undefined
  text-bg class).

Tests: ~25 new Vitest cases; all user-client tests pass; crypto +
llm-unified untouched (and green).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (writing-plans checklist applied)

**1. Spec coverage** — every feedback bullet from Chris's smoke test:

| Feedback | Task |
|---|---|
| About-Me textarea wachsen | T8 |
| Texture-preview verschwindet bei Farbwechsel | T6 (caller-side wired via T7) |
| Texture-preview nur eine Bildschirmhöhe | T5 |
| Texture-preview transparentes Overlay | T6 (now renders real MindspaceTexture) |
| Lora für serif | T0 |
| Global System Prompt wachsen | T8 |
| API-key Overlay durchsichtig | T9 |
| API-key Overlay braucht Save-Button | T9 |
| Proxy-URL Default example.com | T9 |
| API-key Felder Password→Bitwarden | T9 |
| Ollama Cloud speichert API-Key nicht | T9 |
| "+" FAB weißer Kreis | T1 |
| About-Me-Override unten, Reihenfolge | T10 |
| Mindspace selection texture funktioniert nicht | T6 + T7 |
| Pflichtfeld-X (Identity, CI, Model) | T10 |
| Multiline inputs wachsen generell | T8 |
| Sans/Serif Fonts | T0 |
| Monogramm-Algorithmus | T2 |

All 18 feedback items map to a task. No gaps.

**2. Placeholder scan** — no TODO / TBD / "implement later" strings in any task
body. Every code block contains real code. Every command has an expected
outcome.

**3. Type consistency** — `MindspaceTexture` type imported consistently; `userTexture`
spelled identically across SettingsRow / migration / resolver / store / settings
route. `textureOverride` spelled identically across PersonaRow / migration /
resolver / persona-editor. `generateMonogram` + `monogramFor` are the only two
public functions from `lib/monogram.ts` and both are referenced. `AutoSizeTextarea`
props (`value`, `onChange`, `minRows`, `maxRows`, `placeholder`, `aria-label`,
`id`) match between definition (T8) and call sites (T8, T10).

Plan complete and saved to `superpowers/plans/2026-05-24-client-block-1-phase-2-5-polish.md`.
