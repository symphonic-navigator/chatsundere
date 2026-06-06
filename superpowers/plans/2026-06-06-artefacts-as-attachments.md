# Artefacts as Attachments (Chunk 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach an existing artefact to a chat message by copying a snapshot into the existing `attachments` flow, via a slim Treasury picker reached from the cockpit `(+)` menu.

**Architecture:** A new `addArtefactSnapshot()` maps an `ArtefactRow` → a pending `kind:'text'` attachment (reusing `addAttachment`, `origin:'upload'`). A new `ArtefactPicker` bottom-sheet (search-first, select-only, NSFW-gated via `useFilteredPersonas`) snapshots the chosen artefacts. The cockpit `(+)` button becomes a two-item source menu (*Upload from device* / *Attach from Treasury*); the picker is rendered at chat-page level (not inside `.cockpit`, whose `backdrop-filter` would trap an absolute overlay). No Dexie migration; the send/wire path is untouched.

**Tech Stack:** TypeScript (strict), React 18, TanStack Query, Dexie (IndexedDB), Vitest + RTL + `fake-indexeddb`, Tailwind v4 / hand-written CSS in `index.css`, Biome.

Spec: `superpowers/specs/2026-06-06-artefacts-as-attachments-design.md`.

**Working directory for all commands:** `apps/user-client` (run `cd apps/user-client` first). Test a single file with `pnpm exec vitest run <path>`. Typecheck with `pnpm typecheck`.

**Commit convention:** free-form imperative subject; trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Code commits do **not** carry `[skip ci]`; the final doc-only task does. **Subagents never push, merge, or switch branches.**

---

### Task 1: Snapshot data helper

**Files:**
- Modify: `apps/user-client/src/data/attachments.ts`
- Test: `apps/user-client/tests/unit/artefact-snapshot.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/unit/artefact-snapshot.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addArtefactSnapshot, listPendingAttachments } from '../../src/data/attachments.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

function artefact(over: Partial<ArtefactRow> = {}): ArtefactRow {
  const now = Date.now();
  return {
    id: 'a1',
    chatId: 'src-chat',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'Pomodoro Timer',
    fileName: 'pomodoro.html',
    mime: 'text/html',
    content: '<!doctype html><body>hi</body>',
    tags: ['timer'],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('addArtefactSnapshot', () => {
  it('copies content/fileName/mime into a pending text attachment on the target chat', async () => {
    await addArtefactSnapshot('dest-chat', artefact());
    const pending = await listPendingAttachments('dest-chat');
    expect(pending).toHaveLength(1);
    const a = pending[0]!;
    expect(a.kind).toBe('text');
    expect(a.origin).toBe('upload');
    expect(a.messageId).toBeNull();
    expect(a.fileName).toBe('pomodoro.html');
    expect(a.mime).toBe('text/html');
    expect(a.text).toBe('<!doctype html><body>hi</body>');
    expect(a.blob).toBeUndefined();
  });

  it('does not copy title or tags (attachments have neither)', async () => {
    await addArtefactSnapshot('dest-chat', artefact());
    const [a] = await listPendingAttachments('dest-chat');
    expect(a).not.toHaveProperty('title');
    expect(a).not.toHaveProperty('tags');
  });

  it('snapshots are independent copies — two attaches yield two rows', async () => {
    await addArtefactSnapshot('dest-chat', artefact());
    await addArtefactSnapshot('dest-chat', artefact());
    expect(await listPendingAttachments('dest-chat')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/artefact-snapshot.test.ts`
Expected: FAIL — `addArtefactSnapshot` is not exported.

- [ ] **Step 3: Implement the helper and the batch hook**

In `apps/user-client/src/data/attachments.ts`, extend the existing import of the db module to also bring in `ArtefactRow`:

```ts
import {
  type ArtefactRow,
  type AttachmentKind,
  type AttachmentRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
```

Then add, directly after `addAttachment` (after line ~53):

```ts
/**
 * Copy an artefact's current content into the chat as a pending attachment — a
 * snapshot. Lifecycle is decoupled from the artefact: deleting the artefact
 * later never touches the message. Text artefacts only; an image artefact (TTI,
 * future) would need a blob branch and is out of scope.
 */
export async function addArtefactSnapshot(chatId: string, artefact: ArtefactRow): Promise<string> {
  return addAttachment({
    chatId,
    kind: 'text',
    fileName: artefact.fileName,
    mime: artefact.mime,
    text: artefact.content,
  });
}
```

And add this hook at the end of the file (after `useUpdateAttachmentText`):

```ts
/**
 * Mutation hook: snapshot a batch of artefacts into the chat's pending set, then
 * invalidate the pending query once (mirrors `Cockpit.ingest`).
 */
export function useAddArtefactSnapshots(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (artefacts: ArtefactRow[]) => {
      for (const a of artefacts) await addArtefactSnapshot(chatId, a);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/artefact-snapshot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/data/attachments.ts apps/user-client/tests/unit/artefact-snapshot.test.ts
git commit -m "Add artefact-snapshot data helper for attaching artefacts

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Extract the outside-dismiss hook (shared by both cockpit menus)

The cockpit's `(⋯)` menu has an inline outside-tap/Escape close effect. The new `(+)` source menu needs the same behaviour. Extract it once, rewire the existing menu, so there is a single implementation.

**Files:**
- Create: `apps/user-client/src/lib/use-dismiss-on-outside.ts`
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx` (rewire the `(⋯)` menu only in this task)

- [ ] **Step 1: Write the hook**

Create `apps/user-client/src/lib/use-dismiss-on-outside.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type RefObject, useEffect, useRef } from 'react';

/**
 * Close a transient popover when the user taps outside `ref` or presses Escape.
 * No-op while `open` is false. `onClose` is read through a ref so an inline
 * arrow callback does not re-subscribe the listeners on every render (preserving
 * the original `[open]`-only effect dependency).
 */
export function useDismissOnOutside(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target || !ref.current) return;
      if (ref.current.contains(target)) return;
      cb.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cb.current();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
}
```

- [ ] **Step 2: Rewire the existing `(⋯)` menu to use the hook**

In `apps/user-client/src/components/chat/Cockpit.tsx`:

1. Add the import near the other `../../lib/...` imports:

```ts
import { useDismissOnOutside } from '../../lib/use-dismiss-on-outside.js';
```

2. Delete the entire inline effect that closes the `(⋯)` menu — the block beginning with the comment `// Close the menu when the user clicks anywhere outside the wrap, or presses` and ending at its `}, [menuOpen]);` (the `useEffect` using `menuWrapRef`). Keep the `menuWrapRef` declaration.

3. Immediately after the `menuWrapRef` declaration (`const menuWrapRef = useRef<HTMLDivElement>(null);`), add:

```ts
useDismissOnOutside(menuOpen, menuWrapRef, () => setMenuOpen(false));
```

- [ ] **Step 3: Run the cockpit tests to verify the refactor is safe**

Run: `pnpm exec vitest run tests/unit/cockpit-menu.test.tsx tests/unit/cockpit.test.tsx tests/unit/cockpit-attachments.test.tsx`
Expected: PASS (same counts as before the change).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/use-dismiss-on-outside.ts apps/user-client/src/components/chat/Cockpit.tsx
git commit -m "Extract useDismissOnOutside hook from the cockpit menu

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: The ArtefactPicker bottom-sheet

**Files:**
- Create: `apps/user-client/src/components/artefact/ArtefactPicker.tsx`
- Test: `apps/user-client/tests/components/artefact-picker.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/artefact-picker.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { ArtefactPicker } from '../../src/components/artefact/ArtefactPicker.js';
import { listPendingAttachments } from '../../src/data/attachments.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

async function seedPersona(id: string, name: string, adultPersona = false): Promise<void> {
  const now = Date.now();
  await getClientDataDb().personas.add({
    id,
    name,
    tagline: '',
    colour: '#8d6dff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona,
    chatsundereTonality: true,
    contextWindow: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedArtefact(
  id: string,
  personaId: string,
  title: string,
  format: 'html' | 'markdown',
): Promise<void> {
  const now = Date.now();
  await getClientDataDb().artefacts.add({
    id,
    chatId: `c-${id}`,
    personaId,
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format,
    title,
    fileName: `${title}.${format === 'html' ? 'html' : 'md'}`,
    mime: format === 'html' ? 'text/html' : 'text/markdown',
    content: '<x>',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  });
}

function renderPicker(onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ArtefactPicker chatId="dest" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('ArtefactPicker', () => {
  it('lists visible artefacts and hides NSFW-persona artefacts in SFW mode', async () => {
    await seedPersona('sfw', 'Mei', false);
    await seedPersona('nsfw', 'Noir', true);
    // adultMode defaults to 'nsfw' (settings seed) — force SFW so the adult
    // persona is filtered out, mirroring the Treasury NSFW-leak test.
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'nsfw', 'Secret', 'html');
    renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('filters by type tab and by search', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'sfw', 'Notes', 'markdown');
    renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(screen.queryByText('Pomodoro')).not.toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.change(screen.getByPlaceholderText(/search artefacts/i), {
      target: { value: 'pomo' },
    });
    expect(screen.getByText('Pomodoro')).toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('Attach is disabled until something is selected; the count reflects selection', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    const attach = (): HTMLButtonElement => screen.getByRole('button', { name: /attach \(/i });
    expect(attach().disabled).toBe(true);
    expect(attach().textContent).toContain('(0)');
    fireEvent.click(screen.getByText('Pomodoro'));
    expect(attach().disabled).toBe(false);
    expect(attach().textContent).toContain('(1)');
  });

  it('attaching snapshots the selection into the chat and closes', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'sfw', 'Notes', 'markdown');
    const { onClose } = renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByText('Notes'));
    fireEvent.click(screen.getByRole('button', { name: /attach \(2\)/i }));
    await waitFor(async () => expect(await listPendingAttachments('dest')).toHaveLength(2));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/components/artefact-picker.test.tsx`
Expected: FAIL — module `ArtefactPicker` not found.

- [ ] **Step 3: Implement the component**

Create `apps/user-client/src/components/artefact/ArtefactPicker.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { useAllArtefacts } from '../../data/artefacts.js';
import { useAddArtefactSnapshots } from '../../data/attachments.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { formatGlyph } from '../../lib/artefact-sections.js';
import { type TreasuryType, applyTreasuryFilters } from '../../lib/treasury-filter.js';
import { HistorySearchBar } from '../history/HistorySearchBar.js';
import { TypeTabs } from '../treasury/TypeTabs.js';

interface Props {
  chatId: string;
  onClose: () => void;
}

/**
 * Slim Treasury picker: pick existing artefacts to attach (as snapshots) to the
 * current chat's next message. Search-first; type tabs narrow by kind. Selection
 * only — no in-picker preview (inspect in the Treasury). NSFW gating mirrors the
 * Treasury via useFilteredPersonas, so an adult persona's artefacts never appear
 * in SFW mode.
 */
export function ArtefactPicker(p: Props): JSX.Element {
  const { data: rows = [] } = useAllArtefacts();
  const personas = useFilteredPersonas();
  const snapshot = useAddArtefactSnapshots(p.chatId);

  const [type, setType] = useState<TreasuryType>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visiblePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((pp) => pp.id)),
    [personas.data],
  );
  const visibleRows = useMemo(
    () => rows.filter((r) => visiblePersonaIds.has(r.personaId)),
    [rows, visiblePersonaIds],
  );
  const filtered = useMemo(
    () =>
      applyTreasuryFilters(visibleRows, {
        type,
        personaId: null,
        tags: [],
        favourite: false,
        query,
      }),
    [visibleRows, type, query],
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function attach(): Promise<void> {
    const chosen = filtered.filter((r) => selected.has(r.id));
    if (chosen.length === 0) return;
    await snapshot.mutateAsync(chosen);
    p.onClose();
  }

  return (
    <div className="artefact-picker-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; the × is the keyboard path */}
      <div
        className="artefact-picker-backdrop"
        data-testid="artefact-picker-backdrop"
        onClick={p.onClose}
      />
      <aside className="artefact-picker" aria-label="Attach from Treasury">
        <header className="artefact-picker-header">
          <span className="artefact-picker-title">Attach from Treasury</span>
          <button
            type="button"
            className="artefact-picker-close"
            aria-label="Close"
            onClick={p.onClose}
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <TypeTabs value={type} onChange={setType} />
        <HistorySearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search artefacts by name…"
        />
        {filtered.length > 0 ? (
          <ul className="artefact-picker-list">
            {filtered.map((r) => {
              const g = formatGlyph(r.format);
              const on = selected.has(r.id);
              return (
                <li key={r.id} className="artefact-picker-row" data-selected={on || undefined}>
                  <button
                    type="button"
                    className="artefact-picker-row-body"
                    aria-pressed={on}
                    onClick={() => toggle(r.id)}
                  >
                    <span className={`artefact-glyph ${g.cls}`} aria-hidden>
                      {g.glyph}
                    </span>
                    <span className="artefact-picker-row-title">{r.title}</span>
                    <span className="artefact-picker-row-chip">{r.format.toUpperCase()}</span>
                    <span className="artefact-picker-check" data-on={on || undefined} aria-hidden>
                      {on ? '✓' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="artefact-picker-empty">
            {visibleRows.length === 0 ? 'No artefacts yet.' : 'No matches.'}
          </p>
        )}
        <div className="artefact-picker-actions">
          <button
            type="button"
            className="artefact-picker-attach"
            disabled={selected.size === 0 || snapshot.isPending}
            onClick={() => void attach()}
          >
            Attach ({selected.size})
          </button>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/components/artefact-picker.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/artefact/ArtefactPicker.tsx apps/user-client/tests/components/artefact-picker.test.tsx
git commit -m "Add ArtefactPicker bottom-sheet for attaching artefacts

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Cockpit `(+)` source menu

Convert the `(+)` button into a two-item source menu **only when** an `onAttachFromTreasury` handler is supplied; without it, `(+)` keeps its current behaviour (open the file dialog directly). This preserves the existing cockpit tests.

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Test: `apps/user-client/tests/unit/cockpit-source-menu.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/unit/cockpit-source-menu.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
const persona = { id: 'p', name: 'Aurum', font: 'serif' } as never;
const offering = { profile: { vision: true } } as never;

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

function renderCockpit(extra: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <Cockpit
      chatId="c1"
      persona={persona}
      offering={offering}
      draftValue=""
      onDraftChange={() => {}}
      onSend={() => {}}
      isStreamLive={false}
      {...extra}
    />,
    { wrapper: wrap(qc) },
  );
}

describe('Cockpit (+) source menu', () => {
  it('opens a two-item menu when an attach handler is supplied', () => {
    const onAttachFromTreasury = vi.fn();
    const { container } = renderCockpit({ onAttachFromTreasury });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    expect(container.querySelector('[data-source="upload"]')).toBeInTheDocument();
    expect(container.querySelector('[data-source="treasury"]')).toBeInTheDocument();
  });

  it('the Treasury item fires the handler and closes the menu', () => {
    const onAttachFromTreasury = vi.fn();
    const { container } = renderCockpit({ onAttachFromTreasury });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-source="treasury"]') as HTMLElement);
    expect(onAttachFromTreasury).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-source="treasury"]')).not.toBeInTheDocument();
  });

  it('Escape closes the menu', () => {
    const { container } = renderCockpit({ onAttachFromTreasury: vi.fn() });
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    expect(container.querySelector('[data-source="upload"]')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[data-source="upload"]')).not.toBeInTheDocument();
  });

  it('without an attach handler, (+) opens no menu (back-compat)', () => {
    const { container } = renderCockpit();
    fireEvent.click(container.querySelector('[data-control="plus"]') as HTMLElement);
    expect(container.querySelector('[data-source="upload"]')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/cockpit-source-menu.test.tsx`
Expected: FAIL — no `[data-source]` elements; `onAttachFromTreasury` prop unknown to TS.

- [ ] **Step 3: Implement the source menu**

In `apps/user-client/src/components/chat/Cockpit.tsx`:

1. Add to the `Props` interface (after `toolsAvailable?`):

```ts
  /** Open the Treasury attach picker (omitted → (+) opens the file dialog directly). */
  onAttachFromTreasury?: () => void;
```

2. Add state + ref + dismiss wiring. Next to `const [menuOpen, setMenuOpen] = useState(false);` add:

```ts
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
```

Next to the existing `menuWrapRef` declaration add:

```ts
  const plusWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(sourceMenuOpen, plusWrapRef, () => setSourceMenuOpen(false));
```

(`useDismissOnOutside` is already imported from Task 2.)

3. Replace the existing `(+)` button block (the `<button ... data-control="plus" ...>` with its SVG and `onClick={() => fileInputRef.current?.click()}`) with this wrapped version:

```tsx
        <div ref={plusWrapRef} className="cockpit-menu-wrap">
          <button
            type="button"
            className="cockpit-icon-btn"
            data-control="plus"
            title="Add attachment"
            aria-label="Add attachment"
            aria-expanded={p.onAttachFromTreasury ? sourceMenuOpen : undefined}
            onClick={() => {
              if (p.onAttachFromTreasury) setSourceMenuOpen((v) => !v);
              else fileInputRef.current?.click();
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {sourceMenuOpen && p.onAttachFromTreasury ? (
            <div className="cockpit-menu" role="menu">
              <button
                type="button"
                className="cockpit-menu-item"
                role="menuitem"
                data-source="upload"
                onClick={() => {
                  setSourceMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span aria-hidden>📎</span> Upload from device
              </button>
              <button
                type="button"
                className="cockpit-menu-item"
                role="menuitem"
                data-source="treasury"
                onClick={() => {
                  setSourceMenuOpen(false);
                  p.onAttachFromTreasury?.();
                }}
              >
                <span aria-hidden>⬡</span> Attach from Treasury
              </button>
            </div>
          ) : null}
        </div>
```

- [ ] **Step 4: Run the new test and the existing cockpit tests**

Run: `pnpm exec vitest run tests/unit/cockpit-source-menu.test.tsx tests/unit/cockpit.test.tsx tests/unit/cockpit-attachments.test.tsx tests/unit/cockpit-menu.test.tsx`
Expected: PASS — new file 4/4; the others unchanged.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/tests/unit/cockpit-source-menu.test.tsx
git commit -m "Turn the cockpit (+) button into a source menu

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Wire the picker through InteractionMode and chat-page

**Files:**
- Modify: `apps/user-client/src/components/chat/InteractionMode.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`

- [ ] **Step 1: Thread the prop through InteractionMode**

In `apps/user-client/src/components/chat/InteractionMode.tsx`:

1. In the `Props` interface, after `onOpenArtefacts?: () => void;` add:

```ts
  onAttachFromTreasury?: () => void;
```

2. In the `<Cockpit ... />` render (where `onOpenArtefacts={p.onOpenArtefacts}` is passed), add the line:

```tsx
          onAttachFromTreasury={p.onAttachFromTreasury}
```

- [ ] **Step 2: Render the picker in chat-page and open it from the menu**

In `apps/user-client/src/routes/app/chat/chat-page.tsx`:

1. Add the import near the other component imports (alongside `ArtefactSheet`):

```ts
import { ArtefactPicker } from '../../../components/artefact/ArtefactPicker.js';
```

2. Add local state near the other sheet state (e.g. next to where `tocOpen` is declared — find `const [tocOpen` and add after it). If `useState` is already imported (it is), add:

```ts
  const [pickerOpen, setPickerOpen] = useState(false);
```

3. In the `<InteractionMode ... />` block (around line 554-571), after `onOpenArtefacts={() => setArtefactSheetOpen(true)}` add:

```tsx
          onAttachFromTreasury={() => setPickerOpen(true)}
```

4. Render the picker next to the other sheets (after the `{isArtefactSheetOpen ? (...) : null}` block, before/after the artefact `Lightbox` block):

```tsx
      {pickerOpen ? (
        <ArtefactPicker
          chatId={chat?.id ?? activeChatId ?? ''}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
```

(Use the same chatId expression the `<InteractionMode>` block uses for `chatId` — confirm it reads `chat?.id ?? activeChatId ?? ''` in this file; match it exactly.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Run the full user-client suite**

Run: `pnpm test`
Expected: green except the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline failures noted in STATUS — confirm the count of failures is unchanged from master (no *new* failures). If any new failure appears, fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Wire the artefact attach picker into the chat page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Styling

Add the source-menu item style and the picker bottom-sheet styles. Reuse the established sheet/menu tokens; mirror `.branch-sheet*`/`.toc-sheet*` (bottom-sheet chrome) and `.cockpit-menu*` (the `(+)` menu).

**Files:**
- Modify: `apps/user-client/src/index.css`

- [ ] **Step 1: Add the CSS**

Append to `apps/user-client/src/index.css` (end of file):

```css
/* ===== Cockpit (+) source-menu item ===================================== */
.cockpit-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.6rem;
  border-radius: 0.4rem;
  color: var(--color-paper, #e6e6e6);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 0.9rem;
}
.cockpit-menu-item + .cockpit-menu-item {
  margin-top: 0.15rem;
}
.cockpit-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Artefact attach picker (bottom-sheet; mirrors .branch-sheet) ====== */
.artefact-picker-root {
  position: absolute;
  inset: 0;
  z-index: 40;
}
.artefact-picker-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.artefact-picker {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 80%;
  background: var(--color-ink, #1a1a1a);
  border-top: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 12%, transparent);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.artefact-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.artefact-picker-title {
  font-family: var(--font-display, serif);
  font-size: 1.05rem;
  color: var(--color-paper, #e6e6e6);
}
.artefact-picker-close {
  background: transparent;
  border: 0;
  color: var(--color-paper, #e6e6e6);
  opacity: 0.7;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
}
.artefact-picker-close:hover {
  opacity: 1;
}
.artefact-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.artefact-picker-row-body {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.5rem 0.4rem;
  background: transparent;
  border: 0;
  border-radius: 0.4rem;
  color: var(--color-paper, #e6e6e6);
  cursor: pointer;
  text-align: left;
}
.artefact-picker-row[data-selected] .artefact-picker-row-body,
.artefact-picker-row-body:hover {
  background: rgba(255, 255, 255, 0.06);
}
.artefact-picker-row-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artefact-picker-row-chip {
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  opacity: 0.6;
  border: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 16%, transparent);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
}
.artefact-picker-check {
  width: 1.1rem;
  height: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--color-paper, #e6e6e6) 30%, transparent);
  border-radius: 0.3rem;
  font-size: 0.8rem;
}
.artefact-picker-check[data-on] {
  background: color-mix(in srgb, var(--color-accent, #c9a227) 70%, transparent);
  border-color: transparent;
  color: #1a1a1a;
}
.artefact-picker-empty {
  opacity: 0.6;
  font-size: 0.9rem;
  padding: 1.5rem 0.4rem;
  text-align: center;
}
.artefact-picker-actions {
  display: flex;
  justify-content: flex-end;
}
.artefact-picker-attach {
  padding: 0.5rem 1.1rem;
  border-radius: 0.4rem;
  color: var(--color-paper, #e6e6e6);
  background: color-mix(in srgb, var(--color-accent, #c9a227) 22%, transparent);
  cursor: pointer;
}
.artefact-picker-attach:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Build to confirm the CSS compiles**

Run: `pnpm build`
Expected: succeeds (tsc + vite build).

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/index.css
git commit -m "Style the artefact attach picker and source menu

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Final verification & documentation

**Files:**
- Modify: `obsidian/ARTEFACTS-FEATURE-STATUS.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`
- Modify: `obsidian/insights/security-deferrals.md`

- [ ] **Step 1: Full verification gate**

Run, from the repo root:
- `pnpm run build` — expected 9/9 packages build.
- From `apps/user-client`: `pnpm typecheck` — expected clean (14/14).
- From `apps/user-client`: `pnpm test` — expected green except the known pre-existing localStorage-jsdom baseline; **no new failures** vs master.
- `pnpm exec biome check apps/user-client/src apps/user-client/tests` (from `apps/user-client`, or the repo's biome invocation) — expected clean on all touched files.

Record the exact numbers; they go into the STATUS entry.

- [ ] **Step 2: Update the artefact feature status**

In `obsidian/ARTEFACTS-FEATURE-STATUS.md`:
- In the §4 decomposition table, change Chunk 3's status from `⬜ planned` to `✅ done` with the squash hash placeholder (Liz fills the hash on squash) and date 2026-06-06.
- In §2, append the three new decisions from the spec (entry point = (+) menu variant A; picker = slim Quick-Sheet variant A, search-first, no persona/tag filter; selection-only, no in-picker preview).
- Update the header date line.

- [ ] **Step 3: Update the client STATUS**

In `obsidian/STATUS-CLIENT-ONLY.md`, add a new dated entry at the top of the running log summarising Chunk 3 (what landed, files, verification numbers, "NOT pushed — awaiting Chris's device test", and the spec/plan links), and refresh the `**Last updated:**` line and the artefact-system banner near the top.

- [ ] **Step 4: Log the security surface**

In `obsidian/insights/security-deferrals.md`, add a short note: Chunk 3 adds no new exec/network surface — it copies already-persisted artefact text into the existing attachments table; preview reuses the existing hard-sandboxed lightbox viewers; the only new outbound consequence is artefact content riding a chat message on explicit user action (identical to attaching a text file).

- [ ] **Step 5: Commit the docs**

```bash
git add obsidian/ARTEFACTS-FEATURE-STATUS.md obsidian/STATUS-CLIENT-ONLY.md obsidian/insights/security-deferrals.md
git commit -m "Record Chunk 3 (artefacts as attachments) in STATUS and decision log [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** entry-point menu (Task 4), slim picker with type tabs + search + select-only + Attach(N) (Task 3), snapshot copy with no migration (Task 1), NSFW gating via `useFilteredPersonas` (Task 3 test asserts it), wiring at chat-page level to dodge the cockpit containing-block hazard (Task 5), styling (Task 6), tests + manual-verification handoff + docs (Task 7). All spec sections map to a task.
- **No image-artefact branch** is implemented — out of scope per the spec; `addArtefactSnapshot` is text-only by construction.
- **Back-compat:** `(+)` only becomes a menu when `onAttachFromTreasury` is supplied, so existing cockpit tests (which omit it) keep their behaviour.
- **Type names used consistently:** `addArtefactSnapshot`, `useAddArtefactSnapshots`, `ArtefactPicker`, `useDismissOnOutside`, `onAttachFromTreasury`, `pickerOpen` — identical across tasks.
