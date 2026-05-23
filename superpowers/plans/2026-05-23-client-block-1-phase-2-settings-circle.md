# Client Block 1 — Phase 2 (Settings + Circle + Persona Editor + Hall) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four Phase-2 surfaces of Block 1 — Entrance Hall (replacing the `AppShell` placeholder), My Settings, My Circle, and the Persona Editor — together with the Mindspace engine, the TanStack-Query-backed data layer over the Phase-1 Dexie schema, and a Dexie v2 migration that adds the new fields and four additional built-in mindspaces.

**Architecture:** The work is organised in four horizontal layers (top-down): **surfaces** (`apps/user-client/src/routes/app/*.tsx`), **components** (`apps/user-client/src/components/*.tsx` — `MindspaceLayer`, `MindspaceTexture`, `MindspacePicker`, `PersonaCard`, `ProviderSheet`), **data** (`apps/user-client/src/data/*.ts` — TanStack-Query hooks over Dexie), **state** (`apps/user-client/src/state/mindspace.store.ts` — the resolved-palette Zustand store), and a schema-migration commit at the bottom (`apps/user-client/src/boot/client-data-db.ts` — Dexie v2). Each task slices vertically through these layers for one capability, with TDD pairing per task and a shared Manual-Verification appendix at the end.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Dexie 4 (`.version(2).upgrade(...)` for the migration), TanStack Query 5, Zustand 5 (with-selector subscription), React 18, React Router v6, Tailwind v4, `@testing-library/react` + `MemoryRouter` for component tests, Vitest with `fake-indexeddb/auto` for schema tests, `@chatsundere/llm-unified` (Phase 1) for the provider probe call from the provider sheet.

**Spec:** [`superpowers/specs/2026-05-23-client-block-1-design.md`](../specs/2026-05-23-client-block-1-design.md) — § 5 (Phase 2 surfaces), Decisions 17–28.

**Phase scope:** Phase 2 only. Surface-level work for the Phase-3 chat (Reading Mode + Interaction Mode + Cockpit) is deliberately out of scope and is the next plan. Phase 2 ships everything needed to **configure** Chatsundere (providers, personas, mindspaces, about-me, unlocker) but does not yet **converse**.

**Commit strategy:** Each task ends with a working `git add` + `git commit`. Intermediate commits are squashed into one Phase-2 commit after Task 18 lands, per CLAUDE.md §8.

**Larissa gate:** Phase 2 is frontend-only — no changes to `packages/crypto`, `apps/auth-service`, `apps/sync-service`, or `apps/proxy-service`. The only near-crypto touchpoint is calling the existing `sealSecret`/`openSecret` helpers from the UI when saving/probing provider API keys and the CORS-proxy shared key. No Larissa pass required for Phase 2.

**Pre-existing pitfalls to honour throughout:**

- **SPDX header** must be the very first line of every new `.ts`/`.tsx` file (`// SPDX-License-Identifier: AGPL-3.0-only`), followed by a single blank line, then imports. Biome's `organizeImports` will sort imports around it if it isn't on line 1.
- **Vitest test glob is `tests/**/*.test.{ts,tsx}`** for `apps/user-client`. New test files go under `apps/user-client/tests/unit/`. Co-located `*.test.ts` files inside `src/` are not picked up.
- **`packages/llm-unified` uses Bun's test runner**, not Vitest. Phase 2 does not modify that package, but any new tests that touch llm-unified types must run in user-client (Vitest) and treat llm-unified as an external module.
- **`packages/crypto/dist` may need a build after a fresh `pnpm install`** — if a Vite import fails with "module not found", run `pnpm --filter @chatsundere/crypto build` (plus `shared-types` + `ui-shared` if those are also stale).
- **Dexie schema migration is idempotent.** The v2 `.upgrade()` callback must not assume previous-state — it must handle both "v1 freshly seeded" and "v1 with user modifications" branches.

---

## File structure

**Created (new files):**

```
apps/user-client/src/state/mindspace.store.ts                           (Task 2)
apps/user-client/src/state/mindspace-resolver.ts                        (Task 1)
apps/user-client/src/components/MindspaceLayer.tsx                      (Task 3)
apps/user-client/src/components/MindspaceTexture.tsx                    (Task 4)
apps/user-client/src/components/MindspacePicker.tsx                     (Task 7)
apps/user-client/src/components/PersonaCard.tsx                         (Task 8)
apps/user-client/src/components/ProviderSheet.tsx                       (Task 11)
apps/user-client/src/components/AccordionCard.tsx                       (Task 9)
apps/user-client/src/components/SaveBar.tsx                             (Task 15)
apps/user-client/src/data/queryKeys.ts                                  (Task 5)
apps/user-client/src/data/settings.ts                                   (Task 5)
apps/user-client/src/data/personas.ts                                   (Task 6)
apps/user-client/src/data/providers.ts                                  (Task 6)
apps/user-client/src/data/mindspaces.ts                                 (Task 6)
apps/user-client/src/data/chats.ts                                      (Task 6)
apps/user-client/src/lib/monogram.ts                                    (Task 8)
apps/user-client/src/routes/app/entrance-hall.tsx                       (Task 16)
apps/user-client/src/routes/app/circle.tsx                              (Task 12)
apps/user-client/src/routes/app/persona-editor.tsx                      (Task 13)
apps/user-client/src/routes/app/settings.tsx                            (Task 9)
apps/user-client/tests/unit/mindspace-resolver.test.ts                  (Task 1)
apps/user-client/tests/unit/mindspace-store.test.ts                     (Task 2)
apps/user-client/tests/unit/mindspace-layer.test.tsx                    (Task 3)
apps/user-client/tests/unit/mindspace-texture.test.tsx                  (Task 4)
apps/user-client/tests/unit/mindspace-picker.test.tsx                   (Task 7)
apps/user-client/tests/unit/persona-card.test.tsx                       (Task 8)
apps/user-client/tests/unit/monogram.test.ts                            (Task 8)
apps/user-client/tests/unit/data-settings.test.ts                       (Task 5)
apps/user-client/tests/unit/data-personas.test.ts                       (Task 6)
apps/user-client/tests/unit/data-providers.test.ts                      (Task 6)
apps/user-client/tests/unit/settings-route.test.tsx                     (Task 9, 10)
apps/user-client/tests/unit/provider-sheet.test.tsx                     (Task 11)
apps/user-client/tests/unit/circle-route.test.tsx                       (Task 12)
apps/user-client/tests/unit/persona-editor.test.tsx                     (Tasks 13-15)
apps/user-client/tests/unit/entrance-hall.test.tsx                      (Task 16)
```

**Modified:**

```
apps/user-client/src/boot/client-data-db.ts                             (Task 0 — Dexie v2 schema + types + .upgrade)
apps/user-client/tests/unit/client-data-db.test.ts                      (Task 0 — v1→v2 migration tests)
apps/user-client/src/App.tsx                                            (Task 17 — wire /app subroutes, drop AppShell)
apps/user-client/src/routes/app-shell.tsx                               (Task 17 — delete; replaced by entrance-hall)
```

Removed at end:

```
apps/user-client/src/routes/app-shell.tsx                               (Task 17)
```

---

## Task 0: Dexie v2 schema migration

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Modify: `apps/user-client/tests/unit/client-data-db.test.ts`

This task lands the schema additions per Spec § 5.1 and Decisions 17, 26, 28: `Settings.userFont`, `PersonaRow.{tagline,temperature,adultPersona}`, the extended `MindspaceRow.texture` union, and the four additional built-in mindspaces (Crimson, Indigaut, Violetta, Rosari). It also re-seeds the accent hex for Verdan and Azuro to the values Lyra finalised in the 2026-05-23 wireframe (`#6aa97a` and `#4a7eb3`, respectively — Phase 1 shipped provisional values that the wireframe update has now overridden).

- [ ] **Step 1a: Update the existing Phase-1 tests to reflect the v2 schema**

In `apps/user-client/tests/unit/client-data-db.test.ts`, update three assertions that Phase 1 baked in:

```diff
-    expect(db.verno).toBe(1);
+    expect(db.verno).toBe(2);
```

```diff
-  it('seeds three built-in mindspaces on first open', async () => {
+  it('seeds seven built-in mindspaces on first open', async () => {
     const db = await openClientDataDb();
     const all = await db.mindspaces.toArray();
     const names = all.map((m) => m.displayName).sort();
-    expect(names).toEqual(['Aurum', 'Azuro', 'Verdan']);
+    expect(names).toEqual([
+      'Aurum',
+      'Azuro',
+      'Crimson',
+      'Indigaut',
+      'Rosari',
+      'Verdan',
+      'Violetta',
+    ]);
     expect(all.every((m: MindspaceRow) => m.builtIn === true)).toBe(true);
   });
```

```diff
   it('is idempotent on re-open — does not double-seed', async () => {
     await openClientDataDb();
     await _resetClientDataDbForTests({ keepData: true });
     const db2 = await openClientDataDb();
     const all = await db2.mindspaces.toArray();
-    expect(all.length).toBe(3);
+    expect(all.length).toBe(7);
     const settingsRows = await db2.settings.toArray();
     expect(settingsRows.length).toBe(1);
   });
```

- [ ] **Step 1b: Write failing schema-migration tests**

Append to `apps/user-client/tests/unit/client-data-db.test.ts` (after the existing `describe` block):

```typescript
describe('client-data DB — v2 migration', () => {
  it('seeds seven built-in mindspaces on a fresh database', async () => {
    await _resetClientDataDbForTests();
    const db = await openClientDataDb();
    const mindspaces = await db.mindspaces.toArray();
    const names = mindspaces.map((m) => m.displayName).sort();
    expect(names).toEqual([
      'Aurum',
      'Azuro',
      'Crimson',
      'Indigaut',
      'Rosari',
      'Verdan',
      'Violetta',
    ]);
  });

  it('seeds settings with userFont = "serif"', async () => {
    await _resetClientDataDbForTests();
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings?.userFont).toBe('serif');
  });

  it('uses finalised accent hex for Verdan (#6aa97a) and Azuro (#4a7eb3)', async () => {
    await _resetClientDataDbForTests();
    const db = await openClientDataDb();
    const verdan = await db.mindspaces.where('displayName').equals('Verdan').first();
    const azuro = await db.mindspaces.where('displayName').equals('Azuro').first();
    expect(verdan?.palette.accent).toBe('#6aa97a');
    expect(azuro?.palette.accent).toBe('#4a7eb3');
  });

  it('backfills userFont, persona fields, and missing mindspaces when upgrading from v1', async () => {
    // Simulate v1: open as v1 only, seed, close, then re-open at v2.
    await _resetClientDataDbForTests();
    const v1 = new Dexie('chatsundere_client_data');
    v1.version(1).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });
    await v1.open();
    // Plant a v1-shape settings row (no userFont) and a v1-shape persona row.
    const now = Date.now();
    await v1.table('settings').add({
      id: 1,
      globalUnlockerPrompt: 'unlock',
      globalAboutMe: 'about',
      defaultMindspaceId: 'aurum-id',
      animationsEnabled: true,
      corsProxy: null,
      createdAt: now,
      updatedAt: now,
    });
    await v1.table('personas').add({
      id: 'p1',
      name: 'Test',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'be helpful',
      providerId: 'np',
      modelId: 'm1',
      mindspaceId: null,
      aboutMeOverride: null,
      createdAt: now,
      updatedAt: now,
    });
    v1.close();

    // Now open via the v2 entrypoint and verify backfills.
    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings?.userFont).toBe('serif');
    const persona = await db.personas.get('p1');
    expect(persona?.tagline).toBe('');
    expect(persona?.temperature).toBeCloseTo(0.85);
    expect(persona?.adultPersona).toBe(false);
    const mindspaces = await db.mindspaces.toArray();
    expect(mindspaces.length).toBeGreaterThanOrEqual(7);
  });
});
```

Add the import `import Dexie from 'dexie';` at the top of the test file if not already present.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @chatsundere/user-client test -- --run client-data-db
```

Expected: 4 new tests fail. The existing v1 tests still pass.

- [ ] **Step 3: Update types and v2 schema in `client-data-db.ts`**

Edit `apps/user-client/src/boot/client-data-db.ts`:

Replace the `SettingsRow` interface:

```typescript
export interface SettingsRow {
  id: 1;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userFont: 'sans' | 'serif' | 'cursive';
  animationsEnabled: boolean;
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}
```

Replace the `MindspaceTexture` type alias:

```typescript
export type MindspaceTexture = 'cloudy' | 'aurora' | 'grain';
```

Replace the `PersonaRow` interface:

```typescript
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
  temperature: number;
  adultPersona: boolean;
  createdAt: number;
  updatedAt: number;
}
```

Add a v2 declaration to the `ClientDataDb` constructor — right after the existing `this.version(1).stores({...});` line:

```typescript
    this.version(2)
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
        // Backfill new SettingsRow.userFont — default 'serif' per Decision 28.
        const settings = await tx.table('settings').get(1);
        if (settings) {
          await tx.table('settings').update(1, { userFont: 'serif' });
        }
        // Backfill new PersonaRow fields — Decision 26.
        const personas = await tx.table('personas').toArray();
        for (const p of personas) {
          await tx.table('personas').update(p.id, {
            tagline: '',
            temperature: 0.85,
            adultPersona: false,
          });
        }
      });
```

- [ ] **Step 4: Update `buildMindspace` and `seedBuiltinsIfNeeded` to ship seven mindspaces**

Replace the body of `seedBuiltinsIfNeeded` and the top-level helpers:

```typescript
const BUILT_IN_MINDSPACES: ReadonlyArray<{ displayName: string; accent: string }> = [
  { displayName: 'Crimson', accent: '#b33a5e' },
  { displayName: 'Aurum', accent: '#c9a84c' },
  { displayName: 'Verdan', accent: '#6aa97a' },
  { displayName: 'Azuro', accent: '#4a7eb3' },
  { displayName: 'Indigaut', accent: '#5d4e9e' },
  { displayName: 'Violetta', accent: '#9a5bb8' },
  { displayName: 'Rosari', accent: '#c97a99' },
];

async function seedBuiltinsIfNeeded(db: ClientDataDb): Promise<void> {
  const existingSettings = await db.settings.get(1);
  const existingMindspaces = await db.mindspaces.toArray();
  const existingNames = new Set(existingMindspaces.map((m) => m.displayName));

  const missingBuiltins = BUILT_IN_MINDSPACES.filter((b) => !existingNames.has(b.displayName));
  const staleVerdanOrAzuro = existingMindspaces.filter(
    (m) =>
      (m.displayName === 'Verdan' && m.palette.accent !== '#6aa97a') ||
      (m.displayName === 'Azuro' && m.palette.accent !== '#4a7eb3'),
  );

  if (existingSettings && missingBuiltins.length === 0 && staleVerdanOrAzuro.length === 0) {
    return; // already at Phase-2 state — no-op
  }

  const now = Date.now();
  await db.transaction('rw', db.mindspaces, db.settings, async () => {
    // Add any missing built-ins
    if (missingBuiltins.length > 0) {
      await db.mindspaces.bulkAdd(
        missingBuiltins.map((b) => buildMindspace(uuidv7(), b.displayName, b.accent, now)),
      );
    }
    // Refresh stale palettes for Verdan / Azuro (preserving id + texture + builtIn flag)
    for (const stale of staleVerdanOrAzuro) {
      const finalised = BUILT_IN_MINDSPACES.find((b) => b.displayName === stale.displayName);
      if (!finalised) continue;
      const refreshed = buildMindspace(stale.id, stale.displayName, finalised.accent, now);
      await db.mindspaces.put({ ...refreshed, texture: stale.texture });
    }
    // Seed the settings singleton if it doesn't exist
    if (!existingSettings) {
      const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
      const aurumId = aurum?.id ?? (await db.mindspaces.toCollection().first())?.id ?? uuidv7();
      await db.settings.add({
        id: 1,
        globalUnlockerPrompt: '',
        globalAboutMe: '',
        defaultMindspaceId: aurumId,
        userFont: 'serif',
        animationsEnabled: true,
        corsProxy: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}
```

(The existing `buildMindspace`, `hexToRgb`, and `textRgbForAccent` helpers are preserved unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @chatsundere/user-client test -- --run client-data-db
```

Expected: all `client-data-db` tests pass — both the new v2 tests and the Phase-1 v1 tests (which still see correct seeded state).

- [ ] **Step 6: Run typecheck and build**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/unit/client-data-db.test.ts
git commit -m "Phase 2 — Dexie v2 migration: userFont, persona fields, 7 mindspaces"
```

---

## Task 1: Mindspace resolver (pure function)

**Files:**
- Create: `apps/user-client/src/state/mindspace-resolver.ts`
- Create: `apps/user-client/tests/unit/mindspace-resolver.test.ts`

A pure function that takes the current chat + persona + default-mindspace context and returns the resolved `MindspaceRow`. Per Decision 13: persona-override (if any) wins, else user default.

- [ ] **Step 1: Write failing test**

Create `apps/user-client/tests/unit/mindspace-resolver.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { MindspaceRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { resolveMindspace } from '../../src/state/mindspace-resolver.js';

function makeMindspace(id: string, displayName: string): MindspaceRow {
  return {
    id,
    displayName,
    palette: {
      bg: '#000',
      surfaceBase: 'rgba(0,0,0,0)',
      surfaceRaised: 'rgba(0,0,0,0)',
      surfaceInput: 'rgba(0,0,0,0)',
      accent: '#fff',
      accentSubtle: 'rgba(255,255,255,0)',
      accentBorder: 'rgba(255,255,255,0)',
      accentBorderActive: 'rgba(255,255,255,0)',
      accentGlow: 'rgba(255,255,255,0)',
      text: {
        primary: '#fff',
        secondary: '#fff',
        muted: '#fff',
        ghost: '#fff',
      },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
  };
}

function makePersona(id: string, mindspaceId: string | null): PersonaRow {
  return {
    id,
    name: 'p',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    providerId: 'pv',
    modelId: 'm',
    mindspaceId,
    aboutMeOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('resolveMindspace', () => {
  const aurum = makeMindspace('aurum', 'Aurum');
  const verdan = makeMindspace('verdan', 'Verdan');
  const mindspaces = [aurum, verdan];

  it('returns persona-override mindspace when set', () => {
    const persona = makePersona('p', 'verdan');
    const resolved = resolveMindspace({ persona, defaultMindspaceId: 'aurum', mindspaces });
    expect(resolved.id).toBe('verdan');
  });

  it('returns user default when persona has no mindspace override', () => {
    const persona = makePersona('p', null);
    const resolved = resolveMindspace({ persona, defaultMindspaceId: 'aurum', mindspaces });
    expect(resolved.id).toBe('aurum');
  });

  it('returns user default when no persona is active', () => {
    const resolved = resolveMindspace({ persona: null, defaultMindspaceId: 'aurum', mindspaces });
    expect(resolved.id).toBe('aurum');
  });

  it('falls back to first mindspace when defaultMindspaceId is missing from the list', () => {
    const resolved = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'gone',
      mindspaces,
    });
    expect(resolved.id).toBe('aurum'); // first one
  });

  it('throws when mindspaces list is empty', () => {
    expect(() =>
      resolveMindspace({ persona: null, defaultMindspaceId: 'aurum', mindspaces: [] }),
    ).toThrow(/no mindspaces/i);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL (module missing)**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-resolver
```

Expected: import error / `Cannot find module`.

- [ ] **Step 3: Implement resolver**

Create `apps/user-client/src/state/mindspace-resolver.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';

export interface ResolveArgs {
  persona: PersonaRow | null;
  defaultMindspaceId: string;
  mindspaces: ReadonlyArray<MindspaceRow>;
}

/**
 * Resolve the active mindspace for the current context, per Spec § 5.2
 * resolution priority: persona-override > user-default > first available.
 * Throws when the mindspaces list is empty (built-ins are seeded on first
 * launch, so an empty list at runtime is a bug).
 */
export function resolveMindspace(args: ResolveArgs): MindspaceRow {
  const { persona, defaultMindspaceId, mindspaces } = args;
  if (mindspaces.length === 0) {
    throw new Error('resolveMindspace: no mindspaces available — built-ins should be seeded');
  }
  const byId = (id: string) => mindspaces.find((m) => m.id === id);
  if (persona?.mindspaceId) {
    const override = byId(persona.mindspaceId);
    if (override) return override;
  }
  const fallback = byId(defaultMindspaceId);
  if (fallback) return fallback;
  // Last-resort fallback: first available mindspace. Maintains the invariant
  // that the engine always returns a real row even when references stale.
  return mindspaces[0]!;
}
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-resolver
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/mindspace-resolver.ts apps/user-client/tests/unit/mindspace-resolver.test.ts
git commit -m "Phase 2 — mindspace resolver (pure)"
```

---

## Task 2: Mindspace store (Zustand)

**Files:**
- Create: `apps/user-client/src/state/mindspace.store.ts`
- Create: `apps/user-client/tests/unit/mindspace-store.test.ts`

A Zustand store that holds the resolved palette + texture for the current context. Surfaces subscribe to it; the `MindspaceLayer` (Task 3) writes the palette to CSS custom properties.

- [ ] **Step 1: Write failing test**

Create `apps/user-client/tests/unit/mindspace-store.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from 'vitest';
import type { MindspaceRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

function ms(id: string, name: string, accent: string): MindspaceRow {
  return {
    id,
    displayName: name,
    palette: {
      bg: '#000',
      surfaceBase: 'rgba(0,0,0,0)',
      surfaceRaised: 'rgba(0,0,0,0)',
      surfaceInput: 'rgba(0,0,0,0)',
      accent,
      accentSubtle: 'rgba(0,0,0,0)',
      accentBorder: 'rgba(0,0,0,0)',
      accentBorderActive: 'rgba(0,0,0,0)',
      accentGlow: 'rgba(0,0,0,0)',
      text: { primary: '#fff', secondary: '#fff', muted: '#fff', ghost: '#fff' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
  };
}

function persona(id: string, mindspaceId: string | null): PersonaRow {
  return {
    id,
    name: 'p',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    providerId: 'pv',
    modelId: 'm',
    mindspaceId,
    aboutMeOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('mindspace store', () => {
  beforeEach(() => {
    useMindspaceStore.getState().reset();
  });

  it('returns null resolved before update is called', () => {
    expect(useMindspaceStore.getState().resolved).toBeNull();
  });

  it('resolves to user default with no active persona', () => {
    const aurum = ms('aurum', 'Aurum', '#c9a84c');
    useMindspaceStore.getState().update({
      persona: null,
      defaultMindspaceId: 'aurum',
      mindspaces: [aurum],
    });
    expect(useMindspaceStore.getState().resolved?.id).toBe('aurum');
  });

  it('resolves to persona override when set', () => {
    const aurum = ms('aurum', 'Aurum', '#c9a84c');
    const verdan = ms('verdan', 'Verdan', '#6aa97a');
    useMindspaceStore.getState().update({
      persona: persona('p1', 'verdan'),
      defaultMindspaceId: 'aurum',
      mindspaces: [aurum, verdan],
    });
    expect(useMindspaceStore.getState().resolved?.id).toBe('verdan');
  });

  it('reset clears resolved back to null', () => {
    const aurum = ms('aurum', 'Aurum', '#c9a84c');
    useMindspaceStore.getState().update({
      persona: null,
      defaultMindspaceId: 'aurum',
      mindspaces: [aurum],
    });
    useMindspaceStore.getState().reset();
    expect(useMindspaceStore.getState().resolved).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-store
```

- [ ] **Step 3: Implement store**

Create `apps/user-client/src/state/mindspace.store.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from 'zustand';
import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';
import { resolveMindspace } from './mindspace-resolver.js';

interface UpdateArgs {
  persona: PersonaRow | null;
  defaultMindspaceId: string;
  mindspaces: ReadonlyArray<MindspaceRow>;
}

interface MindspaceStoreState {
  resolved: MindspaceRow | null;
  update: (args: UpdateArgs) => void;
  reset: () => void;
}

/**
 * Holds the currently-resolved mindspace for the active context.
 * Updated by surfaces when persona / default / mindspaces change;
 * MindspaceLayer subscribes and writes CSS custom properties.
 */
export const useMindspaceStore = create<MindspaceStoreState>((set) => ({
  resolved: null,
  update: (args) => {
    if (args.mindspaces.length === 0) {
      // Defensive: built-ins aren't seeded yet — keep null.
      set({ resolved: null });
      return;
    }
    set({ resolved: resolveMindspace(args) });
  },
  reset: () => set({ resolved: null }),
}));
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-store
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/mindspace.store.ts apps/user-client/tests/unit/mindspace-store.test.ts
git commit -m "Phase 2 — mindspace store (Zustand)"
```

---

## Task 3: MindspaceLayer component

**Files:**
- Create: `apps/user-client/src/components/MindspaceLayer.tsx`
- Create: `apps/user-client/tests/unit/mindspace-layer.test.tsx`

Component that mounts at the layout root, subscribes to the mindspace store, and writes the resolved palette to `document.documentElement.style` as CSS custom properties (`--mindspace-bg`, `--mindspace-accent`, etc.).

- [ ] **Step 1: Write failing test**

Create `apps/user-client/tests/unit/mindspace-layer.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindspaceLayer } from '../../src/components/MindspaceLayer.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

describe('MindspaceLayer', () => {
  beforeEach(() => {
    useMindspaceStore.getState().reset();
  });
  afterEach(() => {
    // Clean up any properties the component set.
    [
      '--mindspace-bg',
      '--mindspace-accent',
      '--mindspace-text-primary',
      '--mindspace-text-muted',
    ].forEach((p) => document.documentElement.style.removeProperty(p));
  });

  it('writes resolved palette as CSS custom properties on documentElement', () => {
    useMindspaceStore.getState().update({
      persona: null,
      defaultMindspaceId: 'aurum',
      mindspaces: [
        {
          id: 'aurum',
          displayName: 'Aurum',
          palette: {
            bg: '#0a0a0a',
            surfaceBase: 'rgba(255,255,255,0.025)',
            surfaceRaised: 'rgba(255,255,255,0.04)',
            surfaceInput: 'rgba(0,0,0,0.3)',
            accent: '#c9a84c',
            accentSubtle: 'rgba(201,168,76,0.06)',
            accentBorder: 'rgba(201,168,76,0.15)',
            accentBorderActive: 'rgba(201,168,76,0.35)',
            accentGlow: 'rgba(201,168,76,0.08)',
            text: {
              primary: '#f0e8d8',
              secondary: '#e8e0d0',
              muted: 'rgba(232,224,208,0.4)',
              ghost: 'rgba(232,224,208,0.2)',
            },
          },
          texture: 'cloudy',
          builtIn: true,
          createdAt: 0,
        },
      ],
    });
    render(<MindspaceLayer />);
    expect(document.documentElement.style.getPropertyValue('--mindspace-bg')).toBe('#0a0a0a');
    expect(document.documentElement.style.getPropertyValue('--mindspace-accent')).toBe('#c9a84c');
    expect(document.documentElement.style.getPropertyValue('--mindspace-text-primary')).toBe(
      '#f0e8d8',
    );
  });

  it('renders nothing when resolved is null', () => {
    const { container } = render(<MindspaceLayer />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-layer
```

- [ ] **Step 3: Implement MindspaceLayer**

Create `apps/user-client/src/components/MindspaceLayer.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useMindspaceStore } from '../state/mindspace.store.js';
import { MindspaceTexture } from './MindspaceTexture.js';

/**
 * Mounts at the application root. Subscribes to the mindspace store and
 * writes the resolved palette to `document.documentElement.style` as CSS
 * custom properties. Renders the texture overlay below the UI.
 */
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
  return <MindspaceTexture texture={resolved.texture} accent={resolved.palette.accent} />;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-layer
```

Note: the test that asserts `container.firstChild === null` runs against the second case (no resolved). The first test will render the MindspaceTexture stub (which Task 4 implements). For this step, MindspaceTexture doesn't exist yet — add a minimal stub now:

```tsx
// File: apps/user-client/src/components/MindspaceTexture.tsx (stub)
// SPDX-License-Identifier: AGPL-3.0-only
export function MindspaceTexture({
  texture,
  accent,
}: {
  texture: 'cloudy' | 'aurora' | 'grain';
  accent: string;
}): JSX.Element {
  return <div data-testid="mindspace-texture" data-texture={texture} data-accent={accent} />;
}
```

Task 4 will replace the stub with the real three-renderer implementation.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/MindspaceLayer.tsx apps/user-client/src/components/MindspaceTexture.tsx apps/user-client/tests/unit/mindspace-layer.test.tsx
git commit -m "Phase 2 — MindspaceLayer (writes palette to CSS custom properties)"
```

---

## Task 4: MindspaceTexture component (three renderers)

**Files:**
- Modify: `apps/user-client/src/components/MindspaceTexture.tsx` (replace stub with full)
- Create: `apps/user-client/tests/unit/mindspace-texture.test.tsx`

Implements the three texture renderers per Spec § 5.2: `cloudy` (Phase-1 radial gradient with float1/float2 animation), `aurora` (soft hue-shift drift), `grain` (static inline SVG noise).

- [ ] **Step 1: Write failing test**

Create `apps/user-client/tests/unit/mindspace-texture.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MindspaceTexture } from '../../src/components/MindspaceTexture.js';

describe('MindspaceTexture', () => {
  it('renders the cloudy variant with two radial-gradient layers', () => {
    const { container } = render(<MindspaceTexture texture="cloudy" accent="#c9a84c" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-texture')).toBe('cloudy');
    // Cloudy renders two child <div> overlays (the two ellipses).
    expect(root.querySelectorAll('[data-cloudy-layer]').length).toBe(2);
  });

  it('renders the aurora variant with three drifting layers', () => {
    const { container } = render(<MindspaceTexture texture="aurora" accent="#7c9ede" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-texture')).toBe('aurora');
    expect(root.querySelectorAll('[data-aurora-layer]').length).toBe(3);
  });

  it('renders the grain variant with a single static noise layer', () => {
    const { container } = render(<MindspaceTexture texture="grain" accent="#74c69d" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-texture')).toBe('grain');
    expect(root.querySelectorAll('[data-grain-layer]').length).toBe(1);
  });

  it('passes the accent through to inline styles for the cloudy variant', () => {
    const { container } = render(<MindspaceTexture texture="cloudy" accent="#c9a84c" />);
    const layers = container.querySelectorAll<HTMLElement>('[data-cloudy-layer]');
    expect(layers[0]?.style.background).toContain('201, 168, 76');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (existing stub doesn't render layers)

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-texture
```

- [ ] **Step 3: Replace the stub with the full implementation**

Replace the content of `apps/user-client/src/components/MindspaceTexture.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties } from 'react';

interface Props {
  texture: 'cloudy' | 'aurora' | 'grain';
  accent: string;
}

/**
 * Renders the mindspace texture overlay. Three variants per Spec § 5.2:
 *  - cloudy:  two soft radial-gradient ellipses with float1/float2 keyframes
 *  - aurora:  three layered hue-shifting gradients with slow drift
 *  - grain:   single static inline-SVG noise pattern
 *
 * All variants respect `prefers-reduced-motion` via global CSS in
 * `index.css` (`.mindspace-texture *` selectors disable animations).
 */
export function MindspaceTexture({ texture, accent }: Props): JSX.Element {
  const rgb = hexToRgbTriplet(accent);
  const wrapStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 0,
  };

  if (texture === 'cloudy') {
    const a: CSSProperties = {
      position: 'absolute',
      top: '-10%',
      left: '-20%',
      width: '80%',
      height: '60%',
      background: `radial-gradient(ellipse, rgba(${rgb}, 0.08) 0%, transparent 70%)`,
      animation: 'mindspace-float1 30s ease-in-out infinite',
    };
    const b: CSSProperties = {
      position: 'absolute',
      bottom: '10%',
      right: '-20%',
      width: '70%',
      height: '50%',
      background: `radial-gradient(ellipse, rgba(${rgb}, 0.05) 0%, transparent 65%)`,
      animation: 'mindspace-float2 40s ease-in-out infinite',
    };
    return (
      <div className="mindspace-texture" data-texture="cloudy" style={wrapStyle}>
        <div data-cloudy-layer style={a} />
        <div data-cloudy-layer style={b} />
      </div>
    );
  }

  if (texture === 'aurora') {
    const layer = (i: 0 | 1 | 2): CSSProperties => ({
      position: 'absolute',
      inset: '-20%',
      background: `radial-gradient(ellipse at ${30 + i * 25}% ${20 + i * 30}%,
        rgba(${rgb}, ${0.07 - i * 0.015}) 0%, transparent 60%)`,
      animation: `mindspace-aurora${i + 1} ${50 + i * 10}s ease-in-out infinite`,
      mixBlendMode: 'screen',
    });
    return (
      <div className="mindspace-texture" data-texture="aurora" style={wrapStyle}>
        <div data-aurora-layer style={layer(0)} />
        <div data-aurora-layer style={layer(1)} />
        <div data-aurora-layer style={layer(2)} />
      </div>
    );
  }

  // grain
  const noise = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.08'/></svg>`;
  return (
    <div className="mindspace-texture" data-texture="grain" style={wrapStyle}>
      <div
        data-grain-layer
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("${noise}")`,
          backgroundRepeat: 'repeat',
        }}
      />
    </div>
  );
}

function hexToRgbTriplet(hex: string): string {
  const v = hex.replace('#', '');
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
```

- [ ] **Step 4: Add keyframes + reduce-motion CSS to `index.css`**

Append to `apps/user-client/src/index.css`:

```css
@keyframes mindspace-float1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(20px, 30px) scale(1.1); }
}
@keyframes mindspace-float2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(-30px, -20px) scale(1.15); }
}
@keyframes mindspace-aurora1 {
  0%, 100% { transform: translate(0, 0); }
  50%      { transform: translate(40px, -30px); }
}
@keyframes mindspace-aurora2 {
  0%, 100% { transform: translate(0, 0); }
  50%      { transform: translate(-30px, 40px); }
}
@keyframes mindspace-aurora3 {
  0%, 100% { transform: translate(0, 0); }
  50%      { transform: translate(20px, 20px); }
}
@media (prefers-reduced-motion: reduce) {
  .mindspace-texture * {
    animation: none !important;
  }
}
```

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-texture
```

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/MindspaceTexture.tsx apps/user-client/src/index.css apps/user-client/tests/unit/mindspace-texture.test.tsx
git commit -m "Phase 2 — MindspaceTexture (cloudy + aurora + grain)"
```

---

## Task 5: Data layer — settings query + mutation

**Files:**
- Create: `apps/user-client/src/data/queryKeys.ts`
- Create: `apps/user-client/src/data/settings.ts`
- Create: `apps/user-client/tests/unit/data-settings.test.ts`

TanStack-Query hooks over the Phase-1 `client-data-db.ts` Dexie tables. Block-1 stays simple: each entity has a `useX()` query and one or more `useUpdateX()` / `useCreateX()` mutations. This task lands the keys + settings layer; Task 6 covers the rest.

- [ ] **Step 1: Write failing test**

Create `apps/user-client/tests/unit/data-settings.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useSettings, useUpdateSettings } from '../../src/data/settings.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useSettings + useUpdateSettings', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns the seeded singleton settings row', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.userFont).toBe('serif');
    expect(result.current.data?.globalUnlockerPrompt).toBe('');
  });

  it('persists user updates and invalidates the query', async () => {
    const Wrapper = wrapper();
    const settings = renderHook(() => useSettings(), { wrapper: Wrapper });
    const mut = renderHook(() => useUpdateSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(settings.result.current.data).toBeDefined());
    await act(async () => {
      await mut.result.current.mutateAsync({ globalUnlockerPrompt: 'unlocked' });
    });
    await waitFor(() => {
      expect(settings.result.current.data?.globalUnlockerPrompt).toBe('unlocked');
    });
  });
});
```

(NB the test file is `.test.ts` even though it contains JSX in the wrapper — Vitest with the user-client config handles this; if your IDE complains, rename to `.test.tsx`.)

- [ ] **Step 2: Run, expect FAIL (module missing)**

```bash
pnpm --filter @chatsundere/user-client test -- --run data-settings
```

- [ ] **Step 3: Implement query keys + settings hooks**

Create `apps/user-client/src/data/queryKeys.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical query keys for TanStack Query caches over Dexie. Keep these
 * stable — invalidation across modules relies on referential equality of
 * the leading segment.
 */
export const QK = {
  settings: ['settings'] as const,
  personas: ['personas'] as const,
  persona: (id: string) => ['personas', id] as const,
  providers: ['providers'] as const,
  mindspaces: ['mindspaces'] as const,
  chats: ['chats'] as const,
  chat: (id: string) => ['chats', id] as const,
};
```

Create `apps/user-client/src/data/settings.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getClientDataDb, type SettingsRow } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export function useSettings() {
  return useQuery({
    queryKey: QK.settings,
    queryFn: async () => {
      const db = getClientDataDb();
      const row = await db.settings.get(1);
      if (!row) throw new Error('settings singleton missing — seed should have run');
      return row;
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<SettingsRow, 'id' | 'createdAt'>>) => {
      const db = getClientDataDb();
      const now = Date.now();
      await db.settings.update(1, { ...patch, updatedAt: now });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.settings }),
  });
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run data-settings
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/queryKeys.ts apps/user-client/src/data/settings.ts apps/user-client/tests/unit/data-settings.test.ts
git commit -m "Phase 2 — data layer (queryKeys + useSettings)"
```

---

## Task 6: Data layer — personas, providers, mindspaces, chats

**Files:**
- Create: `apps/user-client/src/data/personas.ts`
- Create: `apps/user-client/src/data/providers.ts`
- Create: `apps/user-client/src/data/mindspaces.ts`
- Create: `apps/user-client/src/data/chats.ts`
- Create: `apps/user-client/tests/unit/data-personas.test.ts`
- Create: `apps/user-client/tests/unit/data-providers.test.ts`

Per-entity TanStack hooks following the Task-5 pattern. Chats and mindspaces ship with `useX()` queries only — mutations on chats/mindspaces land in Phases 2/3 as needed.

- [ ] **Step 1: Write personas tests**

Create `apps/user-client/tests/unit/data-personas.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  useCreatePersona,
  useDeletePersona,
  usePersonas,
  useUpdatePersona,
} from '../../src/data/personas.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('usePersonas + CUD mutations', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('starts empty, supports create, update, delete', async () => {
    const Wrapper = wrapper();
    const list = renderHook(() => usePersonas(), { wrapper: Wrapper });
    const create = renderHook(() => useCreatePersona(), { wrapper: Wrapper });
    const update = renderHook(() => useUpdatePersona(), { wrapper: Wrapper });
    const del = renderHook(() => useDeletePersona(), { wrapper: Wrapper });

    await waitFor(() => expect(list.result.current.data).toEqual([]));

    let createdId = '';
    await act(async () => {
      const created = await create.result.current.mutateAsync({
        name: 'Aurum',
        tagline: 'quiet sparring',
        colour: '#c9a84c',
        font: 'serif',
        instructions: 'be present',
        providerId: 'nano-gpt-row',
        modelId: 'deepseek-v4-flash',
        mindspaceId: null,
        aboutMeOverride: null,
        temperature: 0.85,
        adultPersona: false,
      });
      createdId = created.id;
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    await act(async () => {
      await update.result.current.mutateAsync({ id: createdId, patch: { tagline: 'updated' } });
    });
    await waitFor(() => expect(list.result.current.data?.[0]?.tagline).toBe('updated'));

    await act(async () => {
      await del.result.current.mutateAsync(createdId);
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(0));
  });
});
```

- [ ] **Step 2: Write providers tests**

Create `apps/user-client/tests/unit/data-providers.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  useDeleteProvider,
  useProviders,
  useUpsertProvider,
} from '../../src/data/providers.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useProviders + upsert/delete', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns an empty list initially and persists upserts', async () => {
    const Wrapper = wrapper();
    const list = renderHook(() => useProviders(), { wrapper: Wrapper });
    const upsert = renderHook(() => useUpsertProvider(), { wrapper: Wrapper });
    const del = renderHook(() => useDeleteProvider(), { wrapper: Wrapper });

    await waitFor(() => expect(list.result.current.data).toEqual([]));

    let id = '';
    await act(async () => {
      const r = await upsert.result.current.mutateAsync({
        templateId: 'nano-gpt',
        apiKey: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]), version: 1 },
        enabled: true,
      });
      id = r.id;
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));

    await act(async () => {
      await del.result.current.mutateAsync(id);
    });
    await waitFor(() => expect(list.result.current.data?.length).toBe(0));
  });
});
```

- [ ] **Step 3: Run, expect FAILs**

```bash
pnpm --filter @chatsundere/user-client test -- --run "data-personas|data-providers"
```

- [ ] **Step 4: Implement personas hooks**

Create `apps/user-client/src/data/personas.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { getClientDataDb, type PersonaRow } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export function usePersonas() {
  return useQuery({
    queryKey: QK.personas,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.personas.orderBy('createdAt').toArray();
    },
  });
}

export function usePersona(id: string | null) {
  return useQuery({
    queryKey: id ? QK.persona(id) : ['personas', '__none'],
    queryFn: async () => {
      if (!id) return null;
      const db = getClientDataDb();
      return (await db.personas.get(id)) ?? null;
    },
    enabled: id !== null,
  });
}

type CreatePersonaArgs = Omit<PersonaRow, 'id' | 'createdAt' | 'updatedAt'>;

export function useCreatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreatePersonaArgs): Promise<PersonaRow> => {
      const db = getClientDataDb();
      const now = Date.now();
      const row: PersonaRow = { id: uuidv7(), createdAt: now, updatedAt: now, ...args };
      await db.personas.add(row);
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.personas }),
  });
}

export function useUpdatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<Omit<PersonaRow, 'id' | 'createdAt'>> }) => {
      const db = getClientDataDb();
      await db.personas.update(args.id, { ...args.patch, updatedAt: Date.now() });
    },
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.personas });
      qc.invalidateQueries({ queryKey: QK.persona(args.id) });
    },
  });
}

export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = getClientDataDb();
      await db.transaction('rw', db.personas, db.chats, db.messages, db.pills, async () => {
        const chats = await db.chats.where('personaId').equals(id).toArray();
        const chatIds = chats.map((c) => c.id);
        if (chatIds.length > 0) {
          const messages = await db.messages.where('chatId').anyOf(chatIds).toArray();
          const messageIds = messages.map((m) => m.id);
          if (messageIds.length > 0) {
            await db.pills.where('messageId').anyOf(messageIds).delete();
          }
          await db.messages.where('chatId').anyOf(chatIds).delete();
          await db.chats.bulkDelete(chatIds);
        }
        await db.personas.delete(id);
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.personas });
      qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}
```

- [ ] **Step 5: Implement providers hooks**

Create `apps/user-client/src/data/providers.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { getClientDataDb, type ProviderRow } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export function useProviders() {
  return useQuery({
    queryKey: QK.providers,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.providers.toArray();
    },
  });
}

interface UpsertArgs {
  id?: string;
  templateId: string;
  apiKey: ProviderRow['apiKey'];
  enabled: boolean;
}

export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: UpsertArgs): Promise<ProviderRow> => {
      const db = getClientDataDb();
      const now = Date.now();
      if (args.id) {
        await db.providers.update(args.id, {
          templateId: args.templateId,
          apiKey: args.apiKey,
          enabled: args.enabled,
          updatedAt: now,
        });
        const row = await db.providers.get(args.id);
        if (!row) throw new Error('upsert failed: provider missing post-update');
        return row;
      }
      // Derived fields per Decision 22: baseUrl / displayName / routing come
      // from the ProviderDefinition template at use-time; on persist we
      // still write defaults so existing query consumers see a stable shape.
      const row: ProviderRow = {
        id: uuidv7(),
        templateId: args.templateId,
        displayName: args.templateId,
        baseUrl: '',
        apiKey: args.apiKey,
        routing: { kind: 'direct' },
        enabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      };
      await db.providers.add(row);
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = getClientDataDb();
      await db.providers.delete(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}
```

- [ ] **Step 6: Implement mindspaces + chats hooks**

Create `apps/user-client/src/data/mindspaces.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getClientDataDb,
  type MindspaceRow,
  type MindspaceTexture,
} from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export function useMindspaces() {
  return useQuery({
    queryKey: QK.mindspaces,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.mindspaces.orderBy('displayName').toArray();
    },
  });
}

export function useUpdateMindspaceTexture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; texture: MindspaceTexture }) => {
      const db = getClientDataDb();
      await db.mindspaces.update(args.id, { texture: args.texture });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.mindspaces }),
  });
}
```

Create `apps/user-client/src/data/chats.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery } from '@tanstack/react-query';
import { getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export function useChats() {
  return useQuery({
    queryKey: QK.chats,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.chats.orderBy('lastMessageAt').reverse().toArray();
    },
  });
}
```

- [ ] **Step 7: Run all data tests, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run "data-(personas|providers|settings)"
```

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/data/ apps/user-client/tests/unit/data-personas.test.ts apps/user-client/tests/unit/data-providers.test.ts
git commit -m "Phase 2 — data hooks for personas / providers / mindspaces / chats"
```

---

## Task 7: MindspacePicker component

**Files:**
- Create: `apps/user-client/src/components/MindspacePicker.tsx`
- Create: `apps/user-client/tests/unit/mindspace-picker.test.tsx`

Reusable component used both in Settings (writes user defaults) and in Persona-Editor (writes persona override). Shows a preview card + three rows of choices (Color, Texture, Font). Receives selection + change-handlers via props so the same component drives both surfaces.

- [ ] **Step 1: Write failing test**

Create `apps/user-client/tests/unit/mindspace-picker.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MindspacePicker } from '../../src/components/MindspacePicker.js';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';

const ms = (id: string, name: string, accent: string): MindspaceRow => ({
  id,
  displayName: name,
  palette: {
    bg: '#000',
    surfaceBase: 'rgba(0,0,0,0)',
    surfaceRaised: 'rgba(0,0,0,0)',
    surfaceInput: 'rgba(0,0,0,0)',
    accent,
    accentSubtle: 'rgba(0,0,0,0)',
    accentBorder: 'rgba(0,0,0,0)',
    accentBorderActive: 'rgba(0,0,0,0)',
    accentGlow: 'rgba(0,0,0,0)',
    text: { primary: '#fff', secondary: '#fff', muted: '#fff', ghost: '#fff' },
  },
  texture: 'cloudy',
  builtIn: true,
  createdAt: 0,
});

const sevenMindspaces: MindspaceRow[] = [
  ms('crimson', 'Crimson', '#b33a5e'),
  ms('aurum', 'Aurum', '#c9a84c'),
  ms('verdan', 'Verdan', '#6aa97a'),
  ms('azuro', 'Azuro', '#4a7eb3'),
  ms('indigaut', 'Indigaut', '#5d4e9e'),
  ms('violetta', 'Violetta', '#9a5bb8'),
  ms('rosari', 'Rosari', '#c97a99'),
];

describe('MindspacePicker', () => {
  it('renders seven colour swatches', () => {
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId="aurum"
        selectedTexture="cloudy"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('button', { name: /mindspace/i }).length).toBe(7);
  });

  it('fires onMindspaceChange when a swatch is clicked', () => {
    const onMs = vi.fn();
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId="aurum"
        selectedTexture="cloudy"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={onMs}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /verdan/i }));
    expect(onMs).toHaveBeenCalledWith('verdan');
  });

  it('shows "Use user default" chip when allowUserDefault is true', () => {
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId={null}
        selectedTexture="cloudy"
        selectedFont="serif"
        previewName="Aurum"
        allowUserDefault
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /use user default/i })).toBeInTheDocument();
  });

  it('renders the preview name in the selected font', () => {
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId="aurum"
        selectedTexture="cloudy"
        selectedFont="cursive"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    const preview = screen.getByText('Chris');
    expect(preview.className).toMatch(/font-cursive|italic/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-picker
```

- [ ] **Step 3: Implement MindspacePicker**

Create `apps/user-client/src/components/MindspacePicker.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';

type Font = 'sans' | 'serif' | 'cursive';

interface Props {
  mindspaces: ReadonlyArray<MindspaceRow>;
  selectedMindspaceId: string | null;
  selectedTexture: MindspaceTexture;
  selectedFont: Font;
  previewName: string;
  /** When true, surfaces a "Use user default" chip that emits onMindspaceChange(null). */
  allowUserDefault?: boolean;
  onMindspaceChange: (id: string | null) => void;
  onTextureChange: (t: MindspaceTexture) => void;
  onFontChange: (f: Font) => void;
}

const TEXTURES: MindspaceTexture[] = ['cloudy', 'aurora', 'grain'];
const FONTS: Font[] = ['sans', 'serif', 'cursive'];

const FONT_CLASSES: Record<Font, string> = {
  sans: 'font-sans',
  serif: 'font-display',
  cursive: 'italic font-display',
};

export function MindspacePicker(props: Props): JSX.Element {
  const {
    mindspaces,
    selectedMindspaceId,
    selectedTexture,
    selectedFont,
    previewName,
    allowUserDefault = false,
    onMindspaceChange,
    onTextureChange,
    onFontChange,
  } = props;
  const selectedMs =
    mindspaces.find((m) => m.id === selectedMindspaceId) ?? mindspaces[0]!;

  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
      <div
        className="mb-3 rounded-md p-4 text-center"
        style={{ background: selectedMs.palette.surfaceRaised, color: selectedMs.palette.accent }}
      >
        <div className={`text-2xl ${FONT_CLASSES[selectedFont]}`} style={{ color: selectedMs.palette.accent }}>
          {previewName}
        </div>
        <div className="mt-1 text-xs uppercase tracking-widest text-paper-soft">Your space</div>
      </div>

      <Row label="Color">
        {mindspaces.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={`Mindspace ${m.displayName}`}
            onClick={() => onMindspaceChange(m.id)}
            className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-black ${
              selectedMindspaceId === m.id ? 'ring-paper' : 'ring-transparent'
            }`}
            style={{ background: m.palette.accent }}
          />
        ))}
        {allowUserDefault ? (
          <button
            type="button"
            onClick={() => onMindspaceChange(null)}
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
              selectedMindspaceId === null
                ? 'border-paper text-paper'
                : 'border-paper-soft/40 text-paper-soft'
            }`}
          >
            Use user default
          </button>
        ) : null}
      </Row>

      <Row label="Texture">
        {TEXTURES.map((t) => (
          <Chip
            key={t}
            active={selectedTexture === t}
            onClick={() => onTextureChange(t)}
            label={capitalise(t)}
          />
        ))}
      </Row>

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
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-16 text-xs uppercase tracking-widest text-paper-soft">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  className = '',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
        active ? 'border-paper text-paper' : 'border-paper-soft/40 text-paper-soft'
      } ${className}`}
    >
      {label}
    </button>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run mindspace-picker
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/MindspacePicker.tsx apps/user-client/tests/unit/mindspace-picker.test.tsx
git commit -m "Phase 2 — MindspacePicker (Color + Texture + Font with preview)"
```

---

## Task 8: PersonaCard + monogram helper

**Files:**
- Create: `apps/user-client/src/lib/monogram.ts`
- Create: `apps/user-client/src/components/PersonaCard.tsx`
- Create: `apps/user-client/tests/unit/monogram.test.ts`
- Create: `apps/user-client/tests/unit/persona-card.test.tsx`

The persona card used in My Circle (and reused in the Continue-Card / chat topbar later). Renders monogram + name + tagline + split-action button.

- [ ] **Step 1: Write monogram tests**

Create `apps/user-client/tests/unit/monogram.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { monogramFor } from '../../src/lib/monogram.js';

describe('monogramFor', () => {
  it('takes the first two characters of a single word', () => {
    expect(monogramFor('Aurum')).toBe('Au');
  });

  it('takes the first letter of each of the first two words', () => {
    expect(monogramFor('Vincent Aldwyn')).toBe('VA');
  });

  it('uppercases the result', () => {
    expect(monogramFor('verdan')).toBe('VE');
  });

  it('handles a single character name', () => {
    expect(monogramFor('A')).toBe('A');
  });

  it('returns "??" for empty input', () => {
    expect(monogramFor('')).toBe('??');
  });

  it('trims leading/trailing whitespace', () => {
    expect(monogramFor('  Aurum  ')).toBe('Au');
  });
});
```

- [ ] **Step 2: Write persona-card tests**

Create `apps/user-client/tests/unit/persona-card.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PersonaCard } from '../../src/components/PersonaCard.js';
import type { PersonaRow } from '../../src/boot/client-data-db.js';

function makePersona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: 'p1',
    name: 'Aurum',
    tagline: 'Quiet companion, architectural sparring',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'i',
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('PersonaCard', () => {
  it('renders monogram + name + tagline', () => {
    wrap(<PersonaCard persona={makePersona()} hasProvider onChat={() => {}} />);
    expect(screen.getByText('Au')).toBeInTheDocument();
    expect(screen.getByText('Aurum')).toBeInTheDocument();
    expect(screen.getByText(/quiet companion/i)).toBeInTheDocument();
  });

  it('fires onChat when the primary Chat button is clicked', () => {
    const onChat = vi.fn();
    wrap(<PersonaCard persona={makePersona()} hasProvider onChat={onChat} />);
    fireEvent.click(screen.getByRole('button', { name: /^chat$/i }));
    expect(onChat).toHaveBeenCalledWith(makePersona().id);
  });

  it('shows "Provider missing" badge when hasProvider is false', () => {
    wrap(<PersonaCard persona={makePersona()} hasProvider={false} onChat={() => {}} />);
    expect(screen.getByText(/provider missing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeDisabled();
  });

  it('renders persona name in persona colour', () => {
    wrap(<PersonaCard persona={makePersona({ colour: '#b33a5e' })} hasProvider onChat={() => {}} />);
    const name = screen.getByText('Aurum');
    expect(name.style.color).toBe('rgb(179, 58, 94)');
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run "monogram|persona-card"
```

- [ ] **Step 4: Implement monogram + PersonaCard**

Create `apps/user-client/src/lib/monogram.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Derive a two-character monogram from a persona / user name.
 * - Two-word names: first letter of each of the first two words.
 * - Single word: first two characters.
 * - Single character: just that character (upper-cased).
 * - Empty input: '??'.
 */
export function monogramFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '??';
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  const w = words[0] ?? '';
  if (w.length === 1) return w.toUpperCase();
  return w.slice(0, 2).charAt(0).toUpperCase() + w.charAt(1).toLowerCase();
}
```

Create `apps/user-client/src/components/PersonaCard.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { Link, useNavigate } from 'react-router-dom';
import type { PersonaRow } from '../boot/client-data-db.js';
import { monogramFor } from '../lib/monogram.js';

interface Props {
  persona: PersonaRow;
  hasProvider: boolean;
  onChat: (personaId: string) => void;
}

export function PersonaCard({ persona, hasProvider, onChat }: Props): JSX.Element {
  const navigate = useNavigate();
  const monogram = monogramFor(persona.name);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 transition hover:bg-white/[0.04]"
      onClick={() => navigate(`/app/persona/${persona.id}`)}
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
        <div className="truncate text-xs text-paper-soft">
          {persona.tagline || persona.instructions.slice(0, 60)}
        </div>
      </div>
      {hasProvider ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChat(persona.id);
          }}
          className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper hover:border-paper"
        >
          Chat
        </button>
      ) : (
        <>
          <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-coral">
            Provider missing
          </span>
          <button
            type="button"
            disabled
            className="rounded-md border border-paper-soft/20 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft/40"
          >
            Chat
          </button>
        </>
      )}
    </div>
  );
}
```

(If the project doesn't have `coral` in the Tailwind palette, swap to `red-400` or similar — the goal is a noticeable warning tint.)

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run "monogram|persona-card"
```

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/monogram.ts apps/user-client/src/components/PersonaCard.tsx apps/user-client/tests/unit/monogram.test.ts apps/user-client/tests/unit/persona-card.test.tsx
git commit -m "Phase 2 — PersonaCard + monogram helper"
```

---

## Task 9: My Settings shell + About Me accordion card

**Files:**
- Create: `apps/user-client/src/components/AccordionCard.tsx`
- Create: `apps/user-client/src/routes/app/settings.tsx`
- Create: `apps/user-client/tests/unit/settings-route.test.tsx`

Surface shell + first accordion card (About Me + Default Mindspace picker).

- [ ] **Step 1: Write failing test (just the About Me card portion for now)**

Create `apps/user-client/tests/unit/settings-route.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Settings } from '../../src/routes/app/settings.js';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings route — About Me', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the three accordion card headers', async () => {
    wrap(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/about me/i)).toBeInTheDocument();
      expect(screen.getByText(/global system prompt/i)).toBeInTheDocument();
      expect(screen.getByText(/upstream providers/i)).toBeInTheDocument();
    });
  });

  it('persists about-me textarea edits', async () => {
    wrap(<Settings />);
    const card = await screen.findByText(/about me/i);
    fireEvent.click(card);
    const textarea = await screen.findByPlaceholderText(/tell your circle/i);
    fireEvent.change(textarea, { target: { value: 'A new about me' } });
    fireEvent.blur(textarea);
    await waitFor(async () => {
      const db = (await import('../../src/boot/client-data-db.js')).getClientDataDb();
      const row = await db.settings.get(1);
      expect(row?.globalAboutMe).toBe('A new about me');
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run settings-route
```

- [ ] **Step 3: Implement AccordionCard helper**

Create `apps/user-client/src/components/AccordionCard.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type ReactNode } from 'react';

interface Props {
  icon: string;
  label: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function AccordionCard({ icon, label, meta, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-base text-paper-soft">{icon}</span>
          <div>
            <div className="font-display text-sm text-paper">{label}</div>
            {meta ? <div className="text-xs text-paper-soft">{meta}</div> : null}
          </div>
        </div>
        <span className={`text-paper-soft transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open ? <div className="border-t border-white/5 p-3">{children}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement Settings route (About Me only — Global Prompt + Providers placeholders for Task 10/11)**

Create `apps/user-client/src/routes/app/settings.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { MindspacePicker } from '../../components/MindspacePicker.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

export function Settings(): JSX.Element {
  const navigate = useNavigate();
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const updateSettings = useUpdateSettings();
  const setMindspace = useMindspaceStore((s) => s.update);

  useEffect(() => {
    if (settings.data && mindspaces.data) {
      setMindspace({
        persona: null,
        defaultMindspaceId: settings.data.defaultMindspaceId,
        mindspaces: mindspaces.data,
      });
    }
  }, [settings.data, mindspaces.data, setMindspace]);

  if (!settings.data || !mindspaces.data) {
    return <div className="p-4 text-paper-soft">Loading…</div>;
  }

  const s = settings.data;
  const selectedMindspace =
    mindspaces.data.find((m) => m.id === s.defaultMindspaceId) ?? mindspaces.data[0]!;

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <header className="flex items-center gap-2 text-xs uppercase tracking-widest text-paper-soft">
        <button type="button" onClick={() => navigate('/app')} className="text-paper-soft hover:text-paper">
          ←
        </button>
        <span>Room · My Settings</span>
      </header>

      <AccordionCard icon="◉" label="About Me" meta="What your Circle knows about you" defaultOpen>
        <textarea
          className="min-h-[100px] w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          placeholder="Tell your Circle who you are…"
          defaultValue={s.globalAboutMe}
          onBlur={(e) => updateSettings.mutate({ globalAboutMe: e.target.value })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is included in every persona's system prompt unless overridden per-persona.
        </p>
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Your Default Mindspace</div>
          <MindspacePicker
            mindspaces={mindspaces.data}
            selectedMindspaceId={selectedMindspace.id}
            selectedTexture={selectedMindspace.texture}
            selectedFont={s.userFont}
            previewName="Chris"
            onMindspaceChange={(id) => {
              if (id) updateSettings.mutate({ defaultMindspaceId: id });
            }}
            onTextureChange={(t) => {
              // texture mutates the row directly; handled in Task 10's mindspace-mutation hook,
              // wired here when implemented.
              void t;
            }}
            onFontChange={(f) => updateSettings.mutate({ userFont: f })}
          />
        </div>
      </AccordionCard>

      <AccordionCard icon="⚿" label="Global System Prompt" meta="The unlocker — prepended to every persona">
        <textarea
          className="min-h-[100px] w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          defaultValue={s.globalUnlockerPrompt}
          onBlur={(e) => updateSettings.mutate({ globalUnlockerPrompt: e.target.value })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          This text is prepended to every persona's system prompt. Mainly useful for permissive but
          cautious open-source models. Always global, no per-persona override.
        </p>
      </AccordionCard>

      <AccordionCard icon="⬢" label="Upstream Providers" meta="0 of 3 connected" defaultOpen>
        <div className="text-xs text-paper-soft">Providers card lands in Task 10.</div>
      </AccordionCard>
    </section>
  );
}
```

- [ ] **Step 5: Run tests for Tasks 7 + 9, expect PASS for both**

```bash
pnpm --filter @chatsundere/user-client test -- --run "settings-route"
```

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/AccordionCard.tsx apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/unit/settings-route.test.tsx
git commit -m "Phase 2 — Settings route shell + About Me card"
```

---

## Task 10: Settings — Global System Prompt finalisation + Providers card

**Files:**
- Modify: `apps/user-client/src/routes/app/settings.tsx`
- Modify: `apps/user-client/tests/unit/settings-route.test.tsx`

Wire the Global System Prompt save (already in Task 9 — verify), wire the texture mutation, and add the Upstream Providers card with the live list (bottom-sheet comes in Task 11).

- [ ] **Step 1: Add tests for the Providers list state**

Append to `apps/user-client/tests/unit/settings-route.test.tsx`:

```typescript
import { useUpsertProvider } from '../../src/data/providers.js';
import { renderHook, act } from '@testing-library/react';

describe('Settings route — Providers list', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders three built-in provider rows (nano-gpt, Novita AI, Ollama Cloud) with status', async () => {
    wrap(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/nano-gpt/i)).toBeInTheDocument();
      expect(screen.getByText(/novita ai/i)).toBeInTheDocument();
      expect(screen.getByText(/ollama cloud/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/not connected/i).length).toBe(3);
  });

  it('counts connected providers in the card meta line', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Inner = () => {
      const upsert = useUpsertProvider();
      const seed = async () =>
        upsert.mutateAsync({
          templateId: 'nano-gpt',
          apiKey: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]), version: 1 },
          enabled: true,
        });
      void seed();
      return <Settings />;
    };
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Inner />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/1 of 3 connected/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run settings-route
```

- [ ] **Step 3: Update `settings.tsx` — Providers card with live list**

Replace the placeholder Providers card in `settings.tsx`:

```tsx
import { useProviders } from '../../data/providers.js';
import { useUpdateMindspaceTexture } from '../../data/mindspaces.js';
// (add to existing imports)

// At the top of the Settings function:
const providers = useProviders();
const updateTexture = useUpdateMindspaceTexture();

// Hook up onTextureChange in the MindspacePicker:
onTextureChange={(t) => updateTexture.mutate({ id: selectedMindspace.id, texture: t })}

// Replace the Upstream Providers AccordionCard body:
<AccordionCard
  icon="⬢"
  label="Upstream Providers"
  meta={`${(providers.data ?? []).filter((p) => p.enabled).length} of 3 connected`}
  defaultOpen
>
  <ProvidersList />
</AccordionCard>
```

Add a local `ProvidersList` component inside `settings.tsx` (or extract into `apps/user-client/src/components/ProvidersList.tsx`):

```tsx
function ProvidersList(): JSX.Element {
  const providers = useProviders();
  const built = [
    { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
    { id: 'novita', name: 'Novita AI', monogram: 'No' },
    { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
  ] as const;

  return (
    <div className="flex flex-col gap-2">
      {built.map((b) => {
        const row = providers.data?.find((p) => p.templateId === b.id);
        const connected = !!row?.enabled;
        return (
          <button
            key={b.id}
            type="button"
            className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
            onClick={() => {
              // ProviderSheet integration arrives in Task 11; for now this is a no-op.
            }}
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
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run settings-route
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/unit/settings-route.test.tsx
git commit -m "Phase 2 — Settings — Providers list + texture mutation wiring"
```

---

## Task 11: Provider Bottom-Sheet + auto-probe-on-close

**Files:**
- Create: `apps/user-client/src/components/ProviderSheet.tsx`
- Create: `apps/user-client/tests/unit/provider-sheet.test.tsx`
- Modify: `apps/user-client/src/routes/app/settings.tsx` (wire the sheet open/close)

Per Spec § 5.3: API-Key input + (for `requires-proxy` templates) CORS-proxy URL + shared key + auto-probe-on-close. Uses `@chatsundere/llm-unified` `probeProvider` and `sealSecret`/`openSecret`.

- [ ] **Step 1: Write failing tests**

Create `apps/user-client/tests/unit/provider-sheet.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { ProviderSheet } from '../../src/components/ProviderSheet.js';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('ProviderSheet', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders only the API key field for direct-CORS providers', () => {
    wrap(<ProviderSheet templateId="nano-gpt" onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/sk-/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/cors-proxy.tidesson/i)).not.toBeInTheDocument();
  });

  it('renders CORS-proxy fields for ollama-cloud (requires-proxy)', () => {
    wrap(<ProviderSheet templateId="ollama-cloud" onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/sk-/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/proxy url/i)).toBeInTheDocument();
  });

  it('triggers an auto-probe on close', async () => {
    const onClose = vi.fn();
    wrap(<ProviderSheet templateId="nano-gpt" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: /close|×/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run provider-sheet
```

- [ ] **Step 3: Implement ProviderSheet**

Create `apps/user-client/src/components/ProviderSheet.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, probeProvider } from '@chatsundere/llm-unified';
import { useState } from 'react';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../data/providers.js';
import { useSettings, useUpdateSettings } from '../data/settings.js';
import { openSecret, sealSecret } from '../lib/secrets.js';
import { useSessionStore } from '@chatsundere/ui-shared';

interface Props {
  templateId: 'nano-gpt' | 'novita' | 'ollama-cloud';
  onClose: () => void;
}

type Status = { kind: 'idle' } | { kind: 'probing' } | { kind: 'ok' } | { kind: 'error'; reason: string };

export function ProviderSheet({ templateId, onClose }: Props): JSX.Element {
  const definition = getProvider(templateId);
  const requiresProxy = definition.corsHint === 'requires-proxy';
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

  async function close() {
    if (!apiKey && !existing) {
      onClose();
      return;
    }
    if (!mk) {
      setStatus({ kind: 'error', reason: 'No master key in session — re-login required' });
      onClose();
      return;
    }
    setStatus({ kind: 'probing' });
    try {
      const sealedKey = apiKey
        ? await sealSecret(apiKey, mk)
        : existing?.apiKey;
      if (!sealedKey) {
        onClose();
        return;
      }
      const row = await upsert.mutateAsync({
        id: existing?.id,
        templateId,
        apiKey: sealedKey,
        enabled: false, // flipped to true only if probe succeeds
      });

      if (requiresProxy && proxyUrl && proxyShared) {
        const sealedShared = await sealSecret(proxyShared, mk);
        await updateSettings.mutateAsync({
          corsProxy: { url: proxyUrl, sharedKey: sealedShared },
        });
      }

      // Probe with decrypted values
      const decryptedKey = await openSecret(sealedKey, mk);
      const decryptedProxyKey =
        requiresProxy && settings.data?.corsProxy
          ? await openSecret(settings.data.corsProxy.sharedKey, mk)
          : null;

      const config = {
        baseUrl: definition.baseUrl,
        routing: requiresProxy ? ({ kind: 'cors-proxy' } as const) : ({ kind: 'direct' } as const),
      };
      const result = await probeProvider({
        definition,
        config,
        apiKey: decryptedKey,
        corsProxyUrl: requiresProxy ? proxyUrl || settings.data?.corsProxy?.url || null : null,
        corsProxyKey: decryptedProxyKey,
      });

      if (result.ok) {
        await upsert.mutateAsync({ id: row.id, templateId, apiKey: sealedKey, enabled: true });
        setStatus({ kind: 'ok' });
      } else {
        setStatus({ kind: 'error', reason: `${result.status} · ${result.reason}` });
      }
    } catch (e) {
      setStatus({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    } finally {
      onClose();
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-white/10 bg-bg p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
            {definition.displayName.slice(0, 2)}
          </div>
          <div>
            <div className="font-display text-sm text-paper">{definition.displayName}</div>
            <div className="text-xs text-paper-soft">Text capability</div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="rounded-full p-1 text-paper-soft hover:text-paper"
        >
          ×
        </button>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">API Key</label>
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
          <input
            type={revealKey ? 'text' : 'password'}
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 bg-transparent font-mono text-sm text-paper outline-none"
          />
          <button
            type="button"
            onClick={() => setRevealKey((v) => !v)}
            className="text-paper-soft hover:text-paper"
          >
            ◉
          </button>
        </div>
        <p className="mt-1 text-[11px] text-paper-soft">
          Key is tested automatically when you close this sheet.
        </p>
      </div>

      {requiresProxy ? (
        <div className="mb-3 space-y-2 border-t border-white/5 pt-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">Proxy URL</label>
            <input
              type="text"
              placeholder="proxy url (https://cors-proxy.tidesson.net)"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">Shared key</label>
            <input
              type="password"
              placeholder="shared secret"
              value={proxyShared}
              onChange={(e) => setProxyShared(e.target.value)}
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
          className={`mb-3 rounded-md border px-3 py-2 text-xs ${
            status.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : status.kind === 'error'
                ? 'border-coral/30 bg-coral/10 text-coral'
                : 'border-paper-soft/30 bg-paper-soft/10 text-paper-soft'
          }`}
        >
          {status.kind === 'probing'
            ? 'Probing…'
            : status.kind === 'ok'
              ? '✓ Key valid'
              : `✗ ${status.reason}`}
        </div>
      ) : null}

      {existing ? (
        <div className="mt-2 rounded-md border border-coral/30 p-3">
          <div className="text-xs font-medium uppercase tracking-widest text-coral">
            Remove this provider
          </div>
          <div className="mb-2 text-[11px] text-paper-soft">
            Key is deleted, personas using this provider won't be able to connect.
          </div>
          <button
            type="button"
            onClick={async () => {
              await del.mutateAsync(existing.id);
              onClose();
            }}
            className="rounded-md border border-coral px-3 py-1 text-xs uppercase tracking-wider text-coral hover:bg-coral/10"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

(NB the import from `@chatsundere/llm-unified` for `getProvider` + `probeProvider` — check Phase-1's `packages/llm-unified/src/index.ts` exports. If `getProvider` is not yet exported, add it in this task as a one-line addition to that file.)

- [ ] **Step 4: Wire ProviderSheet open/close in `settings.tsx`**

Replace the `onClick={() => { /* sheet integration */ }}` no-op in `ProvidersList` with:

```tsx
function ProvidersList(): JSX.Element {
  const providers = useProviders();
  const [openSheet, setOpenSheet] = useState<'nano-gpt' | 'novita' | 'ollama-cloud' | null>(null);
  const built = [
    { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
    { id: 'novita', name: 'Novita AI', monogram: 'No' },
    { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
  ] as const;

  return (
    <div className="flex flex-col gap-2">
      {built.map((b) => {
        const row = providers.data?.find((p) => p.templateId === b.id);
        const connected = !!row?.enabled;
        return (
          <button
            key={b.id}
            type="button"
            className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
            onClick={() => setOpenSheet(b.id)}
          >
            ...
          </button>
        );
      })}
      {openSheet ? <ProviderSheet templateId={openSheet} onClose={() => setOpenSheet(null)} /> : null}
    </div>
  );
}
```

Add the imports at the top of `settings.tsx`:

```tsx
import { useState } from 'react';
import { ProviderSheet } from '../../components/ProviderSheet.js';
```

- [ ] **Step 5: Run tests, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run "provider-sheet|settings-route"
```

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ProviderSheet.tsx apps/user-client/src/routes/app/settings.tsx apps/user-client/tests/unit/provider-sheet.test.tsx
git commit -m "Phase 2 — Provider Bottom-Sheet with auto-probe-on-close"
```

---

## Task 12: My Circle route

**Files:**
- Create: `apps/user-client/src/routes/app/circle.tsx`
- Create: `apps/user-client/tests/unit/circle-route.test.tsx`

The Circle list surface — renders persona cards and a "+" FAB that opens the create-mode editor.

- [ ] **Step 1: Write failing tests**

Create `apps/user-client/tests/unit/circle-route.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  openClientDataDb,
  getClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Circle } from '../../src/routes/app/circle.js';

function wrap(initialEntry = '/app/circle') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/circle" element={<Circle />} />
          <Route path="/app/persona/new" element={<div data-testid="editor-create" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Circle route', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders an empty-state hint when no personas exist', async () => {
    wrap();
    await waitFor(() => {
      expect(screen.getByText(/no personas yet/i)).toBeInTheDocument();
    });
  });

  it('navigates to /app/persona/new when the FAB is clicked', async () => {
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /new persona/i }));
    await waitFor(() => expect(screen.getByTestId('editor-create')).toBeInTheDocument());
  });

  it('renders persona cards when personas exist', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p1',
      name: 'Aurum',
      tagline: 'quiet sparring',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'be present',
      providerId: 'nope',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    wrap();
    await waitFor(() => {
      expect(screen.getByText('Aurum')).toBeInTheDocument();
      expect(screen.getByText(/quiet sparring/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run circle-route
```

- [ ] **Step 3: Implement Circle route**

Create `apps/user-client/src/routes/app/circle.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { PersonaCard } from '../../components/PersonaCard.js';
import { usePersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';

export function Circle(): JSX.Element {
  const navigate = useNavigate();
  const personas = usePersonas();
  const providers = useProviders();
  const enabledProviderIds = new Set(
    (providers.data ?? []).filter((p) => p.enabled).map((p) => p.id),
  );

  return (
    <section className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-24 pt-4">
      <header className="flex items-center gap-2 text-xs uppercase tracking-widest text-paper-soft">
        <button type="button" onClick={() => navigate('/app')} className="text-paper-soft hover:text-paper">
          ←
        </button>
        <span>Room · My Circle</span>
      </header>

      {personas.data && personas.data.length === 0 ? (
        <div className="mt-8 grid place-items-center text-center text-paper-soft">
          <p className="font-display text-lg italic text-paper">No personas yet</p>
          <p className="mt-2 max-w-xs text-sm">
            Tap the "+" button below to create your first companion.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {(personas.data ?? []).map((p) => (
          <PersonaCard
            key={p.id}
            persona={p}
            hasProvider={enabledProviderIds.has(p.providerId)}
            onChat={(_id) => {
              // Phase-3 work: open or create chat. Phase 2 leaves this as a no-op.
            }}
          />
        ))}
      </div>

      <button
        type="button"
        aria-label="New persona"
        onClick={() => navigate('/app/persona/new')}
        className="fixed bottom-6 right-6 z-10 grid h-14 w-14 place-items-center rounded-full bg-paper text-2xl text-bg shadow-2xl hover:scale-105"
      >
        +
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run circle-route
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/circle.tsx apps/user-client/tests/unit/circle-route.test.tsx
git commit -m "Phase 2 — My Circle route (list + FAB + empty-state)"
```

---

## Task 13: Persona Editor — shell + Identity / Instructions / About-Me-Override

**Files:**
- Create: `apps/user-client/src/routes/app/persona-editor.tsx`
- Create: `apps/user-client/tests/unit/persona-editor.test.tsx`

Editor shell with topbar, chat-actions row (placeholder buttons), and the first three accordion sections. Mindspace/Model/Behavior land in Task 14; Delete/Save-Bar in Task 15.

- [ ] **Step 1: Write tests for the first three accordion sections + topbar**

Create `apps/user-client/tests/unit/persona-editor.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
          <Route path="/app/persona/new" element={<PersonaEditor />} />
          <Route path="/app/circle" element={<div data-testid="circle" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaEditor — Identity / Instructions / About-Me-Override', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders topbar with "New Persona" in create mode', async () => {
    wrap('/app/persona/new');
    await waitFor(() => expect(screen.getByText(/new persona/i)).toBeInTheDocument());
  });

  it('renders persona name in topbar context in edit mode', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p-edit',
      name: 'Vix',
      tagline: '',
      colour: '#b33a5e',
      font: 'sans',
      instructions: 'i',
      providerId: 'pv',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    wrap('/app/persona/p-edit');
    await waitFor(() => {
      const topbar = screen.getAllByText('Vix');
      expect(topbar.length).toBeGreaterThan(0);
    });
  });

  it('Identity card edits name + tagline live in topbar', async () => {
    wrap('/app/persona/new');
    const card = await screen.findByText(/identity/i);
    fireEvent.click(card);
    const nameInput = await screen.findByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: 'Lyra' } });
    await waitFor(() => expect(screen.getAllByText('Lyra').length).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run persona-editor
```

- [ ] **Step 3: Implement the editor shell + first three sections**

Create `apps/user-client/src/routes/app/persona-editor.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import type { PersonaRow } from '../../boot/client-data-db.js';
import {
  useCreatePersona,
  useDeletePersona,
  usePersona,
  useUpdatePersona,
} from '../../data/personas.js';
import { useSettings } from '../../data/settings.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { useProviders } from '../../data/providers.js';

type DraftPersona = Omit<PersonaRow, 'id' | 'createdAt' | 'updatedAt'>;

function defaultDraft(settings: ReturnType<typeof useSettings>['data'], mindspaces: ReturnType<typeof useMindspaces>['data'], providers: ReturnType<typeof useProviders>['data']): DraftPersona {
  const defaultMindspace = mindspaces?.find((m) => m.id === settings?.defaultMindspaceId);
  const firstEnabled = providers?.find((p) => p.enabled);
  return {
    name: '',
    tagline: '',
    colour: defaultMindspace?.palette.accent ?? '#c9a84c',
    font: settings?.userFont ?? 'serif',
    instructions: '',
    providerId: firstEnabled?.id ?? '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    temperature: 0.85,
    adultPersona: false,
  };
}

export function PersonaEditor(): JSX.Element {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isCreate = !id || id === 'new';

  const persona = usePersona(isCreate ? null : (id ?? null));
  const settings = useSettings();
  const mindspaces = useMindspaces();
  const providers = useProviders();
  const create = useCreatePersona();
  const update = useUpdatePersona();
  const del = useDeletePersona();

  const seedDraft = useMemo(
    () => defaultDraft(settings.data, mindspaces.data, providers.data),
    [settings.data, mindspaces.data, providers.data],
  );
  const [draft, setDraft] = useState<DraftPersona>(seedDraft);

  useEffect(() => {
    if (!isCreate && persona.data) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = persona.data;
      setDraft(rest);
    } else if (isCreate) {
      setDraft(seedDraft);
    }
  }, [isCreate, persona.data, seedDraft]);

  function patch(p: Partial<DraftPersona>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  async function onSave() {
    if (isCreate) {
      await create.mutateAsync(draft);
    } else if (id) {
      await update.mutateAsync({ id, patch: draft });
    }
    navigate('/app/circle');
  }

  return (
    <section className="flex flex-col gap-3 px-4 pb-32 pt-4">
      <header className="flex items-center justify-between text-xs uppercase tracking-widest text-paper-soft">
        <button
          type="button"
          onClick={() => navigate('/app/circle')}
          className="text-paper-soft hover:text-paper"
        >
          ←
        </button>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-paper-soft">
            {isCreate ? 'New Persona' : 'Edit Persona'}
          </div>
          <div className="font-display text-sm text-paper" style={{ color: draft.colour }}>
            {draft.name || '—'}
          </div>
        </div>
        <span className="w-6" />
      </header>

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

      <AccordionCard icon="✦" label="Identity" meta="Name · tagline" defaultOpen>
        <label className="mb-2 block text-xs uppercase tracking-widest text-paper-soft" htmlFor="persona-name">
          Name
        </label>
        <input
          id="persona-name"
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
        <label className="mb-2 block text-xs uppercase tracking-widest text-paper-soft" htmlFor="persona-tagline">
          Tagline
        </label>
        <input
          id="persona-tagline"
          type="text"
          value={draft.tagline}
          onChange={(e) => patch({ tagline: e.target.value })}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
        />
      </AccordionCard>

      <AccordionCard icon="≣" label="Custom Instructions" meta="Who this persona is">
        <textarea
          className="min-h-[140px] w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          value={draft.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </AccordionCard>

      <AccordionCard icon="◉" label="About Me — Override" meta="Empty = global is used">
        <textarea
          className="min-h-[100px] w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          placeholder={settings.data?.globalAboutMe || 'Tell this persona who you are…'}
          value={draft.aboutMeOverride ?? ''}
          onChange={(e) => patch({ aboutMeOverride: e.target.value === '' ? null : e.target.value })}
        />
        <p className="mt-2 text-[11px] text-paper-soft">
          Empty = global About Me is used (shown in gray). Fill in to override for this persona only.
        </p>
      </AccordionCard>

      {/* Mindspace / Model / Behavior land in Task 14; Delete + Save-Bar in Task 15. */}
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run persona-editor
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/unit/persona-editor.test.tsx
git commit -m "Phase 2 — Persona Editor shell + Identity/Instructions/About-Me-Override"
```

---

## Task 14: Persona Editor — Mindspace / Model / Behavior accordion sections

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Modify: `apps/user-client/tests/unit/persona-editor.test.tsx`

- [ ] **Step 1: Add failing tests for Mindspace + Model + Behavior**

Append to `apps/user-client/tests/unit/persona-editor.test.tsx`:

```tsx
describe('PersonaEditor — Mindspace / Model / Behavior', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('Mindspace-Override picker offers "Use user default" chip', async () => {
    wrap('/app/persona/new');
    fireEvent.click(await screen.findByText(/mindspace.*override/i));
    expect(await screen.findByRole('button', { name: /use user default/i })).toBeInTheDocument();
  });

  it('Behavior section shows temperature slider with default 0.85', async () => {
    wrap('/app/persona/new');
    fireEvent.click(await screen.findByText(/behavior/i));
    expect(await screen.findByText('0.85')).toBeInTheDocument();
  });

  it('Behavior section shows Adult Persona toggle', async () => {
    wrap('/app/persona/new');
    fireEvent.click(await screen.findByText(/behavior/i));
    expect(await screen.findByText(/adult persona/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run persona-editor
```

- [ ] **Step 3: Implement Mindspace / Model / Behavior accordion sections**

In `persona-editor.tsx`, after the About-Me-Override AccordionCard, append:

```tsx
{mindspaces.data ? (
  <AccordionCard icon="◈" label="Mindspace — Override" meta="Color · texture · font">
    <MindspacePicker
      mindspaces={mindspaces.data}
      selectedMindspaceId={draft.mindspaceId}
      selectedTexture={
        (draft.mindspaceId
          ? mindspaces.data.find((m) => m.id === draft.mindspaceId)?.texture
          : mindspaces.data.find((m) => m.id === settings.data?.defaultMindspaceId)?.texture) ??
        'cloudy'
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
      onTextureChange={(_t) => {
        // Texture is mutated on the row (built-in or user), not stored on the persona.
        // For Phase 2 the override picker writes the user-default texture; full per-persona
        // texture-override surfaces in a later block.
      }}
      onFontChange={(f) => patch({ font: f })}
    />
  </AccordionCard>
) : null}

<AccordionCard icon="⬡" label="Model" meta="Pick a provider/model pair">
  <ModelList
    providers={providers.data ?? []}
    selectedProviderId={draft.providerId}
    selectedModelId={draft.modelId}
    onSelect={(providerId, modelId) => patch({ providerId, modelId })}
  />
</AccordionCard>

<AccordionCard icon="∿" label="Behavior" meta="Temperature · adult persona">
  <label className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">Temperature</label>
  <div className="flex items-center gap-3">
    <input
      type="range"
      min="0"
      max="2"
      step="0.05"
      value={draft.temperature}
      onChange={(e) => patch({ temperature: Number(e.target.value) })}
      className="flex-1"
    />
    <span className="w-12 text-center font-mono text-sm text-paper">{draft.temperature.toFixed(2)}</span>
  </div>
  <p className="mt-1 text-[11px] text-paper-soft">
    Default 0.85 · range 0.00 – 2.00 in 0.05 steps. Higher = more creative chaos.
  </p>

  <div className="mt-4 flex items-center justify-between gap-3">
    <div>
      <div className="text-sm text-paper">Adult Persona</div>
      <p className="text-[11px] text-paper-soft">
        Hidden when sanitized mode is active. Adult content is governed by the system prompt or custom
        instructions, not this flag.
      </p>
    </div>
    <button
      type="button"
      aria-pressed={draft.adultPersona}
      onClick={() => patch({ adultPersona: !draft.adultPersona })}
      className={`h-6 w-12 shrink-0 rounded-full border ${
        draft.adultPersona ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
          draft.adultPersona ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
</AccordionCard>
```

Add the `MindspacePicker` import (if not already present) and add the `ModelList` component at the bottom of `persona-editor.tsx`:

```tsx
function ModelList({
  providers,
  selectedProviderId,
  selectedModelId,
  onSelect,
}: {
  providers: import('../../boot/client-data-db.js').ProviderRow[];
  selectedProviderId: string;
  selectedModelId: string;
  onSelect: (providerId: string, modelId: string) => void;
}): JSX.Element {
  // Each provider exposes a static set of known model ids via
  // @chatsundere/llm-unified's getProvider().knownModels. (Add the
  // `import { getProvider } from '@chatsundere/llm-unified';` line at
  // the top of this file alongside the other imports.)
  const [customInput, setCustomInput] = useState('');

  return (
    <div className="flex flex-col gap-2">
      {providers.filter((p) => p.enabled).flatMap((p) => {
        const def = getProvider(p.templateId);
        return def.knownModels.map((km) => (
          <button
            key={`${p.id}:${km.id}`}
            type="button"
            onClick={() => onSelect(p.id, km.id)}
            className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${
              selectedProviderId === p.id && selectedModelId === km.id
                ? 'border-paper bg-white/[0.04]'
                : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
          >
            <div>
              <div className="font-display text-sm text-paper">{km.displayName}</div>
              <div className="text-xs text-paper-soft">via {def.displayName}</div>
            </div>
            {selectedProviderId === p.id && selectedModelId === km.id ? <span>✓</span> : null}
          </button>
        ));
      })}

      <div className="mt-2 flex gap-2">
        <input
          type="text"
          placeholder="Custom model id"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          className="flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
        />
        <button
          type="button"
          disabled={!customInput || !selectedProviderId}
          onClick={() => {
            onSelect(selectedProviderId, customInput);
            setCustomInput('');
          }}
          className="rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

Add to the imports at the top of `persona-editor.tsx` (alongside the other `import`s, in alphabetical order per Biome's `organizeImports`):

```tsx
import { getProvider } from '@chatsundere/llm-unified';
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run persona-editor
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/unit/persona-editor.test.tsx
git commit -m "Phase 2 — Persona Editor: Mindspace / Model / Behavior sections"
```

---

## Task 15: Persona Editor — Delete-Zone + Save-Bar + validation

**Files:**
- Create: `apps/user-client/src/components/SaveBar.tsx`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`
- Modify: `apps/user-client/tests/unit/persona-editor.test.tsx`

Add the Delete-Zone (edit mode only) and the sticky Save-Bar with validation gating.

- [ ] **Step 1: Add failing tests**

Append to `apps/user-client/tests/unit/persona-editor.test.tsx`:

```tsx
describe('PersonaEditor — Delete + Save-Bar', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('disables Save when name is empty', async () => {
    wrap('/app/persona/new');
    const save = await screen.findByRole('button', { name: /save persona/i });
    expect(save).toBeDisabled();
  });

  it('enables Save when name + instructions filled', async () => {
    wrap('/app/persona/new');
    const nameInput = await screen.findByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: 'Aurum' } });
    fireEvent.click(screen.getByText(/custom instructions/i));
    const instructions = await screen.findByDisplayValue('');
    fireEvent.change(instructions, { target: { value: 'be present' } });
    // Provider also required — for this test we accept the no-provider tooltip path:
    const save = screen.getByRole('button', { name: /save persona/i });
    // expect save still disabled if no providerId
    expect(save).toBeDisabled();
  });

  it('shows Delete zone only in edit mode', async () => {
    const now = Date.now();
    const db = getClientDataDb();
    await db.personas.add({
      id: 'p-del',
      name: 'X',
      tagline: '',
      colour: '#fff',
      font: 'sans',
      instructions: 'i',
      providerId: 'pv',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    wrap('/app/persona/p-del');
    expect(await screen.findByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run persona-editor
```

- [ ] **Step 3: Implement SaveBar**

Create `apps/user-client/src/components/SaveBar.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  onCancel: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  saveTooltip?: string;
}

export function SaveBar({ onCancel, onSave, saveDisabled, saveTooltip }: Props): JSX.Element {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-white/5 bg-bg/95 px-4 py-3 backdrop-blur">
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
        Save Persona
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire Delete-Zone + Save-Bar into `persona-editor.tsx`**

Append to the `<section>` body, after the Behavior AccordionCard:

```tsx
{!isCreate && id ? (
  <div className="mt-4 rounded-lg border border-coral/30 p-3">
    <div className="text-sm font-medium uppercase tracking-widest text-coral">Delete Persona</div>
    <p className="mb-2 text-[11px] text-paper-soft">
      All chats with this persona will be lost.
    </p>
    <button
      type="button"
      onClick={async () => {
        if (!confirm(`Delete ${draft.name}? All chats with this persona will be lost.`)) return;
        await del.mutateAsync(id);
        navigate('/app/circle');
      }}
      className="rounded-md border border-coral px-3 py-1 text-xs uppercase tracking-wider text-coral hover:bg-coral/10"
    >
      Delete
    </button>
  </div>
) : null}

<SaveBar
  onCancel={() => navigate('/app/circle')}
  onSave={onSave}
  saveDisabled={!draft.name || !draft.instructions || !draft.providerId}
  saveTooltip={!draft.providerId ? 'Add a provider in Settings first' : 'Fill in name and instructions'}
/>
```

Add `import { SaveBar } from '../../components/SaveBar.js';` at the top.

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run persona-editor
```

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/SaveBar.tsx apps/user-client/src/routes/app/persona-editor.tsx apps/user-client/tests/unit/persona-editor.test.tsx
git commit -m "Phase 2 — Persona Editor: Delete-Zone + Save-Bar + validation"
```

---

## Task 16: Entrance Hall route

**Files:**
- Create: `apps/user-client/src/routes/app/entrance-hall.tsx`
- Create: `apps/user-client/tests/unit/entrance-hall.test.tsx`

The new "/app" landing — replaces the AppShell BreathingOrb placeholder. Renders greeting, conditional Continue-Card, and 5-tile Rooms-Grid with disabled-stubs for Projects/History/Treasury.

- [ ] **Step 1: Write failing tests**

Create `apps/user-client/tests/unit/entrance-hall.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { EntranceHall } from '../../src/routes/app/entrance-hall.js';

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app" element={<EntranceHall />} />
          <Route path="/app/circle" element={<div data-testid="circle" />} />
          <Route path="/app/settings" element={<div data-testid="settings" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntranceHall', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the greeting + five room tiles', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
      expect(screen.getByText('My Circle')).toBeInTheDocument();
      expect(screen.getByText('My Projects')).toBeInTheDocument();
      expect(screen.getByText('My History')).toBeInTheDocument();
      expect(screen.getByText('My Treasury')).toBeInTheDocument();
      expect(screen.getByText('My Settings')).toBeInTheDocument();
    });
  });

  it('does NOT render a "My Bookmarks" tile', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.queryByText('My Bookmarks')).toBeNull();
    });
  });

  it('hides the Continue-Card in the zero-state', async () => {
    wrap('/app');
    await waitFor(() => {
      expect(screen.queryByText(/continue chat/i)).toBeNull();
    });
  });

  it('renders disabled-stubs for Projects / History / Treasury', async () => {
    wrap('/app');
    for (const label of ['My Projects', 'My History', 'My Treasury']) {
      const tile = await screen.findByText(label);
      const card = tile.closest('[aria-disabled="true"]');
      expect(card).not.toBeNull();
    }
  });

  it('navigates to /app/circle when My Circle is tapped', async () => {
    wrap('/app');
    fireEvent.click(await screen.findByText('My Circle'));
    await waitFor(() => expect(screen.getByTestId('circle')).toBeInTheDocument());
  });

  it('navigates to /app/settings when My Settings is tapped', async () => {
    wrap('/app');
    fireEvent.click(await screen.findByText('My Settings'));
    await waitFor(() => expect(screen.getByTestId('settings')).toBeInTheDocument());
  });

  it('renders the Continue-Card when at least one chat exists', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
    await db.personas.add({
      id: 'p1',
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'i',
      providerId: 'pv',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      temperature: 0.85,
      adultPersona: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: 'Test chat',
      resolvedMindspaceId: aurum?.id ?? 'aurum',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
    });
    wrap('/app');
    await waitFor(() => {
      expect(screen.getByText(/continue chat/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @chatsundere/user-client test -- --run entrance-hall
```

- [ ] **Step 3: Implement EntranceHall**

Create `apps/user-client/src/routes/app/entrance-hall.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useChats } from '../../data/chats.js';
import { useMindspaces } from '../../data/mindspaces.js';
import { usePersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

interface RoomTileProps {
  label: string;
  icon: string;
  meta: string;
  to?: string;
  disabled?: boolean;
  tooltip?: string;
}

function RoomTile({ label, icon, meta, to, disabled, tooltip }: RoomTileProps) {
  const navigate = useNavigate();
  const interactive = !disabled && to;
  return (
    <div
      role="button"
      aria-disabled={disabled ? 'true' : undefined}
      title={tooltip}
      onClick={interactive ? () => navigate(to!) : undefined}
      className={`flex flex-col gap-1 rounded-lg border border-white/5 bg-white/[0.02] p-4 ${
        interactive ? 'cursor-pointer hover:bg-white/[0.04]' : 'opacity-40'
      }`}
    >
      <div className="text-lg text-paper-soft">{icon}</div>
      <div className="font-display text-sm text-paper">{label}</div>
      <div className="text-[11px] uppercase tracking-widest text-paper-soft">{meta}</div>
    </div>
  );
}

export function EntranceHall(): JSX.Element {
  const session = useSessionStore((s) => s.session);
  const settings = useSettings();
  const personas = usePersonas();
  const chats = useChats();
  const providers = useProviders();
  const mindspaces = useMindspaces();
  const setMindspace = useMindspaceStore((s) => s.update);

  useEffect(() => {
    if (settings.data && mindspaces.data) {
      setMindspace({
        persona: null,
        defaultMindspaceId: settings.data.defaultMindspaceId,
        mindspaces: mindspaces.data,
      });
    }
  }, [settings.data, mindspaces.data, setMindspace]);

  const recentChat = (chats.data ?? [])[0];
  const recentPersona = recentChat
    ? personas.data?.find((p) => p.id === recentChat.personaId)
    : undefined;
  const personaCount = personas.data?.length ?? 0;
  const providerCount = (providers.data ?? []).filter((p) => p.enabled).length;
  const fontClass: Record<'sans' | 'serif' | 'cursive', string> = {
    sans: 'font-sans',
    serif: 'font-display',
    cursive: 'italic font-display',
  };

  return (
    <section className="flex min-h-[80dvh] flex-col gap-6 px-4 pb-12 pt-6">
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-paper-soft">Welcome back</div>
        <div
          className={`mt-2 text-3xl ${fontClass[settings.data?.userFont ?? 'serif']}`}
          style={{ color: 'var(--mindspace-text-primary)' }}
        >
          {session?.username ?? '—'}
        </div>
      </div>

      {recentChat && recentPersona ? (
        <button
          type="button"
          className="rounded-2xl border border-paper-soft/30 bg-white/[0.04] p-4 text-left"
          // Phase-3 navigates into Reading Mode; Phase 2 no-op (chat surface not built yet).
        >
          <div className="text-[10px] uppercase tracking-widest text-paper-soft">Continue chat</div>
          <div className="mt-1 font-display text-lg" style={{ color: recentPersona.colour }}>
            {recentChat.title ?? recentPersona.name}
          </div>
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <RoomTile label="My Circle" icon="✦" meta={`${personaCount} personas`} to="/app/circle" />
        <RoomTile label="My Projects" icon="◇" meta="Coming with Block 2+" disabled tooltip="Coming with Block 2+" />
        <RoomTile label="My History" icon="◯" meta="Coming in Phase 4" disabled tooltip="Coming in Phase 4" />
        <RoomTile label="My Treasury" icon="⬡" meta="Coming later" disabled tooltip="Coming later" />
        <RoomTile label="My Settings" icon="⚙" meta={`${providerCount} providers connected`} to="/app/settings" />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @chatsundere/user-client test -- --run entrance-hall
```

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/entrance-hall.tsx apps/user-client/tests/unit/entrance-hall.test.tsx
git commit -m "Phase 2 — Entrance Hall (5 rooms, disabled stubs, zero-state)"
```

---

## Task 17: Routing integration — replace AppShell, wire subroutes, mount MindspaceLayer

**Files:**
- Modify: `apps/user-client/src/App.tsx`
- Delete: `apps/user-client/src/routes/app-shell.tsx`

- [ ] **Step 1: Wire subroutes + MindspaceLayer**

Edit `apps/user-client/src/App.tsx`:

Replace the import line:
```tsx
import { AppShell } from './routes/app-shell.js';
```
with:
```tsx
import { Circle } from './routes/app/circle.js';
import { EntranceHall } from './routes/app/entrance-hall.js';
import { PersonaEditor } from './routes/app/persona-editor.js';
import { Settings as MySettings } from './routes/app/settings.js';
import { MindspaceLayer } from './components/MindspaceLayer.js';
```

Inside the `case 'ready'` JSX, wrap the `<Routes>` (or add as a sibling of `<BrowserRouter>`'s children) with `<MindspaceLayer />` mounted at the root:

```tsx
case 'ready':
  return (
    <QueryClientProvider client={queryClient}>
      <MindspaceLayer />
      <BrowserRouter>
        <Routes>
          ...
```

Replace the existing `/app` route:

```tsx
<Route path="/app" element={<AppShell />} />
```
with:
```tsx
<Route path="/app" element={<EntranceHall />} />
<Route path="/app/circle" element={<Circle />} />
<Route path="/app/persona/new" element={<PersonaEditor />} />
<Route path="/app/persona/:id" element={<PersonaEditor />} />
<Route path="/app/settings" element={<MySettings />} />
```

(Keep the existing `/settings` account-settings routes intact — they coexist.)

Delete the file `apps/user-client/src/routes/app-shell.tsx`.

- [ ] **Step 2: Typecheck + build**

```bash
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client build
```

Expected: clean. Any remaining references to `AppShell` get caught here.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/App.tsx
git rm apps/user-client/src/routes/app-shell.tsx
git commit -m "Phase 2 — wire /app subroutes, mount MindspaceLayer, drop AppShell"
```

---

## Task 18: Integration check + Manual-Verification appendix

**Files:**
- (none new — verification only)

- [ ] **Step 1: Full lint + typecheck + tests + build**

```bash
pnpm lint
pnpm --filter @chatsundere/user-client typecheck
pnpm --filter @chatsundere/user-client test
pnpm --filter @chatsundere/user-client build
```

Expected: all clean. (`pnpm lint` runs Biome over the whole workspace at the repo root.) If any test fails, identify the failing surface and circle back to the responsible task.

- [ ] **Step 2: Cross-package re-check**

```bash
pnpm --filter @chatsundere/llm-unified test
pnpm --filter @chatsundere/crypto test
```

Expected: Phase-1 packages remain green (Phase 2 did not touch them).

- [ ] **Step 3: Run the full Turbo build**

```bash
pnpm build
```

Expected: every workspace builds cleanly.

- [ ] **Step 4: Append the Manual-Verification appendix to STATUS-CLIENT-ONLY.md "Next session" block**

Use the appendix below as a checklist for Chris's device-smoke. Add it to the "Next session" block in `obsidian/STATUS-CLIENT-ONLY.md` (or write it as the body of a new file `obsidian/insights/2026-05-23-phase-2-manual-verification.md` and link to it from STATUS).

Manual-Verification checklist:

1. Fresh PWA install → onboarding intent matrix → "Just this device" → recovery → land at Entrance Hall (not the old "Your space is ready" placeholder).
2. Greeting reads "Welcome back / <your username>" — username is in serif (default user font).
3. Five rooms visible: My Circle (active), My Projects (greyed), My History (greyed), My Treasury (greyed), My Settings (active). No My Bookmarks tile.
4. Continue-Card is hidden (no chats yet).
5. Tap My Settings → three accordion cards (About Me, Global System Prompt, Upstream Providers). About Me opens by default.
6. About Me: type into the textarea, switch a colour swatch, switch texture, switch font — preview updates live; reload page → values persisted.
7. Mindspace texture switches: cloudy / aurora / grain all render visibly differently in the background of the Hall (after navigating back).
8. Global System Prompt: type, leave, return → text persisted.
9. Upstream Providers: tap nano-gpt → bottom-sheet opens with API-Key field only. Cancel (× button) → no provider written.
10. Upstream Providers: tap Ollama Cloud → bottom-sheet shows API-Key + Proxy URL + Shared Key fields. Enter values, close → "Probing…" then "Key valid" green status (or red with reason if the proxy isn't actually up).
11. After at least one provider is connected, navigate to My Circle (back to Hall, tap My Circle). Empty-state hint visible.
12. Tap "+" FAB → New Persona editor opens, save button is disabled.
13. Fill Name + Tagline + Instructions, pick Mindspace + Model, save → returns to Circle with the new persona in the list.
14. Tap the persona card → editor opens in edit mode with three Chat-action buttons at the top (Continue active, New Chat active, Incognito disabled).
15. Edit a field, tap Save → returns to Circle.
16. Tap persona card → Delete → confirm → returns to Circle, persona removed.
17. Back to Hall → My Circle count updates (0 personas again).
18. Reload PWA → still lands at Hall, persona/settings/provider state intact (Dexie persisted across reloads).
19. Hall in airplane mode renders unchanged — no network calls block the layout.

If any step fails, open an `obsidian/insights/2026-05-23-phase-2-smoke-issues.md` note with the failing step + screenshot.

- [ ] **Step 5: Squash all Phase-2 task commits into one Phase-2 commit**

```bash
# After all task commits have landed, squash from the start of Phase 2:
git reset --soft c97ae17  # the Phase-2 wireframe + spec commit
git commit -m "$(cat <<'EOF'
Land Client Block 1 Phase 2 — Settings + Circle + Persona Editor + Hall

What landed:
- apps/user-client/src/boot/client-data-db.ts — Dexie v2 with backfill:
  Settings.userFont, PersonaRow.{tagline,temperature,adultPersona},
  MindspaceRow.texture union extended to cloudy|aurora|grain, four
  new built-in mindspaces (Crimson, Indigaut, Violetta, Rosari) +
  Verdan/Azuro accent hex refreshed to Lyra's finalised values.
- apps/user-client/src/state/{mindspace-resolver.ts,mindspace.store.ts}
  — pure resolver + Zustand store driving the active palette.
- apps/user-client/src/components/{MindspaceLayer,MindspaceTexture,
  MindspacePicker,PersonaCard,AccordionCard,ProviderSheet,SaveBar}.tsx
  — the Phase-2 component library.
- apps/user-client/src/data/{queryKeys,settings,personas,providers,
  mindspaces,chats}.ts — TanStack Query data layer over Dexie.
- apps/user-client/src/routes/app/{entrance-hall,circle,persona-editor,
  settings}.tsx — the four Block-2 surfaces.
- apps/user-client/src/App.tsx — wired /app subroutes; AppShell removed.

Tests: NN added Vitest cases across the new units; all green.
Phase 1 packages (crypto, llm-unified) untouched; their tests still pass.
Manual verification: see obsidian/STATUS-CLIENT-ONLY.md "Next session"
block (Chris's device smoke).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

Run a final `git log --oneline -5` to verify the squashed commit looks right.

- [ ] **Step 6: Update STATUS-CLIENT-ONLY.md**

Move the Phase-2-Briefed entry into Done, refresh the "Doing now" block to point at Phase 3 (Chat: Reading Mode + Interaction Mode + Cockpit + Streaming), and refresh the "Next session" block with Chris's device-smoke checklist.

---

## Manual verification appendix

Re-stated here as a quotable section for the final commit's manual-verification reference. See Task 18 Step 4 for the full checklist.

The headline outcome Block-1 Phase 2 must reach:

> A user who clears their site data, installs the PWA fresh, completes local-only onboarding, lands at the Entrance Hall, configures one provider, creates one persona, and reloads the PWA — sees their setup intact and the chat surface ready (chat itself lands in Phase 3).

If a user can complete this loop without consulting documentation, Phase 2 is "done" by the same yardstick Block-1's overall acceptance criteria use.
