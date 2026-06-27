# My Circle + Persona Editor Makeover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild My Circle (a `cs-row` list) and the persona editor (a focused create step + a Persona Hub + eight always-save sub-pages) in the established design language, retiring the old accordion chrome.

**Architecture:** Flat sibling routes under `ProtectedRoute` (the makeover pattern). The monolithic `persona-editor.tsx` is replaced by `routes/app/persona/{create,hub,instructions,roleplay,model-behaviour,integrations,knowledge,font-voice,mindspace}.tsx`; `persona-memory.tsx` is reskinned in place. **Always-save**: each sub-page reads the persona via `usePersona` and writes immediately via `useUpdatePersona`; the create step is the lone explicit action. Pure helpers (validity, meta lines) live in `lib/persona-hub.ts` with unit tests.

**Tech Stack:** React 18 + Vite, TypeScript strict, Tailwind v4, TanStack Query, Dexie, Vitest + RTL. Design-language primitives: `PageScaffold`/`PageBar`, `NavTile`, `ListRow`/`cs-row`, `OverflowMenu`, `ConfirmDialog`, the picker family (`ModelSlotPicker`, `MindspacePicker`, `VoicePicker`), `InlineEditRow`/`InlineEditTextarea`, `useHelp`/`ReadingOverlay`.

**Spec:** `superpowers/specs/2026-06-27-my-circle-and-persona-editor-makeover-design.md`

**Conventions for every task:** British English everywhere. SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on new files. Verify with `pnpm --filter @chatsundere/user-client test <file>` for unit/RTL and `pnpm typecheck --force` for the TS pipeline. Commit after each task with a free-form imperative subject + `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Subagents never merge, push, or switch branches.

---

## Task 1: `OverflowMenu` separator support (primitive)

The My Circle `⋯` menu needs a divider between the chat group and the manage group. `OverflowMenu` has no separator today (spec §2.2).

**Files:**
- Modify: `apps/user-client/src/components/ui/OverflowMenu.tsx`
- Modify: `apps/user-client/src/components/ui/ListRow.tsx` (widen the `overflow` prop type)
- Modify: `apps/user-client/src/index.css` (add `.cs-overflow-sep`)
- Test: `apps/user-client/src/components/ui/OverflowMenu.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
// OverflowMenu.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { OverflowMenu } from './OverflowMenu.js';

test('renders a non-interactive separator between item groups', () => {
  const onA = vi.fn();
  render(
    <OverflowMenu
      items={[
        { label: 'New chat', onSelect: onA },
        { separator: true },
        { label: 'Delete', tone: 'destructive', onSelect: vi.fn() },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  // The separator renders but is not a menuitem.
  expect(screen.getByTestId('cs-overflow-sep')).toBeInTheDocument();
  expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  fireEvent.click(screen.getByText('New chat'));
  expect(onA).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run it to confirm it fails** — `pnpm --filter @chatsundere/user-client test OverflowMenu` → FAIL (separator not rendered).

- [ ] **Step 3: Implement**

In `OverflowMenu.tsx`, add and export a separator type and widen `items`:

```tsx
export interface OverflowSeparator {
  separator: true;
}
export type OverflowEntry = OverflowItem | OverflowSeparator;

function isSeparator(e: OverflowEntry): e is OverflowSeparator {
  return 'separator' in e && e.separator === true;
}
```

Change `OverflowMenuProps.items` to `items: OverflowEntry[]`. In the `.map`, branch on `isSeparator`:

```tsx
{items.map((item, i) => {
  if (isSeparator(item)) {
    return (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: caller-ordered list
        key={i}
        className="cs-overflow-sep"
        data-testid="cs-overflow-sep"
        role="separator"
        aria-hidden="true"
      />
    );
  }
  // …existing button rendering unchanged…
})}
```

In `ListRow.tsx` widen the prop: `overflow?: OverflowEntry[];` and import `OverflowEntry` alongside `OverflowItem`. The `overflow.length > 0` guard is unchanged.

In `index.css`, near the other `.cs-overflow-*` rules, add:

```css
.cs-overflow-sep {
  height: 1px;
  margin: 4px 0;
  background: color-mix(in srgb, var(--color-paper-soft) 22%, transparent);
}
```

- [ ] **Step 4: Run tests** → PASS. Also `pnpm typecheck --force` clean.

- [ ] **Step 5: Commit** — `Add separator support to OverflowMenu`

---

## Task 2: Pure helpers — `lib/persona-hub.ts`

Validity + tile meta-line builders, pure and unit-tested, consumed by the hub and several sub-pages.

**Files:**
- Create: `apps/user-client/src/lib/persona-hub.ts`
- Test: `apps/user-client/src/lib/persona-hub.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import type { PersonaRow } from '../boot/client-data-db.js';
import {
  fontVoiceMeta, instructionsMeta, integrationsMeta, isPersonaIncomplete,
  knowledgeMeta, memoryMeta, missingRequirement, mindspaceMeta,
  modelBehaviourMeta, roleplayMeta,
} from './persona-hub.js';

const base = {
  instructions: 'be kind', canonicalId: 'c', providerId: 'p', modelId: 'm',
  chatsundereTonality: true, adultPersona: false, roleplay: false,
  narration: 'first', greetingEnabled: false, temperature: 0.85,
  askExpertDefault: false, mcpOverrides: {}, libraryIds: [], useMemory: true,
  font: 'serif', voice: null, mindspaceId: null, textureOverride: null,
} as unknown as PersonaRow;

test('isPersonaIncomplete / missingRequirement', () => {
  expect(isPersonaIncomplete(base)).toBe(false);
  expect(missingRequirement(base)).toBeNull();
  expect(missingRequirement({ ...base, modelId: '' })).toBe('model');
  expect(missingRequirement({ ...base, instructions: '  ' })).toBe('instructions');
  // model is checked before instructions
  expect(missingRequirement({ ...base, modelId: '', instructions: '' })).toBe('model');
});

test('meta lines', () => {
  expect(instructionsMeta(base)).toBe('Chatsundere voice');
  expect(instructionsMeta({ ...base, adultPersona: true })).toBe('Chatsundere voice · Adult');
  expect(instructionsMeta({ ...base, chatsundereTonality: false })).toBe('Plain voice');
  expect(instructionsMeta({ ...base, instructions: '' })).toBe('Needs setup');
  expect(roleplayMeta(base)).toBe('Off');
  expect(roleplayMeta({ ...base, roleplay: true })).toBe('First person');
  expect(roleplayMeta({ ...base, roleplay: true, narration: 'third', greetingEnabled: true }))
    .toBe('Third person · Greeting');
  expect(modelBehaviourMeta(base)).toBe('Temp 0.85');
  expect(modelBehaviourMeta({ ...base, askExpertDefault: true })).toBe('Temp 0.85 · Expert');
  expect(integrationsMeta(base)).toBe('Default tools');
  expect(integrationsMeta({ ...base, mcpOverrides: { s1: {} } as never })).toBe('1 override');
  expect(knowledgeMeta(base)).toBe('No libraries');
  expect(knowledgeMeta({ ...base, libraryIds: ['a', 'b'] })).toBe('2 libraries');
  expect(memoryMeta(base)).toBe('Remembering');
  expect(memoryMeta({ ...base, useMemory: false })).toBe('Off');
  expect(fontVoiceMeta(base)).toBe('Serif');
  expect(fontVoiceMeta({ ...base, voice: 'aria' })).toBe('Serif · Voice');
  expect(mindspaceMeta(base, [])).toBe('User default');
  expect(mindspaceMeta({ ...base, mindspaceId: 'x' },
    [{ id: 'x', displayName: 'Moonlit' }] as never)).toBe('Moonlit');
});
```

- [ ] **Step 2: Run it → FAIL** (module missing).

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';

/** A persona that cannot yet chat: missing instructions or a complete model choice. */
export function isPersonaIncomplete(p: PersonaRow): boolean {
  return missingRequirement(p) !== null;
}

/** The first unmet requirement, model before instructions, or null when complete. */
export function missingRequirement(p: PersonaRow): 'model' | 'instructions' | null {
  if (!p.canonicalId || !p.providerId || !p.modelId) return 'model';
  if (!p.instructions.trim()) return 'instructions';
  return null;
}

export function instructionsMeta(p: PersonaRow): string {
  if (!p.instructions.trim()) return 'Needs setup';
  const voice = p.chatsundereTonality ? 'Chatsundere voice' : 'Plain voice';
  return p.adultPersona ? `${voice} · Adult` : voice;
}

export function roleplayMeta(p: PersonaRow): string {
  if (!p.roleplay) return 'Off';
  const person = p.narration === 'third' ? 'Third person' : 'First person';
  return p.greetingEnabled ? `${person} · Greeting` : person;
}

export function modelBehaviourMeta(p: PersonaRow): string {
  const temp = `Temp ${p.temperature.toFixed(2)}`;
  return p.askExpertDefault ? `${temp} · Expert` : temp;
}

export function integrationsMeta(p: PersonaRow): string {
  const n = Object.keys(p.mcpOverrides ?? {}).length;
  return n > 0 ? `${n} override${n === 1 ? '' : 's'}` : 'Default tools';
}

export function knowledgeMeta(p: PersonaRow): string {
  const n = (p.libraryIds ?? []).length;
  return n > 0 ? `${n} ${n === 1 ? 'library' : 'libraries'}` : 'No libraries';
}

export function memoryMeta(p: PersonaRow): string {
  return (p.useMemory ?? true) ? 'Remembering' : 'Off';
}

export function fontVoiceMeta(p: PersonaRow): string {
  const font = p.font.charAt(0).toUpperCase() + p.font.slice(1);
  return p.voice ? `${font} · Voice` : font;
}

export function mindspaceMeta(p: PersonaRow, mindspaces: MindspaceRow[]): string {
  if (!p.mindspaceId) return 'User default';
  return mindspaces.find((m) => m.id === p.mindspaceId)?.displayName ?? 'User default';
}
```

- [ ] **Step 4: Run tests → PASS**; `pnpm typecheck --force` clean.
- [ ] **Step 5: Commit** — `Add pure persona-hub validity and meta helpers`

---

## Task 3: Shared editing hook — `routes/app/persona/use-persona-editing.ts`

A small always-save binding reused by every sub-page: load the persona, expose an immediate `patch`.

**Files:**
- Create: `apps/user-client/src/routes/app/persona/use-persona-editing.ts`
- Test: `apps/user-client/src/routes/app/persona/use-persona-editing.test.tsx`

- [ ] **Step 1: Write the failing test** (RTL + a real `QueryClientProvider`; assert that calling `patch` invokes `useUpdatePersona`'s mutation against the DB). Use the existing test DB helpers (`getClientDataDb` is seeded in `src/test/` setup — mirror an existing persona-data test such as `data/personas.test.ts` for the harness).

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { usePersonaEditing } from './use-persona-editing.js';

test('patch persists immediately', async () => {
  const db = getClientDataDb();
  const id = 'p-edit';
  await db.personas.add({ /* …a minimal valid PersonaRow with id… */ } as never);
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePersonaEditing(id), { wrapper });
  await waitFor(() => expect(result.current.persona?.id).toBe(id));
  await act(() => result.current.patch({ temperature: 1.2 }));
  await waitFor(async () => expect((await db.personas.get(id))?.temperature).toBe(1.2));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback } from 'react';
import type { PersonaRow } from '../../../boot/client-data-db.js';
import { usePersona, useUpdatePersona } from '../../../data/personas.js';

/** Always-save editing binding for a single persona. `patch` writes to the DB
 *  immediately (no draft, no dirty flag) and the query cache invalidates. */
export function usePersonaEditing(id: string | null): {
  persona: PersonaRow | null | undefined;
  patch: (p: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>) => Promise<void>;
} {
  const query = usePersona(id);
  const update = useUpdatePersona();
  const patch = useCallback(
    async (p: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>) => {
      if (!id) return;
      await update.mutateAsync({ id, patch: p });
    },
    [id, update],
  );
  return { persona: query.data, patch };
}
```

- [ ] **Step 4: Run → PASS**; typecheck clean.
- [ ] **Step 5: Commit** — `Add always-save persona editing hook`

---

## Task 4: Persona create step — `routes/app/persona/create.tsx`

The focused first step (spec §3). Route `/app/persona/new`.

**Files:**
- Create: `apps/user-client/src/routes/app/persona/create.tsx`
- Create: `apps/user-client/src/content/help/persona.md` (hub + create help)
- Modify: `apps/user-client/src/content/help/index.ts` (add `persona` key)
- Modify: `apps/user-client/src/App.tsx` (repoint `/app/persona/new`)
- Test: `apps/user-client/src/routes/app/persona/create.test.tsx`

**Behaviour:**
- `PageScaffold` crumbs `[{label:'My Circle', to:'/app/circle'}, {label:'New persona'}]`, `back="/app/circle"`, `onHelp` from `useHelp('persona')`.
- Port from the current `persona-editor.tsx`: the `defaultDraft(...)` seed (lines 67–102), `AvatarField` (lines 116–206 — **move this component into a shared file**, see below), `ChatsuneImportControl` wiring + `onApplyImport` (lines 314–337) + the staged-write portion of `persistDraft` (lines 396–442: avatar write, `importChatsuneSessions`, `importChatsuneMemory`).
- Fields: import control (framed "Coming from Chatsune? Import a persona and its chats."), `AvatarField`, **name** (required), **tagline**, **model** via `ModelSlotPicker` (filter `'all'`, `configuredTemplateIds` via `usableTemplateIds(providers, !!settings.corsProxy)`, `onBrowseProviders` → `/app/settings`).
- A single **gold** "Create persona" button (`<Button tone=… gold>` — match the gold-button usage in the entrance hall / `ConfirmDialog`). Disabled until `name.trim()` is non-empty, tooltip "Give your persona a name".
- On create: `useCreatePersona().mutateAsync(draft)` → then run the staged writes against the new id (avatar, imported sessions, imported memory) → `navigate(\`/app/persona/\${row.id}\`)`.

**Shared `AvatarField`:** move the exported `AvatarField` + `PendingAvatar` type out of `persona-editor.tsx` into a new `apps/user-client/src/components/persona-editor/AvatarField.tsx` (verbatim), so both create and hub import it. Update the existing avatar test import path (`grep` for `AvatarField`).

- [ ] **Step 1: Write the failing test** — render `create.tsx` inside the app's test providers + a `MemoryRouter` at `/app/persona/new`; assert the Create button is disabled with an empty name, enabled after typing a name, and that clicking it adds a persona row to the DB and navigates (assert `useNavigate` mock called with `/app/persona/<id>`). Mirror the provider/router harness from an existing route test (e.g. `routes/app/settings/you.test.tsx`).

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** create.tsx + the AvatarField move + the `persona` help doc + index.ts key + the App.tsx repoint.
- [ ] **Step 4: Run → PASS**; `pnpm typecheck --force` clean (PersonaEditor still imported by `/app/persona/:id` — untouched here).
- [ ] **Step 5: Commit** — `Add focused persona create step`

---

## Task 5: Persona Hub — `routes/app/persona/hub.tsx`

The home page for an existing persona (spec §4). Route `/app/persona/:id`.

**Files:**
- Create: `apps/user-client/src/routes/app/persona/hub.tsx`
- Modify: `apps/user-client/src/App.tsx` (repoint `/app/persona/:id`)
- Test: `apps/user-client/src/routes/app/persona/hub.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)`, `usePersona`, `useChats`, `useMindspaces`, `useSettings`, `useProviders`, `useMcpServers`. Preserve the **mindspace store reset** effect (port from `persona-editor.tsx:272–280` — seed the store from this persona so chat/mindspace context is right).
- `PageScaffold` crumbs `[{label:'My Circle', to: returnPath}, {label: persona.name || 'Persona'}]`, `back={returnPath}`, help `useHelp('persona')`. `returnPath = search.get('return') || '/app/circle'` (spec §7).
- **Action row** (4 buttons, reuse the grid markup from `persona-editor.tsx:509–553`, restyled with `.cs-btn`): Continue, New Chat, New Incognito (disabled, reason "Coming soon — a chat that leaves nothing in memory"), History. Wire Continue/New-Chat/History exactly as today (`recentChatForThisPersona`, `onContinue`, `onNewChat`, History → `/app/history?personaId=:id`). **No** `await persistDraft()` needed (always-save).
- **Gold logic** (spec §4.1, affirmative-only): if `!isPersonaIncomplete(persona)` and a recent chat exists → gold on Continue; else if valid and no chat → gold on New Chat; if incomplete → **no gold**, and render **one calm sentence**: `"Add an instruction and pick a model, then ${name} can chat."` plus a "Needs setup" cue on the Model field / Instructions tile (drive the cue from `missingRequirement`).
- **Identity:** `AvatarField` (always-save: on pick→crop→`useSetPersonaAvatar`; on remove→`useRemovePersonaAvatar` immediately — no staging here), `InlineEditRow` for name (validate non-empty) and tagline, `ModelSlotPicker` for model (always-save via `patch`). Page-bar title in persona font+colour (port `titleStyle` from `persona-editor.tsx:482–484`).
- **The 8 `NavTile`s** (2-col grid), colours + order + meta from spec §4.3 using `lib/persona-hub.ts`:
  | tile | colour | to | meta |
  |---|---|---|---|
  | Instructions | pink | `instructions` | `instructionsMeta(p)` |
  | Roleplay | pink | `roleplay` | `roleplayMeta(p)` |
  | Model behaviour | blue | `model` | `modelBehaviourMeta(p)` |
  | Integrations | blue | `integrations` | `integrationsMeta(p)` |
  | Knowledge | green | `knowledge` | `knowledgeMeta(p)` |
  | Memory | green | `memory` | `memoryMeta(p)` |
  | Font & Voice | purple | `font-voice` | `fontVoiceMeta(p)` |
  | Mindspace | purple | `mindspace` | `mindspaceMeta(p, mindspaces)` |

  Each `to` is `\`/app/persona/\${id}/<seg>\``. Pick Lucide icons consistent with the old accordion glyphs' intent (e.g. `ScrollText`, `Drama`, `SlidersHorizontal`, `Plug`, `BookOpen`, `Brain`, `Type`, `Sparkles`). The Instructions tile shows the "Needs setup" cue when `missingRequirement(p) === 'instructions'`.
- **Bottom zone:** `ChatsuneImportControl` (`mode="edit"`, merge-into-existing — `onApply` writes immediately via `patch` + `importChatsuneSessions`/`importChatsuneMemory`, reusing the current logic but write-now), and a **disabled** Export control (`Button`/tile, disabledReason "Coming soon", quiet/low-weight). **No delete control.**

- [ ] **Step 1: Write the failing test** — render the hub for a seeded **complete** persona with a chat: assert Continue carries the gold marker and the 8 tiles render with their meta lines; then a seeded **incomplete** persona (empty instructions): assert no gold, the calm sentence is shown, and the Instructions tile shows the "Needs setup" cue. Assert there is **no** Delete control.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS**; typecheck clean.
- [ ] **Step 5: Commit** — `Add persona hub page`

---

## Task 6: Instructions sub-page — `routes/app/persona/instructions.tsx`

Route `/app/persona/:id/instructions` (spec §5.1).

**Files:**
- Create: `apps/user-client/src/routes/app/persona/instructions.tsx`
- Create: `apps/user-client/src/content/help/persona-instructions.md`
- Modify: `apps/user-client/src/content/help/index.ts`
- Modify: `apps/user-client/src/App.tsx`
- Test: `apps/user-client/src/routes/app/persona/instructions.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)`; `PageScaffold` crumbs `[My Circle → <name> → Instructions]`, `back` to `/app/persona/:id`, help `persona-instructions`.
- Two toggles at top — **Chatsundere tonality** and **Adult persona** (port the toggle markup + copy from `persona-editor.tsx:717–798`; `onClick` → `patch({chatsundereTonality})` / `patch({adultPersona})`).
- **Custom Instructions** — `AutoSizeTextarea` always-save (persist on blur; mirror `InlineEditTextarea`'s blur-flush; required cue when empty). Port copy from lines 674–688.
- **What the model knows about you** — the About-Me override (port lines 982–996): `AutoSizeTextarea`, placeholder = `settings.globalAboutMe || 'Tell this persona who you are…'`, value `aboutMeOverride ?? ''`, on blur `patch({ aboutMeOverride: v === '' ? null : v })`. Keep the "empty = global is used" note.

- [ ] **Step 1: Write the failing test** — render for a seeded persona; toggle Adult and assert the DB row flips; type instructions, blur, assert persisted.
- [ ] **Step 2–4** as the pattern.
- [ ] **Step 5: Commit** — `Add persona instructions sub-page`

---

## Task 7: Roleplay sub-page + greeting runtime gate — `routes/app/persona/roleplay.tsx`

Route `/app/persona/:id/roleplay` (spec §5.2). **Includes the Laura-HARD fix.**

**Files:**
- Create: `apps/user-client/src/routes/app/persona/roleplay.tsx`
- Create: `apps/user-client/src/content/help/persona-roleplay.md`
- Modify: `apps/user-client/src/content/help/index.ts`
- Modify: `apps/user-client/src/App.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (runtime gate, line ~194)
- Test: `apps/user-client/src/routes/app/persona/roleplay.test.tsx`
- Test: extend `apps/user-client/src/routes/app/chat/` opener-creation coverage (find the existing eager-create test via `grep openerPending` under `chat/`; if none, add one in `chat-page.test.tsx`).

**Behaviour:**
- `usePersonaEditing(id)`; `PageScaffold` crumbs `[… → Roleplay]`, help `persona-roleplay`.
- Roleplay **on/off** toggle. When on: **First / Third person** via `cs-segmented` (port the two-button group from `persona-editor.tsx:825–845`; persist `patch({narration})`).
- When roleplay **on**: the **Greeting** block unlocks — greeting toggle + greeting-rules `AutoSizeTextarea` (port lines 861–906), with the validation cue (greeting on + empty rules). When roleplay **off**: greeting controls are **disabled-with-reason** ("Enable Roleplay to set a greeting").
- **Runtime gate (Laura HARD):** in `chat-page.tsx`, change the eager-opener guard so the opener only fires when roleplay is also on:

```tsx
// was: if (!effectivePersona.greetingEnabled) return;
if (!(effectivePersona.roleplay && effectivePersona.greetingEnabled)) return;
```

- [ ] **Step 1: Write the failing tests** — (a) roleplay page: toggling roleplay on reveals the narration segmented control + greeting block; (b) **opener gate**: a persona with `greetingEnabled: true, roleplay: false` must **not** create an `openerPending` chat (assert `createChat` not called with `openerPending: true`), and `greetingEnabled: true, roleplay: true` **does**.
- [ ] **Step 2: Run → FAIL** (gate test fails against current code).
- [ ] **Step 3: Implement** the page + the one-line gate change.
- [ ] **Step 4: Run → PASS**; typecheck clean.
- [ ] **Step 5: Commit** — `Add persona roleplay sub-page; gate greeting opener on roleplay`

---

## Task 8: Model behaviour sub-page — `routes/app/persona/model-behaviour.tsx`

Route `/app/persona/:id/model` (spec §5.3).

**Files:**
- Create: `apps/user-client/src/routes/app/persona/model-behaviour.tsx`
- Create: `apps/user-client/src/content/help/persona-model.md`
- Modify: `apps/user-client/src/content/help/index.ts`, `App.tsx`
- Move: `ContextWindowControl` out of `persona-editor.tsx` into `apps/user-client/src/components/persona-editor/ContextWindowControl.tsx` (verbatim, exported) so it survives the editor's deletion.
- Test: `apps/user-client/src/routes/app/persona/model-behaviour.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)` + `useProviders` + `useSettings`; help `persona-model`.
- **Temperature** slider (port lines 692–715; `patch({temperature})`).
- **Context window** — resolve the offering: `const prov = providers.find(p=>p.id===persona.providerId); const off = prov && persona.modelId ? getOffering(prov.templateId, persona.modelId) : undefined;` then render `<ContextWindowControl offering={off} value={persona.contextWindow} onChange={(n)=>patch({contextWindow:n})}/>` when `off` (port lines 847–858). When no offering resolvable, show a calm "Pick a model on the hub to tune its context window." note.
- **Ask an expert by default** toggle (port lines 744–774; disabled-with-reason when `settings.expertModel == null`, "Choose a global expert model in Settings first.").

- [ ] **Step 1: Write the failing test** — slide temperature → persisted; expert toggle disabled when no `expertModel`. **Step 2–4** as pattern.
- [ ] **Step 5: Commit** — `Add persona model-behaviour sub-page`

---

## Task 9: Integrations sub-page — `routes/app/persona/integrations.tsx`

Route `/app/persona/:id/integrations` (spec §5.4).

**Files:**
- Create: `apps/user-client/src/routes/app/persona/integrations.tsx`
- Create: `apps/user-client/src/content/help/persona-integrations.md`
- Modify: `index.ts`, `App.tsx`
- Test: `apps/user-client/src/routes/app/persona/integrations.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)` + `useMcpServers`; help `persona-integrations`.
- Render `<McpOverrideSection servers={mcpServers.data ?? []} overrides={persona.mcpOverrides} onChange={(next)=>patch({mcpOverrides: next})}/>` (port lines 1025–1032). Keep the "tools" word in the help/intro (Laura SOFT). Frame for future non-MCP integrations.

- [ ] **Steps 1–4** as pattern (test: changing an override persists). **Step 5: Commit** — `Add persona integrations sub-page`

---

## Task 10: Knowledge sub-page — `routes/app/persona/knowledge.tsx`

Route `/app/persona/:id/knowledge` (spec §5.5).

**Files:**
- Create: `apps/user-client/src/routes/app/persona/knowledge.tsx`
- Create: `apps/user-client/src/content/help/persona-knowledge.md`
- Modify: `index.ts`, `App.tsx`
- Test: `apps/user-client/src/routes/app/persona/knowledge.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)`; help `persona-knowledge`.
- Render `<KnowledgeSection selected={persona.libraryIds} onChange={(ids)=>patch({libraryIds: ids})} adultPersona={persona.adultPersona}/>` (port lines 998–1013). Wrap in `PageScaffold`; the `KnowledgeSection` internals (the deferred sub-surface) are preserved — only the hosting chrome is the design language. No deeper restyle in this task beyond chrome.

- [ ] **Steps 1–4** (test: selecting a library persists). **Step 5: Commit** — `Add persona knowledge sub-page`

---

## Task 11: Font & Voice sub-page — `routes/app/persona/font-voice.tsx`

Route `/app/persona/:id/font-voice` (spec §5.7).

**Files:**
- Create: `apps/user-client/src/routes/app/persona/font-voice.tsx`
- Create: `apps/user-client/src/content/help/persona-font-voice.md`
- Modify: `index.ts`, `App.tsx`
- Test: `apps/user-client/src/routes/app/persona/font-voice.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)`; help `persona-font-voice`. One-time `resolveTtsTransport()` probe for `hasTtsProvider` (port lines 265–270).
- **Font** selector as `cs-segmented` (Sans / Serif / Cursive, each shown in its own face — port the face classes from lines 909–932; `patch({font})`). Keep the "font is the persona's visual voice" note.
- `TtsModerationNotice` + **Voice** `VoicePicker` (`patch({voice})`), and the **Narrator voice** `VoicePicker` when `persona.roleplay` (`patch({narratorVoice})`), both disabled-with-hint when `hasTtsProvider === false` (port lines 934–957).

- [ ] **Steps 1–4** (test: pick a font persists; narrator voice hidden when roleplay off). **Step 5: Commit** — `Add persona font & voice sub-page`

---

## Task 12: Mindspace sub-page — `routes/app/persona/mindspace.tsx`

Route `/app/persona/:id/mindspace` (spec §5.8).

**Files:**
- Create: `apps/user-client/src/routes/app/persona/mindspace.tsx`
- Create: `apps/user-client/src/content/help/persona-mindspace.md`
- Modify: `index.ts`, `App.tsx`
- Test: `apps/user-client/src/routes/app/persona/mindspace.test.tsx`

**Behaviour:**
- `usePersonaEditing(id)` + `useMindspaces` + `useSettings`; help `persona-mindspace`.
- Render `MindspacePicker` (port lines 960–980): `selectedMindspaceId={persona.mindspaceId}`, `selectedTexture={persona.textureOverride ?? settings.userTexture ?? 'cloudy'}`, `previewName={persona.name || 'Persona'}`, `allowUserDefault`, `hideFont`. On mindspace change: `patch({ mindspaceId: id, colour: ms?.palette.accent ?? persona.colour })` (preserve the colour linkage). On texture change: `patch({ textureOverride: t })`. Preserve the mindspace-store seed effect so the live preview is correct.

- [ ] **Steps 1–4** (test: selecting a mindspace persists id + colour). **Step 5: Commit** — `Add persona mindspace sub-page`

---

## Task 13: Memory page makeover — `routes/app/persona-memory.tsx`

Reskin in place + fold in the per-persona settings (spec §5.6).

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-memory.tsx`
- Modify: `apps/user-client/src/content/help/index.ts` (add `persona-memory` key) + create `persona-memory.md` (or extend the existing memory help if present — `grep` first)
- Test: update `apps/user-client/src/routes/app/persona-memory.test.tsx` (if present) or add coverage for the folded-in toggle.

**Behaviour:**
- Wrap the existing surface in `PageScaffold` (crumbs `[My Circle → <name> → Memory]`, `back` to `/app/persona/:id`, help `persona-memory`), replacing any bespoke topbar. **Preserve** the `?chat=` deep-link path and all journal-triage / body / versions logic verbatim.
- Fold in the per-persona settings at the top (porting `MemorySection`'s knobs): **Remembering on/off** toggle (`patch({useMemory})`) + **memory instructions** field (`patch({memoryInstructions})`). Label the toggle persona-global: **"Applies to all chats with <name>"** (Laura SOFT). Use `usePersonaEditing(id)` for these writes; keep the chat-scoped actions (Learn / Consolidate) exactly as today.

- [ ] **Step 1: Write the failing test** — assert the persona-global toggle renders with the scope label and flips `useMemory` in the DB; assert the `?chat=` path still resolves.
- [ ] **Step 2–4** as pattern.
- [ ] **Step 5: Commit** — `Reskin persona memory page; fold in persona-global settings`

---

## Task 14: My Circle rebuild — `routes/app/circle.tsx`

Now that the hub + create + overflow-separator exist, rebuild the list (spec §2).

**Files:**
- Modify (rewrite): `apps/user-client/src/routes/app/circle.tsx`
- Create: `apps/user-client/src/content/help/circle.md`
- Modify: `apps/user-client/src/content/help/index.ts` (add `circle` key)
- Test: `apps/user-client/src/routes/app/circle.test.tsx`

**Behaviour:**
- `PageScaffold` crumbs `[{label:'My Circle'}]`, `back="/app"`, help `useHelp('circle')`. Preserve the mindspace-store reset effect (port `circle.tsx:35–46`), `useFilteredPersonas`, `compareByLastInteraction`, `lastChatByPersona` (port 56–65), and the **no-leak empty state** (identical copy whether empty or filtered — port 77–84) — but in the new chrome.
- A single **`＋ New persona`** affordance at the top → `/app/persona/new`.
- Each persona renders as a `ListRow`:
  - `leading`: `PersonaAvatar` (size 40) + `StreamingOrb` (mirror the My History `history-avatar` wrapper).
  - `title`: persona name (apply persona colour + font via inline style on a wrapper, as My History does with `cs-row-title`); `subtitle`: `persona.tagline || persona.instructions.slice(0,60)`.
  - `trailing`: NSFW `Badge` (`tone="danger"`, adult only) **and** the visible chat button (label `Continue` if a chat exists else `New Chat`; disabled when provider missing, with the `Provider missing` cue routing to `/app/settings/providers`).
  - `overflow` (with the new separator):
    ```ts
    [
      { label: 'New chat', onSelect: () => navigate(`/app/chat/new?personaId=${p.id}`) },
      { label: 'New incognito chat', disabled: true,
        disabledReason: 'Coming soon — a chat that leaves nothing in memory' },
      { label: 'Continue', disabled: !lastChatId,
        onSelect: () => lastChatId && navigate(`/app/chat/${lastChatId}`) },
      { separator: true },
      { label: 'Go to persona', onSelect: () => navigate(`/app/persona/${p.id}`) },
      { label: 'Delete…', tone: 'destructive', onSelect: () => setConfirmDelete(p) },
    ]
    ```
  - Row-body tap (`onOpen`) → `/app/persona/${p.id}`.
- Delete: a single `ConfirmDialog` (`destructive`) driven by `confirmDelete` state — title `Delete ${name}?`, body "All chats with this persona will be lost.", confirm → `useDeletePersona().mutateAsync(id)` then clear state (the row vanishes via query invalidation).
- Drop the old FAB and `PersonaCard` import.

- [ ] **Step 1: Write the failing test** — render with seeded personas (one with a chat, one without, one provider-missing): assert the visible button label per row, the overflow menu contains the divided groups, the provider-missing button is disabled, and that confirming Delete removes the persona. Assert the no-leak empty state copy.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS**; typecheck clean.
- [ ] **Step 5: Commit** — `Rebuild My Circle in the design language`

---

## Task 15: Retire old chrome + final sweep

**Files:**
- Delete: `apps/user-client/src/routes/app/persona-editor.tsx`
- Delete: `apps/user-client/src/components/EditorTopbar.tsx`, `EditorSticky.tsx`, `AccordionCard.tsx`, `PersonaCard.tsx`
- Delete: `apps/user-client/src/components/persona-editor/MemorySection.tsx` (its knobs now live on the memory page)
- Modify: `apps/user-client/src/index.css` (remove dead `.editor-sticky*`, `.accordion-*`, `.persona-card*` rules)
- Modify: any leftover imports/tests referencing the deleted files.

- [ ] **Step 1: Grep for every consumer** — `rg -l "EditorTopbar|EditorSticky|AccordionCard|PersonaCard|MemorySection|persona-editor"` (excluding the new persona folder). Expected only the deletions themselves + stale tests.
- [ ] **Step 2: Delete the files + dead CSS; fix/remove orphaned tests** (e.g. the old `persona-editor` accordion tests; keep any avatar test, now pointing at the moved `AvatarField`).
- [ ] **Step 3: Verify** — `pnpm typecheck --force` (14/14, 0 errors), `pnpm --filter @chatsundere/user-client test` (full suite at the established Node-localStorage baseline), `pnpm --filter @chatsundere/user-client build`.
- [ ] **Step 4: Commit** — `Retire pre-makeover persona editor chrome`

---

## Final gates (before squash — not a task, the orchestrator's checklist)

- `pnpm typecheck --force` clean; full user-client vitest at baseline; production build green; Biome clean.
- **Laura pre-squash pass** on the built diff (verify the spec-pass intents held — affirmative-only gold, the calm incomplete sentence, the persona-global memory label, the greeting runtime gate, the provider-missing route).
- **opus whole-branch review** before squash.
- Not a Larissa path (client-only). Update `obsidian/STATUS-CLIENT-ONLY.md`.

---

## Self-review notes (author)

- **Spec coverage:** My Circle §2 → T1 (separator), T14. Create §3 → T4. Hub §4 (action row, gold, identity, 8 tiles, import/export, no-delete) → T5 (+ T2 helpers). Sub-pages §5.1–5.8 → T6–T13. Always-save §6 → T3 + each page. Routing/`?return=` §7 → per-page App.tsx edits + T5. Retire §8 → T15. Help §9 → per-page docs. Testing §10 → per-task tests + final gates. Laura HARD (greeting gate) → T7. Laura softs → folded into T5 (gold + sentence + provider route), T13 (memory label), T14 (incognito reason + provider route), T5/T4 (quiet Export).
- **Type consistency:** `patch` signature identical across T3 and all consumers; `OverflowEntry` introduced in T1 and used in T14; `missingRequirement`/meta names match T2 ↔ T5.
- **Ordering:** T1–T3 are foundations; T4–T5 stand up the new persona surfaces (PersonaEditor still routes `/:id`-adjacent pages until repointed in T5); T6–T13 add sub-pages (each wires its own route, build stays green because PersonaEditor file persists until T15); T14 rebuilds Circle (needs T1 separator + T4/T5 routes); T15 deletes the now-orphaned files.
