# Phase 2.9 — Mindspace Cards & Adult Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four interlocking polish items — persona-card mindspace tinting, NSFW/SFW differentiated outer ring + shimmer, global adult-mode pill in the brand-bar with no-leak filter semantics, and persona-editor ambient-mindspace takeover.

**Architecture:** All changes in `apps/user-client`. New `SettingsRow.adultMode` field via Dexie v5; new `useAdultMode()` + `useFilteredPersonas()` hooks form the data layer; new `<AdultModeToggle />` lands centred in the brand-bar; PersonaCard gets mindspace background tint + NSFW/SFW box-shadow ring + CSS shimmer keyframes with per-card random delay; Circle and Hall switch their persona reads to the filtered hook; Persona-Editor's mount-effect updates the global `useMindspaceStore`. **Critical no-leak rule:** when the SFW filter yields an empty result, the empty-state is identical to the "no personas yet" state — no hint anywhere that hidden personas exist (Spec § 2 Decision 4).

**Tech Stack:** TypeScript strict, React 18, Tailwind v4, Dexie v5 migration, Vitest + `@testing-library/react`, fake-indexeddb. No new packages.

**References:**
- Spec: [`superpowers/specs/2026-05-24-phase-2-9-mindspace-cards-adult-mode-design.md`](../specs/2026-05-24-phase-2-9-mindspace-cards-adult-mode-design.md)
- Phase 2.8 plan (for style reference): [`superpowers/plans/2026-05-24-polish-block-phase-2-8.md`](2026-05-24-polish-block-phase-2-8.md)
- Status: [`obsidian/STATUS-CLIENT-ONLY.md`](../../obsidian/STATUS-CLIENT-ONLY.md)

---

## File Structure

### Created

- `apps/user-client/src/components/AdultModeToggle.tsx`
- `apps/user-client/tests/boot/client-data-db-v5.test.ts`
- `apps/user-client/tests/data/use-adult-mode.test.tsx`
- `apps/user-client/tests/data/use-filtered-personas.test.tsx`
- `apps/user-client/tests/components/AdultModeToggle.test.tsx`
- `apps/user-client/tests/routes/circle.filter.test.tsx`
- `apps/user-client/tests/routes/entrance-hall.filter.test.tsx`
- `apps/user-client/tests/routes/persona-editor.mindspace.test.tsx`

### Modified

- `apps/user-client/src/boot/client-data-db.ts` — `SettingsRow.adultMode` field, v5 migration, seed default
- `apps/user-client/src/data/settings.ts` — `useAdultMode()` hook
- `apps/user-client/src/data/personas.ts` — `useFilteredPersonas()` hook
- `apps/user-client/src/components/PersonaCard.tsx` — new `mindspace` prop; mindspace tint; adult-status glow; shimmer
- `apps/user-client/src/index.css` — `.adult-mode-toggle*`, `.persona-card*`, `@keyframes pill-shimmer`, `@keyframes persona-shimmer`, reduced-motion overrides
- `apps/user-client/src/routes/root.tsx` — mount `<AdultModeToggle />` between logo and badge
- `apps/user-client/src/routes/app/circle.tsx` — switch to `useFilteredPersonas`; resolve + pass mindspace to each card; ensure empty-state stays identical to no-personas state
- `apps/user-client/src/routes/app/entrance-hall.tsx` — switch to `useFilteredPersonas` for `personaCount` and `recentPersona` lookup
- `apps/user-client/src/routes/app/persona-editor.tsx` — mount-effect updates `useMindspaceStore` with the loaded persona's mindspace
- `apps/user-client/tests/unit/persona-card.test.tsx` — update existing tests to pass the new `mindspace` prop
- `apps/user-client/tests/routes/root.brand-logo.test.tsx` (if any new brand-bar assertions break — verify and fix)
- `apps/user-client/tests/routes/root.splash.test.tsx` (same)
- `apps/user-client/tests/routes/settings.draft-save.test.tsx` — `STABLE_SETTINGS` mock gets `adultMode: 'nsfw'`
- `apps/user-client/tests/boot/client-data-db-v3.test.ts` / `v4.test.ts` — verify no regressions
- `apps/user-client/tests/unit/client-data-db.test.ts` — bump `db.verno === 4` to `5`
- `obsidian/STATUS-CLIENT-ONLY.md` — Phase 2.9 Done block + Doing/Next update

### Deleted

(none)

---

## Pre-Existing Pitfalls

- **Vitest test glob is `tests/**/*.test.{ts,tsx}`** — put every new test file under `apps/user-client/tests/...`.
- **SPDX header line 1, blank line 2, imports line 3** — Biome's `organizeImports` re-sorts.
- **Biome rules:** no `forEach` (use `for…of`), no non-null `!`, interactive `<div>` needs `role`/`tabIndex`/keyboard handler.
- **Tailwind v4 colour tokens** in `src/index.css` `@theme`: `ink`, `ink-soft`, `paper`, `paper-soft`, `aurora-{50,200,500,700,900}`, `success`, `warning`, `danger`. `bg` is NOT defined — use `ink`.
- **`@chatsundere/llm-unified` and `@chatsundere/crypto`** must already be built (dist/ exists). If typecheck cites them, run `pnpm --filter @chatsundere/crypto build` / `pnpm --filter @chatsundere/llm-unified build`.
- **Run `pnpm lint` and `pnpm typecheck` from the repo root.**
- **Build verification is `pnpm run build`**, not `tsc --noEmit` alone.
- **TanStack-Query cache** can be stale right after `mutateAsync` — relevant for `useAdultMode().toggleMode()`; the toggle button must derive its state from the cache, not from an internal copy.
- **Dexie v5 migration must include the full stores object** even if unchanged (per the existing v2/v3/v4 pattern in `client-data-db.ts:138-189`).
- **Adding `adultMode` to `SettingsRow` interface as required** means every inline `SettingsRow` construction in tests must include it — grep for `globalUnlockerPrompt:` to find them all.
- **Existing v3/v4 migration tests plant pre-v5 settings rows.** They are testing upgrade paths — leave them without `adultMode` so they exercise the backfill.
- **No-leak rule (Spec § 2 Decision 4):** any code that shows persona-related counts, lists, or recent-references must use `useFilteredPersonas()` — never `usePersonas()` for display purposes.
- **`PersonaCard` is consumed by `Circle` today.** The new `mindspace` prop is required; do not add a "default mindspace" fallback inside the card — make the call site always resolve it. This forces every PersonaCard consumer (now and in the future) to think about mindspace context.
- **`PersonaCard` may be rendered before `mindspaces.data` loads in Circle.** Circle must guard `if (!ms) return null` per the spec § 4.6.
- **Subagents never push or switch branches.** Commit on master only.
- **All 10 tasks accumulate in the working tree.** Only Task 10 commits. Do NOT commit at intermediate tasks. Task 11 (STATUS update) is a separate `[skip ci]` commit.

---

## Task 1: Dexie v5 migration (adultMode field)

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/tests/boot/client-data-db-v5.test.ts`
- Modify: `apps/user-client/tests/unit/client-data-db.test.ts` (verno bump)
- Modify: `apps/user-client/tests/routes/settings.draft-save.test.tsx` (mock gets adultMode)

`SettingsRow` gains `adultMode: 'nsfw' | 'sfw'`. v5 migration backfills `'nsfw'` on existing rows. v1 seed for fresh installs writes `'nsfw'`. Per spec § 2 Decision 2.

- [ ] **Step 1: Write the failing migration test**

Create `apps/user-client/tests/boot/client-data-db-v5.test.ts`:

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

const V4_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
} as const;

async function plantV4DatabaseWithoutAdultMode(): Promise<void> {
  const now = Date.now();
  const v4 = new Dexie('chatsundere_client_data');
  v4.version(1).stores(V4_STORES);
  v4.version(2).stores(V4_STORES);
  v4.version(3).stores(V4_STORES);
  v4.version(4).stores(V4_STORES);
  await v4.open();
  await v4.table('mindspaces').add({
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
  await v4.table('settings').add({
    id: 1,
    displayName: '',
    globalUnlockerPrompt: '',
    globalAboutMe: '',
    defaultMindspaceId: 'ms-1',
    userTexture: 'cloudy',
    animationsEnabled: true,
    corsProxy: null,
    createdAt: now,
    updatedAt: now,
  });
  v4.close();
}

describe('client-data-db v5 migration (adultMode)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds SettingsRow.adultMode as "nsfw" on a fresh install', async () => {
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.adultMode).toBe('nsfw');
  });

  it('on upgrade, backfills SettingsRow.adultMode to "nsfw" for an existing v4 row', async () => {
    await plantV4DatabaseWithoutAdultMode();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.adultMode).toBe('nsfw');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- client-data-db-v5
```

Expected: both cases FAIL — `adultMode` is `undefined`.

- [ ] **Step 3: Add `adultMode` to SettingsRow + v5 migration + seed**

Open `apps/user-client/src/boot/client-data-db.ts`.

(a) In the `SettingsRow` interface (around line 11-22), add `adultMode` after `animationsEnabled`:

```ts
export interface SettingsRow {
  id: 1;
  displayName: string;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
  animationsEnabled: boolean;
  adultMode: 'nsfw' | 'sfw';
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}
```

(b) Inside the `ClientDataDb` constructor, AFTER the existing `this.version(4)…upgrade(…)` block, append:

```ts
    this.version(5)
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
        // Backfill SettingsRow.adultMode. Default is 'nsfw' per spec §2
        // Decision 2 — SFW is treated as the special case, not the default.
        // This setting is device-local and must be excluded from any future
        // sync mechanism.
        const settings = await tx.table('settings').get(1);
        if (settings && typeof settings.adultMode !== 'string') {
          await tx.table('settings').update(1, { adultMode: 'nsfw' });
        }
      });
```

(c) In `seedBuiltinsIfNeeded`, find the `db.settings.add({ … })` call and add `adultMode: 'nsfw'` after `animationsEnabled: true`:

```ts
      await db.settings.add({
        id: 1,
        displayName: '',
        globalUnlockerPrompt: '',
        globalAboutMe: '',
        defaultMindspaceId: aurumId,
        userTexture: 'cloudy',
        animationsEnabled: true,
        adultMode: 'nsfw',
        corsProxy: null,
        createdAt: now,
        updatedAt: now,
      });
```

- [ ] **Step 4: Run v5 test to confirm passing**

```
pnpm --filter user-client test -- client-data-db-v5
```

Expected: both cases PASS.

- [ ] **Step 5: Bump verno assertion in unit test**

Open `apps/user-client/tests/unit/client-data-db.test.ts`. Find the assertion `expect(db.verno).toBe(4)` (it was bumped to 4 in Task 6 of Phase 2.8). Change to:

```ts
expect(db.verno).toBe(5);
```

- [ ] **Step 6: Patch the STABLE_SETTINGS test mock**

Open `apps/user-client/tests/routes/settings.draft-save.test.tsx`. Find the `STABLE_SETTINGS` constant (around line 10-22). Add `adultMode: 'nsfw',` after `userTexture: 'cloudy',`:

```ts
const STABLE_SETTINGS: SettingsRow = {
  id: 1,
  displayName: '',
  globalUnlockerPrompt: '',
  globalAboutMe: '',
  defaultMindspaceId: 'ms-1',
  userTexture: 'cloudy',
  adultMode: 'nsfw',
  animationsEnabled: true,
  corsProxy: null,
  createdAt: 0,
  updatedAt: 0,
};
```

(Adjust if the exact field order differs — match what's there + add `adultMode`.)

- [ ] **Step 7: Run all DB + settings tests**

```
pnpm --filter user-client test -- client-data-db settings
```

Expected: all DB tests + settings tests still green; v5 tests now in the mix.

---

## Task 2: useAdultMode hook

**Files:**
- Modify: `apps/user-client/src/data/settings.ts`
- Create: `apps/user-client/tests/data/use-adult-mode.test.tsx`

Hook exposes `{ mode, toggleMode, setMode }`. Reads from `useSettings()`; writes via `useUpdateSettings()`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/data/use-adult-mode.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useAdultMode } from '../../src/data/settings.js';

function Probe(): JSX.Element {
  const { mode, toggleMode, setMode } = useAdultMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button data-testid="toggle" type="button" onClick={() => void toggleMode()}>
        toggle
      </button>
      <button data-testid="set-sfw" type="button" onClick={() => void setMode('sfw')}>
        sfw
      </button>
    </div>
  );
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useAdultMode', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns "nsfw" by default (fresh install)', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('nsfw'));
  });

  it('toggleMode flips nsfw → sfw and persists', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('nsfw'));
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('sfw'));
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.adultMode).toBe('sfw');
  });

  it('setMode writes a specific value', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('nsfw'));
    await act(async () => {
      screen.getByTestId('set-sfw').click();
    });
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('sfw'));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- use-adult-mode
```

Expected: FAIL — `useAdultMode` not exported.

- [ ] **Step 3: Implement the hook**

Open `apps/user-client/src/data/settings.ts`. Append at the bottom of the file (after `useDisplayName`):

```ts
/**
 * Adult-mode toggle for filtering personas (and future surfaces). The mode
 * is **device-local**: when sync lands in a future phase, this field must
 * be in the sync-exclusion list. Default is 'nsfw' (per spec §2 Decision 2
 * — SFW is treated as the special case, not the default).
 */
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
    toggleMode: () =>
      update.mutateAsync({ adultMode: mode === 'nsfw' ? 'sfw' : 'nsfw' }).then(() => undefined),
    setMode: (m) => update.mutateAsync({ adultMode: m }).then(() => undefined),
  };
}
```

- [ ] **Step 4: Run to confirm passing**

```
pnpm --filter user-client test -- use-adult-mode
```

Expected: 3/3 PASS.

---

## Task 3: useFilteredPersonas hook

**Files:**
- Modify: `apps/user-client/src/data/personas.ts`
- Create: `apps/user-client/tests/data/use-filtered-personas.test.tsx`

Hook composes `usePersonas()` + `useAdultMode()` and returns the filtered list as a `UseQueryResult`-shaped object (drop-in for callers expecting `{ data, isLoading, ... }`).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/data/use-filtered-personas.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useFilteredPersonas } from '../../src/data/personas.js';
import { useAdultMode } from '../../src/data/settings.js';

async function seedPersonas() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: 'p-sfw',
    name: 'Calm', tagline: '', colour: '#fff', font: 'serif', instructions: 'x',
    providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: false,
    createdAt: now, updatedAt: now,
  });
  await db.personas.add({
    id: 'p-nsfw',
    name: 'Spicy', tagline: '', colour: '#fff', font: 'serif', instructions: 'x',
    providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: true,
    createdAt: now + 1, updatedAt: now + 1,
  });
}

function Probe(): JSX.Element {
  const personas = useFilteredPersonas();
  const { toggleMode } = useAdultMode();
  return (
    <div>
      <span data-testid="count">{personas.data?.length ?? 'loading'}</span>
      <span data-testid="names">{(personas.data ?? []).map((p) => p.name).join(',')}</span>
      <button data-testid="toggle" type="button" onClick={() => void toggleMode()}>
        toggle
      </button>
    </div>
  );
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useFilteredPersonas', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersonas();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('NSFW mode returns all personas', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('names').textContent).toBe('Calm,Spicy');
  });

  it('SFW mode filters out adultPersona: true', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('names').textContent).toBe('Calm');
  });

  it('reacts to mode change without remount', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await act(async () => screen.getByTestId('toggle').click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    await act(async () => screen.getByTestId('toggle').click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- use-filtered-personas
```

Expected: FAIL — `useFilteredPersonas` not exported.

- [ ] **Step 3: Implement the hook**

Open `apps/user-client/src/data/personas.ts`. At the top add:

```ts
import { useAdultMode } from './settings.js';
```

(Add it alphabetically with the other imports.)

Append at the bottom of the file:

```ts
/**
 * Personas filtered by the current adult-mode setting. **All UI surfaces
 * that list personas, count personas, or look up a recent persona for
 * display must use this hook**, not the raw `usePersonas()`.
 * Raw `usePersonas()` is reserved for Editor-class persona-by-id lookups.
 *
 * Per spec §2 Decision 4 (no-leak): the empty-state for an all-NSFW list
 * in SFW mode is the responsibility of the consuming UI — it must render
 * identically to the empty-state for "no personas exist at all", with no
 * counter, no hint, no copy referencing hidden items.
 */
export function useFilteredPersonas() {
  const personas = usePersonas();
  const { mode } = useAdultMode();
  const data = personas.data?.filter((p) => mode === 'nsfw' || !p.adultPersona);
  return { ...personas, data } as typeof personas;
}
```

- [ ] **Step 4: Run to confirm passing**

```
pnpm --filter user-client test -- use-filtered-personas
```

Expected: 3/3 PASS.

---

## Task 4: AdultModeToggle component

**Files:**
- Create: `apps/user-client/src/components/AdultModeToggle.tsx`
- Create: `apps/user-client/tests/components/AdultModeToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/AdultModeToggle.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { AdultModeToggle } from '../../src/components/AdultModeToggle.js';

function renderToggle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdultModeToggle />
    </QueryClientProvider>,
  );
}

describe('AdultModeToggle', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('shows NSFW label and nsfw class by default', async () => {
    renderToggle();
    const btn = await screen.findByRole('button', { name: /adult mode: nsfw/i });
    expect(btn.textContent).toContain('NSFW');
    expect(btn.className).toContain('adult-mode-toggle-nsfw');
  });

  it('shows SFW label and sfw class after toggling', async () => {
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    renderToggle();
    const btn = await screen.findByRole('button', { name: /adult mode: sfw/i });
    expect(btn.textContent).toContain('SFW');
    expect(btn.className).toContain('adult-mode-toggle-sfw');
  });

  it('renders a ⇄ glyph as discoverability hint', async () => {
    renderToggle();
    await screen.findByRole('button');
    expect(screen.getByText('⇄')).toBeInTheDocument();
  });

  it('click toggles the persisted mode', async () => {
    renderToggle();
    const btn = await screen.findByRole('button', { name: /adult mode: nsfw/i });
    fireEvent.click(btn);
    await waitFor(async () => {
      const settings = await getClientDataDb().settings.get(1);
      expect(settings?.adultMode).toBe('sfw');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adult mode: sfw/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- AdultModeToggle
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/user-client/src/components/AdultModeToggle.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useAdultMode } from '../data/settings.js';

/**
 * Brand-bar pill toggling the global adult-mode filter.
 *
 * Single-state pill: shows the active mode + ⇄ glyph for discoverability.
 * Click toggles. NSFW = red-toned (matches PersonaCard NSFW glow);
 * SFW = grey-toned (matches PersonaCard SFW glow). The pill itself
 * shimmers subtly via CSS (.adult-mode-toggle::before in index.css);
 * prefers-reduced-motion disables the shimmer.
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
      <span aria-hidden="true" className="opacity-60">
        ⇄
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Add CSS rules**

Open `apps/user-client/src/index.css`. After the `.splash-*` block (added in Polish 4/4 of Phase 2.8), append:

```css
/* ===== Adult-mode toggle pill ===== */

.adult-mode-toggle {
  position: relative;
  overflow: hidden;
  border: 1px solid transparent;
  transition: background 200ms ease, border-color 200ms ease;
  cursor: pointer;
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

.adult-mode-toggle-nsfw::before {
  animation: pill-shimmer 7s ease-in-out infinite;
}

.adult-mode-toggle-sfw::before {
  animation: pill-shimmer 12s ease-in-out infinite;
}

@keyframes pill-shimmer {
  0%,
  85% {
    transform: translateX(-110%);
  }
  92% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(110%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .adult-mode-toggle::before {
    animation: none;
  }
}
```

- [ ] **Step 5: Run to confirm passing**

```
pnpm --filter user-client test -- AdultModeToggle
```

Expected: 4/4 PASS.

---

## Task 5: Mount AdultModeToggle in Root brand-bar

**Files:**
- Modify: `apps/user-client/src/routes/root.tsx`
- Modify: `apps/user-client/tests/routes/root.brand-logo.test.tsx` (verify no break)

- [ ] **Step 1: Write a failing test that asserts the toggle is present in Root**

Create `apps/user-client/tests/routes/root.adult-mode-pill.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Root } from '../../src/routes/root.js';

describe('Root brand-bar adult-mode pill', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    sessionStorage.setItem('splashShown', '1'); // suppress splash so the pill is asserted directly
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    sessionStorage.clear();
    await _resetClientDataDbForTests();
  });

  it('mounts the AdultModeToggle in the brand-bar header', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Root />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /adult mode/i })).toBeInTheDocument(),
    );
    // The pill lives inside the brand-bar header (sibling to logo + badge).
    const pill = screen.getByRole('button', { name: /adult mode/i });
    expect(pill.closest('header')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- root.adult-mode-pill
```

Expected: FAIL — no element with role button + name "adult mode" present in Root.

- [ ] **Step 3: Mount the toggle in Root**

Open `apps/user-client/src/routes/root.tsx`. Add to imports (after the SplashOverlay import):

```ts
import { AdultModeToggle } from '../components/AdultModeToggle.js';
```

In the JSX, find the brand-bar `<header>` block. Currently it has two children (Link + div with badge), with `flex justify-between`. Add `gap-2` to the className, and insert `<AdultModeToggle />` between the Link and the div:

```tsx
<header className="sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-3 backdrop-blur-sm lg:px-6 lg:py-4">
  <Link to="/" className="brand-logo" style={{ opacity: topbarLogoVisible ? 1 : 0 }}>
    <span
      ref={(el) => {
        topbarLogoRef.current = el;
      }}
      className="brand-logo-text"
    >
      Chatsundere
    </span>
    <span className="brand-logo-twinkle" aria-hidden="true">
      ✦
    </span>
  </Link>
  <AdultModeToggle />
  <div className="flex items-center gap-2 lg:gap-3">
    {/* Username hidden on mobile — too cramped at 380 px */}
    {session && (
      <span className="hidden font-mono text-xs text-paper-soft lg:inline">
        {session.username}
      </span>
    )}
    <ConnectivityBadge />
  </div>
</header>
```

(Only the changes are: `gap-2` added to the header className, `<AdultModeToggle />` inserted between the Link and the div. Everything else unchanged.)

- [ ] **Step 4: Run to confirm passing**

```
pnpm --filter user-client test -- root.adult-mode-pill
```

Expected: PASS.

- [ ] **Step 5: Run existing root tests to confirm no regressions**

```
pnpm --filter user-client test -- root
```

Expected: `root.brand-logo`, `root.splash`, `root.adult-mode-pill` all PASS.

---

## Task 6: PersonaCard redesign (mindspace + adult-glow + shimmer)

**Files:**
- Modify: `apps/user-client/src/components/PersonaCard.tsx`
- Modify: `apps/user-client/src/index.css`
- Modify: `apps/user-client/tests/unit/persona-card.test.tsx`

Card gets a new required `mindspace: ResolvedMindspace` prop. Background tint from mindspace palette; outer ring + shimmer from `adultPersona` flag. Per-card random shimmer delay via stable hash of `persona.id`.

- [ ] **Step 1: Update the existing PersonaCard tests to use the new prop**

Open `apps/user-client/tests/unit/persona-card.test.tsx`. Add an import:

```ts
import type { ResolvedMindspace } from '../../src/state/mindspace-resolver.js';
```

Add a helper at the top:

```ts
function makeMindspace(overrides: Partial<ResolvedMindspace> = {}): ResolvedMindspace {
  return {
    id: 'ms-1',
    displayName: 'Aurum',
    palette: {
      bg: '#1a1208',
      surfaceBase: '#3a2e15',
      surfaceRaised: '#4a3d20',
      surfaceInput: '#2a2010',
      accent: '#c9a84c',
      accentSubtle: '#9a7d2e',
      accentBorder: '#6a5821',
      accentBorderActive: '#c9a84c',
      accentGlow: '#c9a84c',
      text: { primary: '#fff', secondary: '#ddd', muted: '#888', ghost: '#555' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
    ...overrides,
  };
}
```

Update every `<PersonaCard ... />` invocation in the file to pass `mindspace={makeMindspace()}`. There are four invocations; each becomes:

```tsx
<PersonaCard persona={...} mindspace={makeMindspace()} hasProvider={...} onChat={...} />
```

Add three NEW test cases at the end of the describe block:

```tsx
  it('applies mindspace background tint and base border colour', () => {
    const ms = makeMindspace({
      palette: {
        ...makeMindspace().palette,
        surfaceBase: '#3a2e15',
        accentBorder: '#6a5821',
      },
    });
    const { container } = wrap(
      <PersonaCard persona={makePersona()} mindspace={ms} hasProvider onChat={() => {}} />,
    );
    const li = container.querySelector('[data-persona-card]') as HTMLElement;
    expect(li.style.background).toContain('#3a2e15');
    expect(li.style.border).toContain('#6a5821');
  });

  it('applies persona-card-nsfw class when persona is adult', () => {
    const { container } = wrap(
      <PersonaCard
        persona={makePersona({ adultPersona: true })}
        mindspace={makeMindspace()}
        hasProvider
        onChat={() => {}}
      />,
    );
    const li = container.querySelector('[data-persona-card]') as HTMLElement;
    expect(li.className).toContain('persona-card-nsfw');
    expect(li.className).not.toContain('persona-card-sfw');
    expect(li.dataset.adult).toBe('true');
  });

  it('applies persona-card-sfw class when persona is not adult', () => {
    const { container } = wrap(
      <PersonaCard
        persona={makePersona({ adultPersona: false })}
        mindspace={makeMindspace()}
        hasProvider
        onChat={() => {}}
      />,
    );
    const li = container.querySelector('[data-persona-card]') as HTMLElement;
    expect(li.className).toContain('persona-card-sfw');
    expect(li.className).not.toContain('persona-card-nsfw');
    expect(li.dataset.adult).toBe('false');
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```
pnpm --filter user-client test -- persona-card
```

Expected: tests FAIL — the new `mindspace` prop doesn't exist; the new classes/data attributes don't render.

- [ ] **Step 3: Reimplement PersonaCard**

Open `apps/user-client/src/components/PersonaCard.tsx`. Replace the entire file:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { Link } from 'react-router-dom';
import type { PersonaRow } from '../boot/client-data-db.js';
import { monogramFor } from '../lib/monogram.js';
import type { ResolvedMindspace } from '../state/mindspace-resolver.js';

interface Props {
  persona: PersonaRow;
  mindspace: ResolvedMindspace;
  hasProvider: boolean;
  onChat: (personaId: string) => void;
}

/**
 * Compact card representing a single persona in My Circle.
 *
 * Visual layers (outer-to-inner):
 *  - Adult-status: NSFW (danger-red) or SFW (paper-soft-grey) box-shadow
 *    ring + shimmer streak via .persona-card-{nsfw,sfw} CSS.
 *  - Mindspace: card background tint (palette.surfaceBase at 10% opacity)
 *    + base border (palette.accentBorder) reflect the persona's resolved
 *    mindspace (with fallback to user default — resolved by the caller).
 *  - Persona identity: monogram tile + name in persona.colour, tagline.
 *
 * The `mindspace` prop is required — there is intentionally no default
 * inside this component. Every consumer must explicitly resolve and pass
 * the mindspace so the call site thinks about context (see spec §4.5).
 *
 * The shimmer animation is per-card random-offset (derived from persona.id)
 * so multiple cards do not glitter in unison. prefers-reduced-motion
 * disables the shimmer; the static glow ring remains visible.
 */
export function PersonaCard({ persona, mindspace, hasProvider, onChat }: Props): JSX.Element {
  const monogram = monogramFor(persona.name);
  const tagline = persona.tagline || persona.instructions.slice(0, 60);
  // 0–4 second random animation delay so cards don't shimmer in unison.
  const shimmerDelaySeconds = (hashStringToInt(persona.id) % 4000) / 1000;

  return (
    <li
      data-persona-card
      data-adult={persona.adultPersona ? 'true' : 'false'}
      className={`persona-card relative flex items-center gap-3 rounded-lg transition ${
        persona.adultPersona ? 'persona-card-nsfw' : 'persona-card-sfw'
      }`}
      style={{
        background: `${mindspace.palette.surfaceBase}1a`,
        border: `1px solid ${mindspace.palette.accentBorder}`,
        ['--persona-shimmer-delay' as unknown as string]: `${shimmerDelaySeconds}s`,
      }}
    >
      <Link
        to={`/app/persona/${persona.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 p-3"
      >
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-md font-display text-lg"
          style={{
            background: `${persona.colour}1f`,
            color: persona.colour,
            border: `1px solid ${persona.colour}33`,
          }}
        >
          {monogram}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base" style={{ color: persona.colour }}>
            {persona.name}
          </div>
          <div className="truncate text-xs text-paper-soft">{tagline}</div>
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2 pr-3">
        {hasProvider ? (
          <button
            type="button"
            aria-label="Chat"
            onClick={() => onChat(persona.id)}
            className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper hover:border-paper"
          >
            Chat
          </button>
        ) : (
          <>
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-danger">
              Provider missing
            </span>
            <button
              type="button"
              aria-label="Chat"
              disabled
              className="rounded-md border border-paper-soft/20 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft/40"
            >
              Chat
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** djb2-style stable hash; used only for picking a stable shimmer-delay per persona. */
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
```

- [ ] **Step 4: Add CSS rules for PersonaCard glow + shimmer**

Open `apps/user-client/src/index.css`. After the `.adult-mode-toggle*` block you added in Task 4, append:

```css
/* ===== Persona card glow + shimmer ===== */

.persona-card {
  position: relative;
  overflow: hidden;
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

.persona-card-sfw::after {
  animation: persona-shimmer 12s ease-in-out infinite;
}

.persona-card-nsfw::after {
  animation: persona-shimmer 7s ease-in-out infinite;
}

@keyframes persona-shimmer {
  0%,
  88% {
    transform: translateX(-110%);
  }
  94% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(110%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .persona-card::after {
    animation: none;
  }
}
```

- [ ] **Step 5: Run to confirm passing**

```
pnpm --filter user-client test -- persona-card
```

Expected: all PersonaCard tests PASS (4 existing + 3 new = 7).

---

## Task 7: Circle uses useFilteredPersonas and resolves mindspace per card

**Files:**
- Modify: `apps/user-client/src/routes/app/circle.tsx`
- Create: `apps/user-client/tests/routes/circle.filter.test.tsx`

Circle switches its persona read from `usePersonas()` to `useFilteredPersonas()`, resolves a mindspace per persona (using `resolveMindspace` with the user-default fallback), and passes it to each PersonaCard. Empty-state copy is **unchanged** (no leak — identical to the existing "no personas yet" message).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/circle.filter.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

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
import { Circle } from '../../src/routes/app/circle.js';

async function seedSfwAndNsfw() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: 'p-sfw',
    name: 'Calm', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
    providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: false,
    createdAt: now, updatedAt: now,
  });
  await db.personas.add({
    id: 'p-nsfw',
    name: 'Spicy', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
    providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: true,
    createdAt: now + 1, updatedAt: now + 1,
  });
}

function renderCircle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Circle />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Circle filter (adult mode)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('NSFW mode shows both personas', async () => {
    await seedSfwAndNsfw();
    renderCircle();
    await waitFor(() => expect(screen.getByText('Calm')).toBeInTheDocument());
    expect(screen.getByText('Spicy')).toBeInTheDocument();
  });

  it('SFW mode hides adult personas (no-leak: no hint anywhere)', async () => {
    await seedSfwAndNsfw();
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    renderCircle();
    await waitFor(() => expect(screen.getByText('Calm')).toBeInTheDocument());
    expect(screen.queryByText('Spicy')).toBeNull();
    // No-leak assertions: no text mentioning "hidden", "NSFW", count differences, etc.
    expect(screen.queryByText(/hidden/i)).toBeNull();
    expect(screen.queryByText(/nsfw/i)).toBeNull();
    expect(screen.queryByText(/switch to/i)).toBeNull();
  });

  it('SFW mode with ALL personas adult shows identical "no personas yet" empty state', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p-only-nsfw',
      name: 'OnlyNsfw', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
      providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
      textureOverride: null, temperature: 0.85, adultPersona: true,
      createdAt: now, updatedAt: now,
    });
    await db.settings.update(1, { adultMode: 'sfw' });
    renderCircle();
    await waitFor(() => expect(screen.getByText(/no personas yet/i)).toBeInTheDocument());
    expect(screen.queryByText('OnlyNsfw')).toBeNull();
    // Same empty-state copy as the fresh-install / never-created scenario.
    expect(screen.getByText(/tap the/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- circle.filter
```

Expected: at least one case FAILS — the SFW-only-NSFW case will show "Spicy"/"OnlyNsfw" instead of the empty-state because Circle is still reading raw personas.

- [ ] **Step 3: Update circle.tsx**

Open `apps/user-client/src/routes/app/circle.tsx`. Replace the entire file:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { PersonaCard } from '../../components/PersonaCard.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { resolveMindspace } from '../../state/mindspace-resolver.js';

/**
 * My Circle — lists the user's personas (filtered by current adult-mode)
 * and exposes a FAB to create a new one. Each card carries its own
 * resolved mindspace; the call site explicitly resolves it per card.
 *
 * Per spec §2 Decision 4 (no-leak): the empty-state copy is identical
 * whether the list is empty because no personas exist OR because all
 * personas are filtered out. Nothing in this surface hints at hidden
 * personas; the only indication is the AdultModeToggle pill in the
 * brand-bar.
 */
export function Circle(): JSX.Element {
  const navigate = useNavigate();
  const personas = useFilteredPersonas();
  const providers = useProviders();
  const mindspaces = useMindspaces();
  const settings = useSettings();
  const enabledProviderIds = new Set(
    (providers.data ?? []).filter((p) => p.enabled).map((p) => p.id),
  );

  const defaultMindspaceId = settings.data?.defaultMindspaceId ?? '';
  const defaultTexture = settings.data?.userTexture ?? null;

  return (
    <section className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-24 pt-4">
      <header className="flex items-center gap-3 pb-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/app')}
          className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-paper-soft hover:bg-white/5 hover:text-paper"
        >
          ←
        </button>
        <span className="font-display text-sm text-paper">My Circle</span>
      </header>

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
            defaultMindspaceId,
            defaultTexture,
            mindspaces: mindspaces.data ?? [],
          });
          if (!ms) return null;
          return (
            <PersonaCard
              key={p.id}
              persona={p}
              mindspace={ms}
              hasProvider={enabledProviderIds.has(p.providerId)}
              onChat={(_id) => {
                // Phase-3 work: open or create a chat surface. No-op for Phase 2.
              }}
            />
          );
        })}
      </ul>

      <button
        type="button"
        aria-label="New persona"
        onClick={() => navigate('/app/persona/new')}
        className="fixed bottom-6 right-6 z-10 grid h-14 w-14 place-items-center rounded-full bg-paper text-3xl leading-none text-ink shadow-2xl transition-transform hover:scale-105"
      >
        +
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run to confirm passing**

```
pnpm --filter user-client test -- circle
```

Expected: all Circle tests PASS (3 new filter cases + any pre-existing).

---

## Task 8: Entrance Hall uses useFilteredPersonas (count + recent persona)

**Files:**
- Modify: `apps/user-client/src/routes/app/entrance-hall.tsx`
- Create: `apps/user-client/tests/routes/entrance-hall.filter.test.tsx`

Hall's `personaCount` RoomTile-meta and `recentPersona` lookup switch from `usePersonas()` to `useFilteredPersonas()`. Both naturally hide adult content in SFW mode without a leak.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/entrance-hall.filter.test.tsx`:

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

async function seedSfwAndNsfw() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: 'p-sfw',
    name: 'Calm', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
    providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: false,
    createdAt: now, updatedAt: now,
  });
  await db.personas.add({
    id: 'p-nsfw',
    name: 'Spicy', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
    providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: true,
    createdAt: now + 1, updatedAt: now + 1,
  });
}

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

describe('Entrance Hall filter (adult mode)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useSessionStore.setState({ session: { username: 'chris' } as never });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useSessionStore.setState({ session: null });
  });

  it('NSFW mode: RoomTile meta reads "2 personas"', async () => {
    await seedSfwAndNsfw();
    renderHall();
    await waitFor(() => expect(screen.getByText(/2 personas/i)).toBeInTheDocument());
  });

  it('SFW mode: RoomTile meta reads "1 personas" (filtered count, no leak)', async () => {
    await seedSfwAndNsfw();
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    renderHall();
    await waitFor(() => expect(screen.getByText(/1 personas/i)).toBeInTheDocument());
    expect(screen.queryByText(/2 personas/i)).toBeNull();
  });

  it('SFW mode hides Continue-chat card when recent chat is with an adult persona', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p-only-nsfw',
      name: 'OnlyNsfw', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
      providerId: 'np', modelId: 'm', mindspaceId: null, aboutMeOverride: null,
      textureOverride: null, temperature: 0.85, adultPersona: true,
      createdAt: now, updatedAt: now,
    });
    await db.chats.add({
      id: 'c-1',
      personaId: 'p-only-nsfw',
      title: 'A chat',
      resolvedMindspaceId: 'ms-1',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
    });
    await db.settings.update(1, { adultMode: 'sfw' });
    renderHall();
    await waitFor(() => expect(screen.getByText(/welcome back/i)).toBeInTheDocument());
    // Continue-chat card must be ABSENT (recent persona is adult, filtered out, no leak).
    expect(screen.queryByText(/continue chat/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- entrance-hall.filter
```

Expected: cases FAIL — count is wrong because Hall reads raw personas.

- [ ] **Step 3: Update entrance-hall.tsx**

Open `apps/user-client/src/routes/app/entrance-hall.tsx`. Find the import of `usePersonas`:

```ts
import { usePersonas } from '../../data/personas.js';
```

Replace with:

```ts
import { useFilteredPersonas } from '../../data/personas.js';
```

In the component body, find:

```ts
const personas = usePersonas();
```

Replace with:

```ts
const personas = useFilteredPersonas();
```

No other changes — the `personaCount` and `recentPersona` lookups already use `personas.data`, which now reflects the filtered list.

- [ ] **Step 4: Run to confirm passing**

```
pnpm --filter user-client test -- entrance-hall
```

Expected: all entrance-hall tests PASS (the new filter cases + existing greeting + any others).

---

## Task 9: Persona-Editor mindspace transition

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Create: `apps/user-client/tests/routes/persona-editor.mindspace.test.tsx`

When PersonaEditor mounts and the persona's data loads, set the global `useMindspaceStore` with the persona's mindspace context. Circle's existing mount-effect (which sets `persona: null` for the global default) handles reset on back-nav.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/routes/persona-editor.mindspace.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { PersonaEditor } from '../../src/routes/app/persona-editor.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

async function seedPersonaWithMindspace() {
  const db = getClientDataDb();
  const now = Date.now();
  const mindspaces = await db.mindspaces.toArray();
  const verdan = mindspaces.find((m) => m.displayName === 'Verdan');
  if (!verdan) throw new Error('test fixture: Verdan mindspace not seeded');
  await db.personas.add({
    id: 'p-1',
    name: 'TestPersona', tagline: '', colour: '#fff', font: 'serif', instructions: 'i',
    providerId: 'np', modelId: 'm', mindspaceId: verdan.id, aboutMeOverride: null,
    textureOverride: null, temperature: 0.85, adultPersona: false,
    createdAt: now, updatedAt: now,
  });
  return verdan.id;
}

function renderEditor(personaId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}`]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Persona Editor mindspace transition', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useMindspaceStore.setState({ resolved: null });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useMindspaceStore.setState({ resolved: null });
  });

  it("updates the global mindspace store with the persona's resolved mindspace on mount", async () => {
    const verdanId = await seedPersonaWithMindspace();
    renderEditor('p-1');
    await waitFor(() => {
      const r = useMindspaceStore.getState().resolved;
      expect(r?.id).toBe(verdanId);
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```
pnpm --filter user-client test -- persona-editor.mindspace
```

Expected: FAIL — `useMindspaceStore.getState().resolved` stays null because the editor doesn't update it.

- [ ] **Step 3: Update persona-editor.tsx**

Open `apps/user-client/src/routes/app/persona-editor.tsx`. Add to imports:

```ts
import { useMindspaceStore } from '../../state/mindspace.store.js';
```

In the `PersonaEditor` component body, AFTER the existing `useEffect` that seeds the draft (around line 79-89), add a new effect:

```ts
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

- [ ] **Step 4: Run to confirm passing**

```
pnpm --filter user-client test -- persona-editor.mindspace
```

Expected: PASS.

- [ ] **Step 5: Run all persona-editor tests**

```
pnpm --filter user-client test -- persona-editor
```

Expected: all green.

---

## Task 10: Final verify + commit Phase 2.9

**Files:**
- All accumulated working-tree changes

- [ ] **Step 1: Run the full user-client test suite**

```
pnpm --filter user-client test
```

Expected: all green (estimated ~233+ tests with ~18 new cases added).

- [ ] **Step 2: Typecheck + lint + build**

```
pnpm typecheck && pnpm lint && pnpm --filter user-client run build
```

Expected: all clean.

- [ ] **Step 3: Verify the working-tree file set**

```
git status
```

Expected file list (verify ALL present, nothing extra):
- `apps/user-client/src/boot/client-data-db.ts`
- `apps/user-client/src/data/settings.ts`
- `apps/user-client/src/data/personas.ts`
- `apps/user-client/src/components/AdultModeToggle.tsx`
- `apps/user-client/src/components/PersonaCard.tsx`
- `apps/user-client/src/index.css`
- `apps/user-client/src/routes/root.tsx`
- `apps/user-client/src/routes/app/circle.tsx`
- `apps/user-client/src/routes/app/entrance-hall.tsx`
- `apps/user-client/src/routes/app/persona-editor.tsx`
- `apps/user-client/tests/boot/client-data-db-v5.test.ts`
- `apps/user-client/tests/data/use-adult-mode.test.tsx`
- `apps/user-client/tests/data/use-filtered-personas.test.tsx`
- `apps/user-client/tests/components/AdultModeToggle.test.tsx`
- `apps/user-client/tests/unit/persona-card.test.tsx`
- `apps/user-client/tests/routes/root.adult-mode-pill.test.tsx`
- `apps/user-client/tests/routes/circle.filter.test.tsx`
- `apps/user-client/tests/routes/entrance-hall.filter.test.tsx`
- `apps/user-client/tests/routes/persona-editor.mindspace.test.tsx`
- `apps/user-client/tests/unit/client-data-db.test.ts`
- `apps/user-client/tests/routes/settings.draft-save.test.tsx`

21 files total. If any are missing, the corresponding task was incomplete; if any are extra, they need to be inspected before commit.

- [ ] **Step 4: Stage and commit Phase 2.9**

```bash
git add apps/user-client/src/boot/client-data-db.ts \
        apps/user-client/src/data/settings.ts \
        apps/user-client/src/data/personas.ts \
        apps/user-client/src/components/AdultModeToggle.tsx \
        apps/user-client/src/components/PersonaCard.tsx \
        apps/user-client/src/index.css \
        apps/user-client/src/routes/root.tsx \
        apps/user-client/src/routes/app/circle.tsx \
        apps/user-client/src/routes/app/entrance-hall.tsx \
        apps/user-client/src/routes/app/persona-editor.tsx \
        apps/user-client/tests/boot/client-data-db-v5.test.ts \
        apps/user-client/tests/data/use-adult-mode.test.tsx \
        apps/user-client/tests/data/use-filtered-personas.test.tsx \
        apps/user-client/tests/components/AdultModeToggle.test.tsx \
        apps/user-client/tests/unit/persona-card.test.tsx \
        apps/user-client/tests/routes/root.adult-mode-pill.test.tsx \
        apps/user-client/tests/routes/circle.filter.test.tsx \
        apps/user-client/tests/routes/entrance-hall.filter.test.tsx \
        apps/user-client/tests/routes/persona-editor.mindspace.test.tsx \
        apps/user-client/tests/unit/client-data-db.test.ts \
        apps/user-client/tests/routes/settings.draft-save.test.tsx
git status
git commit -m "$(cat <<'EOF'
Phase 2.9 — Mindspace Cards & Adult Mode

Four interlocking polish items before Phase 3 begins:

- Persona cards inherit their persona's resolved mindspace. The card
  background tint comes from palette.surfaceBase (10% opacity) and
  the base border from palette.accentBorder, so a Verdan persona's
  card reads as green-tinted, a Crimson card as red-warm, etc. The
  resolution happens at the call site (Circle), not inside the card —
  the new mindspace prop is required so every consumer thinks about
  context.

- NSFW vs SFW personas are visually differentiated. NSFW cards carry
  a danger-red box-shadow ring + a subtle horizontal shimmer streak
  every 6-8s; SFW cards carry a paper-soft-grey ring + a quieter
  shimmer every 12s. Per-card random delay (derived from persona.id)
  ensures cards do not shimmer in unison. prefers-reduced-motion
  disables the shimmer; the static rings remain.

- A global adult-mode pill in the brand-bar (centred between logo
  and connectivity badge). Single-state pill showing the active mode
  with a ⇄ glyph for discoverability; click toggles. NSFW pill is
  red-toned matching the card glow; SFW is grey-toned; both shimmer
  on the same cadence as their cards. The mode is persisted in
  SettingsRow.adultMode (Dexie v5 migration; default 'nsfw' on fresh
  install per the "SFW is the special case" positioning) and is
  device-local — a sync-exclusion contract is documented in code for
  the future sync system.

- A new useFilteredPersonas() data-layer hook is the single source of
  truth for any UI that lists personas, counts them, or resolves a
  recent persona for display. Adopted by Circle (list + empty-state)
  and Entrance Hall (RoomTile count + Continue-chat card). Raw
  usePersonas() is reserved for Editor-class persona-by-id lookups.

- The Persona Editor's mount-effect now takes over the global
  mindspace store with the loaded persona's resolved mindspace, so
  opening a Verdan persona's editor smoothly fades the ambient
  background to green. Circle's existing mount-effect resets to the
  user default on back-nav.

Critical no-leak rule (spec §2 Decision 4): when the SFW filter
yields an empty result, the empty-state copy is identical to the
"no personas yet" state. No counter, no hint, no copy mentioning
hidden items — anywhere in the app. The only indication that NSFW
personas may exist is the pill itself.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: `git log --oneline -3` to confirm**

```
git log --oneline -3
```

Expected:
```
<sha>    Phase 2.9 — Mindspace Cards & Adult Mode
b5aea74  Add Phase 2.9 (Mindspace Cards & Adult Mode) design spec [skip ci]
486a026  Polish iteration 6 — EditorSticky top-offset matches measured bar height
```

---

## Task 11: STATUS-CLIENT-ONLY update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Update the Last-updated line and test-count**

Open `obsidian/STATUS-CLIENT-ONLY.md`. Update the top `Last updated:` line to reflect Phase 2.9 landing. Bump the test count to ~233 (run `pnpm --filter user-client test` and read the actual count).

- [ ] **Step 2: Append the Phase 2.9 Done block**

Insert the following block AFTER the Phase 2.8 Done block, before "## Briefed, awaiting implementation":

```markdown
- **Phase 2.9 — Mindspace Cards & Adult Mode (2026-05-24)**. One
  squashed commit on master following Chris's pre-very-early-alpha
  brainstorm. Driven by subagent-driven-development per task. What
  landed:
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v5 migration
    adds `SettingsRow.adultMode: 'nsfw' | 'sfw'`; default `'nsfw'`
    (per spec §2 Decision 2 — SFW is the special case); device-local
    (sync-exclusion contract documented in code for future sync).
  - `apps/user-client/src/data/settings.ts` — `useAdultMode()` hook
    (`{ mode, toggleMode, setMode }`).
  - `apps/user-client/src/data/personas.ts` — `useFilteredPersonas()`
    composes `usePersonas()` + `useAdultMode()`. **Project guideline**:
    any UI that lists personas, counts them, or resolves a recent
    persona reference must use this hook; raw `usePersonas()` is for
    Editor-class persona-by-id lookups only.
  - `apps/user-client/src/components/AdultModeToggle.tsx` (new) —
    brand-bar pill, single-state with ⇄ glyph, click toggles, NSFW
    red-toned / SFW grey-toned, subtle shimmer.
  - `apps/user-client/src/components/PersonaCard.tsx` — new required
    `mindspace: ResolvedMindspace` prop. Card background tint =
    palette.surfaceBase at 10% opacity; base border = palette.accentBorder.
    NSFW vs SFW box-shadow ring + CSS shimmer streak. Per-card random
    shimmer delay (djb2 hash of persona.id mod 4 s). prefers-reduced-motion
    disables shimmer.
  - `apps/user-client/src/routes/root.tsx` — `<AdultModeToggle />`
    mounted between logo and connectivity badge; brand-bar uses
    `justify-between gap-2` for three-child distribution.
  - `apps/user-client/src/routes/app/circle.tsx` — `useFilteredPersonas()`;
    resolves mindspace per card via existing `resolveMindspace()`;
    empty-state copy unchanged (no-leak per spec §2 Decision 4).
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — `useFilteredPersonas()`
    for `personaCount` and `recentPersona` lookup. Continue-chat card
    naturally hides when recent persona is filtered out.
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mount-effect
    updates global `useMindspaceStore` with the loaded persona's
    mindspace context.
  - `apps/user-client/src/index.css` — new `.adult-mode-toggle*`,
    `.persona-card*`, `@keyframes pill-shimmer`, `@keyframes
    persona-shimmer`, reduced-motion overrides.
  - Tests: ~18 new Vitest cases across client-data-db v5 (2),
    use-adult-mode (3), use-filtered-personas (3), AdultModeToggle
    (4), persona-card (3 added), root.adult-mode-pill (1),
    circle.filter (3), entrance-hall.filter (3), persona-editor.mindspace
    (1). All ~233 user-client tests pass; llm-unified Bun tests
    untouched and green; `pnpm typecheck && pnpm lint && pnpm
    --filter user-client run build` clean.
```

- [ ] **Step 3: Update the "Doing now" section**

Replace the existing "Doing now" content with:

```markdown
## Doing now

Phase 2.9 finished. Paused for Chris's iteration-7 manual smoke covering
the brand-bar adult-mode pill, the persona-card mindspace tinting and
NSFW/SFW differentiation, the SFW no-leak filter behaviour (empty
state identical to "no personas yet"), and the persona-editor ambient
mindspace transition.
```

- [ ] **Step 4: Update the "Next session" block**

Replace the existing "Next session" block with:

```markdown
## Next session

1. **Chris's iteration-7 smoke after Phase 2.9** — reload the PWA and
   walk through:
   - **Brand-bar pill (every route):** centred between logo and
     connectivity badge. Shows "NSFW ⇄" by default (red-toned), shimmers
     subtly every 6-8 s. Tap → toggles to "SFW ⇄" (grey-toned), shimmers
     every 12 s. With OS-level reduced-motion on, no shimmer; static
     pill colour remains.
   - **Persona cards (My Circle):** each card's background tint matches
     its mindspace (Verdan → green, Crimson → red-warm, …). NSFW
     personas glow red (subtle outer ring + shimmer streak every ~7 s);
     SFW personas glow grey (quieter ring + ~12 s shimmer). Cards do
     NOT shimmer in unison (per-card random delay).
   - **No-leak (SFW mode):** with the pill set to SFW, adult personas
     vanish from the Circle list AND from the Hall RoomTile count
     ("My Circle • X personas" reflects filtered count). With ALL
     personas adult, Circle shows the same "No personas yet — tap +"
     empty-state as a fresh install; no hint anywhere that hidden
     personas exist. The most-recent-chat Continue card on the Hall
     also disappears when the recent persona is adult and mode is SFW.
   - **Persona-editor ambient mindspace:** tap a persona with Verdan
     mindspace → editor opens, background transitions to green; back
     to Circle → transitions back to user default. Create-mode (`+`)
     stays on user default until the user picks a mindspace.

2. **Phase 3 brainstorm + plan** — walk through the chat surface
   wireframes in `chatsundere-prototype.html` (Reading Mode +
   Interaction Mode + Cockpit). Open the ADR "Tool Display Position"
   discussion. Include the "panic button" idea (one-tap kick-out
   from an in-flight NSFW chat when SFW mode is toggled mid-session,
   captured during the Phase 2.9 brainstorm).

3. **Phase 3 execution** — subagent-driven, same pattern as Phases
   1, 2, 2.5, 2.6, 2.7, 2.8, 2.9.
```

- [ ] **Step 5: Commit the STATUS update**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git status
git commit -m "$(cat <<'EOF'
Update STATUS-CLIENT-ONLY for Phase 2.9 (Mindspace Cards & Adult Mode) [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final `git log --oneline -5`**

```
git log --oneline -5
```

Expected:
```
<sha 2>  Update STATUS-CLIENT-ONLY for Phase 2.9 (Mindspace Cards & Adult Mode) [skip ci]
<sha 1>  Phase 2.9 — Mindspace Cards & Adult Mode
b5aea74  Add Phase 2.9 (Mindspace Cards & Adult Mode) design spec [skip ci]
486a026  Polish iteration 6 — EditorSticky top-offset matches measured bar height
6f57f0e  Polish iteration 5 — Sticky-header micro-fixes
```

- [ ] **Step 7: Report back**

Summarise to Chris: commits landed (2 — Phase 2.9 + STATUS update), test count delta (~233 from 215), the iteration-7 smoke list he can walk on his small-Chromium-viewport profile.
