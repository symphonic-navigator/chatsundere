# Artefact System — Kern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a persona generate a single self-contained HTML artefact via a focused author subagent, shown as a live "building…" pill that opens in the lightbox, with a compact per-chat artefact sidebar.

**Architecture:** A new chat-owned `artefacts` Dexie table (v13). The `create_artefact` tool is contributed by an always-on artefact integration that closes over an extended `IntegrationContext` (persona offering + chatId/personaId + getKey). Its `execute` runs an **author subagent** — a streaming `streamCompletion` call (reasoning off, no tools) that turns a brief into one HTML file, reporting a live character count through a NEW tool-loop progress channel. The result persists an `ArtefactRow` and returns its id via `ToolResult.meta`. The generic `tool-call` pill is special-rendered (variant C) for `create_artefact`; tapping it opens the existing lightbox (reused via an `artefactToViewable` bridge, with new delete + dual-rename support). The sidebar mirrors `TocSheet`.

**Tech Stack:** TypeScript (strict), React 18, Dexie (IndexedDB), TanStack Query, Zustand, Vitest. Spec: [[../specs/2026-06-06-artefact-kern-design]]. Decisions: [[../../obsidian/ARTEFACTS-FEATURE-STATUS]].

**Conventions (all tasks):**
- Run from `apps/user-client/` unless noted. Tests: `pnpm vitest run <path>`. Typecheck: `pnpm typecheck` (repo root). Build: `pnpm run build` (root). Lint: `pnpm biome check <files>`.
- British English everywhere. SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on every new source file.
- Commit message co-author: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- IDs: `uuidv7()` (import from the same place `data/attachments.ts` does). Timestamps: `Date.now()`.

---

## File structure

**Create:**
- `src/data/artefacts.ts` — ArtefactRow CRUD + TanStack hooks.
- `src/lib/artefact-author.ts` — the author subagent (streaming brief→file).
- `src/lib/artefact-sections.ts` — pure sidebar sectioniser (mirrors `lib/toc.ts`).
- `src/integrations/artefact/artefact-integration.ts` — always-on integration + `create_artefact` tool.
- `src/components/chat/ArtefactPill.tsx` — variant-C pill renderer.
- `src/components/chat/ArtefactSheet.tsx` — the sidebar sheet (mirrors `TocSheet`).

**Modify:**
- `src/boot/client-data-db.ts` — `ArtefactRow`, table prop, `version(13)`.
- `src/data/queryKeys.ts` — artefact keys.
- `src/data/chats.ts` — cascade-delete artefacts + count helper.
- `src/tools/types.ts` — `ToolProgress`, `ToolResult.meta`, `execute` onProgress param.
- `src/tools/registry.ts` — `dispatch` forwards onProgress.
- `src/lib/tool-loop.ts` — per-pill progress channel + meta merge.
- `src/integrations/types.ts` — extend `IntegrationContext`.
- `src/integrations/build-context.ts` — populate the new context fields.
- `src/integrations/index.ts` — register `artefactIntegration`.
- `src/state/stream-manager.store.ts` — pass new ctx fields + forward onProgress in dispatch.
- `src/components/lightbox/viewable-item.ts` — `artefactToViewable`, `ViewableItem.title`.
- `src/components/lightbox/Lightbox.tsx` — `onDelete` prop + dual-rename UI; `onRename` patch shape.
- `src/components/chat/Cockpit.tsx`, `src/components/chat/MessageBlock.tsx` — adapt to new `onRename` signature.
- `src/components/chat/Pill.tsx` — delegate `create_artefact` pills to `ArtefactPill`.
- `src/components/chat/ReadingToolStrip.tsx` — artefacts button.
- `src/state/current-chat.store.ts` — artefact lightbox + sheet state.
- `src/routes/app/chat/chat-page.tsx` — render `ArtefactSheet` + artefact `Lightbox`, wire opens.
- `src/index.css` — pill variant C + artefact-sheet styles.
- Five test files: bump `expect(db.verno).toBe(12)` → `13`.
- `obsidian/insights/security-deferrals.md`, `obsidian/ARTEFACTS-FEATURE-STATUS.md` — log + status.

---

## Task 1: Dexie v13 — the `artefacts` table

**Files:**
- Modify: `src/boot/client-data-db.ts`
- Modify (verno bumps): `tests/unit/client-data-db.test.ts:20`, `tests/unit/attachments-schema.test.ts:17`, `tests/boot/client-data-db-v9.test.ts:73,84`, `tests/boot/client-data-db.webinterfacing.test.ts:19`
- Test: `tests/unit/artefacts-schema.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/artefacts-schema.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'vitest';
import { type ArtefactRow, getClientDataDb } from '../../src/boot/client-data-db.js';

afterEach(async () => {
  const db = getClientDataDb();
  await db.delete();
});

test('schema is at version 13 and exposes the artefacts table', async () => {
  const db = getClientDataDb();
  await db.open();
  expect(db.verno).toBe(13);
  const row: ArtefactRow = {
    id: 'a1',
    chatId: 'c1',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'Calculator',
    fileName: 'calculator.html',
    mime: 'text/html',
    content: '<!doctype html><title>x</title>',
    tags: [],
    favourite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.artefacts.add(row);
  expect(await db.artefacts.get('a1')).toMatchObject({ id: 'a1', chatId: 'c1', format: 'html' });
  expect(await db.artefacts.where('chatId').equals('c1').count()).toBe(1);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`ArtefactRow` not exported / verno 12).

Run: `pnpm vitest run tests/unit/artefacts-schema.test.ts`

- [ ] **Step 3: Add the interface + table prop + version(13)** in `src/boot/client-data-db.ts`

Add the interface near `AttachmentRow` (after line ~159):

```typescript
export type ArtefactOrigin = 'generated' | 'saved-message' | 'saved-code-block';
export type ArtefactKind = 'text' | 'image';
export type ArtefactFormat = 'html' | 'markdown' | 'code' | 'svg' | 'mermaid' | 'image';

export interface ArtefactRow {
  id: string;
  /** Owner chat — cascade-deleted with the chat. */
  chatId: string;
  /** Provenance + future treasury filter. */
  personaId: string;
  /** Reserved; unused until projects exist. */
  projectId: string | null;
  origin: ArtefactOrigin;
  kind: ArtefactKind;
  format: ArtefactFormat;
  /** Display name — freely renameable. */
  title: string;
  /** Carries the extension (download + detectFormat preview); renameable. */
  fileName: string;
  mime: string;
  /** Text artefacts. */
  content: string;
  /** Normalised trim+lowercase user tags (Treasury chunk owns the UI). */
  tags: string[];
  favourite: boolean;
  createdAt: number;
  updatedAt: number;
}
```

Add the table property in the `ClientDataDb` class (after `attachments!`):

```typescript
  artefacts!: Table<ArtefactRow, string>;
```

Add the version after the `version(12)` block:

```typescript
this.version(13).stores({
  artefacts: 'id, chatId, personaId, favourite, [chatId+createdAt]',
});
```

- [ ] **Step 4: Bump the five verno assertions** from `toBe(12)` to `toBe(13)` at the listed file:line locations.

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm vitest run tests/unit/artefacts-schema.test.ts tests/unit/client-data-db.test.ts tests/unit/attachments-schema.test.ts tests/boot/client-data-db-v9.test.ts tests/boot/client-data-db.webinterfacing.test.ts`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add artefacts table (Dexie v13)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Data layer — `data/artefacts.ts` + query keys

**Files:**
- Modify: `src/data/queryKeys.ts`
- Create: `src/data/artefacts.ts`
- Test: `tests/unit/data-artefacts.test.ts` (new)

- [ ] **Step 1: Add query keys** in `src/data/queryKeys.ts` (inside `QK`):

```typescript
  chatArtefacts: (chatId: string) => ['artefacts', 'chat', chatId] as const,
  artefact: (id: string) => ['artefacts', 'item', id] as const,
```

- [ ] **Step 2: Write the failing test** — `tests/unit/data-artefacts.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addGeneratedArtefact,
  deleteArtefact,
  listChatArtefacts,
  renameArtefact,
  setArtefactFavourite,
  updateArtefactContent,
} from '../../src/data/artefacts.js';

afterEach(async () => {
  await getClientDataDb().delete();
});

test('addGeneratedArtefact stores a generated html row with a derived filename', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'My Calculator!',
    content: '<!doctype html>…',
  });
  const row = await getClientDataDb().artefacts.get(id);
  expect(row).toMatchObject({
    chatId: 'c1',
    personaId: 'p1',
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'My Calculator!',
    fileName: 'my-calculator.html',
    mime: 'text/html',
    favourite: false,
  });
  expect(row?.tags).toEqual([]);
});

test('rename edits title and fileName independently; content + favourite mutate', async () => {
  const id = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  await renameArtefact(id, { title: 'B', fileName: 'b.html' });
  await updateArtefactContent(id, 'y');
  await setArtefactFavourite(id, true);
  const row = await getClientDataDb().artefacts.get(id);
  expect(row).toMatchObject({ title: 'B', fileName: 'b.html', content: 'y', favourite: true });
});

test('listChatArtefacts returns this chat, newest first; delete removes', async () => {
  const a = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  const b = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'B', content: 'x' });
  await addGeneratedArtefact({ chatId: 'c2', personaId: 'p1', title: 'C', content: 'x' });
  const list = await listChatArtefacts('c1');
  expect(list.map((r) => r.id)).toEqual([b, a]); // newest first
  await deleteArtefact(a);
  expect((await listChatArtefacts('c1')).map((r) => r.id)).toEqual([b]);
});
```

- [ ] **Step 3: Run it — expect FAIL** (`data/artefacts` missing).

Run: `pnpm vitest run tests/unit/data-artefacts.test.ts`

- [ ] **Step 4: Implement** `src/data/artefacts.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import { type ArtefactRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** Lower-case, hyphenated slug for a filename stem (no extension). */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'artefact';
}

export interface AddGeneratedArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  content: string;
}

/** Persist a freshly generated single-file HTML artefact; returns its id. */
export async function addGeneratedArtefact(input: AddGeneratedArtefactInput): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: input.title,
    fileName: `${slugify(input.title)}.html`,
    mime: 'text/html',
    content: input.content,
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}

export async function renameArtefact(
  id: string,
  patch: { title?: string; fileName?: string },
): Promise<void> {
  const changes: Partial<ArtefactRow> = { updatedAt: Date.now() };
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.fileName !== undefined) changes.fileName = patch.fileName;
  await getClientDataDb().artefacts.update(id, changes);
}

export async function updateArtefactContent(id: string, content: string): Promise<void> {
  await getClientDataDb().artefacts.update(id, { content, updatedAt: Date.now() });
}

export async function setArtefactFavourite(id: string, favourite: boolean): Promise<void> {
  await getClientDataDb().artefacts.update(id, { favourite, updatedAt: Date.now() });
}

export async function deleteArtefact(id: string): Promise<void> {
  await getClientDataDb().artefacts.delete(id);
}

/** All artefacts owned by a chat, newest first. */
export async function listChatArtefacts(chatId: string): Promise<ArtefactRow[]> {
  const rows = await getClientDataDb().artefacts.where('chatId').equals(chatId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getArtefact(id: string): Promise<ArtefactRow | undefined> {
  return getClientDataDb().artefacts.get(id);
}

// ---- hooks ----

export function useChatArtefacts(chatId: string) {
  return useQuery({ queryKey: QK.chatArtefacts(chatId), queryFn: () => listChatArtefacts(chatId) });
}

export function useArtefact(id: string | null) {
  return useQuery({
    queryKey: QK.artefact(id ?? ''),
    enabled: id !== null,
    queryFn: () => (id ? getArtefact(id) : undefined),
  });
}

/** Invalidate both the chat list and the single-item query after a mutation. */
function useArtefactInvalidation(chatId: string) {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: QK.chatArtefacts(chatId) });
    if (id) void qc.invalidateQueries({ queryKey: QK.artefact(id) });
  };
}

export function useRenameArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { id: string; patch: { title?: string; fileName?: string } }) =>
      renameArtefact(v.id, v.patch),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

export function useUpdateArtefactContent(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { id: string; content: string }) => updateArtefactContent(v.id, v.content),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

export function useSetArtefactFavourite(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { id: string; favourite: boolean }) => setArtefactFavourite(v.id, v.favourite),
    onSuccess: (_r, v) => invalidate(v.id),
  });
}

export function useDeleteArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (id: string) => deleteArtefact(id),
    onSuccess: (_r, id) => invalidate(id),
  });
}
```

> Note: confirm the `uuid` import form matches `data/attachments.ts` (it imports `uuidv7`). If that file imports `{ v7 as uuidv7 } from 'uuid'` keep this; if it re-exports from a local helper, use that instead.

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm vitest run tests/unit/data-artefacts.test.ts`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add artefact data layer (CRUD + query hooks)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Chat-delete cascade + artefact count

**Files:**
- Modify: `src/data/chats.ts` (the `useDeleteChat` mutation + add `countChatArtefacts`)
- Test: `tests/unit/chat-delete-artefacts.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/chat-delete-artefacts.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { deleteChatCascade } from '../../src/data/chats.js';

afterEach(async () => {
  await getClientDataDb().delete();
});

test('deleting a chat cascade-deletes its artefacts but not other chats’', async () => {
  await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'A', content: 'x' });
  await addGeneratedArtefact({ chatId: 'c2', personaId: 'p1', title: 'B', content: 'x' });
  await deleteChatCascade('c1');
  expect(await getClientDataDb().artefacts.where('chatId').equals('c1').count()).toBe(0);
  expect(await getClientDataDb().artefacts.where('chatId').equals('c2').count()).toBe(1);
});
```

> The mutation `useDeleteChat` calls store code (`abortDiscard`) that is awkward in a unit test. Extract the DB cascade into a plain exported `deleteChatCascade(chatId)` and have `useDeleteChat` call it. Test the pure function.

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/chat-delete-artefacts.test.ts`

- [ ] **Step 3: Refactor `useDeleteChat` to use an extracted cascade** in `src/data/chats.ts`. Add:

```typescript
/** Delete a chat and everything it owns (messages, pills, attachments, artefacts). */
export async function deleteChatCascade(chatId: string): Promise<void> {
  const db = getClientDataDb();
  await db.transaction(
    'rw',
    [db.chats, db.messages, db.pills, db.attachments, db.artefacts],
    async () => {
      const msgs = await db.messages.where('chatId').equals(chatId).toArray();
      const msgIds = msgs.map((m) => m.id);
      if (msgIds.length > 0) await db.pills.where('messageId').anyOf(msgIds).delete();
      await db.attachments.where('chatId').equals(chatId).delete();
      await db.artefacts.where('chatId').equals(chatId).delete();
      await db.messages.where('chatId').equals(chatId).delete();
      await db.chats.delete(chatId);
    },
  );
}

/** Count of artefacts a chat owns — for the delete-confirmation warning. */
export async function countChatArtefacts(chatId: string): Promise<number> {
  return getClientDataDb().artefacts.where('chatId').equals(chatId).count();
}
```

Then change the existing `useDeleteChat` mutationFn body to:

```typescript
    mutationFn: async (chatId: string): Promise<void> => {
      await useStreamManagerStore.getState().abortDiscard(chatId);
      await deleteChatCascade(chatId);
    },
```

(This also fixes the pre-existing gap where chat-delete never cascaded to **attachments**.)

- [ ] **Step 4: Run tests — expect PASS.** `pnpm vitest run tests/unit/chat-delete-artefacts.test.ts`

- [ ] **Step 5: Wire the warning at the delete confirmation.** Grep for `useDeleteChat(` to find the call site (the chat-delete confirm, likely in the history route / a chat menu). Where it confirms deletion, fetch `countChatArtefacts(chatId)` (a `useQuery` keyed `QK.chatArtefacts(chatId)` is already available — `.data?.length`) and, when > 0, append to the confirm copy: `This will also delete N artefact(s).` Keep British English. Add/adjust the existing confirm component test if one exists.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Cascade chat deletion to artefacts (+ attachments) with a warning

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: The author subagent

**Files:**
- Create: `src/lib/artefact-author.ts`
- Test: `tests/unit/artefact-author.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/artefact-author.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, vi } from 'vitest';
import type { StreamChunk } from '@chatsundere/llm-unified';
import { authorArtefact, stripFences } from '../../src/lib/artefact-author.js';

function fakeStream(chunks: StreamChunk[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

const base = {
  // minimal shapes — the fake stream ignores them
  provider: {} as never,
  providerConfig: {} as never,
  apiKey: 'k',
  corsProxyUrl: null,
  corsProxyKey: null,
  target: { slug: 'm' } as never,
};

test('stripFences removes a leading ```html fence and trailing ```', () => {
  expect(stripFences('```html\n<h1>x</h1>\n```')).toBe('<h1>x</h1>');
  expect(stripFences('<h1>x</h1>')).toBe('<h1>x</h1>');
});

test('accumulates token text, fires onProgress with running char counts, strips fences', async () => {
  const onProgress = vi.fn();
  const streamFn = fakeStream([
    { type: 'token', text: '```html\n' },
    { type: 'token', text: '<h1>hi</h1>' },
    { type: 'token', text: '\n```' },
    { type: 'finish', reason: 'stop' },
  ]);
  const out = await authorArtefact({ base, brief: 'a heading', onProgress, streamFn: streamFn as never });
  expect(out).toBe('<h1>hi</h1>');
  expect(onProgress).toHaveBeenCalled();
  expect(onProgress.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
});

test('throws on an error chunk and on empty output', async () => {
  await expect(
    authorArtefact({ base, brief: 'x', streamFn: fakeStream([{ type: 'error', message: 'boom' }]) as never }),
  ).rejects.toThrow(/boom/);
  await expect(
    authorArtefact({ base, brief: 'x', streamFn: fakeStream([{ type: 'finish', reason: 'stop' }]) as never }),
  ).rejects.toThrow(/empty/i);
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/artefact-author.test.ts`

- [ ] **Step 3: Implement** `src/lib/artefact-author.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type CompletionTarget,
  type ProviderConfig,
  type ProviderDefinition,
  type StreamChunk,
  type WireMessage,
  streamCompletion,
} from '@chatsundere/llm-unified';

export const AUTHOR_SYSTEM_PROMPT =
  'You are a single-file web-app author. Output EXACTLY ONE self-contained HTML file and ' +
  'nothing else — no prose, no explanation, no surrounding Markdown commentary. Inline all ' +
  'CSS and JavaScript. Use NO external resources whatsoever: no CDN, no <script src>, no ' +
  '<link href> to remote stylesheets or fonts, no fetch/XHR/WebSocket, no imports. The file ' +
  'must run offline from a single document. Design mobile-first — it must work well at 380px ' +
  'wide. If you wrap the file in a code fence, use ```html.';

/** Strip a single leading ```html / ``` fence and a trailing ``` if present. */
export function stripFences(text: string): string {
  let t = text.trim();
  const open = t.match(/^```[a-zA-Z]*\s*\n/);
  if (open) t = t.slice(open[0].length);
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
}

export interface AuthorBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  target: CompletionTarget;
}

export interface AuthorArtefactArgs {
  base: AuthorBase;
  brief: string;
  signal?: AbortSignal;
  /** Live running character count of the file so far. */
  onProgress?: (charCount: number) => void;
  /** Injected for tests; defaults to the real streaming primitive. */
  streamFn?: typeof streamCompletion;
}

/** Run the author subagent: brief in, single self-contained HTML file out. */
export async function authorArtefact(args: AuthorArtefactArgs): Promise<string> {
  const stream = args.streamFn ?? streamCompletion;
  const messages: WireMessage[] = [
    { role: 'system', content: AUTHOR_SYSTEM_PROMPT },
    { role: 'user', content: args.brief },
  ];
  let acc = '';
  for await (const chunk of stream({
    provider: args.base.provider,
    providerConfig: args.base.providerConfig,
    apiKey: args.base.apiKey,
    corsProxyUrl: args.base.corsProxyUrl,
    corsProxyKey: args.base.corsProxyKey,
    target: args.base.target,
    messages,
    // No reasoning (we want the file, not a trace), no tools, generous output.
    bodyExtras: { temperature: 0.4, max_tokens: 8192, reasoning: { enabled: false } },
    signal: args.signal,
  } as Parameters<typeof streamCompletion>[0])) {
    const c = chunk as StreamChunk;
    if (c.type === 'token') {
      acc += c.text;
      args.onProgress?.(acc.length);
    } else if (c.type === 'error') {
      throw new Error(c.message);
    }
  }
  const file = stripFences(acc);
  if (file.length === 0) throw new Error('Author produced empty output');
  return file;
}
```

> `max_tokens: 8192` caps the artefact size — adequate for demo-scale single-file apps. Larger files are a known limitation (note in STATUS). Tune per device feedback.

- [ ] **Step 4: Run tests — expect PASS.** `pnpm vitest run tests/unit/artefact-author.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the artefact author subagent (streaming brief→single-file HTML)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Extend `IntegrationContext` with the artefact target

**Files:**
- Modify: `src/integrations/types.ts`
- Modify: `src/integrations/build-context.ts`
- Test: `tests/unit/build-context-artefact.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/build-context-artefact.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { buildIntegrationContext } from '../../src/integrations/build-context.js';

test('context carries chatId, personaId and personaOffering', () => {
  const ctx = buildIntegrationContext(
    { adultPersona: false },
    { search: null, fetch: null },
    null,
    { corsProxyUrl: null, corsProxyKey: null, webSearchTierId: null },
    {
      chatId: 'c1',
      personaId: 'p1',
      personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    },
  );
  expect(ctx.chatId).toBe('c1');
  expect(ctx.personaId).toBe('p1');
  expect(ctx.personaOffering).toEqual({ providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/build-context-artefact.test.ts`

- [ ] **Step 3: Extend the types** in `src/integrations/types.ts` (`IntegrationContext`, after `getKey`):

```typescript
  /** Owner chat for artefacts produced this send. */
  chatId: string;
  /** Active persona id — provenance for produced artefacts. */
  personaId: string;
  /** The persona's LLM offering — the model the author subagent runs. */
  personaOffering: OfferingRef;
```

- [ ] **Step 4: Populate them** in `src/integrations/build-context.ts`. Add a new param object and set the fields:

```typescript
export interface ArtefactTarget {
  chatId: string;
  personaId: string;
  personaOffering: OfferingRef;
}

export function buildIntegrationContext(
  persona: PersonaNsfw,
  web: WebSettings,
  mk: MasterKey | null,
  route: IntegrationRoute,
  artefact: ArtefactTarget,
  getKeyFn: (id: string, mk: MasterKey) => Promise<string | null> = getCredentialKey,
): IntegrationContext {
  return {
    nsfwAllowed: persona.adultPersona,
    location: null,
    webSearch: web.search,
    webFetch: web.fetch,
    corsProxyUrl: route.corsProxyUrl,
    corsProxyKey: route.corsProxyKey,
    webSearchTierId: route.webSearchTierId,
    chatId: artefact.chatId,
    personaId: artefact.personaId,
    personaOffering: artefact.personaOffering,
    getKey: (id) => (mk ? getKeyFn(id, mk) : Promise.resolve(null)),
  };
}
```

> Existing callers/tests of `buildIntegrationContext` now need the `artefact` arg — fix the stream-manager caller in Task 8 and any other test in this task's run.

- [ ] **Step 5: Run — expect PASS** (and fix any now-broken `buildIntegrationContext` test by adding the arg).

Run: `pnpm vitest run tests/unit/build-context-artefact.test.ts` then the existing build-context test file.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Extend IntegrationContext with the artefact target (chat/persona/offering)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Tool-loop progress channel + `ToolResult.meta`

**Files:**
- Modify: `src/tools/types.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/lib/tool-loop.ts`
- Test: `tests/unit/tool-loop-progress.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/tool-loop-progress.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, vi } from 'vitest';
import type { PillRow } from '../../src/boot/client-data-db.js';
import { runToolLoop } from '../../src/lib/tool-loop.js';
import type { StreamEngineResult } from '../../src/lib/stream-engine.js';

function toolCallPill(id: string): PillRow {
  return {
    id,
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'pending',
    payload: { name: 'create_artefact', argumentsJson: '{"title":"X","brief":"b"}', toolCallId: 't1' },
    createdAt: 0,
  };
}

test('progress updates merge into the pill payload; meta merges on completion', async () => {
  const updates: PillRow[] = [];
  let round = 0;
  const result = await runToolLoop({
    streamOnce: async (): Promise<StreamEngineResult> => {
      round += 1;
      return round === 1
        ? { finalContentBlocks: [], pillRows: [toolCallPill('p1')], finishReason: 'tool_calls' }
        : { finalContentBlocks: [{ type: 'text', text: 'done' }], pillRows: [], finishReason: 'stop' };
    },
    dispatch: async (_name, _args, _signal, onProgress) => {
      onProgress?.({ charCount: 10 });
      onProgress?.({ charCount: 25 });
      return { ok: true, output: 'created', error: null, meta: { artefactId: 'a1', title: 'X' } };
    },
    toolDefs: [],
    maxRounds: 5,
    onPillUpdate: (p) => updates.push({ ...p, payload: { ...(p.payload as object) } }),
  });
  const last = updates.at(-1);
  expect((last?.payload as { charCount?: number }).charCount).toBe(25);
  expect((last?.payload as { artefactId?: string }).artefactId).toBe('a1');
  expect(last?.status).toBe('completed');
  expect(result.finishReason).toBe('stop');
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/tool-loop-progress.test.ts`

- [ ] **Step 3: Extend `Tool`/`ToolResult`** in `src/tools/types.ts`:

```typescript
/** Incremental progress a tool may report while executing (for live pills). */
export interface ToolProgress {
  charCount: number;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  error: string | null;
  /** Optional structured data merged into the pill payload (e.g. an artefact id). */
  meta?: Record<string, unknown>;
}
```

And widen `execute`:

```typescript
  execute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onProgress?: (p: ToolProgress) => void,
  ): Promise<ToolResult>;
```

- [ ] **Step 4: Forward in `dispatch`** (`src/tools/registry.ts`):

```typescript
export function dispatch(
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: (p: import('./types.js').ToolProgress) => void,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return Promise.resolve({ ok: false, output: '', error: `Unknown tool: ${name}` });
  }
  return tool.execute(args, signal, onProgress);
}
```

- [ ] **Step 5: Wire the channel in the tool-loop** (`src/lib/tool-loop.ts`). Update `ToolLoopDeps.dispatch` type and the per-pill block:

```typescript
  dispatch: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onProgress?: (p: import('../tools/types.js').ToolProgress) => void,
  ) => Promise<ToolResult>;
```

Replace the per-pill loop body with:

```typescript
    for (const pill of toolPills) {
      const payload = pill.payload as ToolCallPayload;
      pill.status = 'pending';
      deps.onPillUpdate?.(pill);

      const onProgress = (p: import('../tools/types.js').ToolProgress): void => {
        pill.payload = { ...(pill.payload as Record<string, unknown>), ...p };
        deps.onPillUpdate?.(pill);
      };

      const r = await deps.dispatch(
        payload.name,
        parseArgs(payload.argumentsJson),
        deps.signal,
        onProgress,
      );
      const content = r.ok ? r.output : (r.error ?? r.output);
      pill.status = r.ok ? 'completed' : 'failed';
      pill.payload = {
        ...(pill.payload as Record<string, unknown>),
        result: r.ok ? r.output : undefined,
        error: r.ok ? undefined : (r.error ?? ''),
        ...(r.meta ?? {}),
      };
      deps.onPillUpdate?.(pill);

      toolCalls.push({
        id: payload.toolCallId,
        type: 'function',
        function: { name: payload.name, arguments: payload.argumentsJson },
      });
      toolMessages.push({ role: 'tool', tool_call_id: payload.toolCallId, content });
    }
```

- [ ] **Step 6: Run tests — expect PASS** (and the existing `tool-loop` test to stay green).

Run: `pnpm vitest run tests/unit/tool-loop-progress.test.ts` then the existing tool-loop test file.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add a tool-loop progress channel + ToolResult.meta

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: The artefact integration + `create_artefact` tool

**Files:**
- Create: `src/integrations/artefact/artefact-integration.ts`
- Test: `tests/unit/artefact-integration.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/artefact-integration.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';
import { listChatArtefacts } from '../../src/data/artefacts.js';
import { makeArtefactTool } from '../../src/integrations/artefact/artefact-integration.js';
import type { IntegrationContext } from '../../src/integrations/types.js';

afterEach(async () => {
  await getClientDataDb().delete();
});

function ctx(over: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    corsProxyUrl: null,
    corsProxyKey: null,
    webSearchTierId: null,
    chatId: 'c1',
    personaId: 'p1',
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => 'api-key',
    ...over,
  };
}

test('execute authors a file, persists it, returns the id via meta + progress', async () => {
  const onProgress = vi.fn();
  const tool = makeArtefactTool(ctx(), {
    // inject the author + the provider/offering resolver so no network/registry is touched
    author: async (a) => {
      a.onProgress?.(42);
      return '<!doctype html><title>x</title>';
    },
    resolveBase: () => ({
      provider: {} as never,
      providerConfig: {} as never,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      target: { slug: 'glm-5.1' } as never,
    }),
  });
  const r = await tool.execute({ title: 'Calc', brief: 'a calculator' }, undefined, onProgress);
  expect(r.ok).toBe(true);
  expect(r.meta?.title).toBe('Calc');
  expect(typeof r.meta?.artefactId).toBe('string');
  expect(r.output).not.toContain('<!doctype'); // never the file body
  expect(onProgress).toHaveBeenCalledWith({ charCount: 42 });
  const rows = await listChatArtefacts('c1');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toContain('<!doctype');
});

test('missing key → failed result, nothing persisted', async () => {
  const tool = makeArtefactTool(ctx({ getKey: async () => null }), {
    author: async () => '<x>',
    resolveBase: () => ({ provider: {} as never, providerConfig: {} as never, apiKey: '', corsProxyUrl: null, corsProxyKey: null, target: {} as never }),
  });
  const r = await tool.execute({ title: 'A', brief: 'b' });
  expect(r.ok).toBe(false);
  expect(await listChatArtefacts('c1')).toHaveLength(0);
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/artefact-integration.test.ts`

- [ ] **Step 3: Implement** `src/integrations/artefact/artefact-integration.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering, getProvider, offeringToTarget } from '@chatsundere/llm-unified';
import { addGeneratedArtefact } from '../../data/artefacts.js';
import {
  type AuthorArtefactArgs,
  type AuthorBase,
  authorArtefact,
} from '../../lib/artefact-author.js';
import type { Tool, ToolResult } from '../../tools/types.js';
import type { Integration, IntegrationContext } from '../types.js';

const INSTRUCTION =
  'A `create_artefact` tool produces a single self-contained HTML file (a small web app or ' +
  'interactive view) that the user can open, edit, download, and reuse. Use it when the user ' +
  'wants a UI, demo, widget, or interactive page — not for ordinary prose. Pass a COMPLETE, ' +
  'self-contained `brief`: a separate author writes the file from your brief alone, so include ' +
  'every requirement, all content, and the styling intent. The file must be one file with no ' +
  'external resources. After it is created, simply tell the user it is ready.';

/** Injectable seams (real defaults below) so the tool is unit-testable. */
export interface ArtefactToolDeps {
  author?: (args: AuthorArtefactArgs) => Promise<string>;
  resolveBase?: (ctx: IntegrationContext) => AuthorBase;
}

function defaultResolveBase(ctx: IntegrationContext): AuthorBase {
  const providerDef = getProvider(ctx.personaOffering.providerId);
  const offering = getOffering(ctx.personaOffering.providerId, ctx.personaOffering.upstreamSlug);
  if (!providerDef || !offering) throw new Error('Artefact author: persona model not resolvable');
  return {
    provider: providerDef,
    providerConfig: {
      baseUrl: providerDef.baseUrl,
      routing:
        providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
    },
    apiKey: '', // filled by execute (async key fetch)
    corsProxyUrl: ctx.corsProxyUrl,
    corsProxyKey: ctx.corsProxyKey,
    target: offeringToTarget(offering),
  };
}

export function makeArtefactTool(ctx: IntegrationContext, deps: ArtefactToolDeps = {}): Tool {
  const author = deps.author ?? authorArtefact;
  const resolveBase = deps.resolveBase ?? defaultResolveBase;
  return {
    name: 'create_artefact',
    description:
      'Create a single self-contained HTML artefact (a small interactive web app or view) the user can open, edit, download, and reuse. Provide a title and a complete brief.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable title for the artefact.' },
        brief: {
          type: 'string',
          description:
            'A complete, self-contained description of the file to build: all requirements, content, and styling. A separate author writes the file from this alone.',
        },
      },
      required: ['title', 'brief'],
    },
    systemPromptInstruction: INSTRUCTION,
    async execute(args, signal, onProgress): Promise<ToolResult> {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
      if (title.length === 0 || brief.length === 0) {
        return { ok: false, output: '', error: 'create_artefact needs a title and a brief.' };
      }
      try {
        const key = await ctx.getKey(ctx.personaOffering.providerId);
        if (!key) return { ok: false, output: '', error: 'No API key for the artefact author model.' };
        const base = { ...resolveBase(ctx), apiKey: key };
        const content = await author({
          base,
          brief,
          signal,
          onProgress: (n) => onProgress?.({ charCount: n }),
        });
        const id = await addGeneratedArtefact({
          chatId: ctx.chatId,
          personaId: ctx.personaId,
          title,
          content,
        });
        return {
          ok: true,
          output: `Created artefact «${title}» (id: ${id}). It is ready — let the user know.`,
          error: null,
          meta: { artefactId: id, title, format: 'html' },
        };
      } catch (e) {
        return {
          ok: false,
          output: '',
          error: e instanceof Error ? e.message : 'Artefact creation failed.',
        };
      }
    },
  };
}

/** Always-on artefact integration: contributes create_artefact whenever a send
 *  happens (tool-support gating is handled by the registry/stream-manager). */
export const artefactIntegration: Integration = {
  id: 'artefact',
  capability: 'llm',
  contributesTools(ctx: IntegrationContext): Tool[] {
    return [makeArtefactTool(ctx)];
  },
};
```

- [ ] **Step 4: Run tests — expect PASS.** `pnpm vitest run tests/unit/artefact-integration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the artefact integration + create_artefact tool

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Register the integration + wire the stream-manager

**Files:**
- Modify: `src/integrations/index.ts`
- Modify: `src/state/stream-manager.store.ts`
- Test: `tests/unit/registry-artefact.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/registry-artefact.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { resolveActiveTools } from '../../src/tools/registry.js';
import type { IntegrationContext } from '../../src/integrations/types.js';

test('create_artefact is among the active tools', () => {
  const ctx: IntegrationContext = {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    corsProxyUrl: null,
    corsProxyKey: null,
    webSearchTierId: null,
    chatId: 'c1',
    personaId: 'p1',
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => null,
  };
  expect(resolveActiveTools(ctx).map((t) => t.name)).toContain('create_artefact');
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/registry-artefact.test.ts`

- [ ] **Step 3: Register** in `src/integrations/index.ts`:

```typescript
import { artefactIntegration } from './artefact/artefact-integration.js';
import { webIntegration } from './web/web-integration.js';

export const INTEGRATIONS: readonly Integration[] = [webIntegration, artefactIntegration];
```

- [ ] **Step 4: Pass the artefact target + forward onProgress** in `src/state/stream-manager.store.ts`. Update the `buildIntegrationContext(...)` call (around line 322) to add the 5th `artefact` arg:

```typescript
  const integrationCtx = buildIntegrationContext(
    args.persona,
    args.webInterfacing ?? { search: null, fetch: null },
    useSessionStore.getState().mk,
    {
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      webSearchTierId: useCurrentChatStore.getState().webSearchTierId,
    },
    {
      chatId: args.chatId,
      personaId: args.persona.id,
      personaOffering: {
        providerId: args.offering.providerId,
        upstreamSlug: args.offering.upstreamSlug,
      },
    },
  );
```

> Verify `args.offering` exposes `providerId` + `upstreamSlug` (the web tools read `offering.providerId`; `offeringToTarget` reads `upstreamSlug`). If the field names differ, map accordingly.

Then find where `runToolLoop` is given its `dispatch` and forward `onProgress`:

```typescript
    dispatch: (name, toolArgs, signal, onProgress) =>
      dispatch(activeTools, name, toolArgs, signal, onProgress),
```

- [ ] **Step 5: Run tests — expect PASS** and the existing stream-manager store test green.

Run: `pnpm vitest run tests/unit/registry-artefact.test.ts` then the existing `stream-manager-store` test file.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Register artefact integration + thread the artefact target/progress

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: Lightbox bridge — `artefactToViewable` + `ViewableItem.title`

**Files:**
- Modify: `src/components/lightbox/viewable-item.ts`
- Test: `tests/unit/artefact-to-viewable.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/artefact-to-viewable.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { artefactToViewable } from '../../src/components/lightbox/viewable-item.js';

const row: ArtefactRow = {
  id: 'a1', chatId: 'c1', personaId: 'p1', projectId: null, origin: 'generated',
  kind: 'text', format: 'html', title: 'Calc', fileName: 'calc.html', mime: 'text/html',
  content: '<x>', tags: [], favourite: false, createdAt: 0, updatedAt: 0,
};

test('maps an artefact row to a viewable with generated caps + title', () => {
  const v = artefactToViewable(row);
  expect(v).toMatchObject({ id: 'a1', kind: 'text', fileName: 'calc.html', title: 'Calc', text: '<x>' });
  expect(v.caps).toEqual({
    rename: true, remove: false, copy: true, download: true, delete: true, editSource: true,
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/unit/artefact-to-viewable.test.ts`

- [ ] **Step 3: Implement.** In `src/components/lightbox/viewable-item.ts` add `title?: string` to `ViewableItem`, then add:

```typescript
import type { ArtefactRow } from '../../boot/client-data-db.js';

/** Map a stored artefact to a viewable. Generated artefacts are first-class:
 *  editable, copyable, downloadable, deletable. */
export function artefactToViewable(row: ArtefactRow): ViewableItem {
  return {
    id: row.id,
    kind: 'text',
    fileName: row.fileName,
    title: row.title,
    mime: row.mime,
    text: row.content,
    caps: {
      rename: true,
      remove: false,
      copy: true,
      download: true,
      delete: true,
      editSource: true,
    },
  };
}
```

Add to the `ViewableItem` interface (after `fileName`):

```typescript
  /** Display title, separate from fileName — present for artefacts only. */
  title?: string;
```

- [ ] **Step 4: Run tests — expect PASS.** `pnpm vitest run tests/unit/artefact-to-viewable.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add artefactToViewable + ViewableItem.title

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: Lightbox — `onDelete` + dual-rename (title + fileName)

**Files:**
- Modify: `src/components/lightbox/Lightbox.tsx`
- Test: `tests/components/lightbox-artefact.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — `tests/components/lightbox-artefact.test.tsx`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox.js';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item.js';

const item: ViewableItem = {
  id: 'a1', kind: 'text', fileName: 'calc.html', title: 'Calc', mime: 'text/html', text: '<x>',
  caps: { rename: true, remove: false, copy: true, download: true, delete: true, editSource: true },
};

test('renders a delete control and fires onDelete', () => {
  const onDelete = vi.fn();
  render(
    <Lightbox items={[item]} index={0} onRename={vi.fn()} onRemove={vi.fn()}
      onEditText={vi.fn()} onDelete={onDelete} onClose={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(onDelete).toHaveBeenCalledWith('a1');
});

test('renames title and fileName independently via onRename patch', () => {
  const onRename = vi.fn();
  render(
    <Lightbox items={[item]} index={0} onRename={onRename} onRemove={vi.fn()}
      onEditText={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />,
  );
  // title shown when present; clicking it opens the title editor
  fireEvent.click(screen.getByRole('button', { name: /rename title/i }));
  const input = screen.getByDisplayValue('Calc');
  fireEvent.change(input, { target: { value: 'New' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledWith('a1', { title: 'New' });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm vitest run tests/components/lightbox-artefact.test.tsx`

- [ ] **Step 3: Update `LightboxProps`** in `Lightbox.tsx`:

```typescript
  /** New rename shape: a patch so artefacts can rename title and/or fileName. */
  onRename: (id: string, patch: { title?: string; fileName?: string }) => void;
  /** Delete a generated item (caps.delete). */
  onDelete?: (id: string) => void;
```

- [ ] **Step 4: Replace the rename block** (currently the single `fileName` editor, ~lines 237–261). When `item.title !== undefined`, render two editable targets — a prominent title button (aria-label "Rename title", commits `{ title }`) and a smaller filename button (aria-label "Rename filename", commits `{ fileName }`); otherwise keep the single fileName editor but commit `{ fileName }`. Use a `renamingField: 'title' | 'fileName' | null` state. Example for the title editor branch:

```tsx
{item.title !== undefined ? (
  renamingField === 'title' ? (
    <input
      className="lightbox-name-edit"
      defaultValue={item.title}
      // biome-ignore lint/a11y/noAutofocus: inline rename — focus is the intent
      autoFocus
      onBlur={(e) => {
        setRenamingField(null);
        if (e.target.value.trim()) p.onRename(item.id, { title: e.target.value.trim() });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setRenamingField(null);
      }}
    />
  ) : (
    <button type="button" className="lightbox-name" aria-label="Rename title"
      onClick={() => item.caps.rename && setRenamingField('title')}>
      <span>{item.title}</span>{item.caps.rename ? <span aria-hidden> ✎</span> : null}
    </button>
  )
) : null}
```

Add the analogous filename editor (`aria-label="Rename filename"`, commits `{ fileName }`), shown smaller beneath the title. For the attachment case (`item.title === undefined`) keep one editor committing `{ fileName }`.

- [ ] **Step 5: Add a delete button** in the toolbar, rendered when `item.caps.delete && p.onDelete`:

```tsx
{item.caps.delete && p.onDelete ? (
  <button type="button" className="lightbox-action" aria-label="Delete"
    onClick={() => p.onDelete?.(item.id)}>🗑</button>
) : null}
```

- [ ] **Step 6: Run tests — expect PASS.** `pnpm vitest run tests/components/lightbox-artefact.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Lightbox: add onDelete + dual-rename (title/fileName)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 11: Adapt attachment callers to the new `onRename` shape

**Files:**
- Modify: `src/components/chat/Cockpit.tsx` (~line 350)
- Modify: `src/components/chat/MessageBlock.tsx` (the `handleRename` + Lightbox use ~lines 183–197)
- Test: existing `Cockpit`/`MessageBlock` tests stay green.

- [ ] **Step 1: Update Cockpit's lightbox `onRename`** to the patch shape:

```tsx
  onRename={(id, patch) => {
    if (patch.fileName) rename.mutate({ id, fileName: patch.fileName });
  }}
```

- [ ] **Step 2: Update MessageBlock's `handleRename`** to accept `(id, patch)` and use `patch.fileName`. (Attachments have no `title`, so `patch.title` never arrives here.)

- [ ] **Step 3: Run the touched component tests — expect PASS.**

Run: `pnpm vitest run tests/components` (or the specific Cockpit/MessageBlock test files).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Adapt attachment lightbox callers to the onRename patch shape

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 12: Current-chat store — artefact lightbox + sheet state

**Files:**
- Modify: `src/state/current-chat.store.ts`
- Test: `tests/unit/current-chat-artefact-state.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/unit/current-chat-artefact-state.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

test('artefact lightbox + sheet state toggles', () => {
  const s = useCurrentChatStore.getState();
  s.openArtefact('a1');
  expect(useCurrentChatStore.getState().openArtefactId).toBe('a1');
  s.closeArtefact();
  expect(useCurrentChatStore.getState().openArtefactId).toBeNull();
  s.setArtefactSheetOpen(true);
  expect(useCurrentChatStore.getState().isArtefactSheetOpen).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm vitest run tests/unit/current-chat-artefact-state.test.ts`

- [ ] **Step 3: Add state + actions** to the store interface, initial state, and implementations:

```typescript
  // interface
  openArtefactId: string | null;
  isArtefactSheetOpen: boolean;
  openArtefact: (id: string) => void;
  closeArtefact: () => void;
  setArtefactSheetOpen: (open: boolean) => void;
```

```typescript
  // initial state
  openArtefactId: null,
  isArtefactSheetOpen: false,
```

```typescript
  // actions
  openArtefact: (id) => set({ openArtefactId: id, isArtefactSheetOpen: false }),
  closeArtefact: () => set({ openArtefactId: null }),
  setArtefactSheetOpen: (open) => set({ isArtefactSheetOpen: open }),
```

- [ ] **Step 4: Run — expect PASS.** `pnpm vitest run tests/unit/current-chat-artefact-state.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add artefact lightbox + sheet state to the current-chat store

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 13: The artefact pill (variant C)

**Files:**
- Create: `src/components/chat/ArtefactPill.tsx`
- Modify: `src/components/chat/Pill.tsx`
- Test: `tests/components/artefact-pill.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — `tests/components/artefact-pill.test.tsx`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import 'fake-indexeddb/auto';
import type { PillRow } from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { Pill } from '../../src/components/chat/Pill.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

function pill(over: Partial<PillRow>, payload: Record<string, unknown>): PillRow {
  return { id: 'p1', messageId: 'm1', kind: 'tool-call', positionHint: 'inline',
    status: 'pending', payload: { name: 'create_artefact', ...payload }, createdAt: 0, ...over };
}

test('building state shows the live character count', () => {
  render(wrap(<Pill row={pill({ status: 'pending' }, { title: 'Calc', charCount: 2300 })} />));
  expect(screen.getByText(/2,?300/)).toBeTruthy();
});

test('completed pill opens the artefact on tap', async () => {
  const id = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'Calc', content: '<x>' });
  render(wrap(<Pill row={pill({ status: 'completed' }, { title: 'Calc', artefactId: id })} />));
  fireEvent.click(screen.getByRole('button', { name: /Calc/ }));
  expect(useCurrentChatStore.getState().openArtefactId).toBe(id);
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm vitest run tests/components/artefact-pill.test.tsx`

- [ ] **Step 3: Implement** `src/components/chat/ArtefactPill.tsx`

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { PillRow } from '../../boot/client-data-db.js';
import { useArtefact } from '../../data/artefacts.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';

interface ArtefactPayload {
  title?: string;
  argumentsJson?: string;
  artefactId?: string;
  charCount?: number;
  error?: string;
}

function titleOf(p: ArtefactPayload): string {
  if (p.title) return p.title;
  if (p.argumentsJson) {
    try {
      const a = JSON.parse(p.argumentsJson) as { title?: string };
      if (typeof a.title === 'string') return a.title;
    } catch {
      /* ignore */
    }
  }
  return 'Artefact';
}

export function ArtefactPill({ row }: { row: PillRow }): JSX.Element {
  const p = (row.payload ?? {}) as ArtefactPayload;
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const artefactId = p.artefactId ?? null;
  // Only query existence once we have an id (completed).
  const { data: artefact, isFetched } = useArtefact(artefactId);
  const title = titleOf(p);
  const building = row.status === 'pending';
  const failed = row.status === 'failed';
  const missing = artefactId !== null && isFetched && artefact === undefined;

  if (building) {
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>⬡</span>
        <span className="artefact-pill-ttl">{title}</span>
        <span className="artefact-pill-badge">HTML</span>
        <span className="artefact-pill-sub">building · {(p.charCount ?? 0).toLocaleString()} chars</span>
        <span className="artefact-pill-bar"><i /></span>
      </span>
    );
  }
  if (failed || missing || artefactId === null) {
    return (
      <span className="artefact-pill" data-state="tombstone" aria-disabled>
        <span className="artefact-pill-ic" aria-hidden>⬡</span>
        <span className="artefact-pill-ttl">{title}</span>
        <span className="artefact-pill-sub">{failed ? 'failed' : 'artefact deleted'}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="artefact-pill"
      data-state="ready"
      data-artefact-pill={artefactId}
      onClick={() => openArtefact(artefactId)}
    >
      <span className="artefact-pill-ic" aria-hidden>⬡</span>
      <span className="artefact-pill-ttl">{title}</span>
      <span className="artefact-pill-badge">HTML</span>
      <span className="artefact-pill-sub">tap to open ↗</span>
    </button>
  );
}
```

- [ ] **Step 4: Delegate in `Pill.tsx`.** Near the top of the `Pill` function body, before the existing logic:

```tsx
  if (row.kind === 'tool-call' && (row.payload as { name?: string } | undefined)?.name === 'create_artefact') {
    return <ArtefactPill row={row} />;
  }
```

Add the import: `import { ArtefactPill } from './ArtefactPill.js';`

- [ ] **Step 5: Run — expect PASS.** `pnpm vitest run tests/components/artefact-pill.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add the artefact pill (variant C: building / ready / tombstone)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 14: Sidebar sectioniser + `ArtefactSheet`

**Files:**
- Create: `src/lib/artefact-sections.ts`
- Create: `src/components/chat/ArtefactSheet.tsx`
- Test: `tests/unit/artefact-sections.test.ts`, `tests/components/artefact-sheet.test.tsx` (new)

- [ ] **Step 1: Write the failing sectioniser test** — `tests/unit/artefact-sections.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { buildArtefactSections } from '../../src/lib/artefact-sections.js';

const mk = (id: string, fav: boolean, t: number): ArtefactRow => ({
  id, chatId: 'c1', personaId: 'p1', projectId: null, origin: 'generated', kind: 'text',
  format: 'html', title: id, fileName: `${id}.html`, mime: 'text/html', content: '', tags: [],
  favourite: fav, createdAt: t, updatedAt: t,
});

test('favourites section = starred; inChat = all newest-first', () => {
  const rows = [mk('a', false, 1), mk('b', true, 3), mk('c', false, 2)];
  const s = buildArtefactSections(rows);
  expect(s.favourites.map((r) => r.id)).toEqual(['b']);
  expect(s.inChat.map((r) => r.id)).toEqual(['b', 'c', 'a']);
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm vitest run tests/unit/artefact-sections.test.ts`

- [ ] **Step 3: Implement** `src/lib/artefact-sections.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../boot/client-data-db.js';

export interface ArtefactSections {
  favourites: ArtefactRow[];
  inChat: ArtefactRow[];
}

/** Favourites = starred (newest first); inChat = all (newest first). A starred
 *  artefact appears in both (lossless, like the ToC pinned+timeline). */
export function buildArtefactSections(rows: ArtefactRow[]): ArtefactSections {
  const ordered = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  return { favourites: ordered.filter((r) => r.favourite), inChat: ordered };
}

/** Format → glyph + colour class for the compact row. */
export function formatGlyph(format: ArtefactRow['format']): { glyph: string; cls: string } {
  if (format === 'markdown') return { glyph: 'M↓', cls: 'g-md' };
  if (format === 'code') return { glyph: '{ }', cls: 'g-code' };
  return { glyph: '</>', cls: 'g-html' };
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm vitest run tests/unit/artefact-sections.test.ts`

- [ ] **Step 5: Write the failing sheet test** — `tests/components/artefact-sheet.test.tsx`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vitest';
import { getClientDataDb } from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { ArtefactSheet } from '../../src/components/chat/ArtefactSheet.js';

afterEach(async () => { await getClientDataDb().delete(); });

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

test('lists chat artefacts; tap calls onOpen', async () => {
  const id = await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'Calc', content: '<x>' });
  const onOpen = vi.fn();
  render(wrap(<ArtefactSheet chatId="c1" onOpen={onOpen} onClose={vi.fn()} />));
  await waitFor(() => screen.getByText('Calc'));
  fireEvent.click(screen.getByRole('button', { name: /Calc/ }));
  expect(onOpen).toHaveBeenCalledWith(id);
});
```

- [ ] **Step 6: Run — expect FAIL.** `pnpm vitest run tests/components/artefact-sheet.test.tsx`

- [ ] **Step 7: Implement** `src/components/chat/ArtefactSheet.tsx` (mirrors `TocSheet`)

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { ArtefactRow } from '../../boot/client-data-db.js';
import {
  useChatArtefacts,
  useRenameArtefact,
  useSetArtefactFavourite,
} from '../../data/artefacts.js';
import { buildArtefactSections, formatGlyph } from '../../lib/artefact-sections.js';

interface Props {
  chatId: string;
  onClose: () => void;
  /** Open an artefact in the lightbox — caller closes the sheet. */
  onOpen: (artefactId: string) => void;
}

export function ArtefactSheet(p: Props): JSX.Element {
  const { data: rows = [] } = useChatArtefacts(p.chatId);
  const setFav = useSetArtefactFavourite(p.chatId);
  const rename = useRenameArtefact(p.chatId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const sections = buildArtefactSections(rows);

  function commitRename(id: string): void {
    const next = draft.trim();
    if (next) void rename.mutateAsync({ id, patch: { title: next } });
    setEditingId(null);
  }

  const renderRow = (r: ArtefactRow): JSX.Element => {
    const g = formatGlyph(r.format);
    return (
      <li key={r.id} className="artefact-row">
        <span className={`artefact-glyph ${g.cls}`} aria-hidden>{g.glyph}</span>
        {editingId === r.id ? (
          <input
            className="artefact-row-input"
            // biome-ignore lint/a11y/noAutofocus: inline rename — focus is the intent
            autoFocus
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(r.id);
              else if (e.key === 'Escape') setEditingId(null);
            }}
            onBlur={() => commitRename(r.id)}
          />
        ) : (
          <button
            type="button"
            className="artefact-row-label"
            onClick={() => { p.onOpen(r.id); p.onClose(); }}
            onDoubleClick={() => { setDraft(r.title); setEditingId(r.id); }}
          >
            {r.title}
          </button>
        )}
        <button
          type="button"
          className="artefact-row-star"
          data-active={r.favourite || undefined}
          aria-label={r.favourite ? 'Remove favourite' : 'Add favourite'}
          onClick={() => void setFav.mutateAsync({ id: r.id, favourite: !r.favourite })}
        >
          <span aria-hidden>{r.favourite ? '★' : '☆'}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="artefact-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div className="artefact-backdrop" data-testid="artefact-backdrop" onClick={p.onClose} />
      <aside className="artefact-sheet" aria-label="Artefacts">
        <header className="artefact-sheet-header">
          <span className="artefact-sheet-title">Artefacts</span>
          <span className="artefact-sheet-count">{rows.length}</span>
          <button type="button" className="artefact-sheet-close" aria-label="Close" onClick={p.onClose}>
            <span aria-hidden>×</span>
          </button>
        </header>
        {sections.favourites.length > 0 ? (
          <section className="artefact-section">
            <h3 className="artefact-section-title">★ Favourites</h3>
            <ul className="artefact-list">{sections.favourites.map(renderRow)}</ul>
          </section>
        ) : null}
        <section className="artefact-section">
          <h3 className="artefact-section-title">In this chat</h3>
          {sections.inChat.length > 0 ? (
            <ul className="artefact-list">{sections.inChat.map(renderRow)}</ul>
          ) : (
            <p className="artefact-empty">Artefacts you create appear here.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
```

> Inline rename uses double-tap to enter edit (single tap opens the artefact, matching decision #20's "tap → lightbox"). Adjust to a small rename affordance if Chris prefers during device test.

- [ ] **Step 8: Run — expect PASS.** `pnpm vitest run tests/components/artefact-sheet.test.tsx`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Add the artefact sidebar sheet + sectioniser

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 15: Wire the strip button + chat-page (sheet + artefact lightbox)

**Files:**
- Modify: `src/components/chat/ReadingToolStrip.tsx`
- Modify: `src/routes/app/chat/chat-page.tsx`
- Test: extend an existing chat-page/reading-strip test, or `tests/components/reading-tool-strip-artefacts.test.tsx` (new)

- [ ] **Step 1: Write a failing strip test** — `tests/components/reading-tool-strip-artefacts.test.tsx`

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ReadingToolStrip } from '../../src/components/chat/ReadingToolStrip.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

test('expanded strip shows an artefacts button that fires onOpenArtefacts', () => {
  useCurrentChatStore.setState({ isToolStripExpanded: true });
  const onOpenArtefacts = vi.fn();
  render(<ReadingToolStrip onOpenToc={vi.fn()} onOpenArtefacts={onOpenArtefacts} />);
  fireEvent.click(screen.getByRole('button', { name: /artefacts/i }));
  expect(onOpenArtefacts).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm vitest run tests/components/reading-tool-strip-artefacts.test.tsx`

- [ ] **Step 3: Add the button** to `ReadingToolStrip.tsx`. Add `onOpenArtefacts: () => void;` to `Props`, and inside the expanded `tool-strip-actions`, after the ToC button:

```tsx
          <button
            type="button"
            className="tool-strip-btn"
            aria-label="Artefacts"
            onClick={p.onOpenArtefacts}
          >
            <span aria-hidden>⬡</span>
          </button>
```

- [ ] **Step 4: Wire chat-page** (`src/routes/app/chat/chat-page.tsx`):

Imports + hooks near the other current-chat selectors:

```tsx
import { ArtefactSheet } from '../../../components/chat/ArtefactSheet.js';
import { Lightbox } from '../../../components/lightbox/Lightbox.js';
import { artefactToViewable } from '../../../components/lightbox/viewable-item.js';
import {
  useChatArtefacts,
  useDeleteArtefact,
  useRenameArtefact,
  useUpdateArtefactContent,
} from '../../../data/artefacts.js';
```

```tsx
  const isArtefactSheetOpen = useCurrentChatStore((s) => s.isArtefactSheetOpen);
  const setArtefactSheetOpen = useCurrentChatStore((s) => s.setArtefactSheetOpen);
  const openArtefactId = useCurrentChatStore((s) => s.openArtefactId);
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const closeArtefact = useCurrentChatStore((s) => s.closeArtefact);
  const { data: chatArtefacts = [] } = useChatArtefacts(chatId);
  const renameArtefact = useRenameArtefact(chatId);
  const editArtefactContent = useUpdateArtefactContent(chatId);
  const removeArtefact = useDeleteArtefact(chatId);
  const artefactItems = chatArtefacts.map(artefactToViewable);
  const artefactIndex = openArtefactId ? artefactItems.findIndex((i) => i.id === openArtefactId) : -1;
```

Pass `onOpenArtefacts` to the existing `ReadingToolStrip` use:

```tsx
        <ReadingToolStrip
          onOpenToc={() => setTocOpen(true)}
          onOpenArtefacts={() => setArtefactSheetOpen(true)}
        />
```

Render the sheet + lightbox near where `TocSheet` is rendered:

```tsx
      {isArtefactSheetOpen ? (
        <ArtefactSheet chatId={chatId} onClose={() => setArtefactSheetOpen(false)} onOpen={openArtefact} />
      ) : null}

      {openArtefactId && artefactIndex >= 0 ? (
        <Lightbox
          items={artefactItems}
          index={artefactIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-artefact-pill="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onRename={(id, patch) => renameArtefact.mutate({ id, patch })}
          onRemove={() => {}}
          onEditText={(id, text) => editArtefactContent.mutate({ id, content: text })}
          onDelete={(id) => { removeArtefact.mutate(id); closeArtefact(); }}
          onClose={closeArtefact}
        />
      ) : null}
```

> Use the actual `chatId` variable name in scope (the file resolves it for queries). If artefacts are opened while the sheet row is the origin, also try `[data-artefact-row="..."]` — optional; falling back to `null` triggers the lightbox's downward-fade close, which is fine.

- [ ] **Step 5: Run touched tests — expect PASS.** `pnpm vitest run tests/components/reading-tool-strip-artefacts.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Wire the artefacts strip button + chat-page sheet/lightbox

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 16: Styles + security log + STATUS update

**Files:**
- Modify: `src/index.css`
- Modify: `obsidian/insights/security-deferrals.md`
- Modify: `obsidian/ARTEFACTS-FEATURE-STATUS.md`

- [ ] **Step 1: Add CSS** in `src/index.css` for the artefact pill (variant C) and the artefact sheet, mirroring the existing `.toc-sheet*` block (positioning `position:absolute; inset:0; z-index:40` bound to `.chat-page`) and the brainstorm mockup. Pill (variant C): icon chip + serif title + `HTML` badge + sub line + a sweeping progress bar (`@keyframes`), tombstone greyed/non-interactive, ready state tappable. Sheet rows: compact one-line, format-coloured glyph (`.g-html` lilac, `.g-md` teal, `.g-code` gold), title, star. Use the existing accent variables. (No unit test — visual; covered by manual verification.)

- [ ] **Step 2: Log the security surface** — append to `obsidian/insights/security-deferrals.md`: a note that the artefact Kern persists model-generated executable HTML rendered via the existing HtmlPreview sandbox (`allow-scripts` w/o `allow-same-origin`, CSP `default-src 'none'`, no external network); the author system prompt forbids external resources but the sandbox is the boundary. Same posture as the lightbox viewer.

- [ ] **Step 3: Update STATUS** — in `obsidian/ARTEFACTS-FEATURE-STATUS.md` set the Kern row (§4) to `✅ done` once Task 17 passes; refresh the header date; note "char-progress + author model = persona model; configurable author model is Chunk 6". Add the `max_tokens: 8192` artefact-size limitation under §2 open notes.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Style the artefact pill + sheet; log security surface; update STATUS

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 17: Full verification

- [ ] **Step 1: Typecheck (root).** `pnpm typecheck` → expect all packages green.
- [ ] **Step 2: Full user-client vitest.** `cd apps/user-client && pnpm vitest run` → expect green (the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline may show; confirm it is identical to master, not a regression).
- [ ] **Step 3: Build (root).** `pnpm run build` → expect all targets built.
- [ ] **Step 4: Biome.** `pnpm biome check` on touched files → clean.
- [ ] **Step 5: Manual verification** — run the spec §13 checklist on device (Chris). Notably: char-progress on an adapter that does NOT stream tool-call args (Ollama Cloud native); the sandboxed app is interactive; dual-rename + delete; sidebar favourites; tombstone after delete; chat-delete warning + cascade.

---

## Self-review notes (author)

- **Spec coverage:** §4 data model → T1/T2; §5 author → T4; §6 tool+registration → T5/T7/T8; §7 pill+progress → T6/T13; §8 lightbox → T9/T10/T11; §9 sidebar → T14/T15; §10 deletion/tombstone → T3/T13/T15; §11 security → T16; §12 testing → per-task + T17; §13 manual → T17.
- **Known limitation:** `max_tokens: 8192` bounds artefact size (T4) — logged in STATUS.
- **Type consistency:** `onRename(id, patch)` patch shape is defined in T10 and consumed identically in T11/T15; `ToolResult.meta` defined T6, produced T7, consumed T6/T13; `IntegrationContext` fields defined T5, set T8, read T7.
- **Deferred to plan-time grep (not a placeholder):** the chat-delete confirmation call site (T3 step 5) — instructions + helper code provided; the implementer greps `useDeleteChat(`.
