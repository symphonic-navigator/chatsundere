# Context Pre-Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user prime a fresh chat with a saved, simulated conversation ("template") before sending their first real message — authored/managed in a new Treasury "Templates" section, applied from an empty chat, and creatable by exporting a conversation-so-far.

**Architecture:** A new global Dexie table `seedTemplates` (optional greeting + strictly-alternating user-first body). Templates materialise into a chat as `kind: 'seed'` `MessageRow`s — body turns go on the wire as real `user`/`assistant` turns (inverse of openers, which are wire-excluded); a leading greeting reuses the opener's system-prompt echo. Authoring is a Treasury list→detail page tree mirroring My Knowledge; applying is an in-empty-chat `PickerOverlay`; export is a message-overflow action.

**Tech Stack:** TypeScript (strict), React 18 + Vite, Dexie, TanStack Query (no `useLiveQuery` in this project — invalidate explicitly), `@chatsundere/llm-unified` for the prompt builder, Vitest + RTL, the `components/ui/` primitive library (`PageScaffold`, `PickerOverlay`, `OverflowMenu`, `ConfirmDialog`, `InlineEditTextarea`).

Spec: [`../specs/2026-06-29-context-pre-seeding-design.md`](../specs/2026-06-29-context-pre-seeding-design.md).

## Global Constraints

- **British English** in every artefact — code, comments, copy, tests, commits (CLAUDE.md §3/§7).
- **Mobile-first 380 px**; desktop is constrained-width. Single `lg` breakpoint.
- **TypeScript strict**: `noUncheckedIndexedAccess`, no `any` without an inline justification, no `!` (Biome bans it — the commit gate runs Biome, not tsc).
- **No drag-and-drop** in user-facing UI (CLAUDE.md §11) — body reorder is ↑/↓ buttons.
- **Disabled over hidden**; **constructive error handling** (every failure names the next step).
- **No `useLiveQuery`** — background/data writes refresh the UI via explicit `invalidateQueries`.
- **Gate before any commit you call done:** `pnpm typecheck --force` (covers tests; Turbo caches it — use `--force`) **and** `pnpm --filter @chatsundere/user-client test`. Full user-client vitest baseline is **8 Node-localStorage failures** — a 9th means you broke something (or hit the known stream-manager parallel-load flake; re-run isolated to confirm).
- Tests live under `apps/user-client/tests/**` mirroring `src/**`.
- **This is NOT a Larissa path** (client-only; no `apps/auth-service|sync-service|proxy-service`, no `packages/crypto`). It **IS** a Laura path — a **pre-squash Laura pass is required** before squashing (her two firm conditions: §Apply 380 px layout shown with the affordance; first-send transition is a visible lock, not a silent vanish).

---

## ⚠️ Execution preconditions (read first — this plan was authored deferred)

1. **Re-anchor before you start.** This plan was written on 2026-06-29 while two other
   features were in flight. Line numbers and possibly file shapes will have moved. For
   every `Modify` target, re-confirm the anchor with `rg` against the current tree
   before editing. The *intent* and *interfaces* below are stable; the *line numbers*
   are not.

2. **Dexie version is assigned at execution time, NOT pinned here.** At authoring time
   the DB is at **v30**. Take the **next free version** after the parallel features have
   landed ([[project_parallel_feature_dexie_version_ownership]]). A bump breaks ~two
   dozen hard-coded `expect(db.verno).toBe(N)` assertions — the verno sweep is **part of
   Task 1**, not a follow-up ([[project_dexie_bump_breaks_verno_assertions]]). Verify no
   version-number collision with the parallel features before the full gate.

3. **Restart `pnpm dev` after touching `packages/*`** if you probe in the browser — Vite
   HMR ignores package edits ([[project_catalogue_changes_need_dev_restart]]). This plan
   stays inside `apps/user-client`, so this is unlikely to bite.

---

## File structure

**Create:**
- `apps/user-client/src/data/seed-templates.ts` — `SeedTemplateRow`/`SeedTurn` types + CRUD hooks.
- `apps/user-client/src/lib/seed-template.ts` — pure logic: body invariant, role-by-position, export capture/mapping.
- `apps/user-client/src/routes/app/treasury/templates.tsx` — template list (Level 1).
- `apps/user-client/src/routes/app/treasury/template.tsx` — template detail/editor (Level 2, create + edit).
- `apps/user-client/src/components/chat/SeedTemplatePicker.tsx` — the apply overlay.
- `apps/user-client/src/lib/seed-materialise.ts` — template → `MessageRow[]` (`kind: 'seed'`) + greeting handling.
- Test files mirroring each under `apps/user-client/tests/**`.

**Modify:**
- `apps/user-client/src/boot/client-data-db.ts` — `MessageRow.kind` → `'opener' | 'seed'`; new `seedTemplates` store + version bump.
- `apps/user-client/src/lib/content-blocks.ts` — `isContextMessage` includes seeds (excludes seed greeting).
- `apps/user-client/src/lib/stream-engine.ts` — `resolveOpenerContext` recognises a seed greeting.
- `apps/user-client/src/App.tsx` — register the three template routes.
- `apps/user-client/src/routes/app/treasury.tsx` — add the "Templates" entry into Treasury.
- `apps/user-client/src/components/chat/MessageControls.tsx` (+ `MessageBlock.tsx`) — "Save as template" in the overflow.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — the empty-chat affordance, materialisation, first-send lock, opener suppression.
- The `db.verno` assertion sites (sweep — find with `rg "verno\).toBe"`).

---

## Task 1: Data layer — `SeedTemplateRow` table, types, version bump, CRUD

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/src/data/seed-templates.ts`
- Test: `apps/user-client/tests/data/seed-templates.test.ts`
- Modify (sweep): all `expect(db.verno).toBe(N)` sites.

**Interfaces:**
- Produces:
  ```ts
  export interface SeedTurn { role: 'user' | 'persona'; text: string }
  export interface SeedTemplateRow {
    id: string; name: string; description: string; nsfw: boolean;
    greeting: string | null; body: SeedTurn[]; createdAt: number; updatedAt: number;
  }
  export function useSeedTemplates(): UseQueryResult<SeedTemplateRow[]>   // all, newest first
  export function useSeedTemplate(id: string | undefined): UseQueryResult<SeedTemplateRow | undefined>
  export function useCreateSeedTemplate(): // returns mutation -> new id
  export function useUpdateSeedTemplate(): // patch by id
  export function useDeleteSeedTemplate(): // by id
  ```
  `body`/`greeting` are non-indexed JSON columns (like `contentBlocks`). Store schema indexes `id, createdAt, nsfw`.

- [ ] **Step 1: Write the failing test** — `tests/data/seed-templates.test.ts`. Use the project's existing Dexie test harness (copy the import/reset pattern from `tests/data/knowledge.test.ts`). Cover: create returns an id and persists all fields; list is newest-first; update patches + bumps `updatedAt`; delete removes; nsfw filter is a plain field read (filtering itself is the consumer's job).

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/boot/client-data-db.js';
// follow knowledge.test.ts for db reset between tests

describe('seedTemplates CRUD', () => {
  beforeEach(async () => { await db.seedTemplates.clear(); });

  it('creates and reads back a template with greeting + body', async () => {
    const id = crypto.randomUUID();
    await db.seedTemplates.add({
      id, name: 'Mid-thread primer', description: '', nsfw: false,
      greeting: 'Oh, you again — good.', 
      body: [{ role: 'user', text: 'hey' }, { role: 'persona', text: 'hey yourself' }],
      createdAt: 1, updatedAt: 1,
    });
    const row = await db.seedTemplates.get(id);
    expect(row?.greeting).toBe('Oh, you again — good.');
    expect(row?.body).toHaveLength(2);
    expect(row?.body[0]?.role).toBe('user');
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @chatsundere/user-client test seed-templates` → FAIL (`db.seedTemplates` undefined).

- [ ] **Step 3: Add the type + store + version bump** in `client-data-db.ts`:
  - Extend `MessageRow.kind` to `kind?: 'opener' | 'seed'` and add `seedRole?: 'greeting' | 'body'` (both used in later tasks; settle the schema now). Both are non-indexed JSON fields — no migration, no index change.
  - Add the `SeedTurn`/`SeedTemplateRow` interfaces.
  - Add `seedTemplates!: Table<SeedTemplateRow, string>;` to the class.
  - Add a **new version** (next free — see preconditions; example shows `N`):
    ```ts
    this.version(N).stores({ seedTemplates: 'id, createdAt, nsfw' });
    ```
    No `upgrade` callback needed (new empty table). Keep all prior `version(...)` calls intact.

- [ ] **Step 4: Write the CRUD hooks** in `data/seed-templates.ts`, following `data/knowledge.ts` conventions exactly (TanStack Query keys, `invalidateQueries` on mutation, `crypto.randomUUID()`, `Date.now()` for timestamps). Newest-first via `.orderBy('createdAt').reverse()`.

- [ ] **Step 5: Run the verno sweep.** `rg "verno\)\.toBe\(" apps/user-client/tests` — update every asserted number to `N`. (This is why the bump is its own task.)

- [ ] **Step 6: Run tests + typecheck**
  - `pnpm --filter @chatsundere/user-client test seed-templates` → PASS
  - `pnpm typecheck --force` → green
  - Full user-client vitest → only the 8-baseline failures (verno sweep complete).

- [ ] **Step 7: Commit** — `git commit -m "Add seedTemplates Dexie table, types and CRUD hooks"`

---

## Task 2: Pure logic — body invariant + role-by-position

**Files:**
- Create: `apps/user-client/src/lib/seed-template.ts`
- Test: `apps/user-client/tests/lib/seed-template.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Role implied by 0-based body position: even = user, odd = persona. */
  export function roleAt(index: number): 'user' | 'persona'
  /** Re-derive every turn's role from its position (used after insert/delete/reorder). */
  export function normaliseBody(turns: { text: string }[]): SeedTurn[]
  /** True when body alternates user-first with no empty turns. */
  export function isValidBody(body: SeedTurn[]): boolean
  /** True when body ends on a persona turn (so the real user message follows cleanly). */
  export function endsOnPersona(body: SeedTurn[]): boolean
  /** Applyable = (greeting non-empty) OR (body non-empty & valid). */
  export function isApplyable(t: Pick<SeedTemplateRow, 'greeting' | 'body'>): boolean
  ```

- [ ] **Step 1: Write the failing tests** — cover `roleAt(0)==='user'`, `roleAt(1)==='persona'`; `normaliseBody` re-roles after a middle delete; `isValidBody` rejects empty-text turns and accepts a clean alternation; `endsOnPersona`; `isApplyable` true for greeting-only, false for fully empty.

```ts
import { roleAt, normaliseBody, isValidBody, endsOnPersona, isApplyable } from '../../src/lib/seed-template.js';

it('derives role by position', () => {
  expect(roleAt(0)).toBe('user'); expect(roleAt(1)).toBe('persona');
});
it('re-roles after a middle deletion', () => {
  const out = normaliseBody([{ text: 'a' }, { text: 'c' }]); // b was deleted
  expect(out.map(t => t.role)).toEqual(['user', 'persona']);
});
it('greeting-only template is applyable', () => {
  expect(isApplyable({ greeting: 'hi', body: [] })).toBe(true);
  expect(isApplyable({ greeting: null, body: [] })).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @chatsundere/user-client test seed-template` → FAIL.

- [ ] **Step 3: Implement** the five pure functions in `lib/seed-template.ts`. `roleAt` = `index % 2 === 0 ? 'user' : 'persona'`. `normaliseBody` maps with `roleAt(i)`. `isValidBody` = every turn text non-empty after trim **and** roles match `roleAt`. Keep it dependency-free.

- [ ] **Step 4: Run, verify pass.** PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add seed-template body invariant helpers"`

---

## Task 3: Pure logic — export capture/mapping (conversation → template)

**Files:**
- Modify: `apps/user-client/src/lib/seed-template.ts`
- Test: extend `apps/user-client/tests/lib/seed-template.test.ts`

**Interfaces:**
- Consumes: `MessageRow`, `flattenAnswerText` from `lib/content-blocks.ts` (the canonical text extractor — do not re-implement the `filter(type==='text').map.join` pattern).
- Produces:
  ```ts
  export interface ExportInput { messages: MessageRow[]; uptoMessageId: string; sourceNsfw: boolean; }
  export interface ExportResult { greeting: string | null; body: SeedTurn[]; nsfw: boolean; }
  /** Map a conversation prefix to a template. Opener -> greeting; real turns -> body;
   *  Tier-A plain text only (pills/reasoning/tools/attachments stripped via flattenAnswerText);
   *  NSFW monotonic (sourceNsfw -> true). */
  export function captureTemplate(input: ExportInput): ExportResult
  ```

- [ ] **Step 1: Write the failing tests** — prefix slicing stops at `uptoMessageId` inclusive; a leading `kind:'opener'` message becomes `greeting` and is NOT in `body`; user→persona turns become alternating body; reasoning/pill blocks are stripped to text; `nsfw` follows `sourceNsfw` (true wins). Include a case where the source chat was itself seeded (seed turns are plain `MessageRow`s by then and flatten in as ordinary turns).

```ts
it('maps opener to greeting and strips to plain text', () => {
  const msgs: MessageRow[] = [
    mkMsg('m1', 'persona', 'Hello darling', { kind: 'opener' }),
    mkMsg('m2', 'user', 'hi'),
    mkMsg('m3', 'persona', 'how are you', { reasoning: 'thinking...' }),
  ];
  const r = captureTemplate({ messages: msgs, uptoMessageId: 'm3', sourceNsfw: false });
  expect(r.greeting).toBe('Hello darling');
  expect(r.body).toEqual([{ role: 'user', text: 'hi' }, { role: 'persona', text: 'how are you' }]);
});
```
(`mkMsg` is a small local fixture builder — define it in the test.)

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement `captureTemplate`** — slice `messages` up to and including `uptoMessageId`; pull a leading `kind:'opener'` (or seed-greeting) off as `greeting`; map the rest through `flattenAnswerText` into `SeedTurn`s; drop `kind:'system'` rows; `nsfw = sourceNsfw`. Guard the alternation with `normaliseBody`.

- [ ] **Step 4: Run, verify pass.** PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add captureTemplate export mapping"`

---

## Task 4: Wire engine — seeds on the wire, greeting echoed

**Files:**
- Modify: `apps/user-client/src/lib/content-blocks.ts` (`isContextMessage`)
- Modify: `apps/user-client/src/lib/stream-engine.ts` (`resolveOpenerContext`)
- Test: `apps/user-client/tests/lib/stream-engine.test.ts` (extend) + `tests/lib/content-blocks.test.ts`

**Interfaces:**
- Consumes: `MessageRow.kind` now `'opener' | 'seed'`.
- Produces: behavioural contract — `isContextMessage` returns **true** for `kind:'seed'` non-greeting turns (they go on the wire) and **false** for the seed *greeting*; `resolveOpenerContext` returns the seed greeting's text (as well as a real opener's) for the system-prompt echo.

How is a "seed greeting" distinguished from a seed body turn? Via the `seedRole?: 'greeting' | 'body'` field added to `MessageRow` in Task 1. The seed greeting is the materialised assistant message with `kind:'seed'`, `role:'persona'`, `seedRole:'greeting'`; body turns carry `seedRole:'body'`. `isContextMessage` keys off `seedRole` to decide wire-inclusion.

- [ ] **Step 1: Write the failing tests**
  - `isContextMessage({kind:'seed', seedRole:'body', ...})` → true.
  - `isContextMessage({kind:'seed', seedRole:'greeting', ...})` → false.
  - `isContextMessage({kind:'opener', ...})` → false (unchanged).
  - A built wire array from `[seed-greeting, seed-user, seed-persona, real-user]` starts with `system` then `user` (seed), never `assistant` first; the greeting text appears in the system prompt via `resolveOpenerContext`.

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement** (`kind`/`seedRole` already on `MessageRow` from Task 1)
  - `isContextMessage`: keep excluding `kind:'opener'`; exclude `kind:'seed' && seedRole==='greeting'`; otherwise (incl. `seedRole:'body'`) include.
  - `resolveOpenerContext`: change `find(m => m.kind === 'opener')` to also match `m.kind === 'seed' && m.seedRole === 'greeting'`, returning its flattened text.

- [ ] **Step 4: Run, verify pass + full typecheck.** PASS; `pnpm typecheck --force` green.

- [ ] **Step 5: Commit** — `git commit -m "Include seed turns on the wire, echo seed greeting to system prompt"`

---

## Task 5: Treasury "Templates" list (Level 1)

**Files:**
- Create: `apps/user-client/src/routes/app/treasury/templates.tsx`
- Modify: `apps/user-client/src/App.tsx` (register routes), `apps/user-client/src/routes/app/treasury.tsx` (entry into the section)
- Test: `apps/user-client/tests/routes/treasury-templates.test.tsx`

**Interfaces:**
- Consumes: `useSeedTemplates` (Task 1), the global NSFW-filter hook (find it: `rg "nsfw" src/state src/data | rg -i "useNsfw|nsfwEnabled|filter"` — reuse the same hook My Knowledge's `useFilteredLibraries` uses), `PageScaffold`, `ListRow`/nav rows, `OverflowMenu`.
- Produces: route `/app/treasury/templates`; nav rows → `/app/treasury/templates/:id`; `+ Add` → `/new`.

- [ ] **Step 1: Write the failing RTL test** — renders the list with two templates (one nsfw), asserts: both shown in NSFW mode; the nsfw one hidden + (kept) a trailing **NSFW badge** safety cue on it in NSFW mode; a turn-count meta; `+ Add` navigates to `/app/treasury/templates/new`; empty-state copy when none. Mock the hooks.

- [ ] **Step 2: Run, verify fail.** FAIL (component missing).

- [ ] **Step 3: Implement `TreasuryTemplatesList`** — copy the shape of `routes/app/knowledge.tsx` (`KnowledgeList`): `PageScaffold` with `crumbs`/`back` to `/app/treasury`, `useHelp('treasury-templates')`, NSFW-filtered rows (pure-navigation), trailing NSFW badge + turn-count badge, single `+ Add`. Register the three routes in `App.tsx`:
  ```tsx
  <Route path="/app/treasury/templates" element={<TreasuryTemplatesList />} />
  <Route path="/app/treasury/templates/new" element={<TreasuryTemplatePage />} />
  <Route path="/app/treasury/templates/:templateId" element={<TreasuryTemplatePage />} />
  ```
  In `treasury.tsx`, add a single calm entry into the Templates section (a nav row/tile — match how Treasury currently surfaces its groupings; do **not** spend one of the 8 Entrance-Hall tiles).

- [ ] **Step 4: Author the help doc** `treasury-templates` (one paragraph: what a primer is, that you apply it from a new empty chat — the §6 signpost).

- [ ] **Step 5: Run, verify pass.** PASS.

- [ ] **Step 6: Commit** — `git commit -m "Add Treasury Templates list surface"`

---

## Task 6: Template detail editor (Level 2, create + edit) + materialiser

**Files:**
- Create: `apps/user-client/src/routes/app/treasury/template.tsx`
- Create: `apps/user-client/src/lib/seed-materialise.ts`
- Test: `apps/user-client/tests/routes/treasury-template.test.tsx`, `apps/user-client/tests/lib/seed-materialise.test.ts`

**Interfaces:**
- Consumes: `useSeedTemplate`/`useCreateSeedTemplate`/`useUpdateSeedTemplate`/`useDeleteSeedTemplate` (Task 1), `roleAt`/`normaliseBody`/`isValidBody`/`isApplyable`/`endsOnPersona` (Task 2), `PageScaffold` dirty-guard, `InlineEditTextarea`, `ConfirmDialog`.
- Produces:
  ```ts
  /** Template -> ordered MessageRow[] for a chat (greeting first if present). */
  export function materialiseSeed(t: SeedTemplateRow, chatId: string): MessageRow[]
  ```
  Greeting → `{kind:'seed', seedRole:'greeting', role:'persona'}`; each body turn → `{kind:'seed', seedRole:'body', role}`. `createdAt` ascending so ordering is stable; `streamingState:'complete'`.

- [ ] **Step 1 (materialiser): failing test** — `materialiseSeed` of a greeting+2-turn template yields 3 `MessageRow`s: `[greeting(persona,seedRole greeting), user(seedRole body), persona(seedRole body)]`, all `kind:'seed'`, same `chatId`, ascending `createdAt`.

- [ ] **Step 2: Run, fail; implement `materialiseSeed`; run, pass.**

- [ ] **Step 3 (editor): failing RTL test** — covers:
  - Create mode (`/new`): empty fields; Save disabled until `isApplyable`.
  - Greeting toggle reveals/hides a single text area.
  - Body: **Append turn** adds a row whose label follows `roleAt`; **Delete** a middle turn re-labels the rest (`normaliseBody`); **↑/↓** reorder re-labels; **no drag-and-drop**.
  - One explicit **Save** + **dirty-guard** for the whole page (discard-confirm on back with unsaved changes) — mirror `routes/app/knowledge/document.tsx`.
  - NSFW toggle present; the vanish-guard (disabled-with-reason in SFW mode if turning it on would hide the row you're editing).
  - A calm **hint when the last body turn is a user turn** (`!endsOnPersona`) — not a block (§11).
  - Delete (edit mode) via `ConfirmDialog`.
  - The **author-here/apply-there signpost** line is present (§6 fold).

- [ ] **Step 4: Run, fail.** FAIL.

- [ ] **Step 5: Implement `TreasuryTemplatePage`** — structurally the `KnowledgeDocumentPage` twin: outer shell loads the row by `:templateId` (guards unknown id with a calm notice) / create mode when `/new`; inner form seeds state once from the loaded row (use the focus-guarded re-sync pattern that fixed the My-Account async-seed blank-form class — see `routes/app/account/*`); body editor uses `normaliseBody` on every mutation; Save calls create/update; dirty-guard via `PageScaffold` `dirty` prop. Plain-text fields only.

- [ ] **Step 6: Run, verify pass + typecheck.** PASS; `pnpm typecheck --force` green.

- [ ] **Step 7: Commit** — `git commit -m "Add Treasury template editor and seed materialiser"`

---

## Task 7: Apply flow — picker, empty-chat affordance, first-send lock, opener suppression, removal

**Files:**
- Create: `apps/user-client/src/components/chat/SeedTemplatePicker.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Test: `apps/user-client/tests/components/seed-template-picker.test.tsx`, extend `tests/routes/chat-page.test.tsx`

**Interfaces:**
- Consumes: `useSeedTemplates`, `materialiseSeed` (Task 6), `PickerOverlay`, the chat's message store + send path, the opener/`openerPending` logic on `ChatRow`.
- Produces: a `SeedTemplatePicker` (PickerOverlay content) + chat-page wiring.

Behavioural contract (Laura folds — these are acceptance criteria):
- The **"Seed from template"** affordance renders **only while the chat has no real user message** (`role:'user' && !seedRole` count === 0). It is a **quiet secondary control near the composer — not a banner**, outside the primary type-here focal path. **(Laura firm condition — show the 380 px layout.)**
- Selecting a template **materialises** its rows into the chat (writes `kind:'seed'` `MessageRow`s; `invalidateQueries(['chats', chatId])` — the chat list is a one-shot `useChat`, not a live query, [[project_messages_need_query_invalidation]]).
- If the chosen template **has a greeting**, suppress the persona auto-opener for this chat (clear/inhibit `openerPending`); if **no greeting**, leave the opener path untouched.
- Applying a second template before sending **replaces** the current seed block (delete existing `kind:'seed'` rows for the chat first).
- The seed block is **removable wholesale** while no real message exists.
- **On first send the remove control LOCKS with a calm reason** ("Locked — the conversation has begun") rather than vanishing. The never-applied affordance simply belongs to the empty state and is gone once a message exists. **(Laura firm condition — visible lock, not silent disappearance.)**
- Seeds render distinctly via a **"Primer" pill** (positive marker, inline-marker aesthetic), NOT greyness-alone, so they read as intentional primer not failed turn. (Exact visual = design-language pass; the behavioural read is the criterion.)

- [ ] **Step 1: Write the failing tests**
  - Picker lists NSFW-filtered templates; selecting one calls the materialise+write path.
  - Affordance present at 0 real-user-messages; absent after a real send.
  - Greeting template → opener suppressed; non-greeting → opener intact.
  - Second apply replaces seeds (no accumulation).
  - Wholesale remove deletes all `kind:'seed'` rows while empty.
  - After first send: remove control is present-but-locked with the reason (assert the locked state + reason text), not removed from the DOM.
  - A seed message renders the "Primer" marker.

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement** `SeedTemplatePicker` (PickerOverlay content listing templates, focus-trap inherited) and the `chat-page.tsx` wiring: derive `hasRealUserMessage`; render the affordance + remove control gated on it; on apply, clear prior seeds → `materialiseSeed` → write → invalidate → suppress opener if greeting; render the Primer marker on `kind:'seed'` messages; lock the remove control once `hasRealUserMessage`.

- [ ] **Step 4: Run, verify pass + typecheck.** PASS; green.

- [ ] **Step 5: Commit** — `git commit -m "Add chat seed-template apply flow with first-send lock"`

---

## Task 8: Export action — "Save as template" in the message overflow

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageControls.tsx`, `apps/user-client/src/components/chat/MessageBlock.tsx`
- Test: `apps/user-client/tests/components/message-controls.test.tsx` (extend)

**Interfaces:**
- Consumes: `captureTemplate` (Task 3), `useCreateSeedTemplate` (Task 1), the chat's messages + persona/chat NSFW flag, the global NSFW-filter state (for the hidden-on-save notice), `OverflowMenu`.
- Produces: a "Save as template" overflow item under persona messages.

Behavioural contract (Laura folds):
- "Save as template" lives in the **message overflow (⋯), not the flat control row** — the row already has six labelled controls; a seventh inline at 380 px + a second "Save…" verb is the disambiguation/crowding risk. **(Laura firm condition — show the 380 px row+overflow layout.)**
- Invoking it calls `captureTemplate({messages, uptoMessageId: thisMessage.id, sourceNsfw})`, creates a `SeedTemplateRow` with a **pre-filled editable name** (persona + date), lands it in Treasury.
- **If the new template would land hidden** under the current global NSFW filter (NSFW capture while in SFW mode), the success affordance **says so** (mirror the §6 vanish-guard) instead of letting it vanish silently.

- [ ] **Step 1: Write the failing tests**
  - The overflow contains "Save as template" under a persona message (and not in the flat row).
  - Invoking it creates a template via `captureTemplate` mapping (opener→greeting, Tier-A text).
  - NSFW capture in SFW mode → success notice names that it's hidden by the filter.

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement** — add the overflow item in `MessageControls` (persona messages only), wire the capture+create in `MessageBlock`, name `${personaName} — ${date}`, surface the hidden-on-save notice via the existing toast/affordance pattern.

- [ ] **Step 4: Run, verify pass + typecheck + FULL vitest.** PASS; `pnpm typecheck --force` green; full user-client vitest at the 8-baseline.

- [ ] **Step 5: Commit** — `git commit -m "Add Save-as-template export from the message overflow"`

---

## Final steps (before squash)

- [ ] **Pre-squash Laura pass** (required — Laura path). Provide her the diff; her two firm conditions: the 380 px empty-chat affordance layout and the 380 px message row+overflow layout are demonstrated; the first-send transition is a visible lock. Fix HARD; log conscious SOFT deferrals in `obsidian/insights/ux-deferrals.md`.
- [ ] **opus whole-branch review** (the project's standing per-feature gate).
- [ ] **Gate on master after squash:** `pnpm typecheck --force` (0 cached), full user-client vitest = 8-baseline, production build clean.
- [ ] **Verify the squash captured the full tree** (file-count/diff vs branch tip) and **no scratch pollution** in `git diff --cached --name-only` ([[feedback_verify_squash_no_scratch_pollution]]).
- [ ] **Update `obsidian/STATUS-CLIENT-ONLY.md`** (Current entry) + commit alongside the squash.

## Self-review (author's note)

Spec coverage checked: §5 data → T1; §3/§6-editor invariants → T2/T6; §9 export → T3/T8; §4/§8 wire → T4; §6 list → T5; §7 apply + first-send lock + opener suppression + removal + Primer rendering → T7; all six Laura folds carried as acceptance criteria in T5–T8; the Dexie/verno hazard → T1 + preconditions. No pinned version number. The one deliberately-soft area is exact JSX/visual rendering (Primer pill, affordance placement) — kept as behavioural acceptance criteria because the design-language detail belongs to the implementer's then-current tree and the pre-squash Laura/opus passes.
