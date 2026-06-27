# My Treasury Makeover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the "My Treasury" room (`/app/treasury`) into the design language — `PageScaffold`/`PageBar` chrome, `cs-row` list rows, a restyled segmented type filter (`Img`→`Images`), an `N of M` filtered count, and a `?`-help doc — without changing any artefact logic, the lightbox, or the data model.

**Architecture:** Seven small tasks. Two pure/component units land test-first (`treasuryCountLabel`, the `TypeTabs` label change). The row and route are restyled onto the shared `cs-row`/`PageScaffold` primitives; the filter sheet, bulk action bar, and bulk-tag sheet keep their markup and accessible names (so the existing component + route tests stay green) and are only restyled in CSS. A final task removes the dead `.treasury-row*` CSS and runs the full gate.

**Tech Stack:** TypeScript (strict), React 18, Vite, Tailwind v4 + bespoke `index.css`, Vitest + Testing Library (jsdom), Biome (auto-format on commit via lefthook).

---

## Context the executor needs

- **Spec:** `superpowers/specs/2026-06-27-my-treasury-makeover-design.md`. Read it first.
- **Working directory for all paths below:** `apps/user-client/` (e.g. `src/routes/app/treasury.tsx`).
- **Tests live in `apps/user-client/tests/`** (mirroring `src/`), not co-located. Run them from `apps/user-client/`.
- **Run a single test file:** `pnpm --filter user-client exec vitest run tests/<path>` (or from `apps/user-client/`: `pnpm exec vitest run tests/<path>`).
- **Existing Treasury tests** (must stay green): `tests/routes/treasury.test.tsx`, `tests/components/treasury-type-tabs.test.tsx`, `tests/components/treasury-row.test.tsx`, `tests/components/treasury-filter-sheet.test.tsx`. They assert **roles, accessible names, and behaviour only** — never CSS classes or the count copy — so a careful restyle keeps them passing. The hard constraints they pin:
  - `TypeTabs` keeps `role="tab"` and the labels `All` / `Docs` (and the others).
  - `TreasuryRow` keeps a body button whose accessible name contains the title, a star button whose name matches `/favourite/i`, and the open-vs-select tap behaviour.
  - The route keeps the `Select` button, the bulk `Delete` / `Delete N` flow, and the `⚙` button whose accessible name starts with `Filters`.
  - `TreasuryFilterSheet` keeps the `favourites only` button name, the `Add tag <x>` suggestion buttons, and the Projects group carrying `aria-disabled="true"`.
- **Biome auto-formats on commit** (lefthook pre-commit). Don't hand-fight indentation; commit and let it format, or run the repo's format step.
- **`formatGlyph`** (`src/lib/artefact-sections.ts`) returns `{ glyph, cls }` where `cls` is `g-html` / `g-md` / `g-code`. Keep using it for the leading glyph.

---

## File Structure

**Create:**
- `src/content/help/treasury.md` — the `?`-help document.
- `src/lib/treasury-count.ts` — the `treasuryCountLabel` pure helper.
- `tests/unit/treasury-count.test.ts` — its unit test.

**Modify:**
- `src/content/help/index.ts` — register the `treasury` help key.
- `src/components/treasury/TypeTabs.tsx` — `Img`→`Images`, segmented-control classes.
- `src/components/treasury/TreasuryRow.tsx` — rebuild on `cs-row` grammar.
- `src/routes/app/treasury.tsx` — `PageScaffold`/`PageBar` chrome, `useHelp`, count label, list container.
- `src/index.css` — add `.cs-segmented`/`.cs-seg` + `.cs-row[data-selected]`; restyle `.treasury-sheet*`/`.treasury-actionbar*`; remove dead `.treasury-row*`/`.treasury-list`.
- `tests/components/treasury-type-tabs.test.tsx` — assert the `Images` label.

**Untouched (verbatim):** all `src/data/artefacts.ts` hooks, `src/lib/treasury-filter.ts`, the lightbox, NSFW gating, URL mirroring, the multi-select state machine. No Dexie change.

---

### Task 1: Help document + registry wiring

**Files:**
- Create: `src/content/help/treasury.md`
- Modify: `src/content/help/index.ts`

- [ ] **Step 1: Write the help document**

Create `src/content/help/treasury.md` with exactly this content:

```markdown
# My Treasury

Your Treasury is the single place where every artefact your companions make
collects — the small web apps they build, notes you save from a reply, and code
blocks you lift out of a conversation. Artefacts are born inside chats; they
gather here automatically, so there is nothing to create on this page.

## Finding things

Filter by **type** with the row of segments at the top — All, Apps, Docs, Code,
or Images. For finer control, the **⚙** button opens filters for persona, tags,
and favourites. Search by name at any time; the filters combine, and the count
tells you how many of your artefacts match.

## Favourites

Tap the star on any row to keep an artefact close. There is no limit, and the
favourites filter in the ⚙ sheet narrows the list to just those.

## Opening and editing

Tap a row to open the artefact full-screen, where you can read it, edit it,
rename it, tag it, download it, or delete it, and page through the rest.

## Tidying up several at once

Tap **Select** to enter selection mode, tick the artefacts you mean, then tag or
delete them together. Deleting is permanent — an artefact removed here is gone.
```

- [ ] **Step 2: Register the help key**

In `src/content/help/index.ts`, add the import (keep the existing alphabetical-ish grouping; place it after the `settings` import line):

```ts
import treasury from './treasury.md?raw';
```

Add `'treasury'` to the `HelpKey` union (after `'settings-expert'`):

```ts
  | 'settings-expert'
  | 'treasury';
```

Add the `HELP_DOCS` entry (after the `'settings-expert'` entry):

```ts
  'settings-expert': { title: '"Ask an Expert" — help', markdown: settingsExpert },
  treasury: { title: 'My Treasury — help', markdown: treasury },
```

- [ ] **Step 3: Verify the types compile**

Run: `pnpm --filter user-client exec tsc --noEmit -p tsconfig.json`
Expected: no errors (the `?raw` import resolves via the existing Vite client types; the new `HelpKey` member is now valid).

- [ ] **Step 4: Commit**

```bash
git add src/content/help/treasury.md src/content/help/index.ts
git commit -m "Add My Treasury help document"
```

---

### Task 2: `treasuryCountLabel` pure helper (TDD)

The header count must read `empty` with no artefacts, `N artefacts` when nothing is hidden by a filter, and `N of M` when a filter narrows the set (spec §4, folded Laura soft).

**Files:**
- Test: `tests/unit/treasury-count.test.ts`
- Create: `src/lib/treasury-count.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/treasury-count.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { treasuryCountLabel } from '../../src/lib/treasury-count.js';

test('no artefacts at all → empty', () => {
  expect(treasuryCountLabel(0, 0)).toBe('empty');
});

test('nothing filtered out → total artefacts', () => {
  expect(treasuryCountLabel(5, 5)).toBe('5 artefacts');
});

test('a filter narrows the set → N of M', () => {
  expect(treasuryCountLabel(5, 2)).toBe('2 of 5');
});

test('a filter matching none → 0 of M', () => {
  expect(treasuryCountLabel(5, 0)).toBe('0 of 5');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/unit/treasury-count.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/treasury-count.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/treasury-count.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Treasury header count. `total` is the count of artefacts the user could
 * see (after NSFW gating); `filtered` is how many survive the active filters.
 *
 * - `empty` when there are no artefacts at all,
 * - `N artefacts` when no filter hides anything,
 * - `N of M` when a filter narrows the set — so the header never reads
 *   "42 artefacts" above three rows.
 */
export function treasuryCountLabel(total: number, filtered: number): string {
  if (total === 0) return 'empty';
  if (filtered >= total) return `${total} artefacts`;
  return `${filtered} of ${total}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter user-client exec vitest run tests/unit/treasury-count.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury-count.ts tests/unit/treasury-count.test.ts
git commit -m "Add treasuryCountLabel helper (N of M when filtered)"
```

---

### Task 3: TypeTabs → segmented control + `Images` label

Keep `TypeTabs` (spec §6 — segmented control, not a dropdown). Spell out `Img`→`Images`, and move it from the borrowed `history-tabs` styling to a makeover `cs-segmented` aesthetic. `TypeTabs` is shared with `ArtefactPicker` (the chat-side attach sheet); the label/style change applies there too, which is the consistent, desired outcome.

**Files:**
- Test: `tests/components/treasury-type-tabs.test.tsx`
- Modify: `src/components/treasury/TypeTabs.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Update the test to pin the new label**

Replace the body of `tests/components/treasury-type-tabs.test.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TypeTabs } from '../../src/components/treasury/TypeTabs.js';

test('renders five segments incl. Images, marks the active one, reports changes', () => {
  const onChange = vi.fn();
  render(<TypeTabs value="all" onChange={onChange} />);
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  // The image segment is spelled out, consistent with Apps/Docs/Code.
  expect(screen.getByRole('tab', { name: 'Images' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Img' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
  expect(onChange).toHaveBeenCalledWith('doc');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/components/treasury-type-tabs.test.tsx`
Expected: FAIL — no tab named `Images` (the component still renders `Img`).

- [ ] **Step 3: Update the component**

In `src/components/treasury/TypeTabs.tsx`, change the `image` label and the container/segment classes. Replace the `TABS` array's last entry and the two `className` strings:

```tsx
const TABS: { value: TreasuryType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'app', label: 'Apps' },
  { value: 'doc', label: 'Docs' },
  { value: 'code', label: 'Code' },
  { value: 'image', label: 'Images' },
];

/** Segmented type filter for the Treasury (and the attach picker). */
export function TypeTabs({ value, onChange }: Props): JSX.Element {
  return (
    <div className="cs-segmented" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className="cs-seg"
          data-active={value === t.value || undefined}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the segmented-control CSS**

In `src/index.css`, immediately after the `.cs-row-trailing { … }` rule (the block ending around the `/* ── ListScaffold primitive … */` comment), add:

```css
/* ── Segmented control (Treasury type filter; attach picker) ──────────── */
.cs-segmented {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.cs-seg {
  flex: 1;
  padding: 6px 4px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--color-paper-soft);
  border-radius: 8px;
  text-align: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.cs-seg[data-active] {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-paper);
  font-weight: 600;
}
```

- [ ] **Step 5: Run the affected tests to verify they pass**

Run: `pnpm --filter user-client exec vitest run tests/components/treasury-type-tabs.test.tsx tests/routes/treasury.test.tsx tests/components/artefact-picker.test.tsx`
Expected: PASS — the new `Images` assertion holds; the route test (which clicks `All`/`Docs`) and the attach-picker test are unaffected by the label/class change.

- [ ] **Step 6: Commit**

```bash
git add src/components/treasury/TypeTabs.tsx src/index.css tests/components/treasury-type-tabs.test.tsx
git commit -m "Restyle Treasury type filter as a segmented control; Img -> Images"
```

---

### Task 4: TreasuryRow → `cs-row` grammar

Rebuild the row on the shared `cs-row` skeleton (leading · body · trailing) while keeping the format glyph, the select-mode check, and the inline favourite star (spec §5). Props and behaviour are unchanged, so `tests/components/treasury-row.test.tsx` stays green.

**Files:**
- Modify: `src/components/treasury/TreasuryRow.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Rewrite the component on `cs-row`**

Replace the whole of `src/components/treasury/TreasuryRow.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../../boot/client-data-db.js';
import { formatGlyph } from '../../lib/artefact-sections.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';
import { artefactSize, formatBytes } from '../../lib/treasury-filter.js';

interface Props {
  row: ArtefactRow;
  personaName: string;
  personaColour: string;
  selectMode: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleFavourite: (id: string) => void;
}

/**
 * Treasury row in the shared `cs-row` grammar: leading glyph (or a check in
 * select mode) · title + `persona · FORMAT · size · age` · inline favourite
 * star. `data-treasury-row` is load-bearing — the lightbox reads it for the
 * open/close zoom origin.
 */
export function TreasuryRow(p: Props): JSX.Element {
  const g = formatGlyph(p.row.format);
  return (
    <div className="cs-row" data-treasury-row={p.row.id} data-selected={p.selected || undefined}>
      <button
        type="button"
        className="cs-row-main"
        onClick={() => (p.selectMode ? p.onToggleSelect(p.row.id) : p.onOpen(p.row.id))}
      >
        <span className="cs-row-leading">
          {p.selectMode ? (
            <span className="treasury-check" data-on={p.selected || undefined} aria-hidden>
              {p.selected ? '✓' : ''}
            </span>
          ) : (
            <span className={`treasury-glyph ${g.cls}`} aria-hidden>
              {g.glyph}
            </span>
          )}
        </span>
        <span className="cs-row-body">
          <span className="cs-row-title">{p.row.title}</span>
          <span className="cs-row-subtitle">
            <span style={{ color: p.personaColour, opacity: 0.8 }}>{p.personaName}</span>
            {' · '}
            {p.row.format.toUpperCase()}
            {' · '}
            {formatBytes(artefactSize(p.row))}
            {' · '}
            {relativeTimeLabel(p.row.createdAt)}
          </span>
        </span>
      </button>
      {!p.selectMode ? (
        <span className="cs-row-trailing">
          <button
            type="button"
            className="treasury-row-star"
            data-active={p.row.favourite || undefined}
            aria-label={p.row.favourite ? 'Remove favourite' : 'Add favourite'}
            onClick={() => p.onToggleFavourite(p.row.id)}
          >
            <span aria-hidden>{p.row.favourite ? '★' : '☆'}</span>
          </button>
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add the selected-row highlight to `cs-row`**

In `src/index.css`, immediately after the `.cs-row:hover { … }` rule, add:

```css
.cs-row[data-selected] {
  background: rgba(141, 109, 255, 0.08);
}
```

- [ ] **Step 3: Run the row test to verify it still passes**

Run: `pnpm --filter user-client exec vitest run tests/components/treasury-row.test.tsx`
Expected: PASS (2 tests) — the body button still exposes the title as its name, the star still matches `/favourite/i`, and the open-vs-select tap behaviour is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/treasury/TreasuryRow.tsx src/index.css
git commit -m "Rebuild Treasury row on the cs-row grammar"
```

---

### Task 5: Restyle the filter sheet, bulk action bar, and bulk-tag sheet

Bring the bespoke `.treasury-*` overlays into the design language. **Markup and accessible names are untouched** — this is CSS only, so the filter-sheet and route tests stay green. Keep the drawer/floating-bar behaviour; soften corners, route colours through tokens, and give the action bar the action-plane accent.

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Restyle the filter/bulk-tag sheet panel**

In `src/index.css`, replace the `.treasury-sheet { … }` rule with:

```css
.treasury-sheet {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(88vw, 22rem);
  background: var(--color-ink, #0d0b16);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  border-top-left-radius: 18px;
  border-bottom-left-radius: 18px;
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.45);
}
```

- [ ] **Step 2: Restyle the floating bulk action bar**

In `src/index.css`, replace the `.treasury-actionbar { … }` rule with:

```css
.treasury-actionbar {
  position: fixed;
  left: 1rem;
  right: 1rem;
  bottom: 1rem;
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: color-mix(in srgb, var(--color-ink, #1a1430) 86%, transparent);
  border: 1px solid rgba(141, 109, 255, 0.45);
  border-radius: 16px;
  padding: 0.7rem 0.9rem;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
}
```

- [ ] **Step 3: Verify the sheet + route tests still pass**

Run: `pnpm --filter user-client exec vitest run tests/components/treasury-filter-sheet.test.tsx tests/routes/treasury.test.tsx`
Expected: PASS — no markup or accessible name changed; only CSS did.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "Restyle Treasury filter sheet and bulk action bar in the design language"
```

---

### Task 6: Rebuild the route on `PageScaffold`

Swap the `EditorTopbar` for `PageScaffold`/`PageBar`, wire `useHelp('treasury')`, use `treasuryCountLabel`, and make the list a flex column of `cs-row` rows. Everything else (filters, chips, select mode, sheets, lightbox, URL mirroring, NSFW gating) is preserved verbatim.

**Files:**
- Modify: `src/routes/app/treasury.tsx`

- [ ] **Step 1: Replace the whole route file**

Replace the entire content of `src/routes/app/treasury.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TagEditor } from '../../components/artefact/TagEditor.js';
import { HistorySearchBar } from '../../components/history/HistorySearchBar.js';
import { Lightbox } from '../../components/lightbox/Lightbox.js';
import { artefactToViewable } from '../../components/lightbox/viewable-item.js';
import { TreasuryFilterSheet } from '../../components/treasury/TreasuryFilterSheet.js';
import { TreasuryRow } from '../../components/treasury/TreasuryRow.js';
import { TypeTabs } from '../../components/treasury/TypeTabs.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import {
  useAddTagsToArtefacts,
  useAllArtefacts,
  useDeleteArtefacts,
  useRenameArtefactGlobal,
  useSetArtefactFavouriteGlobal,
  useSetArtefactTags,
  useUpdateArtefactContentGlobal,
} from '../../data/artefacts.js';
import { useFilteredPersonas } from '../../data/personas.js';
import { treasuryCountLabel } from '../../lib/treasury-count.js';
import { type TreasuryType, applyTreasuryFilters, collectTags } from '../../lib/treasury-filter.js';

export function Treasury(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { data: rows = [] } = useAllArtefacts();
  const personas = useFilteredPersonas();
  const { onHelp, helpOverlay } = useHelp('treasury');

  const [type, setType] = useState<TreasuryType>((search.get('type') as TreasuryType) ?? 'all');
  const [personaId, setPersonaId] = useState<string | null>(search.get('personaId'));
  const [tags, setTags] = useState<string[]>([]);
  const [favourite, setFavourite] = useState(false);
  const [query, setQuery] = useState(search.get('query') ?? '');
  const [filterOpen, setFilterOpen] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagging, setTagging] = useState(false);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const setFav = useSetArtefactFavouriteGlobal();
  const setArtefactTags = useSetArtefactTags();
  const addTags = useAddTagsToArtefacts();
  const removeMany = useDeleteArtefacts();
  const renameGlobal = useRenameArtefactGlobal();
  const editGlobal = useUpdateArtefactContentGlobal();

  const personaById = useMemo(() => {
    const m = new Map<string, { name: string; colour: string }>();
    for (const p of personas.data ?? []) m.set(p.id, { name: p.name, colour: p.colour });
    return m;
  }, [personas.data]);
  const visiblePersonaIds = useMemo(
    () => new Set((personas.data ?? []).map((p) => p.id)),
    [personas.data],
  );

  const visibleRows = useMemo(
    () => rows.filter((r) => visiblePersonaIds.has(r.personaId)),
    [rows, visiblePersonaIds],
  );
  const allTags = useMemo(() => collectTags(visibleRows), [visibleRows]);
  const filtered = useMemo(
    () => applyTreasuryFilters(visibleRows, { type, personaId, tags, favourite, query }),
    [visibleRows, type, personaId, tags, favourite, query],
  );

  const items = useMemo(() => filtered.map(artefactToViewable), [filtered]);
  const openIndex = openId ? filtered.findIndex((r) => r.id === openId) : -1;

  function mirrorUrl(next: {
    type?: TreasuryType;
    personaId?: string | null;
    query?: string;
  }): void {
    setSearch(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next.type !== undefined) {
          if (next.type === 'all') params.delete('type');
          else params.set('type', next.type);
        }
        if (next.personaId !== undefined) {
          if (next.personaId) params.set('personaId', next.personaId);
          else params.delete('personaId');
        }
        if (next.query !== undefined) {
          if (next.query.trim() !== '') params.set('query', next.query.trim());
          else params.delete('query');
        }
        return params;
      },
      { replace: true },
    );
  }

  // Auto-reset the persona filter to All when the selected persona stops being
  // visible (e.g. NSFW → SFW flip while an adult persona was selected).
  // `mirrorUrl` is intentionally omitted from deps — it closes over no changing
  // state relevant here and is stable enough for this guard; mirroring History.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (!personaId || !personas.data) return;
    if (!personas.data.some((p) => p.id === personaId)) {
      setPersonaId(null);
      mirrorUrl({ personaId: null });
    }
  }, [personaId, personas.data]);

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function exitSelect(): void {
    setSelectMode(false);
    setSelected(new Set());
    setTagging(false);
    setBulkTags([]);
    setConfirmDelete(false);
  }

  const activeFilterCount = (personaId ? 1 : 0) + (favourite ? 1 : 0) + tags.length;

  return (
    <PageScaffold crumbs={[{ label: 'My Treasury' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-24 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-paper-soft">
            {treasuryCountLabel(visibleRows.length, filtered.length)}
          </span>
          <button
            type="button"
            className="rounded-md border border-aurora-700 bg-white/[0.02] px-3 py-1 text-xs text-aurora-200"
            aria-pressed={selectMode}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>

        <TypeTabs
          value={type}
          onChange={(t) => {
            setType(t);
            mirrorUrl({ type: t });
          }}
        />

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <HistorySearchBar
              value={query}
              onChange={(v) => {
                setQuery(v);
                mirrorUrl({ query: v });
              }}
              placeholder="Search by name…"
            />
          </div>
          <button
            type="button"
            className="relative shrink-0 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-paper-soft"
            aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
            onClick={() => setFilterOpen(true)}
          >
            ⚙
            {activeFilterCount > 0 ? (
              <span className="ml-1 rounded-full bg-aurora-700 px-1.5 text-[10px] text-paper">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>

        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap gap-2">
            {personaId ? (
              <button
                type="button"
                className="tag-chip"
                onClick={() => {
                  setPersonaId(null);
                  mirrorUrl({ personaId: null });
                }}
              >
                {personaById.get(personaId)?.name ?? 'Persona'} ✕
              </button>
            ) : null}
            {favourite ? (
              <button type="button" className="tag-chip" onClick={() => setFavourite(false)}>
                ★ Favourites ✕
              </button>
            ) : null}
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="tag-chip"
                onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
              >
                #{t} ✕
              </button>
            ))}
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="mt-8 grid place-items-center text-center text-paper-soft">
            <p className="font-display text-lg italic text-paper">
              {rows.length === 0 ? 'No artefacts yet.' : 'No artefacts match your filters.'}
            </p>
            {rows.length === 0 ? (
              <p className="mt-2 max-w-xs text-sm">Artefacts a persona builds will collect here.</p>
            ) : (
              <button
                type="button"
                className="mt-2 rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper"
                onClick={() => {
                  setType('all');
                  setPersonaId(null);
                  setTags([]);
                  setFavourite(false);
                  setQuery('');
                  mirrorUrl({ type: 'all', personaId: null, query: '' });
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((r) => {
              const persona = personaById.get(r.personaId);
              return (
                <TreasuryRow
                  key={r.id}
                  row={r}
                  personaName={persona?.name ?? '—'}
                  personaColour={persona?.colour ?? '#8d6dff'}
                  selectMode={selectMode}
                  selected={selected.has(r.id)}
                  onOpen={setOpenId}
                  onToggleSelect={toggleSelect}
                  onToggleFavourite={(id) => setFav.mutate({ id, favourite: !r.favourite })}
                />
              );
            })}
          </div>
        )}

        {filterOpen ? (
          <TreasuryFilterSheet
            personas={personas.data ?? []}
            personaId={personaId}
            onPersonaChange={(id) => {
              setPersonaId(id);
              mirrorUrl({ personaId: id });
            }}
            allTags={allTags}
            selectedTags={tags}
            onTagsChange={setTags}
            favourite={favourite}
            onFavouriteChange={setFavourite}
            onClose={() => setFilterOpen(false)}
          />
        ) : null}

        {selectMode ? (
          <div className="treasury-actionbar">
            <span className="treasury-actionbar-count">{selected.size} selected</span>
            {confirmDelete ? (
              <>
                <span className="treasury-actionbar-confirm">
                  Delete {selected.size}? Cannot be undone.
                </span>
                <button
                  type="button"
                  className="treasury-actionbar-btn danger"
                  onClick={() => {
                    removeMany.mutate([...selected]);
                    exitSelect();
                  }}
                >
                  Delete {selected.size}
                </button>
                <button
                  type="button"
                  className="treasury-actionbar-btn"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="treasury-actionbar-btn"
                  disabled={selected.size === 0}
                  onClick={() => setTagging(true)}
                >
                  🏷 Tag
                </button>
                <button
                  type="button"
                  className="treasury-actionbar-btn danger"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmDelete(true)}
                >
                  🗑 Delete
                </button>
              </>
            )}
          </div>
        ) : null}

        {tagging ? (
          <div className="treasury-sheet-root">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; buttons are the keyboard path */}
            <div
              className="treasury-backdrop"
              onClick={() => {
                setTagging(false);
                setBulkTags([]);
              }}
            />
            <aside className="treasury-sheet" aria-label="Tag selected">
              <header className="treasury-sheet-header">
                <span className="treasury-sheet-title">Tag {selected.size} artefacts</span>
                <button
                  type="button"
                  className="treasury-sheet-close"
                  aria-label="Close"
                  onClick={() => {
                    setTagging(false);
                    setBulkTags([]);
                  }}
                >
                  <span aria-hidden>×</span>
                </button>
              </header>
              <TagEditor mode="edit" value={bulkTags} suggestions={allTags} onChange={setBulkTags} />
              <button
                type="button"
                className="treasury-actionbar-btn"
                disabled={bulkTags.length === 0}
                onClick={() => {
                  addTags.mutate({ ids: [...selected], tags: bulkTags });
                  exitSelect();
                }}
              >
                Apply tags
              </button>
            </aside>
          </div>
        ) : null}

        {openId !== null && openIndex >= 0 ? (
          <Lightbox
            items={items}
            index={openIndex}
            getOriginRect={(id) =>
              document
                .querySelector<HTMLElement>(`[data-treasury-row="${CSS.escape(id)}"]`)
                ?.getBoundingClientRect() ?? null
            }
            tagSuggestions={allTags}
            onSetTags={(id, t) => setArtefactTags.mutate({ id, tags: t })}
            onRename={(id, patch) => renameGlobal.mutate({ id, patch })}
            onRemove={() => {}}
            onEditText={(id, text) => editGlobal.mutate({ id, content: text })}
            onDelete={(id) => {
              removeMany.mutate([id]);
              setOpenId(null);
            }}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
```

- [ ] **Step 2: Run the route test to verify it passes**

Run: `pnpm --filter user-client exec vitest run tests/routes/treasury.test.tsx`
Expected: PASS (3 tests) — list/filter, bulk delete, and NSFW non-leak all still hold (roles and accessible names are unchanged; only the chrome wrapper, count copy, and list container differ).

- [ ] **Step 3: Verify the whole surface typechecks**

Run: `pnpm --filter user-client exec tsc --noEmit -p tsconfig.json`
Expected: no errors. (If Biome reformats on commit, that is fine.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/app/treasury.tsx
git commit -m "Rebuild My Treasury route on PageScaffold with help and N-of-M count"
```

---

### Task 7: Remove dead CSS + full gate

The `cs-row` rebuild orphaned the old row styles. Remove them and run the whole gate.

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Confirm the old classes are unreferenced**

Run both, from `apps/user-client/`:

```bash
rg -n 'treasury-list|treasury-row-body|treasury-row-title|treasury-row-meta' src
rg -n 'className="treasury-row"' src
```

Expected: the first matches **only** in `src/index.css` (the rule definitions); the
second has **no** matches (the row now uses `cs-row`). If any `.tsx` still references
them, stop — something earlier was missed. Note the retained tokens that these
patterns deliberately do **not** catch and must stay: `data-treasury-row` (lightbox
origin), `treasury-row-star`, `treasury-glyph`, `treasury-check`.

- [ ] **Step 2: Delete the orphaned rules**

In `src/index.css`, remove these rule blocks (and only these):

```css
.treasury-list {
  display: flex;
  flex-direction: column;
}
.treasury-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.6rem 0.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.treasury-row[data-selected] {
  background: rgba(141, 109, 255, 0.08);
}
.treasury-row-body {
  flex: 1;
  min-width: 0;
  text-align: left;
}
.treasury-row-title {
  display: block;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--color-paper);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.treasury-row-meta {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.72rem;
  color: var(--color-paper-soft);
}
```

- [ ] **Step 3: Confirm nothing else broke and the build is clean**

Run from the repo root:
```bash
pnpm typecheck --force
pnpm --filter user-client exec vitest run
pnpm run build
```
Expected:
- `typecheck` 14/14.
- vitest at the **8 Node-localStorage baseline** (the documented pre-existing failures) plus the new `treasury-count` test passing — no *new* failures attributable to this work.
- `build` clean (9/9).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "Remove orphaned Treasury row CSS"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §4 chrome → Task 6; §5 rows → Task 4; §6 type segmented control + `Images` → Task 3; §4 `N of M` count → Task 2+6; §7 filter sheet + chips → Task 5 (CSS) + Task 6 (chips preserved); §8 multi-select → Task 6 (behaviour) + Task 5 (CSS); §11 help → Task 1; §10 retire → Task 7. Lightbox/URL-mirror/NSFW (§9) carried verbatim in Task 6.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `treasuryCountLabel(total, filtered)` defined in Task 2 and called with `(visibleRows.length, filtered.length)` in Task 6; `TypeTabs` keeps its `{ value, onChange }` props; `TreasuryRow` keeps its prop shape (Task 4) so the Task 6 call site is unchanged.
- **Test integrity:** the four existing Treasury tests pin roles/names/behaviour only; Tasks 3–6 preserve all of them, and Task 3 tightens the type-tabs test to the new `Images` label.

## Out of scope (carried from the spec)

- The Lightbox makeover (acceptable as-is).
- The slim attach-picker Quick-Sheet (with the chat surface, last). Note: `TypeTabs` is shared with it, so its segmented-control restyle and `Images` label land there too — verify it still reads well on device.

## Audit gates

- **Laura:** spec-pass done (no hard defects). A **pre-squash pass** is still required — it must verify the floating action bar, the `⚙` filter sheet, and the bulk-tag sheet stay fully visible and reachable at 380 px inside `PageScaffold` (her §14.6 build-risk watch), and that the segmented control reads well.
- **Larissa:** not a security path (client-only; no `packages/crypto`, auth/sync/proxy change).

## Manual verification (Chris, on device)

Run the spec §14 checklist: zoom in/out from the tile; the segmented control shows all five categories (incl. **Images**) and filters; rows show glyph · title · `persona · FORMAT · size · age` with a one-tap star; the `N of M` count tracks active filters; the `⚙` sheet + chips filter and clear; Select → Tag / Delete (inline confirm); a row opens the lightbox and zooms back; SFW hides adult-persona artefacts.
