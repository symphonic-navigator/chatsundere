# Save as Artefact (Artefact Chunk 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user save any message's visible text as a Markdown artefact, and any fenced code block (or Mermaid diagram) as a format-typed artefact, via one-tap controls — reusing the existing artefact store, sidebar, and lightbox.

**Architecture:** Two new persist functions in `data/artefacts.ts` mirror `addGeneratedArtefact` (no Dexie migration — the v13 schema already carries the `saved-message`/`saved-code-block` origins and `markdown`/`code` formats). A pure `fenceToArtefactMeta(lang)` derives format/MIME/extension. The message control lives in `MessageControls`; the code-block control rides next to the existing `CopyButton`, reaching `chatId`/`personaId` through a small React context provided by `MessageBlock`. One-tap saves immediately and confirms with a `success` toast; rename/tag happen later in the lightbox/Treasury.

**Tech Stack:** TypeScript (strict), React 18, Dexie, TanStack Query, Zustand (toast store), Vitest + Testing Library, fake-indexeddb.

**Spec:** `superpowers/specs/2026-06-06-save-as-artefact-design.md`

**Conventions:**
- Source imports carry `.js` extensions (NodeNext). Every new file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- British English everywhere (incl. "artefact", code comments, toast strings).
- Run a single test file from `apps/user-client`: `pnpm vitest run <path>`.
- Final gate (Task 10): `pnpm typecheck`, `pnpm run build`, full `pnpm test`, `pnpm biome check`.
- All paths below are relative to `apps/user-client/`.

---

### Task 1: `fenceToArtefactMeta` pure helper

Derives an artefact's `format`, `mime`, and file `ext` from a fence language token. Inverse of the lightbox's `format-detect.ts` `LANG_BY_EXT`; the single source of truth for the code-block save path.

**Files:**
- Create: `src/lib/fence-to-artefact.ts`
- Test: `tests/unit/fence-to-artefact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { fenceToArtefactMeta } from '../../src/lib/fence-to-artefact.js';

test('html → renderable html artefact', () => {
  expect(fenceToArtefactMeta('html')).toEqual({ format: 'html', mime: 'text/html', ext: 'html' });
  expect(fenceToArtefactMeta('HTML')).toEqual({ format: 'html', mime: 'text/html', ext: 'html' });
});

test('svg and mermaid map to their structural formats', () => {
  expect(fenceToArtefactMeta('svg')).toEqual({ format: 'svg', mime: 'image/svg+xml', ext: 'svg' });
  expect(fenceToArtefactMeta('mermaid')).toEqual({ format: 'mermaid', mime: 'text/plain', ext: 'mmd' });
});

test('known languages map to their conventional extension', () => {
  expect(fenceToArtefactMeta('python')).toMatchObject({ format: 'code', ext: 'py' });
  expect(fenceToArtefactMeta('typescript')).toMatchObject({ format: 'code', ext: 'ts' });
  expect(fenceToArtefactMeta('csharp')).toMatchObject({ format: 'code', ext: 'cs' });
  expect(fenceToArtefactMeta('bash')).toMatchObject({ format: 'code', ext: 'sh' });
});

test('an unknown but token-safe language uses the token itself as extension', () => {
  expect(fenceToArtefactMeta('zig')).toEqual({ format: 'code', mime: 'text/plain', ext: 'zig' });
});

test('a non-token language falls back to txt', () => {
  expect(fenceToArtefactMeta('c++')).toMatchObject({ format: 'code', ext: 'txt' });
  expect(fenceToArtefactMeta('')).toMatchObject({ format: 'code', ext: 'txt' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/fence-to-artefact.test.ts`
Expected: FAIL — cannot find module `fence-to-artefact.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactFormat } from '../boot/client-data-db.js';

export interface FenceArtefactMeta {
  format: ArtefactFormat;
  mime: string;
  /** File extension without the leading dot. */
  ext: string;
}

/** Fence language tokens whose conventional file extension differs from the
 *  token itself (or that we want to pin). Anything not listed and token-safe
 *  uses the token verbatim as its extension; otherwise it falls back to `txt`. */
const EXT_BY_LANG: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  rust: 'rs',
  ruby: 'rb',
  csharp: 'cs',
  golang: 'go',
  bash: 'sh',
  shell: 'sh',
  markdown: 'md',
  yaml: 'yml',
};

/** Map a fenced-code language token to an artefact's format, MIME, and file
 *  extension. `html` becomes a renderable HTML artefact (same hard-sandboxed
 *  preview as a generated artefact); `svg`/`mermaid` keep their structural
 *  formats; everything else is generic `code`. */
export function fenceToArtefactMeta(lang: string): FenceArtefactMeta {
  const l = lang.trim().toLowerCase();
  if (l === 'html' || l === 'htm') return { format: 'html', mime: 'text/html', ext: 'html' };
  if (l === 'svg') return { format: 'svg', mime: 'image/svg+xml', ext: 'svg' };
  if (l === 'mermaid') return { format: 'mermaid', mime: 'text/plain', ext: 'mmd' };
  const ext = EXT_BY_LANG[l] ?? (/^[a-z0-9]+$/.test(l) ? l : 'txt');
  return { format: 'code', mime: 'text/plain', ext };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/fence-to-artefact.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fence-to-artefact.ts tests/unit/fence-to-artefact.test.ts
git commit -m "Add fenceToArtefactMeta helper for save-as-artefact"
```

---

### Task 2: Artefact title helpers

Default titles for the one-tap save (renameable afterwards in the lightbox).

**Files:**
- Create: `src/lib/artefact-titles.ts`
- Test: `tests/unit/artefact-titles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { codeSnippetTitle, messageSnippetTitle } from '../../src/lib/artefact-titles.js';

test('messageSnippetTitle collapses whitespace and trims', () => {
  expect(messageSnippetTitle('  hello   world\n\nagain ')).toBe('hello world again');
});

test('messageSnippetTitle truncates long text with an ellipsis', () => {
  const title = messageSnippetTitle('x'.repeat(80));
  expect(title.length).toBe(51); // 50 chars + …
  expect(title.endsWith('…')).toBe(true);
});

test('messageSnippetTitle falls back when empty', () => {
  expect(messageSnippetTitle('   \n  ')).toBe('Saved message');
});

test('codeSnippetTitle uses the first non-empty line', () => {
  expect(codeSnippetTitle('\n\n  def main():\n  pass', 'python')).toBe('def main():');
});

test('codeSnippetTitle truncates a long first line', () => {
  const title = codeSnippetTitle(`${'a'.repeat(80)}\nrest`, 'python');
  expect(title.length).toBe(51);
  expect(title.endsWith('…')).toBe(true);
});

test('codeSnippetTitle falls back to "<lang> snippet" when empty', () => {
  expect(codeSnippetTitle('   \n  ', 'python')).toBe('python snippet');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/artefact-titles.test.ts`
Expected: FAIL — cannot find module `artefact-titles.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

const MAX = 50;

function truncate(s: string): string {
  return s.length <= MAX ? s : `${s.slice(0, MAX).trimEnd()}…`;
}

/** Default title for a saved message: visible text, whitespace collapsed,
 *  trimmed, truncated. Falls back to a constant when there is no text. */
export function messageSnippetTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? truncate(collapsed) : 'Saved message';
}

/** Default title for a saved code block: the first non-empty line, truncated.
 *  Falls back to "<lang> snippet" when the code has no meaningful line. */
export function codeSnippetTitle(code: string, lang: string): string {
  const firstLine = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return firstLine ? truncate(firstLine) : `${lang} snippet`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/artefact-titles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artefact-titles.ts tests/unit/artefact-titles.test.ts
git commit -m "Add default-title helpers for save-as-artefact"
```

---

### Task 3: Persist functions + hooks in `data/artefacts.ts`

Two functions mirroring `addGeneratedArtefact`, plus thin mutation hooks reusing the existing `useArtefactInvalidation`.

**Files:**
- Modify: `src/data/artefacts.ts` (add functions after `addGeneratedArtefact` ~line 47; add hooks after `useDeleteArtefact` ~line 209)
- Test: `tests/unit/data-artefacts-saved.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addSavedCodeBlockArtefact, addSavedMessageArtefact } from '../../src/data/artefacts.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('addSavedMessageArtefact stores a markdown row with .md filename', async () => {
  const id = await addSavedMessageArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'A great answer',
    content: '# Heading\n\nbody',
  });
  const row = await openClientDataDb().then((db) => db.artefacts.get(id));
  expect(row).toMatchObject({
    chatId: 'c1',
    personaId: 'p1',
    origin: 'saved-message',
    kind: 'text',
    format: 'markdown',
    title: 'A great answer',
    fileName: 'a-great-answer.md',
    mime: 'text/markdown',
    content: '# Heading\n\nbody',
    favourite: false,
  });
  expect(row?.tags).toEqual([]);
});

test('addSavedCodeBlockArtefact derives format/mime/ext from the language', async () => {
  const htmlId = await addSavedCodeBlockArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Widget',
    content: '<button>hi</button>',
    lang: 'html',
  });
  const pyId = await addSavedCodeBlockArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Solver',
    content: 'print(1)',
    lang: 'python',
  });
  const db = await openClientDataDb();
  expect(await db.artefacts.get(htmlId)).toMatchObject({
    origin: 'saved-code-block',
    format: 'html',
    mime: 'text/html',
    fileName: 'widget.html',
  });
  expect(await db.artefacts.get(pyId)).toMatchObject({
    origin: 'saved-code-block',
    format: 'code',
    fileName: 'solver.py',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/data-artefacts-saved.test.ts`
Expected: FAIL — `addSavedMessageArtefact` is not exported.

- [ ] **Step 3: Add the imports and functions**

In `src/data/artefacts.ts`, add to the top imports:

```ts
import { fenceToArtefactMeta } from '../lib/fence-to-artefact.js';
```

Insert after `addGeneratedArtefact` (after line 47):

```ts
export interface AddSavedMessageArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  /** Concatenated visible message text (markdown). */
  content: string;
}

/** Save a message's visible text as a Markdown artefact. Returns its id. */
export async function addSavedMessageArtefact(
  input: AddSavedMessageArtefactInput,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'saved-message',
    kind: 'text',
    format: 'markdown',
    title: input.title,
    fileName: `${slugify(input.title)}.md`,
    mime: 'text/markdown',
    content: input.content,
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}

export interface AddSavedCodeBlockArtefactInput {
  chatId: string;
  personaId: string;
  title: string;
  content: string;
  /** Fence language token, e.g. 'python', 'html', 'mermaid'. */
  lang: string;
}

/** Save a fenced code block (or Mermaid diagram) as an artefact whose
 *  format/MIME/extension derive from the fence language. Returns its id. */
export async function addSavedCodeBlockArtefact(
  input: AddSavedCodeBlockArtefactInput,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const meta = fenceToArtefactMeta(input.lang);
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'saved-code-block',
    kind: 'text',
    format: meta.format,
    title: input.title,
    fileName: `${slugify(input.title)}.${meta.ext}`,
    mime: meta.mime,
    content: input.content,
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}
```

- [ ] **Step 4: Add the hooks**

Insert after `useDeleteArtefact` (after line 209), reusing the existing `useArtefactInvalidation`:

```ts
/** Mutation hook: save a message's text as a Markdown artefact. */
export function useSaveMessageArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { personaId: string; title: string; content: string }) =>
      addSavedMessageArtefact({ chatId, ...v }),
    onSuccess: () => invalidate(),
  });
}

/** Mutation hook: save a fenced code block (or Mermaid) as an artefact. */
export function useSaveCodeBlockArtefact(chatId: string) {
  const invalidate = useArtefactInvalidation(chatId);
  return useMutation({
    mutationFn: (v: { personaId: string; title: string; content: string; lang: string }) =>
      addSavedCodeBlockArtefact({ chatId, ...v }),
    onSuccess: () => invalidate(),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/data-artefacts-saved.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/data/artefacts.ts tests/unit/data-artefacts-saved.test.ts
git commit -m "Add save-message / save-code-block artefact persist functions and hooks"
```

---

### Task 4: `ArtefactSaveContext` (carries chat/persona + the code-block save callback to markdown blocks)

A React context so `CodeBlock`/`MermaidBlock` can offer a save action without widening the `MarkdownContent` → component-override → block signature. Absent outside a chat message (e.g. the lightbox doc preview) → no save button rendered.

**Files:**
- Create: `src/components/chat/markdown/artefact-save-context.ts`
- Test: `tests/unit/artefact-save-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  ArtefactSaveContext,
  useArtefactSave,
} from '../../src/components/chat/markdown/artefact-save-context.js';

function Probe() {
  const save = useArtefactSave();
  return <div>{save ? `ctx:${save.chatId}/${save.personaId}` : 'no-ctx'}</div>;
}

test('useArtefactSave returns null with no provider', () => {
  render(<Probe />);
  expect(screen.getByText('no-ctx')).toBeTruthy();
});

test('useArtefactSave returns the provided value', () => {
  render(
    <ArtefactSaveContext.Provider
      value={{ chatId: 'c1', personaId: 'p1', saveCodeBlock: () => {} }}
    >
      <Probe />
    </ArtefactSaveContext.Provider>,
  );
  expect(screen.getByText('ctx:c1/p1')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/artefact-save-context.test.tsx`
Expected: FAIL — cannot find module `artefact-save-context.js`.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext } from 'react';

export interface ArtefactSaveContextValue {
  chatId: string;
  personaId: string;
  /** Save a fenced code block (or Mermaid) as an artefact, with a toast. */
  saveCodeBlock: (input: { content: string; lang: string }) => void;
}

/** Provided by MessageBlock around a message's markdown so code/Mermaid blocks
 *  can offer a one-tap save. Null when markdown renders outside a chat message
 *  (e.g. the lightbox doc preview) — the save button is then not rendered. */
export const ArtefactSaveContext = createContext<ArtefactSaveContextValue | null>(null);

export function useArtefactSave(): ArtefactSaveContextValue | null {
  return useContext(ArtefactSaveContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/artefact-save-context.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/markdown/artefact-save-context.ts tests/unit/artefact-save-context.test.tsx
git commit -m "Add ArtefactSaveContext for markdown-block save actions"
```

---

### Task 5: `SaveArtefactButton` (mono-pill chrome, shared by code + Mermaid blocks)

Matches the `CopyButton` visual treatment (sans its own positioning — the parent toolbar positions it). Stops click propagation so saving never toggles the message bubble.

**Files:**
- Create: `src/components/chat/markdown/SaveArtefactButton.tsx`
- Test: `tests/unit/save-artefact-button.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SaveArtefactButton } from '../../src/components/chat/markdown/SaveArtefactButton.js';

test('calls onSave and stops propagation', () => {
  const onSave = vi.fn();
  const onParentClick = vi.fn();
  render(
    // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper
    <div onClick={onParentClick}>
      <SaveArtefactButton onSave={onSave} />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onParentClick).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/save-artefact-button.test.tsx`
Expected: FAIL — cannot find module `SaveArtefactButton.js`.

- [ ] **Step 3: Write the implementation**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent } from 'react';

/** "Save as artefact" button for a markdown code/Mermaid block. Positioning is
 *  owned by the parent toolbar; this is just the pill. Stops click propagation
 *  so saving never toggles the surrounding message bubble. Success feedback is
 *  the global toast fired by the save handler, not an inline state flip. */
export function SaveArtefactButton({
  onSave,
  label = 'Save',
}: {
  onSave: () => void;
  label?: string;
}): JSX.Element {
  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    onSave();
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/45 transition-colors hover:bg-white/15 hover:text-white/70"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/save-artefact-button.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/markdown/SaveArtefactButton.tsx tests/unit/save-artefact-button.test.tsx
git commit -m "Add SaveArtefactButton pill for markdown blocks"
```

---

### Task 6: `CodeBlockActions` toolbar + wire into `CodeBlock`

Refactor the code-block top-right chrome into a flex toolbar holding the Save button (context-gated) and Copy. `CopyButton` loses its own absolute positioning (only used here) and the toolbar positions both.

**Files:**
- Create: `src/components/chat/markdown/CodeBlockActions.tsx`
- Modify: `src/components/chat/markdown/CopyButton.tsx` (drop positioning classes)
- Modify: `src/components/chat/markdown/CodeBlock.tsx` (replace both `<CopyButton/>` with `<CodeBlockActions/>`)
- Test: `tests/unit/code-block-actions.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ArtefactSaveContext } from '../../src/components/chat/markdown/artefact-save-context.js';
import { CodeBlockActions } from '../../src/components/chat/markdown/CodeBlockActions.js';

test('no Save button without a save context (Copy still present)', () => {
  render(<CodeBlockActions codeStr="print(1)" lang="python" />);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
});

test('Save calls saveCodeBlock with the code and language', () => {
  const saveCodeBlock = vi.fn();
  render(
    <ArtefactSaveContext.Provider value={{ chatId: 'c1', personaId: 'p1', saveCodeBlock }}>
      <CodeBlockActions codeStr="print(1)" lang="python" />
    </ArtefactSaveContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(saveCodeBlock).toHaveBeenCalledWith({ content: 'print(1)', lang: 'python' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/code-block-actions.test.tsx`
Expected: FAIL — cannot find module `CodeBlockActions.js`.

- [ ] **Step 3: Write `CodeBlockActions`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useArtefactSave } from './artefact-save-context.js';
import { CopyButton } from './CopyButton.js';
import { SaveArtefactButton } from './SaveArtefactButton.js';

/** Top-right action cluster for a fenced code block: an optional Save (when a
 *  chat-message save context is present) plus the always-present Copy. */
export function CodeBlockActions({
  codeStr,
  lang,
}: {
  codeStr: string;
  lang: string;
}): JSX.Element {
  const save = useArtefactSave();
  return (
    <div className="absolute right-2 top-2 z-10 flex gap-1">
      {save ? (
        <SaveArtefactButton onSave={() => save.saveCodeBlock({ content: codeStr, lang })} />
      ) : null}
      <CopyButton text={codeStr} />
    </div>
  );
}
```

- [ ] **Step 4: Strip positioning from `CopyButton`**

In `src/components/chat/markdown/CopyButton.tsx`, change the button `className` from:

```tsx
      className="absolute right-2 top-2 z-10 rounded border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/45 transition-colors hover:bg-white/15 hover:text-white/70"
```

to (drop the leading `absolute right-2 top-2 z-10 ` — the toolbar positions it now):

```tsx
      className="rounded border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/45 transition-colors hover:bg-white/15 hover:text-white/70"
```

- [ ] **Step 5: Wire `CodeBlockActions` into `CodeBlock`**

In `src/components/chat/markdown/CodeBlock.tsx`:
- Replace the import `import { CopyButton } from './CopyButton.js';` with `import { CodeBlockActions } from './CodeBlockActions.js';`
- In the highlighter branch, replace `<CopyButton text={codeStr} />` with `<CodeBlockActions codeStr={codeStr} lang={lang} />`.
- In the plain branch, replace `<CopyButton text={codeStr} />` with `<CodeBlockActions codeStr={codeStr} lang={lang} />`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/code-block-actions.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/markdown/CodeBlockActions.tsx src/components/chat/markdown/CopyButton.tsx src/components/chat/markdown/CodeBlock.tsx tests/unit/code-block-actions.test.tsx
git commit -m "Wire code-block Save action into a Copy/Save toolbar"
```

---

### Task 7: Mermaid save button

Wrap the rendered diagram in a relative container with a context-gated Save (lang `'mermaid'`).

**Files:**
- Modify: `src/components/chat/markdown/MermaidBlock.tsx`
- Test: `tests/unit/mermaid-save.test.tsx`

- [ ] **Step 1: Write the failing test**

In jsdom, mermaid never resolves a diagram synchronously, so the component shows its raw-source branch on first paint — that branch carries the Save button too, which is what we assert.

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ArtefactSaveContext } from '../../src/components/chat/markdown/artefact-save-context.js';
import { MermaidBlock } from '../../src/components/chat/markdown/MermaidBlock.js';

test('Mermaid shows a Save button when a save context is present', () => {
  const saveCodeBlock = vi.fn();
  render(
    <ArtefactSaveContext.Provider value={{ chatId: 'c1', personaId: 'p1', saveCodeBlock }}>
      <MermaidBlock code={'graph TD; A-->B'} />
    </ArtefactSaveContext.Provider>,
  );
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
});

test('Mermaid has no Save button without a context', () => {
  render(<MermaidBlock code={'graph TD; A-->B'} />);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mermaid-save.test.tsx`
Expected: FAIL — no Save button rendered.

- [ ] **Step 3: Add the imports**

In `src/components/chat/markdown/MermaidBlock.tsx`, add at the top:

```tsx
import { useArtefactSave } from './artefact-save-context.js';
import { SaveArtefactButton } from './SaveArtefactButton.js';
```

- [ ] **Step 4: Build the gated save overlay**

Inside the component, after `const [svg, setSvg] = useState<string | null>(null);`, add:

```tsx
  const save = useArtefactSave();
  const saveOverlay = save ? (
    <div className="absolute right-2 top-2 z-10">
      <SaveArtefactButton onSave={() => save.saveCodeBlock({ content: code, lang: 'mermaid' })} />
    </div>
  ) : null;
```

- [ ] **Step 5: Wrap the raw-source branch**

Change the `if (!svg)` return so the existing `<pre><code>{code}</code></pre>` becomes a child of a `relative` wrapper with the overlay:

```tsx
    return (
      <div className="relative">
        {saveOverlay}
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
```

- [ ] **Step 6: Wrap the rendered-diagram branch**

In the final return, leave the existing diagram `<div>` (the one with the `[&_svg]:max-w-full` className and its `biome-ignore` comment) **exactly as it is**, but make it the child of a new `relative` wrapper that also renders `{saveOverlay}` immediately before it. Concretely: wrap the current returned `<div … />` in `<div className="relative">{saveOverlay}<existing div unchanged /></div>`.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mermaid-save.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/markdown/MermaidBlock.tsx tests/unit/mermaid-save.test.tsx
git commit -m "Add Mermaid save-as-artefact button"
```

---

### Task 8: Message save control in `MessageControls`

A new `◆ Save` control beside the existing ones, disabled (with a tooltip) when the message has no text — disabled over hidden (§11).

**Files:**
- Modify: `src/components/chat/MessageControls.tsx`
- Test: `tests/unit/message-controls-save.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { MessageControls } from '../../src/components/chat/MessageControls.js';

function msg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

test('Save is enabled and fires onSave when canSave', () => {
  const onSave = vi.fn();
  render(
    <MessageControls
      message={msg()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
      onSave={onSave}
      canSave={true}
    />,
  );
  const btn = screen.getByRole('button', { name: /Save/ });
  expect(btn).not.toBeDisabled();
  fireEvent.click(btn);
  expect(onSave).toHaveBeenCalledOnce();
});

test('Save is disabled with a tooltip when not saveable', () => {
  render(
    <MessageControls
      message={msg({ contentBlocks: [{ type: 'pill', pillId: 'x' }] })}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
      onSave={vi.fn()}
      canSave={false}
    />,
  );
  const btn = screen.getByRole('button', { name: /Save/ });
  expect(btn).toBeDisabled();
  expect(btn.getAttribute('title')).toBe('No text to save');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/message-controls-save.test.tsx`
Expected: FAIL — `onSave`/`canSave` are not props; no Save button.

- [ ] **Step 3: Extend the props and add the button**

In `src/components/chat/MessageControls.tsx`, extend `Props`:

```ts
interface Props {
  message: MessageRow;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
  /** Fork the chat at this message. */
  onBranch?: () => void;
  /** Disable branching (e.g. while a stream is live for this chat). */
  branchDisabled?: boolean;
  /** Save this message's visible text as a Markdown artefact. */
  onSave?: () => void;
  /** Whether the message has text to save (disabled-over-hidden otherwise). */
  canSave?: boolean;
}
```

Add the button immediately before the disabled `▸ Read` button:

```tsx
      <button
        type="button"
        data-ctrl="save"
        onClick={p.onSave}
        disabled={!p.canSave || !p.onSave}
        title={p.canSave ? 'Save this message as an artefact' : 'No text to save'}
        className="ctrl-btn"
      >
        ◆ Save
      </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/message-controls-save.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageControls.tsx tests/unit/message-controls-save.test.tsx
git commit -m "Add Save control to MessageControls (disabled over hidden)"
```

---

### Task 9: Wire `MessageBlock` — provide context, compute text, hooks, toast

`MessageBlock` provides `ArtefactSaveContext` around its markdown, computes the message's text content + `canSave`, and passes the message-save handler to `MessageControls`. Both handlers fire a `success` toast.

**Files:**
- Modify: `src/components/chat/MessageBlock.tsx`
- Test: `tests/unit/message-block-save.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import type { MessageRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { MessageBlock } from '../../src/components/chat/MessageBlock.js';
import { listChatArtefacts } from '../../src/data/artefacts.js';
import { useToastStore } from '../../src/state/toast.store.js';
import type { ResolvedMindspace } from '../../src/state/mindspace-resolver.js';

const mindspaceStub = {} as ResolvedMindspace;
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const persona = { id: 'p1', name: 'Aurum', font: 'serif', colour: '#c9a84c' } as PersonaRow;
function personaMsg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm-p',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'A thoughtful reply.' }],
    createdAt: 2,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  useToastStore.getState().clear();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('saving a message persists a markdown artefact and shows a toast', async () => {
  render(
    <MessageBlock
      message={personaMsg()}
      pills={new Map()}
      mindspace={mindspaceStub}
      persona={persona}
      displayName="Chris"
      expanded={true}
      onToggleExpand={vi.fn()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
    />,
    { wrapper },
  );
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(async () => {
    const rows = await listChatArtefacts('c1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: 'saved-message', format: 'markdown' });
  });
  expect(useToastStore.getState().toasts.some((t) => t.message.startsWith('Saved'))).toBe(true);
});

test('Save is disabled for a text-less message', () => {
  render(
    <MessageBlock
      message={personaMsg({ contentBlocks: [{ type: 'pill', pillId: 'x' }] })}
      pills={new Map()}
      mindspace={mindspaceStub}
      persona={persona}
      displayName="Chris"
      expanded={true}
      onToggleExpand={vi.fn()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
    />,
    { wrapper },
  );
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/message-block-save.test.tsx`
Expected: FAIL — no Save button wired / not persisting.

- [ ] **Step 3: Add imports to `MessageBlock.tsx`**

```tsx
import { useSaveCodeBlockArtefact, useSaveMessageArtefact } from '../../data/artefacts.js';
import { toastStore } from '../../state/toast.store.js';
import { codeSnippetTitle, messageSnippetTitle } from '../../lib/artefact-titles.js';
import { ArtefactSaveContext } from './markdown/artefact-save-context.js';
```

- [ ] **Step 4: Compute content, hooks, handlers**

Inside the component, after the existing attachment query setup (and before the `return`), add:

```tsx
  const personaId = p.persona?.id ?? null;
  const saveMessage = useSaveMessageArtefact(p.message.chatId);
  const saveCode = useSaveCodeBlockArtefact(p.message.chatId);

  const textContent = p.message.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const canSaveMessage = personaId !== null && textContent.trim().length > 0;

  function confirmSaved(title: string): void {
    toastStore.show({ message: `Saved «${title}»`, tone: 'success', durationMs: 2500 });
  }
  function warnFailed(): void {
    toastStore.show({ message: 'Could not save artefact', tone: 'warn', durationMs: 2500 });
  }

  function handleSaveMessage(): void {
    if (personaId === null || !canSaveMessage) return;
    const title = messageSnippetTitle(textContent);
    saveMessage.mutate(
      { personaId, title, content: textContent },
      { onSuccess: () => confirmSaved(title), onError: warnFailed },
    );
  }

  const saveCtx =
    personaId === null
      ? null
      : {
          chatId: p.message.chatId,
          personaId,
          saveCodeBlock: ({ content, lang }: { content: string; lang: string }) => {
            const title = codeSnippetTitle(content, lang);
            saveCode.mutate(
              { personaId, title, content, lang },
              { onSuccess: () => confirmSaved(title), onError: warnFailed },
            );
          },
        };
```

- [ ] **Step 5: Wrap the markdown surface with the provider**

Wrap the `renderBlocks(...)` call inside `.msg-text` with `<ArtefactSaveContext.Provider value={saveCtx}>…</ArtefactSaveContext.Provider>` (leave the `renderBlocks` arguments unchanged).

- [ ] **Step 6: Pass the message-save props to `MessageControls`**

Add `onSave={handleSaveMessage}` and `canSave={canSaveMessage}` to the existing `<MessageControls … />` usage.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/message-block-save.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Run the existing MessageBlock tests to confirm no regression**

Run: `pnpm vitest run tests/unit/message-block.test.tsx tests/unit/message-block-attachments.test.tsx`
Expected: PASS (unchanged).

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/MessageBlock.tsx tests/unit/message-block-save.test.tsx
git commit -m "Wire message + code-block save-as-artefact into MessageBlock"
```

---

### Task 10: Docs, security note, and final verification

**Files:**
- Modify: `obsidian/insights/security-deferrals.md`
- Modify: `obsidian/ARTEFACTS-FEATURE-STATUS.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Security-deferrals note**

Append a short note to `obsidian/insights/security-deferrals.md`: save-as-artefact (Chunk 4) is another producer of the already-logged persisted-HTML surface — a saved `html` code block is previewed by the *same* hard-sandboxed `HtmlPreview` (null origin, `default-src 'none'`, no network). No new execution or network surface; no new control needed.

- [ ] **Step 2: Run the full verification gate**

```bash
cd apps/user-client
pnpm typecheck
pnpm run build
pnpm test
pnpm biome check src tests
```

Expected: typecheck clean; build green; full Vitest suite green (≈17 new tests added on top of the prior count); biome clean. Fix anything that fails before continuing.

- [ ] **Step 3: Update the artefact + client STATUS docs**

- In `obsidian/ARTEFACTS-FEATURE-STATUS.md`: set the §4 table row 4 (Save as artefact) to `✅ done`; add a header entry summarising the landing; add a decision-log entry recording "saved html code block → renderable HTML artefact (reuses the Chunk-1 sandbox); svg→svg, mermaid→mermaid, else code; message save = visible text blocks only". Update the header date.
- In `obsidian/STATUS-CLIENT-ONLY.md`: add a new top "Done" entry summarising Chunk 4, refresh the "Next session" pointer, and update `Last updated:`.

- [ ] **Step 4: Commit the docs (doc-only → `[skip ci]`)**

```bash
cd ../..
git add obsidian/
git commit -m "Record save-as-artefact (Chunk 4) in STATUS and decision log [skip ci]"
```

---

## Self-Review

- **Spec coverage:** §3 data functions → Task 3; §4 fence mapping → Task 1; §5.1 message control → Tasks 8–9; §5.2 code-block control + context → Tasks 4–7, 9; §6 titles + toast → Tasks 2, 9; §7 tests → every task; §8 security → Task 10; §9 out-of-scope respected (no sheet, no toast action, no language-less fences, no `sourceMessageId`). All covered.
- **Type consistency:** `fenceToArtefactMeta` returns `{ format, mime, ext }` (Task 1) consumed identically in Task 3; `ArtefactSaveContextValue.saveCodeBlock({ content, lang })` (Task 4) is called with exactly that shape in Tasks 6, 7, 9; `useSaveMessageArtefact`/`useSaveCodeBlockArtefact` mutationFn args (`{ personaId, title, content[, lang] }`, Task 3) match the `.mutate(...)` calls in Task 9; `MessageControls` `onSave`/`canSave` (Task 8) match the props passed in Task 9.
- **Placeholder scan:** none — every code step is complete.
- **Note on imports:** existing source uses `.js` extensions; tests in `tests/unit` mix styles. If a component-test import without `.js` fails to resolve under the test config, add the `.js` extension (matches `data-artefacts.test.ts`).
